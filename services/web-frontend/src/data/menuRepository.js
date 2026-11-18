import { categories, menus } from './mockMenus.js';

// ME-01·02 연결 시 이 모듈의 데이터 접근을 교체합니다. 현재 API 요청은 없습니다.
export function getCategories() {
  return categories;
}

export function getMenus({
  categoryId = 'all',
  query = '',
  sort = 'default',
} = {}) {
  const search = query.trim().toLocaleLowerCase('ko-KR');
  const result = menus.filter(
    (menu) =>
      menu.status !== 'HIDDEN' &&
      (categoryId === 'all' || menu.categoryId === categoryId) &&
      menu.name.toLocaleLowerCase('ko-KR').includes(search),
  );
  if (sort === 'priceAsc') result.sort((a, b) => a.basePrice - b.basePrice);
  if (sort === 'priceDesc') result.sort((a, b) => b.basePrice - a.basePrice);
  return result;
}

export function getMenu(id) {
  return (
    menus.find((menu) => menu.id === id && menu.status !== 'HIDDEN') ?? null
  );
}
