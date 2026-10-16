<#
Simula la CAIDA (crash) de un nodo: mata su proceso sin apagado ordenado, igual que
si se cortara la luz. Busca el proceso por el puerto interno de Raft del nodo.
Equivale a cerrar la ventana del nodo.

Uso:
  .\scripts\detener-nodo.ps1 -Nodo nodo1
#>

param(
    [Parameter(Mandatory = $true)][string]$Nodo
)

$config = Get-Content "$PSScriptRoot\..\cluster.json" -Raw | ConvertFrom-Json
$puerto = $config.nodos.$Nodo.raftPort
if (-not $puerto) { throw "Nodo '$Nodo' no existe en cluster.json" }

$conexion = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conexion) {
    Write-Host "$Nodo no esta corriendo (nadie escucha en el puerto $puerto)"
    exit 0
}

Stop-Process -Id $conexion.OwningProcess -Force
Write-Host "$Nodo detenido (PID $($conexion.OwningProcess), puerto Raft $puerto)"
