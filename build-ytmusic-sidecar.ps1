$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$venvPython = Join-Path $PSScriptRoot ".orbit-ytmusic-venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  py -3 -m venv (Join-Path $PSScriptRoot ".orbit-ytmusic-venv")
}
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Could not update the sidecar build environment." }
& $venvPython -m pip install -r (Join-Path $PSScriptRoot "requirements-ytmusic.txt") pyinstaller
if ($LASTEXITCODE -ne 0) { throw "Could not install YouTube Music bridge dependencies." }
& $venvPython -m PyInstaller --noconfirm --clean --onefile --console --collect-data ytmusicapi --name orbit-ytmusic-bridge --distpath (Join-Path $PSScriptRoot "sidecar-dist") --workpath (Join-Path $PSScriptRoot "sidecar-build") --specpath (Join-Path $PSScriptRoot "sidecar-build") (Join-Path $PSScriptRoot "orbit_ytmusic_bridge.py")
if ($LASTEXITCODE -ne 0) { throw "Could not package the YouTube Music sidecar." }
$exe = Join-Path $PSScriptRoot "sidecar-dist\orbit-ytmusic-bridge.exe"
if (-not (Test-Path $exe)) { throw "The sidecar executable was not created." }
Write-Host "Built $exe"
