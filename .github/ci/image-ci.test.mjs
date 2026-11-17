import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  checkImages,
  evaluateImageJobs,
  imagePlan,
  imageSummary,
  prepareContext,
  publishImages,
  validateImageResults,
} from "./image-ci.mjs";

const imageId = "sha256:" + "a".repeat(64);
const env = {
  GITHUB_REPOSITORY: "ktcloud-cloudnative-2026/team02-5xx",
  GITHUB_SHA: "b".repeat(40),
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_REF: "refs/pull/1/merge",
};
const finalChecker = fileURLToPath(
  new URL("./final-check.mjs", import.meta.url),
);

function write(root, path, body = "") {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

function fixture(t, ids = ["auth"]) {
  const root = mkdtempSync(join(tmpdir(), "peakorder-image-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const services = ids.map((id) => ({ id, path: "services/" + id }));
  write(root, ".github/ci/services.json", JSON.stringify({ services }));
  const files = [];
  for (const service of services) {
    const names =
      service.id === "web-frontend"
        ? ["package.json", "package-lock.json", "src/App.jsx"]
        : [
            "gradlew",
            "gradle/wrapper/gradle-wrapper.jar",
            "gradle/wrapper/gradle-wrapper.properties",
            "build.gradle",
            "settings.gradle",
            "src/Application.java",
          ];
    for (const name of names) {
      const file = service.path + "/" + name;
      files.push(file);
      write(root, file, name.endsWith(".json") ? "{}" : "fixture source");
    }
  }
  return { root, services, files };
}

// These commands simulate Docker and Trivy. They do not build or scan real images.
function commands(fixture, options = {}) {
  const calls = [];
  const execute = (command, args, settings = {}) => {
    calls.push({ command, args, settings });
    const ok = { status: 0, stdout: "", stderr: "" };
    if (command === "git")
      return {
        ...ok,
        stdout:
          fixture.files
            .filter((file) => file.startsWith(args.at(-1)))
            .join("\0") + "\0",
      };
    if (command === "docker") {
      if (args[0] === "version" && options.engineFailure) return { status: 1 };
      if (args[0] === "build")
        return { ...ok, status: options.buildFailure ? 1 : 0 };
      if (args[0] === "image")
        return {
          ...ok,
          stdout: options.changedId ? "sha256:" + "c".repeat(64) : imageId,
        };
      if (args[0] === "login" && options.loginFailure) return { status: 1 };
      if (args[0] === "push")
        return { ...ok, status: options.pushFailure ? 1 : 0 };
      return ok;
    }
    if (command === "trivy") {
      if (args[0] === "--version")
        return {
          ...ok,
          stdout:
            "Version: " + (options.wrongVersion ? "0.1.0" : "0.76.2") + "\n",
        };
      calls.at(-1).config = readFileSync(
        args[args.indexOf("--config") + 1],
        "utf8",
      );
      const output = args[args.indexOf("--output") + 1];
      if (!options.missingReport)
        writeFileSync(
          output,
          options.badJson
            ? "{"
            : JSON.stringify({
                SchemaVersion: 2,
                Metadata: {
                  ImageID: options.wrongScanId
                    ? "sha256:" + "d".repeat(64)
                    : imageId,
                },
                Results: [{ Vulnerabilities: options.vulnerabilities ?? [] }],
              }),
        );
      return { ...ok, status: options.scanFailure ? 1 : 0 };
    }
    throw new Error("Unexpected command " + command);
  };
  return { execute, calls };
}

function successfulReport(services) {
  return {
    failed: false,
    error: "",
    results: services.map((service) => ({
      ...service,
      imageId,
      build: { status: "success", reason: "모의 빌드" },
      scan: { status: "success", reason: "모의 검사" },
      publish: { status: "not_run", reason: "PR" },
    })),
  };
}

function needsFor(plan, report, mode = "pr") {
  const registered = plan.map(({ id, kind, path }) => ({ id, kind, path }));
  const needs = {
    readiness: {
      result: "success",
      outputs: {
        registered_count: String(plan.length),
        ready_services: JSON.stringify(registered),
        java_count: String(
          plan.filter((service) => service.kind === "java").length,
        ),
        node_count: String(
          plan.filter((service) => service.kind === "node").length,
        ),
      },
    },
  };
  for (const [kind, job] of [
    ["java", "java_ci"],
    ["node", "react_ci"],
  ]) {
    const results = registered
      .filter((service) => service.kind === kind)
      .map((service) => ({
        ...service,
        ...Object.fromEntries(
          ["setup", "install", "format", "test", "build"].map((name) => [
            name,
            { status: "success", reason: "모의 검사" },
          ]),
        ),
      }));
    needs[job] = {
      result: results.length ? "success" : "skipped",
      outputs: { service_results: JSON.stringify(results) },
    };
  }
  needs.image_ci = { result: "skipped" };
  needs.image_publish = { result: "skipped" };
  if (plan.length)
    needs[mode === "pr" ? "image_ci" : "image_publish"] = {
      result: "success",
      outputs: { image_results: JSON.stringify(report.results) },
    };
  return needs;
}

function finalCheck(root, needs, mode = "pr") {
  return spawnSync(process.execPath, [finalChecker, root], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      CI_IMAGE_MODE: mode,
      CI_NEEDS_JSON: JSON.stringify(needs),
      GITHUB_STEP_SUMMARY: join(root, "summary.md"),
    },
  });
}

test("이미지 대상 0개는 Docker·Trivy를 실행하지 않고 미실행으로 요약한다", (t) => {
  const f = fixture(t, []);
  const mock = commands(f);
  const report = checkImages(f.root, env, mock.execute);
  assert.equal(report.failed, false);
  assert.equal(mock.calls.length, 0);
  assert.match(imageSummary(report), /대상 없음·미실행/);
  assert.equal(finalCheck(f.root, needsFor([], report)).status, 0);
});

test("Java·React 및 전체 7개 등록 조합의 빌드와 보안 검사 명령을 유지한다", async (t) => {
  for (const ids of [
    ["auth"],
    ["web-frontend"],
    ["auth", "web-frontend"],
    [
      "auth",
      "menu",
      "inventory",
      "order",
      "payment",
      "cooking",
      "web-frontend",
    ],
  ]) {
    await t.test(ids.join("+"), (t) => {
      const f = fixture(t, ids);
      const mock = commands(f);
      const report = checkImages(f.root, env, mock.execute);
      assert.equal(report.failed, false, JSON.stringify(report));
      assert.equal(report.results.length, ids.length);
      assert.equal(
        mock.calls.filter((call) => call.args[0] === "build").length,
        ids.length,
      );
      for (const call of mock.calls.filter(
        (call) => call.args[0] === "image" && call.command === "trivy",
      )) {
        assert.ok(call.args.includes("HIGH,CRITICAL"));
        assert.ok(call.args.includes("--ignore-unfixed=false"));
        assert.equal(call.config, "{}\n");
      }
      assert.equal(
        finalCheck(f.root, needsFor(imagePlan(f.root, env), report)).status,
        0,
      );
      assert.equal(
        existsSync(
          mock.calls.find((call) => call.args[0] === "build").args.at(-1),
        ),
        false,
      );
      assert.equal(
        readFileSync(join(f.root, f.files[0]), "utf8"),
        f.files[0].endsWith(".json") ? "{}" : "fixture source",
      );
    });
  }
});

test("이미지 태그는 저장소·서비스·전체 SHA를 사용하고 잘못된 입력은 차단한다", (t) => {
  const f = fixture(t);
  assert.equal(
    imagePlan(f.root, { ...env, GITHUB_REPOSITORY: "Org/Repo" })[0].image,
    `ghcr.io/org/repo/auth:sha-${env.GITHUB_SHA}`,
  );
  for (const patch of [
    { GITHUB_SHA: "latest" },
    { GITHUB_SHA: "123" },
    { GITHUB_REPOSITORY: "../repo" },
    { GITHUB_REPOSITORY: "org/repo --push" },
  ])
    assert.throws(() => imagePlan(f.root, { ...env, ...patch }));
});

test("이미지 빌드·도구·스캔 보고서 오류와 취약점은 실패한다", async (t) => {
  for (const [name, options] of Object.entries({
    build: { buildFailure: true },
    docker: { engineFailure: true },
    version: { wrongVersion: true },
    scanner: { scanFailure: true },
    missing: { missingReport: true },
    json: { badJson: true },
    identity: { wrongScanId: true },
    high: { vulnerabilities: [{ Severity: "HIGH" }] },
    critical: { vulnerabilities: [{ Severity: "CRITICAL", FixedVersion: "" }] },
  })) {
    await t.test(name, (t) => {
      const f = fixture(t);
      const mock = commands(f, options);
      const report = checkImages(f.root, env, mock.execute);
      assert.equal(report.failed, true);
      assert.equal(
        mock.calls.some((call) => ["login", "push"].includes(call.args[0])),
        false,
      );
    });
  }
});

test("빌드 실패 후 스캔을 생략하며 다른 서비스의 결과는 계속 수집한다", (t) => {
  const f = fixture(t, ["auth", "menu"]);
  const mock = commands(f, { buildFailure: true });
  const report = checkImages(f.root, env, mock.execute);
  assert.equal(report.results.length, 2);
  assert.ok(
    report.results.every(
      (result) =>
        result.build.status === "failure" && result.scan.status === "not_run",
    ),
  );
  assert.equal(
    mock.calls.filter(
      (call) => call.command === "trivy" && call.args[0] === "image",
    ).length,
    0,
  );
});

test("추적하지 않는 파일은 컨텍스트에 넣지 않으며 저장소 소스를 보존한다", (t) => {
  const f = fixture(t);
  write(f.root, "services/auth/.env", "local-only-placeholder");
  const destination = join(f.root, "context");
  mkdirSync(destination);
  prepareContext(
    f.root,
    imagePlan(f.root, env)[0],
    destination,
    commands(f).execute,
  );
  assert.equal(existsSync(join(destination, ".env")), false);
  assert.match(
    readFileSync(join(destination, ".dockerignore"), "utf8"),
    /\.env\*/,
  );
  assert.equal(
    readFileSync(join(destination, "gradlew"), "utf8"),
    "fixture source",
  );
});

test("외부 파일·잘못된 추적 경로·중복 서비스 등록을 차단한다", (t) => {
  const f = fixture(t);
  const outside = fixture(t);
  mkdirSync(join(f.root, "linked"));
  symlinkSync(
    outside.root,
    join(f.root, "linked/external"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const service = imagePlan(f.root, env)[0];
  for (const file of [
    "../outside",
    "services/auth/../../linked/external/services/auth/gradlew",
    "services/auth/missing",
  ]) {
    assert.throws(() =>
      prepareContext(f.root, service, join(f.root, "context"), () => ({
        status: 0,
        stdout: file + "\0",
      })),
    );
  }
  write(
    f.root,
    ".github/ci/services.json",
    JSON.stringify({ services: [f.services[0], f.services[0]] }),
  );
  assert.throws(() => imagePlan(f.root, env));
});

test("GHCR 게시는 main push에서 검사한 이미지 ID를 확인한 뒤에만 실행한다", (t) => {
  const f = fixture(t, ["auth", "web-frontend"]);
  const plan = imagePlan(f.root, env);
  const report = successfulReport(plan);
  const mock = commands(f);
  const published = publishImages(
    f.root,
    {
      ...env,
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_ACTOR: "lth1202",
      GHCR_TOKEN: "unit-test-token",
    },
    report,
    mock.execute,
  );
  assert.equal(published.failed, false);
  assert.ok(
    published.results.every((result) => result.publish.status === "success"),
  );
  const login = mock.calls.find((call) => call.args[0] === "login");
  assert.equal(login.settings.input, "unit-test-token");
  assert.equal(login.args.includes("unit-test-token"), false);
  assert.ok(
    mock.calls.findIndex((call) => call.args[0] === "login") >
      mock.calls.findIndex((call) => call.args[0] === "image"),
  );
  assert.equal(mock.calls.filter((call) => call.args[0] === "push").length, 2);
  assert.equal(
    finalCheck(f.root, needsFor(plan, published, "main"), "main").status,
    0,
  );
});

test("PR·다른 브랜치·검사 실패·이미지 교체·권한 오류는 게시를 막는다", async (t) => {
  for (const name of [
    "pr",
    "branch",
    "scan",
    "changed-id",
    "token",
    "login",
    "push",
  ]) {
    await t.test(name, (t) => {
      const f = fixture(t);
      const report = successfulReport(imagePlan(f.root, env));
      const settings = {
        ...env,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
        GITHUB_ACTOR: "lth1202",
        GHCR_TOKEN: "unit-test-token",
      };
      if (name === "pr") settings.GITHUB_EVENT_NAME = "pull_request";
      if (name === "branch") settings.GITHUB_REF = "refs/heads/feature";
      if (name === "token") delete settings.GHCR_TOKEN;
      if (name === "scan") report.results[0].scan.status = "failure";
      const mock = commands(f, {
        changedId: name === "changed-id",
        loginFailure: name === "login",
        pushFailure: name === "push",
      });
      assert.equal(
        publishImages(f.root, settings, report, mock.execute).failed,
        true,
      );
      if (name !== "push")
        assert.equal(
          mock.calls.some((call) => call.args[0] === "push"),
          false,
        );
    });
  }
});

test("이미지 결과의 개수·중복·경로·태그·단계 누락을 차단한다", (t) => {
  const f = fixture(t, ["auth", "menu"]);
  const plan = imagePlan(f.root, env);
  const original = successfulReport(plan).results;
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => rows.push(rows[0]),
    (rows) => {
      rows[1] = rows[0];
    },
    (rows) => {
      rows[0].path = "outside";
    },
    (rows) => {
      rows[0].image = "ghcr.io/other/image:latest";
    },
    (rows) => {
      rows[0].scan.status = "not_run";
    },
    (rows) => {
      rows[0].build.status = "failure";
    },
    (rows) => {
      rows[0].imageId = "";
    },
    (rows) => {
      delete rows[0].publish;
    },
  ]) {
    const rows = structuredClone(original);
    mutate(rows);
    assert.throws(() => validateImageResults(plan, rows, false));
  }
});

test("CI Final은 이미지 작업 실패·취소·비정상 생략·결과 오류를 반영한다", async (t) => {
  for (const mode of ["pr", "main"]) {
    for (const state of [
      "failure",
      "cancelled",
      "skipped",
      "missing",
      "bad-json",
      "not-run",
      "unexpected-publish",
    ]) {
      await t.test(mode + "/" + state, (t) => {
        const f = fixture(t);
        const plan = imagePlan(f.root, env);
        const report = successfulReport(plan);
        if (mode === "main") report.results[0].publish.status = "success";
        const needs = needsFor(plan, report, mode);
        const active = mode === "pr" ? "image_ci" : "image_publish";
        if (["failure", "cancelled", "skipped"].includes(state))
          needs[active].result = state;
        if (state === "missing") delete needs[active];
        if (state === "bad-json") needs[active].outputs.image_results = "{";
        if (state === "not-run") {
          report.results[0].scan.status = "not_run";
          needs[active].outputs.image_results = JSON.stringify(report.results);
        }
        if (state === "unexpected-publish")
          needs[mode === "pr" ? "image_publish" : "image_ci"].result =
            "success";
        const result = finalCheck(f.root, needs, mode);
        assert.equal(result.status, 1, result.stdout);
      });
    }
  }
});

test("0개일 때 두 이벤트의 이미지 정상 생략을 유지하고 코드 실패는 최종 실패다", (t) => {
  const f = fixture(t, []);
  const report = successfulReport([]);
  for (const mode of ["pr", "main"]) {
    const needs = needsFor([], report, mode);
    assert.equal(finalCheck(f.root, needs, mode).status, 0);
    needs.readiness.result = "failure";
    assert.equal(finalCheck(f.root, needs, mode).status, 1);
  }
});

test("이미지 성공이어도 Java·React 코드 검사 실패는 최종 실패다", (t) => {
  const f = fixture(t, ["auth", "web-frontend"]);
  const plan = imagePlan(f.root, env);
  for (const job of ["java_ci", "react_ci"]) {
    const needs = needsFor(plan, successfulReport(plan));
    needs[job].result = "failure";
    assert.equal(finalCheck(f.root, needs).status, 1);
  }
});

test("워크플로는 PR 권한을 제한하고 main에서만 게시하며 선행 검사 생략을 구분한다", async (t) => {
  const workflow = readFileSync(
    new URL("../workflows/pr-ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /push:\s+branches: \[main\]/);
  assert.match(
    workflow,
    /needs: \[readiness, java_ci, react_ci, image_ci, image_publish\]/,
  );
  assert.equal((workflow.match(/packages: write/g) ?? []).length, 1);
  for (const id of ["image_ci", "image_publish"]) {
    const job = workflow.split("\n  " + id + ":")[1].split(/\n {2}(?=\S)/)[0];
    const expression = job.match(/if: \$\{\{([\s\S]+?)\}\}/)[1];
    if (id === "image_ci")
      assert.doesNotMatch(
        job,
        /GHCR_TOKEN|packages: write|image-ci.mjs publish/,
      );
    if (id === "image_publish") {
      assert.ok(
        job.indexOf("Verify all code checks before image publication") <
          job.indexOf("Build and scan all registered service images"),
      );
      assert.match(job, /CI_NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/);
      const publicationStep = job
        .split("- name: Publish the scanned images to GHCR")[1]
        .split("- name: Report image results")[0];
      assert.match(
        publicationStep,
        /GHCR_TOKEN: \$\{\{ secrets.GITHUB_TOKEN \}\}/,
      );
      assert.doesNotMatch(publicationStep, /if:/);
    }
    const cases = [
      ["pull_request", "success", "skipped", "0", id === "image_ci"],
      ["push", "success", "skipped", "0", id === "image_publish"],
      ["push", "failure", "skipped", "0", false],
      ["push", "cancelled", "skipped", "0", false],
      ["push", "success", "skipped", "1", false],
      ["push", "success", "success", "1", id === "image_publish"],
    ];
    for (const [event, java, react, nodeCount, expected] of cases) {
      await t.test(id + "/" + [event, java, react, nodeCount].join("/"), () => {
        const actual = runInNewContext(expression, {
          always: () => true,
          cancelled: () => false,
          github: { event_name: event, ref: "refs/heads/main" },
          needs: {
            readiness: {
              result: "success",
              outputs: {
                registered_count: "1",
                java_count: "1",
                node_count: nodeCount,
              },
            },
            java_ci: { result: java },
            react_ci: { result: react },
          },
        });
        assert.equal(actual, expected);
      });
    }
  }
});

test("저장소 내부를 가리키는 중간 디렉터리 링크도 컨텍스트 복사에서 차단한다", (t) => {
  const f = fixture(t, ["auth", "menu"]);
  symlinkSync(
    join(f.root, "services/menu"),
    join(f.root, "services/auth/alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const source = "services/auth/alias/gradlew";
  assert.throws(() =>
    prepareContext(
      f.root,
      imagePlan(f.root, env)[0],
      join(f.root, "context"),
      () => ({ status: 0, stdout: source + "\0" }),
    ),
  );
});

test("중간 게시 실패는 앞선 성공과 뒤의 미실행을 보존하고 최종 실패한다", (t) => {
  const f = fixture(t, ["auth", "menu", "order"]);
  const plan = imagePlan(f.root, env);
  const mock = commands(f);
  let pushes = 0;
  const execute = (command, args, options) => {
    if (command === "docker" && args[0] === "push" && ++pushes === 2)
      return { status: 1 };
    return mock.execute(command, args, options);
  };
  const report = publishImages(
    f.root,
    {
      ...env,
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_ACTOR: "lth1202",
      GHCR_TOKEN: "unit-test-token",
    },
    successfulReport(plan),
    execute,
  );
  assert.equal(report.failed, true);
  assert.deepEqual(
    report.results.map((result) => result.publish.status),
    ["success", "failure", "not_run"],
  );
  assert.equal(pushes, 2);
  const needs = needsFor(plan, report, "main");
  needs.image_publish.result = "failure";
  assert.equal(finalCheck(f.root, needs, "main").status, 1);
});

test("낮은 심각도와 빈 취약점 목록은 통과하며 잘못된 심각도는 실패한다", (t) => {
  const f = fixture(t);
  for (const vulnerabilities of [
    null,
    [],
    [{ Severity: "LOW" }],
    [{ Severity: "MEDIUM" }],
    [{ Severity: "UNKNOWN" }],
  ]) {
    assert.equal(
      checkImages(f.root, env, commands(f, { vulnerabilities }).execute).failed,
      false,
    );
  }
  assert.equal(
    checkImages(f.root, env, commands(f, { vulnerabilities: [{}] }).execute)
      .failed,
    true,
  );
});

test("실제 CLI는 Docker 준비 실패와 보고서 누락을 실패·미실행으로 기록한다", (t) => {
  const f = fixture(t);
  const checker = fileURLToPath(new URL("./image-ci.mjs", import.meta.url));
  const childEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== "path",
      ),
    ),
    ...env,
    PATH: join(f.root, "empty-path"),
    CI_IMAGE_REPORT: join(f.root, "images.json"),
    GITHUB_STEP_SUMMARY: join(f.root, "image-summary.md"),
    GITHUB_OUTPUT: join(f.root, "image-outputs.txt"),
  };
  const run = (mode) =>
    spawnSync(process.execPath, [checker, mode], {
      cwd: f.root,
      env: childEnv,
      encoding: "utf8",
    });
  const missing = run("report");
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /보고서 확인 불가/);
  assert.match(missing.stdout, /미실행/);
  assert.doesNotMatch(missing.stdout, /등록된 서비스 0개/);
  const check = run("check");
  assert.equal(check.status, 1);
  const report = JSON.parse(readFileSync(childEnv.CI_IMAGE_REPORT, "utf8"));
  assert.equal(report.failed, true);
  assert.match(report.error, /Docker 엔진 준비 실패/);
  assert.equal(report.results[0].build.status, "not_run");
  assert.equal(run("report").status, 1);
  assert.match(
    readFileSync(childEnv.GITHUB_STEP_SUMMARY, "utf8"),
    /Docker 엔진 준비 실패/,
  );
});
