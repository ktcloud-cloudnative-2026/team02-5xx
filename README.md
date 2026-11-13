# <5xx> — <피크오더(Peak Order)>

> 이 저장소가 프로젝트의 원본입니다. 기획 · 설계 문서, 코드, 배포 파일, 결정 기록을 모두 여기에 둡니다.
>
> 공통 개발 규칙의 원본은 [CLAUDE.md](CLAUDE.md)입니다. Codex는 [AGENTS.md](AGENTS.md)를 통해 이를 확인합니다.
> 역할은 [역할표](docs/roles.md), 기술 스택은 [기술 스택](docs/tech-stack.md), 협업 절차는 [공통 규칙](docs/conventions.md), 배포 구조는 [deploy](deploy/README.md)를 확인합니다.
> 그 외 초기 템플릿의 예시와 미정 항목은 확정 규칙과 구분합니다.

## 한 줄 소개

<음식점의 피크 시간대에 몰리는 주문을 안정적으로 처리하고, 고객에게 주문 진행 상황과 예상 대기 시간을 실시간으로 보여 주는 주문 서비스>

## 문서

| 항목                            | 링크                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 기획·설계 문서, 회의록 (Notion) | [Peak Order](https://app.notion.com/p/Peak-Order-35f2f07e947883f88d530131eb2b8f0b?source=copy_link)          |
| 시퀀스 다이어그램 (FigJam)      | [FigJam](https://www.figma.com/board/PfXHpZdcoHplNNKP6ZPcx1/kt-cloud-team2?node-id=0-1&t=N8W9xaJJmx3OKX5J-1) |
| 할 일 보드 (GitHub Projects)    | 준비 중                                                                                                      |

## 링크

| 항목                         | 링크            |
| ---------------------------- | --------------- |
| 할 일 보드 (GitHub Projects) | <Projects 주소> |
| dev 주소                     | <dev 주소>      |
| prod 주소                    | <prod 주소>     |
| 대시보드                     | <Grafana 주소>  |

## 폴더

```
docs/       설계 문서 (이 README의 표)
services/   서비스 코드 — 서비스마다 폴더 하나
deploy/     Kubernetes 매니페스트 · Argo CD
.github/    PR · 이슈 템플릿, CI 워크플로
```
