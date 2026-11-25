import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationRoute,
  replaceApplicationRoute,
  sessionIdentity,
} from '../src/applicationRoute.js';
const guest = { authenticated: false, phase: 'anonymous' };
const user = (role, id = 1) => ({
  authenticated: true,
  phase: 'authenticated',
  role,
  user: { id, role },
});
const decide = (session, hash, options = {}) =>
  applicationRoute(session, hash, { restored: true, ...options });
const customerPaths = [
  '#home',
  '#menu-list',
  '#cart',
  '#checkout',
  '#orders',
  '#orders/1',
  '#account',
  '#account/profile',
  '#account/password',
];
const adminPaths = [
  '#admin',
  '#admin/menus',
  '#admin/orders',
  '#admin/orders?page=1',
  '#admin/inventory',
  '#admin/cooking',
  '#admin/missing',
];
for (const hash of customerPaths)
  test(`role boundary: ${hash}`, () => {
    assert.deepEqual(decide(user('CUSTOMER'), hash), {
      screen: 'customer',
      redirect: null,
    });
    assert.deepEqual(decide(user('STORE_ADMIN'), hash), {
      screen: 'admin',
      route: null,
      redirect: '#admin',
    });
  });
for (const hash of adminPaths)
  test(`admin boundary: ${hash}`, () => {
    assert.deepEqual(decide(guest, hash), {
      screen: 'customer',
      redirect: '#home',
    });
    assert.deepEqual(decide(user('CUSTOMER'), hash), {
      screen: 'customer',
      redirect: '#home',
    });
    const result = decide(user('STORE_ADMIN'), hash);
    assert.equal(result.screen, 'admin');
    assert.equal(result.redirect, null);
    assert.equal(
      result.route.id,
      hash === '#admin/missing'
        ? 'not-found'
        : (hash.split('?')[0].split('/')[1] ?? 'dashboard'),
    );
  });
for (const session of [
  guest,
  user('CUSTOMER'),
  user('STORE_ADMIN'),
  user('UNKNOWN'),
])
  test(`no application mounts before restoration: ${session.role ?? 'guest'}`, () => {
    assert.deepEqual(decide(session, '#admin', { restored: false }), {
      screen: 'restoring',
    });
    assert.deepEqual(decide({ ...session, phase: 'restoring' }, '#home'), {
      screen: 'restoring',
    });
  });
test('guests can browse public menus and cart without login', () => {
  for (const hash of ['#home', '#menu-list', '#cart'])
    assert.deepEqual(decide(guest, hash), {
      screen: 'customer',
      redirect: null,
    });
});
test('truthy role hints without a verified authenticated snapshot cannot mount admin', () => {
  for (const authenticated of [false, null, undefined, 'true', 1])
    assert.deepEqual(
      decide({ ...user('STORE_ADMIN'), authenticated }, '#admin'),
      { screen: 'customer', redirect: '#home' },
    );
});
test('default address is normalized according to verified role', () => {
  for (const hash of ['', '#']) {
    assert.equal(decide(guest, hash).redirect, '#home');
    assert.equal(decide(user('CUSTOMER'), hash).redirect, '#home');
    assert.equal(decide(user('STORE_ADMIN'), hash).redirect, '#admin');
  }
});
test('unknown role, missing user ID and inconsistent role never mount either App', () => {
  for (const session of [
    user('UNKNOWN'),
    user('CUSTOMER', 0),
    { ...user('STORE_ADMIN'), role: 'CUSTOMER' },
    { authenticated: true, role: 'STORE_ADMIN' },
  ])
    for (const hash of ['#home', '#admin'])
      assert.deepEqual(decide(session, hash), { screen: 'unsupported' });
});
test('logout returns to home once; later public navigation is allowed', () => {
  assert.equal(
    decide({ ...guest, reason: 'logout' }, '#cart', { sessionEnded: true })
      .redirect,
    '#home',
  );
  assert.equal(
    decide({ ...guest, reason: 'logout' }, '#menu-list').redirect,
    null,
  );
  assert.equal(
    decide({ ...guest, reason: 'expired' }, '#orders', { sessionEnded: true })
      .redirect,
    '#home',
  );
});
test('identity boundary distinguishes owners and roles without reading browser storage', () => {
  assert.equal(sessionIdentity(guest), null);
  assert.notEqual(
    sessionIdentity(user('CUSTOMER')),
    sessionIdentity(user('CUSTOMER', 3)),
  );
  assert.notEqual(
    sessionIdentity(user('CUSTOMER')),
    sessionIdentity(user('STORE_ADMIN')),
  );
});
test('route correction replaces history once and announces it to existing hash subscribers', () => {
  const saved = globalThis.window,
    calls = [];
  globalThis.window = {
    location: { hash: '#admin/orders' },
    history: {
      replaceState(state, _, hash) {
        calls.push({ state, hash });
        globalThis.window.location.hash = hash;
      },
    },
    dispatchEvent(event) {
      calls.push(event.type);
    },
  };
  try {
    replaceApplicationRoute('#home');
    replaceApplicationRoute('#home');
    assert.deepEqual(calls, [
      { state: null, hash: '#home' },
      'peak-order-route',
    ]);
  } finally {
    globalThis.window = saved;
  }
});
