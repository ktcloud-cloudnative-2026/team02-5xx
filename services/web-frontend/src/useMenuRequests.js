import { useEffect, useState } from 'react';

// Both cancellation and identity guards are needed: an adapter may ignore AbortSignal.
export function useMenuRequest(key, request, dependencies) {
  const [result, setResult] = useState({ key: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setResult({ key, loading: true });
    Promise.resolve()
      .then(() => request(controller.signal))
      .then(
        (data) => {
          if (current) setResult({ key, data });
        },
        (error) => {
          if (current && !controller.signal.aborted) setResult({ key, error });
        },
      );
    return () => {
      current = false;
      controller.abort();
    };
  }, [...dependencies, attempt]);
  return {
    ...(result.key === key ? result : { loading: true }),
    retry: () => {
      setResult({ key, loading: true });
      setAttempt((value) => value + 1);
    },
  };
}
