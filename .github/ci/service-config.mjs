import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const serviceKinds = new Map([
  ["auth", "java"],
  ["menu", "java"],
  ["inventory", "java"],
  ["order", "java"],
  ["payment", "java"],
  ["cooking", "java"],
  ["web-frontend", "node"],
]);

const requiredFiles = {
  java: [
    ["gradlew"],
    ["gradle/wrapper/gradle-wrapper.jar"],
    ["gradle/wrapper/gradle-wrapper.properties"],
    ["build.gradle", "build.gradle.kts"],
    ["settings.gradle", "settings.gradle.kts"],
  ],
  node: [["package.json"], ["package-lock.json"]],
};

export function loadServices(root) {
  const registryPath = realpathSync(resolve(root, ".github/ci/services.json"));
  if (!isRepositoryFile(root, registryPath)) {
    throw new Error("서비스 등록 파일은 저장소 내부의 일반 파일이어야 합니다.");
  }

  let registry;
  try {
    const content = readFileSync(registryPath, "utf8");
    registry = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(
      "서비스 등록 파일을 읽을 수 없거나 올바른 JSON이 아닙니다.",
    );
  }
  if (
    !registry ||
    Array.isArray(registry) ||
    !Array.isArray(registry.services) ||
    Object.keys(registry).some((key) => key !== "services")
  ) {
    throw new Error('등록 파일은 {"services": [...]} 형식이어야 합니다.');
  }

  const ids = new Set();
  const paths = new Set();
  const directoryIdentities = new Set();
  for (const service of registry.services) {
    if (
      !service ||
      typeof service !== "object" ||
      Array.isArray(service) ||
      Object.keys(service).some((key) => !["id", "path"].includes(key)) ||
      !serviceKinds.has(service.id)
    ) {
      throw new Error("서비스 항목에는 허용된 id와 path만 지정해야 합니다.");
    }
    if (
      typeof service.path !== "string" ||
      !/^[a-zA-Z0-9._/-]+$/.test(service.path) ||
      service.path.split("/").some((part) => ["", ".", ".."].includes(part))
    ) {
      throw new Error(
        `${service.id}: 저장소 내부의 상대 경로를 지정해야 합니다.`,
      );
    }
    if (ids.has(service.id) || paths.has(service.path)) {
      throw new Error("서비스 id 또는 경로를 중복 등록할 수 없습니다.");
    }
    const directoryInfo = statSync(resolve(root, service.path), {
      bigint: true,
      throwIfNoEntry: false,
    });
    if (directoryInfo?.isDirectory()) {
      const identity = `${directoryInfo.dev}:${directoryInfo.ino}`;
      if (directoryIdentities.has(identity)) {
        throw new Error("같은 실제 서비스 디렉터리를 중복 등록할 수 없습니다.");
      }
      directoryIdentities.add(identity);
    }
    ids.add(service.id);
    paths.add(service.path);
  }
  return registry.services;
}

export function isRepositoryFile(root, filePath) {
  try {
    const actualPath = realpathSync(filePath);
    const relativePath = relative(root, actualPath);
    return (
      relativePath !== "" &&
      relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\") &&
      !isAbsolute(relativePath) &&
      statSync(actualPath).isFile()
    );
  } catch {
    return false;
  }
}

export function inspectServices(root, registered) {
  return [...serviceKinds].map(([id, kind]) => {
    const service = registered.find((entry) => entry.id === id);
    if (!service) {
      return { id, kind, status: "미구현·미등록", path: null, missing: [] };
    }
    const missing = requiredFiles[kind].filter(
      (alternatives) =>
        !alternatives.some((file) =>
          isRepositoryFile(root, resolve(root, service.path, file)),
        ),
    );
    return {
      id,
      kind,
      path: service.path,
      status: missing.length === 0 ? "필수 파일 준비됨" : "설정 오류",
      missing,
    };
  });
}
