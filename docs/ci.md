# 공통 PR CI 기반

[← README](../README.md) · [Issue #13](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/13)

## 실행 구조

```text
main 대상 PR
  → Service readiness
      → 공통 CI 자체 테스트
      → 서비스 등록·필수 파일 검사와 실행 요약
  → CI Final
      → 필수 선행 작업 결과 집계
```

`pr-ci.yml`은 `main` 대상 PR의 생성, 코드 업데이트, 재개, 수정, 리뷰 준비 전환에 실행됩니다.
문서만 수정한 PR도 실행되어 고정된 최종 검사 결과를 제공합니다.
기본 권한은 `contents: read`이고 별도 Secrets가 필요하지 않습니다.

현재 등록 서비스는 0개입니다. Auth, Menu, Inventory, Order, Payment, Cooking,
프론트엔드의 상태를 각각 `미구현·미등록`으로 표시합니다.
서비스 빌드와 테스트는 `미실행`으로 표시합니다.
공통 CI 자체 테스트의 통과와 서비스 테스트의 실행 여부는 각각 보고합니다.

## 파일 역할

| 파일                            | 역할                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| `.github/workflows/pr-ci.yml`   | PR 이벤트, 권한, 실행 순서, 고정 이름 `CI Final` 정의           |
| `.github/ci/services.json`      | CI에 등록할 서비스의 ID와 저장소 상대 경로                      |
| `.github/ci/check-services.mjs` | 등록 형식·필수 파일 검사, 준비 상태 요약, 후속 작업용 출력      |
| `.github/ci/final-check.mjs`    | 필수 선행 작업 결과를 최종 종료 코드에 반영                     |
| `.github/ci/ci.test.mjs`        | 임시 폴더에서 실제 검사 명령을 실행하는 재현 가능한 자체 테스트 |

두 검사 스크립트는 콘솔에 결과를 출력하고, GitHub Actions에서는 `GITHUB_STEP_SUMMARY` 파일에도
Markdown을 기록합니다. 이 파일의 내용이 실행 화면의 Summary에 나타납니다.

## 서비스 등록

서비스 담당자와 실제 경로를 정하고 필요한 프로젝트 파일을 준비한 후
`.github/ci/services.json`의 `services` 배열에 항목을 추가합니다.

```json
{
  "services": [
    {
      "id": "auth",
      "path": "services/auth-service"
    }
  ]
}
```

위 경로는 등록 방법을 설명하는 예시입니다. 실제 서비스 코드 폴더명은 담당자와 정한 값을 사용합니다.
등록 항목은 `id`와 `path` 두 필드로 구성합니다.

- Java 서비스 ID는 `auth`, `menu`, `inventory`, `order`, `payment`, `cooking`입니다.
- 프론트엔드 ID는 `web-frontend`입니다.
- `path`에는 저장소 기준 상대 경로를 쓰며 구분자는 `/`를 사용합니다.
- ID와 경로는 중복 등록할 수 없습니다.
- 절대 경로, `..`, 빈 경로, 저장소 외부 파일을 가리키는 심볼릭 링크는 검사에 실패합니다.
- 등록 파일의 JSON·구조 오류와 등록 파일 누락도 실패합니다.
- 등록하지 않은 서비스는 폴더 존재 여부와 관계없이 `미구현·미등록`으로 표시합니다.
  실제 코드가 추가되면 서비스 등록도 함께 리뷰해야 합니다.

### 필수 파일

다음 목록은 이번 공통 CI의 파일 준비 검사 기준입니다.

| 서비스 종류                 | 등록 경로 아래의 필수 파일                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Java / Gradle               | `gradlew`, `gradle/wrapper/gradle-wrapper.jar`, `gradle/wrapper/gradle-wrapper.properties` |
| Java / Gradle 빌드 정의     | `build.gradle` 또는 `build.gradle.kts`                                                     |
| Java / Gradle 프로젝트 정의 | `settings.gradle` 또는 `settings.gradle.kts`                                               |
| React / npm                 | `package.json`, `package-lock.json`                                                        |

등록 서비스에 필수 파일이 없거나 파일 위치에 디렉터리가 있으면 `설정 오류`와 누락 목록을 표시하고
종료 코드 `1`을 반환합니다. 필수 파일이 모두 있으면 `필수 파일 준비됨`으로 표시합니다.

파일의 내용이나 실제 프로그램 동작은 후속 서비스 CI에서 확인합니다.
Java 21·Spring Boot 4.1.2 설정, Gradle Wrapper의 호환 버전, Spotless 설정,
React·npm 스크립트·Prettier 설정은 서비스 담당자와 함께 검증할 항목입니다.
서비스별 테스트와 포맷 설정이 아직 없으므로 이번 작업에서 해당 버전이나 스타일 세부 값을 추가로 정하지 않습니다.

## 후속 Java 21·Node.js 24 CI 연결

등록 검사 작업은 다음 출력을 제공합니다.

- `needs.readiness.outputs.registered_count`는 등록 서비스 수입니다.
- `needs.readiness.outputs.ready_services`는 `id`, `kind`, `path`를 가진 JSON 배열입니다.
  Java는 `kind: "java"`, 프론트엔드는 `kind: "node"`입니다.
- 준비 검사 오류가 하나라도 있으면 `ready_services`는 빈 배열을 출력합니다.
  등록 파일 자체를 읽지 못하면 출력이 없고 작업이 실패합니다.

후속 이슈에서는 이 출력과 준비 검사 성공 여부를 사용해 서비스별 작업을 연결합니다.

1. Java 작업에 JDK 21을 설정하고 등록 경로에서 Gradle Wrapper를 사용합니다.
   Spring Boot는 4.1.2를 유지합니다. Spotless·테스트·빌드는 실제 프로젝트의 작업 이름을 확인한 뒤 실행합니다.
2. 프론트엔드 작업에 Node.js 24를 설정하고 등록 경로에서 `npm ci`를 실행합니다.
   Prettier 검사, 자동 종료되는 테스트 명령, 빌드 명령은 실제 `package.json`에 맞춰 연결합니다.
3. 서비스가 0개인 경우의 처리를 구현합니다. 빈 목록으로 실행하지 않은 서비스 검사를 통과했다고 보고하지 않습니다.
4. 최종 작업의 `needs`에 결과를 반영할 모든 서비스 작업을 추가합니다.
   `needs`에는 직접 등록한 선행 작업의 결과만 전달됩니다.
5. 서비스 검사 추가 시 최종 요약의 실행 여부 문구도 실제 결과에 맞게 갱신합니다.

예를 들어 필수 작업 `java_ci`를 추가한 경우 최종 작업의 의존성을 다음처럼 확장합니다.

```yaml
needs: [readiness, java_ci]
```

현재 최종 검사는 `needs`에 들어온 모든 작업의 `result`가 `success`일 때 통과합니다.
`failure`, `cancelled`, `skipped`, 결과 누락은 실패입니다.
후속 작업을 조건부로 건너뛰게 만들 경우에는, 등록 상태에 따른 허용 조건과 최종 집계 테스트를
함께 설계해야 합니다.

`CI Final` 작업은 `if: always()`로 선행 작업 실패 후에도 실행을 시도합니다.
`toJSON(needs)` 값을 `CI_NEEDS_JSON` 환경 변수로 전달하고, 집계 스크립트가 종료 코드 `0` 또는 `1`을 반환합니다.
GitHub는 이 종료 코드로 검사 통과·실패를 표시합니다.
워크플로 전체가 취소되거나 GitHub 실행 환경에 문제가 있으면 최종 작업 자체가 취소될 수도 있습니다.

## 로컬 검증

Node.js 24에서 저장소 루트 기준으로 실행합니다. npm 패키지 설치가 필요하지 않습니다.

```powershell
node --version
node --test .github/ci/ci.test.mjs
node .github/ci/check-services.mjs
```

자체 테스트는 OS 임시 폴더에 서비스 등록 파일과 필수 파일 모형을 만들고 테스트 종료 시 정리합니다.
모형은 파일 존재 검사에 필요한 빈 파일이며 실제 서비스 프로젝트를 생성하거나 빌드하지 않습니다.
등록 0개, Java·React 필수 파일 누락과 정상 존재, 등록 JSON 오류, 중복 ID·경로,
외부 경로, 필수 작업 실패·취소·건너뛰기, 후속 작업 실패, 최종 검사까지의 실패 전파를 검증합니다.

최종 검사 단독 재현은 PowerShell에서 다음처럼 실행합니다.

```powershell
$env:CI_NEEDS_JSON = '{"readiness":{"result":"success"}}'
node .github/ci/final-check.mjs
$LASTEXITCODE
# 0

$env:CI_NEEDS_JSON = '{"readiness":{"result":"failure"}}'
node .github/ci/final-check.mjs
$LASTEXITCODE
# 1

Remove-Item Env:CI_NEEDS_JSON
```

POSIX 셸에서는 다음처럼 실행할 수 있습니다.

```sh
CI_NEEDS_JSON='{"readiness":{"result":"failure"}}' node .github/ci/final-check.mjs
echo $?
# 1
```

## 외부 도구와 버전

| 도구                 | 버전                                               | 사용 이유                                            |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| `actions/checkout`   | 7.0.1 / `3d3c42e5aac5ba805825da76410c181273ba90b1` | 실행 대상 PR 코드 가져오기                           |
| `actions/setup-node` | 7.1.0 / `949feb2413d6458794dcd2491c4babbbce0c15c1` | 팀 기준 Node.js 24 실행 환경 설정                    |
| Node.js              | CI는 24 계열, 로컬 검증은 24.22.3                  | 내장 파일 API·테스트 실행기 사용                     |
| actionlint           | 1.7.12                                             | 로컬에서 GitHub Actions YAML·표현식·작업 의존성 검사 |
| Prettier             | 3.10.1                                             | 새 JavaScript·JSON·YAML·문서의 로컬 포맷 검사        |

Actions는 버전 주석과 전체 커밋 SHA로 고정합니다.
actionlint는 검증할 때만 OS 임시 폴더에서 사용하고, Prettier는 버전을 지정해 npm 임시 실행으로 사용합니다.
검사 스크립트에는 외부 런타임 라이브러리가 없습니다.

공식 참고 자료는 [워크플로 문법](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[needs 컨텍스트](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#needs-context),
[실행 요약](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary),
[checkout 7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1),
[setup-node 7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)에서 확인할 수 있습니다.

## GitHub 게시 후 확인할 항목

로컬 검증과 함께 다음 항목을 실제 PR에서 확인해야 합니다.

- `main` 대상 PR 생성·코드 업데이트에 워크플로가 실행되는지
- Actions 허용 정책과 GitHub 실행 환경에서 고정한 Actions가 정상 실행되는지
- 등록 0개일 때 Summary에 미등록 상태와 서비스 빌드·테스트 미실행이 표시되는지
- 일시적인 검증 변경으로 필수 파일 누락을 만들었을 때 `Service readiness`와 `CI Final`이 함께 실패하는지
- 오류를 수정한 최신 PR 커밋에서 다시 통과하는지
- `CI Final`을 필수 검사로 지정할지 저장소 관리자가 확인했는지
- CI/CD 공통 인프라 변경으로 작성자 외 팀원 1명이 리뷰 승인했는지

Issue #13의 완료 조건 중 실제 GitHub Actions 검증과 리뷰 승인은 이 단계에서 확인합니다.
