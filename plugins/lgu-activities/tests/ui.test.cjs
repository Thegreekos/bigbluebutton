const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { TeacherPanel, ACTIVITIES } = require('../src/panel');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The SDK top-level logger requires a browser document. Use its real, DOM-free
// constructor for Node tests, just as Lesson Assistant's registration tests do.
const sdk = require('bigbluebutton-html-plugin-sdk/dist/cjs/extensible-areas/generic-content-item/component');
const registration = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/registration.js'), 'utf8'), {
  module: registration,
  require(name) {
    if (name === 'react') return React;
    assert.equal(name, 'bigbluebutton-html-plugin-sdk');
    return sdk;
  },
});
const { PANEL_ID, useActivitiesRegistration } = registration.exports;
const unavailableApi = () => ({
  useCurrentUser: () => ({ loading: false, data: { role: 'MODERATOR' } }),
  useCustomQuery: () => ({ loading: false, data: { user_metadata: [] } }),
  usePluginSettings: () => ({ loading: false, data: {} }),
  useCustomSubscription: () => ({ loading: false, data: { user: [] } }),
  getSessionToken: () => undefined,
});

test('one sidekick, no explicit gallery duplicate, stable rerender and cleanup', () => {
  let items = [];
  let calls = 0;
  const pluginApi = {
    setGenericContentItems(value) { items = value; calls += 1; },
    setAppsGalleryItems() { assert.fail('Sidekick must not create a duplicate app'); },
  };
  const props = { pluginApi, teacher: false, icon: {}, contentFunction() {} };
  function Hook(p) { useActivitiesRegistration(p); return null; }
  let root;
  act(() => { root = create(React.createElement(Hook, props)); });
  assert.equal(items.length, 0);
  act(() => root.update(React.createElement(Hook, { ...props, teacher: true })));
  assert.equal(items.length, 1);
  assert.equal(items[0].id, PANEL_ID);
  assert.equal(items[0].name, 'LGU Activities');
  assert.equal(items[0].open, false);
  assert.equal(items[0].contentFunction, props.contentFunction);
  const previousCalls = calls;
  act(() => root.update(React.createElement(Hook, { ...props, teacher: true })));
  assert.equal(calls, previousCalls);
  act(() => root.update(React.createElement(Hook, props)));
  assert.equal(items.length, 0);
  act(() => root.update(React.createElement(Hook, { ...props, teacher: true })));
  act(() => root.unmount());
  assert.equal(items.length, 0);
});

test('Learn/Play remain placeholders; Live disabled without validated Core identity', () => {
  const pluginApi = unavailableApi();
  let root;
  act(() => { root = create(React.createElement(TeacherPanel, { pluginApi })); });
  assert.deepEqual(ACTIVITIES.map((a) => a.label), ['Μαθαίνω', 'Παίζω', 'Live']);
  const buttons = root.root.findAllByType('button').filter((button) => button.props['data-testid']?.startsWith('lgu-activity-'));
  assert.equal(buttons.length, 3);
  assert.equal(buttons[2].props.disabled, true);
  for (let i = 0; i < 2; i += 1) {
    act(() => buttons[i].props.onClick());
    assert.equal(buttons[i].props['aria-pressed'], true);
    assert.match(root.root.findByProps({ role: 'status' }).children.join(''), /Δεν ξεκίνησε δραστηριότητα/);
  }
  act(() => root.unmount());
});

test('open panel fail closes and clears choice when role is lost or data errors', () => {
  let user = { loading: false, data: { role: 'MODERATOR' } };
  const pluginApi = { ...unavailableApi(), useCurrentUser: () => user };
  let root;
  act(() => { root = create(React.createElement(TeacherPanel, { pluginApi })); });
  act(() => root.root.findAllByType('button')[0].props.onClick());
  user = { loading: false, error: new Error('lost'), data: { role: 'MODERATOR' } };
  act(() => root.update(React.createElement(TeacherPanel, { pluginApi })));
  assert.equal(root.root.findAllByType('button').length, 0);
  user = { loading: false, data: { role: 'MODERATOR' } };
  act(() => root.update(React.createElement(TeacherPanel, { pluginApi })));
  assert.ok(root.root.findAllByType('button').filter((b) => b.props['data-testid']?.startsWith('lgu-activity-'))
    .every((b) => b.props['aria-pressed'] === false));
  act(() => root.unmount());
});