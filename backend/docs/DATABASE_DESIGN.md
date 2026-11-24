# SecureEscrow PostgreSQL design

Phase 1 adds a Prisma schema, a lazy CommonJS client, and versioned PostgreSQL migrations. Express still starts with the in-memory store. There is no database seed or importer in this phase. The design reconciles [SecureEscrow_ER.pdf](../../SecureEscrow_ER.pdf) with the active code at checkpoint `1c1b239` on `feature/postgresql-migration`, descended from `8ff6320`. The referenced presentation was unavailable in the supplied files.

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
| Milestone transitions | `milestone_status_history` is available for future writes. The current milestone service updates status without storing a separate history. |

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
- Use `Prisma.Decimal` or exact decimal strings internally. Perform arithmetic and equality checks without binary floating-point. Current APIs emit numeric amounts. At cutover, preserve that contract within a documented range and validate decimal round trips at the applicable scale. Values outside that range require an explicit API contract decision to expose exact decimal strings. Convert only at serialization.
- The source of truth is the ledger. Compute account balance as credits minus debits. Derive milestone availability from completed scoped funding minus completed scoped outflows. The ledger balance column is a historical snapshot generated during posting. The account table has no mutable balance. Opening balances at cutover need balanced entries against clearing. Clearing can serve as an offset for simulated money.
- Every completed transfer requires exactly one debit of its amount from its source and one matching credit to its destination. Composite account and transaction FKs enforce currency agreement. Deferred PostgreSQL triggers validate the final posting at commit, disallow entries for pending/failed transfers, and support inserting both entries in one transaction. Triggers reject updates/deletes of completed transfers and updates/deletes/truncation of ledger entries. Corrections use a compensating transfer.
- Partial unique indexes prevent duplicate completed normal funding/release/refund per scope and duplicate final dispute execution while allowing intermediate partial releases. Resolution keys are unique per dispute. On replay, compare the actor and request fingerprint before returning the original result. Repeatable wallet operations need client-provided or upstream-generated operation keys to distinguish retries from new operations.

## Relationships and transaction boundaries

Prisma defines primary keys, compound unique and foreign keys, and restricted delete/update actions. Composite keys guard milestone-to-escrow scope, currencies and resolution history scope. Parent/time indexes support ordered history, escrow and wallet queries. PostgreSQL-specific checks, case-folded username/email indexes, account ownership checks, active-dispute uniqueness and posting triggers are in the integrity migration. Financial and audit records use restrictive FKs.

At repository cutover, use an interactive database transaction with stable locking order or serializable isolation and retry. Lock the parent escrow/dispute as applicable and affected account rows before reading balances, testing eligibility or assigning a milestone order. Recompute available funds under the lock. The service transaction must enforce sufficient funds, account status/types and expected owner, milestone allocations and funding ceilings, release model and conditions, scope and amounts of resolution payouts, allocation totals, snapshot correctness, authorization and allowed lifecycle transitions. When resolving a dispute, derive its escrow and milestone from the dispute and reject transfers with a different scope. Keep transfer and allocation type/amount in agreement. Treat all co-dependent writes as one commit:

- User registration and wallet creation.
- Escrow creation and its account, participants, milestones or conditions.
- Wallet deposit/withdrawal and both ledger entries.
- Funding, release or refund with state changes, balance snapshots and status history.
- Dispute opening and escrow freeze, review updates and history, or resolution with all transfers, allocations, audit and final status changes. Record failed attempts separately after rollback if needed.

## Suggested repository migration order

1. Add integration fixtures and API adapters, then migrate users and registration with wallet provisioning.
2. Migrate escrow ownership, milestones, submissions, conditions and history.
3. Migrate account reads, posting and monetary operations together. Reconcile opening balances and map pooled escrow activity to agreement accounts.
4. Migrate disputes, messages and private evidence metadata, then resolution and history on top of transactional posting.
5. Verify role/resource rules, ledger totals, retry/concurrency behavior and response compatibility before switching the application to PostgreSQL.
