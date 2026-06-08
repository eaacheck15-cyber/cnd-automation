#requires -Version 5.1
<#
Runner do /auto chamado pelo Task Scheduler todos os dias as 7h.
Invoca o Claude Code em modo headless no diretorio do projeto e executa o slash command /auto.
Loga stdout/stderr em logs/auto-daily-YYYY-MM-DD.log.
#>

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

$LogFile = Join-Path $LogDir ("auto-daily-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))
$Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

"[$Stamp] === inicio auto-daily ===" | Out-File -FilePath $LogFile -Append -Encoding utf8

Set-Location $ProjectRoot

# Executa Claude Code headless. Ajuste os flags se sua versao do CLI usar nomes diferentes.
& claude -p "/auto" --permission-mode acceptEdits *>> $LogFile

$Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$Stamp] === fim auto-daily (exit=$LASTEXITCODE) ===" | Out-File -FilePath $LogFile -Append -Encoding utf8
exit $LASTEXITCODE
