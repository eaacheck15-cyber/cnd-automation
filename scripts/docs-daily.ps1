#requires -Version 5.1
<#
Runner do /update-docs chamado pelo Task Scheduler todos os dias as 18h.
Invoca o Claude Code em modo headless e executa o slash command /update-docs,
que atualiza a documentacao no vault do Obsidian a partir dos commits novos do dia.
Loga stdout/stderr em logs/docs-daily-YYYY-MM-DD.log.
#>

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot

# A documentacao vive em $ProjectRoot\docs (dentro do repo), entao o run headless
# ja tem acesso de escrita a ela — nao precisa de --add-dir.

$LogDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

$LogFile = Join-Path $LogDir ("docs-daily-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))
$Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

"[$Stamp] === inicio docs-daily ===" | Out-File -FilePath $LogFile -Append -Encoding utf8

Set-Location $ProjectRoot

# Executa Claude Code headless. bypassPermissions evita travar esperando aprovacao
# de comandos git/PowerShell num run desatendido (a skill so le git e escreve em docs/).
# Ajuste os flags se a sua versao do CLI usar nomes diferentes.
& claude -p "/update-docs" --permission-mode bypassPermissions *>> $LogFile

$Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$Stamp] === fim docs-daily (exit=$LASTEXITCODE) ===" | Out-File -FilePath $LogFile -Append -Encoding utf8
exit $LASTEXITCODE
