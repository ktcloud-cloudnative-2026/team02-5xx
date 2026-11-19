# Issue #129 관리자 메뉴 관리 Mock UI

## 범위와 접근 경계

#129 브랜치 시작점은 main 70f4e04입니다. fetch 시 최신 main a9e9be9에는 Cooking 변경만 있었고 프론트엔드와 겹치지 않았습니다.
#116·#105는 Open, #117·#119·#123·#127은 Open/Draft였으며 어느 브랜치도 merge·복사하지 않았습니다.
API 제안 문서만 원본 Git 객체에서 읽었습니다. #128 검증 브랜치 b7d90f7도 그대로 보존합니다.

제품 `src/App.jsx`, `src/main.jsx`, 고객 MenuDetail·데이터·스타일은 Git blob 변경이 없습니다.
관리자 코드는 `src/components/admin/`, Mock 데이터는 `src/data/admin/`로 분리했습니다.
`preview/admin/`만 이 컴포넌트와 Mock adapter를 import합니다. 고객 앱에서 관리자 경로를 등록하거나 인증을 고정하지 않습니다.
실제 JWT·역할 검사·Gateway·서버 API를 구현/호출하지 않습니다. 백엔드 관리자 API의 기본 403도 변경하지 않습니다.

`npm.cmd run preview:admin`은 Vite로 별도 진입점을 **메모리에만 정적 빌드**하고 127.0.0.1의 임시 포트에서 제공합니다.
일반 고객 dist를 덮어쓰지 않고 HMR/React Refresh/Vite client를 삽입하지 않습니다. POST 요청은 405이며 `/api/v1/admin/menus`나 `/admin` 서버 경로는 제공하지 않습니다.
제품 `npm run build`에는 관리자 진입점·Mock adapter·시나리오 도구가 포함되지 않음을 산출물 검사로 확인했습니다.
이 미리보기 실행 명령은 개발/테스트용이며 배포 관리자 화면·로그인 우회가 아닙니다.

## 구현 화면

- 메뉴 목록·이름 부분 검색·카테고리·상태 필터·기본/가격 정렬과 판매 중/판매 중지/비공개 배지.
- 비공개 메뉴 및 비활성 옵션을 포함한 상세, 가격·조리시간·옵션 기본/활성 여부·생성/수정 시각.
- 메뉴 등록 모달: 기본 정보·초기 상태·옵션 추가/제거. 제거는 저장 전 신규 옵션 행에만 적용합니다.
- 메뉴 수정 모달: 정보·옵션 필드 변경, 신규 옵션 추가, 기존 옵션은 ID를 보존하고 활성 체크 해제로 비활성화.
- 별도 판매 상태 변경 모달: 세 상태 전이·HIDDEN 복귀, 동일 상태 재요청은 시각 유지.
- 로딩·빈 목록·조회/상세 실패·입력 오류·저장 실패와 재시도. 저장 실패 시 폼 입력을 유지합니다.
- 데스크톱 행 목록과 좁은 화면의 카드 배치, 폼의 2열→1열 미디어 쿼리.
- native dialog, 레이블·에러 안내·aria-live, 초기 초점·Tab 경계 순환·Escape 취소·본문 스크롤 잠금·복귀 로직.

시각/키보드/실제 DOM 상호작용은 아래 미검증 한계를 참고하세요.

## 제안 DTO 매핑 — 확정 계약 아님

근거는 원본 PR의 제안 문서이며 프로젝트 확정으로 변경하지 않았습니다.

