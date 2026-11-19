import { useState } from 'react';
import { calculateTotal, formatPrice, MAX_QUANTITY } from '../menu.js';
import useDialog from '../useDialog.js';
import { describeItem } from '../cart.js';

export default function MenuDetail({
  menu,
  onClose,
  onAdd,
  onOrder,
  onViewCart,
  feedback,
}) {
  const { close: closeDetail, ...dialog } = useDialog(onClose);
  const options = menu?.options.filter((option) => option.active) ?? [];
  const [optionId, setOptionId] = useState(
    (options.find((option) => option.isDefault) ?? options[0])?.id ?? null,
  );
  const [quantity, setQuantity] = useState(1);
  const selectedOption = options.find((option) => option.id === optionId);
  const available = menu?.status === 'ON_SALE';

  const selection = {
    menuId: menu?.id,
    optionIds: selectedOption ? [selectedOption.id] : [],
    quantity,
  };
  let selectionError = '';
  try {
    describeItem(selection, () => menu);
  } catch (failure) {
    selectionError = failure.message;
  }

  return (
    <dialog {...dialog} className="detail-modal" aria-labelledby="detail-title">
      <div className="detail-toolbar">
        <button
          className="close-button"
          aria-label="메뉴 상세 닫기"
          onClick={closeDetail}
          autoFocus
        >
          ×
        </button>
      </div>
      <div className="detail-layout">
        {!available ? (
          <div className="detail-error" role="alert">
            <h2 id="detail-title">선택할 수 없는 메뉴예요</h2>
            <p>메뉴가 없거나 현재 판매 중이 아닙니다.</p>
            <button className="pill-button" onClick={closeDetail}>
              목록으로 돌아가기
            </button>
          </div>
        ) : (
          <>
            <div
              className="detail-photo"
              aria-label={`${menu.name} 이미지 준비 중`}
            >
              <span className="menu-photo" aria-hidden="true">
                메뉴 사진
              </span>
            </div>
            <div className="detail-content">
              <div
                className="detail-information"
                tabIndex="0"
                role="region"
                aria-label="메뉴 설명과 영양 정보"
              >
                <h2 id="detail-title">{menu.name}</h2>
                <p className="detail-description">{menu.description}</p>
                <dl className="nutrition">
                  {[
                    ['칼로리', menu.nutrition.calories, 'kcal'],
                    ['탄수화물', menu.nutrition.carbs, 'g'],
                    ['단백질', menu.nutrition.protein, 'g'],
                    ['지방', menu.nutrition.fat, 'g'],
                  ].map(([label, value, unit]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        {value}
                        <span>{unit}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <h3>재료</h3>
                <ul className="ingredients">
                  {menu.ingredients.map((ingredient) => (
                    <li key={ingredient}>{ingredient}</li>
                  ))}
                </ul>
              </div>
              <div className="detail-selection">
                <fieldset className="options">
                  <legend>옵션</legend>
                  {options.length ? (
                    <div className="option-list">
                      {menu.options.map((option) => (
                        <label
                          key={option.id}
                          className={`option ${optionId === option.id ? 'selected' : ''} ${!option.active ? 'unavailable' : ''}`}
                        >
                          <input
                            type="radio"
                            name="menu-option"
                            value={option.id}
                            checked={optionId === option.id}
                            disabled={!option.active}
                            onChange={() => setOptionId(option.id)}
                          />
                          <span>
                            {option.name}
                            {option.extraPrice > 0 &&
                              ` +${formatPrice(option.extraPrice)}`}
                            {!option.active && ' (선택 불가)'}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="no-options">추가 옵션이 없는 메뉴입니다.</p>
                  )}
                </fieldset>
                <div className="quantity-row">
                  <span id="quantity-label">수량</span>
                  <div
                    className="quantity-control"
                    role="group"
                    aria-labelledby="quantity-label"
                  >
                    <button
                      aria-label="수량 줄이기"
                      disabled={quantity === 1}
                      onClick={() =>
                        setQuantity((value) => Math.max(1, value - 1))
                      }
                    >
                      −
                    </button>
                    <output aria-label="선택 수량" aria-live="polite">
                      {quantity}
                    </output>
                    <button
                      aria-label="수량 늘리기"
                      disabled={quantity === MAX_QUANTITY}
                      onClick={() =>
                        setQuantity((value) =>
                          Math.min(MAX_QUANTITY, value + 1),
                        )
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="total-row">
                  <span>총 금액</span>
                  <output aria-label="총 금액" aria-live="polite">
                    {selectionError
                      ? '금액 확인 불가'
                      : formatPrice(
                          calculateTotal(
                            menu.basePrice,
                            selectedOption?.extraPrice ?? 0,
                            quantity,
                          ),
                        )}
                  </output>
                </div>
                <p
                  className="selection-feedback"
                  role="status"
                  aria-live="polite"
                >
                  {selectionError || feedback}
                </p>
                <div className="detail-actions">
                  <button
                    className="pill-button"
                    disabled={Boolean(selectionError)}
                    onClick={() => onAdd(selection)}
                  >
                    장바구니에 담기
                  </button>
                  <button
                    className="text-button"
                    disabled={Boolean(selectionError)}
                    onClick={() => onOrder(selection)}
                  >
                    주문하기
                  </button>
                  <button className="text-button" onClick={onViewCart}>
                    장바구니 보기
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
