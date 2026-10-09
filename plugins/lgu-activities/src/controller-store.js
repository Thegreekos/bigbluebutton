let snapshot = null;
const subscribers = new Set();
function publishController(value) {
  snapshot = value;
  for (const notify of subscribers) notify();
}
function subscribeController(notify) {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}
function getControllerSnapshot() { return snapshot; }
module.exports = { publishController, subscribeController, getControllerSnapshot };
