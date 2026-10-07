// Browser contract ONLY: real built SDK/UI/HTTP/BFF/federation client;
// synthetic self-verified identities and scripted mock LGU, not a scoring engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createLocalServer } = require('../scripts/serve-local.cjs');
const { createLiveBrowserFixture } = require('./fixtures/live-browser-fixture.cjs');
const manifest = require('../dist/manifest.json');

async function main() {
  const fixture = await createLiveBrowserFixture();
  const server = createLocalServer({ identityService: fixture.identityService, liveBff: fixture.bff });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const checks = []; const errors = []; const externalRequests = []; const unexpectedPages = [];
  const recordCheck = text => { checks.push(text); console.log(`PASS ${checks.length}: ${text}`); };
  const requests = []; const responses = []; const responseJobs = [];
  const evidence = path.join(__dirname, '../.local'); // ignored screenshot/report only
  let browser;
  const clean = value => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const forbidden of fixture.forbidden) assert.equal(text.includes(forbidden), false, 'server credential/private data leaked');
    assert.doesNotMatch(text, /lgu_(?:fed|session|live)=|x-lgu-federation-|eyJ[\w-]+\./i);
  };
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    async function newParticipant(role) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
      await context.route('**/*', async route => {
        if (new URL(route.request().url()).origin !== origin) {
          externalRequests.push(route.request().url()); return route.abort();
        }
        if (new URL(route.request().url()).pathname === '/api/lgu-activities/v1/live/command') {
          // Transparent capture of the ACTUAL local handler's response, not a
          // fixture reply or API stub. The UI aborts immediately on a stale
          // status, so inspect its bytes before forwarding unchanged to Chromium.
          const upstream = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
          try {
            const headers = upstream.headers(); const body = await upstream.text();
            clean(headers); clean(body); assert.equal(Object.hasOwn(headers, 'set-cookie'), false);
            responses.push({ role, path: new URL(route.request().url()).pathname,
              status: upstream.status(), headers, body });
            await route.fulfill({ response: upstream });
          } finally { await upstream.dispose(); }
          return;
        }
        return route.continue();
      });
      await context.addInitScript(() => {
        window.__fixtureWindowActions = 0;
        window.open = () => { window.__fixtureWindowActions++; throw new Error('Window/tab actions forbidden'); };
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.setDefaultNavigationTimeout(10000);
      context.on('page', extra => { unexpectedPages.push('unexpected tab'); void extra.close(); });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        // Chromium logs the intentionally asserted HTTP 409 as a resource error.
        if (message.type() === 'error' && message.text() !== 'Failed to load resource: the server responded with a status of 409 (Conflict)') errors.push(message.text());
      });
      page.on('framenavigated', frame => {
        if (frame !== page.mainFrame() || new URL(frame.url()).origin !== origin) errors.push('unexpected frame/navigation');
      });
      page.on('request', request => {
        if (request.url().includes('/api/lgu-activities/')) requests.push({ role,
          path: new URL(request.url()).pathname, body: request.postDataJSON(), headers: request.headers() });
      });
      page.on('response', response => {
        if (!response.url().includes('/api/lgu-activities/')) return;
        responseJobs.push((async () => {
          const headers = await response.allHeaders(); clean(headers);
          assert.equal(Object.hasOwn(headers, 'set-cookie'), false);
          assert.equal(headers['cache-control'].startsWith('no-store'), true);
          const record = { role, path: new URL(response.url()).pathname, status: response.status(), headers };
          responses.push(record);
          // Chromium can leave response.finished() pending forever after a
          // disposed watch aborts. Bound inspection independently of UI polling;
          // every completed JSON/SSE body and every header is still inspected.
          let timer;
          try {
            const body = await Promise.race([
              response.text().then(text => ({ text }), error => ({ cancelled: error.message })),
              new Promise(resolve => { timer = setTimeout(() => resolve({ cancelled: 'inspection deadline' }), 2000); }),
            ]);
            if (body.text !== undefined) { record.body = body.text; clean(body.text); }
            else record.cancelled = true;
          } finally { clearTimeout(timer); }
        })().catch(error => { errors.push(error.message); }));
      });
      await page.goto(`${origin}/?role=${role}`);
      return page;
    }
    const host = await newParticipant('MODERATOR');
    const app = page => page.getByRole('button', { name: 'LGU Activities', exact: true });
    const phase = (page, value) => page.getByTestId('live-state').getByRole('status').filter({ hasText: `Phase: ${value} ·` });
    await app(host).waitFor(); assert.equal(await app(host).count(), 1);
    assert.equal(await host.locator('#sidekick').isVisible(), false);
    const script = host.locator('script[pluginName="LGUActivities"]');
    assert.equal(await script.getAttribute('src'), `${manifest.javascriptEntrypointUrl}?version=${manifest.version}`);
    assert.equal(await script.getAttribute('integrity'), manifest.javascriptEntrypointIntegrity);
    assert.match(manifest.javascriptEntrypointIntegrity, /^sha384-/);
    await app(host).focus(); await host.keyboard.press('Enter');
    await host.getByTestId('live-principal').filter({ hasText: 'Core participant' }).waitFor();
    await host.getByTestId('live-theme').selectOption(fixture.TOPIC);
    await host.getByTestId('live-create').click();
    await phase(host, 'lobby').waitFor();
    recordCheck('Real generated manifest/SRI, built SDK and keyboard-opened Apps panel; verified Core moderator creates closed lobby');

    const learner = await newParticipant('VIEWER');
    await app(learner).waitFor(); assert.equal(await app(learner).count(), 1);
    await app(learner).click();
    await learner.getByTestId('live-principal').filter({ hasText: 'Temporary guest' }).waitFor();
    const noHost = async () => {
      assert.equal(await learner.getByTestId('live-host').count(), 0);
      assert.equal(await learner.locator('[data-testid^="live-command-"]').count(), 0);
      assert.equal(await learner.getByTestId('live-create').count(), 0);
    };
    await noHost();
    await learner.getByTestId('live-session-picker').selectOption(fixture.SESSION);
    await learner.getByTestId('live-enter').click();
    await phase(learner, 'lobby').waitFor();
    recordCheck('Independent VIEWER browser registers Apps, uses guest BBB proof without Core token, enters closed lobby and has no host controls');

    await host.getByTestId('live-command-start').click(); await phase(host, 'prepare').waitFor();
    await host.getByTestId('live-command-open').click(); await phase(host, 'open').waitFor();
    await phase(learner, 'open').waitFor({ timeout: 20000 });
    await learner.getByRole('radio', { name: 'First fixture option', exact: true }).check();
    await learner.getByTestId('live-answer').click();
    await learner.getByRole('status').filter({ hasText: 'Answer received.' }).waitFor();
    assert.equal(await learner.getByTestId('live-answer').isDisabled(), true);
    assert.equal(await learner.getByTestId('live-own-result').count(), 0);
    assert.equal(fixture.counts().answers, 1);
    recordCheck('Host start/prepare/open; guest submits exact one-question answer [a] once through cookie-authenticated BFF; no premature score');
    await host.getByTestId('live-command-close').click(); await phase(host, 'closed').waitFor();
    await host.getByTestId('live-command-reveal').click(); await phase(host, 'reveal').waitFor();
    await learner.getByTestId('live-own-result').filter({ hasText: 'Correct · Points: 73' }).waitFor({ timeout: 20000 });
    await learner.getByTestId('live-standings').getByText('Fixture learner · Rank: 1 · Total: 73', { exact: true }).waitFor();
    await noHost();
    recordCheck('Host close/reveal; learner displays canned mock engine points 73 and standings total 73 without local scoring');
    fs.mkdirSync(evidence, { recursive: true });
    await host.screenshot({ path: path.join(evidence, 'live-host.png'), fullPage: true });
    await learner.screenshot({ path: path.join(evidence, 'live-learner.png'), fullPage: true });

    fixture.staleNextCommand();
    const commandsBefore = fixture.counts().commands;
    await host.getByTestId('live-command-next').click();
    await host.getByRole('alert').filter({ hasText: 'The session changed. Reconnect' }).waitFor();
    assert.equal(fixture.counts().commands, commandsBefore + 1);
    assert.equal(await host.getByTestId('live-state').count(), 0);
    await host.getByTestId('live-reconnect').click();
    await host.getByTestId('live-principal').waitFor();
    await host.getByTestId('live-session-picker').selectOption(fixture.SESSION);
    await host.getByTestId('live-enter').click(); await phase(host, 'reveal').waitFor();
    assert.equal(fixture.counts().commands, commandsBefore + 1);
    assert.equal(fixture.counts().launches, 2);
    assert.equal(fixture.counts().activations, 2);
    assert.equal(fixture.counts().entries, 1);
    recordCheck('Stale command 409 is sanitized, not retried; explicit reconnect recovers current reveal without another launch or participant entry');

    await host.getByRole('button', { name: 'Κλείσιμο panel' }).click();
    await app(host).click(); await host.getByTestId('live-principal').waitFor();
    assert.equal(await host.getByTestId('live-state').count(), 0);
    for (const role of ['LOADING', 'ERROR']) {
      await host.locator('#role').selectOption(role); await app(host).waitFor({ state: 'detached' });
      assert.equal(await host.locator('#sidekick').isVisible(), false);
      assert.equal(await host.getByRole('button', { name: 'Existing app (host fixture)', exact: true }).count(), 1);
      await host.locator('#role').selectOption('MODERATOR'); await app(host).waitFor(); await app(host).click();
      await host.getByTestId('live-principal').waitFor();
    }
    await learner.setViewportSize({ width: 375, height: 812 });
    assert.equal(await learner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await learner.reload(); await app(learner).waitFor(); assert.equal(await app(learner).count(), 1);
    await app(learner).click(); await learner.getByTestId('live-principal').waitFor(); await noHost();
    recordCheck('Close/reopen resets selection; loading/error unmount only this app; viewer refresh restores one app; mobile has no horizontal overflow');

    for (const page of [host, learner]) {
      assert.equal(new URL(page.url()).origin, origin);
      assert.equal(await page.locator('iframe').count(), 0); assert.equal(page.frames().length, 1);
      assert.equal(await page.evaluate(() => window.__fixtureWindowActions), 0);
      clean(await page.locator('body').innerHTML());
      const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
      assert.deepEqual(storage, { local: {}, session: {}, cookie: '' });
      const cookies = await page.context().cookies();
      assert.deepEqual(cookies.map(c => c.name), ['fixture-bbb-session']); assert.equal(cookies[0].httpOnly, true);
    }
    // Stop all watches before awaiting the response inspections.
    for (const page of [host, learner]) await page.getByRole('button', { name: 'Κλείσιμο panel' }).click();
    await Promise.all(responseJobs);
    assert.deepEqual(externalRequests, []); assert.deepEqual(unexpectedPages, []);
    assert.deepEqual(fixture.failures, []); assert.deepEqual(errors, []);
    assert.equal(requests.length, fixture.authCalls.length);
    for (const request of requests) {
      assert.match(request.path, /^\/api\/lgu-activities\/v1\/live\/(context|create|enter|state|stream|command|answer)$/);
      assert.equal(request.headers['x-bbb-session-token'], `fixture-bbb-${request.role === 'MODERATOR' ? 'teacher' : 'guest'}`);
      assert.equal(request.headers.authorization, request.role === 'MODERATOR' ? 'Bearer fixture-core-teacher' : undefined);
      clean(request.body);
      assert.doesNotMatch(JSON.stringify(request.body), /principalId|coreToken|sessionToken|"role"|"points"|"url"/);
    }
    assert.ok(responses.some(r => r.status === 409 && r.body === '{"error":"LGU_409"}'));
    assert.ok(responses.some(r => r.headers['content-type'].startsWith('text/event-stream') && r.body?.includes('event: hello')));
    assert.ok(fixture.counts().streams > 0);
    recordCheck('All requests loopback/same-origin; no iframe/window/tab actions or browser errors; every request re-verifies self; HMAC exact bytes/query and fresh nonces validated');
    recordCheck('LGU secrets/tickets/cookies/private join data absent from DOM/storage/browser cookie jar and all completed response bodies/headers, including SSE and 409');
    const report = { scope: 'SYNTHETIC browser contract only: real built SDK + HTTP handler + BFF + federation client; scripted mock LGU, NOT scoring or a real BBB meeting',
      checks, checkCount: checks.length, counts: fixture.counts(), browser: await browser.version(),
      inspectedResponses: responses.filter(r => r.body !== undefined).length,
      cancelledResponseInspections: responses.filter(r => r.cancelled).length,
      externalRequests, unexpectedPages, errors };
    fs.writeFileSync(path.join(evidence, 'browser-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('Browser contract failed:', error.message, { completedChecks: checks.length,
      counts: fixture.counts(), fixtureFailures: fixture.failures.length, browserErrors: errors.length });
    throw error;
  } finally {
    if (browser) await browser.close();
    fixture.bff.dispose();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });