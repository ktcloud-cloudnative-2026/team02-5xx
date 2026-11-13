import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { runServices, runCommand } from "./run-services.mjs";

const checker = fileURLToPath(new URL("./check-services.mjs", import.meta.url));
const finalChecker = fileURLToPath(
  new URL("./final-check.mjs", import.meta.url),
);

function write(root, path, content = "") {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content, "utf8");
}

function fixture(t, registry = { services: [] }) {
  const root = mkdtempSync(join(tmpdir(), "peakorder-ci-"));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.match(root, /peakorder-ci-[^\\/]+$/);
    rmSync(root, { recursive: true, force: true });
  });
  write(
    root,
    ".github/ci/services.json",
    typeof registry === "string" ? registry : JSON.stringify(registry),
  );
  return root;
}

function check(root) {
  return spawnSync(process.execPath, [checker, root], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: join(root, "readiness-summary.md"),
      GITHUB_OUTPUT: join(root, "outputs.txt"),
    },
  });
}

function readinessOutputs(root) {
  check(root);
  return Object.fromEntries(
    readFileSync(join(root, "outputs.txt"), "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function finalCheck(root, needs) {
  // Existing fixtures gain the two newly required service jobs.
  if (
    typeof needs === "object" &&
    needs?.readiness &&
    !needs.readiness.outputs
  ) {
    needs = {
      java_ci: { result: "skipped" },
      react_ci: { result: "skipped" },
      ...needs,
      readiness: { ...needs.readiness, outputs: readinessOutputs(root) },
    };
  }
  return spawnSync(process.execPath, [finalChecker, root], {
    encoding: "utf8",
    env: {
      ...process.env,
      CI_NEEDS_JSON: typeof needs === "string" ? needs : JSON.stringify(needs),
      GITHUB_STEP_SUMMARY: join(root, "final-summary.md"),
    },
  });
}

function javaFiles(root, servicePath, extension = "gradle.kts") {
  for (const file of [
    "gradlew",
    "gradle/wrapper/gradle-wrapper.jar",
    "gradle/wrapper/gradle-wrapper.properties",
    `build.${extension}`,
    `settings.${extension}`,
  ]) {
    write(root, join(servicePath, file));
  }
}

test("등록 0개: 7개 미등록 상태와 빌드·테스트 미실행을 요약한다", (t) => {
  const root = fixture(t);
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /등록 0개 \/ 필수 파일 준비 0개/);
  assert.equal(result.stdout.match(/미구현·미등록/g).length, 7);
  assert.match(result.stdout, /서비스 빌드 — 미실행/);
  assert.match(result.stdout, /서비스 테스트 — 미실행/);
  assert.equal(
    readFileSync(join(root, "readiness-summary.md"), "utf8"),
    result.stdout.trimEnd() + "\n",
  );
  assert.match(
    readFileSync(join(root, "outputs.txt"), "utf8"),
    /ready_services=\[\]/,
  );
});

test("등록된 Java 서비스의 필수 파일 누락은 실패한다", (t) => {
  const root = fixture(t, {
    services: [{ id: "auth", path: "services/auth" }],
  });
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /설정 오류/);
  assert.match(result.stdout, /gradlew/);
  assert.match(result.stdout, /gradle-wrapper.jar/);
  assert.match(
    readFileSync(join(root, "outputs.txt"), "utf8"),
    /ready_services=\[\]/,
  );
});

test("Gradle Kotlin DSL과 Groovy DSL의 필수 파일 준비를 검사한다", async (t) => {
  for (const extension of ["gradle.kts", "gradle"]) {
    await t.test(extension, (t) => {
      const root = fixture(t, {
        services: [{ id: "auth", path: "services/auth" }],
      });
      javaFiles(root, "services/auth", extension);
      const result = check(root);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /등록 1개 \/ 필수 파일 준비 1개/);
      assert.match(result.stdout, /서비스 테스트 — 미실행/);
      assert.match(
        readFileSync(join(root, "outputs.txt"), "utf8"),
        /"kind":"java"/,
      );
    });
  }
});

test("프론트엔드 필수 파일이 준비되면 파일 검사만 통과한다", (t) => {
  const root = fixture(t, {
    services: [{ id: "web-frontend", path: "frontend" }],
  });
  write(root, "frontend/package.json", "{}");
  write(root, "frontend/package-lock.json", "{}");
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /등록 1개 \/ 필수 파일 준비 1개/);
  assert.match(result.stdout, /서비스 빌드 — 미실행/);
  assert.match(
    readFileSync(join(root, "outputs.txt"), "utf8"),
    /"kind":"node"/,
  );
});

