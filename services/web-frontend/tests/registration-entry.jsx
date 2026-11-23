import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { createRegistrationApi } from '../src/registration/registrationApi.js';
import { authSession } from '../src/authSession.js';
import { registrationTerms } from '../src/registration/registrationTerms.js';
import '../src/index.css';
const api = createRegistrationApi();
const registrationApi = {
  ...api,
  checkEmail: (email, options) =>
    api.checkEmail(email, window.__ignoreRegistrationAbort ? {} : options),
};
window.__registration = { session: authSession };
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App
      registrationTerms={
        new URLSearchParams(location.search).has('missing-terms')
          ? []
          : registrationTerms
      }
      registrationApi={registrationApi}
    />
  </StrictMode>,
);

if (new URLSearchParams(location.search).has('preview')) {
  const banner = document.createElement('aside');
  banner.setAttribute('aria-label', '테스트 미리보기 안내');
  banner.style.cssText =
    'padding:12px;background:#fff3cd;color:#302500;position:relative;z-index:1';
  banner.textContent =
    'HTTP fixture 시연 — 실제 Auth 서버가 아닙니다. 실제 개인정보를 입력하지 마세요. 시나리오: ';
  for (const [scenario, label] of [
    ['success', '정상'],
    ['conflict', '409 중복'],
    ['invalid', '400 입력 오류'],
    ['terms', '400 약관 버전'],
    ['unavailable', '503'],
    ['network', '연결 끊김'],
  ]) {
    const link = document.createElement('a');
    link.href = `/__preview/scenario/${scenario}`;
    link.textContent = `${label} · `;
    banner.append(link);
  }
  document.body.prepend(banner);
}
