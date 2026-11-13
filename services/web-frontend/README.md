# 피크오더 웹 프론트엔드

React 기본 화면과 개발·빌드 환경을 제공하는 초기 프로젝트입니다.
고객·관리자 화면, 라우팅, API 연동, 상태 관리, Docker·Kubernetes 설정은 포함하지 않습니다.

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
피크오더 제목과 소개 문구, 스타일이 표시되는지 확인합니다.
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
- `src/App.jsx`: 기본 제목과 소개
- `src/index.css`: 기본 화면 스타일
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
현재 기본 화면에는 환경 변수나 백엔드 서버가 필요하지 않습니다.
저장소 공통 개발 규칙은 [CLAUDE.md](../../CLAUDE.md)를 따릅니다.
