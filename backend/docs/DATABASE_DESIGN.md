# SecureEscrow PostgreSQL design

PostgreSQL is the default persistence for authentication, agreements, simulated financial workflows, disputes and audit. The design follows the current application, with [SecureEscrow_ER.pdf](../../SecureEscrow_ER.pdf) as historical context.

## PostgreSQL runtime boundary

`npm start` and `npm run dev` start PostgreSQL-backed SecureEscrow on loopback port 3000 by default. Startup requires a database connection and leaves existing data intact. The in-memory app remains isolated for Jest. [Endpoint parity](API_PARITY.md)

The PostgreSQL server handles wallet deposits and withdrawals, account and escrow history, transaction details, ledger history and admin reconciliation. It handles whole-agreement funding and release for condition-based escrows and individually funded and released milestones. It persists milestone start, submission, review, revision requests and approvals, and condition verification, review and eligibility.

Dispute creation, evidence metadata, messaging, history and administrative resolution are persistent. Dispute creation atomically locks and freezes the escrow, writes the case, and records both histories. Financial and lifecycle operations check stored freeze state under that same lock. Administrative refunds exist through dispute resolution. The existing API has no ordinary refund route.

The PostgreSQL listener exposes no ADMIN provisioning route or startup seed. Live test runners use the dedicated test role and database. The financial and dispute tests remove their disposable schemas.

Registration creates the user and personal INR wallet through a single nested write. Existing database uniqueness constraints handle races, and expected unique violations become HTTP 409. An escrow transaction rechecks and locks both participant rows and writes the agreement, its holding account, the applicable milestones or conditions, and initial status history together. Draft edits lock the same parent agreement row that the financial and lifecycle writers lock.

## Phase 3 posting contract

- Monetary API fields remain JSON numbers. The server validates the original JSON number text, requires a positive finite amount up to 50,000,000, and allows up to eight fractional places for escrow amounts and two for wallet transfers. Account balance snapshots, including simulated clearing, are bounded to ±50,000,000. This keeps eight-place amounts within the numeric API's resolution. Decimal calculations and signed SQL `NUMERIC` sums determine amounts and balances. Decimal strings carry exact values into PostgreSQL. Responses verify the decimal round trip before emitting a number. Legacy amounts outside the representable API precision fail explicitly.
- A wallet begins at zero. The first simulated wallet operation creates the per-currency clearing account if needed. A deposit debits clearing and credits the wallet. A withdrawal reverses that direction. Clearing is a simulated offset and may go below zero. Personal and holding sources require sufficient ledger-derived funds. The admin audit also reports the aggregate INR balance across escrow holding accounts.
- Every posting uses one Prisma transaction. The service locks the actor for authorization, locks the parent escrow when applicable, then locks both accounts in ID order before deriving balances. It writes one completed transfer and one debit and credit pair. It also writes any milestone or escrow state changes and audit history before committing. Posting timestamps are assigned under the account locks and advance monotonically for each affected account. PostgreSQL deferred triggers verify the pair at commit. Deadlocks or serialization failures are retried up to twice.
- Wallet requests require an `Idempotency-Key` header with 1–128 visible ASCII characters. Keys are scoped by authenticated actor and operation type. A transaction-scoped advisory lock serializes equal keys, and the database unique index protects the persisted key. An exact replay returns the original posting and balance snapshot. Changing the wallet or amount for the same key returns HTTP 409. Use a fresh key for each new intent. The frontend retains the key for a same-intent retry following an ambiguous failure within the current session.
- Normal funding and release are one-time operations per escrow or milestone. The locked workflow verifies the funding scope and completed postings, and the existing partial unique indexes provide a second line of protection. A duplicate request is rejected. Milestone releases require approval, a matching funded scope and sufficient holding balance. Condition releases require adequate funded balance and every required condition to be satisfied.

The migrations enforce append-only ledger entries, immutable completed transfers and deferrable posting constraints. Migration `20261125000000_resolution_scope` checks existing records, then enforces that a resolution transfer matches the dispute's escrow and nullable milestone. The dispute scope and the resolution's binding to its dispute are immutable.

## Dispute resolution and evidence

