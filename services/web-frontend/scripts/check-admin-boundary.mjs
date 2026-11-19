import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = await readdir(resolve(root, 'dist'), { recursive: true });
for (const file of files.filter((name) => /\.(html|js|css)$/.test(name))) {
  const source = await readFile(resolve(root, 'dist', file), 'utf8');
  for (const marker of [
    'memory-mock',
    'MOCK PREVIEW',
    'am-dialog',
    '미리보기 시나리오 도구',
    '모의 판매 상태를 변경했습니다',
  ])
    assert.ok(
      !source.includes(marker),
      `Admin preview leaked into product build: ${file} / ${marker}`,
    );
}
console.log('Product build contains no administrator preview/adapter entry.');
