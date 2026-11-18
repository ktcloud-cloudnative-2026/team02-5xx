import useDialog from '../useDialog.js';

export default function LoginModal({ onClose }) {
  const { close, ...dialog } = useDialog(onClose);
  return (
    <dialog
      {...dialog}
      className="login-modal"
      aria-labelledby="login-title"
      aria-describedby="login-description"
    >
      <div className="detail-toolbar">
        <button
          className="close-button"
          aria-label="로그인 안내 닫기"
          onClick={close}
          autoFocus
        >
          ×
        </button>
      </div>
      <div className="login-content">
        <span className="eyebrow">PEAK ORDER</span>
        <h2 id="login-title">로그인이 필요해요</h2>
        <p id="login-description">
          장바구니와 주문은 로그인 후 이용할 수 있어요.
          <br />
          선택한 메뉴와 옵션, 수량은 그대로 유지됩니다.
        </p>
        <div className="login-placeholder">
          <p>로그인 연결을 준비하고 있어요.</p>
          <p>현재는 로그인하거나 주문할 수 없습니다.</p>
        </div>
        <button className="pill-button" disabled>
          로그인 연결 준비 중
        </button>
        <button className="text-button" onClick={close}>
          선택한 화면으로 돌아가기
        </button>
      </div>
    </dialog>
  );
}
