// Synthetic IN-01 contract for existing browser regression fixtures only.
export function inventoryFixtureHandler(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname !== '/api/v1/inventory/availability') return false;
  const ids = url.searchParams.get('menuIds')?.split(',').map(Number) ?? [];
  const valid =
    ids.length > 0 &&
    ids.length <= 100 &&
    ids.every((id) => Number.isSafeInteger(id) && id > 0);
  response.writeHead(valid ? 200 : 400, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({
      success: valid,
      data: valid
        ? ids.map((menuId) => ({
            menuId,
            orderable: true,
            availableQty: 100000,
          }))
        : null,
      message: 'HTTP fixture only',
    }),
  );
  return true;
}
