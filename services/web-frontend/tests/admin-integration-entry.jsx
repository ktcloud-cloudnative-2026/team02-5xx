import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Application from '../src/Application.jsx';
import '../src/index.css';

function Controls() {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    fetch('/__admin-integration')
      .then((r) => r.json())
      .then((r) => setConfig(r.data));
  }, []);
  return (
    <aside
      aria-label="통합 검수 도구"
      style={{
        padding: 24,
        borderTop: '2px solid #c79a35',
        background: '#fff5dc',
        position: 'relative',
        zIndex: 3,
      }}
    >
      <strong>고객·관리자 통합 HTTP fixture · 검수 전용</strong>
      <p>
        실제 Gateway·서비스와 연결하지 않습니다. 시나리오 변경 시 검수 데이터와
        인증을 초기화합니다.
      </p>
      {config && (
        <label>
          시나리오{' '}
          <select
            aria-label="통합 시나리오"
            value={config.scenario}
            onChange={async (event) => {
              await fetch('/__admin-integration', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scenario: event.target.value }),
              });
              window.location.reload();
            }}
          >
            {config.scenarios.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p>
        로그인: admin@example.test / customer@example.test · 비밀번호:
        fixture-only-password
      </p>
      <p>
        공통 홈 시나리오에서 같은 로그인 폼으로 계정을 바꿔 검수하세요. 정상
        관리자 시나리오는 검수용 관리자 인증을 복원합니다. 1440·390·320px에서
        확인하세요.
      </p>
    </aside>
  );
}
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Application />
    <Controls />
  </StrictMode>,
);
