param(
  [string]$Version,
  [switch]$SkipChecks,
  [switch]$SkipPackage
)

$ErrorActionPreference = "Stop"

function Resolve-BunPath {
  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if ($bunCommand) {
    return $bunCommand.Source
  }

  $defaultBunPath = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
  if (Test-Path $defaultBunPath) {
    return $defaultBunPath
  }

  throw "Could not find bun. Install Bun or add it to PATH."
}

function Invoke-Bun {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  Write-Host "==> bun $($Arguments -join ' ')"
  & $script:BunExe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "bun $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$script:BunExe = Resolve-BunPath
$bunBinDir = Split-Path -Parent $script:BunExe
if (-not ($env:Path -split ";" | Where-Object { $_ -eq $bunBinDir })) {
  $env:Path = "$bunBinDir;$env:Path"
}

Write-Host "Repo root: $repoRoot"
Write-Host "Using Bun: $script:BunExe"

if (-not $SkipChecks) {
  Invoke-Bun -Arguments @("fmt")
  Invoke-Bun -Arguments @("lint")
  Invoke-Bun -Arguments @("typecheck")
} else {
  Write-Host "Skipping fmt/lint/typecheck."
}

if ($SkipPackage) {
  Invoke-Bun -Arguments @("run", "build:desktop")
} elseif ([string]::IsNullOrWhiteSpace($Version)) {
  Invoke-Bun -Arguments @("run", "dist:desktop:win")
} else {
  $env:T3CODE_DESKTOP_VERSION = $Version
  try {
    Invoke-Bun -Arguments @("run", "dist:desktop:win")
  } finally {
    Remove-Item Env:T3CODE_DESKTOP_VERSION -ErrorAction SilentlyContinue
  }
}

$releaseDir = Join-Path $repoRoot "release"
if (Test-Path $releaseDir) {
  Write-Host ""
  Write-Host "Artifacts in: $releaseDir"
  Get-ChildItem $releaseDir | Sort-Object LastWriteTime -Descending | Select-Object -First 5
}
