export class InventoryApiError extends Error {
  constructor(message = '재고 확인 불가. 다시 확인해 주세요.', status = 0) {
    super(message);
    this.status = status;
  }
}
const validId = (id) => Number.isSafeInteger(id) && id > 0;
export function createInventoryApi({
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
} = {}) {
  return {
    async availability(menuIds, { signal } = {}) {
      if (!Array.isArray(menuIds) || !menuIds.every(validId))
        throw new InventoryApiError(
          '재고를 확인할 메뉴 번호가 올바르지 않아요.',
        );
      const ids = [...new Set(menuIds)];
      const result = new Map();
      for (let offset = 0; offset < ids.length; offset += 100) {
        signal?.throwIfAborted();
        const batch = ids.slice(offset, offset + 100);
        let response, envelope;
        try {
          response = await fetchImpl(
            `/api/v1/inventory/availability?menuIds=${batch.join(',')}`,
            {
              method: 'GET',
              headers: { Accept: 'application/json' },
              credentials: 'same-origin',
              redirect: 'error',
              cache: 'no-store',
              signal: signal
                ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
                : AbortSignal.timeout(timeoutMs),
            },
          );
          envelope = await response.json();
        } catch (error) {
          if (signal?.aborted) throw error;
          throw new InventoryApiError();
        }
        signal?.throwIfAborted();
        if (
          !response.ok ||
          envelope?.success !== true ||
          !Array.isArray(envelope.data)
        )
          throw new InventoryApiError(undefined, response.status);
        const seen = new Set();
        for (const row of envelope.data) {
          if (
            !row ||
            !batch.includes(row.menuId) ||
            seen.has(row.menuId) ||
            typeof row.orderable !== 'boolean' ||
            !Number.isInteger(row.availableQty) ||
            row.availableQty < 0 ||
            row.availableQty > 2147483647 ||
            row.orderable !== row.availableQty > 0
          )
            throw new InventoryApiError();
          seen.add(row.menuId);
          result.set(row.menuId, Object.freeze({ ...row }));
        }
        if (seen.size !== batch.length) throw new InventoryApiError();
      }
      return result;
    },
  };
}
export const inventoryApi = createInventoryApi();
