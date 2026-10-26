# All Appx commands below are mocks; this test never registers Windows packages.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path $root 'src-tauri\target\explorer\management-fixture'
$resources = Join-Path $fixture 'resources\explorer'
New-Item -ItemType Directory -Force -Path $resources | Out-Null
Set-Content -LiteralPath (Join-Path $fixture 'devhub.exe') -Value 'test fixture only'
foreach ($name in @('manage.ps1', 'DevHub.ContextMenu.msix', 'devhub-explorer.dll')) {
    Copy-Item -LiteralPath (Join-Path $root "src-tauri\resources\explorer\$name") -Destination $resources -Force
}
$manage = Join-Path $resources 'manage.ps1'
$global:DevHubExplorerTestState = @{}
$global:DevHubExplorerTestState.foreignPackage = [pscustomobject]@{ Name = 'Another.App'; PackageFullName = 'Another.App_1.0' }
$global:DevHubExplorerTestState.devhubPackage = [pscustomobject]@{ Name = 'DevHub.ExplorerContextMenu'; PackageFullName = 'DevHub.ExplorerContextMenu_0.4.1' }
$global:DevHubExplorerTestState.registeredPackages = @($global:DevHubExplorerTestState.foreignPackage)
$global:DevHubExplorerTestState.addCalls = 0
$global:DevHubExplorerTestState.removeCalls = 0

function Get-AppxPackage {
    param([string]$Name)
    if ($Name -ne 'DevHub.ExplorerContextMenu') { throw 'Unexpected package query.' }
    # Deliberately return a foreign package to exercise the exact-name guard.
    $global:DevHubExplorerTestState.registeredPackages
}
function Add-AppxPackage {
    param([string]$Path, [string]$ExternalLocation, [switch]$AllowUnsigned, [string]$ErrorAction)
    if ($ExternalLocation -ne $fixture -or -not $AllowUnsigned -or
        $Path -ne (Join-Path $resources 'DevHub.ContextMenu.msix') -or $ErrorAction -ne 'Stop') {
        throw 'Unexpected install arguments.'
    }
    $global:DevHubExplorerTestState.addCalls++
    $global:DevHubExplorerTestState.registeredPackages += $global:DevHubExplorerTestState.devhubPackage
}
function Remove-AppxPackage {
    param([string]$Package, [string]$ErrorAction)
    if ($Package -ne $global:DevHubExplorerTestState.devhubPackage.PackageFullName -or $ErrorAction -ne 'Stop') {
        throw 'Removal escaped the DevHub package scope.'
    }
    $global:DevHubExplorerTestState.removeCalls++
    $global:DevHubExplorerTestState.registeredPackages = @($global:DevHubExplorerTestState.registeredPackages | Where-Object { $_.PackageFullName -ne $Package })
}
function Assert([bool]$condition, [string]$description) {
    if (-not $condition) { throw "Failed: $description" }
}

$status = (& $manage -Action status -AppDirectory $fixture) | ConvertFrom-Json
Assert (-not $status.installed -and $status.available) 'initial status'
Assert ($global:DevHubExplorerTestState.addCalls -eq 0 -and $global:DevHubExplorerTestState.removeCalls -eq 0) 'status must be read-only'
$status = (& $manage -Action install -AppDirectory $fixture) | ConvertFrom-Json
Assert ($status.installed -and $global:DevHubExplorerTestState.addCalls -eq 1) 'install'
$status = (& $manage -Action install -AppDirectory $fixture) | ConvertFrom-Json
Assert ($status.installed -and $global:DevHubExplorerTestState.addCalls -eq 2 -and $global:DevHubExplorerTestState.removeCalls -eq 1) 're-register'
$status = (& $manage -Action uninstall -AppDirectory $fixture) | ConvertFrom-Json
Assert (-not $status.installed -and $global:DevHubExplorerTestState.removeCalls -eq 2) 'uninstall'
$status = (& $manage -Action uninstall -AppDirectory $fixture) | ConvertFrom-Json
Assert (-not $status.installed -and $global:DevHubExplorerTestState.removeCalls -eq 2) 'idempotent uninstall'
Assert ($global:DevHubExplorerTestState.registeredPackages.Count -eq 1 -and $global:DevHubExplorerTestState.registeredPackages[0].Name -eq 'Another.App') 'foreign package preserved'
Write-Output 'Explorer management passed: status/install/re-register/uninstall, exact package scope; all Appx operations mocked.'
