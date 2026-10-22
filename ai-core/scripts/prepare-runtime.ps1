param(
    [switch]$BuildDesktop,
    [string]$QdrantExe = '',
    [string]$TesseractDirectory = ''
)
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$project = Split-Path -Parent $PSScriptRoot
$sourcePython = Join-Path $project 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $sourcePython)) { throw 'Prepare backend/.venv on the source machine first.' }
$probe = & $sourcePython -c "import sys,json,importlib.util; print(json.dumps({'base':sys.base_prefix,'site':sys.prefix+'/Lib/site-packages','dll':'python'+str(sys.version_info.major)+str(sys.version_info.minor),'version':sys.version,'optional':{m:importlib.util.find_spec(m) is not None for m in ['sentence_transformers','qdrant_client','pytesseract','pix2text']}}))"
if ($LASTEXITCODE -ne 0) { throw 'The source Python environment does not run.' }
$pythonInfo = $probe | ConvertFrom-Json
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$ollamaCommand = Get-Command ollama.exe -ErrorAction SilentlyContinue
$bundleName = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6)
$bundle = Join-Path $project "runtime\bundles\$bundleName"
New-Item -ItemType Directory -Path $bundle | Out-Null
$missing = [Collections.Generic.List[string]]::new()
try {
    Write-Host '[VECTOR AI] Copying standalone Python + backend packages (no base site-packages, no personal environment)...'
    $pythonTarget = Join-Path $bundle 'python'
    New-Item -ItemType Directory -Path $pythonTarget | Out-Null
    Get-ChildItem -LiteralPath $pythonInfo.base -File | Where-Object { $_.Name -match '^(python.*\.(exe|dll)|vcruntime.*\.dll|LICENSE.*|NEWS.*)$' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $pythonTarget
    }
    foreach ($dir in @('DLLs','Lib','tcl','include','libs')) {
        $source = Join-Path $pythonInfo.base $dir
        if (Test-Path -LiteralPath $source) { Copy-RuntimeDirectory $source (Join-Path $pythonTarget $dir) @('site-packages','__pycache__') }
    }
    Copy-RuntimeDirectory $pythonInfo.site (Join-Path $pythonTarget 'Lib\site-packages') @('__pycache__','vector_ai_backend-0.1.0.dist-info') @('__editable__*','direct_url.json')
    # Do not enable site: user-site/.pth hooks on the receiving machine must not
    # affect this runtime. Backend packages are explicitly on the search path.
    # This location is runtime/bundles/<id>/python, four levels from backend/.
    [IO.File]::WriteAllText((Join-Path $pythonTarget ($pythonInfo.dll + '._pth')), ".`nDLLs`nLib`nLib/site-packages`n../../../../backend`n", [Text.UTF8Encoding]::new($false))
    $portablePython = Join-Path $pythonTarget 'python.exe'
    & $portablePython -c "import fastapi,uvicorn,httpx,sympy,langgraph,pypdf,fitz,vector_ai_backend; print('Portable Python imports: OK')"
    if ($LASTEXITCODE -ne 0) { throw 'Portable Python verification failed. Active runtime was not changed.' }
    $packages = & $portablePython -c "import importlib.metadata as m,json; print(json.dumps(sorted([{'name':d.metadata['Name'],'version':d.version} for d in m.distributions()],key=lambda x:x['name'].lower())))"
    Write-RuntimeJson (Join-Path $bundle 'python-packages.json') ($packages | ConvertFrom-Json)

    Write-Host '[VECTOR AI] Copying Node.js and npm...'
    $nodeSource = Split-Path -Parent $nodeCommand.Source
    $nodeTarget = Join-Path $bundle 'node'
    New-Item -ItemType Directory -Path $nodeTarget | Out-Null
    Get-ChildItem -LiteralPath $nodeSource -File | Where-Object { $_.Name -match '^(node\.exe|npm(\.cmd|\.ps1)?|npx(\.cmd|\.ps1)?|LICENSE.*|README.*|CHANGELOG.*)$' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $nodeTarget
    }
    foreach ($package in @('npm','corepack')) {
        $source = Join-Path $nodeSource "node_modules\$package"
        if (Test-Path -LiteralPath $source) { Copy-RuntimeDirectory $source (Join-Path $nodeTarget "node_modules\$package") }
    }
    & (Join-Path $nodeTarget 'node.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'Portable Node verification failed.' }

    if ($ollamaCommand) {
        Write-Host '[VECTOR AI] Copying Ollama server and its compute libraries (not models or keys)...'
        $ollamaTarget = Join-Path $bundle 'ollama'
        $ollamaSource = Split-Path -Parent $ollamaCommand.Source
        New-Item -ItemType Directory -Path $ollamaTarget | Out-Null
        Copy-Item -LiteralPath $ollamaCommand.Source -Destination (Join-Path $ollamaTarget 'ollama.exe')
        Get-ChildItem -LiteralPath $ollamaSource -File | Where-Object { $_.Name -match '\.dll$|LICENSE|NOTICE|COPYING' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $ollamaTarget }
        $ollamaLib = Join-Path $ollamaSource 'lib'
        if (Test-Path -LiteralPath $ollamaLib) { Copy-RuntimeDirectory $ollamaLib (Join-Path $ollamaTarget 'lib') }
    } else { $missing.Add('Ollama server executable') }

    if (-not $QdrantExe) {
        $candidates = @((Join-Path $env:LOCALAPPDATA 'VECTOR_AI\services\qdrant\qdrant.exe'), (Join-Path $project 'backend\tools\qdrant\qdrant.exe'))
        $found = @($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
        if ($found.Count) { $QdrantExe = $found[0] }
    }
    if ($QdrantExe) {
        $qdrant = (Resolve-Path -LiteralPath $QdrantExe).Path
        New-Item -ItemType Directory -Path (Join-Path $bundle 'qdrant') | Out-Null
        Copy-Item -LiteralPath $qdrant -Destination (Join-Path $bundle 'qdrant\qdrant.exe')
        Get-ChildItem -LiteralPath (Split-Path -Parent $qdrant) -File | Where-Object { $_.Name -match '\.dll$|LICENSE|NOTICE|COPYING' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $bundle 'qdrant') }
    } else { $missing.Add('Native Qdrant executable (optional dense retrieval service)') }
    if (-not $TesseractDirectory -and (Test-Path -LiteralPath 'C:\Program Files\Tesseract-OCR\tesseract.exe')) { $TesseractDirectory = 'C:\Program Files\Tesseract-OCR' }
    if ($TesseractDirectory) { Copy-RuntimeDirectory $TesseractDirectory (Join-Path $bundle 'tesseract') }
    else { $missing.Add('Tesseract executable/language files (optional OCR)') }
    foreach ($entry in $pythonInfo.optional.PSObject.Properties) { if (-not $entry.Value) { $missing.Add("Optional Python adapter: $($entry.Name)") } }
    $missing.Add('Embedding/OCR model weights and profiles: must be prepared separately if used')
    $missing.Add('Ollama model weights: excluded by default')

    if ($BuildDesktop) {
        Write-Host '[VECTOR AI] Building the reusable desktop shell offline (no installer)...'
        Push-Location $project
        try {
            & cargo.exe build --offline --locked --manifest-path src-tauri/Cargo.toml
            if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed. Close the running debug app if its executable is locked.' }
            New-Item -ItemType Directory -Path (Join-Path $bundle 'bin') | Out-Null
            Copy-Item -LiteralPath (Join-Path $project 'src-tauri\target\debug\vector-ai.exe') -Destination (Join-Path $bundle 'bin\vector-ai.exe')
        } finally { Pop-Location }
    } else { $missing.Add('Reusable desktop shell: rerun preparation with -BuildDesktop') }
    $checksums = [ordered]@{}
    foreach ($relative in @('python/python.exe','node/node.exe','ollama/ollama.exe','qdrant/qdrant.exe','bin/vector-ai.exe')) {
        $path = Join-Path $bundle $relative
        if (Test-Path -LiteralPath $path) { $checksums[$relative] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
    }
    Write-RuntimeJson (Join-Path $bundle 'manifest.json') ([ordered]@{
        format='vector-runtime-v1'; platform='windows-x64'; created_at=(Get-Date).ToUniversalTime().ToString('o');
        python_version=$pythonInfo.version; node_version=(& (Join-Path $nodeTarget 'node.exe') --version);
        missing=@($missing.ToArray()); checksums=$checksums;
        system_requirements=@('Windows x64','WebView2 Runtime','Compatible GPU driver for CUDA acceleration');
        excludes=@('chat history','API keys','.env','personal settings','model weights','knowledge source documents')
    })
    # Publish the relative pointer last. A failed preparation leaves the previous
    # runtime active, and never overwrites/deletes its libraries.
    Write-RuntimeJson (Join-Path $project 'runtime\active.next.json') @{format='vector-runtime-v1'; bundle="bundles/$bundleName"}
    Move-Item -LiteralPath (Join-Path $project 'runtime\active.next.json') -Destination (Join-Path $project 'runtime\active.json') -Force
    Write-Host "[VECTOR AI] Runtime ready: $bundle"
    $missing | ForEach-Object { Write-Warning $_ }
} catch {
    [IO.File]::WriteAllText((Join-Path $bundle 'preparation-error.txt'), $_.Exception.ToString(), [Text.UTF8Encoding]::new($false))
    throw
}
