# RabbitMQ 이벤트 초안 — Notion 가져오기

> Notion 원문의 초안을 보관한 문서입니다. Git에 추가했다는 이유로 팀 승인·구현 완료를 의미하지 않습니다.

- 원본: [API 명세 초안](https://app.notion.com/p/4102f07e9478802f91a4da2ae18ab56f)
- 원본 최종 수정: 2026-11-13T03:36:25.198Z (UTC)
- 가져온 날짜: 2026-11-13 (Asia/Seoul)
- 공통 확정 규칙: [CLAUDE.md](../../CLAUDE.md)
- 변경 범위: 문서 형식 변환·자료 분리. API 경로, 필드, 테이블, 상태 및 미결정 사항은 원문을 유지합니다.

---

> HTTP API와 구분하기 위해 원문의 이벤트 목록을 이 파일로 분리했습니다. 아래 표는 이벤트 개요이며, 메시지 payload·버전·라우팅·재시도 상세 계약은 원문에 없으므로 추가하지 않았습니다.

| ID | 이벤트명 | 발신자 | 수신자 | 기능 |
| --- | --- | --- | --- | --- |
| EV-01 | OrderConfirmed | Order | Cooking | 확정 주문을 조리 대기열에 등록 |
| EV-02 | CookingCompleted | Cooking | Order | 조리 완료를 주문 상태에 반영 |

관련 HTTP API와 처리 규칙은 [API 초안](../api/notion-draft.md), 이벤트 저장·중복 방지 흐름은 [ERD 초안](../erd/notion-draft.md)을 함께 확인합니다.
