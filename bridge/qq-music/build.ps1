$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $repositoryRoot

python -m pip install -r bridge/qq-music/requirements-build.txt
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

python -m PyInstaller --noconfirm --clean --onefile --name qq-music-bridge --collect-all frida --add-data "bridge/qq-music/hook_qq_music.js;." --paths "bridge/qq-music" bridge/qq-music/main.py
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
