# In-BBB Live federation BFF — release 0.4.0 (not deployed)

Authoritative reference: **Thegreekos/lgu**, `feat/bbb4-federation-live-slice`, pinned commit `36cd87f9b2b80d090d98febfce5147115bf54828`, `docs/BBB4_FEDERATION.md` including §4a. Source inspected read-only: `src/domain/federation.ts`, `src/server/federation.ts`, `api.ts`, `live.ts`, `request-origin.ts`, quiz answer types and federation tests. LGU snapshot was obtained outside BBB Git; no runtime import, dependency, copy of its engine, branch edit or push. No production deployment occurred on either product.

## Trust/transport

Each BFF operation uses the existing `identifySelf()` chain: current online BBB session/cookie → server-derived meeting/principal/moderator authority → optional fresh Core introspection. A participant's own proof is all the browser sends. Identity mode `core` launches `{kind:"core",issuer:<verified Core namespace>,subject:<verified people.id>}`; guest launches **only** `{kind:"guest"}`. No guest subject/issuer/account/history association is fabricated.

Launch uses the verified BBB **internal meeting incarnation** as LGU meeting key, preventing meeting recreation from reopening another session. Federation participant key is the server-derived canonical/guest principal, not a browser declaration: Core reconnect with a new BBB internal connection can retain its same LGU participant; guest key remains limited to verified meeting+participant. Display labels are deliberately generic server-generated `BBB Moderator`/`BBB Participant`, not browser names. LGU handles label numbering; labels never identify accounts. Mode/Core binding/authority changes invalidate the cached record and require explicit reconnect; LGU can refuse incompatible identity changes too.

Exactly the LGU HMAC protocol:

`LGU-FEDERATION-V1\nissuerId\nunixSeconds\nfreshNonce\nUPPER_METHOD\n/path?exact=query\nsha256Hex(exactBodyBytes)`.

HMAC-SHA256 uses the **LGU-issued** 43-character base64url secret in protected `/etc/bigbluebutton/lgu-activities/federation_issuer_secret` (service user, mode0600, parent0700, no symlink). This is not the Core introspection credential or BBB JWT signing key. No secret is generated/provisioned in this task. The four `X-LGU-Federation-*` headers match LGU exactly. Fresh cryptographic nonce on **every** signed request, including GET/context/stream and retries initiated explicitly by the user; method/path/query/raw UTF8 body bytes signed as sent. GET signs empty bytes. Signed calls never carry Cookie/Origin. LGU, not BBB, consumes nonces and enforces ±300s freshness/replay.

Moderator context/state/commands/create/stream use signed federation routes with **server-owned** LGU `principalId` in signed body/query. Viewer host mutations are denied before upstream work. Context themes are LGU's current licensed/usable list; selected `topicId` must occur there. No theme/question catalogue or marking rules are duplicated.

## Server-only activation and credential vault

After signed `/launch`, the ticket is held only by the BFF and exchanged with **POST JSON `/api/v1/federation/bbb4/activate`**. Source `api.ts:federatedReply` confirms this transport returns HttpOnly cookies; no browser-navigation `/activate`, new window or native transport impersonation is used. BFF sends upstream LGU origin + `X-LGU-Request:1`, as required by `request-origin.ts`. This is server-issued request metadata, not relaxed browser CORS. Standard cookie requests are never mixed with HMAC transport.

Only `lgu_fed`, `lgu_session` (Core), `lgu_live` (guest after entry), each exact43-character token, are accepted into a per-principal server-only cookie vault. Vault honors deletion/Max-Age, capped12h; requires proper activation identity/authority/meeting bindings. LGU guest may not receive account cookie. Failed fresh BBB/Core authentication and critical upstream errors invalidate held cookies. Tickets/cookies/secret/raw upstream errors never cross BFF responses, browser storage, URLs or logs; no Set-Cookie/Location passthrough. Records capped1000, per-principal requests serialized, expired records removed; restart disposes vaults. This is single-process transient credential state, not HA session persistence.

## Closed federation door — §4a

Creates through `POST /api/v1/federation/bbb4/sessions {principalId,topicId}`, expects `session.entry === "closed"`. Never sends an `open` entry policy or public code. Strips `code`, `joinPath`, `pending` from every response, even if unexpectedly present upstream.

Participant admission is **POST `/api/v1/federation/bbb4/sessions/:id/enter`** with server-held federated cookie. Core account/live guest cookies then call the **ordinary** engine routes: `/api/v1/live/:id`, `/stream?after=`, `/answer`. No code door, QR, membership bypass or second Live engine. LGU retains its lobby-only newcomer entry, idempotent reconnect, removed/finished denial and answer eligibility/version checks. Moderator never enters as a player.

Every selected session must occur in the freshly read LGU context for this verified meeting; no browser upstream URL/principal/cookie is accepted. State requires closed entry and correct host/participant view. Answer proxy sends only `{questionIndex,phaseVersion,answer:string[]}`; LGU validates/marks/scores. Host action sends exact `{principalId,action,expectedVersion}` to the existing engine. Timeout/409 does **not** retry mutations automatically: user reloads/reconciles LGU state first.

## Same-origin BBB routes

All **POST JSON**, existing BBB session header/cookie + own optional Core Bearer, exact BBB Origin, no-store, body≤16k:

