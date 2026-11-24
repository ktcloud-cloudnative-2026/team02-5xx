import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  inspectServices,
  isRepositoryFile,
  loadServices,
} from "./service-config.mjs";

const templates = fileURLToPath(new URL("./docker/", import.meta.url));
const imageIdPattern = /^sha256:[a-f0-9]{64}$/;
const step = (status, reason) => ({ status, reason });

// Issue #307: PR에서는 바뀐 서비스만 이미지를 빌드한다. 아래 공통 파일이 바뀌면 전체를 빌드한다.
export const sharedImageFiles = [
  ".github/ci/docker/",
  ".github/ci/image-ci.mjs",
  ".github/ci/service-config.mjs",
  ".github/ci/services.json",
  ".github/workflows/pr-ci.yml",
];

// PR 병합 검증 커밋(HEAD)과 그 첫 번째 부모(병합 대상 main) 사이의 변경 파일.
// 병합 커밋이 아니거나 이력이 없으면 null을 반환해 전체를 빌드하게 한다.
export function changedFiles(root) {
  const run = (args) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 60000 });
  if (run(["rev-parse", "--verify", "--quiet", "HEAD^2"]).status !== 0)
    return null;
  const diff = run(["diff", "--name-only", "-z", "HEAD^1", "HEAD"]);
  if (diff.status !== 0 || diff.error) return null;
  return diff.stdout.split("\0").filter(Boolean);
}

export function scopeServices(services, files) {
  if (!Array.isArray(files)) return services;
  if (
    files.some((file) =>
      sharedImageFiles.some((shared) =>
        shared.endsWith("/") ? file.startsWith(shared) : file === shared,
      ),
    )
  )
    return services;
  return services.filter((service) =>
    files.some((file) => file.startsWith(service.path + "/")),
  );
}

export function scopedToChanges(env) {
  return (
    env.CI_IMAGE_SCOPE === "changed" && env.GITHUB_EVENT_NAME === "pull_request"
  );
}

export function imagePlan(root, env, listChanged = changedFiles) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,99}$/.test(
      env.GITHUB_REPOSITORY ?? "",
    ) ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")
  ) {
    throw new Error("저장소 이름과 전체 40자리 커밋 SHA가 필요합니다.");
  }
  root = realpathSync(root);
  const rows = inspectServices(root, loadServices(root));
  if (rows.some((row) => row.status === "설정 오류")) {
    throw new Error("등록 서비스의 필수 파일·경로 설정 오류");
  }
  const plan = rows
    .filter((row) => row.path !== null)
    .map(({ id, kind, path }) => ({
      id,
      kind,
      path,
      image: `ghcr.io/${env.GITHUB_REPOSITORY.toLowerCase()}/${id}:sha-${env.GITHUB_SHA}`,
    }));
  return scopedToChanges(env) ? scopeServices(plan, listChanged(root)) : plan;
}

// quietStdout: 결과를 프로그램이 읽기만 하는 명령(예: 파일 목록)의 표준 출력은 로그에 남기지 않는다(#307).
export function executeCommand(command, args, options = {}) {
  const { quietStdout = false, ...spawnOptions } = options;
  console.log("> " + [command, ...args].join(" "));
  const outcome = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    ...spawnOptions,
  });
  if (outcome.stdout && !quietStdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  return outcome;
}

function requireSuccess(outcome, label) {
  if (outcome.status !== 0 || outcome.error || outcome.signal) {
    throw new Error(
      label +
        " 실패 — " +
        (outcome.error?.message ?? outcome.signal ?? outcome.status),
    );
  }
  return outcome.stdout ?? "";
}

function inspectImage(execute, image) {
  const id = requireSuccess(
    execute("docker", ["image", "inspect", "--format", "{{.Id}}", image]),
    "이미지 확인",
  ).trim();
  if (!imageIdPattern.test(id)) throw new Error("이미지 ID 확인 불가");
  return id;
}

