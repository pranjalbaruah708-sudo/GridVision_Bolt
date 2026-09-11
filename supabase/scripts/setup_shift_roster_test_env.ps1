# Temporary local setup helper. Dot-source this file so its environment values
# remain in the current PowerShell session. It never prints credential values.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$developmentUrl = 'https://eetlzxntgvjompmipprb.supabase.co'
$developmentRef = 'eetlzxntgvjompmipprb'
$developmentConfirmation = 'I_CONFIRM_THIS_IS_THE_GRIDVISION_DEVELOPMENT_PROJECT'

function Require-EnvironmentValue {
  param([Parameter(Mandatory)][string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing environment variable $Name."
  }
  return $value
}

function Set-FromStage2IfMissing {
  param(
    [Parameter(Mandatory)][string]$Target,
    [Parameter(Mandatory)][string]$Source
  )
  $targetValue = [Environment]::GetEnvironmentVariable($Target, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($targetValue)) { return }
  $sourceValue = [Environment]::GetEnvironmentVariable($Source, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($sourceValue)) {
    [Environment]::SetEnvironmentVariable($Target, $sourceValue, 'Process')
  }
}

function Get-GridVisionRole {
  param(
    [Parameter(Mandatory)][string]$AccessToken,
    [Parameter(Mandatory)][string]$AnonKey
  )
  try {
    $response = Invoke-RestMethod -Method Post -Uri "$developmentUrl/rest/v1/rpc/get_my_role" -Headers @{
      apikey = $AnonKey
      Authorization = "Bearer $AccessToken"
      'Content-Type' = 'application/json'
    } -Body '{}'
    return [string]$response
  } catch {
    throw 'Could not verify a supplied test actor role.'
  }
}

function Confirm-SupabaseAuthUser {
  param(
    [Parameter(Mandatory)][string]$AccessToken,
    [Parameter(Mandatory)][string]$AnonKey
  )
  try {
    Invoke-WebRequest -Method Get -Uri "$developmentUrl/auth/v1/user" -Headers @{
      apikey = $AnonKey
      Authorization = "Bearer $AccessToken"
    } | Out-Null
  } catch {
    $status = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $status = [int]$_.Exception.Response.StatusCode
    }
    if ($null -ne $status) { throw "Supabase Auth could not resolve a supplied test actor. Status: $status." }
    throw 'Supabase Auth could not resolve a supplied test actor.'
  }
}

function Set-ActorTokenForRole {
  param(
    [Parameter(Mandatory)][string]$Target,
    [Parameter(Mandatory)][string[]]$AcceptedRoles,
    [Parameter(Mandatory)][string]$AnonKey,
    [Parameter(Mandatory)][hashtable]$UsedTokens
  )
  $current = [Environment]::GetEnvironmentVariable($Target, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($current)) {
    $role = Get-GridVisionRole -AccessToken $current -AnonKey $AnonKey
    if ($AcceptedRoles -notcontains $role) { throw "Missing environment variable $Target." }
    Confirm-SupabaseAuthUser -AccessToken $current -AnonKey $AnonKey
    $UsedTokens[$current] = $true
    return 'preconfigured Stage 4 token'
  }

  foreach ($source in @(
    'SHIFT_TEST_ACTOR_A_ACCESS_TOKEN',
    'SHIFT_TEST_ACTOR_B_ACCESS_TOKEN',
    'SHIFT_TEST_ACTOR_C_ACCESS_TOKEN'
  )) {
    $candidate = [Environment]::GetEnvironmentVariable($source, 'Process')
    if ([string]::IsNullOrWhiteSpace($candidate) -or $UsedTokens.ContainsKey($candidate)) { continue }
    $role = Get-GridVisionRole -AccessToken $candidate -AnonKey $AnonKey
    if ($AcceptedRoles -contains $role) {
      Confirm-SupabaseAuthUser -AccessToken $candidate -AnonKey $AnonKey
      [Environment]::SetEnvironmentVariable($Target, $candidate, 'Process')
      $UsedTokens[$candidate] = $true
      return $source
    }
  }

  throw "Missing environment variable $Target."
}

[Environment]::SetEnvironmentVariable('SHIFT_ROSTER_TEST_SUPABASE_URL', $developmentUrl, 'Process')
[Environment]::SetEnvironmentVariable('SHIFT_ROSTER_TEST_ALLOWED_PROJECT_REF', $developmentRef, 'Process')
[Environment]::SetEnvironmentVariable('SHIFT_ROSTER_TEST_NON_PRODUCTION_CONFIRMATION', $developmentConfirmation, 'Process')

Set-FromStage2IfMissing -Target 'SHIFT_ROSTER_TEST_ANON_KEY' -Source 'SHIFT_TEST_ANON_KEY'
Set-FromStage2IfMissing -Target 'SHIFT_ROSTER_TEST_SERVICE_ROLE_KEY' -Source 'SHIFT_TEST_SERVICE_ROLE_KEY'
$anonKey = Require-EnvironmentValue 'SHIFT_ROSTER_TEST_ANON_KEY'
Require-EnvironmentValue 'SHIFT_ROSTER_TEST_SERVICE_ROLE_KEY' | Out-Null

$usedTokens = @{}
$plannerSource = Set-ActorTokenForRole -Target 'SHIFT_ROSTER_TEST_FIELD_OFFICER_ACCESS_TOKEN' -AcceptedRoles @('FIELD_OFFICER') -AnonKey $anonKey -UsedTokens $usedTokens
$operatorSource = Set-ActorTokenForRole -Target 'SHIFT_ROSTER_TEST_OPERATOR_ACCESS_TOKEN' -AcceptedRoles @('OPERATOR') -AnonKey $anonKey -UsedTokens $usedTokens
$adminSource = Set-ActorTokenForRole -Target 'SHIFT_ROSTER_TEST_ADMIN_ACCESS_TOKEN' -AcceptedRoles @('ADMIN', 'SUPER_ADMIN') -AnonKey $anonKey -UsedTokens $usedTokens

Write-Host '[READY] Supabase URL'
Write-Host '[READY] Project guard'
Write-Host '[READY] Anon key'
Write-Host '[READY] Service role key'
Write-Host "[READY] Planner actor token ($plannerSource)"
Write-Host "[READY] Operator actor token ($operatorSource)"
Write-Host "[READY] Admin actor token ($adminSource)"
