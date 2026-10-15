$ErrorActionPreference = 'Stop'

$envPath = Join-Path $PSScriptRoot '.env'
$examplePath = Join-Path $PSScriptRoot '.env.example'

if (Test-Path $envPath) {
    throw 'Existing .env preserved. Edit it locally if configuration changes are needed.'
}

if (-not (Test-Path $examplePath)) {
    throw 'Missing .env.example.'
}

$text = [System.IO.File]::ReadAllText($examplePath)
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()

try {
    $keys = @('POSTGRES_ADMIN_PASSWORD') + @(
        'AUTH', 'USER', 'JOB', 'APPLICATION', 'CONTRACT',
        'PAYMENT', 'OPERATIONS', 'CHAT', 'NOTIFICATION', 'ML'
    ).ForEach({ "${_}_DB_PASSWORD" })

    foreach ($key in $keys) {
        $pattern = "(?m)^${key}=[^\r\n]*"

        if (-not [regex]::IsMatch($text, $pattern)) {
            throw "Missing configuration key: $key"
        }

        $bytes = New-Object byte[] 32
        $rng.GetBytes($bytes)
        $value = -join ($bytes | ForEach-Object { $_.ToString('x2') })

        $text = [regex]::Replace($text, $pattern, "${key}=${value}")
    }

    [System.IO.File]::WriteAllText(
        $envPath,
        $text.Replace("`r`n", "`n").TrimEnd() + "`n",
        [System.Text.UTF8Encoding]::new($false)
    )
} finally {
    $rng.Dispose()
    Remove-Variable text, value, bytes -ErrorAction SilentlyContinue
}

Write-Output 'Local .env created. Passwords were not printed.'
