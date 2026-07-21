param(
    [int]$BatchSize = 32,
    [int]$Threads = 6
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$Python = Join-Path $RepoRoot ".tmp\difficulty-semantic-encoder-venv\Scripts\python.exe"
$ModelDirectory = Join-Path $RepoRoot ".tmp\difficulty-semantic-encoder-artifacts\multilingual-e5-small\614241f622f53c4eeff9890bdc4f31cfecc418b3"
$Dataset = Join-Path $RepoRoot "docs\routing\datasets\difficulty\data\initial-routing-difficulty-15000.jsonl"
$Output = Join-Path $RepoRoot "docs\routing\datasets\difficulty\data\initial-routing-difficulty-15000.semantic-dedup.json"
$Script = Join-Path $PSScriptRoot "semantic-dedup.py"

if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Offline E5 Python environment is missing: $Python"
}
if (-not (Test-Path -LiteralPath $ModelDirectory -PathType Container)) {
    throw "Pinned multilingual-E5 artifacts are missing: $ModelDirectory"
}

& $Python $Script `
    --dataset $Dataset `
    --output $Output `
    --model-directory $ModelDirectory `
    --batch-size $BatchSize `
    --block-size 256 `
    --threads $Threads

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
