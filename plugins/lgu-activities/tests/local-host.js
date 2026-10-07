// Test host only: mirrors BBB4 generic-content manager's sidekick -> Apps mapping.
// Plugin runs unchanged, with the REAL SDK and React host global.
(() => {
  const CURRENT_USER = 'Hooks::UseCurrentUser';
  // URL role selects a SYNTHETIC proof, not server authority. The fixture's
  // authoritative BBB registry independently verifies that proof on every call.
  const initialRole = new URL(location.href).searchParams.get('role') || 'MODERATOR';
  const guest = () => document.getElementById('role').value === 'VIEWER';
  const roleResponse = (role) => role === 'LOADING' ? { loading: true }
    : role === 'ERROR' ? { loading: false, error: { message: 'Synthetic role error' } }
      : { loading: false, data: { userId: role === 'VIEWER' ? 'w_guest' : 'w_teacher',
        extId: role === 'VIEWER' ? '' : '17', name: role === 'VIEWER' ? 'Fixture learner' : 'Fixture host', role } };
  document.getElementById('role').value = initialRole;
  document.querySelector('#sidekick').setAttribute('aria-label', 'Live panel');
  let userResult = roleResponse(initialRole);
  let contentRoot;
  let activeId;
  const apps = document.getElementById('apps');
  const sidekick = document.getElementById('sidekick');
  const close = () => {
    if (contentRoot) contentRoot.unmount();
    contentRoot = undefined;
    activeId = undefined;
    sidekick.hidden = true;
  };
  const sendUser = () => window.dispatchEvent(new CustomEvent('BBB_CORE_SENT_NEW_DATA', {
    detail: { hook: CURRENT_USER, data: userResult },
  }));
  const metadataSubscriptions = new Map();
  const sendMetadata = ({ hook, hookArguments }) => window.dispatchEvent(new CustomEvent('BBB_CORE_SENT_NEW_DATA', {
    detail: { hook, hookArguments, data: { loading: false, data: { data: { user_metadata: guest()
      ? [] : [{ parameter: 'schoolcore_context_token', value: 'fixture-core-teacher' }] } } } },
  }));
  window.addEventListener('PLUGIN_SUBSCRIBED_TO_BBB_CORE', (event) => {
    if (event.detail.hook === CURRENT_USER) { queueMicrotask(sendUser); return; }
    const { hook, hookArguments } = event.detail;
    if (hookArguments?.query?.includes('LGUActivitiesUserMetadata')) {
      metadataSubscriptions.set(JSON.stringify(hookArguments), { hook, hookArguments });
      queueMicrotask(() => sendMetadata({ hook, hookArguments }));
    } else throw new Error('Unexpected SDK hook in Live harness');
  });
  window.addEventListener('PLUGIN_UNSUBSCRIBED_FROM_BBB_CORE', (event) => {
    metadataSubscriptions.delete(JSON.stringify(event.detail.hookArguments));
  });
  document.getElementById('role').addEventListener('change', (event) => {
    const role = event.target.value;
    userResult = roleResponse(role);
    sendUser();
    for (const subscription of metadataSubscriptions.values()) sendMetadata(subscription);
  });
  document.getElementById('close').addEventListener('click', close);
  window.bbb_plugins = {
    'plugin-root': {
      pluginName: 'LGUActivities',
      getSessionToken() { return guest() ? 'fixture-bbb-guest' : 'fixture-bbb-teacher'; },
      setGenericContentItems(items) {
        queueMicrotask(() => {
          if (activeId && !items.some((item) => item.id === activeId)) close();
          apps.replaceChildren();
          // Sentinel app proves this plugin does not remove another plugin's entry.
          const sibling = document.createElement('button');
          sibling.textContent = 'Existing app (host fixture)';
          apps.append(sibling);
          for (const item of items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = item.name;
            button.dataset.test = item.dataTest;
            button.addEventListener('click', () => {
              close();
              activeId = item.id;
              sidekick.hidden = false;
              contentRoot = item.contentFunction(document.getElementById('content'));
              document.getElementById('close').focus();
            });
            apps.append(button);
          }
        });
        return items.map((item) => item.id);
      },
      setAppsGalleryItems() { throw new Error('Duplicate Apps Gallery registration'); },
    },
  };
  // Simulate the documented BBB loader after its server-side manifest resolution.
  // Browser validates the real same-origin bundle SRI before executing it.
  fetch('/manifest.json').then((response) => response.json()).then((manifest) => {
    const script = document.createElement('script');
    script.src = `${manifest.javascriptEntrypointUrl}?version=${manifest.version}`;
    script.integrity = manifest.javascriptEntrypointIntegrity;
    script.setAttribute('uuid', 'plugin-root');
    script.setAttribute('pluginName', manifest.name);
    script.addEventListener('error', () => console.error('Plugin manifest/SRI load failed'));
    document.body.append(script);
  }).catch((error) => console.error(error));
})();