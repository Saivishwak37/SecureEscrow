# Backend authentication foundation

## Configuration

Set `JWT_SECRET` before using login or authenticated routes. It must contain at least 32 bytes and should be generated from cryptographically random bytes. For example:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Keep the generated value in the deployment environment or an untracked local `.env` file. The server does not provide a fallback secret. `JWT_EXPIRES_IN` accepts a positive duration such as `15m`, `1h`, or `1d`; it defaults to `15m` and is capped at 30 days.

## Login and current user

`POST /api/auth/login` accepts `{ "email": "person@example.com", "password": "..." }`. A successful response is:

```json
{
  "success": true,
  "data": {
    "accessToken": "<signed-jwt>",
    "user": {
      "id": "<user-id>",
      "username": "person",
      "email": "person@example.com",
      "role": "CLIENT"
    }
  }
}
```

Protected requests use `Authorization: Bearer <accessToken>`. `GET /api/auth/me` returns the authenticated user's safe profile. In this batch, `/me` is the only business-facing route protected by authentication; escrow, transaction, and dispute routes remain unchanged.

Tokens use HS256 and contain `sub` (user ID), `role`, `iat`, and `exp`. Middleware verifies the signature and expiry, resolves `sub` through `UserRepository`, checks that the account is active, and rejects a role claim that differs from the current repository role. It attaches `{ userId, role, user }` to `req.auth`, where `user` contains only `id`, `username`, `email`, and `role`.

## Limitations

Users are held in memory and do not survive a server restart. Bearer tokens are stateless: this implementation has no refresh tokens, server-side logout, or revocation list. Tokens remain valid until expiry unless the user's account is deactivated, deleted, or its role changes; middleware checks the current user record on each authenticated request. Existing demo users use a separate legacy credential path and are not eligible for email-based JWT login until migrated to credential-backed User records.
