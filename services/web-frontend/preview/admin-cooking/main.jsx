import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CookingPage from '../../src/admin-cooking/CookingPage.jsx';
import './preview.css';
const config = await fetch('/__cooking/config').then((response) =>
  response.json(),
);
if (!location.hash) history.replaceState(null, '', '#admin/cooking');
function Preview() {
  const [scenario, setScenario] = useState(config.current),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <div className="ac-preview-shell">
        <a
          className="ac-preview-skip"
          href="#cooking-content"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('cooking-content').focus();
          }}
        >
          본문으로 건너뛰기
        </a>
        <aside className="ac-preview-sidebar" aria-label="관리자 미리보기 탐색">
          <div className="ac-preview-logo">
            PEAK
            <br />
            ORDER<small>ADMIN</small>
          </div>
          <nav>
            <span>
              대시보드<small>통합 예정</small>
            </span>
            <span>
              재고 관리<small>통합 예정</small>
            </span>
            <span>
              메뉴 관리<small>통합 예정</small>
            </span>
            <span>
              주문 관리<small>통합 예정</small>
            </span>
            <span aria-current="page" className="ac-preview-active">
              ♧<strong>주문·조리 현황</strong>
            </span>
          </nav>
          <small className="ac-preview-admin">관리자 전용</small>
        </aside>
        <main id="cooking-content" tabIndex={-1}>
          <p className="ac-preview-notice" role="note">
            독립 HTTP fixture · 실제 Cooking/Auth/Gateway 인증 성공이 아닙니다.
            조회 전용이며 관리자 API 활성화나 신원 헤더 위조를 하지 않습니다.
          </p>
          <CookingPage key={revision} />
        </main>
      </div>
      <section
        className="ac-preview-controls"
        aria-label="Cooking HTTP fixture 시나리오"
      >
        <h2>검수용 HTTP fixture</h2>
        <p>
          정상 → 빈 목록 → 조리 중 여러 건/주문번호 생략 → 부분 장애/권한 → 지연
          순서로 확인하세요.
        </p>
        <label>
          시나리오{' '}
          <select
            aria-label="시나리오"
            value={scenario}
            disabled={busy}
            onChange={async (event) => {
              const next = event.target.value;
              setBusy(true);
              setError('');
              try {
                const response = await fetch('/__cooking/scenario', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ scenario: next }),
                });
                if (!response.ok) throw new Error();
                setScenario(next);
                setRevision((value) => value + 1);
              } catch {
                setError('시나리오 변경에 실패했어요. 다시 선택해 주세요.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {config.scenarios.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <p role="status">{error}</p>
        <p>
          #304 목표 경로는 #admin/cooking입니다. 다른 관리자 화면으로의 왕복
          탐색은 공통 레이아웃 통합 후 제공합니다.
        </p>
      </section>
    </>
  );
}
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
