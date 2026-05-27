#requires -Version 5.1
<#
Registra a tarefa "CND Docs Daily" no Task Scheduler do Windows.
Roda UMA vez por maquina (Administrador NAO e necessario para tasks do usuario).

  powershell -ExecutionPolicy Bypass -File .\scripts\install-docs-task.ps1

Para remover:
  Unregister-ScheduledTask -TaskName "CND Docs Daily" -Confirm:$false
#>

$ErrorActionPreference = "Stop"

$TaskName = "CND Docs Daily"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RunnerPath = Join-Path $PSScriptRoot "docs-daily.ps1"

if (-not (Test-Path $RunnerPath)) {
    throw "Runner nao encontrado em $RunnerPath"
}

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunnerPath`"" `
    -WorkingDirectory $ProjectRoot

# Dispara todos os dias as 18:00 hora local da maquina (fim do expediente).
$Trigger = New-ScheduledTaskTrigger -Daily -At "18:00"

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Atualiza a documentacao no Obsidian (/update-docs) todos os dias as 18:00." `
    -Force | Out-Null

Write-Host "Tarefa '$TaskName' registrada. Proximo disparo:"
(Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo).NextRunTime