| BBB suffix under `/api/lgu-activities/v1/live/` | Body | LGU use |
| --- | --- | --- |
| `context` | `{}` | signed launch if needed, JSON activate server-side, signed context/themes/sessions |
| `create` | `{topicId}` | moderator-only signed sessions creation |
| `enter` | `{sessionId}` | viewer-only closed federation door |
| `state` | `{sessionId}` | signed host state / ordinary cookie learner state |
| `stream` | `{sessionId,after}` | signed host SSE / ordinary learner SSE |
| `command` | `{sessionId,action,expectedVersion}` | moderator Start/Open/Close/Reveal/Next/Finish (server also supports contract cancel) |
| `answer` | `{sessionId,questionIndex,phaseVersion,answer}` | ordinary LGU learner answer |

SSE is authenticated POST fetch, **not credential-bearing EventSource URL**. It relays sanitized LGU notifications with sequence IDs; UI refetches the authoritative state. Upstream/relay streams are bounded20s and cancelled on disconnect; reconnect rechecks own BBB/Core proof. UI bounded reconnect attempts then3s polling fallback, no local state machine, scoring, answer key or command replay. Headers never pass through. CRLF/LF, chunkedUTF8/frame limits/backpressure tested.

All loaded participants receive one official Apps sidekick via SDK. Moderator sees theme picker and host controls only when server context confirms `canHost`, plus current BBB moderator. Core/guest viewers see session lobby entry, actual LGU prompt/options and inline answer controls. Choice/boolean/image/cloze use one option ID; order sends permutation; match sends right IDs in original left-option order, matching pinned `Answer=string[]`. Unknown kinds do not submit. React escapes text, no iframe/raw markup/window opening. Reveal own correctness/points/explanation and standings are displayed directly from LGU, never recomputed. The UI remains at the BBB origin.

## Configuration / disabled-by-default

`runtime.cjs` enables Live only when server config `federation.enabled === true`. Missing/disabled config returns safe503 `FEDERATION_NOT_CONFIGURED`; existing identity routes remain independent. Operator adds a fixed trusted **HTTPS LGU origin**, registered `issuerId`, and deployed BBB `pluginCommit` under `federation`. Only tests explicitly permit loopback HTTP. Browser cannot choose issuer/origin/path/secret file. Secret must be provisioned server-to-server by LGU registration, not typed into chat, committed, env/bundle/manifest/HTML5 settings.

Deploy template includes separate exact `/live/{context,create,enter,state,stream,command,answer}` nginx routes, same-origin auth, existing IP rate limits, no request access log/cache, SSE buffering disabled/timeouts25s. **Template/source only; not installed here.** Build0.4.0 creates new immutable assets; production stays0.3.0 until approved rollout. Existing meeting captures are not patched/injected.

## Failure rules

LGU401 expired/revoked → safe401, clear vault, explicit relaunch/reconnect. 403 denied/404 foreign or unavailable → same status, no data; 409 stale/replay/closed-entry → state reconciliation, no mutation retry; 429 throttled → unavailable UI, no blind retry;5xx/transport → sanitized503 fail-closed; malformed response→502 and credential cleanup. No response-body error details, redirects, arbitrary endpoint or raw cookies are exposed. Browser errors close old controls and require explicit reconnect. Every stream reopening/request rechecks current authority; last20s stream is the bounded authorization window, not indefinite positive identity caching.

## Exact real-E2E/deployment prerequisites (not performed)

1. On an **isolated LGU environment**, apply its own migration013 per LGU owner, run pinned36cd87f9 backend, turn organisers/federation on. No LGU production migration/deployment was attempted here.
2. Create/promote/license issuer's existing organiser account via normal LGU admin flow; register BBB issuer with matching Core namespace. Transfer the **returned existing LGU secret** directly to the protected BBB BFF test host file. Provide non-secret issuer/origin config; never reuse Core credential/JWT private key.
3. Install0.4 BBB server/client/nginx templates on an **approved BBB test runtime**, federation opt-in. Keep production host untouched until explicit deployment authorization; check clock sync, TLS, permissions, health, rate limits and cookie isolation.
4. New Portal BBB test meeting loads LA+LGU0.4 officially. Moderator selects a published licensed theme and creates one session. Verify LGU database policy remains closed, no join code exposed. Core student or verified non-Core guest enters lobby **before** Start/Open.
5. Moderator Start/Open; learner sees actual engine question in BBB and submits exact answer. Moderator Close/Reveal; learner sees actual LGU correctness/points/standing. Capture only anonymized PASS/equality evidence, not IDs/secrets/cookies/answers with personal information. Finish cleanup; demonstrate reconnect/error/revocation cases.
6. Review process-local BFF vault continuity on restart and concurrent adapters: current implementation requires explicit relaunch and LGU idempotent entry after restart, not shared HA cookie cache. Configure observability without credentials and test load/clock/rate limits before wider deployment.

**Code/contract integration ready for approved federation deployment: YES. Real BBB4↔LGU one-question engine E2E: NOT RUN, pending isolated runtime/issuer provisioning.** The local browser test is scripted LGU response evidence only. No LGU repository, Core, frame policy or production runtime change was made.