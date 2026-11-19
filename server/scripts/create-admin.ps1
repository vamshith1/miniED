# Creates the first admin account on the LIVE database (Neon).
#
# Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File server\scripts\create-admin.ps1
#
# It asks for the database connection string and the admin password with hidden input,
# never saves them, and clears them from this window when it finishes.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")   # the server folder

function Read-Secret([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Write-Host ""
Write-Host "Create the first MiniEdCRM admin on the live database" -ForegroundColor Magenta
Write-Host "In Neon: Connect > turn Connection pooling OFF > Copy snippet." -ForegroundColor DarkGray
Write-Host ""

# Use a string already set in this window ($env:DATABASE_URL = '...'), or ask for it.
# Some terminals don't pass a paste into a hidden prompt, so setting it first always works.
if ($env:DATABASE_URL -and $env:DATABASE_URL -match 'neon\.tech') {
  $db = $env:DATABASE_URL.Trim()
  Write-Host "Using the connection string already set in this window." -ForegroundColor DarkGray
} else {
  $db = (Read-Secret "Paste your Neon connection string (hidden), then press Enter").Trim()
}
if (-not $db) {
  Write-Host "Nothing was pasted. Set it first instead, with SINGLE quotes:" -ForegroundColor Red
  Write-Host "  `$env:DATABASE_URL = 'postgresql://...'" -ForegroundColor Yellow
  Write-Host "then run this script again." -ForegroundColor Red
  exit 1
}
if ($db -notmatch '^postgres(ql)?://' -or $db -notmatch 'neon\.tech') {
  Write-Host "That doesn't look like a Neon connection string. It should start with postgresql:// and contain neon.tech." -ForegroundColor Red
  exit 1
}
if ($db -match '-pooler\.') {
  # The direct address is the pooled one without "-pooler".
  $db = $db -replace '-pooler\.', '.'
  Write-Host "Switched the pooled address to the direct one (removed -pooler)." -ForegroundColor DarkGray
}

$email = if ($env:SEED_ADMIN_EMAIL) { $env:SEED_ADMIN_EMAIL.Trim() } else { (Read-Host "Admin email").Trim() }
if ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
  Write-Host "That isn't a valid email address." -ForegroundColor Red
  exit 1
}

if ($env:SEED_ADMIN_PASSWORD) {
  $password = $env:SEED_ADMIN_PASSWORD
} else {
  $password = Read-Secret "Admin password (10+ characters, hidden)"
  $repeat = Read-Secret "Repeat the password"
  if ($password -ne $repeat) { Write-Host "The passwords don't match." -ForegroundColor Red; exit 1 }
}
if ($password.Length -lt 10) { Write-Host "Use at least 10 characters." -ForegroundColor Red; exit 1 }

try {
  $env:DATABASE_URL = $db
  $env:SEED_ADMIN_EMAIL = $email
  $env:SEED_ADMIN_PASSWORD = $password
  npm run db:seed
  if ($LASTEXITCODE -ne 0) { throw "The seed failed (see the message above)." }
  Write-Host ""
  Write-Host "Done. Sign in at https://miniedcrm-5dpw.onrender.com with $email and the password you chose." -ForegroundColor Green
}
finally {
  # Leave nothing behind in this window.
  Remove-Item Env:DATABASE_URL, Env:SEED_ADMIN_EMAIL, Env:SEED_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $db = $null; $password = $null; $repeat = $null
}
