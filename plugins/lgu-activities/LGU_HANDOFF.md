# Exact LGU integration work after Phase 2

No LGU repository was inspected or changed, no PR #46 was consulted/awaited, and no LGU API availability is assumed. These are explicit backend capabilities/contracts to wire to LGU's existing engine, not fictional existing endpoint or filename claims.

## Prerequisite outside LGU

Authoritative `verifyCoreCredential` now uses the existing Core token introspection endpoint with server-verified BBB expected person/external meeting/role/kind. Internal BBB participant binding is established after successful introspection, not required as a pre-join Core token claim. Service authentication probe passed; real teacher/two-student acceptance has not. Confirm normal classroom context meeting binding and host/review the adapter only in a separately authorized environment, with existing signing keys, rate limits/state store and real acceptance. Without that gate, LGU must not accept any fixture or adapter identity as production identity. No new Core issuer or service credential is created.

## Required LGU-side work

1. **Federated identity adapter:** accept only a configured trusted integration issuer; verify EdDSA signature, exact `kid`/issuer/audience/type, temporal bounds, schema version and scope. Resolve stable `(coreIssuer, corePersonId)` to LGU's existing person identity server-side. No display-name matching, browser-declared student/teacher, or anonymous-to-permanent-account promotion. Do not auto-create permanent accounts from an activity-scoped `sub`.
2. **Server-to-server token exchange:** adapter-audience Phase 2 tokens are not LGU credentials. Independently revalidate current BBB/Core proofs and membership at exchange, bind the validated activity to LGU's canonical session, and issue a short-lived **LGU-audience**, session-bound credential. LGU must reject the Phase 2 token directly; never receive raw BBB/Core proofs in public URLs. Trusted exchange belongs server-side, not in the plugin.
3. **Idempotent teacher start:** existing LGU Live creation/start engine receives validated teacher identity + approved activity ID + external integration context. Atomically consume/idempotently redeem `jti` and deduplicate by integration issuer + BBB meeting incarnation + context + activity. Duplicate calls return the same canonical LGU session ID, not a second game. Persist/session state remains LGU authority. Bind its session ID to subsequent credentials; `lguSessionId: null` may not authorize joining/answering a real session.
4. **Self-only student join/resume:** canonical Core student uses their own validated exchange and teacher-created session; enforce current class/session membership. Other student token/proof, wrong meeting, expired credential, revoked membership and teacher scope misuse fail closed. Reconnect returns the existing LGU participant for the same canonical person/session; old internal BBB participant proof/token cannot be reused with the new participant binding.
5. **Thin Live vertical slice:** existing LGU question delivery → one answer submission → canonical LGU result, scoped to the authenticated student/session. Reuse LGU scoring/mastery; no BBB answer checking. Student answers cannot submit another student ID. Add LGU's normal command idempotency for duplicate answers, independently of read-only identity verification.

## Minimum cross-system contract fixtures

- Success: teacher start `{ activityId, validatedTeacher, integrationContext }` → canonical `{ lguSessionId, activityId, state }`; self student join → existing canonical session participant; one canonical question/answer/result.
- Deny: wrong issuer/audience/algorithm/kid, missing/noncanonical session ID, context/session mismatch, other student's proof/token, browser role override, viewer teacher, guest/test context, expired/future credential and revoked membership.
- Resume/idempotency: duplicate teacher start and token redemption produce one session; reconnect preserves person/session participant; duplicate answer is handled by LGU's existing policy.

Specific LGU files/routes and whether these require changes versus wiring existing capabilities must be determined from LGU's authoritative source **in the next authorized phase**. If a migration is judged necessary there, stop before applying it and document why. This phase adds no LGU session endpoints or migrations and performs no deployment.