- [ME-03·04](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/237b2eb95803b6bbbd49926fd77761d26ac8f9f1/docs/api/menu-me03-me04-draft.md): list({categoryId,query,status,sort}) → ApiResponse({categories,menus}); detail(id) → 상세·options. 세 상태 포함, trim/대소문자 무시 이름 검색, `%/_`는 문자, 가격 동률은 ID ASC. 빈 카테고리도 유지합니다.
- [ME-05](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/c94ae37bda88196fdd2f0409debc0264cd291557/docs/api/menu-me05-draft.md): create(request) → ApiResponse({menuId}), HTTP 201 제안. 상태 필수·옵션 0개 허용. isDefault=false, active=true 기본값.
- [ME-06](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/895c1ed60cca9a20b88f6da3c5135e5dbe190035/docs/api/menu-me06-draft.md): update(id,patch) → ApiResponse({menuId}), HTTP 200 제안. 폼에서 변경한 필드만 전송하고 기존 옵션은 optionId + 변경 필드만 매핑합니다. 누락 옵션 유지·신규 옵션 추가, 상태 필드는 포함하지 않습니다.
- [ME-07](https://github.com/ktcloud-cloudnative-2026/team02-5xx/blob/aff347e5827d4b87f2b68f4fc4237f9103187a74/docs/api/menu-me07-draft.md): changeStatus(id,status) → ApiResponse({menuId,status}), HTTP 200 제안. 동일 상태는 updatedAt 유지, 모든 전이와 HIDDEN 복귀 허용.

Mock 메서드는 HTTP가 아닌 비동기 메모리 호출입니다. 성공 envelope·입력/미존재 오류 코드를 모의할 뿐 실제 200/201·DB 트랜잭션·인증 성공을 뜻하지 않습니다.
유효성 검사는 필수값·blank/NUL·255 Unicode code point·비음수 Integer 범위·상태·옵션 소유권·중복 ID·미지원 필드를 확인합니다.
JS ID는 양의 safe integer까지만 다룹니다. 서버 Long 전체 범위의 직렬화 정책은 실제 API 연결 시 합의해야 합니다.
등록 플래그 null은 기본값으로 처리하지만 PATCH의 명시적 null 플래그는 오류로 구분합니다.
수정 폼의 빈 설명/이미지 주소는 null 제거로 매핑합니다. 초기 등록 상태의 화면 초깃값은 PAUSED이지만 요청에는 필수 status를 명시하며 화면에도 제안 초깃값임을 표시합니다.
기본 옵션 개수·이름 유일성·Inventory 재고 판단은 임의로 추가하지 않았습니다. 이미지 주소를 원격에서 내려받거나 표시하지 않습니다.

Mock 쓰기는 모든 참조·검증을 마친 복사본을 한 번에 교체합니다. 실패 시 기존 데이터·ID 할당을 보존합니다.
옵션 ID·createdAt·상태 이외 필드가 변경 요청에 섞이지 않게 하고 쓰기 후 목록을 다시 조회합니다.
Mock은 메모리 전용이며 서버 잠금·트랜잭션·동시성 보장 검증을 대체하지 않습니다.

## 실행 및 자동 검증

Node 24.22.3 / npm 11.19.1, 기존 React/Vite/Prettier만 사용했습니다. 새 라이브러리나 테스트 프레임워크를 추가하지 않았고 lockfile도 변경하지 않았습니다.

```powershell
cd services/web-frontend
npm.cmd ci
npm.cmd test
npm.cmd run format:check
npm.cmd run build
npm.cmd run check:admin-boundary
npm.cmd run preview:admin
```

최종 Node 내장 테스트 **69건 통과, 실패·취소·생략 0건**입니다.
Mock 목록/검색/필터/정렬·CRUD·옵션 ID/누락/null·9개 전이·잘못된 요청·실패 보존/재시도·독립 인스턴스·네트워크 미사용,
폼의 최소 PATCH와 오류 행 매핑, 포커스 보조 로직의 모의 DOM, 실제 React SSR·고객 회귀, 미리보기 HTTP/정적 번들 검사를 포함합니다.
Prettier 전체 검사·고객 build·제품 번들 경계 검사도 통과했습니다.
기존 고객 파일의 CRLF 때문에 발생한 포맷 경고는 LF로 정규화해 해결했고 HEAD와 Git blob이 동일함을 확인했습니다. 고객 코드 변경은 커밋에 포함하지 않습니다.
npm ci 조회 시 audit는 취약점 0건이었습니다. 실제 서버·브라우저 보안 검증을 의미하지 않습니다.

## 실제 브라우저 검증 차단 및 남은 수동 QA

실브라우저 연결 시 Browser access host unavailable 오류가 발생했습니다.
Chrome native 접근도 도구가 현재 브라우저 URL을 신뢰성 있게 확인하지 못해 정책상 중단했습니다.
다른 UI 자동화 방식으로 우회하지 않았습니다. **실제 브라우저 CRUD·모달 Escape/Tab·포커스 복귀·스크롤 복원·모바일/데스크톱 시각 검증은 미완료**입니다.
SSR·모의 DOM 보조 함수 통과를 실제 UI 상호작용이나 접근성 통과로 환산하지 않습니다.

아래를 미리보기에서 수동 검증해야 합니다.

1. 1440×900, 390×844, 320×640과 200% 확대에서 가로 넘침·버튼/폼 접근·대화상자 스크롤 확인.
2. 검색 trim/대소문자·카테고리·상태 조합·가격 동률 정렬·조건 초기화·빈 결과 확인.
3. 새 메뉴 등록: 필수값 오류→값 보존, 옵션 0개·신규 옵션 추가/제거, 저장 후 목록·상세 일치 확인.
4. 기존 메뉴 수정: description/imageUrl 비우기, 옵션 ID 유지·활성 해제·신규 옵션 추가·미변경 필드 보존 확인.
5. 세 상태 및 HIDDEN 복귀, 동일 상태 재저장의 수정 시각 유지 확인.
6. 시나리오 도구의 다음 조회/저장 실패: 오류 안내, 폼 보존, 재시도 성공 및 빈 목록 재시작 확인.
7. 모달 첫/끝 Tab·Shift+Tab 경계 및 내부 이동, Escape/닫기/취소·저장 중 닫기 차단, 초점/본문 스크롤 복귀 확인.
8. 필터로 원래 행이 사라진 경우 새 메뉴 등록 버튼으로 복귀하는지, 오래된 상세 응답이 닫은 모달을 다시 열지 않는지 확인.
9. 실제 고객 진입점에 관리자/Mock 미리보기나 변경 경로가 없는지, 콘솔/네트워크 오류·경고를 확인.

## 보존 및 후속 통합

시작 시 모든 기존 로컬 브랜치 ref, bin 133개·백업 4개의 SHA-256을 기록했습니다. #128과 기존 PR 브랜치·WIP는 보존하며 bin·백업을 편집·복구·삭제·스테이징하지 않습니다.
근거와 테스트 로그는 TEMP의 peak129-395a9d128d2b4f7dacabf1f8add21363에 보관합니다.
최종 대조에서 기존 브랜치 ref 변경 0건, 보호 파일 137개 해시 변화·삭제 0건, bin 133개 유지를 확인했습니다.
#116 장바구니와 합칠 때 고객 App·모달·공유 스타일 회귀를 수행해야 합니다. 현재 이 브랜치에는 #116 코드가 없으므로 장바구니 회귀 성공을 주장하지 않습니다.
#105·#117·#119·#123·#127 병합 및 #112 인증/오류/DTO 계약 확정 후 실제 adapter와 보호된 관리자 진입점을 연결해야 합니다.
실제 STORE_ADMIN 성공·비회원 401·CUSTOMER 403·Gateway 신뢰 경계·서버 오류/동시 수정·DB 검증은 모두 미완료입니다.
이번 작업은 로컬 구현·검사·문서·커밋까지이며 Push·PR 생성·리뷰 요청·Ready 전환·승인·병합은 수행하지 않습니다.

## 최신 main 통합 및 Draft 제출 전 재검증

후속 제출 단계에서 origin/main `8ce02f07eaf46a6b02074d1a2e92bbcd54c7b086`을 #129 브랜치에 merge했습니다.
충돌은 없었고 Cooking·설계 문서 26개 파일의 변경만 반영됐습니다. 기존 구현 `17dba147` 대비 프론트엔드 코드 변경은 없습니다.
#116·#105·#117·#119·#123·#127은 여전히 Open이며 해당 미병합 코드를 가져오지 않았습니다.

Node 24.22.3 / npm 11.19.1에서 `npm.cmd test`를 다시 실행해 **69건 통과, 실패·취소·생략 0건**을 확인했습니다.
목록·검색·필터·정렬, 상세·옵션·등록·부분 수정·상태 변경, 로딩/오류 렌더링·실패/재시도·입력 검증,
고객 회귀·미리보기 HTTP·포커스 보조 로직 검사를 포함합니다. Prettier 전체 검사·제품 build·관리자 번들 제외 검사도 통과했습니다.
`git diff --check`와 main 기준 diff 검사도 통과했으며 PR 범위는 web-frontend 18개 파일입니다.
다른 서비스·생성 산출물·bin·백업은 PR에 포함하지 않습니다.

**실브라우저 QA는 미완료**입니다. 브라우저 연결을 재시도하지 않았으며 위 수동 QA 절차를 그대로 유지합니다.
모달 키보드 조작·포커스 복귀·스크롤 복원·반응형 시각 검증과 실제 브라우저 CRUD를 통과했다고 표시하지 않습니다.
실제 API·JWT·보호된 관리자 제품 라우트 및 #116 통합도 여전히 미완료입니다.

제출 단계 시작 시 보호 파일 해시와 기존 브랜치 ref를 다시 기록했습니다. bin 133개·백업 4개 해시 변화·삭제 0건,
#128·#108·#110·#118·#120·#124 및 로컬 main ref 변경 0건을 확인했습니다. WIP `242765d`는 #108 브랜치에 보존됩니다.
근거 로그는 TEMP의 peak129-submit-40790374961e4f33aaf4070318829c9b에 보관합니다.
이번 후속 단계는 일반 Push와 main 대상 Draft PR 제출까지 수행하며 리뷰 요청·Ready 전환·승인·병합은 하지 않습니다.
