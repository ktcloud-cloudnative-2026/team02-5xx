# 역할

[← README](../README.md)

사용자가 확정한 6인 역할 분담입니다. 공통 개발 규칙은 [CLAUDE.md](../CLAUDE.md)를 따릅니다.

| 이름 | GitHub | 담당 서비스 | 인프라 역할 |
|---|---|---|---|
| 이은제 | @MyaNiss | Menu + 프론트엔드 전체 | 프론트엔드 Kubernetes 배포 |
| 이태훈 | @lth1202 | Auth | CI/CD · Argo CD · GitOps |
| 김지윤 | @ekimje | Cooking | RabbitMQ · 모니터링 · 로깅 |
| 남규리 | @namgyuri | Inventory | PostgreSQL · Redis · 스토리지 |
| 정진혁 | @jjh970830-beep | Payment | Kubernetes 클러스터 · 네트워크 · Gateway |
| 김민규 | @kiwoom2002 | Order | HPA · 리소스 관리 · 오토스케일링 |

- 서비스 코드 및 배포 파일의 리뷰 담당은 [CODEOWNERS](../.github/CODEOWNERS)에 연결합니다.
- 현재 main에는 서비스 코드와 배포 YAML이 없으므로 CODEOWNERS의 해당 경로는 파일 추가 시 적용됩니다.
- 서비스 코드 폴더명과 공통 platform의 세부 하위 경로는 아직 확정하지 않습니다. CODEOWNERS의 서비스 코드 패턴은 `auth`와 `auth-service` 형태를 함께 포괄하며, 실제 구조가 정해지면 함께 갱신합니다.
- 공통 platform 파일은 여러 인프라 역할에 걸칠 수 있습니다. CODEOWNERS의 공동 지정은 담당 역할을 바꾸거나 모든 지정자의 승인을 요구한다는 뜻이 아닙니다.
- 중요 변경의 필수 리뷰 기준은 [CLAUDE.md의 GitHub 협업 규칙](../CLAUDE.md#6-github-협업)을 따릅니다.
