# Creates/refreshes the desktop MMM.lnk pointing at the standalone MMM.exe.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File make-mmm-shortcut.ps1
$exe     = 'C:\Users\aaron\projects\Finance agent\mmm-app\build\MMM-portable\MMM.exe'
$workdir = 'C:\Users\aaron\projects\Finance agent\mmm-app\build\MMM-portable'
if (-not (Test-Path $exe)) { Write-Host "MMM.exe not found at $exe (build it first)"; exit 1 }
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = $ws.CreateShortcut((Join-Path $desktop 'MMM.lnk'))
$lnk.TargetPath       = $exe
$lnk.WorkingDirectory = $workdir
$lnk.IconLocation     = "$exe,0"
$lnk.Description       = 'MMM — Making Money Moves'
$lnk.Save()
Write-Host "Created MMM.lnk on Desktop pointing at MMM.exe"
