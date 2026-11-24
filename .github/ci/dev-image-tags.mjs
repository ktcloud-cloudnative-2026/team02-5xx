// Issue #281: main에서 게시한 이미지 중 소스가 바뀐 서비스만 dev overlay 태그 갱신 PR로 만든다.
// 배포 경로(Git PR → Argo CD)는 그대로 두고, 사람이 만들던 태그 PR 작성만 자동화한다.
// base·prod overlay는 변경하지 않으며 latest 같은 고정 태그를 쓰지 않는다.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadServices } from "./service-config.mjs";

export const BRANCH_PREFIX = "infra/auto-dev-image-tags-";
export const TRACKING_ISSUE = 281;
const SHA = /^[a-f0-9]{40}$/;
const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagPattern(imageName) {
  return new RegExp(
    `(-\\s+name:\\s+${escapeRegExp(imageName)}\\s*\\r?\\n\\s+newTag:\\s+)(sha-[a-f0-9]{40})\\b`,
  );
}

export function imageName(repository, id) {
  return `ghcr.io/${repository.toLowerCase()}/${id}`;
}

export function readDevTag(content, image) {
  return content.match(tagPattern(image))?.[2] ?? null;
}

export function replaceDevTag(content, image, newTag) {
  if (!/^sha-[a-f0-9]{40}$/.test(newTag)) {
    throw new Error("새 태그는 sha-<전체 40자리 커밋 SHA> 형식이어야 합니다.");
  }
  const pattern = tagPattern(image);
  if (!pattern.test(content)) {
    throw new Error(`dev overlay에서 ${image}의 newTag를 찾을 수 없습니다.`);
  }
  return content.replace(pattern, `$1${newTag}`);
}

export function publishedIds(imageResultsJson, sha) {
  let results;
  try {
    results = JSON.parse(imageResultsJson ?? "");
  } catch {
    throw new Error("이미지 게시 결과(JSON)를 읽을 수 없습니다.");
  }
  if (!Array.isArray(results)) {
    throw new Error("이미지 게시 결과는 배열이어야 합니다.");
  }
  return new Set(
    results
      .filter(
        (result) =>
          result?.publish?.status === "success" &&
          typeof result.image === "string" &&
          result.image.endsWith(`:sha-${sha}`),
      )
      .map((result) => result.id),
  );
}

export function gitChanged(root, fromSha, toSha, path) {
  const known = spawnSync("git", ["cat-file", "-e", `${fromSha}^{commit}`], {
    cwd: root,
    encoding: "utf8",
  });
  if (known.status !== 0) return "unknown";
  const diff = spawnSync(
    "git",
    ["diff", "--quiet", fromSha, toSha, "--", path],
    { cwd: root, encoding: "utf8" },
  );
  if (diff.status === 0) return "unchanged";
  if (diff.status === 1) return "changed";
  throw new Error(`git diff 실패: ${diff.stderr || diff.status}`);
}

export function autoSyncEnabled(root, deployName) {
  const file = join(root, "deploy/argocd/dev", `${deployName}.yaml`);
  if (!existsSync(file)) return false;
  return /automated:\s*\r?\n\s+enabled:\s*true\b/.test(
    readFileSync(file, "utf8"),
  );
}

export function planUpdates({ root, repository, sha, published, changed }) {
  if (!SHA.test(sha ?? "")) {
    throw new Error("전체 40자리 커밋 SHA가 필요합니다.");
  }
  const updates = [];
  const skipped = [];
  for (const service of loadServices(root)) {
    const deployName = basename(service.path);
    const overlay = `deploy/apps/${deployName}/overlays/dev/kustomization.yaml`;
    const image = imageName(repository, service.id);
    const newTag = `sha-${sha}`;
    const skip = (reason) => skipped.push({ id: service.id, reason });

    if (!published.has(service.id)) {
      skip("이번 main 실행에서 게시된 이미지 없음");
      continue;
    }
    const file = join(root, overlay);
    if (!existsSync(file)) {
      skip("dev overlay 없음");
      continue;
    }
    const content = readFileSync(file, "utf8");
    const oldTag = readDevTag(content, image);
    if (!oldTag) {
      skip("dev overlay에서 sha 태그를 찾지 못함");
      continue;
    }
    if (oldTag === newTag) {
      skip("이미 최신 태그");
      continue;
    }
    const state = changed(oldTag.slice(4), sha, service.path);
    if (state === "unchanged") {
      skip("이전 dev 태그 이후 서비스 소스 변경 없음");
      continue;
    }
    updates.push({
      id: service.id,
      overlay,
      image,
      oldTag,
      newTag,
      autoSync: autoSyncEnabled(root, deployName),
      note:
        state === "unknown" ? "이전 태그 커밋을 이력에서 찾지 못해 갱신" : "",
      content: replaceDevTag(content, image, newTag),
    });
  }
  return { updates, skipped };
}

