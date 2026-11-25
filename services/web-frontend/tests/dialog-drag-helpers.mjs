import assert from 'node:assert/strict';
export async function pointerGesture(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}
export async function dragMatrix(page, modal) {
  const box = await modal.boundingBox();
  const size = page.viewportSize();
  const inside = { x: box.x + box.width / 2, y: Math.max(0, box.y) + 12 };
  const outside =
    box.x > 3
      ? { x: box.x / 2, y: Math.min(size.height - 2, Math.max(4, box.y + 20)) }
      : box.y > 3
        ? { x: size.width / 2, y: box.y / 2 }
        : box.x + box.width < size.width - 3
          ? { x: size.width - 2, y: size.height / 2 }
          : null;
  if (!outside) {
    await pointerGesture(page, inside, { x: inside.x + 15, y: inside.y + 5 });
    assert.equal(await modal.evaluate((node) => node.open), true);
    return { outsideAvailable: false, inside };
  }
  for (const [from, to] of [
    [inside, outside],
    [outside, inside],
    [inside, { x: inside.x + 15, y: inside.y + 5 }],
    [inside, inside],
  ]) {
    await pointerGesture(page, from, to);
    assert.equal(
      await modal.evaluate((node) => node.open),
      true,
      'drag or inside click must preserve the dialog',
    );
  }
  return { outsideAvailable: true, inside, outside };
}

// MenuDetail/Checkout fill the viewport in the product and have no outside
// coordinates. Expose a margin ONLY in this test to exercise their shared
// backdrop handlers using real pointer events; product CSS is never changed.
export async function exposeTestBackdrop(modal) {
  await modal.evaluate((node) =>
    Object.assign(node.style, {
      position: 'fixed',
      inset: '40px auto auto 40px',
      margin: '0',
      width: 'calc(100vw - 80px)',
      height: 'calc(100dvh - 80px)',
      maxHeight: 'calc(100dvh - 80px)',
    }),
  );
}
