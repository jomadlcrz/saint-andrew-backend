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

# Terminals keep environment variables from when they were opened, so a stale Firebase
# credential (e.g. the old project's) would silently override service-account.json.
# Re-read it from the user environment on every start, like the keys above.
$userFirebaseCredential = [Environment]::GetEnvironmentVariable('FIREBASE_SERVICE_ACCOUNT_JSON', 'User')
if (-not [string]::IsNullOrWhiteSpace($userFirebaseCredential)) {
  $env:FIREBASE_SERVICE_ACCOUNT_JSON = $userFirebaseCredential
} else {
  Remove-Item Env:FIREBASE_SERVICE_ACCOUNT_JSON -ErrorAction SilentlyContinue
}

Set-Location $backendDirectory

$nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
  throw 'Node.js was not found. Install Node.js 18+ and try again.'
}

& $nodePath 'src/server.js'
