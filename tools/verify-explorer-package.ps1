param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($PackagePath)
try {
    if (-not $zip.GetEntry('AppxSignature.p7x')) { throw 'Expected a signed Explorer MSIX package.' }
    $reader = [IO.StreamReader]::new($zip.GetEntry('AppxManifest.xml').Open())
    try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $identity = $manifest.Package.Identity
    if ($identity.Name -ne 'DevHub.ExplorerContextMenu' -or $identity.Version -ne $ExpectedVersion -or
        $identity.ProcessorArchitecture -ne 'x64' -or $identity.Publisher -match 'OID\.2\.25\.') {
        throw 'Signed Explorer package identity, version, architecture or publisher does not match this build.'
    }
} finally { $zip.Dispose() }
