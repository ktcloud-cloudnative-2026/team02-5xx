# 기술 스택

[← 아키텍처](architecture.md) · [README](../README.md) · 다음: [API 명세](api/)

확정 규칙의 원본은 [CLAUDE.md](../CLAUDE.md)입니다. 아래는 그 기술 스택과 사용자 제공 인프라 역할의 요약이며, 실제 설치·구현 완료를 의미하지 않습니다.

| 영역 | 확정 내용 |
|---|---|
| Backend | Java 21 LTS, Spring Boot 4.1.2 |
| 빌드 도구 | Gradle |
| Frontend | React, Node.js 24 LTS, npm |
| DB | PostgreSQL, 서비스별 독립 DB 6개 × dev/prod = 총 12개 |
| DB 마이그레이션 | Flyway |
| 메시징 | RabbitMQ |
| API 문서화 | springdoc-openapi + Swagger UI |
| CI / CD | GitHub Actions / Argo CD |
| 이미지 저장소 | GHCR |
| Kubernetes | kubeadm, dev/prod 클러스터 |
| 배포 구성 | 서비스별 Kustomize Base + dev/prod Overlay |
| 모니터링·로깅 | Prometheus, Grafana, Loki, Grafana Alloy |
| 포맷 | Java: Spotless, React: Prettier, 공통: .editorconfig |

## 역할상 지정된 인프라

Redis·스토리지는 남규리, HPA·리소스 관리·오토스케일링은 김민규, 네트워크·Gateway는 정진혁이 담당합니다. 전체 역할은 [역할표](roles.md)를 확인합니다. 역할 지정만으로 구체적인 적용 대상이나 설정값까지 확정하지 않습니다.

## 별도 결정이 필요한 상세 사항

- 원본에 없는 React·Gradle·PostgreSQL 등 제품의 세부 버전
- 동기 호출의 상세 방식, API·RabbitMQ 이벤트의 업무 계약
- DB의 물리 배치와 메시지 큐 배포 방식
- 기존 배포 안내의 네트워크 도구·Gateway 세부 제품 및 설정

기술 스택·라이브러리 추가나 변경은 CLAUDE.md에 따라 먼저 제안하고 승인받습니다. 선정 이유나 대안이 아직 기록되지 않은 항목은 임의로 작성하지 않습니다.
