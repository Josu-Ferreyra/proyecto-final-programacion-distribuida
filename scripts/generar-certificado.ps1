<#
Genera un certificado autofirmado (X509) para desarrollo local y lo exporta
como .pfx para que server.js lo use con HTTPS.

Uso (la clave la elige cada uno y no se versiona):
  .\scripts\generar-certificado.ps1 -Password "unaClaveLocal"
#>

param(
    [Parameter(Mandatory = $true)][string]$Password,
    [string]$OutputPath = "$PSScriptRoot\..\certs\server.pfx",
    [string]$DnsName = "localhost",
    [int]$ValidDays = 825
)

$certsDir = Split-Path -Parent $OutputPath
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir -Force | Out-Null
}

Write-Host "Generando certificado autofirmado para '$DnsName'..."

$cert = New-SelfSignedCertificate `
    -DnsName $DnsName `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddDays($ValidDays) `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -Type SSLServerAuthentication

$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText

Export-PfxCertificate -Cert $cert -FilePath $OutputPath -Password $securePassword | Out-Null

# Ya exportado a disco; no hace falta dejarlo instalado en el almacén de certificados del usuario.
Remove-Item -Path $cert.PSPath -Force

Write-Host "Certificado exportado a: $OutputPath"
Write-Host "Configura en tu .env:"
Write-Host "  SSL_PFX_PATH=$OutputPath"
Write-Host "  SSL_PASSPHRASE=$Password"
Write-Host ""
Write-Host "Es autofirmado: los clientes (curl, navegador, Postman) van a advertir que no confian en el emisor. Es esperado en un entorno de desarrollo local."