const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createLocalServer } = require('../scripts/serve-local.cjs');

async function main() {
  const server = createLocalServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const checks = [];
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        externalRequests.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    const app = page.getByRole('button', { name: 'LGU Activities', exact: true });
    await page.goto(origin);
    await app.waitFor();
    assert.equal(await app.count(), 1);
    assert.equal(await page.locator('#sidekick').isVisible(), false);
    const script = page.locator('script[pluginName="LGUActivities"]');
    assert.match(await script.getAttribute('src'), /releases\/0\.1\.0\/LGUActivities\.js\?version=0\.1\.0/);
    assert.match(await script.getAttribute('integrity'), /^sha384-/);
    checks.push('Generated manifest/versioned bundle/SRI initialize real SDK; exactly one Apps item; panel initially closed');
    await app.focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('lgu-activity-learn').waitFor();
    assert.equal(await page.locator('#content button').count(), 3);
    for (const [id, label] of [['learn', 'Μαθαίνω'], ['play', 'Παίζω'], ['live', 'Live']]) {
      await page.getByTestId(`lgu-activity-${id}`).click();
      assert.equal(await page.getByTestId(`lgu-activity-${id}`).getAttribute('aria-pressed'), 'true');
      assert.match(await page.getByRole('status').innerText(), new RegExp(`${label}:.*Δεν ξεκίνησε δραστηριότητα`));
    }
    checks.push('Keyboard opens teacher panel; Μαθαίνω / Παίζω / Live show safe shell notices');
    const evidence = path.join(__dirname, '../.local');
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, 'teacher-panel.png'), fullPage: true });
    await page.getByRole('button', { name: 'Κλείσιμο panel' }).click();
    await app.click();
    await page.getByTestId('lgu-activity-live').waitFor();
    assert.equal(await page.getByTestId('lgu-activity-live').getAttribute('aria-pressed'), 'false');
    checks.push('Close/reopen unmounts root and resets local selection');
    for (const role of ['VIEWER', 'LOADING', 'ERROR']) {
      await page.locator('#role').selectOption(role);
      await app.waitFor({ state: 'detached' });
      assert.equal(await page.locator('#sidekick').isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'Existing app (host fixture)', exact: true }).count(), 1);
      await page.locator('#role').selectOption('MODERATOR');
      await app.waitFor();
      await app.click();
      await page.getByTestId('lgu-activity-live').waitFor();
    }
    checks.push('Viewer/loading/error remove app and panel; promotion restores one app; sibling unaffected');
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    checks.push('Mobile viewport has no horizontal overflow');
    await page.reload();
    await app.waitFor();
    assert.equal(await app.count(), 1);
    checks.push('Refresh loads exactly one app');
    await page.goto(`${origin}/?role=VIEWER`);
    await page.getByRole('button', { name: 'Existing app (host fixture)', exact: true }).waitFor();
    assert.equal(await app.count(), 0);
    assert.equal(await page.locator('#sidekick').isVisible(), false);
    checks.push('Initial viewer load has no LGU teacher app or panel');
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
    checks.push('No external requests or browser errors');
    const report = { scope: 'Local real-SDK host harness, NOT a live BBB meeting', checks,
      browser: await browser.version(), externalRequests, errors };
    fs.writeFileSync(path.join(evidence, 'browser-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });