const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
const { ControllerPanel } = require('../src/controller-panel');
const { publishController } = require('../src/controller-store');

function hookRoot(props) {
  let registered = [];
  const calls = [];
  const pluginApi = { setGenericContentItems(items) { registered = items; calls.push(items); return items.map(item => item.id); } };
  function Hook(value) { useActivitiesRegistration({ pluginApi, ...value }); return null; }
  let root;
  act(() => { root = create(React.createElement(Hook, props)); });
  return { get items() { return registered; }, calls, update(next) { act(() => root.update(React.createElement(Hook, next))); },
    unmount() { act(() => root.unmount()); } };
}

const runtime = overrides => ({ ready: true, status: 'ready', error: null,
  context: { themes: [{ id: 'odyssey', title: 'Odyssey' }], sessions: [{ id: 'room', themeTitle: 'Odyssey', phase: 'open' }] },
  session: { id: 'room', role: 'host', themeTitle: 'Odyssey', phase: 'open', phaseVersion: 8 },
  connection: 'streaming', busy: false, canHost: true, selectedId: 'room', selectedSummary: { id: 'room', phase: 'open' },
  showMainStage: true, createSession() {}, command() {}, selectSession() {}, refresh() {}, ...overrides });

test('moderator gets controller sidekick and the official main stage item only while active', () => {
  const content = () => {};
  const hook = hookRoot({ teacher: true, icon: {}, activeSessionId: 'room', mainContentFunction: content });
  assert.equal(hook.items.length, 2);
  assert.equal(hook.items[0].id, PANEL_ID);
  assert.equal(hook.items[0].name, 'LGU Activities');
  assert.equal(hook.items[0].open, false);
  assert.equal(hook.items[1] instanceof sdk.GenericContentMainArea, true);
  assert.equal(hook.items[1].id, 'lgu-live-main-room');
  assert.equal(hook.items[1].contentFunction, content);
  const controllerMount = hook.items[0].contentFunction;
  hook.update({ teacher: true, icon: {}, activeSessionId: '', mainContentFunction: null });
  assert.equal(hook.items.length, 1, 'Finish removes the stage item and restores BBB presentation');
  assert.equal(hook.items[0].contentFunction, controllerMount, 'the open controller root stays registered across stage lifecycle');
  assert.equal(hook.calls.some(items => items.length === 0), false, 'phase changes do not clear the sidekick');
  hook.unmount();
});

test('student and guest never receive an Apps sidekick, but receive the main stage while active', () => {
  const hook = hookRoot({ teacher: false, icon: {}, activeSessionId: 'room', mainContentFunction: () => {} });
  assert.equal(hook.items.length, 1);
  assert.equal(hook.items[0] instanceof sdk.GenericContentMainArea, true);
  hook.update({ teacher: false, icon: {}, activeSessionId: '', mainContentFunction: null });
  assert.equal(hook.items.length, 0, 'without an active activity the normal BBB stage remains');
  hook.unmount();
});

test('controller contains session controls and status only, never game, answer, reveal or result UI', () => {
  const value = runtime(); publishController(value);
  let root;
  act(() => { root = create(React.createElement(ControllerPanel)); });
  const rendered = JSON.stringify(root.toJSON());
  assert.match(rendered, /live-theme/);
  assert.match(rendered, /live-session-picker/);
  for (const action of ['start', 'open', 'close', 'reveal', 'next', 'finish']) {
    assert.equal(root.root.findAllByProps({ 'data-testid': `live-command-${action}` }).length, 1);
  }
  for (const forbidden of ['live-question', 'live-answer', 'live-own-result', 'live-reveal', 'live-standings']) {
    assert.equal(root.root.findAllByProps({ 'data-testid': forbidden }).length, 0);
  }
  assert.doesNotMatch(rendered, /correct answer|points|standings|Submit answer/);
  act(() => root.unmount()); publishController(null);
});

test('viewer controller code is never registered even when runtime knows an active session', () => {
  const hook = hookRoot({ teacher: false, icon: {}, activeSessionId: '', mainContentFunction: null });
  assert.equal(hook.items.length, 0);
  hook.unmount();
});

test('controller snapshot becoming null retains hook order and can recover', () => {
  publishController(runtime());
  let root;
  act(() => { root = create(React.createElement(ControllerPanel)); });
  act(() => publishController(null));
  assert.match(JSON.stringify(root.toJSON()), /Loading controller/);
  act(() => publishController(runtime()));
  assert.equal(root.root.findAllByProps({ 'data-testid': 'live-command-finish' }).length, 1);
  act(() => root.unmount()); publishController(null);
});
