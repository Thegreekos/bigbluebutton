const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { LGU_PLAYER_COMMIT, PLAYER_BASE, mountPinnedPlayer } = require('../src/player-stage');
const { createLocalServer } = require('../scripts/serve-local.cjs');

test('pinned LGU bundle is mounted once with the real proxy transport and BBB proof stays on the BFF request', async () => {
  const element = {};
  const links = [];
  let mounted;
  let unmounted = 0;
  let importedUrl;
  const documentObject = {
    head: { appendChild(link) { links.push(link); } },
    createElement(tag) { assert.equal(tag, 'link'); return { dataset: {}, remove() { this.removed = true; } }; },
  };
  const loadModule = async url => {
    importedUrl = url;
    return {
      proxyTransport(options) {
        assert.deepEqual(options, { base: '/api/lgu-activities/v1/player',
          assets: 'https://lgu.thegreekos.com', credentials: 'same-origin' });
        return { assetUrl: value => `https://lgu.thegreekos.com${value}`,
          fetch: async (path, init) => { mounted.request = { path: `${options.base}${path}`, init }; return new Response('{}'); } };
      },
      mountLivePlayer(target, props) { mounted = { target, props }; return { unmount() { unmounted += 1; } }; },
    };
  };
  const lifecycle = mountPinnedPlayer({ element, sessionId: 'session-uuid', sessionToken: 'bbb-proof',
    coreToken: 'core-proof', spectator: false, documentObject, loadModule });
  await lifecycle.ready;
  assert.equal(importedUrl, `${PLAYER_BASE}/lgu-live-player.js`);
  assert.equal(links[0].href, `${PLAYER_BASE}/lgu-live-player.css`);
  assert.equal(links[0].dataset.lguPlayerCommit, LGU_PLAYER_COMMIT);
  assert.equal(mounted.target, element);
  assert.equal(mounted.props.sessionId, 'session-uuid');
  assert.equal(Object.hasOwn(mounted.props, 'spectator'), false, 'host/player uses authoritative view, not spectator');
  assert.equal(mounted.props.transport.assetUrl('/media/x/y.webp'), 'https://lgu.thegreekos.com/media/x/y.webp');
  await mounted.props.transport.fetch('/api/v1/live/session-uuid', { method: 'GET', headers: { 'X-LGU-Client': 'web/0.1.0' } });
  assert.equal(mounted.request.path, `/api/lgu-activities/v1/player/api/v1/live/session-uuid`);
  assert.equal(mounted.request.init.headers.get('X-BBB-Session-Token'), 'bbb-proof');
  assert.equal(mounted.request.init.headers.get('Authorization'), 'Bearer core-proof');
  assert.doesNotMatch(JSON.stringify(mounted.request), /federation_secret|lgu_live=|lgu_fed=/i);
  lifecycle.unmount();
  assert.equal(unmounted, 1);
  assert.equal(links[0].removed, true);
});

test('unmount before bundle load prevents a late mount and removes stylesheet', async () => {
  let resolveModule;
  let mountCount = 0;
  const link = { dataset: {}, remove() { this.removed = true; } };
  const documentObject = { head: { appendChild() {} }, createElement: () => link };
  const lifecycle = mountPinnedPlayer({ element: {}, sessionId: 'session-uuid', sessionToken: 'bbb-proof',
    documentObject, loadModule: () => new Promise(resolve => { resolveModule = resolve; }) });
  lifecycle.unmount();
  resolveModule({ proxyTransport: () => ({}), mountLivePlayer() { mountCount += 1; } });
  await lifecycle.ready;
  assert.equal(mountCount, 0);
  assert.equal(link.removed, true);
});

test('explicit spectator audience mode is retained with audio disabled', async () => {
  let props;
  const lifecycle = mountPinnedPlayer({ element: {}, sessionId: 'session-uuid', sessionToken: 'bbb-proof', spectator: true,
    documentObject: { head: { appendChild() {} }, createElement: () => ({ dataset: {}, remove() {} }) },
    loadModule: async () => ({ proxyTransport: () => ({ assetUrl: p => p, fetch: async () => new Response('{}') }),
      mountLivePlayer(element, value) { props = value; return { unmount() {} }; } }),
  });
  await lifecycle.ready;
  assert.equal(props.spectator, true); assert.equal(props.audio, false);
  lifecycle.unmount();
});

test('only the canonical player bundle is referenced; no iframe/new-window/second renderer fallback exists', () => {
  const sourceRoot = path.join(__dirname, '../src');
  const sources = fs.readdirSync(sourceRoot).filter(file => /\.(js|cjs)$/.test(file))
    .map(file => fs.readFileSync(path.join(sourceRoot, file), 'utf8')).join('\n');
  assert.match(sources, new RegExp(LGU_PLAYER_COMMIT));
  assert.doesNotMatch(sources, /createElement\(['"]iframe|window\.open\s*\(/);
  assert.doesNotMatch(sources, /function QuestionForm|live-question|live-answer/);
  assert.equal(fs.existsSync(path.join(sourceRoot, 'live-panel.js')), false);
});

test('local/test host serves only the pinned bundle, real scoped CSS and font files', async t => {
  const server = createLocalServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const js = await fetch(`${origin}${PLAYER_BASE}/lgu-live-player.js`);
  assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
  assert.match(await js.text(), /mountLivePlayer/);
  const css = await fetch(`${origin}${PLAYER_BASE}/lgu-live-player.css`);
  assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
  const stylesheet = await css.text(); assert.match(stylesheet, /\.lgu-player/);
  assert.doesNotMatch(stylesheet, /(^|\})\s*(?:body|button|h1)\s*\{/);
  const font = await fetch(`${origin}${PLAYER_BASE}/fonts/inter-greek.woff2`);
  assert.equal(font.status, 200); assert.match(font.headers.get('content-type'), /font\/woff2/);
  assert.equal((await fetch(`${origin}/plugins/lgu-activities/player/refs/pull/50/head/lgu-live-player.js`)).status, 404);
});
