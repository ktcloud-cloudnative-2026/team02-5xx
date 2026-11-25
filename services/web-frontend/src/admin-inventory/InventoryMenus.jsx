import { createContext, useContext, useEffect, useState } from 'react';
import { menuApi as publicMenuApi } from '../data/menuApi.js';

const Directory = createContext(null);
export function InventoryMenus({ children, api = publicMenuApi }) {
  const [version, setVersion] = useState(0);
  const [catalog, setCatalog] = useState({ phase: 'loading', menus: [] });
  useEffect(() => {
    const controller = new AbortController();
    setCatalog({ phase: 'loading', menus: [] });
    api
      .list(
        {},
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        },
      )
      .then((data) => {
        if (!controller.signal.aborted)
          setCatalog({ phase: 'ready', menus: data.menus });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setCatalog({ phase: 'error', menus: [], error });
      });
    return () => controller.abort();
  }, [api, version]);
  return (
    <Directory.Provider
      value={{
        api,
        catalog,
        version,
        retry: () => {
          setCatalog({ phase: 'loading', menus: [] });
          setVersion((value) => value + 1);
        },
      }}
    >
      {children}
    </Directory.Provider>
  );
}

export function InventoryMenuName({ item }) {
  const { api, catalog, version } = useContext(Directory);
  const known = catalog.menus.find((menu) => menu.id === item.menuId);
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    setDetail(null);
    if (item.menuId === null || known || catalog.phase === 'loading') return;
    const controller = new AbortController();
    api
      .detail(item.menuId, {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
      })
      .then((menu) => {
        if (!controller.signal.aborted)
          setDetail({ id: item.menuId, name: menu.name, version });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setDetail({ id: item.menuId, unavailable: true, version });
      });
    return () => controller.abort();
  }, [api, item.menuId, known, catalog.phase, version]);
  const current =
    detail?.id === item.menuId &&
    detail.version === version &&
    catalog.phase !== 'loading'
      ? detail
      : null;
  return (
    <div className="ai-menu-identity">
      <strong>
        {item.menuId === null
          ? '미연결 재고'
          : (known?.name ?? current?.name ?? `메뉴 ID ${item.menuId}`)}
      </strong>
      <span className="ai-muted">
        재고 #{item.stockItemId}
        {item.menuId !== null && ` · 메뉴 ID ${item.menuId}`}
      </span>
      {item.menuId !== null && !known && !current?.name && (
        <span className="ai-help">
          {current?.unavailable
            ? '메뉴 이름 조회 불가 · 비공개·미존재 또는 조회 오류'
            : '메뉴 이름 확인 중…'}
        </span>
      )}
    </div>
  );
}

export function MenuDirectoryStatus() {
  const { catalog, retry } = useContext(Directory);
  return (
    <div className="ai-menu-directory-status">
      {catalog.phase === 'error' ? (
        <>
          <span>메뉴 목록 조회 불가 · 재고 조회와 수량은 유지됩니다.</span>
          <button className="ai-button" type="button" onClick={retry}>
            메뉴 다시 조회
          </button>
        </>
      ) : catalog.phase === 'loading' ? (
        <span>메뉴 이름을 조회하고 있어요.</span>
      ) : (
        <button className="ai-button" type="button" onClick={retry}>
          메뉴 이름 새로고침
        </button>
      )}
    </div>
  );
}

export function InventoryMenuPicker({ value, onChange, disabled }) {
  const { catalog, retry } = useContext(Directory);
  const [query, setQuery] = useState('');
  const selected = catalog.menus.find((menu) => menu.id === value);
  const found = catalog.menus.filter((menu) =>
    menu.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section className="ai-menu-picker" aria-label="등록할 재고의 메뉴 선택">
      <h3>메뉴 연결 (선택)</h3>
      <p className="ai-help">
        재고를 먼저 생성한 뒤 선택한 메뉴를 연결해요. 연결에 실패해도 생성된
        재고는 유지됩니다.
      </p>
      <button
        type="button"
        className="ai-button"
        aria-pressed={value === null}
        disabled={disabled}
        onClick={() => onChange(null)}
      >
        메뉴 미연결로 등록
      </button>
      <label className="ai-field">
        메뉴 이름 검색
        <input
          type="search"
          value={query}
          disabled={disabled || catalog.phase !== 'ready'}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="공개 메뉴 이름 검색"
        />
      </label>
      <p className="ai-help" role="status">
        {value === null
          ? '선택: 미연결'
          : `선택: ${selected?.name ?? `메뉴 ID ${value}`} · 메뉴 ID ${value}`}
      </p>
      {catalog.phase === 'loading' ? (
        <p role="status">메뉴 목록 조회 중…</p>
      ) : catalog.phase === 'error' ? (
        <div role="alert">
          <p>메뉴 목록을 조회하지 못했어요. 미연결 등록은 가능해요.</p>
          <button
            type="button"
            className="ai-button"
            disabled={disabled}
            onClick={retry}
          >
            메뉴 목록 재시도
          </button>
        </div>
      ) : (
        <div
          className="ai-menu-choices"
          role="group"
          aria-label="연결 가능한 공개 메뉴"
        >
          {found.length ? (
            found.map((menu) => (
              <button
                type="button"
                className="ai-menu-choice"
                key={menu.id}
                aria-pressed={value === menu.id}
                disabled={disabled}
                onClick={() => onChange(menu.id)}
              >
                <strong>{menu.name}</strong>
                <span>
                  메뉴 ID {menu.id} ·{' '}
                  {menu.status === 'PAUSED' ? '판매 중지' : '판매 중'}
                </span>
                <span aria-hidden="true">{value === menu.id ? '✓' : '＋'}</span>
              </button>
            ))
          ) : (
            <p>검색 결과가 없어요.</p>
          )}
        </div>
      )}
    </section>
  );
}
