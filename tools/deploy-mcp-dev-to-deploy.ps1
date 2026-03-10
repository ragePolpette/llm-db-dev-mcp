param(
    [string[]]$Services = @("llm-context", "llm-memory", "llm-db-dev-mcp", "llm-db-prod-mcp", "mcp-dashboard"),
    [string]$DevRoot = "C:\Users\Gianmarco\Urgewalt\Yetzirah",
    [string]$DeployRoot = "C:\Users\Gianmarco\Urgewalt\Binah"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$serviceMap = @{
    "llm-context" = @{
        Folder = "llm_context"
        Port = 8765
        HealthUrl = "http://127.0.0.1:8765/health"
        StartExe = "python"
        StartArgs = @("-u", "mcp_server_http.py")
    }
    "llm-memory" = @{
        Folder = "llm-memory"
        Port = 8767
        HealthUrl = "http://127.0.0.1:8767/health"
        StartExe = "python"
        StartArgs = @("-m", "src.mcp_server.http_server")
    }
    "llm-db-dev-mcp" = @{
        Folder = "llm-db-dev-mcp"
        Port = 8781
        HealthUrl = "http://127.0.0.1:8781/health"
        StartScript = "start-mcp-db.ps1"
        StartScriptMode = "dev"
    }
    "llm-db-prod-mcp" = @{
        Folder = "llm-db-prod-mcp"
        Port = 8782
        HealthUrl = "http://127.0.0.1:8782/health"
        StartScript = "start-mcp-db.ps1"
        StartScriptMode = "prod"
    }
    "mcp-dashboard" = @{
        Folder = "mcp-dashboard"
        Port = 8790
        HealthUrl = "http://127.0.0.1:8790/health"
        StartExe = "pwsh"
        StartArgs = @(
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "start-dashboard.ps1",
            "-NoReload"
        )
    }
}

function Get-ServiceProcessByPort {
    param(
        [int]$Port,
        [string]$DeployPathFragment
    )

    $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $listeners) { return @() }

    $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
    $matches = @()
    foreach ($procId in $pids) {
        $proc = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $procId) -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        $cmd = [string]$proc.CommandLine
        if ($cmd -and $cmd.ToLower().Contains($DeployPathFragment.ToLower())) {
            $matches += [pscustomobject]@{
                Pid = $procId
                CommandLine = $cmd
            }
        }
    }

    # Fallback: some runtimes (ex: node src/server.js) expose a short command line
    # without absolute path; if no path match was found, stop every listener on the target port.
    if ($matches.Count -eq 0) {
        foreach ($procId in $pids) {
            $proc = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $procId) -ErrorAction SilentlyContinue
            $matches += [pscustomobject]@{
                Pid = $procId
                CommandLine = if ($proc) { [string]$proc.CommandLine } else { "" }
            }
        }
    }

    return $matches
}

function Stop-ServiceByPort {
    param(
        [int]$Port,
        [string]$DeployPathFragment
    )
    $targets = Get-ServiceProcessByPort -Port $Port -DeployPathFragment $DeployPathFragment
    foreach ($target in $targets) {
        Write-Host ("Stopping PID {0} on port {1}" -f $target.Pid, $Port)
        Stop-Process -Id $target.Pid -Force -ErrorAction Stop
    }
}

function Wait-PortFree {
    param([int]$Port, [int]$TimeoutSeconds = 20)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $listen = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        if (-not $listen) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Wait-Health {
    param([string]$Url, [int]$TimeoutSeconds = 45)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) { return $true }
        } catch {
            Start-Sleep -Milliseconds 800
        }
    }
    return $false
}

function Run-Robocopy {
    param(
        [string]$From,
        [string]$To
    )

    if (-not (Test-Path $To)) {
        New-Item -ItemType Directory -Path $To -Force | Out-Null
    }

    $args = @(
        $From,
        $To,
        "/E",
        "/R:1",
        "/W:1",
        "/NFL",
        "/NDL",
        "/NJH",
        "/NJS",
        "/XD", ".git", ".venv", "node_modules", ".local", "logs", "data", "__pycache__", ".pytest_cache", "tmp",
        "/XF", ".env", "*.log", "*.sqlite", "*.db", "*.lock"
    )

    & robocopy @args | Out-Null
    $code = $LASTEXITCODE
    if ($code -gt 7) {
        throw ("robocopy failed with exit code {0} ({1} -> {2})" -f $code, $From, $To)
    }
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $DeployRoot "_deploy_backups"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

foreach ($serviceName in $Services) {
    if (-not $serviceMap.ContainsKey($serviceName)) {
        throw ("Unknown service: {0}" -f $serviceName)
    }

    $svc = $serviceMap[$serviceName]
    $devPath = Join-Path $DevRoot $svc.Folder
    $deployPath = Join-Path $DeployRoot $svc.Folder

    if (-not (Test-Path $devPath)) { throw ("DEV path not found: {0}" -f $devPath) }
    if (-not (Test-Path $deployPath)) { throw ("DEPLOY path not found: {0}" -f $deployPath) }

    Write-Host ""
    Write-Host ("=== Deploy {0} ===" -f $serviceName) -ForegroundColor Cyan
    Write-Host ("DEV:    {0}" -f $devPath)
    Write-Host ("DEPLOY: {0}" -f $deployPath)

    Stop-ServiceByPort -Port $svc.Port -DeployPathFragment $deployPath
    if (-not (Wait-PortFree -Port $svc.Port)) {
        throw ("Port {0} not free after stop for service {1}" -f $svc.Port, $serviceName)
    }

    $backupPath = Join-Path $backupRoot ("{0}_{1}" -f $serviceName, $timestamp)
    Write-Host ("Backup -> {0}" -f $backupPath)
    Run-Robocopy -From $deployPath -To $backupPath

    Write-Host "Copy DEV -> DEPLOY"
    Run-Robocopy -From $devPath -To $deployPath

    Write-Host ("Start service ({0})" -f $serviceName)
    if ($svc.ContainsKey("StartScript")) {
        $scriptPath = Join-Path $PSScriptRoot $svc.StartScript
        $scriptArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath,
                        "-Mode", $svc.StartScriptMode, "-NoPrompt", "-BinahRoot", $DeployRoot)
        Start-Process pwsh -ArgumentList $scriptArgs -WindowStyle Hidden | Out-Null
    } else {
        Start-Process -FilePath $svc.StartExe -ArgumentList $svc.StartArgs -WorkingDirectory $deployPath | Out-Null
    }

    if (-not (Wait-Health -Url $svc.HealthUrl)) {
        throw ("Health check failed for {0} at {1}" -f $serviceName, $svc.HealthUrl)
    }
    Write-Host ("Health OK: {0}" -f $svc.HealthUrl) -ForegroundColor Green
}

Write-Host ""
Write-Host "Running MCP transport compliance checks on DEPLOY..." -ForegroundColor Cyan
$complianceScript = Join-Path $DevRoot "tools\test-mcp-transport-compliance.ps1"
& $complianceScript
if ($LASTEXITCODE -ne 0) {
    throw "Compliance checks failed after deploy."
}

Write-Host ""
Write-Host "Deploy completed successfully." -ForegroundColor Green

