# PostgreSQL setup on Windows

Prisma CLI and Client are pinned to 6.19.3. This release was validated and generated with Node.js 24.14.1 and npm 11.11.0. The v6 `prisma-client-js` generator works with the existing JavaScript CommonJS modules. [Prisma v6 data modeling documentation](https://www.prisma.io/docs/orm/v6/overview/introduction/data-modeling)

## Install PostgreSQL and create local databases

Use the [official PostgreSQL Windows download page](https://www.postgresql.org/download/windows/) to download the PostgreSQL installer. Run it interactively and select the server and command-line tools. Use port 5432 or substitute the selected port in the commands and URLs below. Keep the cluster administrator password local. For the default installer layout, select your PostgreSQL installation's `bin` directory and verify connectivity from PowerShell.

```powershell
Get-Service 'postgresql*'
$pgInstall = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'bin\psql.exe') } |
    Sort-Object Name -Descending | Select-Object -First 1
$psql = Join-Path $pgInstall.FullName 'bin\psql.exe'
& $psql --version
& $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -W
```

At the `psql` prompt, check `\du` and `\l` first and create these names only on the intended development cluster. If a name already exists, inspect its owner, privileges and migration history before reusing it. Use distinct passwords at the prompts.

```sql
CREATE ROLE secureescrow_dev LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password secureescrow_dev
CREATE ROLE secureescrow_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password secureescrow_test
CREATE DATABASE secureescrow_dev OWNER secureescrow_dev;
CREATE DATABASE secureescrow_test OWNER secureescrow_test;
REVOKE CONNECT ON DATABASE secureescrow_dev FROM PUBLIC;
REVOKE CONNECT ON DATABASE secureescrow_test FROM PUBLIC;
\q
```

## Configure and apply the migrations

From the repository root in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\backend\scripts\configure-local-database.ps1
Set-Location backend
npm.cmd ci
npm.cmd run db:validate
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:status
```

The local prompts verify both logins with PostgreSQL 18 before saving the URLs to the ignored `backend/.env`. The script URI-encodes the passwords and preserves other application settings. If PostgreSQL is installed in a different directory, supply these entries manually and URI-encode the passwords. If the current PowerShell session already exports `DATABASE_URL` or `TEST_DATABASE_URL`, those values take precedence over the file. Confirm the target first.

```dotenv
DATABASE_URL=postgresql://secureescrow_dev:replace_me@127.0.0.1:5432/secureescrow_dev?schema=public
TEST_DATABASE_URL=postgresql://secureescrow_test:replace_me@127.0.0.1:5432/secureescrow_test?schema=public
```

`db:migrate` applies the migration files using `prisma migrate deploy` and needs no shadow database. For future migration authoring use `npx.cmd --no-install prisma migrate dev --name describe_change` against an identified development database. That command needs a separate shadow database or a local authoring role allowed to create one.

Verify the tables, constraints and non-internal triggers using the development role. Each command prompts for its password.

```powershell
& $psql -h 127.0.0.1 -U secureescrow_dev -d secureescrow_dev -W -c '\dt'
& $psql -h 127.0.0.1 -U secureescrow_dev -d secureescrow_dev -W -c '\d+ ledger_entry'
& $psql -h 127.0.0.1 -U secureescrow_dev -d secureescrow_dev -W -c '\d+ transaction'
& $psql -h 127.0.0.1 -U secureescrow_dev -d secureescrow_dev -W -c "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname"
```

## Prepare the isolated test database

```powershell
npm.cmd run db:test:migrate
npm.cmd run db:test:status
npm.cmd run db:test:integrity
```

These commands require `TEST_DATABASE_URL` pointing to the local `secureescrow_test` database in the public schema. The Prisma client uses the same guard under `NODE_ENV=test`. The integrity suite verifies the connected database and role before writes, forces deferred constraints to run, and rolls back its fixtures. Existing Jest tests use memory and can run without either database.

## Run the PostgreSQL server

From `backend`, with a migrated development database and the usual local JWT settings:

```powershell
npm.cmd start
```

It listens on `127.0.0.1:3000` by default, which matches the frontend. `npm.cmd run dev` uses the same database runtime. `POSTGRES_PORT` takes precedence over `PORT` when set. If using another port, set `VITE_API_BASE_URL` before launching Vite from `frontend` with `npm.cmd run dev`. Keep `DISPUTE_EVIDENCE_STORAGE_DIR` private and persistent across restarts. [Database design](DATABASE_DESIGN.md) · [API parity](API_PARITY.md)

Run the live HTTP integration suite with:

```powershell
npm.cmd run db:test:core
npm.cmd run db:test:finance
npm.cmd run db:test:disputes
```

The suites check the target database and role before creating fixtures and use separate backend processes to verify restart persistence. Financial and dispute tests use generated schemas within the test database. The dispute suite also uses an isolated private evidence directory.
