# Phase 1 validation — 2026-10-06

Branch: `feat/lgu-activities-plugin`. BBB baseline: `9916ef7bbb` on `maintained/v4.0` with a clean worktree.

## Results

| Check | Result |
| --- | --- |
| Clean lockfile install (`npm ci --no-audit --no-fund`) | PASS, 140 packages |
| Unit / UI / source-contract tests (`npm test`) | PASS, 15/15; no skips |
| Production Webpack build (`npm run build`) | PASS, SDK 0.1.26; bundle 241,511 bytes |
| Manifest version/path, SDK pin and SHA-384 SRI | PASS |
| Rebuild after clean `npm ci` | PASS, byte-identical SHA-256 |
| Local Chromium browser verification (`npm run test:browser`) | PASS, 8 verification groups |
| JS syntax checks (`node --check`) | PASS |
| Editor diagnostics and `git diff --check` | PASS |

Bundle SHA-256: `0fcc486d9436e23c549420822ff67a30715791ea7d729be1d9ca64388c5079cc`.

Generated manifest SRI: `sha384-76FK30Dia7xCkN4gQlKHOHFsPYeaLZF0iiXYG93Ygpx6SCAcIZBt2eLIzCEUh4NF`.

## Browser evidence and limits

Chromium `141.0.7390.37` loads the real built plugin, real SDK and generated manifest/SRI on an ephemeral **127.0.0.1-only** HTTP server. This is a test host, **not a real BBB meeting**. The host simulates only SDK role responses, the automatic generic-sidekick Apps registration and content root ownership.

Verified:

1. Generated manifest, immutable versioned bundle and browser SRI loading; exactly one LGU Activities Apps item for moderator; initially closed.
2. Keyboard activation opens the teacher panel; Μαθαίνω, Παίζω, Live produce local shell notices only.
3. Close/reopen unmounts the panel root and resets selection.
4. Viewer, loading and error responses remove the app/panel; moderator promotion restores one entry; sibling host-fixture app remains.
5. 375px mobile viewport has no horizontal overflow.
6. Refresh produces exactly one entry.
7. Initial viewer load exposes no teacher app/panel.
8. No external requests, console errors or page errors.

Regenerable, Git-ignored evidence: `.local/browser-verification.json` and `.local/teacher-panel.png`. Build output is also ignored; rebuild using the committed lockfile. Browser test closes its server and browser in `finally`; no daemon is left running.

**Not claimed:** actual BBB meeting load/GraphQL manifest ingestion, live coexistence with Lesson Assistant, real Core identity or LGU backend acceptance. Those require a separately authorized controlled meeting after asset hosting; no production hosting/activation was performed here. The local source investigation confirms BBB4 automatically maps the official GenericContentSidekickArea into Apps Gallery.

## Scope audit

Only `plugins/lgu-activities/` is added to BBB Git. No existing BBB source/package/configuration is modified. Lesson Assistant sources and deployed assets were read only. No LGU repository or PR #46 was touched or awaited; no LGU package dependency exists. No migrations, API calls, global plugin configuration, service restart, `/var/www` asset installation, real meeting creation, deployment, push or PR occurred.

See `ARCHITECTURE.md` for the next deliverable: approved Core identity → canonical LGU Live session adapter fixtures, followed by one teacher / one student / one question / one LGU-scored answer vertical slice.