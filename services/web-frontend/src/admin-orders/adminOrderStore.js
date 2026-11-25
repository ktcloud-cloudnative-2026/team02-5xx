export function createAdminOrderStore(api) {
  let snapshot = Object.freeze({
    query: null,
    selectedId: null,
    list: { phase: 'idle' },
    detail: { phase: 'idle' },
  });
  let disposed = false;
  const generations = { list: 0, detail: 0 },
    controllers = {},
    listeners = new Set();
  const publish = (next) => {
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  const stop = (kind) => {
    generations[kind]++;
    controllers[kind]?.abort();
  };
  function load(kind, key, operation) {
    if (disposed) return;
    stop(kind);
    const generation = generations[kind];
    const controller = new AbortController();
    controllers[kind] = controller;
    publish({ ...snapshot, [kind]: { phase: 'loading', key } });
    Promise.resolve()
      .then(() => {
        if (
          disposed ||
          generation !== generations[kind] ||
          controller.signal.aborted
        )
          return;
        return operation(controller.signal);
      })
      .then((data) => {
        if (!disposed && generation === generations[kind])
          publish({ ...snapshot, [kind]: { phase: 'ready', key, data } });
      })
      .catch((error) => {
        if (
          disposed ||
          generation !== generations[kind] ||
          controller.signal.aborted
        )
          return;
        if ([401, 403].includes(error.status)) {
          stop('list');
          stop('detail');
          publish({
            ...snapshot,
            list: { phase: 'error', error },
            detail: { phase: 'error', error },
          });
        } else publish({ ...snapshot, [kind]: { phase: 'error', key, error } });
      });
  }
  const store = {
    clear() {
      stop('list');
      stop('detail');
      publish({
        query: null,
        selectedId: null,
        list: { phase: 'idle' },
        detail: { phase: 'idle' },
      });
    },
    activate() {
      disposed = false;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    setRoute(query, selectedId = null) {
      if (disposed) return;
      const changed = JSON.stringify(query) !== JSON.stringify(snapshot.query);
      const detailChanged = selectedId !== snapshot.selectedId || changed;
      publish({ ...snapshot, query, selectedId });
      if (changed) load('list', query, (signal) => api.list(query, { signal }));
      if (detailChanged) {
        stop('detail');
        if (selectedId === null)
          publish({ ...snapshot, detail: { phase: 'idle' } });
        else
          load('detail', selectedId, (signal) =>
            api.detail(selectedId, { signal }),
          );
      }
    },
    retryList() {
      const query = snapshot.query;
      if (query) load('list', query, (signal) => api.list(query, { signal }));
    },
    retryDetail() {
      const id = snapshot.selectedId;
      if (id !== null)
        load('detail', id, (signal) => api.detail(id, { signal }));
    },
    dispose() {
      disposed = true;
      stop('list');
      stop('detail');
      listeners.clear();
      snapshot = Object.freeze({
        query: null,
        selectedId: null,
        list: { phase: 'idle' },
        detail: { phase: 'idle' },
      });
    },
  };
  return Object.freeze(store);
}
