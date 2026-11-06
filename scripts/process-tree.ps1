param(
    [ValidateSet('Inspect', 'Stop')][string]$Mode = 'Inspect',
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [string]$Started
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
if (-not $proc) { 'null'; exit 0 }
$stamp = $proc.CreationDate.ToUniversalTime().Ticks.ToString()
if ($Mode -eq 'Inspect') {
    @{ pid = $ProcessId; started = $stamp; parent = [int]$proc.ParentProcessId; command = $proc.CommandLine } | ConvertTo-Json -Compress
    exit 0
}
if (-not $Started -or $stamp -ne $Started) { throw 'Process identity changed; nothing stopped.' }
# Verify creation time before targeting this one tree. Never kill by executable name.
& "$env:SystemRoot\System32\taskkill.exe" /PID $ProcessId /T /F | Out-Null
if ($LASTEXITCODE -ne 0) {
    $remaining = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
    if ($remaining -and $remaining.CreationDate.ToUniversalTime().Ticks.ToString() -eq $Started) { throw 'Could not stop this process tree.' }
}
'true'