- An admin can release the remaining scope to the provider, refund the client, split the full remainder, or partially release to the provider. Available funds are completed funding minus prior scoped releases and refunds, bounded by the holding balance. A partial payout leaves the escrow frozen. Final settlement closes the case and records the affected milestones and escrow status. Other milestones in a milestone-scoped dispute remain usable.
- Resolution locks the parent escrow and all affected accounts in deterministic order. Transfers, balanced entries, matching allocations, status changes, and actor-tagged history commit in one transaction. The database permits only one active dispute per escrow and one final resolution per dispute. A failed attempt rolls back all financial changes, with a separate best-effort failure audit.
- Resolution keys are unique per dispute and tied to the acting admin and normalized request. An identical retry returns the original result. Conflicting intent returns 409. A different admin cannot replay the key. The frontend reuses the key after ambiguous failures.
- Upload authorization runs before multipart parsing and is rechecked under the escrow lock. Generated filenames and private storage keep evidence outside public routes. Metadata includes display filename, validated MIME type and size, and SHA-256 hash. Failed metadata writes remove files when safe. A crash or an ambiguous database failure can leave an orphan file. Back up the local evidence directory with the database and reconcile orphan files administratively.
- Authorized participants and admins can read evidence and history after settlement. Only participants write evidence and messages, and only while a case is active. The API exposes no history rewrite, admin provisioning, or effect-free close for a case without funds.

## Runtime inventory and relational mapping

| In-memory record | PostgreSQL table and design |
| --- | --- |
| `users` | `user` uses a single global role (`CLIENT`, `PROVIDER`, `ADMIN`) and active flag. Credential records have username, normalized email and bcrypt hash. Name-only legacy records have nullable credential fields. Names may be omitted for registered users. |
| `escrows` | `escrow` stores title, description, terms, agreement type, JSON metadata, amount, currency, lifecycle status and release model/policy. Canonical `client_id` and `provider_id` replace redundant payer/payee aliases. The dispute flag is derived from status, with `status_before_dispute` retained for recovery. |
| Embedded `participants` | `escrow_participant` stores additional named roles used by configurable condition authorization. Payer/client and payee/provider roles are derived from the escrow FKs. Preserve configured role names when mapping custom roles. |
| `accounts` | `account` identifies personal wallets by owner and currency, one clearing account per currency, and one escrow account per agreement. The runtime uses a single pooled INR escrow account and seeds opening balances directly. The new schema derives balances and segregates agreements. |
| `milestones` | `milestone` belongs to an escrow and carries title, description, order, amount, lifecycle status and current review feedback. |
| Embedded `submissions` | `milestone_submission` stores one row per submission with its author, timestamp, optional review fields and a JSON array of existing `{ name, type, data }` attachments. |
| `conditions` | `escrow_condition` belongs directly to an escrow. It includes type, title, description, required flag, JSON config and verification details, submission and satisfaction actor/timestamps. Automated deadline satisfaction is represented by a boolean and mapped to the existing `SYSTEM` sentinel at the API. Types may repeat within an agreement. |
| `transactions` | `transaction` stores the transfer, source and destination accounts, currency, status, optional escrow/milestone/resolution and an optional global idempotency key and request fingerprint. Wallet deposits and withdrawals have no escrow scope. |
| `ledgerEntries` | `ledger_entry` stores debit or credit, transaction, account, amount, currency and the post-entry balance snapshot. |
| `disputes` | `dispute` stores the escrow, optional milestone of that escrow, initiating user, title, category, reason, requested outcome and lifecycle timestamps. |
| `disputeEvidence` | `dispute_evidence` stores uploader, detected format/MIME, sanitized display filename, unique private storage key, byte count, SHA-256 and description. Bytes remain in private file storage. Authenticated download uses the dispute and evidence IDs. |
| `disputeMessages` | `dispute_message` stores sender, text and timestamp. Sender summaries are assembled from the user relation. |
| `disputeResolutions` | `dispute_resolution` stores admin, decision, reasoning, execution status, remaining amount, key and request fingerprint. Scope is inherited from the dispute. Transfers reference the resolution so a split or sequential partial payout is representable. |
| `disputeResolutionAllocations` | `dispute_resolution_allocation` ties one transfer to one allocation and verifies its destination, resolution, currency, type and exact amount through a composite FK. A follow-up migration extends the original FK so conflicting allocation and transfer values cannot both persist. |
| `escrowStatusHistory` | `escrow_status_history` records actor, previous and next status, reason and time. |
| `disputeStatusHistory` | `dispute_status_history` records status transitions and execution outcomes, optionally linking a resolution of the same dispute. |
| Milestone transitions | `milestone_status_history` stores workflow and dispute resolution changes with actors and reasons. |

Escrow and milestone enums follow the shared lifecycle state machine. Conditions progress through `PENDING`, `SUBMITTED`, `REJECTED` and `SATISFIED`. Disputes use `OPEN`, `EVIDENCE_SUBMISSION`, `UNDER_REVIEW` and `RESOLVED`. Transaction statuses are `PENDING`, `COMPLETED` and `FAILED`. The [Prisma schema](../prisma/schema.prisma) and [DBML diagram](SecureEscrow_ER.dbml) list every enum and field.

