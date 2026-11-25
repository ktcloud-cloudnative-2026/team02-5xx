import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { menuImage, DEFAULT_MENU_IMAGE } from '../src/menuImages.js';

test('menu photos match exact names independently of IDs, with API priority and a safe fallback', async () => {
  for (const [name, file] of [
    ['클래식 버거', 'classic-burger'],
    ['더블 치즈 버거', 'double-cheese-burger'],
    ['크리스피 치킨 버거', 'crispy-chicken-burger'],
    ['머시룸 버거', 'mushroom-burger'],
    ['프렌치 프라이', 'french-fries'],
    ['어니언 링', 'onion-rings'],
    ['콜라', 'cola'],
    ['클래식 버거 세트', 'classic-burger-set'],
  ]) {
    assert.equal(menuImage({ name, id: 999 }), `/images/menus/${file}.webp`);
    assert.ok(
      (
        await readFile(
          new URL(`../public/images/menus/${file}.webp`, import.meta.url),
        )
      ).length > 0,
    );
    assert.equal(
      menuImage({ name, imageUrl: '/custom-api-photo.webp' }),
      '/custom-api-photo.webp',
    );
  }
  for (const name of ['사진 없는 메뉴', 'constructor', 'toString', null])
    assert.equal(menuImage({ name, id: 1 }), DEFAULT_MENU_IMAGE);
});

test('the menu fallback references an existing valid SVG source asset', async () => {
  const svg = await readFile(
    new URL('../public/images/defaults/menu-placeholder.svg', import.meta.url),
    'utf8',
  );
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /viewBox="0 0 480 480"/);
  assert.match(svg, /<\/svg>\s*$/);
});
