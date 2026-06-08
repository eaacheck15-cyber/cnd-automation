New-Item -ItemType File -Path "$PSScriptRoot\STOP" -Force | Out-Null
Write-Host "Pipeline pausado. Execute .\resume-pipeline.ps1 para retomar." -ForegroundColor Yellow
