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

function finalCheck(root, needs) {
  return spawnSync(process.execPath, [finalChecker], {
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
