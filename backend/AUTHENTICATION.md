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

Protected requests use `Authorization: Bearer <accessToken>`. `GET /api/auth/me` returns the authenticated user's safe profile. All business routes verify identity and enforce their resource authorization rules. [API parity](docs/API_PARITY.md)

Tokens use HS256 and contain `sub` (user ID), `role`, `iat`, and `exp`. Middleware verifies the signature and expiry, resolves `sub` through `UserRepository`, checks that the account is active, and rejects a role claim that differs from the current repository role. It attaches `{ userId, role, user }` to `req.auth`, where `user` contains only `id`, `username`, `email`, and `role`.

## Limitations

Users and bcrypt hashes persist in PostgreSQL. Public registration creates only CLIENT or PROVIDER users and provisions their wallet atomically. Bearer tokens are stateless. The frontend keeps the access token in tab-scoped session storage so a refresh can verify the session through `/api/auth/me`. Logout or a rejected session clears the token. Until expiry, a token remains valid while its user is active and its role matches the database record. Admin provisioning is deferred. Startup does not create demo credentials.
