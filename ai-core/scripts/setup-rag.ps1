param(
    [string]$QdrantExe = "",
    [string]$EmbeddingModelPath = "",
    [string]$EmbeddingProfileId = "e5-small-local",
    [string]$EmbeddingProfileName = "Multilingual E5 Small (local)",
    [string]$EmbeddingRevision = "local-prepared",
    [ValidateRange(1, 65536)][int]$EmbeddingDimension = 384,
    [ValidateRange(32, 65536)][int]$EmbeddingMaxInputTokens = 512,
    [string]$QueryTemplate = "query: {text}",
    [string]$DocumentTemplate = "passage: {text}",
    [ValidateSet("cpu", "cuda")][string]$EmbeddingDevice = "cpu",
    [switch]$InstallEmbeddingRuntime
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendPython = Join-Path $ProjectRoot "backend\.venv\Scripts\python.exe"
$DataRoot = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "VECTOR_AI"
} else {
    Join-Path $env:USERPROFILE ".vector_ai"
}

if (-not (Test-Path -LiteralPath $BackendPython -PathType Leaf)) {
    throw "Chưa có môi trường Python Core. Hãy chạy RUN_VECTOR_AI.bat một lần trước."
}

if ($InstallEmbeddingRuntime) {
    Write-Host "[VECTOR AI] Cài adapter sentence-transformers theo yêu cầu của người dùng..."
    Push-Location (Join-Path $ProjectRoot "backend")
    try {
        & $BackendPython -m pip install -e ".[embedding]"
        if ($LASTEXITCODE -ne 0) { throw "Cài sentence-transformers thất bại." }
    } finally {
        Pop-Location
    }
}

if ($QdrantExe) {
    $ResolvedQdrant = (Resolve-Path -LiteralPath $QdrantExe).Path
    if ([IO.Path]::GetFileName($ResolvedQdrant) -ne "qdrant.exe") {
        throw "Tệp Qdrant phải có tên qdrant.exe."
    }
    $QdrantTarget = Join-Path $DataRoot "services\qdrant\qdrant.exe"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $QdrantTarget) | Out-Null
    Copy-Item -LiteralPath $ResolvedQdrant -Destination $QdrantTarget -Force
    Write-Host "[VECTOR AI] Đã chuẩn bị Qdrant: $QdrantTarget"
}

if ($EmbeddingModelPath) {
    $ResolvedModel = (Resolve-Path -LiteralPath $EmbeddingModelPath).Path
    if (-not (Test-Path -LiteralPath $ResolvedModel -PathType Container)) {
        throw "EmbeddingModelPath phải là thư mục model đã tải đầy đủ."
    }
    $ConfigDir = Join-Path $DataRoot "config"
    $ProfilePath = Join-Path $ConfigDir "embedding_profiles.json"
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    $Profiles = @()
    if (Test-Path -LiteralPath $ProfilePath -PathType Leaf) {
        $Loaded = Get-Content -LiteralPath $ProfilePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($Loaded) { $Profiles = @($Loaded) }
    }
    $Profiles = @($Profiles | Where-Object { $_.id -ne $EmbeddingProfileId })
    $Profiles += [ordered]@{
        id = $EmbeddingProfileId
        name = $EmbeddingProfileName
        provider = "sentence-transformers"
        model_path = $ResolvedModel
        model_revision = $EmbeddingRevision
        dimension = $EmbeddingDimension
        max_input_tokens = $EmbeddingMaxInputTokens
        query_template = $QueryTemplate
        document_template = $DocumentTemplate
        normalization = "l2"
        device = $EmbeddingDevice
        enabled = $true
        resources = @{ cpu_slots = 1; ram_mb = 768; gpu_mb = $(if ($EmbeddingDevice -eq "cuda") { 1024 } else { 0 }) }
    }
    [IO.File]::WriteAllText(
        $ProfilePath,
        (ConvertTo-Json -InputObject @($Profiles) -Depth 8),
        [Text.UTF8Encoding]::new($false)
    )
    Write-Host "[VECTOR AI] Đã lưu embedding profile: $EmbeddingProfileId"
    Write-Host "[VECTOR AI] Hãy khởi động lại app rồi tạo lại chỉ mục tài liệu."
}

if (-not $QdrantExe -and -not $EmbeddingModelPath -and -not $InstallEmbeddingRuntime) {
    Write-Host "Không có thay đổi. Script này không tự tải model hay dịch vụ."
    Write-Host "Ví dụ:"
    Write-Host '.\scripts\setup-rag.ps1 -QdrantExe "C:\Downloads\qdrant.exe"'
    Write-Host '.\scripts\setup-rag.ps1 -InstallEmbeddingRuntime -EmbeddingModelPath "C:\Models\multilingual-e5-small"'
}
