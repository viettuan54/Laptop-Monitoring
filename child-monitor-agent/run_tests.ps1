$ErrorActionPreference = 'Stop'

$pythonExe = Join-Path $PSScriptRoot '.venv-edge\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
    throw "Không tìm thấy môi trường Python của Agent: $pythonExe"
}

& $pythonExe -m unittest discover -s tests -p 'test_*.py' -v
exit $LASTEXITCODE
