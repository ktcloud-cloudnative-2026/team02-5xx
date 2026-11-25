import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
  BRANCH_PREFIX,
  closeSuperseded,
  gitChanged,
  imageName,
  planUpdates,
  prBody,
  publishedIds,
  readDevTag,
  replaceDevTag,
} from "./dev-image-tags.mjs";

const repository = "ktcloud-cloudnative-2026/team02-5xx";
const script = fileURLToPath(new URL("./dev-image-tags.mjs", import.meta.url));
const shaA = "a".repeat(40);
const shaB = "b".repeat(40);

function overlay(id, sha) {
  return [
    "apiVersion: kustomize.config.k8s.io/v1beta1",
    "kind: Kustomization",
    "resources:",
    "  - ../../base",
    "images:",
    `  - name: ghcr.io/${repository}/${id}`,
    `    newTag: sha-${sha}`,
    "",
  ].join("\n");
}

function write(root, path, content = "") {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content, "utf8");
}

function git(root, ...args) {
  const result = spawnSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t, services) {
  const root = mkdtempSync(join(tmpdir(), "peakorder-devtag-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(
    root,
    ".github/ci/services.json",
    JSON.stringify({
      services: services.map(({ id, dir }) => ({
        id,
        path: `services/${dir}`,
      })),
    }),
  );
  for (const { id, dir, tag, auto } of services) {
    write(root, `services/${dir}/src.txt`, "v1\n");
    if (tag !== null)
      write(
        root,
        `deploy/apps/${dir}/overlays/dev/kustomization.yaml`,
        overlay(id, tag),
      );
    write(
      root,
      `deploy/argocd/dev/${dir}.yaml`,
      auto
        ? "spec:\n  syncPolicy:\n    automated:\n      enabled: true\n"
        : "spec:\n  syncPolicy: {}\n",
    );
  }
  return root;
}

test("dev overlay의 sha 태그만 읽고 바꾼다", () => {
  const image = imageName(repository, "auth");
  const content = overlay("auth", shaA);
  assert.equal(readDevTag(content, image), `sha-${shaA}`);
  const next = replaceDevTag(content, image, `sha-${shaB}`);
  assert.equal(readDevTag(next, image), `sha-${shaB}`);
  assert.equal(next.replace(shaB, shaA), content);
  assert.equal(readDevTag(content, imageName(repository, "menu")), null);
  assert.equal(
    readDevTag(content.replace(/\n/g, "\r\n"), image),
    `sha-${shaA}`,
  );
});

test("latest나 짧은 태그로는 바꾸지 않고, 대상 이미지가 없으면 실패한다", () => {
  const image = imageName(repository, "auth");
  const content = overlay("auth", shaA);
  assert.throws(() => replaceDevTag(content, image, "latest"), /sha-/);
  assert.throws(() => replaceDevTag(content, image, "sha-abc"), /sha-/);
  assert.throws(
    () => replaceDevTag(content, imageName(repository, "menu"), `sha-${shaB}`),
    /찾을 수 없습니다/,
  );
});

test("이번 main SHA로 게시에 성공한 이미지만 대상으로 한다", () => {
  const results = [
    { id: "auth", image: `x/auth:sha-${shaB}`, publish: { status: "success" } },
    { id: "menu", image: `x/menu:sha-${shaB}`, publish: { status: "failure" } },
    {
      id: "order",
      image: `x/order:sha-${shaA}`,
      publish: { status: "success" },
    },
  ];
  assert.deepEqual([...publishedIds(JSON.stringify(results), shaB)], ["auth"]);
  assert.throws(() => publishedIds("not json", shaB), /읽을 수 없습니다/);
  assert.throws(() => publishedIds("{}", shaB), /배열/);
});

test("소스가 바뀐 서비스만 갱신하고 나머지는 이유와 함께 건너뛴다", (t) => {
  const root = fixture(t, [
    { id: "auth", dir: "auth-service", tag: shaA, auto: true },
    { id: "menu", dir: "menu-service", tag: shaA, auto: false },
    { id: "order", dir: "order-service", tag: shaA, auto: true },
    { id: "cooking", dir: "cooking-service", tag: shaB, auto: true },
    { id: "payment", dir: "payment-service", tag: null, auto: true },
    {
      id: "web-frontend",
      dir: "web-frontend",
      tag: "c".repeat(40),
      auto: false,
    },
  ]);
  const states = {
    "services/auth-service": "changed",
    "services/menu-service": "unchanged",
    "services/web-frontend": "unknown",
  };
  const { updates, skipped } = planUpdates({
    root,
    repository,
    sha: shaB,
    published: new Set(["auth", "menu", "cooking", "payment", "web-frontend"]),
    changed: (from, to, path) => {
      assert.equal(to, shaB);
      assert.match(from, /^[a-f0-9]{40}$/);
      return states[path];
    },
  });
  assert.deepEqual(
    updates.map(({ id, autoSync, note }) => [id, autoSync, Boolean(note)]),
    [
      ["auth", true, false],
      ["web-frontend", false, true],
    ],
  );
  assert.equal(
    updates[0].overlay,
    "deploy/apps/auth-service/overlays/dev/kustomization.yaml",
  );
  assert.equal(readDevTag(updates[0].content, updates[0].image), `sha-${shaB}`);
  assert.deepEqual(
    Object.fromEntries(skipped.map(({ id, reason }) => [id, reason])),
    {
      menu: "이전 dev 태그 이후 서비스 소스 변경 없음",
      order: "이번 main 실행에서 게시된 이미지 없음",
      cooking: "이미 최신 태그",
      payment: "dev overlay 없음",
    },
  );
});

test("git 비교는 서비스 경로의 변경 여부와 알 수 없는 이전 커밋을 구분한다", (t) => {
  const root = fixture(t, [
    { id: "auth", dir: "auth-service", tag: shaA, auto: true },
    { id: "menu", dir: "menu-service", tag: shaA, auto: true },
  ]);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  const first = git(root, "rev-parse", "HEAD");
  write(root, "services/auth-service/src.txt", "v2\n");
  git(root, "commit", "-q", "-am", "second");
  const second = git(root, "rev-parse", "HEAD");
  assert.equal(
    gitChanged(root, first, second, "services/auth-service"),
    "changed",
  );
  assert.equal(
    gitChanged(root, first, second, "services/menu-service"),
    "unchanged",
  );
  assert.equal(
    gitChanged(root, "d".repeat(40), second, "services/auth-service"),
    "unknown",
  );
});

test("plan 명령은 바뀐 overlay만 수정하고 결과를 출력값으로 남긴다", (t) => {
  const root = fixture(t, [
    { id: "auth", dir: "auth-service", tag: shaA, auto: true },
    { id: "menu", dir: "menu-service", tag: shaA, auto: false },
  ]);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  const first = git(root, "rev-parse", "HEAD");
  for (const id of ["auth", "menu"]) {
    const dir = `${id}-service`;
    write(
      root,
      `deploy/apps/${dir}/overlays/dev/kustomization.yaml`,
      overlay(id, first),
    );
  }
  git(root, "commit", "-q", "-am", "pin dev tags");
  write(root, "services/auth-service/src.txt", "v2\n");
  git(root, "commit", "-q", "-am", "auth change");
  const head = git(root, "rev-parse", "HEAD");

  const temp = mkdtempSync(join(tmpdir(), "peakorder-devtag-out-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const outputFile = join(temp, "output.txt");
  const results = ["auth", "menu"].map((id) => ({
    id,
    image: `ghcr.io/${repository}/${id}:sha-${head}`,
    publish: { status: "success" },
  }));
  const result = spawnSync(process.execPath, [script, "plan"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: head,
      IMAGE_RESULTS_JSON: JSON.stringify(results),
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: "",
      RUNNER_TEMP: temp,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const outputs = readFileSync(outputFile, "utf8");
  assert.match(outputs, /^changed=true$/m);
  assert.match(
    outputs,
    /^files=deploy\/apps\/auth-service\/overlays\/dev\/kustomization\.yaml$/m,
  );
  const changedFiles = git(root, "diff", "--name-only");
  assert.equal(
    changedFiles,
    "deploy/apps/auth-service/overlays/dev/kustomization.yaml",
  );
  assert.match(
    readFileSync(join(temp, "dev-image-tags-body.md"), "utf8"),
    /Refs #281/,
  );
});

test("변경이 없으면 changed=false이고 파일을 수정하지 않는다", (t) => {
  const root = fixture(t, [
    { id: "auth", dir: "auth-service", tag: shaA, auto: true },
  ]);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  const first = git(root, "rev-parse", "HEAD");
  write(
    root,
    "deploy/apps/auth-service/overlays/dev/kustomization.yaml",
    overlay("auth", first),
  );
  git(root, "commit", "-q", "-am", "pin");
  write(root, "README.md", "docs only\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "docs");
  const head = git(root, "rev-parse", "HEAD");
  const temp = mkdtempSync(join(tmpdir(), "peakorder-devtag-out-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const outputFile = join(temp, "output.txt");
  const result = spawnSync(process.execPath, [script, "plan"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: head,
      IMAGE_RESULTS_JSON: JSON.stringify([
        {
          id: "auth",
          image: `x/auth:sha-${head}`,
          publish: { status: "success" },
        },
      ]),
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: "",
      RUNNER_TEMP: temp,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(outputFile, "utf8"), /^changed=false$/m);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("open 명령은 토큰이 없으면 PR을 만들지 않고 성공으로 끝난다", (t) => {
  const root = mkdtempSync(join(tmpdir(), "peakorder-devtag-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [script, "open"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DEV_TAG_TOKEN: "", GITHUB_STEP_SUMMARY: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR을 만들지 않았습니다/);
});

test("PR 본문은 추적 Issue를 Refs로 연결하고 필수 리뷰와 수동 Sync를 표시한다", () => {
  const body = prBody({
    sha: shaB,
    repository,
    updates: [
      {
        id: "auth",
        oldTag: `sha-${shaA}`,
        newTag: `sha-${shaB}`,
        autoSync: true,
        note: "",
      },
      {
        id: "menu",
        oldTag: `sha-${shaA}`,
        newTag: `sha-${shaB}`,
        autoSync: false,
        note: "",
      },
    ],
    skipped: [
      { id: "order", reason: "이전 dev 태그 이후 서비스 소스 변경 없음" },
    ],
  });
  assert.match(body, /Refs #281/);
  assert.doesNotMatch(body, /Closes #/);
  assert.match(body, /필수 리뷰 대상/);
  assert.match(body, /\| menu \|.*수동 Sync 필요/);
  assert.match(body, /\| auth \|.*자동 Sync/);
  assert.match(body, /order: 이전 dev 태그 이후/);
});

test("대체된 자동 PR만 닫고 다른 PR·포크·새 PR은 건드리지 않는다", async () => {
  const keep = BRANCH_PREFIX + "bbbbbbb";
  const calls = [];
  const pulls = [
    {
      number: 10,
      head: { ref: BRANCH_PREFIX + "aaaaaaa", repo: { full_name: repository } },
    },
    { number: 11, head: { ref: keep, repo: { full_name: repository } } },
    {
      number: 12,
      head: { ref: "feat/1-other", repo: { full_name: repository } },
    },
    {
      number: 13,
      head: {
        ref: BRANCH_PREFIX + "ccccccc",
        repo: { full_name: "fork/team02-5xx" },
      },
    },
  ];
  const fakeFetch = async (url, options) => {
    calls.push([options.method, url.replace("https://api.github.com", "")]);
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return {
      ok: true,
      status: options.method === "DELETE" ? 204 : 200,
      json: async () => (options.method === "GET" ? pulls : {}),
    };
  };
  const closed = await closeSuperseded({
    fetchImpl: fakeFetch,
    token: "test-token",
    repository,
    keepBranch: keep,
    newNumber: 11,
  });
  assert.deepEqual(closed, [10]);
  assert.deepEqual(calls.slice(1), [
    ["POST", `/repos/${repository}/issues/10/comments`],
    ["PATCH", `/repos/${repository}/pulls/10`],
    ["DELETE", `/repos/${repository}/git/refs/heads/${BRANCH_PREFIX}aaaaaaa`],
  ]);
});

test("워크플로의 자동 태그 job은 main 게시 성공 뒤에만 실행되고 패키지 권한이 없다", async (t) => {
  const workflow = readFileSync(
    new URL("../workflows/pr-ci.yml", import.meta.url),
    "utf8",
  );
  const job = workflow.split("\n  dev_image_tags:")[1].split(/\n {2}(?=\S)/)[0];
  assert.match(job, /needs: \[image_publish\]/);
  assert.match(job, /contents: read/);
  assert.doesNotMatch(
    job,
    /packages: write|contents: write|pull-requests: write/,
  );
  assert.match(job, /fetch-depth: 0/);
  assert.match(job, /persist-credentials: false/);
  assert.match(
    job,
    /IMAGE_RESULTS_JSON: \$\{\{ needs\.image_publish\.outputs\.image_results \}\}/,
  );
  assert.match(
    job,
    /DEV_TAG_TOKEN: \$\{\{ secrets\.PEAKORDER_DEV_TAG_TOKEN \}\}/,
  );
  assert.match(job, /if: \$\{\{ steps\.plan\.outputs\.changed == 'true' \}\}/);
  const expression = job.match(/if: \$\{\{([\s\S]+?)\}\}/)[1];
  for (const [event, ref, publish, cancelled, expected] of [
    ["push", "refs/heads/main", "success", false, true],
    ["pull_request", "refs/pull/1/merge", "skipped", false, false],
    ["push", "refs/heads/main", "failure", false, false],
    ["push", "refs/heads/main", "success", true, false],
    ["push", "refs/heads/other", "success", false, false],
  ]) {
    await t.test(`${event}/${publish}/${cancelled}`, () => {
      const actual = runInNewContext(expression, {
        github: { event_name: event, ref },
        needs: { image_publish: { result: publish } },
        cancelled: () => cancelled,
      });
      assert.equal(actual, expected);
    });
  }
});
