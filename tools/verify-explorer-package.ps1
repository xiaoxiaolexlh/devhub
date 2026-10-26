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
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop
$signature = Get-AuthenticodeSignature -LiteralPath $PackagePath
# Local self-signed test certificates need not be trusted during a file-only build.
# PowerShell also maps CERT_E_UNTRUSTEDROOT (0x800B0109) to UnknownError.
# Compare Windows' localized error text, rather than accepting all UnknownError results.
$untrustedRootMessage = [ComponentModel.Win32Exception]::new(-2146762487).Message.Trim()
$untrustedRoot = $signature.Status -eq 'UnknownError' -and $signature.StatusMessage.Trim() -eq $untrustedRootMessage
if (-not $signature.SignerCertificate -or
    ($signature.Status -notin @('Valid', 'NotTrusted') -and -not $untrustedRoot) -or
    $signature.SignerCertificate.Subject -ne $identity.Publisher) {
    throw 'Explorer MSIX signature is invalid or does not match the manifest publisher.'
}
