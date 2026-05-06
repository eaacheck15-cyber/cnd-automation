if (Test-Path "$PSScriptRoot\STOP") {
    Remove-Item -Path "$PSScriptRoot\STOP" -Force
    Write-Host "Pipeline retomado. O proximo ciclo do /loop continuara normalmente." -ForegroundColor Green
} else {
    Write-Host "Pipeline ja esta rodando (arquivo STOP nao existe)." -ForegroundColor Cyan
}
