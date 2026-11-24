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
import {
  changedFiles,
  checkImages,
  evaluateImageJobs,
  imagePlan,
  imageSummary,
  scopeServices,
  scopedToChanges,
  sharedImageFiles,
} from "./image-ci.mjs";

const prEnv = {
  GITHUB_REPOSITORY: "ktcloud-cloudnative-2026/team02-5xx",
  GITHUB_SHA: "b".repeat(40),
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_REF: "refs/pull/1/merge",
  CI_IMAGE_SCOPE: "changed",
};

function write(root, path, body = "") {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

function fixture(t, ids = ["auth", "menu", "web-frontend"]) {
  const root = mkdtempSync(join(tmpdir(), "peakorder-image-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(
    root,
    ".github/ci/services.json",
    JSON.stringify({
      services: ids.map((id) => ({ id, path: "services/" + id })),
    }),
  );
  for (const id of ids) {
    const names =
      id === "web-frontend"
        ? ["package.json", "package-lock.json"]
        : [
            "gradlew",
            "gradle/wrapper/gradle-wrapper.jar",
            "gradle/wrapper/gradle-wrapper.properties",
            "build.gradle",
            "settings.gradle",
          ];
    for (const name of names)
      write(
        root,
        `services/${id}/${name}`,
        name.endsWith(".json") ? "{}" : "x",
      );
  }
  return root;
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

const services = [
  { id: "auth", path: "services/auth" },
  { id: "auth-extra", path: "services/auth-extra" },
  { id: "menu", path: "services/menu" },
];

test("PR 변경 범위: 바뀐 서비스만 고르고, 공통 파일이나 판단 불가면 전체를 고른다", () => {
  const ids = (list) => list.map((service) => service.id);
  assert.deepEqual(ids(scopeServices(services, null)), [
    "auth",
    "auth-extra",
    "menu",
  ]);
  assert.deepEqual(
    ids(scopeServices(services, ["deploy/apps/x/base/a.yaml", "docs/a.md"])),
    [],
  );
  assert.deepEqual(ids(scopeServices(services, ["services/auth/src/A.java"])), [
    "auth",
  ]);
  assert.deepEqual(
    ids(scopeServices(services, ["services/auth-extra/build.gradle"])),
    ["auth-extra"],
  );
  for (const shared of [
    ".github/ci/docker/java.Dockerfile",
    ".github/ci/image-ci.mjs",
    ".github/ci/service-config.mjs",
    ".github/ci/services.json",
    ".github/workflows/pr-ci.yml",
  ]) {
    assert.deepEqual(
      ids(scopeServices(services, ["docs/a.md", shared])),
      ["auth", "auth-extra", "menu"],
      shared,
    );
  }
  assert.deepEqual(
    ids(scopeServices(services, [".github/ci/dev-image-tags.mjs"])),
    [],
  );
  assert.ok(sharedImageFiles.includes(".github/ci/docker/"));
});

test("변경 범위는 PR 이벤트에서 CI_IMAGE_SCOPE=changed일 때만 적용한다", (t) => {
  const root = fixture(t);
  const onlyMenu = () => ["services/menu/src/A.java"];
  assert.deepEqual(
    imagePlan(root, prEnv, onlyMenu).map((s) => s.id),
    ["menu"],
  );
  assert.deepEqual(
    imagePlan(root, { ...prEnv, CI_IMAGE_SCOPE: "" }, onlyMenu).map(
      (s) => s.id,
    ),
    ["auth", "menu", "web-frontend"],
  );
  const mainEnv = {
    ...prEnv,
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
  };
  assert.equal(scopedToChanges(mainEnv), false);
  assert.deepEqual(
    imagePlan(root, mainEnv, onlyMenu).map((s) => s.id),
    ["auth", "menu", "web-frontend"],
  );
  assert.deepEqual(
    imagePlan(root, prEnv, () => null).map((s) => s.id),
    ["auth", "menu", "web-frontend"],
  );
});

test("바뀐 서비스가 없으면 Docker를 실행하지 않고 생략 목록을 남긴다", (t) => {
  const root = fixture(t);
  const calls = [];
  const report = checkImages(
    root,
    prEnv,
    (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: "" };
    },
    () => ["deploy/apps/order-service/base/httproute.yaml"],
  );
  assert.equal(report.failed, false);
  assert.deepEqual(report.results, []);
  assert.deepEqual(report.skipped, ["auth", "menu", "web-frontend"]);
  assert.deepEqual(calls, []);
  const summary = imageSummary(report);
  assert.match(summary, /바뀐 서비스가 없어 이미지 빌드를 생략/);
  assert.match(summary, /변경 없음으로 생략: auth, menu, web-frontend/);
});

test("바뀐 서비스만 빌드하고 나머지는 생략 목록에 남긴다", (t) => {
  const root = fixture(t);
  const builds = [];
  const report = checkImages(
    root,
    prEnv,
    (command, args) => {
      if (command === "git")
        return { status: 0, stdout: "services/auth/build.gradle\0" };
      if (args[0] === "build") builds.push(args.at(-2));
      if (args[0] === "image")
        return { status: 0, stdout: "sha256:" + "a".repeat(64) };
      return { status: 0, stdout: "" };
    },
    () => ["services/auth/src/A.java"],
  );
  assert.equal(report.failed, false);
  assert.deepEqual(
    report.results.map((r) => r.id),
    ["auth"],
  );
  assert.deepEqual(report.skipped, ["menu", "web-frontend"]);
  assert.equal(builds.length, 1);
  assert.match(builds[0], /\/auth:sha-/);
});

test("CI Final은 변경 범위 PR의 대상 0개 성공을 정상으로, 그 외 0개 실행은 오류로 본다", () => {
  const needs = {
    readiness: { result: "success" },
    image_ci: { result: "success", outputs: { image_results: "[]" } },
    image_publish: { result: "skipped" },
  };
  assert.deepEqual(evaluateImageJobs(needs, [], "pr", { scoped: true }), {
    normalSkips: ["image_publish"],
    results: [],
  });
  assert.throws(
    () => evaluateImageJobs(needs, [], "pr"),
    /0개인데 작업이 실행됨/,
  );
  const mainNeeds = {
    readiness: { result: "success" },
    image_ci: { result: "skipped" },
    image_publish: { result: "success", outputs: { image_results: "[]" } },
  };
  assert.throws(
    () => evaluateImageJobs(mainNeeds, [], "main", { scoped: true }),
    /0개인데 작업이 실행됨/,
  );
});

test("병합 커밋에서는 첫 부모 대비 변경 파일을, 병합 커밋이 아니면 null을 돌려준다", (t) => {
  const root = mkdtempSync(join(tmpdir(), "peakorder-image-scope-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  write(root, "services/auth/a.txt", "1");
  write(root, "services/menu/a.txt", "1");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "base");
  assert.equal(changedFiles(root), null);
  git(root, "switch", "-q", "-c", "feature");
  write(root, "services/menu/a.txt", "2");
  git(root, "commit", "-q", "-am", "menu change");
  git(root, "switch", "-q", "main");
  write(root, "docs/main.md", "main only");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "main moved");
  git(root, "merge", "-q", "--no-ff", "-m", "merge", "feature");
  assert.deepEqual(changedFiles(root), ["services/menu/a.txt"]);
});

test("워크플로는 PR 이미지 빌드와 CI Final에 같은 변경 범위와 이력 깊이를 쓴다", () => {
  const workflow = readFileSync(
    new URL("../workflows/pr-ci.yml", import.meta.url),
    "utf8",
  );
  const job = (id) =>
    workflow.split("\n  " + id + ":")[1].split(/\n {2}(?=\S)/)[0];
  for (const id of ["image_ci", "final"]) {
    assert.match(job(id), /CI_IMAGE_SCOPE: changed/, id);
    assert.match(job(id), /fetch-depth: 2/, id);
  }
  assert.doesNotMatch(job("image_publish"), /CI_IMAGE_SCOPE/);
});

test("Java 이미지 빌드는 의존성 다운로드 재시도를 늘린다", () => {
  const dockerfile = readFileSync(
    new URL("./docker/java.Dockerfile", import.meta.url),
    "utf8",
  );
  assert.match(
    dockerfile,
    /-Dorg\.gradle\.internal\.repository\.max\.retries=5/,
  );
  assert.match(
    dockerfile,
    /-Dorg\.gradle\.internal\.repository\.initial\.backoff=2000/,
  );
});
