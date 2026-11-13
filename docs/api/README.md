# API 명세

[← 기술 스택](../tech-stack.md) · [README](../../README.md)

확정 API 규칙은 [CLAUDE.md](../../CLAUDE.md#2-api-규칙)를 따릅니다.

- 외부 경로: `/api/v1/...`, 내부 경로: `/internal/v1/...`.
- JSON 필드명은 camelCase입니다.
- 일반적인 JSON 업무 응답은 `success`, `data`, `message`를 사용하고 실패 시 `errorCode`를 추가합니다. `{"error": "..."}` 형식은 사용하지 않습니다.
- HTTP 204 No Content처럼 본문이 없는 응답은 예외입니다.
- 각 MSA에 springdoc-openapi + Swagger UI를 적용합니다.
- Notion API 설계 초안도 병행 갱신합니다.
- RabbitMQ 이벤트 계약은 API 명세와 섞지 않고 별도로 관리합니다.
- 서비스 간 API·이벤트 계약 변경은 먼저 제안하고 승인받으며, 해당 변경 PR은 필수 리뷰 대상입니다.

서비스별 실제 경로·요청·응답·업무 정책은 최신 설계 문서로 확정합니다. 기존 템플릿의 숫자 ID·포트·업무 모델 예시를 공통 정책으로 간주하지 않습니다.

[example-service.yaml](example-service.yaml)은 형식 설명용 예시이며 실제 서비스 계약이 아닙니다. 실제 API 명세는 서비스 담당자가 작성합니다. 서비스 구성과 담당은 [역할표](../roles.md)를 확인합니다.

## Notion 설계 초안

- [API 명세 초안](notion-draft.md): 원문의 외부·내부 API, 화면별 기능, 수정 전·후 표, 논의 사항을 보존한 자료입니다.
- [RabbitMQ 이벤트 초안](../events/notion-draft.md): 원문의 이벤트 목록을 HTTP API와 분리해 보관합니다.

가져온 문서는 팀 승인이나 구현 완료를 의미하지 않습니다. 원본 링크·수정 시각·가져온 날짜는 각 문서에 기록했습니다. 원문에 없는 요청·응답 스키마나 오류 코드는 추가하지 않았습니다.
