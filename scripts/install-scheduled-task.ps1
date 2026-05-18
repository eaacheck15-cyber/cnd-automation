#requires -Version 5.1
<#
Registra a tarefa "CND Auto Daily" no Task Scheduler do Windows.
Rodar UMA vez por maquina (Administrador NAO e necessario para tasks do usuario).

  pwsh -ExecutionPolicy Bypass -File .\scripts\install-scheduled-task.ps1

Para remover:
  Unregister-ScheduledTask -TaskName "CND Auto Daily" -Confirm:$false
#>

$ErrorActionPreference = "Stop"

$TaskName = "CND Auto Daily"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RunnerPath = Join-Path $PSScriptRoot "auto-daily.ps1"

if (-not (Test-Path $RunnerPath)) {
    throw "Runner nao encontrado em $RunnerPath"
}

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunnerPath`"" `
    -WorkingDirectory $ProjectRoot

# Dispara todos os dias as 07:00 hora local da maquina.
$Trigger = New-ScheduledTaskTrigger -Daily -At "07:00"

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4)

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Executa /auto do CND Automation todos os dias as 07:00." `
    -Force | Out-Null

Write-Host "Tarefa '$TaskName' registrada. Proximo disparo:"
(Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo).NextRunTime
