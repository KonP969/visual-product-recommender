# Uruchamia caly stos jako odlaczone procesy Windows (przezywaja zamkniecie terminala).
# Logi: scripts/logs/*.log  |  Zatrzymanie: scripts/stop-all.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root 'scripts\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Start-Detached($name, $exe, $argList, $cwd) {
    $log = Join-Path $logs "$name.log"
    Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $cwd `
        -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    Write-Host "started $name -> $log"
}

Start-Detached 'chroma'   'C:\Users\Konrad\anaconda3\Scripts\chroma.exe' 'run --path ./chroma_db --port 8000' $root
Start-Detached 'sidecar'  (Join-Path $root 'python-sidecar\venv\Scripts\uvicorn.exe') 'main:app --port 8001' (Join-Path $root 'python-sidecar')
Start-Detached 'backend'  'cmd.exe' '/c npm run dev' (Join-Path $root 'backend')
Start-Detached 'frontend' 'cmd.exe' '/c npm run dev' (Join-Path $root 'frontend')

Write-Host 'Wszystkie 4 procesy wystartowane. Port frontendu: sprawdz scripts/logs/frontend.log'
