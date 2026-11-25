import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AdminDashboard from '../../src/admin-dashboard/AdminDashboard.jsx';

const config = await fetch('/__dashboard/config').then((response) =>
  response.json(),
);
function Preview() {
  const [scenario, setScenario] = useState(config.scenario);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <AdminDashboard
        key={revision}
        navigation={
          config.menuOrigin
            ? { menu: { href: config.menuOrigin, label: '메뉴 관리 · Mock' } }
            : {}
        }
        environmentNotice="독립 HTTP fixture · 실제 Order/Cooking/Inventory/Auth/Gateway 연결 및 관리자 인증 성공을 의미하지 않습니다. 메뉴 관리는 기존 #132 Mock 미리보기입니다."
      />
      <section
        aria-label="HTTP fixture 시나리오"
        style={{
          padding: '24px',
          background: '#fff5dc',
          borderTop: '1px solid #e9d4a2',
          fontFamily: 'sans-serif',
        }}
      >
        <strong>검수용 HTTP fixture</strong>
        <p>
          시나리오 변경 시 샘플 운영 상태가 초기화됩니다. 실제 서버에는 요청하지
          않습니다.
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
              try {
                const response = await fetch('/__dashboard/scenario', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ scenario: next }),
                });
                if (!response.ok) throw new Error('fixture');
                setScenario(next);
                setRevision((value) => value + 1);
              } finally {
                setBusy(false);
              }
            }}
            style={{ padding: 8, maxWidth: '100%' }}
          >
            {config.scenarios.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p style={{ fontSize: 12 }}>
          정상 → 영업/접수 전환 → 빈 상태 → 부분 오류/권한 오류 → 변경 결과 불명
          후 서버 상태 확인 → 390px/320px 순서로 확인하세요.
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
