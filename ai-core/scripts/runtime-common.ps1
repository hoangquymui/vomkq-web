Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ProjectRuntime([string]$ProjectRoot) {
    $runtime = Join-Path $ProjectRoot 'runtime'
    $pointer = Join-Path $runtime 'active.json'
    if (-not (Test-Path -LiteralPath $pointer -PathType Leaf)) { return $null }
    $config = Get-Content -LiteralPath $pointer -Raw -Encoding UTF8 | ConvertFrom-Json
    $relative = [string]$config.bundle
    if (-not $relative -or [IO.Path]::IsPathRooted($relative) -or @($relative -split '[\\/]' | Where-Object { $_ -in @('', '.', '..') }).Count) {
        throw 'runtime/active.json contains an unsafe bundle path.'
    }
    $resolved = [IO.Path]::GetFullPath((Join-Path $runtime $relative))
    $prefix = [IO.Path]::GetFullPath($runtime).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw 'The selected project runtime does not exist inside runtime/.'
    }
    return $resolved
}

function Copy-RuntimeDirectory([string]$Source, [string]$Destination, [string[]]$ExcludeDirs = @(), [string[]]$ExcludeFiles = @()) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Missing source directory: $Source" }
    $args = @($Source, $Destination, '/E', '/XJ', '/R:1', '/W:1', '/COPY:DAT', '/DCOPY:DAT', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
    if ($ExcludeDirs.Count) { $args += '/XD'; $args += $ExcludeDirs }
    if ($ExcludeFiles.Count) { $args += '/XF'; $args += $ExcludeFiles }
    & robocopy.exe @args | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copy failed ($LASTEXITCODE): $Source" }
}

function Write-RuntimeJson([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 12), [Text.UTF8Encoding]::new($false))
}
