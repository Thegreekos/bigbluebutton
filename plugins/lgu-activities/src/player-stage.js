const React = require('react');
const { createRoot } = require('react-dom/client');
const LGU_PLAYER_COMMIT = '56e438e67c977113bcbd513591d440b2b140e893';
const PLAYER_BASE = `/plugins/lgu-activities/player/${LGU_PLAYER_COMMIT}`;
const PLAYER_PUBLIC_ASSET_ORIGIN = 'https://lgu.thegreekos.com';
const h = React.createElement;

// Fit the BBB-owned (height:100%, overflow:hidden) generic-content slot.
// The opaque host covers the presentation; its bounded box owns scrolling.
// Neither the BBB layout nor the immutable LGU stylesheet is modified.
const HOST_STYLE = `
.lgu-player-host { box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:#fff; isolation:isolate; }
.lgu-player-host > .lgu-player-container { min-height:100%; }
.lgu-player-host .lgu-player { min-height:100%; }
`;

function importPlayer(url) {
  return import(/* webpackIgnore: true */ url);
}

function mountPinnedPlayer({ element, sessionId, sessionToken, coreToken, spectator = false,
  documentObject = document, loadModule = importPlayer }) {
  let cancelled = false;
  let mountedPlayer;
  const stylesheet = documentObject.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = `${PLAYER_BASE}/lgu-live-player.css`;
  stylesheet.dataset.lguPlayerCommit = LGU_PLAYER_COMMIT;
  documentObject.head.appendChild(stylesheet);
  const ready = loadModule(`${PLAYER_BASE}/lgu-live-player.js`).then(module => {
    if (cancelled) return;
    const transport = module.proxyTransport({ base: '/api/lgu-activities/v1/player',
      assets: PLAYER_PUBLIC_ASSET_ORIGIN, credentials: 'same-origin' });
    const authenticatedTransport = {
      assetUrl: transport.assetUrl,
      fetch: (url, init) => {
        const headers = new Headers(init.headers || {});
        headers.set('X-BBB-Session-Token', sessionToken);
        if (coreToken) headers.set('Authorization', `Bearer ${coreToken}`);
        return transport.fetch(url, { ...init, headers });
      },
    };
    mountedPlayer = module.mountLivePlayer(element, { sessionId, locale: 'el',
      transport: authenticatedTransport, spectator, audio: !spectator });
  });
  return { ready, unmount() { cancelled = true; mountedPlayer?.unmount(); stylesheet.remove(); } };
}

function PlayerMount({ sessionId, pluginApi, sessionToken, coreToken, spectator }) {
  const host = React.useRef(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (!host.current) return undefined;
    const lifecycle = mountPinnedPlayer({ element: host.current, sessionId, sessionToken, coreToken, spectator });
    void lifecycle.ready.catch(() => setError('The LGU Live player could not be loaded.'));
    return () => lifecycle.unmount();
  }, [sessionId, pluginApi, sessionToken, coreToken, spectator]);

  return h('div', { className: 'lgu-player-host', 'data-testid': 'lgu-main-player', ref: host, tabIndex: 0,
    'aria-label': spectator ? 'LGU Live audience view' : 'LGU Live player' },
  error && h('p', { role: 'alert' }, error));
}

function createPlayerMainContent({ pluginApi, sessionToken, coreToken, sessionId, spectator }) {
  return element => {
    const root = createRoot(element);
    root.render(h(React.Fragment, null, h('style', null, HOST_STYLE),
      h(PlayerMount, { pluginApi, sessionToken, coreToken, sessionId, spectator })));
    return root; // BBB owns this root; effect cleanup unmounts the isolated LGU bundle.
  };
}

module.exports = { LGU_PLAYER_COMMIT, PLAYER_BASE, PlayerMount, mountPinnedPlayer, createPlayerMainContent };
