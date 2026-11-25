# Business API security policy (Batch 3)

All paths below are mounted below `/api`. Except for the public authentication routes, every registered business route requires a valid `Authorization: Bearer <JWT>` token. Identity comes from the verified JWT subject and the current active UserRepository record. Controllers must not use caller-supplied actor identifiers as the authenticated identity. Conflicting identity fields in JSON or query parameters are rejected with 403. Resource ownership and participant checks apply even after authentication.

## Route inventory

| Router / method and path | Authentication and role policy | Resource scope |
| --- | --- | --- |
| `GET /health` | Public | Service health only |
| `POST /auth/register` | Public; creates CLIENT or PROVIDER only | New account |
| `POST /auth/login` | Public | Credentials only |
| `GET /auth/me` | Any active authenticated role | Current token subject only |
| `POST /ai/generate-milestones` | CLIENT | Suggestions only. Per-user rate limit and no database or financial writes. |
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

## AI milestone drafts

`POST /api/ai/generate-milestones` returns a draft for the existing milestone-based Create Escrow form. A CLIENT must supply a bearer token. The server uses the JWT subject for rate limiting, and the endpoint accepts no provider ID, wallet information or actor override. AI generation is optional. The normal escrow APIs work without Gemini.

### Local setup

Create a key in [Google AI Studio](https://aistudio.google.com/api-keys). Set `GEMINI_API_KEY` in the ignored `backend/.env`, then restart the backend. `GEMINI_MODEL` is optional and defaults to the stable `gemini-3.5-flash-lite` model. The backend uses the official `@google/genai` Node SDK. [Model details](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite) · [Google SDK](https://github.com/googleapis/js-genai)

### Request and response

```json
{
  "title": "Entrance renovation",
  "description": "Retile the entryway and check rainwater drainage.",
  "totalAmount": "50000.00",
  "durationDays": 30
}
```

The description is required and accepts 1–4,000 characters. Title is optional and accepts 1–120 characters. If supplied, it is retained. Duration is optional and accepts an integer from 1 to 3,650 days. The total accepts a decimal string or a JSON number, follows the existing positive amount limit of 50,000,000 and supports up to eight fractional digits. The JSON body is limited to 16 KiB. Other fields are rejected.

The following example omits the optional duration. The budget is emitted using the existing numeric escrow API contract.

```json
{
  "success": true,
  "data": {
    "title": "Entrance renovation",
    "description": "Retile the entryway and verify drainage.",
    "totalAmount": 50000,
    "releaseModel": "MILESTONE_BASED",
    "assumptions": [],
    "milestones": [
      {
        "title": "Tiling and drainage check",
        "description": "Complete tiling.\n\nDeliverables\n- Tiled entryway\n\nAcceptance criteria\n- Water drains without pooling",
        "amount": 50000,
        "order": 1,
        "deliverables": ["Tiled entryway"],
        "acceptanceCriteria": ["Water drains without pooling"]
      }
    ]
  }
}
```

The generator sends the title, work description and optional duration to Gemini as untrusted project data. The budget and identity stay on the server. The SDK receives a structured JSON schema and no tools. The application validates the result independently, including allowed fields, list sizes, text lengths, integer weights, total suggested duration when supplied, and attempts to supply authoritative amounts. Provider requests have a 20-second application deadline, a 4,096-token generation limit and a 32 KiB accepted JSON limit.

The backend validates the input through the existing decimal amount rules, then allocates integer units using relative weights from 1 to 1,000. It uses at least two fractional digits or the input's existing precision and increases precision up to eight places if needed to give every milestone a positive amount. It distributes leftover units in descending remainder order, with ties resolved by milestone order. If a weight still produces zero, it transfers a unit from the largest share. The total remains unchanged.

### Use the assistant in Create Escrow

Sign in as a client and open **Create Escrow**. Choose **Milestone Based**, set the agreement amount and open **Generate with AI**. Describe the work and optionally enter the expected duration in days. The work description, agreement title, amount and duration are processed by an external AI service. Leave out credentials and sensitive information.

Select **Generate Milestones**. Review and edit the existing milestone rows, including their amounts and completion details. Each completion description includes deliverables, acceptance criteria and any duration estimate as editable plain text. The assistant preserves the selected provider and entered budget and fills the agreement title and description only when blank. The allocation summary identifies any unallocated or excess amount. Select **Create Escrow** to save the agreement after its milestone amounts match the budget.

Replacement requires confirmation. Editing the draft or closing the assistant cancels the browser's pending request. A failed request preserves the existing milestones. If the assistant times out, is unavailable, or reaches a rate or quota limit, you can retry when available or finish the agreement manually. Estimates are suggestions and have no effect on release dates or funding.

For a live check, configure the server key as described above, restart the backend and follow the workflow with a synthetic project and test accounts in an isolated database. Verify that generation alone creates no escrow. Save an edited milestone and reopen the agreement to verify its amount and completion details. The **Condition Based** workflow has no AI assistant.

### Errors

| HTTP | Meaning |
| --- | --- |
| 400 | Invalid project input, unsupported monetary precision, or too little budget for all suggested milestones |
| 401 / 403 | Authentication required or caller cannot generate a draft |
| 413 | JSON body exceeds the endpoint limit |
| 429 `AI_RATE_LIMIT` | Five attempts in 60 seconds per client on this process. Use `Retry-After`. |
| 502 `AI_INVALID_OUTPUT` / `AI_PROVIDER_ERROR` | Invalid draft or failed provider request |
| 503 `AI_UNAVAILABLE` / `AI_QUOTA_EXCEEDED` | Missing or invalid configuration, unavailable model, or provider quota exhausted |
| 504 `AI_TIMEOUT` | Generation exceeded its deadline |

Requests and drafts are returned without application storage of project prompts or raw responses. Provider errors are sanitized before returning them. The rate limiter is process-local and resets with the server.

### Verification

From `backend`, run `npm.cmd test -- --runInBand` and `npm.cmd run db:test:core`. The core suite uses PostgreSQL with a mocked provider and checks that the draft leaves records unchanged until explicit escrow creation.

For one live check, configure the Gemini key, start the local backend, and use an existing CLIENT account. Run the following in PowerShell. The credential prompt takes the client's email and password.

```powershell
$client = Get-Credential -Message 'Enter your SecureEscrow client email and password'
$loginBody = @{ email = $client.UserName; password = $client.GetNetworkCredential().Password } | ConvertTo-Json
try {
    $session = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/auth/login' -ContentType 'application/json' -Body $loginBody
    $draft = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/ai/generate-milestones' `
        -Headers @{ Authorization = "Bearer $($session.data.accessToken)" } -ContentType 'application/json' `
        -Body (@{ description = 'Retile the entryway and check rainwater drainage.'; totalAmount = '50000.00'; durationDays = 30 } | ConvertTo-Json)
    $draft.data | ConvertTo-Json -Depth 8
    $draft.data.milestones | Measure-Object -Property amount -Sum
} finally {
    Remove-Variable client, loginBody, session -ErrorAction SilentlyContinue
}
```

## Limits

The default backend reads identities and resources from PostgreSQL. ADMIN access is explicit on the listed routes. Upload authorization runs before multipart parsing and is repeated under the escrow lock before saving metadata. Private evidence is served through authenticated routes with type and size requirements. Frontend logout clears the bearer token from memory and session storage. [Database and evidence details](docs/DATABASE_DESIGN.md)
