// Explicit administrative acceptance operation: authentic BBB join, no Core
// userdata/person ID and no synthetic identity provider. Sanitized output only.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');

async function main() {
  const organiser = process.argv.length === 6 && process.argv[5] === '--organiser-check';
  if ((!organiser && process.argv.length !== 5) || process.argv[2] !== '--live-guest-check' || process.argv[3] !== '--meeting'
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(process.argv[4])) throw new Error('Explicit existing meeting required');
  let salt;
  for (const file of ['/usr/share/bbb-web/WEB-INF/classes/bigbluebutton.properties', '/etc/bigbluebutton/bbb-web.properties']) {
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, 'utf8').split('\n').find(line => /^\s*securitySalt\s*=/.test(line));
    if (line) salt = line.slice(line.indexOf('=') + 1).trim();
  }
  if (!salt) throw new Error('Missing existing signing configuration');
  const params = new URLSearchParams({ meetingID: process.argv[4], fullName: organiser ? 'LGU non-Core organiser acceptance' : 'LGU non-Core guest acceptance',
    role: organiser ? 'MODERATOR' : 'VIEWER', redirect: 'true' });
  const query = params.toString();
  params.set('checksum', createHash('sha1').update(`join${query}${salt}`).digest('hex'));
  salt = null;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let navigated = true;
    try { await page.goto(`https://meet.thegreekos.com/bigbluebutton/api/join?${params}`, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
    catch { navigated = false; }
    if (!page.url().startsWith('https://meet.thegreekos.com/html5client')) throw new Error('Join failed');
    await page.waitForFunction(() => !!window.React && !!sessionStorage.getItem('BBB_sessionToken'), { timeout: 30000 });
    const result = await page.evaluate(async organiser => {
      const session = sessionStorage.getItem('BBB_sessionToken');
      const metadataResponse = await fetch('/api/rest/userMetadata', { credentials: 'same-origin', cache: 'no-store',
        headers: { 'x-session-token': session } });
      const metadata = await metadataResponse.json();
      const rows = metadata.user_metadata ?? metadata.data?.user_metadata;
      if (metadataResponse.status !== 200 || !Array.isArray(rows)) return { validMetadata: false };
      const credentialAbsent = !rows.some(row => row.parameter === 'schoolcore_context_token');
      const headers = { 'content-type': 'application/json', 'x-bbb-session-token': session };
      const reply = await fetch('/api/lgu-activities/v1/self', { method: 'POST', headers, credentials: 'same-origin', cache: 'no-store', body: '{}' });
      const self = await reply.json();
      const denied = await fetch('/api/lgu-activities/v1/identity', { method: 'POST', headers, credentials: 'same-origin', body: '{}' });
      const error = await denied.json();
      return { validMetadata: true, coreCredentialAbsent: credentialAbsent, status: reply.status,
        guestMode: self.identity?.mode === 'guest', nullCoreIdentity: self.identity?.corePersonId === null,
        persistentHistoryDisabled: self.identity?.persistentHistoryEligible === false,
        coreLearningContextAbsent: self.learningContext === null,
        organiserAuthorityCorrect: self.identity?.organiser === organiser,
        organiserRouteCorrect: organiser ? denied.status === 200 && error.identity?.organiser === true && error.identity?.mode === 'guest'
          : denied.status === 403 && error.error === 'TEACHER_REQUIRED',
        officialLguLoaded: !!document.querySelector('script[pluginName="LGUActivities"]'),
        organiserGalleryItemCorrect: organiser ? true : !document.querySelector('[data-test="apps_gallery_item_lgu-activities-panel"]') };
    }, organiser);
    if (organiser && result.status === 200) {
      const dialogClose = page.locator('[role="dialog"] button').first();
      if (await dialogClose.count()) await dialogClose.evaluate(b => b.click());
      await page.locator('[data-test="appsGallerySidebarButton"]').evaluate(b => b.click());
      await page.getByRole('button', { name: 'LGU Activities', exact: true }).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'LGU Activities', exact: true }).evaluate(b => b.click());
      await page.waitForFunction(() => document.querySelector('[data-testid="lgu-identity-status"]')?.textContent?.includes('Verified BBB organiser · Temporary guest'), { timeout: 10000 });
      result.organiserGalleryItemCorrect = true;
      result.guestOrganiserPanelOpened = true;
    }
    if (!result.validMetadata || !result.coreCredentialAbsent || result.status !== 200 || !result.guestMode
      || !result.nullCoreIdentity || !result.persistentHistoryDisabled || !result.coreLearningContextAbsent
      || !result.organiserAuthorityCorrect || !result.organiserRouteCorrect || !result.officialLguLoaded || !result.organiserGalleryItemCorrect) {
      console.log(JSON.stringify({ liveGuestAcceptance: 'FAIL', navigated, ...result })); process.exitCode = 1;
    } else console.log(JSON.stringify({ liveGuestAcceptance: 'PASS', requestedAuthority: organiser ? 'moderator' : 'viewer', ...result }));
    await context.close();
  } finally { await browser.close(); }
}
main().catch(() => { console.error('Live guest acceptance FAIL (sanitized; no credentials or URLs)'); process.exitCode = 1; });