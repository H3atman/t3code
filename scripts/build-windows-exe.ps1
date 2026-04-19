[CmdletBinding()]
param(
  [ValidateSet("x64", "arm64")]
  [string]$Arch = "x64",

  [string]$Target = "nsis",

  [string]$Version,

  [string]$OutputDir = "release",

  [switch]$SkipChecks,

  [switch]$SkipBuild,

  [switch]$KeepStage,

  [switch]$Signed,

  [switch]$VerboseBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

function Assert-CommandExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if (-not (Get-Command -Name $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Format-Command {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Command
  )

  return ($Command | ForEach-Object {
      if ($_ -match "\s") {
        '"{0}"' -f $_
      } else {
        $_
      }
    }) -join " "
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,

    [Parameter(Mandatory = $true)]
    [string[]]$Command,

    [hashtable]$Environment = @{}
  )

  Write-Host ""
  Write-Host "==> $Label"
  Write-Host ("    " + (Format-Command -Command $Command))

  $commandName = $Command[0]
  $commandArgs = @()
  if ($Command.Length -gt 1) {
    $commandArgs = $Command[1..($Command.Length - 1)]
  }

  $originalEnvironment = @{}
  try {
    foreach ($entry in $Environment.GetEnumerator()) {
      $name = [string]$entry.Key
      $originalEnvironment[$name] = [System.Environment]::GetEnvironmentVariable($name)
      if ($null -eq $entry.Value) {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
      } else {
        [System.Environment]::SetEnvironmentVariable($name, [string]$entry.Value)
      }
    }

    & $commandName @commandArgs
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $(Format-Command -Command $Command)"
    }
  }
  finally {
    foreach ($entry in $originalEnvironment.GetEnumerator()) {
      [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value)
    }
  }
}

function Resolve-OutputDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }

  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function Assert-WindowsSigningEnvironment {
  $requiredVars = @(
    "AZURE_TENANT_ID",
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "AZURE_TRUSTED_SIGNING_ENDPOINT",
    "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
    "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME",
    "AZURE_TRUSTED_SIGNING_PUBLISHER_NAME"
  )

  $missingVars = @($requiredVars | Where-Object {
    [string]::IsNullOrWhiteSpace([System.Environment]::GetEnvironmentVariable($_))
  })

  if ($missingVars.Count -gt 0) {
    throw "Missing required environment variables for -Signed: $($missingVars -join ', ')"
  }
}

function Assert-WindowsNativeBuildTools {
  $vswherePath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path -LiteralPath $vswherePath)) {
    throw @"
Visual Studio Build Tools were not found.
Install Visual Studio 2022 Build Tools with the 'Desktop development with C++' workload,
then rerun this script.
"@
  }

  $vsInstallationPath = & $vswherePath `
    -latest `
    -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath

  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($vsInstallationPath)) {
    throw @"
Visual Studio C++ build tools were not found.
Install Visual Studio 2022 Build Tools with the 'Desktop development with C++' workload,
then rerun this script.
"@
  }
}

$isRunningOnWindows = $env:OS -eq "Windows_NT"

if (-not $isRunningOnWindows) {
  throw "This script is intended to run on Windows."
}

Assert-CommandExists -Name "bun"
Assert-WindowsNativeBuildTools

$resolvedOutputDir = Resolve-OutputDirectory -Path $OutputDir -RepoRoot $repoRoot

Push-Location $repoRoot
try {
  if ($Signed) {
    Assert-WindowsSigningEnvironment
  }

  if (-not $SkipChecks) {
    Invoke-Step -Label "Formatting workspace" -Command @("bun", "fmt")
    Invoke-Step -Label "Linting workspace" -Command @("bun", "lint")
    Invoke-Step -Label "Typechecking workspace" -Command @("bun", "typecheck")
  }

  $buildEnvironment = @{
    T3CODE_DESKTOP_PLATFORM = "win"
    T3CODE_DESKTOP_TARGET = $Target
    T3CODE_DESKTOP_ARCH = $Arch
    T3CODE_DESKTOP_OUTPUT_DIR = $resolvedOutputDir
    T3CODE_DESKTOP_SKIP_BUILD = if ($SkipBuild) { "true" } else { $null }
    T3CODE_DESKTOP_KEEP_STAGE = if ($KeepStage) { "true" } else { $null }
    T3CODE_DESKTOP_SIGNED = if ($Signed) { "true" } else { $null }
    T3CODE_DESKTOP_VERBOSE = if ($VerboseBuild) { "true" } else { $null }
    T3CODE_DESKTOP_VERSION = if (-not [string]::IsNullOrWhiteSpace($Version)) { $Version } else { $null }
  }

  $buildCommand = @(
    "bun",
    "run",
    "dist:desktop:artifact"
  )

  Invoke-Step -Label "Building Windows desktop artifact" -Command $buildCommand -Environment $buildEnvironment

  $artifacts = @(Get-ChildItem -LiteralPath $resolvedOutputDir -File | Sort-Object LastWriteTime -Descending)
  $exeArtifact = $artifacts | Where-Object { $_.Extension -eq ".exe" } | Select-Object -First 1

  if (-not $exeArtifact) {
    throw "Build completed but no .exe artifact was found in '$resolvedOutputDir'."
  }

  Write-Host ""
  Write-Host "Build complete."
  Write-Host "Installer: $($exeArtifact.FullName)"

  $relatedArtifacts = @($artifacts | Where-Object {
    $_.Extension -in @(".exe", ".blockmap", ".yml", ".yaml")
  })

  if ($relatedArtifacts.Count -gt 1) {
    Write-Host "Artifacts:"
    foreach ($artifact in $relatedArtifacts) {
      Write-Host " - $($artifact.FullName)"
    }
  }
}
finally {
  Pop-Location
}
