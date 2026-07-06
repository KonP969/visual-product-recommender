# Zatrzymuje procesy stosu po portach (tylko te nasluchujace na 8000/8001/3001 i porcie Vite z logu).
$ports = @(8000, 8001, 3001)
$log = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\logs\frontend.log'
if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern 'localhost:(\d+)' | Select-Object -Last 1
    if ($m) { $ports += [int]$m.Matches[0].Groups[1].Value }
}
foreach ($port in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Write-Host "stopping PID $($c.OwningProcess) (port $port)"
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
