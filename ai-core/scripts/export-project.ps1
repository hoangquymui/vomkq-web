param([switch]$IncludeKnowledge, [switch]$IncludeModels)
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$project = Split-Path -Parent $PSScriptRoot
$bundle = Get-ProjectRuntime $project
if (-not $bundle -or -not (Test-Path -LiteralPath (Join-Path $bundle 'bin\vector-ai.exe'))) {
    throw 'Prepare the runtime with -BuildDesktop before exporting.'
}
$name = 'VECTOR_AI_SHARED_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '_' + [Guid]::NewGuid().ToString('N').Substring(0,6)
$destination = Join-Path $project "deliverables\$name"
New-Item -ItemType Directory -Path $destination | Out-Null
$excludes = @('__pycache__','.pytest_cache','.venv','.venv-1','target','.vite','.cache')
$excludeFiles = @('.env','.env.*','.npmrc','*.log','*.pyc')
try {
    foreach ($directory in @('src','scripts','backend','src-tauri','node_modules')) {
        Copy-RuntimeDirectory (Join-Path $project $directory) (Join-Path $destination $directory) $excludes $excludeFiles
    }
    $publicExcludes = if ($IncludeKnowledge) { @() } else { @('knowledge') }
    Copy-RuntimeDirectory (Join-Path $project 'public') (Join-Path $destination 'public') $publicExcludes $excludeFiles
    if ($IncludeKnowledge -and (Test-Path -LiteralPath (Join-Path $project 'knowledge_sources'))) {
        Copy-RuntimeDirectory (Join-Path $project 'knowledge_sources') (Join-Path $destination 'knowledge_sources') @() $excludeFiles
    }
    foreach ($file in @('package.json','package-lock.json','index.html','migration.html','vite.config.js','README.md','SHARING.md','.gitignore','RUN_VECTOR_AI.bat','RUN_VECTOR_AI_PORTABLE.bat','PREPARE_LOCAL_RUNTIME.bat','EXPORT_SHARED_PROJECT.bat','SETUP_RAG_LOCAL.bat','MIGRATE_LEGACY_DATA.bat')) {
        $source = Join-Path $project $file
        if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $destination $file) }
    }
    New-Item -ItemType Directory -Path (Join-Path $destination '.vscode') | Out-Null
    Copy-Item -LiteralPath (Join-Path $project '.vscode\launch.json') -Destination (Join-Path $destination '.vscode\launch.json')
    $active = Get-Content -LiteralPath (Join-Path $project 'runtime\active.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Copy-RuntimeDirectory $bundle (Join-Path $destination ("runtime\" + $active.bundle)) @('__pycache__') @('*.log','*.pyc')
    Copy-Item -LiteralPath (Join-Path $project 'runtime\active.json') -Destination (Join-Path $destination 'runtime\active.json')
    if ($IncludeModels) {
        $models = Join-Path $project 'runtime\models'
        if (-not (Test-Path -LiteralPath $models)) { throw 'runtime/models is not prepared; no global model cache is copied automatically.' }
        Copy-RuntimeDirectory $models (Join-Path $destination 'runtime\models') @() @('*.log')
    }
    Write-RuntimeJson (Join-Path $destination 'share-manifest.json') @{
        format='vector-shared-source-v1'; runtime_bundle=$active.bundle;
        includes_knowledge=[bool]$IncludeKnowledge; includes_models=[bool]$IncludeModels;
        excludes=@('chat history','API keys','.env','user settings','legacy backups','unused virtualenvs','Rust build caches');
        start='RUN_VECTOR_AI_PORTABLE.bat'; architecture='Windows x64';
        prerequisites=@('WebView2 Runtime','GPU driver if GPU acceleration is used','Ollama models available on recipient machine or supplied separately')
    }
    # Validate paths after relocation, not just in the source checkout.
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $destination 'scripts\run-project.ps1') -Check
    if ($LASTEXITCODE -ne 0) { throw 'Relocated runtime verification failed.' }
    $exportRuntime = Get-ProjectRuntime $destination
    & (Join-Path $exportRuntime 'python\python.exe') (Join-Path $destination 'scripts\check_portable_runtime.py')
    if ($LASTEXITCODE -ne 0) { throw 'Isolation/hash/privacy checks on the exported copy failed.' }
    Write-Host "[VECTOR AI] Share folder ready: $destination"
    Write-Host '[VECTOR AI] Run RUN_VECTOR_AI_PORTABLE.bat on a Windows x64 PC with WebView2 and the needed models.'
    if (-not $IncludeKnowledge) { Write-Host '[VECTOR AI] Built-in knowledge documents excluded. Use -IncludeKnowledge only when you intend to share them.' }
} catch {
    Write-RuntimeJson (Join-Path $destination 'export-error.json') @{error=$_.Exception.Message; complete=$false}
    throw
}
