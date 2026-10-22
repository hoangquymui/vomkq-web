param([switch]$Portable, [switch]$Development, [switch]$Check)
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$project = Split-Path -Parent $PSScriptRoot
$bundle = Get-ProjectRuntime $project
if (-not $bundle) { throw 'No local runtime. Run PREPARE_LOCAL_RUNTIME.bat -BuildDesktop on the source PC first.' }
$python = Join-Path $bundle 'python\python.exe'
$node = Join-Path $bundle 'node\node.exe'
$env:VECTOR_AI_PROJECT_DIR = $project
$env:PYTHONNOUSERSITE = '1'
$env:PYTHONUTF8 = '1'
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$env:DO_NOT_TRACK = '1'
$env:PATH = (Join-Path $bundle 'node') + ';' + (Join-Path $bundle 'python') + ';' + (Join-Path $bundle 'ollama') + ';' + (Join-Path $bundle 'tesseract') + ';' + $env:PATH
if (Test-Path -LiteralPath (Join-Path $bundle 'tesseract\tessdata')) { $env:TESSDATA_PREFIX = Join-Path $bundle 'tesseract\tessdata' }
$modelStore = Join-Path $project 'runtime\models\ollama'
if (Test-Path -LiteralPath (Join-Path $modelStore 'manifests')) { $env:OLLAMA_MODELS = $modelStore }
& $python -c "import sys,fastapi,uvicorn,httpx,sympy,langgraph,pypdf,fitz,vector_ai_backend; print('Python core OK: ' + sys.executable)"
if ($LASTEXITCODE -ne 0) { throw 'Project Python check failed.' }
& $node --version
if ($LASTEXITCODE -ne 0) { throw 'Project Node check failed.' }
if (-not (Test-Path -LiteralPath (Join-Path $project 'node_modules\vite\package.json'))) { throw 'Missing project node_modules. Prepare dependencies on the source PC, then export again; no runtime download is performed.' }
if ($Check) { Write-Host 'Runtime checks OK. GPU drivers/WebView2/model availability are separate prerequisites.'; exit 0 }
Set-Location -LiteralPath $project
if ($Development) {
    if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) { throw 'Editing/rebuilding Rust needs Rust + MSVC Build Tools. Use RUN_VECTOR_AI_PORTABLE.bat to run the prepared shell without a compiler.' }
    & (Join-Path $bundle 'node\npm.cmd') run desktop
    exit $LASTEXITCODE
}
if (-not $Portable) { throw 'Choose -Portable, -Development or -Check.' }
$desktop = Join-Path $bundle 'bin\vector-ai.exe'
if (-not (Test-Path -LiteralPath $desktop)) { throw 'Desktop shell not prepared. Run PREPARE_LOCAL_RUNTIME.bat -BuildDesktop on the source PC.' }
# Never take over or kill a process that already owns a fixed application port.
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), 3000)
try { $listener.Start() } catch { throw 'Port 3000 is in use. Close the existing VECTOR frontend before launching another copy.' } finally { $listener.Stop() }
$logs = Join-Path $env:LOCALAPPDATA 'VECTOR_AI\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$sessionName = 'shared-frontend-' + [Guid]::NewGuid().ToString('N')
$stdout = Join-Path $logs ($sessionName + '.log')
$stderr = Join-Path $logs ($sessionName + '-error.log')
$env:VECTOR_AI_LAUNCHER_PID = [string]$PID
$frontend = $null
try {
    $frontend = Start-Process -FilePath $node -ArgumentList @('"' + (Join-Path $project 'scripts\portable-frontend.mjs') + '"') -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $ready = $false
    for ($i=0; $i -lt 100; $i++) {
        if ($frontend.HasExited) { throw "Frontend stopped: $(Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)" }
        if ((Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue) -match 'VECTOR frontend ready') { $ready=$true; break }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw "Frontend did not start. See $stderr" }
    $app = Start-Process -FilePath $desktop -WorkingDirectory $project -PassThru -WindowStyle Normal
    # Retain the process handle so ExitCode is available after it exits.
    $appHandle = $app.Handle
    $app.WaitForExit()
    $app.Refresh()
    if ($app.ExitCode -ne 0) { throw "VECTOR desktop exited with $($app.ExitCode). Check WebView2 Runtime on this PC." }
} finally {
    if ($frontend -and -not $frontend.HasExited) { & taskkill.exe /PID $frontend.Id /T /F | Out-Null }
}
