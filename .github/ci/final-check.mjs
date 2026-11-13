import { appendFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { inspectServices, loadServices } from "./service-config.mjs";
import {
  emptyResult,
  formatServiceResults,
  requiredChecksPassed,
} from "./run-services.mjs";

let jobs = [];
let results = [];
let error = "";
let passed = false;
let registeredCount = null;
const normalSkips = new Set();
try {
  const needs = JSON.parse(process.env.CI_NEEDS_JSON ?? "");
  if (!needs || typeof needs !== "object" || Array.isArray(needs)) {
    throw new Error("CI_NEEDS_JSON은 선행 작업 결과 객체여야 합니다.");
  }
  for (const id of ["readiness", "java_ci", "react_ci"]) {
    if (!Object.hasOwn(needs, id)) {
      throw new Error("필수 선행 작업 결과 누락 — " + id);
    }
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
    throw new Error("유효하지 않은 선행 작업 상태");
  }

  const root = realpathSync(resolve(process.argv[2] ?? process.cwd()));
  const rows = inspectServices(root, loadServices(root));
  const registered = rows
    .filter((row) => row.path !== null)
    .map(({ id, kind, path }) => ({ id, kind, path }));
  registeredCount = registered.length;
  passed =
    needs.readiness.result === "success" &&
    !rows.some((row) => row.status === "설정 오류");
  if (needs.readiness.result === "success") {
    const outputs = needs.readiness.outputs ?? {};
    if (
      outputs.registered_count !== String(registered.length) ||
      outputs.java_count !==
        String(
          registered.filter((service) => service.kind === "java").length,
        ) ||
      outputs.node_count !==
        String(
          registered.filter((service) => service.kind === "node").length,
        ) ||
      JSON.stringify(JSON.parse(outputs.ready_services)) !==
        JSON.stringify(registered)
    ) {
      throw new Error(
        "준비 검사 출력과 현재 서비스 등록 상태가 일치하지 않습니다.",
      );
    }
  }

  for (const [kind, jobId] of [
    ["java", "java_ci"],
    ["node", "react_ci"],
  ]) {
    const job = needs[jobId];
    const expected = registered.filter((service) => service.kind === kind);
    const normalSkip =
      needs.readiness.result === "success" &&
      expected.length === 0 &&
      job.result === "skipped";
    if (normalSkip) {
      normalSkips.add(jobId);
      continue;
    }
    if (job.result !== "success" || expected.length === 0) passed = false;

    let reported = [];
    let reportError = "";
    try {
      reported = JSON.parse(job.outputs?.service_results ?? "");
      if (!Array.isArray(reported) || reported.length !== expected.length) {
        throw new Error("서비스별 결과 개수가 일치하지 않습니다.");
      }
      const seen = new Set();
      for (const result of reported) {
        if (
          !expected.some(
            (service) =>
              service.id === result?.id &&
              service.kind === result.kind &&
              service.path === result.path,
          ) ||
          seen.has(result.id)
        ) {
          throw new Error("서비스별 결과의 ID·종류·경로가 일치하지 않습니다.");
        }
        seen.add(result.id);
        for (const step of ["setup", "install", "format", "test", "build"]) {
          if (
            !["success", "failure", "not_run", "reused", "unknown"].includes(
              result[step]?.status,
            ) ||
            typeof result[step]?.reason !== "string"
          ) {
            throw new Error("서비스별 단계 결과가 유효하지 않습니다.");
          }
        }
        if (!requiredChecksPassed(result)) passed = false;
      }
    } catch (cause) {
      passed = false;
      reportError = cause.message;
      reported = expected.map((service) => {
        const result = emptyResult(
          service,
          job.result + " — 상세 결과 없음 / " + reportError,
        );
        if (job.result !== "skipped") {
          for (const step of ["setup", "install", "format", "test", "build"]) {
            result[step].status = "unknown";
          }
        }
        return result;
      });
    }
    results.push(...reported);
  }

  for (const job of jobs) {
    if (
      !["readiness", "java_ci", "react_ci"].includes(job.id) &&
      job.result !== "success"
    ) {
      passed = false;
    }
  }
  results.push(
    ...rows
      .filter((row) => row.path === null)
      .map((row) => emptyResult(row, "미구현·미등록 — 대상 없음")),
  );
} catch (cause) {
  error = cause.message;
  passed = false;
}

const lines = [
  "## CI Final",
  "",
  passed ? "공통 PR CI 기반 검사 통과" : "공통 PR CI 기반 검사 실패",
  "",
];
if (error) lines.push("최종 집계 오류 — " + error, "");
lines.push("| 선행 작업 | 실행 결과 | 설명 |", "| --- | --- | --- |");
for (const job of jobs) {
  const reason = normalSkips.has(job.id) ? "정상 생략 — 등록 대상 없음" : "";
  lines.push("| " + job.id + " | " + job.result + " | " + reason + " |");
}
lines.push("", formatServiceResults(results));
if (registeredCount === 0) {
  lines.push("", "서비스 빌드 — 미실행", "", "서비스 테스트 — 미실행");
}
lines.push(
  "",
  "등록 대상 0개이며 준비 검사가 성공한 종류의 skipped만 정상 생략으로 처리합니다.",
  "필수 검사 실패·취소·결과 누락·등록 대상이 있는 작업의 생략은 최종 실패입니다.",
);
const summary = lines.join("\n") + "\n";
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
}
process.exitCode = passed ? 0 : 1;
