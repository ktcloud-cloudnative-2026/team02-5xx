import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectServices, loadServices } from "./service-config.mjs";

const requiredSteps = {
  java: ["format", "test", "build"],
  node: ["install", "format", "build"],
};

function pending(reason) {
  return { status: "not_run", reason };
}

export function emptyResult(service, reason) {
  return {
    id: service.id,
    kind: service.kind,
    path: service.path,
    setup: pending(reason),
    install: pending(
      service.path !== null && service.kind === "java"
        ? "Gradle Wrapper로 의존성 관리"
        : reason,
    ),
    format: pending(reason),
    test: pending(
      service.path !== null && service.kind === "node"
        ? "프론트엔드 테스트 단계 미설정"
        : reason,
    ),
    build: pending(reason),
  };
}

export function requiredChecksPassed(result) {
  return (
    result.setup.status === "success" &&
    requiredSteps[result.kind].every((step) =>
      ["success", "reused"].includes(result[step].status),
    )
  );
}

export function runCommand(command, args, cwd) {
  console.log("> " + [command, ...args].join(" "));
  const outcome = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 20 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  return outcome;
}

function checkPackage(root, service) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, service.path, "package.json"), "utf8").replace(
      /^\uFEFF/,
      "",
    ),
  );
  for (const script of ["format:check", "build"]) {
    if (
      typeof manifest?.scripts?.[script] !== "string" ||
      manifest.scripts[script].trim() === ""
    ) {
      throw new Error("설정 오류 — package.json scripts." + script + " 누락");
    }
  }
}

function stepResult(outcome, task) {
  if (outcome.error || outcome.signal || outcome.status !== 0) {
    const output = (outcome.stdout ?? "") + (outcome.stderr ?? "");
    const missingTask =
      /Task ['"].+?['"] not found|Cannot locate tasks that match/.test(output);
    return {
      status: "failure",
      reason: missingTask
        ? "설정 오류 — 필수 Gradle 작업 누락"
        : "명령 실패 — " +
          (outcome.error?.message ?? outcome.signal ?? outcome.status),
    };
  }
  // Gradle can exit successfully without executing a required task.
  const taskName = task === "spotlessCheck" ? "spotless[^\\s:]*Check" : task;
  const taskLine = new RegExp(
    "^> Task (?::[^\\s:]+)*:(" + taskName + ")(?:[ \\t]+(\\S+))?[ \\t]*\\r?$",
    "gm",
  );
  const states = [...(outcome.stdout ?? "").matchAll(taskLine)]
    .filter((match) => task !== "spotlessCheck" || match[1] !== "spotlessCheck")
    .map((match) => match[2] ?? "EXECUTED");
  if (["test", "spotlessCheck"].includes(task) && states.length === 0) {
    return {
      status: "unknown",
      reason: "Gradle " + task + " 실제 검사 작업의 실행 기록 확인 불가",
    };
  }
  if (
    states.length > 0 &&
    states.every((state) => ["NO-SOURCE", "SKIPPED"].includes(state))
  ) {
    return {
      status: "not_run",
      reason: "Gradle " + task + " — " + states.join(", "),
    };
  }
  if (
    states.length > 0 &&
    states.every((state) => ["UP-TO-DATE", "FROM-CACHE"].includes(state))
  ) {
    return { status: "reused", reason: "Gradle 기존 검사 결과 재사용" };
  }
  return { status: "success", reason: "명령 정상 종료" };
}

export function runServices(root, kind, execute = runCommand) {
  if (!Object.hasOwn(requiredSteps, kind)) {
    throw new Error("서비스 종류는 java 또는 node여야 합니다.");
  }
  root = realpathSync(resolve(root));
  const rows = inspectServices(root, loadServices(root));
  const selected = rows.filter((row) => row.path !== null && row.kind === kind);
  const results = selected.map((service) =>
    emptyResult(service, "앞선 검사 실패 또는 검사 시작 전"),
  );
  if (rows.some((row) => row.status === "설정 오류")) {
    for (const result of results) {
      result.setup = {
        status: "failure",
        reason: "설정 오류 — 필수 파일 누락 또는 외부 경로",
      };
    }
    return { results, failed: true };
  }

  for (const result of results) {
    try {
      if (kind === "node") checkPackage(root, result);
      result.setup = {
        status: "success",
        reason:
          kind === "java"
            ? "필수 파일 준비됨"
            : "필수 파일·npm 스크립트 준비됨",
      };
      const steps =
        kind === "java"
          ? [
              ["format", "spotlessCheck"],
              ["test", "test"],
              ["build", "build"],
            ]
          : [
              ["install", "ci"],
              ["format", "format:check"],
              ["build", "build"],
            ];
      for (const [step, task] of steps) {
        const command = kind === "java" ? "sh" : "npm";
        const args =
          kind === "java"
            ? ["./gradlew", "--no-daemon", "--console=plain", task]
            : task === "ci"
              ? ["ci"]
              : ["run", task];
        const outcome = execute(command, args, resolve(root, result.path));
        result[step] = stepResult(outcome, task);
        if (!["success", "reused"].includes(result[step].status)) break;
      }
    } catch (cause) {
      result.setup = { status: "failure", reason: cause.message };
    }
  }
  return {
    results,
    failed: results.some((result) => !requiredChecksPassed(result)),
  };
}

const statusLabels = {
  success: "성공",
  failure: "실패",
  not_run: "미실행",
  reused: "기존 결과 재사용",
  unknown: "확인 불가",
};

export function formatServiceResults(results) {
  const cell = (value) =>
    String(value)
      .replaceAll("|", "\\|")
      .replace(/[\r\n]+/g, " ");
  const lines = [
    "| 서비스 | 준비 | 의존성 설치 | 포맷 | 테스트 | 빌드 | 사유 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const result of results) {
    const steps = ["setup", "install", "format", "test", "build"];
    const labels = steps.map((step) => statusLabels[result[step].status]);
    const reasons = [
      ...new Set(
        steps
          .filter((step) => result[step].status !== "success")
          .map((step) => result[step].reason),
      ),
    ];
    lines.push(
      "| " +
        [result.id, ...labels, reasons.join(" / ") || "필수 검사 완료"]
          .map(cell)
          .join(" | ") +
        " |",
    );
  }
  return lines.join("\n");
}

function main() {
  let results = [];
  let error = "";
  let failed = true;
  try {
    ({ results, failed } = runServices(
      process.argv[3] ?? process.cwd(),
      process.argv[2],
    ));
  } catch (cause) {
    error = cause.message;
  }
  const lines = ["## 서비스 CI — " + (process.argv[2] ?? "종류 오류"), ""];
  if (error) lines.push("설정 오류 — " + error);
  else if (results.length === 0)
    lines.push("대상 없음·미실행 — 등록된 서비스 0개");
  else lines.push(formatServiceResults(results));
  const summary = lines.join("\n") + "\n";
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      "service_results=" + JSON.stringify(results) + "\n",
      "utf8",
    );
  }
  process.exitCode = failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
