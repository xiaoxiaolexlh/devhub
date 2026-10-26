# File-only certificate operations; never opens or modifies a Windows certificate store.
# PowerShell 7 provides CertificateRequest and ephemeral PFX loading.
param(
    [Parameter(Mandatory = $true)][string]$CertificatePath,
    [Parameter(Mandatory = $true)][string]$PublicCertificatePath,
    [switch]$CreateTestCertificate
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Explorer certificate preparation requires PowerShell 7 (pwsh.exe).' }
$password = $env:DEVHUB_EXPLORER_CERTIFICATE_PASSWORD
if ($null -eq $password) { $password = '' }
if ($CreateTestCertificate -and -not (Test-Path -LiteralPath $CertificatePath)) {
    $rsa = [Security.Cryptography.RSA]::Create(3072)
    try {
        $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
            'CN=DevHub Local Development', $rsa,
            [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
            [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))
        $eku = [Security.Cryptography.OidCollection]::new()
        [void]$eku.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku, $true))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
        $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddYears(1))
        try {
            [IO.File]::WriteAllBytes($CertificatePath, $certificate.Export(
                [Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $password))
        } finally { $certificate.Dispose() }
    } finally { $rsa.Dispose() }
}
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $CertificatePath, $password,
    ([Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet -bor
     [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable))
try {
    if (-not $certificate.HasPrivateKey) { throw 'Explorer signing certificate has no private key.' }
    if ($certificate.NotBefore -gt [DateTime]::Now -or $certificate.NotAfter -le [DateTime]::Now) {
        throw 'Explorer signing certificate is not currently valid.'
    }
    if ($certificate.Subject -match 'OID\.2\.25\.') { throw 'A signed Explorer package must not use an unsigned publisher OID.' }
    [IO.File]::WriteAllBytes($PublicCertificatePath, $certificate.Export(
        [Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    [Console]::WriteLine($certificate.Subject)
} finally { $certificate.Dispose() }
