param(
    [Parameter(Mandatory = $true)][string]$Project,
    [int]$Port = 0,
    [string]$CodexPath,
    [string]$NodePath
)
$ErrorActionPreference = 'Stop'
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($account -match '\\CodexSandbox' -or $env:CODEX_SANDBOX_NETWORK_DISABLED -eq '1') {
    throw 'Start this script in your regular user PowerShell, outside the Codex sandbox. Do not change global sandbox settings.'
}
$node = if ($NodePath) { (Resolve-Path -LiteralPath $NodePath).Path } else { (Get-Command node.exe -ErrorAction Stop).Source }
$game = (Resolve-Path -LiteralPath $Project).Path
$previousCodex = $env:GFK_CODEX_PATH
try {
    if ($CodexPath) { $env:GFK_CODEX_PATH = (Resolve-Path -LiteralPath $CodexPath).Path }
    & $node (Join-Path $PSScriptRoot 'codex-runtime.cjs')
    $serverArgs = @((Join-Path $PSScriptRoot 'project.cjs'), $game)
    if ($Port) { $serverArgs += @('--port', "$Port") }
    & $node @serverArgs
} finally { $env:GFK_CODEX_PATH = $previousCodex }
