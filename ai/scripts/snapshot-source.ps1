[CmdletBinding()]
param(
    [string]$SourceBackend,
    [switch]$Refresh
)

$ErrorActionPreference = 'Stop'
$taskAiRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskAppRoot = [IO.Path]::GetFullPath((Join-Path $taskAiRoot '..'))
if (-not $SourceBackend) {
    $SourceBackend = [IO.Path]::GetFullPath((Join-Path $taskAiRoot '../../VECTOR AI/backend'))
}
$taskSourceRoot = (Resolve-Path -LiteralPath $SourceBackend).Path
$taskPackageRoot = Join-Path $taskSourceRoot 'vector_ai_backend'
$taskInventoryPath = Join-Path $taskAiRoot 'inventory.json'
if ((Test-Path -LiteralPath $taskInventoryPath) -and -not $Refresh) {
    throw 'Snapshot exists. Use -Refresh to update vendored/reference files after review.'
}
foreach ($required in @('pyproject.toml', 'README.md', 'requirements.txt', 'vector_ai_backend/bootstrap.py')) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskSourceRoot $required) -PathType Leaf)) {
        throw "Missing expected source: $required"
    }
}
$taskMappings = @()
$taskPythonFiles = @(Get-ChildItem -LiteralPath $taskPackageRoot -Recurse -File -Filter '*.py' |
    Where-Object { $_.FullName -notmatch '[\\/]__pycache__[\\/]' } |
    Sort-Object FullName)
foreach ($sourceFile in $taskPythonFiles) {
    $taskRelative = $sourceFile.FullName.Substring($taskSourceRoot.TrimEnd('\', '/').Length + 1).Replace('\', '/')
    $taskMappings += [PSCustomObject]@{
        Source = $sourceFile.FullName
        RelativePath = "vendor/vector-ai/backend/$taskRelative"
        Kind = 'upstream-core'
    }
}
foreach ($name in @('pyproject.toml', 'README.md', 'requirements.txt')) {
    $taskMappings += [PSCustomObject]@{
        Source = Join-Path $taskSourceRoot $name
        RelativePath = "vendor/vector-ai/backend/$name"
        Kind = 'upstream-metadata'
    }
}
foreach ($entry in @(
    @{ Source = 'src/services/vectorAiClient.ts'; Name = 'vectorAiClient.ts' },
    @{ Source = 'scripts/vectorAiLauncher.ts'; Name = 'vectorAiLauncher.ts' }
)) {
    $taskSourceFile = Join-Path $taskAppRoot $entry.Source
    if (-not (Test-Path -LiteralPath $taskSourceFile -PathType Leaf)) {
        throw "Missing current app reference: $taskSourceFile"
    }
    $taskMappings += [PSCustomObject]@{
        Source = $taskSourceFile
        RelativePath = "reference/web/$($entry.Name)"
        Kind = 'inactive-web-reference'
    }
}
$taskRecords = foreach ($entry in $taskMappings) {
    $taskDestination = [IO.Path]::GetFullPath((Join-Path $taskAiRoot $entry.RelativePath))
    $taskRootPrefix = $taskAiRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $taskDestination.StartsWith($taskRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Destination outside AI workspace: $taskDestination"
    }
    if ([string]::Equals([IO.Path]::GetFullPath($entry.Source), $taskDestination, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Source and destination must differ.'
    }
    $taskOriginalHash = (Get-FileHash -LiteralPath $entry.Source -Algorithm SHA256).Hash.ToLowerInvariant()
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskDestination) -Force | Out-Null
    Copy-Item -LiteralPath $entry.Source -Destination $taskDestination
    $taskCopiedHash = (Get-FileHash -LiteralPath $taskDestination -Algorithm SHA256).Hash.ToLowerInvariant()
    $taskCurrentSourceHash = (Get-FileHash -LiteralPath $entry.Source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($taskOriginalHash -ne $taskCopiedHash -or $taskOriginalHash -ne $taskCurrentSourceHash) {
        throw "Source changed during snapshot or copy mismatch: $($entry.Source)"
    }
    [PSCustomObject]@{
        relativePath = $entry.RelativePath
        sourcePath = $entry.Source
        kind = $entry.Kind
        bytes = (Get-Item -LiteralPath $taskDestination).Length
        sha256 = $taskCopiedHash
    }
}
$taskManifest = [ordered]@{
    format = 'vomkq-ai-source-snapshot-v1'
    preparedForDate = '2026-10-02'
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    implementationState = 'source-snapshot-and-plan-only'
    upstreamBackendPath = $taskSourceRoot
    coreCopiedUnmodified = $true
    snapshotMayContainUncommittedSource = $true
    upstreamEntrypointReadyForTarget = $false
    exclusions = @(
        'runtime binaries and virtual environments',
        'model/embedding/OCR weights',
        'source documents and builtin knowledge',
        'user databases, chat history, backups, keys and .env',
        'source tests depending on original builtin documents',
        'placement/ranking/advisor prompts and application behavior'
    )
    knownRelocationWork = @(
        'Explicit separate data_dir; upstream entrypoint defaults to original VECTOR_AI data',
        'Process identity/ownership and fixed port/CORS policy adaptation',
        'Explicit project knowledge loading instead of path-relative builtin imports',
        'Rich DOCX extraction helper adaptation and symbolic subprocess module paths',
        'Runtime dependencies and model assets require preparation and verification'
    )
    files = @($taskRecords)
}
$taskJson = $taskManifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($taskInventoryPath, $taskJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
[PSCustomObject]@{
    Workspace = $taskAiRoot
    SnapshotFiles = @($taskRecords).Count
    SourceBytes = ($taskRecords | Measure-Object bytes -Sum).Sum
    Manifest = $taskInventoryPath
} | ConvertTo-Json

