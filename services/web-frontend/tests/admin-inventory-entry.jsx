import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AdminInventoryPage from '../src/admin-inventory/AdminInventoryPage.jsx';
import { inventoryScenarios } from './admin-inventory-scenarios.js';
function Preview() {
  const [scenario, setScenario] = useState('normal');
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function apply() {
    setBusy(true);
    setError('');
    try {
      const result = await fetch('/__fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      if (!result.ok) throw new Error('시나리오 적용에 실패했어요.');
      setKey((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <AdminInventoryPage
        key={key}
        environmentNotice="HTTP fixture 전용 미리보기 · 가상 데이터입니다. 실제 Inventory/Auth/Gateway 인증 성공을 의미하지 않아요."
      />
      <aside className="ai-preview-tools" aria-label="HTTP fixture 검수 도구">
        <p style={{ fontSize: 13, marginBottom: 12 }}>
          검수 도구 · 적용하면 샘플 재고를 초기화합니다. 기본 #104는 예약
          0이어도 활성 주문이 있어 연결 변경·삭제가 거절됩니다.
        </p>
        <label>
          검수 시나리오{' '}
          <select
            value={scenario}
            disabled={busy}
            onChange={(e) => setScenario(e.target.value)}
            style={{ maxWidth: '100%', padding: 8 }}
          >
            {Object.entries(inventoryScenarios).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="ai-button"
          disabled={busy}
          onClick={apply}
          style={{ margin: '8px' }}
        >
          시나리오 적용·초기화
        </button>
        <p role="alert">{error}</p>
      </aside>
    </>
  );
}
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