test("프론트엔드 잠금 파일이 없으면 실패한다", (t) => {
  const root = fixture(t, {
    services: [{ id: "web-frontend", path: "frontend" }],
  });
  write(root, "frontend/package.json", "{}");
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /package-lock.json/);
});

test("등록하지 않은 폴더는 자동으로 준비 완료 처리하지 않는다", (t) => {
  const root = fixture(t);
  javaFiles(root, "services/auth");
  const result = check(root);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /등록 0개/);
  assert.equal(result.stdout.match(/미구현·미등록/g).length, 7);
});

test("손상되거나 누락된 등록 파일은 등록 0개로 처리하지 않는다", (t) => {
  const root = fixture(t, "{");
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /등록 정보 검사 실패/);
  assert.doesNotMatch(result.stdout, /등록 0개/);
  assert.equal(existsSync(join(root, "outputs.txt")), false);

  const missingRoot = fixture(t);
  unlinkSync(join(missingRoot, ".github/ci/services.json"));
  const missing = check(missingRoot);
  assert.equal(missing.status, 1);
});

test("잘못된 등록 스키마·서비스 ID·중복 등록은 실패한다", async (t) => {
  const invalidRegistries = [
    {},
    { service: [] },
    { services: null },
    { services: [], extra: true },
    { services: [null] },
    { services: [{ id: "unknown", path: "services/unknown" }] },
    { services: [{ id: "auth" }] },
    { services: [{ id: "auth", path: "services/auth", typo: true }] },
    {
      services: [
        { id: "auth", path: "a" },
        { id: "auth", path: "b" },
      ],
    },
    {
      services: [
        { id: "auth", path: "a" },
        { id: "menu", path: "a" },
      ],
    },
  ];
  for (const [index, registry] of invalidRegistries.entries()) {
    await t.test(String(index + 1), (t) => {
      assert.equal(check(fixture(t, registry)).status, 1);
    });
  }
});

test("절대 경로·상위 경로·빈 경로는 실패한다", async (t) => {
  for (const path of [
    "",
    "../outside",
    "/outside",
    "C:/outside",
    "services/../auth",
    "services//auth",
    ".",
  ]) {
    await t.test(path || "empty", (t) => {
      const root = fixture(t, { services: [{ id: "auth", path }] });
      assert.equal(check(root).status, 1);
    });
  }
});

test("필수 파일 위치에 디렉터리가 있으면 실패한다", (t) => {
  const root = fixture(t, {
    services: [{ id: "web-frontend", path: "frontend" }],
  });
  mkdirSync(join(root, "frontend/package.json"), { recursive: true });
  write(root, "frontend/package-lock.json", "{}");
  assert.equal(check(root).status, 1);
});

