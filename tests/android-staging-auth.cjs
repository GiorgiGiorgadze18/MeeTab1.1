'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const auth = fs.readFileSync(path.join(root, 'website/auth.js'), 'utf8');
const siteConfig = fs.readFileSync(path.join(root, 'website/site-config.js'), 'utf8');
const returnScript = fs.readFileSync(path.join(root, 'website/auth-return.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

async function checkLogin(hostname, configuredMode, expectedMode) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { addEventListener(event, fn) { this[event] = fn; }, classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  let destination;
  const window = { MEETAB_API_BASE: 'https://api.example.test', MEETAB_APP_MODE: configuredMode };
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const context = { window, document: { querySelector: element }, URLSearchParams, sessionStorage: storage, localStorage: storage,
    location: { hostname, search: '', assign(url) { destination = url; } } };
  vm.runInNewContext(siteConfig, context);
  vm.runInNewContext(auth, context);
  await window.MeeTabAuth.init();
  await element('#loginGoogle').click();
  assert.equal(destination, 'https://api.example.test/auth/google/start?mode=' + expectedMode);
}

function checkReturn(mode, ticket, expected) {
  const elements = { desc: {}, go: { hidden: true, click() { this.onclick(); } } };
  let destination;
  const location = { search: '?' + new URLSearchParams({ mode, ticket }), assign(url) { destination = url; }, replace(url) { destination = url; } };
  vm.runInNewContext(returnScript, { location, URLSearchParams, encodeURIComponent, document: { getElementById(id) { return elements[id]; } } });
  assert.equal(destination, expected);
}

async function checkBackend() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'meetab-staging-auth-'));
  const host = 'http://127.0.0.1:8943', appOrigin = 'https://appassets.androidplatform.net';
  const child = spawn(process.execPath, ['-r', path.join(__dirname, 'mock-provider.cjs'), 'server.js'], {
    cwd: path.join(root, 'backend'), stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, PORT: '8943', STAGING_PREVIEW_MODE: '1', API_ORIGIN: 'https://api.example.test',
      FRONTEND_URL: 'https://ui.example.test/preview/', DATA_FILE: path.join(folder, 'db.enc'),
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'), GOOGLE_CLIENT_ID: 'mock-id', GOOGLE_CLIENT_SECRET: 'mock-secret', DATABASE_URL: 'postgresql://mock-local-unit-test' }
  });
  const request = (route, options = {}) => fetch(host + route, { redirect: 'manual', ...options });
  try {
    let healthy = false;
    for (let i = 0; i < 40; i++) {
      if (child.exitCode !== null) throw Error('Mock backend terminated');
      try { healthy = (await request('/health')).status === 200; } catch {}
      if (healthy) break;
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    assert(healthy, 'Local backend must start');
    assert.equal((await request('/auth/google/start?mode=external')).status, 400);
    for (const mode of ['staging', 'app', 'web']) {
      const start = await request('/auth/google/start?mode=' + mode);
      assert.equal(start.status, 302);
      const state = new URL(start.headers.get('location')).searchParams.get('state');
      const callbackPath = '/auth/google/callback?' + new URLSearchParams({ state, code: 'local-test', mode: 'external' });
      const callback = await request(callbackPath);
      assert.equal(callback.status, 302);
      const destination = new URL(callback.headers.get('location'));
      assert.equal(destination.origin + destination.pathname, 'https://ui.example.test/preview/auth-return.html');
      assert.equal(destination.searchParams.get('mode'), mode, 'Mode is bound to OAuth state, not callback input');
      const ticket = destination.searchParams.get('ticket');
      const exchange = origin => request('/auth/exchange', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) });
      assert.equal((await exchange('https://untrusted.example.test')).status, 403);
      assert.equal((await exchange(appOrigin)).status, 200);
      assert.equal((await exchange(appOrigin)).status, 401, 'One-time ticket must not replay');
      assert.equal((await request(callbackPath)).status, 400, 'OAuth state must not replay');
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise(resolve => child.once('close', resolve));
      child.kill('SIGTERM');
      await closed;
    }
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

(async () => {
  await checkLogin('appassets.androidplatform.net', 'staging', 'staging');
  await checkLogin('appassets.androidplatform.net', undefined, 'app');
  await checkLogin('appassets.androidplatform.net', 'untrusted', 'app');
  await checkLogin('ui.example.test', 'staging', 'web');
  const ticket = 'a'.repeat(43);
  checkReturn('staging', ticket, 'meetab-staging://auth?ticket=' + ticket);
  checkReturn('app', ticket, 'meetab://auth?ticket=' + ticket);
  checkReturn('web', ticket, './?ticket=' + ticket);
  checkReturn('staging', '<invalid>', undefined);
  await checkBackend();
  console.log('ANDROID_STAGING_AUTH_TEST=PASS (mock OAuth, no live provider writes)');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
