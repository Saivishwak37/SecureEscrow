# Business API security policy (Batch 3)

All paths below are mounted below `/api`. Except for the public authentication routes, every registered business route requires a valid `Authorization: Bearer <JWT>` token. Identity comes from the verified JWT subject and the current active UserRepository record. Controllers must not use caller-supplied actor identifiers as the authenticated identity. Conflicting identity fields in JSON or query parameters are rejected with 403. Resource ownership and participant checks apply even after authentication.

## Route inventory

| Router / method and path | Authentication and role policy | Resource scope |
| --- | --- | --- |
| `GET /health` | Public | Service health only |
| `POST /auth/register` | Public; creates CLIENT or PROVIDER only | New account |
| `POST /auth/login` | Public | Credentials only |
| `GET /auth/me` | Any active authenticated role | Current token subject only |
| `POST /users` | ADMIN | Credential-less CLIENT or PROVIDER profiles only |
| `GET /users` | CLIENT, PROVIDER, ADMIN | CLIENT gets active provider profiles; PROVIDER gets self and clients linked through its escrows; ADMIN gets all |
| `GET /users/:id` | Any authenticated role | Own profile, ADMIN, or participant-linked profile according to controller checks |
| `POST /accounts` | CLIENT, PROVIDER | Account is created for token subject; caller-supplied owner is ignored |
| `GET /accounts/user/:userId` | Any active role; ADMIN may request any user | Self only for CLIENT/PROVIDER |
| `POST /accounts/:accountId/deposit` | CLIENT, PROVIDER | Own personal account only |
| `POST /accounts/:accountId/withdraw` | CLIENT, PROVIDER | Own personal account only |
| `GET /accounts/:accountId` | Any active role; ADMIN | Own personal account; ADMIN can inspect all |
| `GET /accounts/:accountId/ledger` | Any active role; ADMIN | Same account scope |
| `GET /accounts/:accountId/transactions` | Any active role; ADMIN | Same account scope |
| `POST /escrows` | CLIENT | Caller becomes client; selected provider must be an active credential-backed PROVIDER |
| `POST /escrows/:escrowId/milestones` | CLIENT | Client participant of escrow |
| `GET /escrows/:escrowId/milestones` | Authenticated participant | Escrow participant |
| `GET /escrows` | Any active role | CLIENT/provider see own escrows; ADMIN sees all |
| `GET /escrows/:id/actions` | Authenticated participant | Own escrow |
| `GET /escrows/:id/release-eligibility` | Authenticated participant | Own escrow |
| `GET /escrows/:id/conditions` | Authenticated participant | Own escrow |
| `POST /escrows/:id/conditions` | CLIENT | Client participant |
| `POST /escrows/:id/conditions/:type/satisfy` | Authenticated participant; service enforces condition actor role | Own escrow |
| `POST /escrows/:id/release` | CLIENT | Client participant |
| `POST /escrows/:id/disputes` | CLIENT or PROVIDER participant | Own escrow |
| `GET /escrows/:id/disputes` | Authenticated participant | Own escrow |
| `POST /escrows/:id/fund` | CLIENT | Client participant, own escrow funding path |
| `POST /escrows/:id/start` | PROVIDER | Provider participant |
| `GET /escrows/:id/transactions` | Participant or ADMIN | Own escrow; ADMIN read permitted |
| `GET /escrows/:id/ledger` | Participant or ADMIN | Own escrow; ADMIN read permitted |
| `GET /escrows/:id` | Participant or ADMIN | Own escrow; ADMIN read permitted |
| `GET /milestones/:id/actions` | Authenticated participant | Parent escrow participant |
| `POST /milestones/:id/submit` | PROVIDER | Provider participant |
| `POST /milestones/:id/review` | CLIENT | Client participant |
| `POST /milestones/:id/approve` | CLIENT | Client participant |
| `POST /milestones/:id/reject` | CLIENT | Client participant |
| `POST /milestones/:id/release` | CLIENT | Client participant |
| `GET /milestones/:id` | Authenticated participant | Parent escrow participant |
| `POST /conditions/:id/satisfy` | Authenticated participant; service enforces configured actor role | Parent escrow participant |
| `POST /conditions/:id/review` | CLIENT | Client participant |
| `PATCH /conditions/:id` | CLIENT | Client participant |
| `DELETE /conditions/:id` | CLIENT | Client participant |
| `GET /transactions/validation/ledger` | ADMIN | Global ledger validation |
| `GET /transactions/escrow/:escrowId` | Participant or ADMIN | Own escrow; ADMIN read permitted |
| `GET /transactions/:id/ledger` | Transaction participant or ADMIN | Related escrow or personal account |
| `GET /transactions/:id` | Transaction participant or ADMIN | Related escrow or personal account |
| `POST /disputes/:disputeId/resolve` | ADMIN | Admin resolution workflow |
| `GET /disputes/:disputeId` | Dispute participant or ADMIN | Own dispute; ADMIN read permitted |
| `PATCH /disputes/:disputeId/status` | ADMIN | Admin status transitions only |
| `GET /disputes/:disputeId/history` | Dispute participant or ADMIN | Own dispute; ADMIN read permitted |
| `GET /disputes/:disputeId/resolutions` | Dispute participant or ADMIN | Own dispute; ADMIN read permitted |
| `POST /disputes/:disputeId/messages` | CLIENT or PROVIDER participant | Own dispute; ADMIN cannot send as a participant |
| `GET /disputes/:disputeId/messages` | Dispute participant or ADMIN | Own dispute; ADMIN read permitted |
| `POST /disputes/:disputeId/evidence` | CLIENT or PROVIDER participant | Own dispute |
| `GET /disputes/:disputeId/evidence` | Dispute participant or ADMIN | Own dispute; ADMIN read permitted |
| `GET /disputes/:disputeId/evidence/:evidenceId/file` | Dispute participant or ADMIN | Evidence must belong to the requested dispute |

Unknown routes are answered with 404. The root health check is outside `/api` and is the only public non-auth API route.

## Limits

The default backend reads identities and resources from PostgreSQL. ADMIN access is explicit on the listed routes. Upload authorization runs before multipart parsing and is repeated under the escrow lock before saving metadata. Private evidence is served through authenticated routes with type and size requirements. Frontend logout clears the bearer token from memory and session storage. [Database and evidence details](docs/DATABASE_DESIGN.md)
