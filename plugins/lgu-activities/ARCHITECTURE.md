# Authority boundaries and first Live vertical slice

Target: **verified BBB participant → optional Core association OR temporary guest → LGU activity session → LGU backend**. Current contract: `IDENTITY_V2.md`; current real evidence: `PRODUCTION_MODES_ACCEPTANCE.md`. Organiser authority is always server-verified BBB moderator; Core teacher/student role is enrichment, not a mandatory gateway. Official new-meeting Apps load and real Core/guest/organiser integration have passed. Earlier phase notes below are historical.

| Layer | Authority |
| --- | --- |
| BBB / plugin SDK | Meeting participation, current role and UI placement |
| School Core | Authenticated person, class/lesson membership and teacher/student authorization |
| LGU | Questions, Learn/Play/Live lifecycle, scoring and mastery |
| LGU Activities plugin | Rendering and thin orchestration only; never a second game engine |

Phase 1 deliberately has no backend adapter, network operation, inferred School Core identity, session persistence, scoring state, or fake API. BBB `extId`/`userId` alone must not become proof of identity. The Lesson Assistant and its tokens/context must not be used as an undocumented shared state channel.

Current service is enabled for reboot and all authenticated BBB meetings, with official plugin0.3.0. Valid Core token is introspected; absent credential creates guest without Core/history. Present invalid credential denies, never guest fallback. Preparation still has `lguSessionId:null`; no LGU audience token, account provisioning, engine or session start is implemented. Empty production activity allowlist keeps game actions disabled until approved organiser activity selection is wired.

## Next gate (independent of PR #46)

Agree and fixture-test a **versioned server-validated Live adapter contract** with the School Core/LGU owners using their currently supported APIs:

1. Exchange/validate a short-lived meeting-scoped School Core context through a server-side adapter. Bind BBB meeting + participant to canonical Core person and class; authorize the teacher on the server. Never ship LGU service credentials to the plugin or log tokens.
2. Select one existing LGU activity identifier. Authorized teacher creates/starts **one LGU Live session** through the adapter; LGU supplies the canonical session ID and lifecycle.
3. One canonical Core student joins that session, receives **one LGU-sourced question**, submits **one answer**, and sees the **LGU-returned result**. Teacher sees the canonical session/result state. No local answer evaluation or duplicated scoring/mastery.
4. Test missing/expired context, viewer/unrelated teacher, wrong meeting/class, duplicate start/answer, reconnect/resume and backend unavailable. Adapter validates membership and scope on every operation.

Participant integration now passes real official loader/Core/guest/organiser acceptance. Proceed only in a new authorised task to `LGU_HANDOFF.md`: engine exchange/session binding/idempotent organiser start and Core-or-guest join. No claimed existing LGU route/file names were invented and no LGU source/migration was touched. Authentication changes require private security collaboration per `CLAUDE.md`; do not open a public security PR.