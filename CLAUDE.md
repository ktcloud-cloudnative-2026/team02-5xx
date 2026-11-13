# 피크오더 AI 개발 규칙

> 출처: 팀 회의록(2026-11-13) "피크오더 개발 공통 규칙 — 확정 사항".
> 이 파일은 팀에서 확정한 공통 개발 규칙이다. 작업 전에 확인하고, 확정된 규칙을 임의로 변경하지 않는다.

---

## 0. AI 행동 원칙

1. 이 파일은 **확정된 팀 공통 개발 규칙**의 기준이다. 각 서비스의 기능·데이터·업무 흐름은 해당 API 명세, ERD, 아키텍처 설계 등 최신 설계 문서를 따른다.
2. 설계 문서와 이 파일의 **확정 규칙이 충돌**하면 임의로 어느 쪽을 변경하지 않는다. 충돌 지점을 사용자에게 알리고 확인받은 뒤, 영향을 받는 작업을 진행한다.
3. 별도로 정하지 않은 **서비스 내부 구현 세부 사항**은 기존 설계와 공통 규칙 안에서 합리적으로 판단하여 구현할 수 있다. 무엇을 결정했는지 작업 결과에 설명한다.
4. 기술 스택·라이브러리 추가, 서비스 간 API·이벤트 계약 변경, 다른 서비스의 데이터 소유권에 영향을 주는 변경은 **사전에 제안하고 승인받는다.**
5. 확정 규칙을 지키기 어렵거나 요청 범위를 크게 벗어나는 변경이 필요하면 임의로 진행하지 말고 사용자에게 알린다.

---

## 1. 기술 스택

| 항목            | 확정 내용                                |
| --------------- | ---------------------------------------- |
| Backend         | Java 21 LTS, Spring Boot 4.1.2           |
| 빌드 도구       | Gradle                                   |
| Frontend        | React, Node.js 24 LTS                    |
| 패키지 관리     | npm                                      |
| DB              | PostgreSQL                               |
| DB 구성         | 서비스별 6개, dev/prod 총 12개           |
| DB 마이그레이션 | Flyway                                   |
| 메시징          | RabbitMQ 4.4                                |
| API 문서화      | springdoc-openapi + Swagger UI           |
| CI              | GitHub Actions                           |
| CD              | Argo CD                                  |
| 이미지 저장소   | GHCR                                     |
| Kubernetes      | kubeadm, dev/prod 클러스터               |
| 모니터링·로깅  | Prometheus, Grafana, Loki, Grafana Alloy |

- 위 버전·도구를 바꾸지 않는다. (예: Java 17, Maven, yarn/pnpm, MySQL, Kafka 사용 금지)

---

## 2. API 규칙

- 외부 API 경로: `/api/v1/...`
- 내부 API 경로: `/internal/v1/...`
- JSON 필드명: **camelCase**
- **일반적인 JSON 업무 API 응답**은 공통 응답 형식을 사용한다.
  - 필드: `success`, `data`, `message`
  - 실패 시 추가: `errorCode`
  - (`{"error": "..."}` 같은 임의 형식 금지)
  - HTTP `204 No Content`처럼 본문이 없는 응답은 예외로 한다.
- 각 MSA에 springdoc-openapi 및 Swagger UI를 적용한다.
- Notion API 설계 초안을 병행해서 갱신한다.
- RabbitMQ 이벤트 명세는 별도로 관리한다. (API 명세와 섞지 않는다)

---

## 3. DB 규칙

- 서비스: Auth, Menu, Inventory, Order, Payment, Cooking — **서비스별 독립 DB**
- dev 6개 + prod 6개 = 총 12개 (스키마 분리로 대체하지 않는다)
- 다른 서비스의 DB에 직접 접근하지 않는다.
- 테이블명: **복수형 snake_case** (예: `orders`, `menus`, `payments`)
- 컬럼명: **snake_case**
- DB 구조 변경은 **반드시 Flyway 마이그레이션**으로만 한다. (수동 DDL, `ddl-auto` 로 스키마 변경 금지)

---

## 4. Spring Boot 패키지 구조

- MSA마다 **독립된 Spring Boot 애플리케이션**으로 만든다.
- **계층형 패키지 구조**를 사용한다.
- 기본 패키지: `controller`, `service`, `repository`, `dto`, `entity`
- 필요할 때만 추가: `client`, `messaging`, `config`, `exception`
- 계층형 구조를 유지한다. 필요에 따라 하위 패키지나 보조 패키지를 추가할 수 있으나, 도메인형·헥사고날 등 **아키텍처 구조 자체의 변경**은 먼저 팀과 합의한다.

---

## 5. 코드 포맷

- Java: **Spotless**
- React: **Prettier**
- 공통: `.editorconfig`
- GitHub Actions에서 포맷 검사를 하므로, 코드를 제출하기 전에 포맷을 적용한다.