test("저장소 외부로 연결된 서비스 경로는 실패한다", (t) => {
  const root = fixture(t, {
    services: [{ id: "auth", path: "services/auth" }],
  });
  const outside = fixture(t);
  javaFiles(outside, ".");
  mkdirSync(join(root, "services"));
  symlinkSync(
    outside,
    join(root, "services/auth"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(check(root).status, 1);
});

test("최종 검사는 필수 선행 작업이 성공했을 때 통과한다", (t) => {
  const root = fixture(t);
  const result = finalCheck(root, { readiness: { result: "success" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /공통 PR CI 기반 검사 통과/);
  assert.match(result.stdout, /서비스 테스트 — 미실행/);
  assert.equal(
    readFileSync(join(root, "final-summary.md"), "utf8"),
    result.stdout.trimEnd() + "\n",
  );
});

test("필수 선행 작업의 실패·취소·건너뛰기는 최종 실패로 반영된다", async (t) => {
  for (const result of ["failure", "cancelled", "skipped"]) {
    await t.test(result, (t) => {
      const root = fixture(t);
      assert.equal(finalCheck(root, { readiness: { result } }).status, 1);
    });
  }
});

test("후속 서비스 작업을 needs에 연결하면 그 실패도 최종 검사에 반영된다", (t) => {
  const root = fixture(t);
  const result = finalCheck(root, {
    readiness: { result: "success" },
    java_ci: { result: "failure" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\| java_ci \| failure \|/);
});

test("선행 작업 결과가 비었거나 잘못되면 최종 검사는 실패한다", async (t) => {
  for (const needs of [
    "",
    "{",
    "{}",
    "null",
    "[]",
    '{"other":{"result":"success"}}',
    '{"readiness":{"result":"unknown"}}',
  ]) {
    await t.test(needs || "empty", (t) => {
      const root = fixture(t);
      assert.equal(finalCheck(root, needs).status, 1);
    });
  }
});

test("실제 파일 검사 실패의 종료 코드가 최종 실패로 이어진다", (t) => {
  const root = fixture(t, {
    services: [{ id: "auth", path: "services/auth" }],
  });
  const readiness = check(root);
  assert.equal(readiness.status, 1);
  const result = finalCheck(root, {
    readiness: { result: readiness.status === 0 ? "success" : "failure" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /공통 PR CI 기반 검사 실패/);
});

test("저장소 외부 등록 파일은 읽기 전에 차단한다", (t) => {
  const root = fixture(t);
  const outside = fixture(t);
  unlinkSync(join(root, ".github/ci/services.json"));
  rmdirSync(join(root, ".github/ci"));
  symlinkSync(
    join(outside, ".github/ci"),
    join(root, ".github/ci"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /등록 파일은 저장소 내부의 일반 파일/);
  assert.doesNotMatch(result.stdout, /등록 0개/);
  assert.equal(existsSync(join(root, "outputs.txt")), false);
});

test("등록 파일 위치가 디렉터리이면 읽기 전에 실패한다", (t) => {
  const root = fixture(t);
  unlinkSync(join(root, ".github/ci/services.json"));
  mkdirSync(join(root, ".github/ci/services.json"));
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /등록 파일은 저장소 내부의 일반 파일/);
});

test("저장소 내부 등록 파일을 가리키는 링크는 허용한다", (t) => {
  const root = fixture(t);
  write(root, "config/ci/services.json", '{"services":[]}');
  unlinkSync(join(root, ".github/ci/services.json"));
  rmdirSync(join(root, ".github/ci"));
  symlinkSync(
    join(root, "config/ci"),
    join(root, ".github/ci"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /등록 0개 \/ 필수 파일 준비 0개/);
});

test("서로 다른 등록 경로의 실제 디렉터리가 같으면 실패한다", (t) => {
  const root = fixture(t, {
    services: [
      { id: "auth", path: "services/auth" },
      { id: "menu", path: "services/menu" },
    ],
  });
  javaFiles(root, "services/auth");
  symlinkSync(
    join(root, "services/auth"),
    join(root, "services/menu"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /실제 서비스 디렉터리를 중복 등록/);
  assert.equal(existsSync(join(root, "outputs.txt")), false);
});

test("서로 다른 실제 서비스 디렉터리는 정상 등록한다", (t) => {
  const root = fixture(t, {
    services: [
      { id: "auth", path: "services/auth" },
      { id: "menu", path: "services/menu" },
    ],
  });
  javaFiles(root, "services/auth");
  javaFiles(root, "services/menu");
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /등록 2개 \/ 필수 파일 준비 2개/);
});

test("워크플로 준비 검사 조건은 환경 준비 결과와 취소 상태를 반영한다", async (t) => {
  const workflow = readFileSync(
    new URL("../workflows/pr-ci.yml", import.meta.url),
    "utf8",
  );
  const readinessJob = workflow.split("\n  final:")[0];
  assert.match(readinessJob, /name: Checkout PR\s+id: checkout/);
  assert.match(readinessJob, /name: Set up Node.js 24\s+id: node/);
  const condition = readinessJob.match(
    /id: services\s+if: \$\{\{([\s\S]+?)\}\}/,
  )?.[1];
  assert.ok(condition, "서비스 준비 검사 조건이 있어야 합니다");
  assert.match(condition, /!cancelled\(\)/);

  const scenarios = [
    {
      name: "checkout 실패",
      checkout: "failure",
      node: "skipped",
      cancelled: false,
      expected: false,
    },
    {
      name: "Node 준비 실패",
      checkout: "success",
      node: "failure",
      cancelled: false,
      expected: false,
    },
    {
      name: "Node 준비 건너뛰기",
      checkout: "success",
      node: "skipped",
      cancelled: false,
      expected: false,
    },
    {
      name: "취소됨",
      checkout: "success",
      node: "success",
      cancelled: true,
      expected: false,
    },
    {
      name: "자체 테스트 실패 후 환경 준비 성공 상태",
      checkout: "success",
      node: "success",
      cancelled: false,
      expected: true,
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const actual = runInNewContext(condition, {
        cancelled: () => scenario.cancelled,
        steps: {
          checkout: { outcome: scenario.checkout },
          node: { outcome: scenario.node },
        },
      });
      assert.equal(actual, scenario.expected);
    });
  }
});

test("대소문자가 다른 경로도 같은 실제 디렉터리이면 실패한다", (t) => {
  const root = fixture(t, {
    services: [
      { id: "auth", path: "services/auth" },
      { id: "menu", path: "services/AUTH" },
    ],
  });
  javaFiles(root, "services/auth");
  const alias = join(root, "services/AUTH");
  if (!existsSync(alias)) {
    symlinkSync(
      join(root, "services/auth"),
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /실제 서비스 디렉터리를 중복 등록/);
});

function serviceFixture(t, kinds = []) {
  const services = [];
  if (kinds.includes("java"))
    services.push({ id: "auth", path: "services/auth" });
  if (kinds.includes("node"))
    services.push({ id: "web-frontend", path: "frontend" });
  const root = fixture(t, { services });
  if (kinds.includes("java")) javaFiles(root, "services/auth");
  if (kinds.includes("node")) {
    write(
      root,
      "frontend/package.json",
      JSON.stringify({
        scripts: { "format:check": "prettier . --check", build: "vite build" },
      }),
    );
    write(root, "frontend/package-lock.json", "{}");
  }
  return root;
}

function successfulCommand(command, args) {
  return {
    status: 0,
    stdout:
      command === "sh"
        ? (args.at(-1) === "spotlessCheck"
            ? "> Task :spotlessJavaCheck\n"
            : "") +
          "> Task :" +
          args.at(-1) +
          "\nBUILD SUCCESSFUL\n"
        : "",
    stderr: "",
  };
}

function serviceNeeds(root) {
  const outputs = readinessOutputs(root);
  const needs = { readiness: { result: "success", outputs } };
  for (const [kind, id] of [
    ["java", "java_ci"],
    ["node", "react_ci"],
  ]) {
    const report = runServices(root, kind, successfulCommand);
    needs[id] = {
      result:
        report.results.length === 0
          ? "skipped"
          : report.failed
            ? "failure"
            : "success",
      outputs: { service_results: JSON.stringify(report.results) },
    };
  }
  return needs;
}

test("서비스 종류 조합별 선택과 최종 집계", async (t) => {
  for (const kinds of [[], ["java"], ["node"], ["java", "node"]]) {
    await t.test(kinds.join("+") || "등록 0개", (t) => {
      const root = serviceFixture(t, kinds);
      const needs = serviceNeeds(root);
      assert.equal(
        needs.readiness.outputs.java_count,
        kinds.includes("java") ? "1" : "0",
      );
      assert.equal(
        needs.readiness.outputs.node_count,
        kinds.includes("node") ? "1" : "0",
      );
      const final = finalCheck(root, needs);
      assert.equal(final.status, 0, final.stdout + final.stderr);
      assert.match(final.stdout, /검사 통과/);
      if (kinds.length === 0) {
        assert.match(final.stdout, /\| java_ci \| skipped \| 정상 생략/);
        assert.match(final.stdout, /\| react_ci \| skipped \| 정상 생략/);
        assert.match(final.stdout, /서비스 빌드 — 미실행/);
        assert.equal(
          final.stdout.match(
            /^\| (auth|menu|inventory|order|payment|cooking|web-frontend) \|/gm,
          ).length,
          7,
        );
      }
      if (kinds.includes("node"))
        assert.match(final.stdout, /프론트엔드 테스트 단계 미설정/);
    });
  }
});

test("서비스 실행기는 Wrapper와 npm 명령 및 실제 서비스 경로를 사용한다", (t) => {
  const root = serviceFixture(t, ["java", "node"]);
  write(
    root,
    "services/auth/gradle/wrapper/gradle-wrapper.properties",
    "service-owned-version",
  );
  const calls = [];
  const execute = (command, args, cwd) => {
    calls.push({ command, args, cwd });
    return successfulCommand(command, args);
  };
  assert.equal(runServices(root, "java", execute).failed, false);
  assert.equal(runServices(root, "node", execute).failed, false);
  assert.deepEqual(
    calls.slice(0, 3).map((call) => [call.command, call.args]),
    [
      ["sh", ["./gradlew", "--no-daemon", "--console=plain", "spotlessCheck"]],
      ["sh", ["./gradlew", "--no-daemon", "--console=plain", "test"]],
      ["sh", ["./gradlew", "--no-daemon", "--console=plain", "build"]],
    ],
  );
  assert.deepEqual(
    calls.slice(3).map((call) => [call.command, call.args]),
    [
      ["npm", ["ci"]],
      ["npm", ["run", "format:check"]],
      ["npm", ["run", "build"]],
    ],
  );
  assert.ok(
    calls.slice(0, 3).every((call) => call.cwd === join(root, "services/auth")),
  );
  assert.ok(
    calls.slice(3).every((call) => call.cwd === join(root, "frontend")),
  );
  assert.equal(
    readFileSync(
      join(root, "services/auth/gradle/wrapper/gradle-wrapper.properties"),
      "utf8",
    ),
    "service-owned-version",
  );
});

test("등록 0개 실행기는 외부 명령을 호출하지 않고 미실행을 출력한다", (t) => {
  const root = serviceFixture(t);
  const report = runServices(root, "java", () =>
    assert.fail("No command expected"),
  );
  assert.deepEqual(report, { results: [], failed: false });
  const outcome = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./run-services.mjs", import.meta.url)),
      "java",
      root,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: join(root, "runner-output.txt"),
        GITHUB_STEP_SUMMARY: join(root, "runner-summary.md"),
      },
    },
  );
  assert.equal(outcome.status, 0, outcome.stderr);
  assert.match(outcome.stdout, /대상 없음·미실행/);
  assert.equal(
    readFileSync(join(root, "runner-output.txt"), "utf8"),
    "service_results=[]\n",
  );
  assert.equal(
    readFileSync(join(root, "runner-summary.md"), "utf8"),
    outcome.stdout.trimEnd() + "\n",
  );
});

test("실행 직전에도 필수 파일 누락을 차단한다", (t) => {
  const root = serviceFixture(t, ["java"]);
  unlinkSync(join(root, "services/auth/gradlew"));
  const report = runServices(root, "java", () =>
    assert.fail("No command expected"),
  );
  assert.equal(report.failed, true);
  assert.match(report.results[0].setup.reason, /설정 오류/);
  assert.equal(report.results[0].build.status, "not_run");
});

test("npm 필수 스크립트 누락·빈 값·잘못된 JSON을 설정 오류로 처리한다", async (t) => {
  for (const manifest of [
    "{}",
    '{"scripts":{"build":"vite build"}}',
    '{"scripts":{"format:check":"prettier . --check"}}',
    '{"scripts":{"format:check":" ","build":"vite build"}}',
    "{",
  ]) {
    await t.test(manifest, (t) => {
      const root = serviceFixture(t, ["node"]);
      write(root, "frontend/package.json", manifest);
      const report = runServices(root, "node", () =>
        assert.fail("No command expected"),
      );
      assert.equal(report.failed, true);
      assert.equal(report.results[0].setup.status, "failure");
      assert.equal(report.results[0].install.status, "not_run");
    });
  }
});

test("필수 Gradle 작업 누락은 설정 오류와 최종 실패로 표시한다", (t) => {
  const root = serviceFixture(t, ["java"]);
  const report = runServices(root, "java", () => ({
    status: 1,
    stdout: "",
    stderr: "Task 'spotlessCheck' not found in root project",
  }));
  assert.equal(report.failed, true);
  assert.match(report.results[0].format.reason, /설정 오류/);
  const needs = serviceNeeds(root);
  needs.java_ci = {
    result: "failure",
    outputs: { service_results: JSON.stringify(report.results) },
  };
  const final = finalCheck(root, needs);
  assert.equal(final.status, 1);
  assert.match(final.stdout, /설정 오류/);
});

test("설치·포맷·테스트·빌드 실패와 이후 단계 미실행을 전파한다", async (t) => {
  const cases = [
    ["java", "spotlessCheck", "format"],
    ["java", "test", "test"],
    ["java", "build", "build"],
    ["node", "ci", "install"],
    ["node", "format:check", "format"],
    ["node", "build", "build"],
  ];
  for (const [kind, task, step] of cases) {
    await t.test(kind + "/" + task, (t) => {
      const root = serviceFixture(t, [kind]);
      const calls = [];
      const report = runServices(root, kind, (command, args) => {
        calls.push(args.at(-1));
        return args.at(-1) === task
          ? { status: 1, stdout: "", stderr: "intentional failure" }
          : successfulCommand(command, args);
      });
      assert.equal(report.failed, true);
      assert.equal(report.results[0][step].status, "failure");
      assert.equal(calls.at(-1), task);
      const needs = serviceNeeds(root);
      needs[kind === "java" ? "java_ci" : "react_ci"] = {
        result: "failure",
        outputs: { service_results: JSON.stringify(report.results) },
      };
      const final = finalCheck(root, needs);
      assert.equal(final.status, 1);
      assert.match(final.stdout, /검사 실패/);
    });
  }
});

test("Gradle NO-SOURCE·SKIPPED와 기존 결과 재사용을 구분한다", async (t) => {
  for (const state of ["NO-SOURCE", "SKIPPED", "UP-TO-DATE", "FROM-CACHE"]) {
    await t.test(state, (t) => {
      const root = serviceFixture(t, ["java"]);
      const report = runServices(root, "java", (command, args) =>
        args.at(-1) === "test"
          ? { status: 0, stdout: "> Task :test " + state + "\n", stderr: "" }
          : successfulCommand(command, args),
      );
      const notRun = ["NO-SOURCE", "SKIPPED"].includes(state);
      assert.equal(report.failed, notRun);
      assert.equal(
        report.results[0].test.status,
        notRun ? "not_run" : "reused",
      );
      if (notRun) assert.equal(report.results[0].build.status, "not_run");
    });
  }
});

test("프로세스 실행 오류·시그널·타임아웃을 실패로 처리한다", async (t) => {
  for (const outcome of [
    { status: null, error: new Error("ENOENT") },
    { status: null, signal: "SIGTERM" },
    { status: null, error: new Error("ETIMEDOUT") },
  ]) {
    await t.test(outcome.error?.message ?? outcome.signal, (t) => {
      const root = serviceFixture(t, ["java"]);
      const report = runServices(root, "java", () => outcome);
      assert.equal(report.failed, true);
      assert.equal(report.results[0].format.status, "failure");
    });
  }
});

test("한 Java 서비스 실패 후에도 다른 등록 서비스의 결과를 수집한다", (t) => {
  const root = serviceFixture(t, ["java"]);
  write(
    root,
    ".github/ci/services.json",
    JSON.stringify({
      services: [
        { id: "auth", path: "services/auth" },
        { id: "menu", path: "services/menu" },
      ],
    }),
  );
  javaFiles(root, "services/menu");
  const report = runServices(root, "java", (command, args, cwd) =>
    cwd === join(root, "services/auth")
      ? { status: 1, stdout: "", stderr: "" }
      : successfulCommand(command, args),
  );
  assert.equal(report.failed, true);
  assert.equal(report.results.length, 2);
  assert.equal(report.results[0].format.status, "failure");
  assert.equal(report.results[1].build.status, "success");
});

test("선행 작업 실패·취소와 등록 대상의 비정상 생략은 최종 실패다", async (t) => {
  for (const job of ["readiness", "java_ci", "react_ci"]) {
    for (const state of ["failure", "cancelled", "skipped"]) {
      await t.test(job + "/" + state, (t) => {
        const root = serviceFixture(t, ["java", "node"]);
        const needs = serviceNeeds(root);
        needs[job].result = state;
        assert.equal(finalCheck(root, needs).status, 1);
      });
    }
  }
});

test("최종 집계에서 결과 누락·변조·미실행을 성공으로 인정하지 않는다", async (t) => {
  const mutations = [
    (needs) => {
      delete needs.java_ci;
    },
    (needs) => {
      delete needs.java_ci.outputs;
    },
    (needs) => {
      needs.java_ci.outputs.service_results = "{";
    },
    (needs) => {
      needs.java_ci.outputs.service_results = "[]";
    },
    (needs) => {
      needs.java_ci.outputs.service_results = "null";
    },
    (needs) => {
      needs.readiness.outputs.ready_services = "[]";
    },
    (needs) => {
      needs.readiness.outputs.java_count = "0";
    },
    (needs) => {
      needs.readiness.outputs.registered_count = "0";
    },
    (needs) => {
      const report = JSON.parse(needs.java_ci.outputs.service_results);
      report[0].id = "menu";
      needs.java_ci.outputs.service_results = JSON.stringify(report);
    },
    (needs) => {
      const report = JSON.parse(needs.java_ci.outputs.service_results);
      report[0].path = "../outside";
      needs.java_ci.outputs.service_results = JSON.stringify(report);
    },
    (needs) => {
      const report = JSON.parse(needs.java_ci.outputs.service_results);
      report[0].test.status = "not_run";
      needs.java_ci.outputs.service_results = JSON.stringify(report);
    },
    (needs) => {
      const report = JSON.parse(needs.java_ci.outputs.service_results);
      report[0].build.status = "failure";
      needs.java_ci.outputs.service_results = JSON.stringify(report);
    },
    (needs) => {
      const report = JSON.parse(needs.java_ci.outputs.service_results);
      report[0].format.status = "typo";
      needs.java_ci.outputs.service_results = JSON.stringify(report);
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    await t.test(String(index + 1), (t) => {
      const root = serviceFixture(t, ["java"]);
      const needs = serviceNeeds(root);
      mutate(needs);
      assert.equal(finalCheck(root, needs).status, 1);
    });
  }
});

test("대상 0개 종류의 실제 작업 실행을 정상 생략으로 오인하지 않는다", (t) => {
  const root = serviceFixture(t);
  const needs = serviceNeeds(root);
  needs.java_ci = { result: "success", outputs: { service_results: "[]" } };
  assert.equal(finalCheck(root, needs).status, 1);
});

test("실행기에서도 외부 등록 파일과 서비스 경로를 차단한다", (t) => {
  const root = serviceFixture(t, ["java"]);
  const outside = serviceFixture(t, ["java"]);
  unlinkSync(join(root, ".github/ci/services.json"));
  rmdirSync(join(root, ".github/ci"));
  symlinkSync(
    join(outside, ".github/ci"),
    join(root, ".github/ci"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => runServices(root, "java", () => assert.fail("No command expected")),
    /저장소 내부의 일반 파일/,
  );
});

test("실제 자식 프로세스의 종료 코드와 출력을 보존한다", (t) => {
  const root = fixture(t);
  const success = runCommand(
    process.execPath,
    ["-e", 'process.stdout.write("child-ok")'],
    root,
  );
  assert.equal(success.status, 0);
  assert.equal(success.stdout, "child-ok");
  const failure = runCommand(process.execPath, ["-e", "process.exit(3)"], root);
  assert.equal(failure.status, 3);
});

test("워크플로의 서비스 조건과 최종 의존성을 검증한다", async (t) => {
  const workflow = readFileSync(
    new URL("../workflows/pr-ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /needs: \[readiness, java_ci, react_ci\]/);
  assert.match(workflow, /JAVA_HOME_21_X64/);
  assert.match(workflow, /java\.specification\.version = 21/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  for (const [id, countName] of [
    ["java_ci", "java_count"],
    ["react_ci", "node_count"],
  ]) {
    const job = workflow.split("\n  " + id + ":")[1].split(/\n {2}(?=\S)/)[0];
    const expression = job.match(/if: \$\{\{([\s\S]+?)\}\}/)?.[1];
    assert.ok(expression, id);
    for (const [state, count, expected] of [
      ["success", "0", false],
      ["success", "1", true],
      ["success", "", false],
      ["failure", "1", false],
      ["cancelled", "1", false],
    ]) {
      await t.test(id + "/" + state + "/" + count, () => {
        const actual = runInNewContext(expression, {
          needs: {
            readiness: { result: state, outputs: { [countName]: count } },
          },
        });
        assert.equal(actual, expected);
      });
    }
  }
});
test("Gradle 테스트 실행 기록이 없으면 확인 불가와 최종 실패로 표시한다", (t) => {
  const root = serviceFixture(t, ["java"]);
  const report = runServices(root, "java", (command, args) =>
    args.at(-1) === "test"
      ? { status: 0, stdout: "BUILD SUCCESSFUL\n", stderr: "" }
      : successfulCommand(command, args),
  );
  assert.equal(report.failed, true);
  assert.equal(report.results[0].test.status, "unknown");
  const needs = serviceNeeds(root);
  needs.java_ci = {
    result: "success",
    outputs: { service_results: JSON.stringify(report.results) },
  };
  assert.equal(finalCheck(root, needs).status, 1);
});

test("두 Java 서비스의 결과에서 같은 서비스 중복 보고를 차단한다", (t) => {
  const root = serviceFixture(t, ["java"]);
  write(
    root,
    ".github/ci/services.json",
    JSON.stringify({
      services: [
        { id: "auth", path: "services/auth" },
        { id: "menu", path: "services/menu" },
      ],
    }),
  );
  javaFiles(root, "services/menu");
  const needs = serviceNeeds(root);
  const report = JSON.parse(needs.java_ci.outputs.service_results);
  needs.java_ci.outputs.service_results = JSON.stringify([
    report[0],
    report[0],
  ]);
  assert.equal(finalCheck(root, needs).status, 1);
});

test("실행기에서 중복 실제 디렉터리와 외부 서비스 경로도 재검증한다", (t) => {
  const root = serviceFixture(t, ["java"]);
  write(
    root,
    ".github/ci/services.json",
    JSON.stringify({
      services: [
        { id: "auth", path: "services/auth" },
        { id: "menu", path: "services/menu" },
      ],
    }),
  );
  symlinkSync(
    join(root, "services/auth"),
    join(root, "services/menu"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => runServices(root, "java", () => assert.fail("No command expected")),
    /실제 서비스 디렉터리를 중복 등록/,
  );
  const outside = fixture(t);
  javaFiles(outside, ".");
  const externalRoot = fixture(t, {
    services: [{ id: "auth", path: "services/external" }],
  });
  mkdirSync(join(externalRoot, "services"));
  symlinkSync(
    outside,
    join(externalRoot, "services/external"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const report = runServices(externalRoot, "java", () =>
    assert.fail("No command expected"),
  );
  assert.equal(report.failed, true);
});

test("정상 생략은 준비 검사 출력이 일치할 때만 허용한다", async (t) => {
  for (const change of [
    (needs) => {
      delete needs.readiness.outputs.ready_services;
    },
    (needs) => {
      needs.readiness.outputs.ready_services = "[";
    },
    (needs) => {
      needs.readiness.outputs.node_count = "1";
    },
    (needs) => {
      needs.react_ci.result = "cancelled";
    },
    (needs) => {
      delete needs.react_ci;
    },
  ]) {
    await t.test(String(change), (t) => {
      const root = serviceFixture(t);
      const needs = serviceNeeds(root);
      change(needs);
      assert.equal(finalCheck(root, needs).status, 1);
    });
  }
});

test("Spotless 집계와 실제 하위 검사 결과를 구분한다", async (t) => {
  const cases = [
    [
      "실제 검사 성공",
      0,
      "> Task :spotlessJavaCheck\n> Task :spotlessCheck UP-TO-DATE\n",
      "success",
      false,
    ],
    [
      "실제 검사 실패",
      1,
      "> Task :spotlessJavaCheck FAILED\n",
      "failure",
      true,
    ],
    [
      "실제 검사 모두 생략",
      0,
      "> Task :spotlessJavaCheck SKIPPED\n> Task :spotlessCheck UP-TO-DATE\n",
      "not_run",
      true,
    ],
    [
      "실제 검사 소스 없음",
      0,
      "> Task :spotlessJavaCheck NO-SOURCE\n> Task :spotlessCheck\n",
      "not_run",
      true,
    ],
    [
      "집계 작업만 있음",
      0,
      "> Task :spotlessCheck UP-TO-DATE\n",
      "unknown",
      true,
    ],
    [
      "하위 모듈 검사",
      0,
      "> Task :app:spotlessJavaCheck\n> Task :app:spotlessCheck\n> Task :spotlessCheck\n",
      "success",
      false,
    ],
    [
      "실제 검사 결과 재사용",
      0,
      "> Task :spotlessJavaCheck UP-TO-DATE\n> Task :spotlessCheck\n",
      "reused",
      false,
    ],
    [
      "여러 실제 검사 모두 생략",
      0,
      "> Task :spotlessJavaCheck SKIPPED\n> Task :spotlessGroovyGradleCheck SKIPPED\n> Task :spotlessCheck\n",
      "not_run",
      true,
    ],
  ];
  for (const [name, status, stdout, expectedStatus, failed] of cases) {
    await t.test(name, (t) => {
      const root = serviceFixture(t, ["java"]);
      const report = runServices(root, "java", (command, args) =>
        args.at(-1) === "spotlessCheck"
          ? { status, stdout, stderr: "" }
          : successfulCommand(command, args),
      );
      assert.equal(report.results[0].format.status, expectedStatus);
      assert.equal(report.failed, failed);
      const needs = serviceNeeds(root);
      needs.java_ci = {
        result: failed ? "failure" : "success",
        outputs: { service_results: JSON.stringify(report.results) },
      };
      assert.equal(finalCheck(root, needs).status, failed ? 1 : 0);
    });
  }
});

test("등록된 서비스의 필수 검사가 전부 미실행이면 성공 작업 결과도 최종 실패다", async (t) => {
  for (const kinds of [["java"], ["node"], ["java", "node"]]) {
    await t.test(kinds.join("+"), (t) => {
      const root = serviceFixture(t, kinds);
      const needs = serviceNeeds(root);
      for (const id of ["java_ci", "react_ci"]) {
        if (needs[id].result === "skipped") continue;
        const report = JSON.parse(needs[id].outputs.service_results);
        for (const result of report) {
          for (const step of ["install", "format", "test", "build"]) {
            result[step] = {
              status: "not_run",
              reason: "회귀 검증 — 필수 검사 전체 생략",
            };
          }
        }
        needs[id].outputs.service_results = JSON.stringify(report);
      }
      const final = finalCheck(root, needs);
      assert.equal(final.status, 1);
      assert.match(final.stdout, /필수 검사 전체 생략/);
      assert.match(final.stdout, /검사 실패/);
    });
  }
});

test("등록된 종류의 작업이 모두 skipped면 최종 검사는 실패한다", async (t) => {
  for (const kinds of [["java"], ["node"], ["java", "node"]]) {
    await t.test(kinds.join("+"), (t) => {
      const root = serviceFixture(t, kinds);
      const needs = serviceNeeds(root);
      for (const [kind, id] of [
        ["java", "java_ci"],
        ["node", "react_ci"],
      ]) {
        if (!kinds.includes(kind)) continue;
        needs[id] = { result: "skipped", outputs: {} };
      }
      const final = finalCheck(root, needs);
      assert.equal(final.status, 1);
      assert.match(final.stdout, /검사 실패/);
      assert.match(final.stdout, /미실행/);
      for (const [kind, id] of [
        ["java", "java_ci"],
        ["node", "react_ci"],
      ]) {
        if (!kinds.includes(kind)) continue;
        assert.doesNotMatch(
          final.stdout,
          new RegExp("\\| " + id + " \\| skipped \\| 정상 생략"),
        );
      }
    });
  }
});
