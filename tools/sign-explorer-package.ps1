$ErrorActionPreference = 'Stop'
$arguments = @('sign', '/fd', 'SHA256', '/f', $env:DEVHUB_EXPLORER_CERTIFICATE)
if ($env:DEVHUB_EXPLORER_CERTIFICATE_PASSWORD) { $arguments += @('/p', $env:DEVHUB_EXPLORER_CERTIFICATE_PASSWORD) }
$arguments += $env:DEVHUB_EXPLORER_PACKAGE
# Capture errors so PowerShell cannot print the invocation with a PFX password.
$output = & $env:DEVHUB_EXPLORER_SIGNTOOL @arguments 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Explorer MSIX signing failed. Check the PFX password, certificate subject and Windows SDK.' }
$output | Write-Output
