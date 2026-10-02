// Isolated tests of the actual dialog class, without opening a BBB meeting.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const source = fs.readFileSync(path.join(__dirname, '../imports/ui/components/lock-viewers/component.jsx'), 'utf8');
const { code } = babel.transformSync(source, {
  babelrc: false,
  configFile: false,
  plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'],
});
const noOp = () => {};
const propType = new Proxy(noOp, { get: () => propType, apply: () => propType });
const propsStub = new Proxy({}, { get: () => propType });
class Component {
  constructor(props) { this.props = props; }
  setState(next, callback) { Object.assign(this.state, next); callback?.(); }
}
const stubs = {
  react: { __esModule: true, default: { Component }, Component },
  'react-intl': { defineMessages: (messages) => messages, injectIntl: (component) => component },
  'prop-types': { __esModule: true, default: propsStub },
  radash: { clone: (value) => ({ ...value }) },
};
const loaded = {};
vm.runInNewContext(code, {
  exports: loaded,
  require: (name) => stubs[name] || { __esModule: true, default: noOp },
  setTimeout, clearTimeout,
}, { filename: 'component.jsx' });
const Dialog = loaded.default;
const base = {
  disableCam: false, disableMic: false, disablePrivateChat: false,
  disablePublicChat: false, disableNotes: false, hideUserList: false,
  lockOnJoin: false, lockOnJoinConfigurable: false, hideViewersCursor: false,
  hideViewersAnnotation: false, presenterPolicy: 'requireApproval',
};
function fixture(mutate) {
  const confirmed = { current: null };
  let closed = 0;
  let calls = 0;
  const props = {
    meeting: { lockSettings: { ...base }, usersPolicies: { guestPolicy: 'ASK_MODERATOR', webcamsOnlyForModerator: false } },
    guestLobbyMessage: '', lastConfirmedLockSettings: confirmed,
    updateLockSettings: async (settings) => { calls += 1; return mutate(settings); },
    updateWebcamsOnlyForModerator: noOp, changeGuestPolicy: noOp, setLobbyMessage: noOp,
    closeModal: () => { closed += 1; },
  };
  const dialog = new Dialog(props);
  return { dialog, props, confirmed, get closed() { return closed; }, get calls() { return calls; } };
}
const accepted = { data: { meetingLockSettingsSetProps: true } };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('two saves in <1 second cannot reuse stale baseline', async () => {
  const f = fixture(async () => accepted);
  f.dialog.toggleLockSettings('disablePublicChat');
  const save = f.dialog.handleSave();
  await f.dialog.handleSave();
  await save;
  assert.equal(f.calls, 1);
  assert.equal(f.closed, 0);
  f.props.meeting.lockSettings = { ...base, disablePublicChat: true };
  f.dialog.componentDidUpdate();
  assert.equal(f.closed, 1);
  const next = new Dialog(f.props);
  next.toggleLockSettings('disableMic');
  await next.handleSave();
  assert.equal(f.calls, 2);
  next.componentWillUnmount();
});

test('mutation rejection leaves dialog open and no confirmed baseline', async () => {
  const f = fixture(async () => { throw new Error('forbidden'); });
  f.dialog.toggleLockSettings('disableMic');
  await f.dialog.handleSave();
  assert.equal(f.closed, 0);
  assert.equal(f.dialog.state.saveError, true);
  assert.equal(f.confirmed.current, null);
});

test('explicit server refusal does not claim success', async () => {
  const f = fixture(async () => ({ data: { meetingLockSettingsSetProps: false } }));
  f.dialog.toggleLockSettings('disableMic');
  await f.dialog.handleSave();
  assert.equal(f.closed, 0);
  assert.equal(f.dialog.state.saveError, true);
  assert.equal(f.confirmed.current, null);
});

test('delayed subscription does not mark the accepted command successful', async () => {
  const f = fixture(async () => accepted);
  f.dialog.toggleLockSettings('disableMic');
  await f.dialog.handleSave();
  assert.equal(f.closed, 0);
  assert.equal(f.dialog.state.isSaving, true);
  f.props.meeting.lockSettings = { ...base, disableMic: true };
  f.dialog.componentDidUpdate();
  assert.equal(f.closed, 1);
  assert.equal(f.dialog.state.saveError, false);
});

test('stale or out-of-order subscription cannot be used for a new save', async () => {
  const f = fixture(async () => accepted);
  f.dialog.toggleLockSettings('disableMic');
  await f.dialog.handleSave();
  f.props.meeting.lockSettings = { ...base, disableMic: true };
  f.dialog.componentDidUpdate();
  f.props.meeting.lockSettings = { ...base }; // older subscription event
  const next = new Dialog(f.props);
  next.toggleLockSettings('disablePublicChat');
  await next.handleSave();
  assert.equal(f.calls, 1);
  assert.equal(next.isAuthoritative(), false);
  f.props.meeting.lockSettings = { ...base, disableMic: true };
  next.componentDidUpdate();
  assert.equal(next.isAuthoritative(), true);
});

test('client baseline matches server permissions before next mutation', async () => {
  const f = fixture(async () => accepted);
  f.dialog.toggleLockSettings('disablePublicChat');
  await f.dialog.handleSave();
  assert.equal(f.confirmed.current.disablePublicChat, true);
  assert.equal(f.dialog.isAuthoritative(), false);
  f.props.meeting.lockSettings = { ...base, disablePublicChat: true };
  f.dialog.componentDidUpdate();
  assert.equal(f.dialog.isAuthoritative(), true);
  assert.equal(f.props.meeting.lockSettings.disablePublicChat, f.confirmed.current.disablePublicChat);
});
