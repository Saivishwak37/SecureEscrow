# PostgreSQL API parity

Paths below are relative to `/api` except for `/health`. C and P denote CLIENT and PROVIDER. A denotes ADMIN. Protected routes require an active credential-backed user, a valid bearer JWT, and a token role that matches the current database role. The API rejects conflicting actor fields. The legacy app remains a Jest fixture.

| Method and route | Legacy behavior | PostgreSQL behavior and authorization | Verification |
| --- | --- | --- | --- |
| GET `/health` | Process health | Public, reports PostgreSQL mode after startup connects | Startup smoke |
| POST `/auth/register` | C/P registration and wallet creation | Public, atomic user and zero-balance wallet, database uniqueness | Core |
| POST `/auth/login` | Email and bcrypt verification | Public, persisted identity and same JWT contract | Core |
| GET `/auth/me` | Current authenticated profile | Protected, current user only | Core |
| GET `/users` | Role-filtered list | A sees all, C sees eligible providers, P sees self and clients linked by agreements | Existing user visibility policy, core authorization |
| GET `/users/:id` | Self, admin, provider directory and linked-client reads | Same ownership filters, active provider directory | Core authorization |
| POST `/users` | A creates a non-login legacy profile | A may create credential-less C/P profiles. ADMIN creation is excluded. | Disputes |
| POST `/accounts` | Create wallet for caller | C/P, own INR wallet, duplicate returns 409 | Core |
| GET `/accounts/user/:userId`, GET `/accounts/:accountId` | Read balance and account | Owner or A, ledger-derived balance | Core, finance |
| POST `/accounts/:accountId/deposit`, POST `/accounts/:accountId/withdraw` | Simulated wallet transfers | C/P account owner, atomic posting, required retry key | Finance |
| GET `/accounts/:accountId/ledger`, GET `/accounts/:accountId/transactions` | Wallet history | Owner or A, database-backed histories | Finance |
| POST `/escrows` | Create agreement for authenticated client | C, active provider validation, atomic creation | Core |
| GET `/escrows`, GET `/escrows/:id` | List scoped agreements and read details | Own client/provider agreements, A permitted reads | Core |
| GET `/escrows/:id/actions` | List workflow actions | Participants, implemented actions only, respects freezes | Finance workflow |
| POST `/escrows/:id/fund` | Fund agreement or milestone | Owning C, persisted balance, scope and state checks | Finance |
| POST `/escrows/:id/start` | Start work | Assigned P, matching funded milestone | Finance |
| POST `/escrows/:id/release` | Release condition agreement | Owning C, scoped funds and satisfied required conditions | Finance, disputes |
| GET `/escrows/:id/release-eligibility`, GET `/escrows/:id/conditions` | Eligibility and condition definitions | Participants, persisted deadline evaluation and current scope | Core, finance |
| POST `/escrows/:id/conditions` | Create draft condition | Owning C, draft condition agreements only | Core |
| POST `/escrows/:id/conditions/:type/satisfy` | Satisfy a condition selected by unique type | Configured participant, valid type, funded and unfrozen agreement | Shared condition checks, finance |
| GET `/escrows/:id/milestones` | Ordered milestones | Participants | Core, finance |
| POST `/escrows/:id/milestones` | Append a milestone | Owning C, valid draft allocation | Core |
| GET `/escrows/:id/transactions`, GET `/escrows/:id/ledger` | Scoped escrow transaction and ledger history | Participants or A | Finance, disputes |
| POST `/escrows/:id/disputes` | Open and freeze | Participant, active-case uniqueness, atomic freeze and audit | Disputes |
| GET `/escrows/:id/disputes` | Escrow dispute listing | Participants or A, optional `status` filter | Disputes |
| GET `/milestones/:id`, GET `/milestones/:id/actions` | Milestone detail and actions | Participants; persisted submissions and state restrictions | Core, finance |
| POST `/milestones/:id/submit` | Submit work and files | Assigned P, funded milestone, shared attachment validation | Finance |
| POST `/milestones/:id/review`, POST `/milestones/:id/approve`, POST `/milestones/:id/reject` | Review, approve, or request revisions | Owning C, state machine and persisted review/feedback | Finance |
| POST `/milestones/:id/release` | Release approved milestone | Owning C, scope and sufficient funds, one-time posting | Finance |
| POST `/conditions/:id/satisfy` | Confirm condition or submit evidence | Configured participant; funding and freeze checks | Finance |
| POST `/conditions/:id/review` | Approve or reject submitted work | Owning C, submitted condition only | Finance |
| PATCH `/conditions/:id`, DELETE `/conditions/:id` | Edit draft conditions | Owning C, retains at least one definition | Core |
| GET `/transactions/escrow/:id` | Scoped transfers | Participants or A | Finance |
| GET `/transactions/:id`, GET `/transactions/:id/ledger` | Transfer details and entries | Escrow participant or relevant wallet owner, or A | Finance |
| GET `/transactions/validation/ledger` | Global ledger audit | A only, reconciliation and total held in INR | Finance, disputes |
| GET `/disputes/:id` | Detail read via escrow list | New direct read of existing resource, participants or A | Disputes |
| PATCH `/disputes/:id/status` | Admin transitions | A only, checked transition and atomic history | Disputes |
| POST `/disputes/:id/resolve` | Admin allocations | A only, locked, exact and atomic, persistent retry and audit | Disputes |
| GET `/disputes/:id/history`, GET `/disputes/:id/resolutions` | Case and payout history | Participants or A, retained after resolution | Disputes |
| GET `/disputes/:id/messages` | Read chat history | Participants or A | Disputes |
| POST `/disputes/:id/messages` | Participant chat while active | Participants only, persisted authenticated sender | Disputes |
| GET `/disputes/:id/evidence`, GET `/disputes/:id/evidence/:evidenceId/file` | Metadata and authenticated download | Participants or A, verifies evidence belongs to case | Disputes |
| POST `/disputes/:id/evidence` | Participant evidence upload | Participants only; authorization before multipart parsing and live state recheck on metadata insert | Disputes |

Core, finance and disputes refer to the live PostgreSQL HTTP suites. The existing Jest suites exercise the shared rules and legacy adapter. A profile created by `POST /users` cannot authenticate or receive escrow funding as an active credential-backed provider. Public registration has no ADMIN option. The app has no ordinary refund endpoint. Refund postings are available through administrative dispute resolution.
