export const DEFAULT_MENU_IMAGE = '/images/defaults/menu-placeholder.svg';
const photos = Object.freeze({
  '클래식 버거': 'classic-burger',
  '더블 치즈 버거': 'double-cheese-burger',
  '더블 버거': 'double-cheese-burger',
  '치즈 버거': 'cheese-burger',
  '크리스피 치킨 버거': 'crispy-chicken-burger',
  '머시룸 버거': 'mushroom-burger',
  '프렌치 프라이': 'french-fries',
  프렌치프라이: 'french-fries',
  '어니언 링': 'onion-rings',
  어니언링: 'onion-rings',
  치킨너겟: 'chicken-nuggets',
  '아이스 아메리카노': 'iced-americano',
  '레몬 에이드': 'lemon-ade',
  '바닐라 아이스크림': 'vanilla-ice-cream',
  콜라: 'cola',
  '클래식 버거 세트': 'classic-burger-set',
});
export function menuImage({ imageUrl, name } = {}) {
  if (typeof imageUrl === 'string' && imageUrl.trim()) return imageUrl;
  const key = typeof name === 'string' ? name.trim() : '';
  const photo = Object.hasOwn(photos, key) ? photos[key] : null;
  return photo ? `/images/menus/${photo}.webp` : DEFAULT_MENU_IMAGE;
}
