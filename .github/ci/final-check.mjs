import { appendFileSync } from "node:fs";

let jobs = [];
let error = "";
try {
  const needs = JSON.parse(process.env.CI_NEEDS_JSON ?? "");
  if (
    !needs ||
    typeof needs !== "object" ||
    Array.isArray(needs) ||
    !Object.hasOwn(needs, "readiness")
  ) {
    throw new Error("readiness 작업을 포함한 선행 작업 결과가 필요합니다.");
  }
  jobs = Object.entries(needs).map(([id, job]) => ({
    id,
    result: job?.result,
  }));
  if (
    jobs.some(
      (job) =>
        !["success", "failure", "cancelled", "skipped"].includes(job.result),
    )
  ) {
    throw new Error("선행 작업 결과에 유효하지 않은 상태가 있습니다.");
  }
} catch {
  error =
    "선행 작업 결과를 확인할 수 없습니다. CI_NEEDS_JSON과 needs 구성을 확인하세요.";
}

const passed = !error && jobs.every((job) => job.result === "success");
const lines = [
  "## CI Final",
  "",
  passed ? "공통 PR CI 기반 검사 통과" : "공통 PR CI 기반 검사 실패",
  "",
];
if (error) {
  lines.push(error, "");
} else {
  lines.push("| 선행 작업 | 실행 결과 |", "| --- | --- |");
  for (const job of jobs) {
    lines.push(`| ${job.id} | ${job.result} |`);
  }
}
lines.push(
  "",
  "서비스 빌드 — 미실행",
  "",
  "서비스 테스트 — 미실행",
  "",
  "현재 최종 검사는 공통 CI 기반 작업의 결과를 집계합니다.",
);
const summary = lines.join("\n") + "\n";
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
}
process.exitCode = passed ? 0 : 1;