export function prTitle(sha) {
  return `infra: dev 이미지 태그를 main ${sha.slice(0, 7)} 기준으로 자동 갱신`;
}

export function prBody({ sha, repository, updates, skipped }) {
  const short = (tag) => "`" + tag.slice(0, 11) + "…`";
  const lines = [
    "## 무엇을 바꿨나",
    "",
    `main \`${sha.slice(0, 7)}\`에서 GHCR에 게시된 이미지 중, 이전 dev 태그 이후 **소스가 바뀐 서비스만** dev overlay 태그를 갱신합니다. CI가 자동으로 만든 PR입니다.`,
    "",
    "| 서비스 | 이전 태그 | 새 태그 | Argo CD 반영 |",
    "| --- | --- | --- | --- |",
    ...updates.map(
      (update) =>
        `| ${update.id} | ${short(update.oldTag)} | ${short(update.newTag)} | ${
          update.autoSync ? "자동 Sync" : "**수동 Sync 필요**"
        }${update.note ? ` (${update.note})` : ""} |`,
    ),
    "",
    "- 변경 범위: 각 서비스의 `overlays/dev/kustomization.yaml` `newTag` 한 줄. base·prod는 변경하지 않습니다.",
    `- 포함된 커밋: https://github.com/${repository}/compare/${updates[0]?.oldTag.slice(4) ?? sha}...${sha} (서비스마다 이전 태그가 다를 수 있음)`,
  ];
  if (skipped.length) {
    lines.push(
      "",
      "<details><summary>갱신하지 않은 서비스</summary>",
      "",
      ...skipped.map((item) => `- ${item.id}: ${item.reason}`),
      "",
      "</details>",
    );
  }
  lines.push(
    "",
    "## 관련",
    "",
    `- Refs #${TRACKING_ISSUE} (자동 생성 PR은 추적 Issue를 Refs로 연결)`,
    "",
    "## 리뷰 · 병합",
    "",
    "- 필수 리뷰 대상 여부 및 근거: **필수 리뷰 대상** — Kubernetes·Argo CD 배포(공통 인프라)",
    "- [ ] 작성자 외 팀원 1명 승인",
    "- [ ] GitHub Actions 검사 통과 확인",
    "- 병합은 Squash and merge. 더 새로운 자동 PR이 생기면 이 PR은 자동으로 닫힙니다.",
  );
  return lines.join("\n") + "\n";
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function summary(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args[0]} 실패: ${(result.stderr || "").trim() || result.status}`,
    );
  }
  return result.stdout.trim();
}

export async function githubRequest(fetchImpl, token, method, url, body) {
  const response = await fetchImpl(`https://api.github.com${url}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${method} ${url} 실패: ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function closeSuperseded({
  fetchImpl,
  token,
  repository,
  keepBranch,
  newNumber,
}) {
  const pulls = await githubRequest(
    fetchImpl,
    token,
    "GET",
    `/repos/${repository}/pulls?state=open&per_page=100`,
  );
  const closed = [];
  for (const pull of pulls) {
    const branch = pull.head?.ref ?? "";
    if (
      !branch.startsWith(BRANCH_PREFIX) ||
      branch === keepBranch ||
      pull.head?.repo?.full_name !== repository
    )
      continue;
    await githubRequest(
      fetchImpl,
      token,
      "POST",
      `/repos/${repository}/issues/${pull.number}/comments`,
      { body: `더 새로운 자동 PR #${newNumber}로 대체되어 닫습니다.` },
    );
    await githubRequest(
      fetchImpl,
      token,
      "PATCH",
      `/repos/${repository}/pulls/${pull.number}`,
      { state: "closed" },
    );
    await githubRequest(
      fetchImpl,
      token,
      "DELETE",
      `/repos/${repository}/git/refs/heads/${branch}`,
    );
    closed.push(pull.number);
  }
  return closed;
}

