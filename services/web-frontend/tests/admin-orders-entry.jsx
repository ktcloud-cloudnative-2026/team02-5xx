// Independent preview entry; never imported by the customer product entry.
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminOrdersPage from '../src/admin-orders/AdminOrdersPage.jsx';
import { adminScenarios } from './admin-orders-scenarios.mjs';
const params = new URLSearchParams(location.search);
const scenario = Object.hasOwn(adminScenarios, params.get('scenario'))
  ? params.get('scenario')
  : 'normal';
await fetch(`/__admin-orders/scenario?name=${scenario}`, { method: 'POST' });
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AdminOrdersPage
      environmentNotice={
        <>
          <strong>HTTP FIXTURE PREVIEW · 가상 주문</strong> — 실제 관리자
          인증·Order 연결이 아닙니다.
          <details>
            <summary>샘플·오류 시나리오</summary>
            <p>
              목록의 내부 ID 47: 임시, 46: 실패·환불 미완료, 45: 수동 확인, 44:
              취소 완료, 43: 조리 중, 42: 대기, 40: 완료. 과거 주문 검색:
              PO-20200101-0001
            </p>
            <nav
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                marginTop: 10,
              }}
            >
              {Object.entries(adminScenarios).map(([key, label]) => (
                <a key={key} href={`/?scenario=${key}#admin-orders`}>
                  {label}
                </a>
              ))}
            </nav>
          </details>
        </>
      }
    />
  </StrictMode>,
);
