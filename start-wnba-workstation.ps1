$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Stop-ListenerOnPort {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $lines = netstat -ano | Select-String ":$Port"
  if (-not $lines) {
    return
  }

  $pids = @()
  foreach ($line in $lines) {
    $text = $line.ToString().Trim()
    if ($text -match "LISTENING\s+(\d+)$") {
      $pids += [int]$matches[1]
    }
  }

  $pids = $pids | Sort-Object -Unique
  foreach ($processId in $pids) {
    if ($processId -gt 0) {
      try {
        Stop-Process -Id $processId -Force -ErrorAction Stop
        Write-Host "Stopped existing process on port $Port (PID $processId)." -ForegroundColor DarkYellow
      } catch {
        Write-Host "Could not stop PID $processId on port $Port." -ForegroundColor Yellow
      }
    }
  }
}

$backendCommand = "Set-Location '$root'; npm --prefix backend run dev"
$frontendCommand = "Set-Location '$root'; npm --prefix frontend run dev"

Write-Host "Launching WNBA Trading Workstation..." -ForegroundColor Cyan
Write-Host "Backend and frontend will open in separate PowerShell windows." -ForegroundColor Gray

Stop-ListenerOnPort -Port 4000
Stop-ListenerOnPort -Port 5173

Start-Process powershell.exe -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy", "Bypass",
  "-Command", $backendCommand
)

Start-Sleep -Seconds 1

Start-Process powershell.exe -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy", "Bypass",
  "-Command", $frontendCommand
)

Start-Sleep -Seconds 3

Start-Process "http://127.0.0.1:5173/"

Write-Host ""
Write-Host "If the app does not load immediately, give it a few seconds and refresh the page." -ForegroundColor Yellow
Write-Host "App URL: http://127.0.0.1:5173/" -ForegroundColor Green
