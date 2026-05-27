#requires -Version 5.1
<#
Bootstrap do browser usado pelas tools pipeline_browser_capture (Playwright) e
pipeline_browser_capture_ahk (Chrome real via CDP).

O que faz:
  1. Instala/atualiza o Chromium do Playwright (npx playwright install chromium).
  2. Verifica que a extensao CapMonster esta presente em resources/capmonster.
  3. Mata processos chrome.exe orfaos que possam estar segurando o profile.
  4. Limpa o diretorio browser-profile (corrompido apos crash gera "quota_database" erro).
  5. Faz um launch inicial do Chromium carregando o profile + a extensao CapMonster
     pra: (a) materializar a estrutura do perfil, (b) registrar o service worker da
     extensao, (c) deixar o profile aquecido pros runs seguintes.

Rodar UMA vez por maquina (ou sempre que o profile corromper / Playwright mandar
mensagem "Please run npx playwright install"):

  pwsh -ExecutionPolicy Bypass -File .\scripts\setup-browser.ps1

Flags opcionais:
  -KeepProfile     : nao apaga o browser-profile existente (default: apaga).
  -SkipLaunch      : pula o launch interativo final (uso em CI / scripts encadeados).
  -LaunchSeconds N : segundos que a janela do Chromium fica aberta antes de fechar
                     (default: 8). Tempo pra confirmar que o icone da CapMonster
                     aparece na toolbar.
#>

[CmdletBinding()]
param(
    [switch] $KeepProfile,
    [switch] $SkipLaunch,
    [int]    $LaunchSeconds = 8
)

$ErrorActionPreference = "Stop"

$ProjectRoot   = Split-Path -Parent $PSScriptRoot
$ProfileDir    = Join-Path $ProjectRoot "browser-profile"
$ExtensionDir  = Join-Path $ProjectRoot "resources\capmonster"
$ExtManifest   = Join-Path $ExtensionDir "manifest.json"

Write-Host "[setup-browser] project root : $ProjectRoot"
Write-Host "[setup-browser] profile dir  : $ProfileDir"
Write-Host "[setup-browser] extension    : $ExtensionDir"

# --- 1) extensao CapMonster -------------------------------------------------
if (-not (Test-Path $ExtManifest)) {
    throw "CapMonster manifest nao encontrado em $ExtManifest. resources/capmonster/ esta no repo?"
}
Write-Host "[setup-browser] OK: extensao CapMonster encontrada."

# --- 2) instala/atualiza Chromium do Playwright -----------------------------
Push-Location $ProjectRoot
try {
    Write-Host "[setup-browser] npx playwright install chromium ..."
    & npx --yes playwright install chromium
    if ($LASTEXITCODE -ne 0) {
        throw "npx playwright install chromium falhou (exit=$LASTEXITCODE). Verifique Node/npm."
    }
} finally {
    Pop-Location
}

# --- 3) localiza o chrome.exe instalado -------------------------------------
$ChromiumRoot = Join-Path $env:LOCALAPPDATA "ms-playwright"
$ChromeExe = Get-ChildItem -Path $ChromiumRoot -Filter "chrome.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "chromium-\d+\\chrome-win\\chrome\.exe$" } |
    Sort-Object { [int]([regex]::Match($_.FullName, "chromium-(\d+)").Groups[1].Value) } -Descending |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $ChromeExe) {
    throw "chrome.exe do Playwright nao encontrado debaixo de $ChromiumRoot apos o install."
}
Write-Host "[setup-browser] chrome.exe   : $ChromeExe"

# --- 4) mata chrome.exe orfaos apontando pro nosso profile -------------------
$Orphans = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$ProfileDir*" }

if ($Orphans) {
    Write-Host "[setup-browser] matando $($Orphans.Count) chrome.exe orfao(s) no profile ..."
    $Orphans | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

# --- 5) limpa o profile (a menos que -KeepProfile) --------------------------
if (Test-Path $ProfileDir) {
    if ($KeepProfile) {
        Write-Host "[setup-browser] -KeepProfile setado: mantendo browser-profile existente."
    } else {
        Write-Host "[setup-browser] removendo browser-profile existente ..."
        Remove-Item -Recurse -Force $ProfileDir
    }
}
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

# --- 6) launch inicial pra aquecer o profile --------------------------------
if ($SkipLaunch) {
    Write-Host "[setup-browser] -SkipLaunch setado: pulando launch de aquecimento."
    Write-Host "[setup-browser] OK: bootstrap concluido."
    return
}

Write-Host "[setup-browser] abrindo Chromium ($LaunchSeconds""s) pra inicializar profile + CapMonster ..."

$Args = @(
    "--user-data-dir=$ProfileDir",
    "--load-extension=$ExtensionDir",
    "--disable-extensions-except=$ExtensionDir",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--lang=pt-BR",
    "about:blank"
)

$Proc = Start-Process -FilePath $ChromeExe -ArgumentList $Args -PassThru
Write-Host "[setup-browser] chromium pid=$($Proc.Id). Confira o icone azul da CapMonster na toolbar."

Start-Sleep -Seconds $LaunchSeconds

if (-not $Proc.HasExited) {
    Write-Host "[setup-browser] fechando Chromium ..."
    Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Mata sub-processos do Chromium (renderer/utility) que possam ter ficado.
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$ProfileDir*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "[setup-browser] OK: bootstrap concluido. profile pronto em $ProfileDir"
