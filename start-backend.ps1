$ErrorActionPreference = 'Stop'

$backendDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$userSemaphoreKey = [Environment]::GetEnvironmentVariable('SEMAPHORE_API_KEY', 'User')
$userBrevoKey = [Environment]::GetEnvironmentVariable('BREVO_API_KEY', 'User')

if (-not [string]::IsNullOrWhiteSpace($userSemaphoreKey)) {
  $env:SEMAPHORE_API_KEY = $userSemaphoreKey
} else {
  Remove-Item Env:SEMAPHORE_API_KEY -ErrorAction SilentlyContinue
  Write-Host 'SEMAPHORE_API_KEY is not configured; local SMS will be simulated.' -ForegroundColor Yellow
}

if (-not [string]::IsNullOrWhiteSpace($userBrevoKey)) {
  $env:BREVO_API_KEY = $userBrevoKey
} else {
  Remove-Item Env:BREVO_API_KEY -ErrorAction SilentlyContinue
}

Set-Location $backendDirectory

$nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
  throw 'Node.js was not found. Install Node.js 18+ and try again.'
}

& $nodePath 'src/server.js'
