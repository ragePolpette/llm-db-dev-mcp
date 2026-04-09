param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("dev", "prod")]
    [string]$Mode,
    [switch]$NoPrompt,
    [string]$DeployRoot
)

$ErrorActionPreference = "Stop"

function Resolve-DeployRoot {
    param([string]$InputRoot)

    if ($InputRoot) {
        return (Resolve-Path $InputRoot).Path
    }

    $scriptDir = Split-Path -Parent $PSCommandPath
    return (Resolve-Path (Join-Path $scriptDir "..")).Path
}

function Read-DotEnvFile {
    param([string]$EnvPath)

    $result = @{}
    if (-not (Test-Path $EnvPath)) {
        return $result
    }

    Get-Content -Path $EnvPath | ForEach-Object {
        $line = $_.Trim()
        if ([string]::IsNullOrWhiteSpace($line)) { return }
        if ($line.StartsWith("#")) { return }
        $idx = $line.IndexOf("=")
        if ($idx -lt 1) { return }

        $key = $line.Substring(0, $idx).Trim()
        $value = $line.Substring($idx + 1)
        if ($key) {
            $result[$key] = $value
        }
    }
    return $result
}

function Export-Environment {
    param(
        [hashtable]$Values,
        [string[]]$SkipKeys = @()
    )

    foreach ($entry in $Values.GetEnumerator()) {
        if ($SkipKeys -contains $entry.Key) { continue }
        [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
    }
}

$root = Resolve-DeployRoot -InputRoot $DeployRoot
$projectName = if ($Mode -eq "dev") { "llm-db-dev-mcp" } else { "llm-db-prod-mcp" }
$projectPath = Join-Path $root $projectName
$envPath = Join-Path $projectPath ".env"

if (-not (Test-Path $projectPath)) {
    throw "Project path non trovato: $projectPath"
}

$nodeCmd = Get-Command node -ErrorAction Stop
$envMap = Read-DotEnvFile -EnvPath $envPath

if ($Mode -eq "prod") {
    Export-Environment -Values $envMap -SkipKeys @("DB_PROD_CONNECTION_STRING")
    $conn = if (-not [string]::IsNullOrWhiteSpace([string]$env:DB_PROD_CONNECTION_STRING)) {
        [string]$env:DB_PROD_CONNECTION_STRING
    } else {
        [string]($envMap["DB_PROD_CONNECTION_STRING"])
    }
    $isPlaceholder = [string]::IsNullOrWhiteSpace($conn) -or $conn -match "__SET_ME__|your_password|your_user"

    if (-not $NoPrompt) {
        if ($isPlaceholder) {
            $conn = Read-Host "Inserisci DB_PROD_CONNECTION_STRING"
        } else {
            $inputConn = Read-Host "DB_PROD_CONNECTION_STRING (INVIO per usare .env)"
            if (-not [string]::IsNullOrWhiteSpace($inputConn)) {
                $conn = $inputConn
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($conn) -or $conn -match "__SET_ME__") {
        throw "DB_PROD_CONNECTION_STRING non valorizzata."
    }
    [Environment]::SetEnvironmentVariable("DB_PROD_CONNECTION_STRING", $conn, "Process")
} else {
    Export-Environment -Values $envMap
    $devConn = [string]$env:DB_DEV_CONNECTION_STRING
    if ([string]::IsNullOrWhiteSpace($devConn)) {
        throw "DB_DEV_CONNECTION_STRING non valorizzata nel processo/.env."
    }
}

Set-Location $projectPath
Write-Host ("Avvio {0} ({1}) da {2}" -f $projectName, $Mode.ToUpperInvariant(), $projectPath) -ForegroundColor Cyan
& $nodeCmd.Source "src/server.js"

if ($LASTEXITCODE -ne 0) {
    throw ("Il server {0} si e' chiuso con exit code {1}" -f $projectName, $LASTEXITCODE)
}
