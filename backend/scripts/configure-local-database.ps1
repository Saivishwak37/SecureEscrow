$ErrorActionPreference = 'Stop'
$envPath = Join-Path $PSScriptRoot '../.env'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if (!(Test-Path -LiteralPath $psql)) {
    throw "PostgreSQL 18 psql was not found at $psql. Use the manual URL setup in DATABASE_SETUP.md."
}

function Test-DatabaseCredential($credential) {
    $previousPassword = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
    try {
        $env:PGPASSWORD = $credential.GetNetworkCredential().Password
        $ErrorActionPreference = 'Continue'
        & $psql -X -w -h 127.0.0.1 -p 5432 -U $credential.UserName -d $credential.UserName -Atc 'SELECT 1' 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally {
        [Environment]::SetEnvironmentVariable('PGPASSWORD', $previousPassword, 'Process')
    }
}

$databaseSettings = [ordered]@{
    DATABASE_URL = 'secureescrow_dev'
    TEST_DATABASE_URL = 'secureescrow_test'
}

$lines = @()
if (Test-Path -LiteralPath $envPath) {
    $lines = @(Get-Content -LiteralPath $envPath -Encoding UTF8 |
        Where-Object { $_ -notmatch '^\s*(?:export\s+)?(?:DATABASE_URL|TEST_DATABASE_URL)\s*=' })
}

foreach ($key in $databaseSettings.Keys) {
    $database = $databaseSettings[$key]
    $credential = Get-Credential -UserName $database -Message "Enter the PostgreSQL password for $database"
    if (!$credential -or !$credential.Password.Length -or $credential.UserName -cne $database) {
        throw "Expected credentials for $database. The environment file was not written."
    }
    if (!(Test-DatabaseCredential $credential)) {
        throw "Could not authenticate to $database as $database. Verify the password at a local psql prompt. The environment file was not written."
    }
    $encoded = [Uri]::EscapeDataString($credential.GetNetworkCredential().Password)
    $lines += '{0}=postgresql://{1}:{2}@127.0.0.1:5432/{1}?schema=public' -f $key, $database, $encoded
}

[IO.File]::WriteAllLines($envPath, [string[]]$lines, [Text.UTF8Encoding]::new($false))
Write-Host 'Saved DATABASE_URL and TEST_DATABASE_URL in backend/.env.'
