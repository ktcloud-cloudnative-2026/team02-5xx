import { useRef, useState } from 'react';
import { getCategories, getMenu, getMenus } from './data/menuRepository.js';
import MenuDetail from './components/MenuDetail.jsx';
import { formatPrice } from './menu.js';

export default function App() {
  const [categoryId, setCategoryId] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('default');
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const openerRef = useRef(null);
  const menus = getMenus({ categoryId, query, sort });
  const selectedMenu = selectedId === null ? null : getMenu(selectedId);

  function openMenu(id, event) {
    const menu = getMenu(id);
    if (!menu || menu.status !== 'ON_SALE') {
      setError('선택할 수 없는 메뉴입니다. 다른 메뉴를 선택해 주세요.');
      return;
    }
    openerRef.current = event.currentTarget;
    setError('');
    setSelectedId(id);
  }

  function closeMenu() {
    setSelectedId(null);
    openerRef.current?.focus();
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#menu-list">
        메뉴 목록으로 건너뛰기
      </a>
      <aside className="sidebar" aria-label="피크오더">
        <div className="brand" aria-label="피크오더">
          로고
        </div>
        <nav aria-label="고객 메뉴">
          <a className="nav-item active" href="#menu-list" aria-current="page">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
            </svg>
            메뉴
          </a>
        </nav>
      </aside>
      <main className="menu-page">
        <header className="page-heading">
          <h1>
            <strong>메뉴</strong> 카테고리
          </h1>
          <label className="search-field">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <span className="sr-only">메뉴 검색</span>
            <input
              type="search"
              placeholder="메뉴를 검색해 보세요"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </header>
        <div className="categories" role="group" aria-label="메뉴 카테고리">
          {[{ id: 'all', name: '전체' }, ...getCategories()].map((category) => (
            <button
              key={category.id}
              className={`category ${categoryId === category.id ? 'selected' : ''}`}
              aria-pressed={categoryId === category.id}
              onClick={() => setCategoryId(category.id)}
            >
              <span className="category-image" aria-hidden="true" />
              {category.name}
            </button>
          ))}
        </div>
        <section id="menu-list" aria-labelledby="list-title" tabIndex="-1">
          <div className="list-heading">
            <h2 id="list-title">
              <strong>메뉴</strong> 고르기
            </h2>
            <label className="sort-field">
              정렬
              <select
                aria-label="메뉴 정렬"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="default">기본순</option>
                <option value="priceAsc">낮은 가격순</option>
                <option value="priceDesc">높은 가격순</option>
              </select>
            </label>
          </div>
          <p className="sr-only" role="status">
            메뉴 {menus.length}개
          </p>
          {error && <p role="alert">{error}</p>}
          {menus.length ? (
            <div className="menu-grid">
              {menus.map((menu) => (
                <button
                  key={menu.id}
                  className="menu-card"
                  disabled={menu.status !== 'ON_SALE'}
                  onClick={(event) => openMenu(menu.id, event)}
                  aria-label={`${menu.name}, ${formatPrice(menu.basePrice)}${menu.status === 'PAUSED' ? ', 판매 중지' : ', 상세 보기'}`}
                >
                  <span className="menu-photo" aria-hidden="true">
                    메뉴 사진
                  </span>
                  <span className="menu-name">{menu.name}</span>
                  <span className="menu-price">
                    {formatPrice(menu.basePrice)}
                  </span>
                  {menu.status === 'PAUSED' && (
                    <span className="status-badge">판매 중지</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state" role="status">
              <h3>
                {query.trim() ? '검색 결과가 없어요' : '등록된 메뉴가 없어요'}
              </h3>
              <p>다른 카테고리나 검색어로 메뉴를 찾아보세요.</p>
              <button
                className="pill-button"
                onClick={() => {
                  setCategoryId('all');
                  setQuery('');
                }}
              >
                전체 메뉴 보기
              </button>
            </div>
          )}
        </section>
      </main>
      {selectedId !== null && (
        <MenuDetail key={selectedId} menu={selectedMenu} onClose={closeMenu} />
      )}
    </div>
  );
}
