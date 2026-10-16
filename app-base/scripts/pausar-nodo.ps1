<#
Congela un nodo durante N segundos (suspende su proceso) y despues lo reanuda.
Mientras esta congelado no responde ni envia nada, pero conserva su memoria: al
reanudarse cree seguir siendo lo que era. Sirve para ver que un Leader "viejo", al
volver, descubre un termino mayor, pasa a FOLLOWER y deja de enviar heartbeats.

Uso:
  .\scripts\pausar-nodo.ps1 -Nodo nodo1 -Segundos 12
#>

param(
    [Parameter(Mandatory = $true)][string]$Nodo,
    [int]$Segundos = 12
)

Add-Type -Namespace Tp4 -Name Proceso -MemberDefinition @'
[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
[DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);
'@

$config = Get-Content "$PSScriptRoot\..\cluster.json" -Raw | ConvertFrom-Json
$puerto = $config.nodos.$Nodo.raftPort
if (-not $puerto) { throw "Nodo '$Nodo' no existe en cluster.json" }

$conexion = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conexion) { throw "$Nodo no esta corriendo" }

$proceso = Get-Process -Id $conexion.OwningProcess
[Tp4.Proceso]::NtSuspendProcess($proceso.Handle) | Out-Null
Write-Host "$(Get-Date -Format HH:mm:ss) $Nodo congelado (PID $($proceso.Id)) por $Segundos s"
Start-Sleep -Seconds $Segundos
[Tp4.Proceso]::NtResumeProcess($proceso.Handle) | Out-Null
Write-Host "$(Get-Date -Format HH:mm:ss) $Nodo reanudado"