Runtime IDs are UUID strings and fixed demo IDs such as `user-1` and `account-clearing`. PostgreSQL uses text PKs with Prisma-generated UUID defaults for new records. SQL importers must supply IDs explicitly. Runtime timestamps are generally epoch milliseconds. PostgreSQL uses `timestamptz(3)` and Prisma Date values. Convert to the original timestamp shape at the API boundary. The separate legacy `seed.js` fixture uses old buyer/seller names, prefixed IDs and older store interfaces. The active store initializes demo users and four accounts itself.

Controllers and services remain the authority for state transitions, current actor and resource scope. JWT subjects identify active users and role checks use the current stored role. Preserve public user projections and existing response envelopes, participant aliases, milestone submissions, transfer arrays for split resolutions and per-record timestamp formats in later adapters. Keep password hashes and evidence storage keys private, and keep request fingerprints out of response projections that already omit them. Private evidence upload and metadata commits span filesystem and database boundaries. The later adapter needs cleanup on failed writes and an orphan reconciliation strategy for interrupted operations.

## Changes from the original ER diagram

- Retained the core user, account, escrow, participant, milestone, submission, transaction, ledger, dispute, resolution, allocation and status-history entities.
- Replaced `MILESTONE_CONDITION` with `ESCROW_CONDITION`, matching agreement-wide eligibility. Added submission, satisfaction and verification fields. A deadline is condition configuration. Agreement-wide expiry, milestone due dates and auto-release flags from the diagram have no active storage or automatic release worker.
- Added username/global role and agreement terms, metadata, type, release model and policy. The current flow makes the client the creator, so there is no second creator FK. Milestone submissions retain ordered inline attachment data and may store review metadata when the repository moves.
- Changed the resolution-to-transaction link from one transfer ID to multiple transfers with allocation links. Added private evidence metadata, structured dispute inputs, idempotency and execution audit events.
- Deferred `PAYMENT`, `PAYMENT_PROVIDER` and the payment FK. Clearing-account transfers support simulated deposits and withdrawals.

## Money and posting

- All monetary values use `NUMERIC(30,8)`, allowing 22 integer and eight fractional digits. Eight fractional digits match existing dispute reconciliation. The wallet still accepts two fractional digits. Validate finite inputs and precision before casting because PostgreSQL rounds to the declared scale. INR is the default; currency codes are uppercase three-letter values, with no currency conversion or currency registry in this phase.
- Use `Prisma.Decimal` or exact decimal strings internally. The PostgreSQL API emits numeric amounts within the Phase 3 posting contract and validates decimal round trips at serialization.
- The source of truth is the ledger. Compute account balance as credits minus debits. Derive milestone availability from completed scoped funding minus completed scoped outflows. The ledger balance column is a historical snapshot generated during posting. The account table has no mutable balance. Opening balances at cutover need balanced entries against clearing. Clearing can serve as an offset for simulated money.
- Every completed transfer requires exactly one debit of its amount from its source and one matching credit to its destination. Composite account and transaction FKs enforce currency agreement. Deferred PostgreSQL triggers validate the final posting at commit, disallow entries for pending/failed transfers, and support inserting both entries in one transaction. Triggers reject updates/deletes of completed transfers and updates/deletes/truncation of ledger entries. Corrections use a compensating transfer.
- Partial unique indexes prevent duplicate completed normal funding/release/refund per scope and duplicate final dispute execution while allowing intermediate partial releases. Resolution keys are unique per dispute. On replay, compare the actor and request fingerprint before returning the original result. Repeatable wallet operations need client-provided or upstream-generated operation keys to distinguish retries from new operations.

## Relationships and transaction boundaries

Prisma defines primary keys, compound unique and foreign keys, and restricted delete/update actions. Composite keys guard milestone-to-escrow scope, currencies and resolution history scope. Parent/time indexes support ordered history, escrow and wallet queries. PostgreSQL-specific checks, case-folded username/email indexes, account ownership checks, active-dispute uniqueness and posting triggers are in the integrity migration. Financial and audit records use restrictive FKs.

Financial and lifecycle writers use the locking protocol above. Resolution derives scope from the locked dispute and escrow, verifies recipients and funds, and keeps each allocation consistent with its transfer. These operations require a single commit:

- User registration and wallet creation.
- Escrow creation and its account, participants, milestones or conditions.
- Wallet deposit/withdrawal and both ledger entries.
- Funding, release or refund with state changes, balance snapshots and status history.
- Dispute opening and escrow freeze, review updates and history, or resolution with all transfers, allocations, audit and final status changes. Record failed attempts separately after rollback if needed.

## Cutover data

Existing PostgreSQL records remain in place. Previous in-memory sessions and their fixture balances are not imported. A legacy private file with no PostgreSQL evidence record is not served by the new runtime.