---

## 6. GitHub 협업

- `main` 브랜치에 **직접 push 금지**
- **이슈 1개 = 브랜치 1개 = PR 1개**
- 브랜치명: `타입/이슈번호-설명` (예: `feat/12-order-create`)
- 커밋 메시지: `타입: 한국어 설명` (예: `feat: 주문 생성 API 추가`)
- PR 본문에 `Closes #이슈번호` 포함
- 병합 방식: **Squash and merge**
- GitHub Actions 검사를 통과한 뒤에만 병합
- 일반 변경: 리뷰 선택
- 중요 변경: **작성자 외 팀원 1명 승인 필수**

**필수 리뷰 대상 (이 영역을 건드리면 PR에 필수 리뷰 대상임을 명시한다)**

- DB 구조 및 마이그레이션
- 서비스 간 API·RabbitMQ 이벤트 계약
- 인증·보안
- 결제·재고 정합성
- Kubernetes·Argo CD·CI/CD 등 공통 인프라
- 여러 서비스에 영향을 주는 공통 코드

- 브랜치·커밋 타입은 기존 팀 규칙의 `feat`, `fix`, `docs`, `infra`, `refactor`, `test`, `chore`를 사용한다. **Issue 라벨 종류 5개와 브랜치·커밋 타입은 별개**로 관리한다.

---

## 7. GitHub Issue 라벨

**종류 (5개)**: `type:feat`, `type:fix`, `type:infra`, `type:docs`, `type:chore`

**영역 (4개)**: `area:backend`, `area:frontend`, `area:infra`, `area:monitoring`

- 위 9개를 **기본 라벨**로 사용한다. 추가 라벨이 필요하면 팀과 합의하여 확장한다.
- 진행 상태·우선순위는 라벨이 아니라 **GitHub Projects**로 관리한다.

---

## 8. Kubernetes 구조

- 기존 `deploy/` 디렉터리를 사용한다.
- **Kustomize Base + dev/prod Overlay** 구조를 사용한다.

```
deploy/
├── apps/
│   ├── auth-service/
│   ├── menu-service/
│   ├── inventory-service/
│   ├── order-service/
│   ├── payment-service/
│   ├── cooking-service/
│   └── web-frontend/
├── platform/
└── argocd/
```

각 서비스 디렉터리 구조:

```
base/
overlays/
├── dev/
└── prod/
```

- Namespace: `peakorder`
- 모든 리소스의 공통 라벨: `app`, `team: team02`
- 이미지 태그 **`latest` 금지** (명시적 버전 태그 사용)
- **prod에 직접 `kubectl apply` 금지**
- 배포 경로는 항상 **Git PR → Argo CD**

---

## 9. 보안 및 비밀정보 관리

- 비밀번호·API 토큰·인증 키·SSH 개인키·kubeconfig·실제 사용자 개인정보를 코드, YAML, 문서 또는 Git에 기록하지 않는다.
- `.env` 파일은 커밋하지 않는다. 저장소에는 비밀값이 없는 `.env.example`만 둔다.
- 애플리케이션 설정은 환경 변수로 주입하고, Kubernetes에서는 Secret을 참조한다. Secret의 실제 값은 Git에 저장하지 않는다.
- GHCR·DB·CI/CD 자격 증명은 GitHub Actions Secrets 등 승인된 비밀정보 저장 수단에서 참조한다.
- 로그와 AI에게 전달하는 입력에도 비밀번호·토큰·접속 비밀값이 포함되지 않도록 주의한다.

---

## 10. 작업 시작 전 체크리스트 (AI가 매번 확인)

- [ ] 이 작업이 위 규칙(1~9)과 충돌하는 부분이 없는가?
- [ ] API 경로는 `/api/v1` 또는 `/internal/v1` 인가? 일반적인 JSON 응답은 공통 형식(`success/data/message/errorCode`)인가?
- [ ] JSON은 camelCase, 테이블은 복수형 snake_case, 컬럼은 snake_case 인가?
- [ ] DB 변경은 Flyway 마이그레이션으로 작성했는가?
- [ ] 계층형 패키지 구조를 준수하는가?
- [ ] Spotless / Prettier 포맷을 적용했는가?
- [ ] 브랜치·커밋·PR 형식이 규칙과 일치하는가? `main`에 직접 push 하지 않는가?
- [ ] K8s 매니페스트는 `deploy/` 구조·공통 라벨(`team: team02`)·namespace `peakorder`를 지키는가? `latest` 태그가 없는가?
- [ ] 비밀번호·토큰 등 비밀정보가 코드·문서·Git에 포함되지 않았는가?
- [ ] 필수 리뷰 대상 변경이라면 PR에 표시했는가?
- [ ] 다른 문서와 확정 규칙이 충돌하면 사용자에게 보고하고 영향을 받는 작업의 진행을 확인받았는가?