export function prepareContext(root, service, destination, execute) {
  const tracked = requireSuccess(
    execute("git", ["ls-files", "-z", "--", service.path + "/"], {
      cwd: root,
      quietStdout: true,
    }),
    "추적 파일 목록 조회",
  )
    .split("\0")
    .filter(Boolean);
  if (tracked.length === 0)
    throw new Error("서비스의 Git 추적 파일이 없습니다.");
  console.log(
    `빌드 컨텍스트: ${service.path}의 Git 추적 파일 ${tracked.length}개 복사`,
  );
  for (const file of tracked) {
    const source = resolve(root, file);
    const local = relative(resolve(root, service.path), source);
    if (
      !file.startsWith(service.path + "/") ||
      !local ||
      local === ".." ||
      local.startsWith("../") ||
      local.startsWith("..\\") ||
      !isRepositoryFile(root, source) ||
      relative(source, realpathSync(source)) !== "" ||
      lstatSync(source).isSymbolicLink()
    ) {
      throw new Error(
        "빌드 컨텍스트에 외부 경로·심볼릭 링크·일반 파일이 아닌 항목이 있습니다.",
      );
    }
    const target = join(destination, local);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  copyFileSync(
    join(templates, "context.dockerignore"),
    join(destination, ".dockerignore"),
  );
  if (service.kind === "node") {
    copyFileSync(
      join(templates, "nginx.conf"),
      join(destination, "ci-nginx.conf"),
    );
  }
}

export function checkImages(
  root,
  env,
  execute = executeCommand,
  listChanged = changedFiles,
) {
  root = realpathSync(root);
  const plan = imagePlan(root, env, listChanged);
  const results = plan.map((service) => ({
    ...service,
    imageId: "",
    build: step("not_run", "검사 시작 전"),
    publish: step("not_run", "PR 검사 또는 main 게시 단계 전"),
  }));
  const report = { results, error: "", failed: false };
  if (scopedToChanges(env)) {
    const planned = new Set(plan.map((service) => service.id));
    report.skipped = imagePlan(root, { ...env, CI_IMAGE_SCOPE: "" })
      .map((service) => service.id)
      .filter((id) => !planned.has(id));
  }
  if (results.length === 0) return report;
  const temp = mkdtempSync(join(tmpdir(), "peakorder-images-"));
  try {
    requireSuccess(
      execute("docker", ["version", "--format", "{{.Server.Version}}"]),
      "Docker 엔진 준비",
    );
    for (const result of results) {
      try {
        const context = join(temp, result.id);
        mkdirSync(context);
        prepareContext(root, result, context, execute);
        requireSuccess(
          execute("docker", [
            "build",
            "--pull",
            "--file",
            join(
              templates,
              result.kind === "java" ? "java.Dockerfile" : "react.Dockerfile",
            ),
            "--label",
            `org.opencontainers.image.source=https://github.com/${env.GITHUB_REPOSITORY}`,
            "--label",
            `org.opencontainers.image.revision=${env.GITHUB_SHA}`,
            "--tag",
            result.image,
            context,
          ]),
          "이미지 빌드",
        );
        result.imageId = inspectImage(execute, result.image);
        result.build = step("success", "이미지 빌드 및 ID 확인 완료");
      } catch (cause) {
        result.build = step("failure", cause.message);
      }
    }
  } catch (cause) {
    report.error = cause.message;
  } finally {
    // The only removed directory is the private directory created above.
    rmSync(temp, { recursive: true, force: true });
  }
  report.failed =
    Boolean(report.error) ||
    results.some((result) => result.build.status !== "success");
  return report;
}

export function validateImageResults(plan, results, published) {
  if (!Array.isArray(results) || results.length !== plan.length)
    throw new Error("서비스별 이미지 결과 개수 불일치");
  const seen = new Set();
  for (const result of results) {
    const expected = plan.find((service) => service.id === result?.id);
    if (
      !expected ||
      seen.has(result.id) ||
      ["kind", "path", "image"].some((key) => expected[key] !== result[key])
    ) {
      throw new Error("이미지 결과의 서비스 ID·종류·경로·태그 불일치");
    }
    seen.add(result.id);
    if (
      ["build", "publish"].some(
        (name) => typeof result[name]?.reason !== "string",
      )
    ) {
      throw new Error("이미지 단계별 결과 설명 누락");
    }
    if (
      !imageIdPattern.test(result.imageId) ||
      result.build?.status !== "success"
    ) {
      throw new Error("이미지 빌드 미완료");
    }
    if (
      published
        ? result.publish?.status !== "success"
        : result.publish?.status !== "not_run"
    ) {
      throw new Error("이미지 게시 상태 불일치");
    }
  }
}

export function publishImages(root, env, report, execute = executeCommand) {
  try {
    if (
      env.GITHUB_EVENT_NAME !== "push" ||
      env.GITHUB_REF !== "refs/heads/main"
    )
      throw new Error("GHCR 게시는 main push에서만 허용합니다.");
    if (report.failed || report.error) throw new Error("선행 이미지 빌드 실패");
    const plan = imagePlan(root, env);
    validateImageResults(plan, report.results, false);
    if (plan.length === 0) return report;
    if (
      !env.GHCR_TOKEN ||
      typeof env.GITHUB_ACTOR !== "string" ||
      env.GITHUB_ACTOR.trim() === ""
    )
      throw new Error("GHCR 게시 자격 증명 누락");
    for (const result of report.results) {
      if (inspectImage(execute, result.image) !== result.imageId)
        throw new Error("빌드 후 게시 대상 이미지 ID 변경");
    }
    requireSuccess(
      execute(
        "docker",
        [
          "login",
          "ghcr.io",
          "--username",
          env.GITHUB_ACTOR,
          "--password-stdin",
        ],
        { input: env.GHCR_TOKEN },
      ),
      "GHCR 로그인",
    );
    for (const result of report.results) {
      try {
        requireSuccess(execute("docker", ["push", result.image]), "GHCR 게시");
        result.publish = step("success", "빌드한 이미지 게시 완료");
      } catch (cause) {
        result.publish = step("failure", cause.message);
        throw cause;
      }
    }
  } catch (cause) {
    report.error = cause.message;
    report.failed = true;
  } finally {
    // Credentials are isolated by the workflow's temporary DOCKER_CONFIG.
    if (
      env.GHCR_TOKEN &&
      env.GITHUB_EVENT_NAME === "push" &&
      env.GITHUB_REF === "refs/heads/main"
    ) {
      execute("docker", ["logout", "ghcr.io"]);
    }
  }
  return report;
}

export function evaluateImageJobs(needs, plan, mode, options = {}) {
  if (!["pr", "main"].includes(mode))
    throw new Error("이미지 검사 실행 모드 오류");
  const active = mode === "pr" ? "image_ci" : "image_publish";
  const inactive = mode === "pr" ? "image_publish" : "image_ci";
  if (!needs[active] || !needs[inactive])
    throw new Error("필수 이미지 작업 결과 누락");
  if (needs[inactive].result !== "skipped")
    throw new Error("실행 조건과 이미지 작업 불일치");
  const normalSkips = [inactive];
  if (
    plan.length === 0 &&
    needs.readiness.result === "success" &&
    needs[active].result === "skipped"
  ) {
    normalSkips.push(active);
    return { normalSkips, results: [] };
  }
  if (needs[active].result !== "success")
    throw new Error("필수 이미지 작업 실패·취소·비정상 생략");
  // PR 변경 범위 빌드(#307)에서는 바뀐 서비스가 없어 대상 0개로 실행·성공할 수 있다.
  if (plan.length === 0 && !(options.scoped && mode === "pr"))
    throw new Error("이미지 대상 0개인데 작업이 실행됨");
  const results = JSON.parse(needs[active].outputs?.image_results ?? "");
  validateImageResults(plan, results, mode === "main");
  return { normalSkips, results };
}

export function imageSummary(report) {
  const cell = (value) =>
    String(value)
      .replaceAll("|", "\\|")
      .replace(/[\r\n]+/g, " ");
  const labels = { success: "성공", failure: "실패", not_run: "미실행" };
  const lines = ["## 컨테이너 이미지 CI", ""];
  if (report.error) lines.push("오류 — " + cell(report.error), "");
  const skipped = Array.isArray(report.skipped) ? report.skipped : [];
  if (report.results.length === 0)
    lines.push(
      report.error
        ? "이미지 빌드 대상 확인 불가·미실행"
        : skipped.length
          ? "이번 PR에서 바뀐 서비스가 없어 이미지 빌드를 생략했습니다."
          : "대상 없음·미실행 — 등록된 서비스 0개",
    );
  else {
    lines.push(
      "| 서비스 | 이미지 빌드 | GHCR 게시 | 이미지 태그 | 사유 |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const result of report.results) {
      lines.push(
        "| " +
          [
            result.id,
            ...["build", "publish"].map((name) => labels[result[name].status]),
            result.image,
            ["build", "publish"]
              .filter((name) => result[name].status !== "success")
              .map((name) => result[name].reason)
              .join(" / ") || "필수 단계 완료",
          ]
            .map(cell)
            .join(" | ") +
          " |",
      );
    }
  }
  if (skipped.length)
    lines.push("", "변경 없음으로 생략: " + skipped.map(cell).join(", "));
  return lines.join("\n") + "\n";
}

function main() {
  const mode = process.argv[2];
  const reportFile = process.env.CI_IMAGE_REPORT;
  if (!reportFile) throw new Error("CI_IMAGE_REPORT가 필요합니다.");
  let report;
  if (mode === "check") {
    try {
      report = checkImages(process.cwd(), process.env);
    } catch (cause) {
      report = { results: [], error: cause.message, failed: true };
    }
  } else {
    try {
      report = JSON.parse(readFileSync(reportFile, "utf8"));
    } catch (cause) {
      if (mode !== "report") throw cause;
      const results = imagePlan(process.cwd(), process.env).map((service) => ({
        ...service,
        imageId: "",
        build: step(
          "not_run",
          "이미지 빌드 보고서 없음 — 앞선 준비 또는 검사 단계 실패",
        ),
        publish: step("not_run", "이미지 빌드 미완료"),
      }));
      report = { results, failed: true, error: "이미지 빌드 보고서 확인 불가" };
    }
    if (mode === "publish")
      report = publishImages(process.cwd(), process.env, report);
    else if (mode !== "report")
      throw new Error("check, publish, report 중 하나를 지정하세요.");
  }
  if (mode !== "report") writeFileSync(reportFile, JSON.stringify(report));
  else {
    const summary = imageSummary(report);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        "image_results=" + JSON.stringify(report.results) + "\n",
      );
  }
  process.exitCode = report.failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (cause) {
    console.error(cause.message);
    process.exitCode = 1;
  }
}
