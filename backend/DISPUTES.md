# Disputes

Participants open a case through the escrow API. It freezes the agreement and records the authenticated actor in escrow and dispute history in one database transaction. Only one unresolved case may exist per escrow. The case scope is the agreement or a selected milestone of that agreement.

Participants can send messages and submit private evidence while a case is active. Admins can read evidence and messages, change the review status, and record a financial decision. Authorized historical reads remain available after settlement. Financial decisions are release to provider, refund to client, exact split, and partial release. Partial payments leave the agreement frozen and retain a scoped balance.

See the [API parity inventory](docs/API_PARITY.md) for routes and authorization, and the [database design](docs/DATABASE_DESIGN.md#dispute-resolution-and-evidence) for retries, locking and evidence storage. In-memory fixtures are used by the legacy Jest regression tests.
