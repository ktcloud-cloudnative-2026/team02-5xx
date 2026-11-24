export class CongestionError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function validateCongestion(data) {
  if (
    !data ||
    !['NORMAL', 'CROWDED'].includes(data.level) ||
    !['waitingCount', 'cookingCount', 'expectedWaitSec'].every(
      (key) => Number.isSafeInteger(data[key]) && data[key] >= 0,
    )
  )
    throw new CongestionError(
      'INVALID_RESPONSE',
      '혼잡도 응답을 확인할 수 없어요.',
    );
  return {
    level: data.level,
    waitingCount: data.waitingCount,
    cookingCount: data.cookingCount,
    expectedWaitSec: data.expectedWaitSec,
  };
}

export function createCongestionApi({
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
} = {}) {
  return {
    async get({ signal } = {}) {
      const timeout = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetchImpl('/api/v1/cooking/congestion', {
          method: 'GET',
          credentials: 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok)
          throw new CongestionError(
            'HTTP_ERROR',
            '혼잡도를 조회하지 못했어요. 다시 시도해 주세요.',
            response.status,
          );
        let json;
        try {
          json = await response.json();
        } catch {
          throw new CongestionError(
            'INVALID_RESPONSE',
            '혼잡도 응답을 확인할 수 없어요.',
          );
        }
        if (json?.success !== true || typeof json.message !== 'string')
          throw new CongestionError(
            'INVALID_RESPONSE',
            '혼잡도 응답을 확인할 수 없어요.',
          );
        return validateCongestion(json.data);
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (timeout.aborted)
          throw new CongestionError(
            'TIMEOUT',
            '혼잡도 조회 시간이 초과됐어요. 다시 시도해 주세요.',
          );
        if (error instanceof CongestionError) throw error;
        throw new CongestionError(
          'NETWORK_ERROR',
          '혼잡도 연결을 확인하지 못했어요. 다시 시도해 주세요.',
        );
      }
    },
  };
}

export function formatWait(seconds) {
  const minutes = Math.floor(seconds / 60),
    rest = seconds % 60;
  return minutes ? `${minutes}분${rest ? ` ${rest}초` : ''}` : `${rest}초`;
}
