const cancelled = () =>
  new DOMException('이전 메뉴 요청은 적용하지 않았어요.', 'AbortError');
const isDenied = (error) => [401, 403].includes(error?.status);

/** A page-local permission boundary, independent of global authentication. */
export function createAdminMenuAccess(adapter) {
  let active = true,
    revision = 0,
    listTicket = 0;
  let snapshot = Object.freeze({ denied: false, error: null });
  const listeners = new Set();
  function publish(next) {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  }
  function check(ticket, signal) {
    if (!active || ticket !== revision || signal?.aborted) throw cancelled();
  }
  function deny(error) {
    revision++;
    publish({ denied: true, error });
  }
  async function call(name, args) {
    const ticket = revision;
    if (!active || snapshot.denied) throw cancelled();
    try {
      const result = await adapter[name](...args);
      check(ticket);
      return result;
    } catch (error) {
      check(ticket);
      if (isDenied(error)) deny(error);
      throw error;
    }
  }
  const guarded = Object.freeze({
    kind: adapter.kind,
    async list(filters, options = {}) {
      if (!active || options.signal?.aborted) throw cancelled();
      const ticket = revision,
        request = ++listTicket;
      try {
        const result = await adapter.list(filters, options);
        check(ticket, options.signal);
        if (request !== listTicket) throw cancelled();
        if (snapshot.denied) publish({ denied: false, error: null });
        return result;
      } catch (error) {
        check(ticket, options.signal);
        if (request !== listTicket) throw cancelled();
        if (isDenied(error)) deny(error);
        throw error;
      }
    },
    detail: (...args) => call('detail', args),
    create: (...args) => call('create', args),
    update: (...args) => call('update', args),
    changeStatus: (...args) => call('changeStatus', args),
  });
  return Object.freeze({
    adapter: guarded,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    activate() {
      active = true;
    },
    dispose() {
      active = false;
      revision++;
      listTicket++;
    },
  });
}
