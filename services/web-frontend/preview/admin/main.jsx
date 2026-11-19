import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AdminMenuPage from '../../src/components/admin/AdminMenuPage.jsx';
import { createMockAdminMenuAdapter } from '../../src/data/admin/mockAdminMenuAdapter.js';

function AdminPreview() {
  const [empty, setEmpty] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [message, setMessage] = useState('');
  const adapter = useMemo(
    () => createMockAdminMenuAdapter(empty ? { initialMenus: [] } : undefined),
    [empty, generation],
  );
  return (
    <>
      <AdminMenuPage key={`${empty}-${generation}`} adapter={adapter} />
      <details
        style={{
          margin: '12px 20px 20px',
          font: '12px sans-serif',
          color: '#435448',
        }}
      >
        <summary>미리보기 시나리오 도구 (제품에 포함되지 않음)</summary>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 14,
            padding: '14px 0',
          }}
        >
          <button
            onClick={() => {
              adapter.failNext('list');
              setMessage(
                '다음 새로고침 또는 검색에 모의 조회 실패가 적용됩니다.',
              );
            }}
          >
            다음 조회 실패
          </button>
          <button
            onClick={() => {
              adapter.failNext('write');
              setMessage('다음 등록·수정·상태 저장에 모의 실패가 적용됩니다.');
            }}
          >
            다음 저장 실패
          </button>
          <label>
            <input
              type="checkbox"
              checked={empty}
              onChange={(event) => {
                setEmpty(event.target.checked);
                setMessage('미리보기 데이터를 새로 구성했습니다.');
              }}
            />{' '}
            빈 목록으로 재시작
          </label>
          <button
            onClick={() => {
              setGeneration((value) => value + 1);
              setMessage('모의 샘플을 초기화했습니다.');
            }}
          >
            모의 샘플 초기화
          </button>
          <span role="status">{message}</span>
        </div>
      </details>
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AdminPreview />
  </StrictMode>,
);