function plan(root, env) {
  const sha = env.GITHUB_SHA;
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !SHA.test(sha ?? "")) {
    throw new Error("저장소 이름과 전체 40자리 커밋 SHA가 필요합니다.");
  }
  const published = publishedIds(env.IMAGE_RESULTS_JSON, sha);
  const result = planUpdates({
    root,
    repository,
    sha,
    published,
    changed: (from, to, path) => gitChanged(root, from, to, path),
  });
  for (const update of result.updates) {
    writeFileSync(join(root, update.overlay), update.content, "utf8");
  }
  const body = prBody({ sha, repository, ...result });
  if (env.RUNNER_TEMP) {
    writeFileSync(join(env.RUNNER_TEMP, "dev-image-tags-body.md"), body);
  }
  summary("## dev 이미지 태그 자동 갱신 계획\n");
  summary(
    result.updates.length
      ? body
      : "갱신할 서비스가 없습니다.\n\n" +
          result.skipped
            .map((item) => `- ${item.id}: ${item.reason}`)
            .join("\n"),
  );
  output("changed", result.updates.length ? "true" : "false");
  output("files", result.updates.map((update) => update.overlay).join(" "));
  return result;
}

async function open(root, env, fetchImpl = fetch) {
  const token = env.DEV_TAG_TOKEN;
  if (!token) {
    summary(
      "\n> PR 생성 토큰(`PEAKORDER_DEV_TAG_TOKEN`)이 설정되지 않아 PR을 만들지 않았습니다. 위 계획은 기록용입니다.",
    );
    return null;
  }
  const sha = env.GITHUB_SHA;
  const repository = env.GITHUB_REPOSITORY;
  const files = (env.DEV_TAG_FILES ?? "").split(" ").filter(Boolean);
  if (!files.length) throw new Error("커밋할 overlay 파일 목록이 없습니다.");
  for (const file of files) {
    if (
      !/^deploy\/apps\/[a-z-]+\/overlays\/dev\/kustomization\.yaml$/.test(file)
    ) {
      throw new Error(`dev overlay가 아닌 파일은 커밋하지 않습니다: ${file}`);
    }
  }
  const branch = BRANCH_PREFIX + sha.slice(0, 7);
  const title = prTitle(sha);
  const body = readFileSync(
    join(env.RUNNER_TEMP, "dev-image-tags-body.md"),
    "utf8",
  );
  run("git", ["switch", "-c", branch], { cwd: root });
  run("git", ["add", "--", ...files], { cwd: root });
  run(
    "git",
    [
      "-c",
      `user.name=${BOT_NAME}`,
      "-c",
      `user.email=${BOT_EMAIL}`,
      "commit",
      "-m",
      title,
    ],
    { cwd: root },
  );
  run(
    "git",
    [
      "-c",
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(
        `x-access-token:${token}`,
      ).toString("base64")}`,
      "push",
      "origin",
      `HEAD:refs/heads/${branch}`,
    ],
    { cwd: root },
  );
  const pull = await githubRequest(
    fetchImpl,
    token,
    "POST",
    `/repos/${repository}/pulls`,
    { title, head: branch, base: "main", body },
  );
  const closed = await closeSuperseded({
    fetchImpl,
    token,
    repository,
    keepBranch: branch,
    newNumber: pull.number,
  });
  summary(
    `\nPR #${pull.number}를 만들었습니다.` +
      (closed.length
        ? ` 대체된 자동 PR: ${closed.map((n) => "#" + n).join(", ")}`
        : ""),
  );
  return pull.number;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const mode = process.argv[2];
  try {
    if (mode === "plan") plan(process.cwd(), process.env);
    else if (mode === "open") await open(process.cwd(), process.env);
    else throw new Error("plan 또는 open 중 하나를 지정하세요.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
