# Phase 2.5 real identity acceptance — BLOCKED

Date: 2026-10-06. Branch: `feat/lgu-activities-plugin`. Baseline: `450ae7951d4b5ecaea73ae419a9381e567504e75`, clean worktree before investigation.

**Gate remains OPEN / NOT READY for LGU integration.** No real BBB student → verified Core identity evidence was obtained. This report is an investigation/handoff, not completed acceptance or a deployment request.

## Authoritative owner located

The user supplied the exact existing School Core component references:

- Repository path on the Core environment: `/opt/school-core`.
- Existing issuer/verifier: `app/api/src/services/classroom-context/classroom-context-token.service.js`.
- BBB join integration: `app/api/src/providers/bbb/bbb.provider.js`.
- Existing student context reference: `infra/notes/phase_131_bbb_classroom_student_context.md`.

These paths are **user-confirmed references, not source-inspected findings**. `/opt/school-core` and all three files are absent/inaccessible on this BBB host. No SSH destination/access to the Core host or mounted Core source was supplied. No guessed remote connection, credentials search, repository clone or production change was attempted. Actual function names, token format/claims/cryptographic issuer string, current Core revision and student verification API cannot be determined from the references alone.

The authoritative identity issuer/verifier belongs to **School Core's existing classroom-context-token service**, not Lesson Assistant, BBB SDK, LGU, or the Phase 2 fixture issuer. Do not create another Core identity service or copy signing secrets into BBB. Historical local Lesson Assistant documents reference Core revision `9d468a5`; this does not establish the current deployment version.

## Locally verified trust path

1. Existing Core join contract passes `/join userID` as `school_core.people.id` and supplies `userdata-schoolcore_context_token`. Source of the Core caller itself is not locally available.
2. BBB exposes the external join ID as `extId`. Current server-side BBB session authentication uses `ConnectionController.checkGraphqlAuthorization` and verified HTTP response headers, including `User-Id`, `User-External-Id`, `Meeting-Id`, `Meeting-External-Id`, `User-Is-Moderator`, `User-Currently-Online`. A valid removed session is not current online membership.
3. GraphQL `public_v_user_metadata.yaml` restricts in-meeting `user_metadata` to current meeting/user/session. Lesson Assistant retrieves only its own `schoolcore_context_token` through the official SDK custom query.
4. Lesson Assistant calls Core `GET /api/integrations/bbb/classroom/context` with a Bearer header over HTTPS. It checks moderator status and exact current `extId` versus returned `teacher.personId`; roster connection display uses exact `extId` versus `students[].studentId`, never names.
5. **Roster observation is not proof of a student's credential subject.** Lesson Assistant's local code does not validate Core signatures or expose an authoritative student-token verifier. That responsibility stays in the existing Core service. A teacher classroom response is not student introspection; frontend equality alone cannot provide the new server-side acceptance evidence.

Source reviewed: `/root/tgos-lesson-assistant/API_CONTRACT.md`, `src/remote-api.js`, `src/lesson-context.js`; BBB `bbb-graphql-server/metadata/databases/BigBlueButton/tables/public_v_user_metadata.yaml`; existing Phase 2 provider/contract. No Lesson Assistant file was changed.

## Access evidence

- Read-only repository/runtime discovery on this host found the BBB checkout and external Lesson Assistant, but no Core checkout or running Docker Core component.
- Integrated browser navigation to the known Core origin landed on **School Core — Sign in** (`/login`), without an authenticated session. No login or credential retrieval was attempted.
- User explicitly confirmed **no approved real lesson/browser access is available now**. Therefore no meeting creation, join, reconnect, participant token exchange or real activity panel activation was performed.
- Historical teacher/Test Room reports are not Phase 2.5 student evidence. `adhoc_test` remains denied by the v1 contract; do not relax that rule to substitute anonymous Test Room participants for canonical Core students.

## Minimum next work in the existing Core component

This is a source-review checklist, **not a proven required production code/schema change**:

