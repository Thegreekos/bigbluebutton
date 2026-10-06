# Authority boundaries and first Live vertical slice

Target: **BBB participant → School Core identity → LGU activity session → LGU backend**.

| Layer | Authority |
| --- | --- |
| BBB / plugin SDK | Meeting participation, current role and UI placement |
| School Core | Authenticated person, class/lesson membership and teacher/student authorization |
| LGU | Questions, Learn/Play/Live lifecycle, scoring and mastery |
| LGU Activities plugin | Rendering and thin orchestration only; never a second game engine |

Phase 1 deliberately has no backend adapter, network operation, inferred School Core identity, session persistence, scoring state, or fake API. BBB `extId`/`userId` alone must not become proof of identity. The Lesson Assistant and its tokens/context must not be used as an undocumented shared state channel.

## Exact next step (independent of PR #46)

Agree and fixture-test a **versioned server-validated Live adapter contract** with the School Core/LGU owners using their currently supported APIs:

1. Exchange/validate a short-lived meeting-scoped School Core context through a server-side adapter. Bind BBB meeting + participant to canonical Core person and class; authorize the teacher on the server. Never ship LGU service credentials to the plugin or log tokens.
2. Select one existing LGU activity identifier. Authorized teacher creates/starts **one LGU Live session** through the adapter; LGU supplies the canonical session ID and lifecycle.
3. One canonical Core student joins that session, receives **one LGU-sourced question**, submits **one answer**, and sees the **LGU-returned result**. Teacher sees the canonical session/result state. No local answer evaluation or duplicated scoring/mastery.
4. Test missing/expired context, viewer/unrelated teacher, wrong meeting/class, duplicate start/answer, reconnect/resume and backend unavailable. Adapter validates membership and scope on every operation.

First deliverable is the approved request/response/error fixtures and adapter interface, then a mocked browser flow before a separately authorized real test meeting. Do not invent endpoint names, modify the LGU repo, wait for PR #46, introduce a database migration or deploy as part of this phase. Authentication changes require private security collaboration per `CLAUDE.md`; do not open a public security PR.