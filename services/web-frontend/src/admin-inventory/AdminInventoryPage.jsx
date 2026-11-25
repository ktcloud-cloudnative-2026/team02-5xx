import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import useDialog from '../useDialog.js';
import {
  createInventoryAdminApi,
  parseInventoryNumber,
  MAX_STOCK,
} from './inventoryAdminApi.js';
import { createInventoryAdminStore } from './inventoryAdminStore.js';
import './adminInventory.css';
import {
  InventoryMenus,
  InventoryMenuName,
  InventoryMenuPicker,
  MenuDirectoryStatus,
} from './InventoryMenus.jsx';
const defaultApi = createInventoryAdminApi();
const number = (value) => new Intl.NumberFormat('ko-KR').format(value);
function Icon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      {name === 'grid' ? (
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
      ) : name === 'stock' ? (
        <path d="M3 4h18v5H3zM5 9v12h14V9M9 13h6" />
      ) : name === 'menu' ? (
        <path d="M5 3h14v18H5zM9 3v18M12 7h4M12 11h4" />
      ) : (
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6" />
      )}
    </svg>
  );
}
function StockBadge({ item }) {
  return (
    <span
      className={`ai-badge ${item.availableQty === 0 ? 'ai-sold' : item.lowStock ? 'ai-low' : ''}`}
    >
      {item.availableQty === 0 ? '품절' : item.lowStock ? '부족' : '정상'}
    </span>
  );
}
function StockFacts({ item }) {
  return (
    <dl className="ai-facts">
      {[
        ['실제 재고', `${number(item.stockQty)}개`],
        ['예약 수량', `${number(item.reservedQty)}개`],
        ['가용 수량', `${number(item.availableQty)}개`],
        ['부족 기준', `${number(item.lowStockThreshold)}개`],
        ['서버 부족 여부', item.lowStock ? '예' : '아니오'],
        [
          '연결 메뉴',
          item.menuId === null ? '미연결' : `메뉴 ID ${item.menuId}`,
        ],
      ].map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function WorkPanel({ panel, mutation, busy, list, store }) {
  const { close, ...dialog } = useDialog(() => store.close(), true, {
    canClose: () => !store.getSnapshot().busy,
  });
  const [stockQty, setStockQty] = useState('');
  const [threshold, setThreshold] = useState('');
  const [quantity, setQuantity] = useState('');
  const [menuId, setMenuId] = useState(
    (panel.suggestedMenuId ?? panel.item?.menuId)?.toString() ?? '',
  );
  const [selectedMenu, setSelectedMenu] = useState(null);
  const [linkMode, setLinkMode] = useState('connect');
  const [errors, setErrors] = useState({});
  const isCreate = panel.kind === 'create',
    isRestock = panel.kind === 'restock';
  const title = isCreate
    ? '재고 등록'
    : isRestock
      ? '입고 처리'
      : '메뉴 연결·해제';
  const uncertain = mutation.phase === 'uncertain';
  const blocked =
    busy ||
    (uncertain && !mutation.reviewed) ||
    (uncertain && mutation.reviewed && !isCreate && !mutation.currentItem) ||
    [401, 403].includes(mutation.error?.status) ||
    [401, 403].includes(list.error?.status);
  const commonHint = 'ai-action-error';
  const field = (name, label, value, update, hint, hintId) => (
    <label className="ai-field">
      {label}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          update(e.target.value);
          setErrors((previous) => ({ ...previous, [name]: undefined }));
        }}
        disabled={busy}
        aria-invalid={!!errors[name]}
        aria-describedby={`${hintId} ${name}-error ${commonHint}`}
      />
      <span className="ai-help" id={hintId}>
        {hint}
      </span>
      <span className="ai-field-error" id={`${name}-error`}>
        {errors[name]}
      </span>
    </label>
  );
  async function submit(event) {
    event.preventDefault();
    if (blocked) return;
    const nextErrors = {},
      body = {};
    const read = (key, raw, options) => {
      try {
        return parseInventoryNumber(raw, options);
      } catch (error) {
        nextErrors[key] = error.message;
      }
    };
    if (isCreate) {
      body.stockQty = read('stockQty', stockQty);
      body.lowStockThreshold = read('threshold', threshold);
      body.menuId = selectedMenu;
    } else if (isRestock) {
      body.quantity = read('quantity', quantity, { positive: true });
      if (
        body.quantity !== undefined &&
        panel.item.stockQty + body.quantity > MAX_STOCK
      )
        nextErrors.quantity =
          '입고 후 실제 재고가 지원 범위를 초과해요. 수량을 줄여 주세요.';
    } else if (linkMode === 'disconnect') body.menuId = null;
    else body.menuId = read('menuId', menuId, { menuId: true });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    try {
      await store.submit(body);
    } catch (error) {
      setErrors({ form: error.message });
    }
  }
  return (
    <dialog {...dialog} className="ai-panel" aria-labelledby="ai-panel-title">
      <header className="ai-panel-head">
        <div>
          <p className="ai-eyebrow">재고 관리</p>
          <h2 id="ai-panel-title">{title}</h2>
          {panel.item && (
            <p className="ai-muted">재고 #{panel.item.stockItemId}</p>
          )}
        </div>
        <button
          className="ai-close"
          onClick={close}
          aria-label="작업 패널 닫기"
          disabled={busy}
          autoFocus
        >
          ×
        </button>
      </header>
      <form
        className="ai-panel-form"
        onSubmit={submit}
        noValidate
        aria-busy={busy}
      >
        <div className="ai-panel-body">
          {panel.partialCreate && (
            <p className="ai-partial" role="status">
              재고 #{panel.item.stockItemId} 생성은 완료됐어요. 메뉴 연결은
              완료되지 않았거나 결과 확인이 필요해요. 재고를 다시 등록하지 말고
              아래에서 연결을 다시 시도해 주세요.
            </p>
          )}
          {panel.item && (
            <section className="ai-current" aria-label="변경 전 서버 재고">
              <div className="ai-section-title">
                <h3>조회한 재고</h3>
                <StockBadge item={panel.item} />
              </div>
              <InventoryMenuName item={panel.item} />
              <StockFacts item={panel.item} />
            </section>
          )}
          {isCreate ? (
            <>
              <p className="ai-help ai-intro">
                실제 수량과 부족 기준을 등록하고, 선택한 메뉴를 이어서 연결해요.
                메뉴 없이 등록할 수도 있어요.
              </p>
              {field(
                'stockQty',
                '실제 재고 수량',
                stockQty,
                setStockQty,
                '0 이상 정수',
                'ai-stock-hint',
              )}
              {field(
                'threshold',
                '부족 기준 수량',
                threshold,
                setThreshold,
                '가용 수량이 이 기준 이하이면 서버가 부족으로 표시해요.',
                'ai-threshold-hint',
              )}
              <InventoryMenuPicker
                value={selectedMenu}
                onChange={setSelectedMenu}
                disabled={busy}
              />
            </>
          ) : isRestock ? (
            <>
              {field(
                'quantity',
                '추가 입고 수량',
                quantity,
                setQuantity,
                '1 이상 정수 · 재고를 추가하는 기능이에요.',
                'ai-quantity-hint',
              )}
              <div className="ai-quick" aria-label="입고 수량 빠른 입력">
                {[5, 10, 50].map((count) => (
                  <button
                    type="button"
                    className="ai-button"
                    disabled={busy}
                    key={count}
                    onClick={() => {
                      const current = /^\d+$/.test(quantity)
                        ? Number(quantity)
                        : 0;
                      if (
                        Number.isSafeInteger(current) &&
                        current + count <= MAX_STOCK
                      )
                        setQuantity(String(current + count));
                    }}
                  >
                    +{count}
                  </button>
                ))}
              </div>
              <p className="ai-help">
                예약 수량은 임의로 바꾸지 않아요. 입고 결과는 서버 응답으로
                확인합니다.
              </p>
            </>
          ) : (
            <>
              <fieldset className="ai-link-mode">
                <legend>변경 방법</legend>
                <label>
                  <input
                    type="radio"
                    name="link-mode"
                    checked={linkMode === 'connect'}
                    disabled={busy}
                    onChange={() => setLinkMode('connect')}
                  />
                  메뉴 연결
                </label>
                <label>
                  <input
                    type="radio"
                    name="link-mode"
                    checked={linkMode === 'disconnect'}
                    disabled={busy || panel.item.menuId === null}
                    onChange={() => setLinkMode('disconnect')}
                  />
                  메뉴 연결 해제
                </label>
              </fieldset>
              {linkMode === 'connect' ? (
                field(
                  'menuId',
                  '연결할 메뉴 ID',
                  menuId,
                  setMenuId,
                  '판매 중·판매 중지 메뉴의 ID를 입력해 주세요. HIDDEN 메뉴는 연결할 수 없어요.',
                  'ai-menu-hint',
                )
              ) : (
                <p className="ai-help">
                  메뉴 ID {panel.item.menuId} 연결을 해제해요. 재고 수량은
                  유지됩니다.
                </p>
              )}
              <p className="ai-help">
                진행 중이거나 복원 대상인 주문이 연결된 재고는 서버가 변경을
                거절할 수 있어요.
              </p>
            </>
          )}
          <div id="ai-action-error" role="alert" className="ai-action-error">
            {errors.form || mutation.error?.message || list.error?.message}
          </div>
          {uncertain && (
            <section className="ai-review" aria-label="변경 결과 확인">
              <strong>변경이 이미 반영됐을 수 있어요</strong>
              <p>
                현재 전체 목록을 조회하고 중복 등록·중복 입고가 되지 않는지
                확인해 주세요. 조회만으로 변경 요청을 다시 보내지 않아요.
              </p>
              <button
                className="ai-button"
                type="button"
                disabled={list.phase === 'loading' || busy}
                onClick={() => store.review()}
              >
                {list.phase === 'loading'
                  ? '현재 재고 확인 중…'
                  : '현재 재고 다시 확인'}
              </button>
              {mutation.reviewed && (
                <>
                  <p>
                    전체 목록을 새로 확인했어요. 이미 반영되었다면 패널을 닫아
                    주세요. 필요한 경우에만 다시 제출하세요.
                  </p>
                  {mutation.currentItem && (
                    <StockFacts item={mutation.currentItem} />
                  )}
                  {isCreate && mutation.reviewedRows && (
                    <details open>
                      <summary>
                        전체 재고 {mutation.reviewedRows.length}개 확인
                      </summary>
                      <ul className="ai-review-rows">
                        {mutation.reviewedRows.map((item) => (
                          <li key={item.stockItemId}>
                            재고 #{item.stockItemId} · 실제{' '}
                            {number(item.stockQty)}개 · 예약{' '}
                            {number(item.reservedQty)}개 · 부족 기준{' '}
                            {number(item.lowStockThreshold)}개 ·{' '}
                            {item.menuId === null
                              ? '미연결'
                              : `메뉴 ID ${item.menuId}`}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {panel.item && !mutation.currentItem && (
                    <p>
                      현재 전체 목록에 이 재고가 없어요. 삭제되었거나 더 이상
                      조회할 수 없는 상태일 수 있어요.
                    </p>
                  )}
                </>
              )}
            </section>
          )}
        </div>
        <footer className="ai-panel-footer">
          <button
            className="ai-button"
            type="button"
            onClick={close}
            disabled={busy}
          >
            취소
          </button>
          <button
            className="ai-button ai-primary"
            type="submit"
            disabled={blocked}
          >
            {busy
              ? '처리 중…'
              : uncertain && mutation.reviewed
                ? '확인 후 다시 제출'
                : isCreate
                  ? '재고 등록'
                  : isRestock
                    ? '입고 반영'
                    : linkMode === 'connect'
                      ? '메뉴 연결'
                      : '연결 해제'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
function DeleteConfirmation({ panel, mutation, busy, list, store }) {
  const { close, ...dialog } = useDialog(() => store.close(), true, {
    canClose: () => !store.getSnapshot().busy,
  });
  const [error, setError] = useState('');
  const uncertain = mutation.phase === 'uncertain';
  const missingAfterReview =
    uncertain && mutation.reviewed && !mutation.currentItem;
  async function remove() {
    try {
      await store.submit();
    } catch (failure) {
      setError(failure.message);
    }
  }
  return (
    <dialog
      {...dialog}
      className="ai-confirm"
      aria-labelledby="ai-delete-title"
    >
      <span className="ai-delete-symbol" aria-hidden="true">
        ⌫
      </span>
      <h2 id="ai-delete-title">재고 #{panel.item.stockItemId}을 삭제할까요?</h2>
      <InventoryMenuName item={panel.item} />
      <p>
        목록에서 논리 삭제하고 메뉴 연결을 해제해요. 기존 주문 기록을 삭제하는
        동작은 아니에요.
      </p>
      <p className="ai-muted">
        활성 주문과 관련된 재고는 서버가 삭제를 거절할 수 있어요.
      </p>
      <div className="ai-action-error" role="alert">
        {error || mutation.error?.message || list.error?.message}
      </div>
      {uncertain && (
        <div className="ai-review">
          <p>결과를 확인하기 전에는 삭제를 다시 요청하지 않아요.</p>
          <button
            className="ai-button"
            disabled={list.phase === 'loading'}
            onClick={() => store.review()}
          >
            현재 재고 다시 확인
          </button>
          {mutation.reviewed && (
            <p>
              {missingAfterReview
                ? '현재 전체 목록에 이 재고가 없어요. 목록으로 돌아가 확인해 주세요.'
                : '현재 재고를 확인했어요. 필요한 경우에만 다시 삭제해 주세요.'}
            </p>
          )}
        </div>
      )}
      <div className="ai-confirm-actions">
        <button className="ai-button" onClick={close} disabled={busy} autoFocus>
          {missingAfterReview ? '목록으로' : '취소'}
        </button>
        <button
          className="ai-button ai-primary"
          onClick={remove}
          disabled={
            busy ||
            (uncertain && !mutation.reviewed) ||
            missingAfterReview ||
            [401, 403].includes(mutation.error?.status) ||
            [401, 403].includes(list.error?.status)
          }
        >
          {busy ? '삭제 중…' : '삭제'}
        </button>
      </div>
    </dialog>
  );
}
function InventoryPageBody({
  api = defaultApi,
  environmentNotice,
  embedded = false,
}) {
  const store = useMemo(() => createInventoryAdminStore(api), [api]);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    store.activate();
    void store.load();
    return () => store.dispose();
  }, [store]);
  const listUnavailable = state.list.phase !== 'ready',
    locked = state.busy || listUnavailable;
  const Content = embedded ? 'div' : 'main';
  return (
    <div className="ai-app">
      {!embedded && (
        <>
          <a
            className="ai-skip"
            href="#ai-main"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('ai-main')?.focus();
            }}
          >
            재고 목록으로 건너뛰기
          </a>
          <aside className="ai-sidebar" aria-label="관리자 메뉴">
            <div className="ai-brand" aria-label="Peak Order">
              P
            </div>
            <nav aria-label="매장 관리">
              <span className="ai-inactive">
                <Icon name="grid" />
                대시보드
              </span>
              <span className="ai-active" aria-current="page">
                <Icon name="stock" />
                재고관리
              </span>
              <span className="ai-inactive">
                <Icon name="menu" />
                메뉴관리
              </span>
              <span className="ai-inactive">
                <Icon name="order" />
                주문 관리
              </span>
            </nav>
            <span className="ai-admin-label">관리자</span>
          </aside>
        </>
      )}
      <Content className="ai-main" id="ai-main" tabIndex={-1}>
        <header className="ai-page-heading">
          <div>
            <p className="ai-eyebrow">STORE MANAGEMENT</p>
            <h1>재고 관리</h1>
            <p className="ai-muted">
              실제·예약·가용 수량과 메뉴 연결을 관리하세요.
            </p>
          </div>
          <div className="ai-heading-actions">
            <button
              className="ai-refresh"
              aria-label="재고 목록 새로고침"
              disabled={state.list.phase === 'loading' || state.busy}
              onClick={() => store.load()}
            >
              ↻
            </button>
            <button
              className="ai-button ai-primary"
              disabled={locked}
              onClick={() => store.open('create')}
            >
              ＋ 재고 등록
            </button>
          </div>
        </header>
        {environmentNotice && (
          <aside className="ai-environment" role="note">
            {environmentNotice}
          </aside>
        )}
        <MenuDirectoryStatus />
        <section className="ai-card" aria-label="재고 목록">
          <div className="ai-toolbar">
            <div className="ai-filter" role="group" aria-label="재고 조회 범위">
              <button
                aria-pressed={!state.lowStockOnly}
                className={!state.lowStockOnly ? 'ai-selected' : ''}
                onClick={() => store.filter(false)}
              >
                전체 재고
              </button>
              <button
                aria-pressed={state.lowStockOnly}
                className={state.lowStockOnly ? 'ai-selected' : ''}
                onClick={() => store.filter(true)}
              >
                부족 항목만
              </button>
            </div>
            <p className="ai-muted">서버 ID 오름차순 · 부족 기준은 서버 판단</p>
          </div>
          <div className="ai-list-heading">
            <h2>
              {state.lowStockOnly ? '부족 재고' : '전체 재고'}{' '}
              <strong>
                {state.rows.length || state.list.phase === 'ready'
                  ? number(state.rows.length)
                  : '—'}
              </strong>
            </h2>
            <p className="ai-muted">
              품절은 가용 수량 0 · 부족 여부와 별도로 표시해요.
            </p>
          </div>
          <p className="ai-notice" role="status">
            {state.busy
              ? '변경 요청을 처리 중이에요. 중복 제출과 작업 패널 닫기는 잠시 기다려 주세요.'
              : state.notice}
          </p>
          {state.list.phase === 'loading' && (
            <p className="ai-loading" role="status">
              재고 목록을 불러오는 중이에요.
            </p>
          )}
          {state.list.phase === 'error' && (
            <div className="ai-list-error" role="alert">
              <h3>재고 목록을 확인하지 못했어요</h3>
              <p>{state.list.error.message}</p>
              {state.rows.length > 0 && (
                <p>
                  이전 조회 결과를 보존했어요. 변경 전 최신 목록을 다시 확인해
                  주세요.
                </p>
              )}
              <button
                className="ai-button"
                disabled={state.busy}
                onClick={() => store.load()}
              >
                다시 조회
              </button>
            </div>
          )}
          {state.rows.length > 0 ? (
            <div
              className="ai-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="재고 수량과 메뉴 연결 표"
            >
              <table className="ai-table">
                <caption className="ai-sr-only">재고 항목 목록</caption>
                <thead>
                  <tr>
                    {[
                      '메뉴 / 재고',
                      '실제 재고',
                      '예약 수량',
                      '가용 수량',
                      '부족 기준',
                      '재고 상태',
                      '연결 메뉴',
                      '관리',
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((item) => (
                    <tr key={item.stockItemId} data-stock-id={item.stockItemId}>
                      <td data-label="재고 ID">
                        <InventoryMenuName item={item} />
                      </td>
                      <td data-label="실제 재고">{number(item.stockQty)}개</td>
                      <td data-label="예약 수량">
                        {number(item.reservedQty)}개
                      </td>
                      <td data-label="가용 수량" className="ai-available">
                        {number(item.availableQty)}개
                      </td>
                      <td data-label="부족 기준">
                        {number(item.lowStockThreshold)}개
                      </td>
                      <td data-label="재고 상태">
                        <StockBadge item={item} />
                        <span className="ai-low-flag">
                          부족 여부: {item.lowStock ? '예' : '아니오'}
                        </span>
                      </td>
                      <td data-label="연결 메뉴">
                        <span
                          className={`ai-menu-badge ${item.menuId === null ? 'ai-unlinked' : ''}`}
                        >
                          {item.menuId === null
                            ? '미연결'
                            : `메뉴 ID ${item.menuId}`}
                        </span>
                      </td>
                      <td className="ai-row-actions">
                        <button
                          className="ai-button ai-primary"
                          disabled={locked}
                          aria-label={`재고 ${item.stockItemId} 입고`}
                          onClick={() =>
                            store.open('restock', item.stockItemId)
                          }
                        >
                          입고
                        </button>
                        <button
                          className="ai-button"
                          disabled={locked}
                          aria-label={`재고 ${item.stockItemId} 메뉴 연결`}
                          onClick={() => store.open('link', item.stockItemId)}
                        >
                          연결
                        </button>
                        <button
                          className="ai-button"
                          disabled={locked}
                          aria-label={`재고 ${item.stockItemId} 삭제`}
                          onClick={() => store.open('delete', item.stockItemId)}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : state.list.phase === 'ready' ? (
            <div className="ai-empty" role="status">
              <h3>
                {state.lowStockOnly
                  ? '부족한 재고가 없어요'
                  : '등록된 재고가 없어요'}
              </h3>
              <p>
                {state.lowStockOnly
                  ? '전체 재고에서 다른 항목을 확인할 수 있어요.'
                  : '실제 수량과 부족 기준으로 새 재고를 등록해 주세요.'}
              </p>
            </div>
          ) : null}
          <footer className="ai-card-footer">
            현재 조회 결과{' '}
            {state.rows.length || state.list.phase === 'ready'
              ? `${number(state.rows.length)}개 항목`
              : '확인 중'}
          </footer>
        </section>
        <footer className="ai-page-footer">
          PEAK ORDER · 관리자 재고 관리
        </footer>
      </Content>
      {state.panel &&
        (state.panel.kind === 'delete' ? (
          <DeleteConfirmation
            key={state.panel.key}
            panel={state.panel}
            mutation={state.mutation}
            list={state.list}
            busy={state.busy}
            store={store}
          />
        ) : (
          <WorkPanel
            key={state.panel.key}
            panel={state.panel}
            mutation={state.mutation}
            list={state.list}
            busy={state.busy}
            store={store}
          />
        ))}
    </div>
  );
}

export default function AdminInventoryPage({ menuApi, ...props }) {
  return (
    <InventoryMenus api={menuApi}>
      <InventoryPageBody {...props} />
    </InventoryMenus>
  );
}
