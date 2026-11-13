# 공통 규칙

[← README](../README.md)

공통 개발 규칙의 단일 원본은 [CLAUDE.md](../CLAUDE.md)입니다. 이 문서는 협업 시 찾아볼 항목을 요약합니다. 기존 초기 템플릿의 예시가 확정 규칙을 대체하지 않습니다.

## GitHub 작업 흐름

1. 근거와 완료 조건을 적어 Issue를 만듭니다.
2. 최신 main에서 `타입/이슈번호-설명` 브랜치를 만듭니다.
3. `타입: 한국어 설명` 형식으로 커밋합니다.
4. 본문에 `Closes #이슈번호`를 포함한 PR을 만듭니다.
5. GitHub Actions 검사 통과 및 필요한 리뷰 승인 후 Squash and merge 합니다.

- main 직접 push 금지, 이슈 1개 = 브랜치 1개 = PR 1개입니다.
- 타입: `feat`, `fix`, `docs`, `infra`, `refactor`, `test`, `chore`.
- 일반 변경은 리뷰 선택, 중요 변경은 작성자 외 팀원 1명 승인이 필수입니다.
- DB·마이그레이션, 서비스 간 API·이벤트 계약, 인증·보안, 결제·재고 정합성, 공통 인프라, 여러 서비스의 공통 코드를 변경하면 PR에 필수 리뷰 대상임을 명시합니다.
- AI는 사용자 승인 없이 PR을 병합하지 않습니다.

## Issue 라벨과 상태

- 종류: `type:feat`, `type:fix`, `type:infra`, `type:docs`, `type:chore`.
- 영역: `area:backend`, `area:frontend`, `area:infra`, `area:monitoring`.
- 진행 상태·우선순위는 GitHub Projects로 관리합니다. 추가 라벨은 팀과 합의합니다.
- Issue 라벨 종류와 브랜치·커밋 타입은 별개입니다.
- 템플릿은 초기의 `task`·`bug` 라벨을 자동 부여하지 않습니다. 생성 시 작업에 맞는 기본 라벨을 선택하며, 저장소 라벨·Projects의 실제 설정 완료 여부는 별도 확인합니다.

## 코드·API·DB

- 기술·버전·도구: [기술 스택](tech-stack.md), [CLAUDE.md](../CLAUDE.md).
- 각 MSA는 독립된 Spring Boot 애플리케이션과 계층형 패키지 구조를 사용합니다.
- API 경로와 공통 응답은 [API 안내](api/README.md), DB 소유권·명명·Flyway 규칙은 [ERD 안내](erd/README.md)를 확인합니다.
- 포트, ID 타입 등 원본에 없는 상세 정책은 초기 템플릿의 예시로 확정하지 않습니다.
- Java는 Spotless, React는 Prettier, 공통은 .editorconfig를 사용하며 제출 전에 포맷을 적용합니다.
- 서비스 코드·배포 YAML·포맷 설정·CI는 현재 main에 아직 구현되지 않았습니다. 이 문서는 구현 완료 보고가 아닙니다.

## 배포·비밀정보

- [배포 안내](../deploy/README.md)와 CLAUDE.md의 Kubernetes 규칙을 따릅니다.
- 비밀값과 실제 개인정보를 Git·문서·로그·AI 입력에 남기지 않습니다.
- 환경 변수로 설정을 주입하고 Kubernetes에서는 Secret을 참조합니다. Git에는 비밀값 없는 [.env.example](../.env.example)만 둡니다.
- 서비스·인프라 담당은 [역할표](roles.md)를 확인합니다.
