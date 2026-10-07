# BBB Live BFF validation — 2026-10-07

Branch `feat/lgu-activities-plugin`, clean baseline `0fca01aec3`; undeployed release **0.4.0**. Authoritative LGU branch `feat/bbb4-federation-live-slice`, verified HEAD **36cd87f9b2b80d090d98febfce5147115bf54828**. Snapshot outside BBB repo, read-only, clean after inspection; no LGU/Core/production change or runtime cross-repo dependency. `FEDERATION_BFF.md` is the implementation/deployment contract.

## Results

| Check | Result |
| --- | --- |
| Clean lockfile install | PASS,141 packages |
| Existing identity + new federation/BFF/HTTP/frontend tests | **210/210 PASS**, no skips |
| Production webpack release0.4.0 | PASS,254,262-byte browser bundle |
| Manifest/SRI/SDK/version and server-secret exclusion patterns | PASS |
| Browser one-question contract harness | **8/8 PASS** |
| Browser errors/external requests/unexpected tabs | **0 / 0 / 0** |
| Syntax/editor diagnostics/whitespace | PASS |
| Pinned LGU checkout HEAD/status | Exact pinned commit,clean |
| Existing production BBB service | active/running/enabled,unchanged identity mode |

## Contract tests (mocks, not LGU database/engine execution)

- Independent crypto oracle checks exact HMAC-SHA256 payload/UTF8 body, timestamp, fresh nonce, uppercase method, **pathname+query**, empty GET digest; no signed cookies. Cross-path/query/body changes produce different signature. Replay prevention resides in LGU; BBB does not claim a local nonce database.
- Verified Core/guest launch schemas, moderator themes/current licensed selection and closed session creation. JSON activation sends LGU same-origin mutation headers; server vault stores only exact43-character federation/account/live cookies and validates activation bindings. No GET navigation/native impersonation. Core launch uses stable subject/issuer; guest carries neither.
- Viewer host authority denial before upstream mutation; foreign meeting/session/URL/principal body rejection; closed federation door/idempotent participant entry; ordinary engine learner state/answer/stream credentials. No code/open-policy/QR used or exposed.
- All host commands, exact expectedVersion and engine `answer:string[]`, questionIndex/phaseVersion forwarded without marking. Engine response fixture correctness/points/rank presented unchanged; no scoring function imported/copied.
- Reconnect, parallel launch serialization, same LGU participant, invalidated proof/mode/authority, cookie/record expiry, stale command409 and federation identity change. Requests are not automatically repeated after uncertain mutation results. Vault cleanup includes timed relaunch then proof revocation.
- HTTP401/403/404/409/429/5xx, timeout/invalid JSON/oversized responses/malformed questions fail closed with safe statuses. Browser gets no secret/ticket/cookie/raw upstream error. Only known engine fields and recursively redacted view delivered; no Set-Cookie/redirect/header passthrough.
- SSE LF/CRLF/chunked UTF8, cursor query signatures, sanitized notifications, backpressure, disconnect cancellation, bounded20s stream authorization and reauthenticated reconnect; browser polling fallback reconciles engine state, not a second game state machine.
- Official Apps registration extended to loaded viewers/guests; server `canHost` + current BBB moderator gates host UI. All pinned question kinds (choice/boolean/image/cloze/order/match) render escaped inline controls and exact answer arrays; unsupported kinds cannot submit. Reveal-only own correctness/points/standings, cleanup, stale responses and no retry of answers tested.

## Browser vertical slice — synthetic contract evidence

Actual built0.4.0 bundle, real SDK0.1.26, real BBB-local HTTP handler, BFF, signing/cookie client loaded in Chromium141.0.7390.37 against a loopback-only test host. **BBB identity responses and LGU HTTP responses are fixtures.** No actual LGU deployment/engine/database or Portal meeting was used in this test.

1. Moderator opens Apps panel by keyboard, context lists fixture theme, selects it and creates **closed** lobby.
2. Isolated guest viewer opens own LGU panel, has no host buttons, enters lobby through BFF federation door.
3. Moderator Start/Open; learner sees fixture LGU question, selects option and submits `['a']` **once** via ordinary learner proxy.
4. Moderator Close/Reveal; learner sees **mock engine-provided** `Correct · Points:73` and standing `Total:73`. That number is a canned upstream response, not local scoring or real LGU engine evidence.
5. Stale Next409 removes old controls; explicit reconnect restores current reveal without replay or another launch/entry.
6. Close/reopen, current-user loading/error, learner refresh and mobile layout passed.
7. Both browsers stay at their same loopback BBB-test origin; no iframe/window/tab actions or external requests. Every BFF operation re-verifies self identity. Mock server validates fresh signature nonces/exact bytes/query.
8. Secret/tickets/LGU cookies/private join data absent from DOM/storage/browser cookie jar and completed response bodies/headers, including SSE/409. LGU credentials are held only by server fixture BFF.

Observed:37 fresh self-verifications,59 signed upstream requests,2 launches/activations,1 participant entry,1 answer,5 commands,7 streams. Inspected41 response bodies;1 cancelled response inspection bounded separately, no cancelled data claimed as inspected. Evidence screenshots/JSON under Git-ignored `.local/` are regenerable with `npm run test:browser`. Harness is clearly marked synthetic; fixtures create no alternate engine or permanent account/history.

## Not performed

**Real BBB↔LGU one-question E2E: NOT RUN.** No authorized isolated deployed federation backend/registered issuer secret was supplied. LGU contract itself says implementation is undeployed, featureflag off and migration013 unapplied in production. No migration, organiser licence registration, issuer creation, secret generation/transfer or upstream production request was performed. No production BBB server files/service/nginx/plugin assets/settings changed. Existing runtime continues0.3.0;0.4.0 is source/build only. No LGU/Core code edits, public security PR or push.

## Exact remaining real-E2E gate

Follow `FEDERATION_BFF.md` rollout checklist: LGU owner provisions isolated pinned backend and its migration/feature flags, licensed organiser+issuer; safely transfers LGU-issued HMAC secret to BBB **test** host protected file and supplies non-secret origin/issuer. Enable federation config and0.4 server/client/exact nginx routes only in approved test runtime. New official BBB meeting: host selects existing published licensed theme, creates closed lobby; Core or guest learner enters before Start/Open; one actual engine answer, Close/Reveal engine result inside BBB; verify no code/cookie/secret leakage and engine score independently via LGU owner/test evidence. No synthetic substitute for this gate. Production rollout requires separate authorization after it passes.

**READY FOR FEDERATION DEPLOYMENT: YES — code/contract/mock validation complete, ready for approved isolated rollout. This is not approval/evidence of production deployment or real engine E2E. Stop before production deployment.**