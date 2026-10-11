const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLiveHttpHandler, relayEvents, relayResource } = require('../server/live-http-handler.cjs');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

test('controller stream ends orderly at 20s, cancels upstream and releases response listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = 0; let signal; let ended = false;
  const upstream = new Response(new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode('event: hello\ndata: {"seq":1}\n\n'));
  }, cancel() { cancelled++; } }));
  const response = new EventEmitter(); const chunks = [];
  response.writeHead = status => { assert.equal(status, 200); response.headersSent = true; };
  response.write = chunk => { chunks.push(chunk); return true; };
  response.end = () => { ended = true; };
  const request = { url: '/api/lgu-activities/v1/live/stream', method: 'POST',
    headers: { origin:'https://bbb.fixture.test', 'content-type':'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); } };
  const handler = createLiveHttpHandler({ origin:request.headers.origin, bff:{
    async handle(op, proof, body, abort) { assert.equal(op, 'stream'); signal = abort; return upstream; },
  } });
  const pending = handler(request, response); await flush();
  assert.equal(ended, false); t.mock.timers.tick(19999); await flush(); assert.equal(ended, false);
  t.mock.timers.tick(1); await pending;
  assert.equal(ended, true); assert.equal(signal.aborted, true); assert.equal(cancelled, 1);
  assert.equal(response.listenerCount('close'), 0);
  assert.match(chunks.join(''), /event: hello/);
});

for (const relay of [relayEvents, relayResource]) {
  test(`${relay.name} cleans losing backpressure listeners on every drain`, async () => {
    const response = new EventEmitter(); const abort = new AbortController(); let writes = 0;
    response.write = () => {
      writes++;
      setImmediate(() => {
        assert.equal(response.listenerCount('close'), 1);
        response.emit('drain');
        assert.equal(response.listenerCount('close'), 0);
        assert.equal(response.listenerCount('drain'), 0);
      });
      return false;
    };
    let n = 0;
    const upstream = new Response(new ReadableStream({ pull(c) {
      if (n++ === 25) return c.close();
      c.enqueue(new TextEncoder().encode('event: ping\ndata: {}\n\n'));
    } }));
    await relay(upstream, response, abort.signal);
    assert.equal(writes, 25); assert.equal(response.listenerCount('close'), 0);
  });
  test(`${relay.name} releases a pending drain on cancellation`, async () => {
    const response = new EventEmitter(); const abort = new AbortController();
    response.write = () => { queueMicrotask(() => abort.abort()); return false; };
    const upstream = new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('event: hello\ndata: {}\n\n'));
    } }));
    await relay(upstream, response, abort.signal);
    assert.equal(response.listenerCount('close'), 0); assert.equal(response.listenerCount('drain'), 0);
  });
}
