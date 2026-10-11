// Loopback-only host adapter: actual plugin + SDK, synthetic BBB proofs and mock LGU engine.
(() => {
  const CURRENT_USER = 'Hooks::UseCurrentUser';
  const initialRole = new URL(location.href).searchParams.get('role') || 'MODERATOR';
  const roleResponse = role => role === 'LOADING' ? { loading: true }
    : role === 'ERROR' ? { loading: false, error: { message: 'Synthetic role error' } }
      : { loading: false, data: { userId: role === 'VIEWER' ? 'w_guest' : 'w_teacher',
        extId: role === 'VIEWER' ? '' : '17', name: role === 'VIEWER' ? 'Fixture learner' : 'Fixture host', role } };
  const roleSelect = document.getElementById('role');
  roleSelect.value = initialRole;
  const apps = document.getElementById('apps');
  const sidekick = document.getElementById('sidekick');
  const stage = document.getElementById('stage');
  const mainSlot = document.getElementById('main-slot');
  const metadataSubscriptions = new Map();
  let userResult = roleResponse(initialRole);
  let panelRoot; let panelId; let mainRoot; let mainId;
  const unmountPanel = () => { panelRoot?.unmount(); panelRoot = null; panelId = null; sidekick.hidden = true; };
  const unmountMain = () => { mainRoot?.unmount(); mainRoot = null; mainId = null; };
  document.getElementById('close').addEventListener('click', unmountPanel);
  const sendUser = () => window.dispatchEvent(new CustomEvent('BBB_CORE_SENT_NEW_DATA', {
    detail: { hook: CURRENT_USER, data: userResult },
  }));
  const sendMetadata = ({ hook, hookArguments }) => {
    const guest = roleSelect.value === 'VIEWER';
    window.dispatchEvent(new CustomEvent('BBB_CORE_SENT_NEW_DATA', { detail: { hook, hookArguments,
      data: { loading: false, data: { data: { user_metadata: guest ? []
        : [{ parameter: 'schoolcore_context_token', value: 'fixture-core-teacher' }] } } } } }));
  };
  window.addEventListener('PLUGIN_SUBSCRIBED_TO_BBB_CORE', event => {
    if (event.detail.hook === CURRENT_USER) { queueMicrotask(sendUser); return; }
    const { hook, hookArguments } = event.detail;
    if (hookArguments?.query?.includes('LGUActivitiesUserMetadata')) {
      metadataSubscriptions.set(JSON.stringify(hookArguments), { hook, hookArguments });
      queueMicrotask(() => sendMetadata({ hook, hookArguments }));
    } else throw new Error('Unexpected SDK hook in Live harness');
  });
  window.addEventListener('PLUGIN_UNSUBSCRIBED_FROM_BBB_CORE', event => {
    metadataSubscriptions.delete(JSON.stringify(event.detail.hookArguments));
  });
  roleSelect.addEventListener('change', event => {
    userResult = roleResponse(event.target.value); sendUser();
    for (const subscription of metadataSubscriptions.values()) sendMetadata(subscription);
  });
  window.open = () => { window.__fixtureWindowActions = (window.__fixtureWindowActions || 0) + 1; throw new Error('New windows are forbidden'); };
  window.__fixtureWindowActions = 0;
  window.bbb_plugins = {
    'plugin-root': {
      pluginName: 'LGUActivities',
      getSessionToken() { return roleSelect.value === 'VIEWER' ? 'fixture-bbb-guest' : 'fixture-bbb-teacher'; },
      setGenericContentItems(items) {
        queueMicrotask(() => {
          const sidekickItems = items.filter(item => item.name === 'LGU Activities');
          if (panelId && !sidekickItems.some(item => item.id === panelId)) unmountPanel();
          apps.replaceChildren();
          const sibling = document.createElement('button');
          sibling.textContent = 'Existing app (host fixture)'; apps.append(sibling);
          for (const item of sidekickItems) {
            const button = document.createElement('button'); button.type = 'button';
            button.textContent = item.name; button.dataset.test = item.dataTest;
            button.addEventListener('click', () => {
              if (panelId !== item.id) unmountPanel();
              panelId = item.id; sidekick.hidden = false;
              panelRoot ||= item.contentFunction(document.getElementById('content'));
            });
            apps.append(button);
          }
          const mainItem = items.find(item => item.id?.startsWith('lgu-live-main-'));
          if (!mainItem) { if (mainRoot) unmountMain(); }
          else if (mainId !== mainItem.id) {
            unmountMain(); mainId = mainItem.id;
            mainRoot = mainItem.contentFunction(mainSlot);
          }
        });
        return items.map(item => item.id);
      },
      setAppsGalleryItems() { throw new Error('Duplicate Apps Gallery registration'); },
    },
  };
  fetch('/manifest.json').then(response => response.json()).then(manifest => {
    const script = document.createElement('script');
    script.src = `${manifest.javascriptEntrypointUrl}?version=${manifest.version}`;
    script.integrity = manifest.javascriptEntrypointIntegrity;
    script.setAttribute('uuid', 'plugin-root'); script.setAttribute('pluginName', manifest.name);
    script.addEventListener('error', () => console.error('Plugin manifest/SRI load failed'));
    document.body.append(script);
  }).catch(error => console.error(error));
})();
