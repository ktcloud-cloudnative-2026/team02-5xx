import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lockDialogScroll } from '../src/dialogScroll.js';

for (const outerFirst of [false, true]) {
  test(`nested dialog scroll remains locked until both close (outer first: ${outerFirst})`, () => {
    const body = { style: { overflow: 'auto' } };
    const releaseOuter = lockDialogScroll(body);
    const releaseInner = lockDialogScroll(body);
    assert.equal(body.style.overflow, 'hidden');
    const [first, last] = outerFirst
      ? [releaseOuter, releaseInner]
      : [releaseInner, releaseOuter];
    first();
    assert.equal(body.style.overflow, 'hidden');
    first();
    assert.equal(body.style.overflow, 'hidden');
    last();
    assert.equal(body.style.overflow, 'auto');
  });
}

test('reopening a dialog captures the restored original style independently', () => {
  const body = { style: { overflow: '' } };
  lockDialogScroll(body)();
  assert.equal(body.style.overflow, '');
  body.style.overflow = 'scroll';
  const release = lockDialogScroll(body);
  release();
  release();
  assert.equal(body.style.overflow, 'scroll');
});
