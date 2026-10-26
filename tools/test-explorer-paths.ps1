# Regression for the real Windows PowerShell 5.1 -File boundary, not an in-process call.
# Only queries Appx status. Never installs a package or launches DevHub.
param([string]$ManageScript)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $ManageScript) { $ManageScript = Join-Path $root 'src-tauri\explorer\manage.ps1' }
$testName = 'DevHub [space] & ' + [char]0x4E2D + [char]0x6587
$fixture = Join-Path (Join-Path $root 'src-tauri\target\explorer\path-tests') $testName
$resources = Join-Path $fixture 'resources\explorer'
New-Item -ItemType Directory -Force -Path $resources | Out-Null
foreach ($path in @((Join-Path $fixture 'devhub.exe'), (Join-Path $resources 'devhub-explorer.dll'), (Join-Path $resources 'DevHub.ContextMenu.msix'))) {
    [IO.File]::WriteAllText($path, 'Status test fixture; never executed or installed.')
}
$scriptPath = Join-Path $resources 'manage.ps1'
Copy-Item -LiteralPath $ManageScript -Destination $scriptPath -Force
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# Exercise UNC conversion without requiring a network share. Load only the actual
# helper's function declaration, not the management script's executable body.
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($ManageScript, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Management script has syntax errors.' }
$helper = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'ConvertTo-ExplorerPath' }, $false)
if ($helper) {
    . ([scriptblock]::Create($helper.Extent.Text))
    foreach ($case in @(
        @('\\?\UNC\server\share\DevHub', '\\server\share\DevHub'),
        @('\\?\unc\server\share\DevHub', '\\server\share\DevHub'),
        @('\\server\share\DevHub', '\\server\share\DevHub'),
        @('\\?\C:\', 'C:\')
    )) {
        if ((ConvertTo-ExplorerPath $case[0]) -cne $case[1]) { throw 'Windows path normalization failed.' }
    }
}

foreach ($case in @(
    @{ Name = 'ordinary paths'; Script = $scriptPath; App = $fixture },
    @{ Name = 'canonical script path (Tauri resource_dir)'; Script = '\\?\' + $scriptPath; App = $fixture },
    @{ Name = 'canonical application directory'; Script = $scriptPath; App = '\\?\' + $fixture },
    @{ Name = 'both canonical paths'; Script = '\\?\' + $scriptPath; App = '\\?\' + $fixture }
)) {
    $result = & $powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $case.Script -Action status -AppDirectory $case.App
    if ($LASTEXITCODE -ne 0) { throw "Status query failed: $($case.Name)" }
    $status = $result | ConvertFrom-Json
    if (-not $status.available) { throw "Resource lookup failed: $($case.Name)" }
    Write-Output "Passed: $($case.Name)"
}
Write-Output 'Explorer path regression passed with real Windows PowerShell 5.1; status queries only.'
