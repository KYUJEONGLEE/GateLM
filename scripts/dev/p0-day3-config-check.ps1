param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
)

$ErrorActionPreference = "Stop"

function Assert-Equal {
  param(
    [string]$Name,
    [object]$Actual,
    [object]$Expected
  )

  if ($Actual -ne $Expected) {
    throw "$Name mismatch. expected=[$Expected], actual=[$Actual]"
  }

  Write-Host "[OK] $Name = $Actual"
}

function Assert-Contains {
  param(
    [string]$Name,
    [object[]]$Actual,
    [object]$Expected
  )

  if ($Actual -notcontains $Expected) {
    throw "$Name does not contain [$Expected]. actual=[$($Actual -join ', ')]"
  }

  Write-Host "[OK] $Name contains $Expected"
}

$fixturePath = Join-Path $Root "docs/archive/p0/a-day1-active-config.fixture.json"
$cacheKeyPath = Join-Path $Root "apps/gateway-core/internal/domain/cache/cache_key.go"
$testMatrixPath = Join-Path $Root "docs/archive/p0/p0-test-matrix.md"

if (-not (Test-Path -LiteralPath $fixturePath)) {
  throw "fixture not found: $fixturePath"
}
if (-not (Test-Path -LiteralPath $cacheKeyPath)) {
  throw "cache key source not found: $cacheKeyPath"
}
if (-not (Test-Path -LiteralPath $testMatrixPath)) {
  throw "test matrix not found: $testMatrixPath"
}

$fixture = Get-Content -LiteralPath $fixturePath -Raw -Encoding UTF8 | ConvertFrom-Json

Write-Host "Checking Day3 runtime config..."

Assert-Equal "securityPolicyHash" $fixture.policies.security.securityPolicyHash "sec_p0_v1"
Assert-Equal "routingPolicyHash" $fixture.policies.routing.routingPolicyHash "route_p0_v1"
Assert-Equal "cachePolicyHash" $fixture.policies.cache.cachePolicyHash "cache_p0_v1"
Assert-Equal "defaultProvider" $fixture.policies.routing.defaultProvider "mock"
Assert-Equal "defaultModel" $fixture.policies.routing.defaultModel "mock-balanced"
Assert-Equal "lowCostModel" $fixture.policies.routing.lowCostModel "mock-fast"
Assert-Equal "highQualityModel" $fixture.policies.routing.highQualityModel "mock-smart"
Assert-Equal "cacheMode" $fixture.policies.cache.mode "exact_only"
Assert-Equal "exactCacheEnabled" $fixture.policies.cache.exactCacheEnabled $true
Assert-Equal "semanticCacheEnabled" $fixture.policies.cache.semanticCacheEnabled $false
Assert-Equal "cache ttlSeconds" $fixture.policies.cache.ttlSeconds 3600

$models = @($fixture.modelCatalog | ForEach-Object { $_.model })
Assert-Contains "modelCatalog" $models "mock-fast"
Assert-Contains "modelCatalog" $models "mock-balanced"
Assert-Contains "modelCatalog" $models "mock-smart"

$redactTypes = @($fixture.policies.security.redactTypes)
Assert-Contains "redactTypes" $redactTypes "person_name"
Assert-Contains "redactTypes" $redactTypes "email"
Assert-Contains "redactTypes" $redactTypes "phone_number"

$blockTypes = @($fixture.policies.security.blockTypes)
Assert-Contains "blockTypes" $blockTypes "resident_registration_number"
Assert-Contains "blockTypes" $blockTypes "api_key"
Assert-Contains "blockTypes" $blockTypes "authorization_header"
Assert-Contains "blockTypes" $blockTypes "jwt"
Assert-Contains "blockTypes" $blockTypes "private_key"

$rules = @($fixture.policies.routing.rules)
$shortRule = $rules | Where-Object { $_.reasonCode -eq "short_prompt_low_cost" } | Select-Object -First 1
if ($null -eq $shortRule) {
  throw "routing rule short_prompt_low_cost not found"
}
Assert-Equal "short prompt selectedModel" $shortRule.selectedModel "mock-fast"

$defaultRule = $rules | Where-Object { $_.reasonCode -eq "default_balanced" } | Select-Object -First 1
if ($null -eq $defaultRule) {
  throw "routing rule default_balanced not found"
}
Assert-Equal "default selectedModel" $defaultRule.selectedModel "mock-balanced"

$keyMaterial = @($fixture.policies.cache.keyMaterial)
foreach ($required in @(
  "tenantId",
  "projectId",
  "applicationId",
  "selectedProvider",
  "selectedModel",
  "normalizedRedactedPrompt",
  "securityPolicyVersionId",
  "routingPolicyVersionId",
  "cachePolicyHash",
  "requestParamsHash"
)) {
  Assert-Contains "cache keyMaterial" $keyMaterial $required
}

$cacheKeySource = Get-Content -LiteralPath $cacheKeyPath -Raw -Encoding UTF8
if ($cacheKeySource -notmatch 'ExactKeyMaterialVersion\s*=\s*"p0-exact-v2"') {
  throw "ExactKeyMaterialVersion must be p0-exact-v2"
}
Write-Host "[OK] ExactKeyMaterialVersion = p0-exact-v2"

if ($cacheKeySource -notmatch 'SecurityPolicyVersionID\s+string\s+`json:"securityPolicyVersionId"`') {
  throw "KeyMaterial must expose json tag securityPolicyVersionId"
}
Write-Host "[OK] KeyMaterial JSON tag securityPolicyVersionId exists"

if ($cacheKeySource -notmatch 'RoutingPolicyVersionID\s+string\s+`json:"routingPolicyVersionId"`') {
  throw "KeyMaterial must expose json tag routingPolicyVersionId"
}
Write-Host "[OK] KeyMaterial JSON tag routingPolicyVersionId exists"

if ($cacheKeySource -notmatch 'RequestParamsHash\s+string\s+`json:"requestParamsHash"`') {
  throw "KeyMaterial must expose json tag requestParamsHash"
}
Write-Host "[OK] KeyMaterial JSON tag requestParamsHash exists"

$testMatrix = Get-Content -LiteralPath $testMatrixPath -Raw -Encoding UTF8
if ($testMatrix -notmatch "short_prompt_low_cost") {
  throw "p0-test-matrix must use routingReason=short_prompt_low_cost"
}
Write-Host "[OK] p0-test-matrix uses short_prompt_low_cost"

Write-Host "Day3 runtime config check passed."
