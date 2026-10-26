param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('status', 'install', 'uninstall')][string]$Action,
    [Parameter(Mandatory = $true)][string]$AppDirectory
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$packageName = 'DevHub.ExplorerContextMenu'

# Tauri canonicalizes the resource path, so -File can receive \\?\C:\...
# Windows PowerShell 5.1 runs that script but Join-Path cannot resolve its drive.
# Normalize both script and application directories before using PS/Appx APIs.
function ConvertTo-ExplorerPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ($Path.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) {
        return '\\' + $Path.Substring(8)
    }
    if ($Path.StartsWith('\\?\', [StringComparison]::Ordinal)) {
        return $Path.Substring(4)
    }
    return $Path
}

try {
    $resourceDirectory = ConvertTo-ExplorerPath $PSScriptRoot
    $AppDirectory = ConvertTo-ExplorerPath $AppDirectory
    $supported = [Environment]::OSVersion.Version.Build -ge 22000 -and [Environment]::Is64BitOperatingSystem
    $packagePath = Join-Path $resourceDirectory 'DevHub.ContextMenu.msix'
    $dllPath = Join-Path $resourceDirectory 'devhub-explorer.dll'
    $exePath = Join-Path $AppDirectory 'devhub.exe'
    $available = (Test-Path -LiteralPath $packagePath -PathType Leaf) -and
        (Test-Path -LiteralPath $dllPath -PathType Leaf) -and (Test-Path -LiteralPath $exePath -PathType Leaf)

    # Restrict all operations to this package for the current Windows user.
    $packages = @(Get-AppxPackage -Name $packageName | Where-Object { $_.Name -eq $packageName })
    if ($Action -eq 'install') {
        if (-not $supported) { throw 'This menu requires Windows 11 x64.' }
        if (-not $available) { throw 'Explorer extension resources or devhub.exe are missing. Rebuild/reinstall DevHub.' }
        # Read the publisher so a signed production package never uses AllowUnsigned.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($packagePath)
        try {
            $reader = [IO.StreamReader]::new($zip.GetEntry('AppxManifest.xml').Open())
            try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $unsigned = $manifest.Package.Identity.Publisher -match 'OID\.2\.25\.311729368913984317654407730594956997722=1'
        } finally { $zip.Dispose() }
        # The same sparse package version may have a different external location
        # (portable app moved, or switching from development to an installed app).
        foreach ($package in $packages) {
            Remove-AppxPackage -Package $package.PackageFullName -ErrorAction Stop
        }
        $options = @{ Path = $packagePath; ExternalLocation = $AppDirectory; ErrorAction = 'Stop' }
        if ($unsigned) { $options.AllowUnsigned = $true }
        Add-AppxPackage @options
    } elseif ($Action -eq 'uninstall') {
        foreach ($package in $packages) {
            Remove-AppxPackage -Package $package.PackageFullName -ErrorAction Stop
        }
    }

    $packages = @(Get-AppxPackage -Name $packageName | Where-Object { $_.Name -eq $packageName })
    if ($Action -eq 'install' -and $packages.Count -eq 0) { throw 'Windows did not register the context menu package.' }
    if ($Action -eq 'uninstall' -and $packages.Count -ne 0) { throw 'Windows did not remove the context menu package.' }
    [ordered]@{
        supported = $supported
        available = $available
        installed = $packages.Count -gt 0
    } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
