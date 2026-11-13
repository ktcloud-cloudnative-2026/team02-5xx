# 공통 PR CI와 서비스 검사

[← README](../README.md) · [Issue #13](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/13) · [Issue #23](https://github.com/ktcloud-cloudnative-2026/team02-5xx/issues/23)

## 실행 구조

```text
main 대상 PR
  → Service readiness
      → 공통 CI 자체 테스트
      → 서비스 등록·필수 파일 검사와 실행 요약
  → Java service CI / React service CI
      → 등록된 종류의 서비스 검사와 단계별 요약
  → CI Final
      → 준비 검사와 Java·React 결과 집계
```

`pr-ci.yml`은 `main` 대상 PR의 생성, 코드 업데이트, 재개, 수정, 리뷰 준비 전환에 실행됩니다.
문서만 수정한 PR도 실행되어 고정된 최종 검사 결과를 제공합니다.
기본 권한은 `contents: read`이고 별도 Secrets가 필요하지 않습니다.

현재 등록 서비스는 0개입니다. Auth, Menu, Inventory, Order, Payment, Cooking,
프론트엔드의 상태를 각각 `미구현·미등록`으로 표시합니다.
준비 검사 단계의 서비스 빌드와 테스트는 `미실행`으로 표시합니다. 실제 실행 상태는 서비스 검사와 최종 요약에서 확인합니다.
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

추가 모듈 `.github/ci/service-config.mjs`는 기존 서비스 등록·필수 파일·경로 검증을 공유합니다.
`.github/ci/run-services.mjs`는 서비스 명령을 실행하고 단계별 결과를 기록합니다.
서비스 종류별 작업 안에서는 등록된 서비스를 순서대로 검사합니다. 한 서비스가 실패해도 다음 서비스의 결과를 수집합니다.

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

파일 내용과 실제 프로그램 동작은 Java·React 서비스 검사에서 확인합니다.
Java 21·Spring Boot 4.1.2 설정, Gradle Wrapper의 호환 버전, Spotless 설정,
React·npm 스크립트·Prettier 설정은 서비스 담당자와 함께 검증할 항목입니다.
각 서비스의 기존 Gradle Wrapper, 빌드 정의, npm 스크립트, lockfile 및 포맷 설정을 사용합니다.

## Java·React 서비스 검사

준비 검사는 기존 `registered_count`, `ready_services`와 함께 `java_count`, `node_count`를 출력합니다.
`ready_services`는 `id`, `kind`, `path`를 가진 배열이며 Java는 `java`, React는 `node`입니다.
필수 파일 오류가 있으면 준비 검사가 실패하고 실행 대상 목록은 빈 배열이 됩니다.
서비스 실행기와 최종 집계도 현재 등록 파일과 경로를 다시 검증합니다.

### Java

GitHub의 `ubuntu-24.04` 실행기가 제공하는 `JAVA_HOME_21_X64`를 선택하고,
실제 Java specification version이 21인지 확인합니다. 준비에 실패하면 서비스 작업도 실패합니다.

서비스 등록 경로에서 다음 명령을 순서대로 실행합니다.

```sh
sh ./gradlew --no-daemon --console=plain spotlessCheck
sh ./gradlew --no-daemon --console=plain test
sh ./gradlew --no-daemon --console=plain build
```

각 프로젝트의 Wrapper가 해당 프로젝트에 기록된 Gradle 배포본을 사용합니다.
CI는 Gradle 버전, 빌드 정의 또는 Wrapper 파일을 변경하지 않습니다.
`sh ./gradlew` 실행은 Wrapper 파일의 실행 권한에 의존하지 않습니다.
`spotlessCheck`, `test`, `build`는 현재 확인한 서비스의 표준 작업명입니다.
Spotless 작업이 없으면 설정 오류로 실패합니다. 다른 작업명·다중 모듈 구성이 필요한 서비스는 등록 전에 담당자와 실행 계약을 확인합니다.

단계 실패 시 해당 서비스의 나머지 단계는 미실행으로 기록됩니다.
Gradle `test`의 `NO-SOURCE`·`SKIPPED`는 미실행으로 기록하며 필수 검사 미완료로 실패합니다.
테스트 작업의 실행 로그를 확인할 수 없으면 `확인 불가`로 실패합니다.
`UP-TO-DATE`·`FROM-CACHE`는 `기존 결과 재사용`으로 구분하여 기록합니다.
Gradle `build`에 연결된 테스트·포맷 작업은 해당 프로젝트의 기존 의존 관계에 따라 실행됩니다.

### React

Node.js 24에서 서비스 등록 경로를 기준으로 실행합니다.

```sh
npm ci
npm run format:check
npm run build
```

실행 전 `package.json`의 `format:check`, `build` 스크립트가 비어 있지 않은지 확인합니다.
lockfile·의존성 불일치와 설치 실패는 `npm ci`의 실패로 반영합니다.
설치 또는 포맷 검사 실패 후 남은 단계는 미실행으로 기록합니다.
프론트엔드 테스트 단계는 `미실행 — 프론트엔드 테스트 단계 미설정`으로 표시합니다.
이번 React 검사 항목은 설치·포맷·빌드입니다.
npm의 세부 버전·프로젝트별 추가 설치 옵션은 서비스 설정과 담당자 합의를 확인합니다.

### 실행 결과와 최종 판정

각 서비스 작업은 `GITHUB_STEP_SUMMARY`에 준비·의존성 설치·포맷·테스트·빌드 상태와 미실행 사유를 기록합니다.
`service_results` 출력에는 서비스 ID·종류·경로와 각 단계의 `status`, `reason`이 들어갑니다.
성공, 실패, 미실행, 기존 결과 재사용, 확인 불가를 구분합니다.
Java 의존성 준비는 Wrapper 명령 안에서 진행되며 별도 설치 단계는 미실행으로 표시합니다.

`CI Final`은 `readiness`, `java_ci`, `react_ci`를 직접 `needs`로 연결합니다.
준비 검사 출력과 현재 등록 상태, 서비스 결과의 ID·종류·경로·개수·중복 여부 및 단계 상태를 확인합니다.

| 상황                                     | 서비스 검사 상태                       | 최종 판정                          |
| ---------------------------------------- | -------------------------------------- | ---------------------------------- |
| 준비 검사 성공, 해당 종류 등록 0개       | 대상 없음에 따른 정상 생략             | 통과 가능, 서비스 검사 미실행 표시 |
| 등록된 서비스의 필수 검사 완료           | 실제 성공 또는 Gradle 기존 결과 재사용 | 통과 가능                          |
| 등록된 서비스의 파일·필수 명령 누락      | 설정 오류                              | 실패                               |
| 필수 검사 실패·취소                      | 실패·취소                              | 실패                               |
| 등록 대상이 있는데 작업 생략             | 비정상 생략                            | 실패                               |
| 서비스 결과 누락·잘못된 JSON·단계 미실행 | 확인 불가 또는 미완료                  | 실패                               |
| 공통 CI 자체 테스트·준비 검사 실패       | 서비스 검사 미실행 가능                | 실패                               |

기본 권한 `contents: read`, PR 실행 조건, 고정 이름 `CI Final`을 유지합니다.
`if: always()`로 선행 작업 실패 후에도 최종 집계를 시도합니다.
워크플로 전체 취소나 GitHub 실행기 장애로 최종 작업 자체가 취소될 수 있습니다.
그 경우에도 해당 PR의 필수 검사가 성공으로 완료된 상태가 되지 않습니다.
준비·환경 설정 단계에서 실패하여 상세 결과가 없으면 실행 여부를 `확인 불가`로 보고합니다.

## 로컬 검증

Node.js 24에서 저장소 루트 기준으로 실행합니다.

```powershell
node --version
node --test .github/ci/ci.test.mjs
node .github/ci/check-services.mjs
```

기존 57개 검증 사례를 유지하고 서비스 조합·명령 누락·단계 실패·취소·정상/비정상 생략·결과 누락 테스트를 추가했습니다.
기존 최종 검사 테스트의 입력 준비에는 새 필수 작업 두 개와 준비 검사 출력을 추가했습니다.
기존 테스트 본문의 검증 조건은 유지합니다.

자체 테스트는 OS 임시 폴더에 등록 JSON과 필수 파일 모형을 만들고 종료 시 정리합니다.
서비스 실행 테스트는 명령 실행 함수를 대체하여 호출 명령·경로와 성공·실패 출력을 재현합니다.
실제 Node 자식 프로세스의 출력·종료 코드도 별도로 확인합니다.
이 결과는 CI 제어 로직의 로컬 검증이며 서비스 Gradle·npm 빌드 성공 여부는 GitHub의 실제 프로젝트 검사에서 확인합니다.

등록 0개의 전체 흐름은 다음 PowerShell 명령으로 재현합니다.
출력·요약 파일은 OS 임시 폴더에 생성합니다.

```powershell
$ciTemp = Join-Path ([System.IO.Path]::GetTempPath()) ("peakorder-ci-manual-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $ciTemp | Out-Null
$env:GITHUB_OUTPUT = Join-Path $ciTemp 'readiness-output.txt'
$env:GITHUB_STEP_SUMMARY = Join-Path $ciTemp 'summary.md'
try {
    node .github/ci/check-services.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Readiness failed' }
    $ciOutputs = @{}
    Get-Content -LiteralPath $env:GITHUB_OUTPUT | ForEach-Object {
        $ciParts = $_ -split '=', 2
        $ciOutputs[$ciParts[0]] = $ciParts[1]
    }
    if ($ciOutputs.registered_count -ne '0') { throw '등록 0개 상태에서 실행하세요' }
    $env:CI_NEEDS_JSON = @{
        readiness = @{ result = 'success'; outputs = $ciOutputs }
        java_ci = @{ result = 'skipped' }
        react_ci = @{ result = 'skipped' }
    } | ConvertTo-Json -Depth 8 -Compress
    node .github/ci/final-check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Final check failed' }
    Get-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
} finally {
    Remove-Item Env:GITHUB_OUTPUT, Env:GITHUB_STEP_SUMMARY, Env:CI_NEEDS_JSON -ErrorAction SilentlyContinue
    $ciResolvedTemp = [System.IO.Path]::GetFullPath($ciTemp)
    if ([System.IO.Path]::GetDirectoryName($ciResolvedTemp) -eq [System.IO.Path]::GetTempPath().TrimEnd('\', '/') -and
        [System.IO.Path]::GetFileName($ciResolvedTemp).StartsWith('peakorder-ci-manual-')) {
        Remove-Item -LiteralPath $ciResolvedTemp -Recurse -Force
    }
}
```

기존 GitHub Actions 환경 변수를 사용하는 셸에서는 별도 PowerShell 세션으로 수동 검증합니다.

## 외부 도구와 버전

Java는 GitHub 실행기의 사전 설치된 JDK 21을 사용합니다.
제공 환경 변수는 [공식 실행기 이미지 문서](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#java)에서 확인할 수 있습니다.
새 외부 Action이나 런타임 라이브러리 추가 없이 아래 기존 도구를 사용합니다.
실제 JDK 패치 버전은 GitHub 실행 로그에 기록됩니다.

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

Issue #23의 실제 GitHub Actions 서비스 검사와 리뷰 승인은 게시 후 검증합니다. 준비된 서비스의 성공·실패·취소·생략 상태 및 Summary 표시를 확인합니다.
