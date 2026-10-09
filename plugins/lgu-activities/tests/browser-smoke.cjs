// Loopback browser integration only: real generated BBB plugin + LGU player bundle,
// real adapter/BFF/federation client, scripted mock LGU engine. This is NOT a real
// federation E2E, production meeting, Odyssey question, or visual approval artifact.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createLocalServer } = require('../scripts/serve-local.cjs');
const { createLiveBrowserFixture } = require('./fixtures/live-browser-fixture.cjs');
const { LGU_PLAYER_COMMIT } = require('../src/player-stage');

async function main() {
  const fixture = await createLiveBrowserFixture();
  const server = createLocalServer({ identityService: fixture.identityService, liveBff: fixture.bff });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const errors = []; const externalRequests = []; const unexpectedPages = []; const apiRequests = [];
  const contexts = [];
  try {
    async function participant(role) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 900 } }); contexts.push(context);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { externalRequests.push(url.origin); return route.abort(); }
        return route.continue();
      });
      context.on('page', page => { if (page !== context.pages()[0]) { unexpectedPages.push(page.url()); void page.close(); } });
      const page = await context.newPage();
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (request.url().includes('/api/lgu-activities/')) apiRequests.push({ role,
          path: new URL(request.url()).pathname, method: request.method(), headers: request.headers(),
          body: request.postData() ? request.postDataJSON() : undefined });
      });
      await page.goto(`${origin}/?role=${role}`);
      return page;
    }

    const teacher = await participant('MODERATOR');
    const teacherApp = teacher.getByRole('button', { name: 'LGU Activities', exact: true });
    await teacherApp.waitFor(); assert.equal(await teacherApp.count(), 1);
    const hostBodyBackground = await teacher.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await teacherApp.click();
    await teacher.getByTestId('live-theme').selectOption(fixture.TOPIC);
    await teacher.getByTestId('live-create').click();
    await teacher.locator('#sidekick .lgu-activities-controller__status').filter({ hasText: /Published sample · lobby/ }).waitFor();
    assert.equal(await teacher.locator('#stage .lgu-player').count(), 0, 'lobby keeps the BBB presentation visible');
    for (const hidden of ['live-question', 'live-answer', 'live-own-result', 'live-reveal', 'live-standings']) {
      assert.equal(await teacher.locator(`#sidekick [data-testid="${hidden}"]`).count(), 0);
    }

    const student = await participant('VIEWER');
    assert.equal(await student.getByRole('button', { name: 'LGU Activities', exact: true }).count(), 0);
    assert.equal(await student.locator('#sidekick').isVisible(), false);
    assert.equal(await student.locator('#stage').innerText(), 'BBB presentation / whiteboard');
    await student.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith('/api/lgu-activities/v1/live/state') && response.status() === 200);
    assert.equal(fixture.counts().entries, 1, 'hidden runtime pre-enters in lobby without opening the game surface');

    await teacher.getByTestId('live-command-start').click();
    await teacher.locator('#sidekick .lgu-activities-controller__status').filter({ hasText: /Published sample · prepare/ }).waitFor();
    await teacher.locator('#stage .lgu-player').waitFor();
    await student.locator('#stage .lgu-player').waitFor({ timeout: 15000 });
    assert.equal(await student.getByRole('button', { name: 'LGU Activities', exact: true }).count(), 0);
    await teacher.getByTestId('live-command-open').click();
    await teacher.locator('#stage .question-prompt').filter({ hasText: 'Choose the fixture answer' }).waitFor();
    await student.locator('#stage .question-prompt').filter({ hasText: 'Choose the fixture answer' }).waitFor();
    assert.equal(await teacher.locator('#stage link[data-lgu-player-commit]').count(), 0, 'pinned stylesheet is scoped in document head');
    assert.equal(await teacher.locator('link[data-lgu-player-commit]').getAttribute('data-lgu-player-commit'), LGU_PLAYER_COMMIT);
    assert.equal(await teacher.evaluate(() => getComputedStyle(document.body).backgroundColor), hostBodyBackground,
      'LGU stylesheet did not change BBB host body CSS');
    assert.equal(await teacher.locator('iframe').count(), 0); assert.equal(await student.locator('iframe').count(), 0);

    await student.locator('#stage .answer-option').filter({ hasText: 'First fixture option' }).click();
    await student.getByRole('button', { name: 'Υποβολή απάντησης', exact: true }).click();
    await student.locator('#stage .live-answered').waitFor();
    await teacher.getByTestId('live-command-close').click();
    await teacher.locator('#sidekick .lgu-activities-controller__status').filter({ hasText: /Published sample · closed/ }).waitFor();
    await teacher.getByTestId('live-command-reveal').click();
    await student.locator('#stage .answer-reveal').waitFor();
    assert.match(await student.locator('#stage .live-own').innerText(), /73/);
    assert.equal(fixture.counts().answers, 1);

    await teacher.getByTestId('live-command-finish').click();
    await teacher.locator('#sidekick .lgu-activities-controller__status').filter({ hasText: /Published sample · finished/ }).waitFor();
    await teacher.locator('#stage .lgu-player').waitFor({ state: 'detached' });
    await student.locator('#stage .lgu-player').waitFor({ state: 'detached', timeout: 15000 });
    assert.equal((await teacher.locator('#stage').innerText()).includes('BBB presentation / whiteboard'), true);
    assert.equal((await student.locator('#stage').innerText()).includes('BBB presentation / whiteboard'), true);
    assert.equal(await student.getByRole('button', { name: 'LGU Activities', exact: true }).count(), 0);

    for (const page of [teacher, student]) {
      assert.equal(await page.locator('iframe').count(), 0);
      assert.equal(await page.evaluate(() => window.__fixtureWindowActions), 0);
      const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie }));
      assert.deepEqual(storage, { local: [], session: [], cookie: '' });
      assert.equal((await page.context().cookies()).every(cookie => cookie.name === 'fixture-bbb-session' && cookie.httpOnly), true);
    }
    assert.deepEqual(unexpectedPages, []);
    assert.deepEqual(errors, []);
    assert.ok(externalRequests.every(value => value === 'https://lgu.thegreekos.com'), 'only configured public artwork origin may be requested');
    assert.equal(fixture.failures.length, 0, fixture.failures.join('\n'));
    assert.ok(apiRequests.some(request => request.path.includes('/player/api/v1/live/') && request.method === 'GET'));
    assert.ok(apiRequests.some(request => request.path.endsWith('/api/lgu-activities/v1/player/api/v1/live/' + fixture.SESSION + '/stream')));
    assert.ok(apiRequests.every(request => !/lgu_(?:fed|session|live)=|x-lgu-federation-/i.test(JSON.stringify(request.headers))));
    assert.equal(fixture.counts().answers, 1);
    console.log(JSON.stringify({
      scope: 'SYNTHETIC LOOPBACK browser smoke; real BBB plugin bundle + canonical LGU player artifact + adapter/BFF, scripted mock LGU engine; not owner visual proof',
      result: 'PASS', lguPlayerCommit: LGU_PLAYER_COMMIT, fixtureCounts: fixture.counts(),
      browserRequests: apiRequests.length, externalPublicAssetOrigins: [...new Set(externalRequests)],
      noIframe: true, noNewWindow: true, noStudentSidekick: true, finishRestoresPresentation: true,
    }, null, 2));
  } finally {
    for (const context of contexts) await context.close();
    await browser.close(); fixture.bff.dispose();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error('Loopback browser smoke failed:', error.message); process.exitCode = 1; });
