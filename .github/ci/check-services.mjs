import { appendFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { inspectServices, loadServices } from "./service-config.mjs";

function summarize(rows, error) {
  const lines = ["## 서비스 준비 상태", ""];
  if (error) {
    lines.push(`등록 정보 검사 실패 — ${error}`, "");
  } else {
    const registeredCount = rows.filter((row) => row.path !== null).length;
    const readyCount = rows.filter(
      (row) => row.status === "필수 파일 준비됨",
    ).length;
    lines.push(
      `등록 ${registeredCount}개 / 필수 파일 준비 ${readyCount}개`,
      "",
    );
    lines.push("| 서비스 | 종류 | 등록 경로 | 준비 상태 |");
    lines.push("| --- | --- | --- | --- |");
    for (const row of rows) {
      lines.push(
        `| ${row.id} | ${row.kind} | ${row.path ?? "—"} | ${row.status} |`,
      );
    }
    for (const row of rows.filter((entry) => entry.missing.length > 0)) {
      lines.push(
        "",
        `- ${row.id} 누락 또는 저장소 외부 파일 — ${row.missing
          .map((alternatives) => alternatives.join(" 또는 "))
          .join(", ")}`,
      );
    }
  }
  lines.push(
    "",
    "서비스 빌드 — 미실행",
    "",
    "서비스 테스트 — 미실행",
    "",
    "준비 상태는 파일 존재 여부를 검사한 결과입니다. 파일 내용의 유효성, 포맷, 빌드 및 테스트 결과는 서비스 CI에서 검증합니다.",
  );
  return lines.join("\n") + "\n";
}

let rows = [];
let error = "";
try {
  const root = realpathSync(resolve(process.argv[2] ?? process.cwd()));
  rows = inspectServices(root, loadServices(root));
} catch (cause) {
  error = cause.message;
}

const hasErrors =
  Boolean(error) || rows.some((row) => row.status === "설정 오류");
const summary = summarize(rows, error);
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
}
if (process.env.GITHUB_OUTPUT && !error) {
  const registeredCount = rows.filter((row) => row.path !== null).length;
  const readyServices = hasErrors
    ? []
    : rows
        .filter((row) => row.path !== null)
        .map(({ id, kind, path }) => ({ id, kind, path }));
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `registered_count=${registeredCount}\nready_services=${JSON.stringify(readyServices)}\njava_count=${readyServices.filter((service) => service.kind === "java").length}\nnode_count=${readyServices.filter((service) => service.kind === "node").length}\n`,
    "utf8",
  );
}
process.exitCode = hasErrors ? 1 : 0;
