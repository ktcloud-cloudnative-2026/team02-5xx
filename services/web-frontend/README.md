# 피크오더 웹 프론트엔드

Issue #77의 비회원 고객 메뉴 UI입니다. 카테고리·검색·가격 정렬, 메뉴 상세
모달, 단품/세트 옵션, 수량(1~99) 및 `(기본가 + 옵션 추가금) × 수량`을 표시합니다.
실제 API 요청, 로그인, 장바구니·localStorage, 주문·결제, 관리자 기능은 없습니다.

## 준비 환경

- Node.js 24 LTS (`.nvmrc`: 24.22.3)
- npm 11 (`packageManager`: npm@11.19.1)
- React / React DOM 19.3.1
- Vite 8.3.8, @vitejs/plugin-react 6.3.0
- Prettier 3.10.0

아래 명령은 저장소 루트에서 이 디렉터리로 이동한 뒤 실행합니다.
Windows PowerShell 실행 정책으로 `npm`이 차단되면 `npm.cmd`를 사용합니다.

```powershell
cd services/web-frontend
node --version
npm.cmd --version
npm.cmd ci
```

직접 의존성은 정확한 버전으로 고정하며 `package-lock.json`을 Git으로 관리합니다.
체크아웃 후에는 `npm ci`로 lockfile에 기록된 의존성을 설치합니다.

## 개발 서버

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

브라우저에서 <http://127.0.0.1:5173>을 엽니다.
카테고리와 메뉴 카드가 표시되는지 확인합니다.
개발자 도구 Console과 Network에서 JavaScript 오류·실패한 리소스 요청이 없는지 확인합니다.
포트가 사용 중이면 `--strictPort`에 따라 오류로 종료되므로 기존 프로세스를 확인하거나 다른 포트를 지정합니다.
서버 종료는 실행한 터미널에서 `Ctrl+C`를 누릅니다.

## 포맷

```powershell
npm.cmd run format
npm.cmd run format:check
```

`format`은 이 서비스 내부 파일에 포맷을 적용합니다.
`format:check`는 파일을 수정하지 않으며 포맷이 다르면 실패합니다.
UTF-8, LF, 공백 2칸, 세미콜론, 작은따옴표, 줄 길이 80, trailing comma `all`을 사용합니다.
`.editorconfig`는 서비스 내부에만 적용하며 Markdown의 끝 공백을 유지합니다.
생성물과 lockfile은 `.prettierignore`에서 제외합니다.

## 프로덕션 빌드 및 로컬 확인

```powershell
npm.cmd run format:check
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

빌드 결과는 `dist/`에 생성됩니다.
브라우저에서 <http://127.0.0.1:4173>을 열고 개발 화면과 같은 내용이 표시되는지 확인합니다.
Console과 Network에서 JavaScript 오류·실패한 리소스 요청이 없는지도 확인합니다.
Preview는 빌드 결과를 로컬에서 확인하는 서버이며 운영 배포 서버가 아닙니다.
확인 후 `Ctrl+C`로 종료합니다.

## 파일 및 Git 확인

- `src/main.jsx`: React 실행 진입점과 StrictMode
- `src/App.jsx`: 카테고리·검색·정렬·메뉴 목록
- `src/components/MenuDetail.jsx`: 상세 모달·옵션·수량·총액
- `src/data/mockMenus.js`: 별도 카테고리·메뉴 샘플
- `src/data/menuRepository.js`: 목록/상세 데이터 접근 (향후 ME-01·02 연결 지점)
- `src/menu.js`: 금액 표시·계산과 수량 상한
- `src/index.css`: 시안 기반 스타일·모바일 반응형
- `vite.config.js`: React 플러그인 설정
- `index.html`: 한국어 문서와 앱 진입 HTML
- `.nvmrc`, `.editorconfig`, `.prettierrc.json`: 실행 환경 및 포맷
- `.gitignore`, `.prettierignore`: 생성물·로컬 환경 파일 제외

```powershell
npm.cmd ls --depth=0
git status --short --untracked-files=all
git status --short --ignored services/web-frontend
```

`node_modules/`, `dist/`, 로그, `.env` 파일은 Git에 포함하지 않습니다.
환경 변수나 백엔드 서버가 필요하지 않습니다.
저장소 공통 개발 규칙은 [CLAUDE.md](../../CLAUDE.md)를 따릅니다.

## Mock 확인 방법과 설계 범위

- 전체 메뉴 8개 중 머시룸 버거는 `PAUSED`로 카드 선택을 막습니다.
- `HIDDEN`인 비공개 테스트 버거는 목록과 상세 조회에서 제외합니다.
- 판매 상태는 Menu 상태이며 재고 품절을 뜻하지 않습니다. Inventory 조회는 없습니다.
- 클래식 버거 6,500원에서 세트 +2,500원, 수량 2를 선택하면 18,000원입니다.
- 비활성 라지 세트는 선택할 수 없습니다. 콜라는 추가 옵션이 없습니다.
- 더블 치즈 버거는 긴 설명·재료 스크롤 확인용입니다.
- 디저트 카테고리나 일치하지 않는 검색어로 빈 목록·전체 복귀를 확인합니다.
- 모달은 닫기·Escape로 닫을 수 있고, 키보드 포커스가 모달 내부에 머물며
  닫은 후 선택했던 카드로 돌아갑니다. 메뉴를 다시 열면 옵션·수량이 초기화됩니다.
- 잘못된 ID·HIDDEN 상세는 `getMenu`가 `null`을 반환하며 상세 모달은
  없는 메뉴 또는 판매 중지 메뉴를 받으면 복귀 안내를 표시합니다.

데이터는 ERD의 camelCase 필드(`basePrice`, `extraPrice`, `isDefault`, `active`)를
참고한 UI 샘플이며 아직 확정 API 응답 DTO가 아닙니다. 영양·재료 정보도 샘플입니다.
실제 ME-01·02 연결 시 `menuRepository.js`에서 응답을 화면 모델로 변환합니다.

루트 `design-reference/menu-ui/`의 목록 PNG와 상세 PNG 2개를 참고했습니다.
회색 배경, 카테고리 타일, 4열 카드, 분할 상세·영양·옵션 배치를 따릅니다.
범위 밖인 장바구니 패널·주문·찜·로그인 이동은 생략했습니다. 그에 따라
1800px 미만에서는 목록이 남은 폭을 사용하며, 1800px 이상에서는 시안의 목록 폭을 유지합니다.
인기순 데이터가 없어 기본순/가격순을 제공하고, 메뉴명·가격은 mock 값입니다.
사진·카테고리 그림은 시안과 같은 자리표시자이며, 모바일 시안이 없어 작은 화면은
상단 메뉴 바·가로 스크롤 카테고리·2열 카드·세로 상세로 구성했습니다.