1. Make the three referenced Core files and applicable repository instructions available in the workspace (read-only mount/copy or authorized workspace on the Core host; no `.env`, private keys, bearer tokens or personal join URLs in chat).
2. Inspect the existing service's actual verification method and the student context note. Reuse it to return the authenticated **token subject**: canonical Core `people.id`, token-derived role, authorized meeting/lesson scope, expiry and current membership. Do not infer subject from a browser `personId`/`studentId`, an unsigned token decode or a teacher roster. Check existing student self-context support before proposing any new route.
3. Wire `verifyCoreCredential` in the existing integration backend to that verification method. If cross-service validation is required, expose only the smallest authenticated internal facade around the **existing verifier**, not a second issuer. Whether a facade or any Core code change is necessary is unknown until source inspection. No endpoint/function name is invented here.
4. Combine the verified Core result with the independently authenticated BBB session headers. Compare Core subject with BBB `User-External-Id` and meeting scope; derive current internal participant and moderator authority from the BBB server response. Check both teacher authorization and student membership in Core.
5. Review the Phase 2 provider's strict `participantId` expectation against the actual Core mechanism. BBB internal participant ID may not exist when Core issues a pre-join token. If the existing token validates person + meeting, establish current participant binding **after BBB session verification** at the server-side exchange using the existing join/session binding. Do not require a new permanent identity or token-schema migration merely to mirror a fixture. Any adjustment must be justified from the actual source and tested against stolen/mixed student proofs; until then retain fail-closed behavior.
6. Provide signing configuration and mount the existing adapter only after review in an approved controlled environment. First determine whether current same-origin cookie path/proxy routing permits the BBB auth hook proof. Do not move credentials into URLs or loosen the Origin/cookie boundary to make a test pass.

No migration is justified by available evidence, and none was applied. If source inspection identifies one, stop before applying it and document the need. Production Core modification/deployment is not authorized by this report. Authentication/security changes must use private collaboration per `CLAUDE.md`, not a public security PR.

## Real acceptance matrix — all NOT RUN / BLOCKED

| Check | Status |
| --- | --- |
| Real teacher → verified Core teacher + current BBB moderator | BLOCKED: source/verifier and approved account/meeting access unavailable |
| Real student → correct canonical Core `people.id` | BLOCKED; no real evidence |
| Student B cannot redeem Student A identity/token | NOT RUN on real accounts; prior fixtures are not replacement evidence |
| Student has no teacher authority | NOT RUN on real accounts |
| Reconnect preserves canonical/activity identity | NOT RUN on real accounts |
| Unknown participant remains temporary/fail-closed | NOT RUN in real meeting |
| Live unlocks only for verified real teacher | NOT RUN; production provider remains unavailable/fail-closed |

Stable ID contract: **BBB external `userID` → `extId` / `User-External-Id` → School Core `people.id`**. No real person's ID was transferred or captured in this phase. Report equality outcomes using per-run opaque aliases (teacher, student-A, student-B), not names, raw person IDs, session credentials or token payloads. Evidence must come from the server verifier/BBB auth response, not client body or fixture registry.

## Controlled acceptance once unblocked

Core owner authorizes one **normal lesson** with one teacher and two canonical Core students, plus a designated unknown participant if allowed. Use the existing personal Core join flow and scoped plugin activation, not a synthetic `/join userID` fabricated by BBB tooling. Keep credentials in authenticated browser/server memory; store only sanitized results. Compare verified subject/role/meeting/participant bindings, test cross-student token use with each student's own proofs, reject teacher scope for a student, reconnect one student, and check teacher-only Live unlock/context preparation. Do not start an LGU game. Document rollback before any strictly necessary test hosting/routing change; no global activation or unrelated-meeting changes.

## Change scope and readiness

This phase adds this report only. No runtime/provider/claim changes, Core edits, identity system, migration, BBB core changes, LGU repository/PR #46 access or changes, LGU endpoint implementation, asset hosting, configuration changes, service restart or production deployment occurred.

**READY = NO.** Unblocking inputs are (1) accessible authoritative Core source/verifier, and (2) approved normal teacher/two-student lesson/browser access. After real acceptance passes, use `LGU_HANDOFF.md`; do not implement the LGU endpoint now.