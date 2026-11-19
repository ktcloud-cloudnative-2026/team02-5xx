import useDialog from '../useDialog.js';
import Cart from './Cart.jsx';

export default function CartOverlay({ onClose, ...props }) {
  const { close, ...dialog } = useDialog(onClose);
  return (
    <dialog {...dialog} className="cart-modal" aria-labelledby="cart-title">
      <Cart {...props} onBack={close} />
    </dialog>
  );
}
