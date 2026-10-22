<#
Levanta los nodos de Inventario en modo local (npm start), una ventana de PowerShell por
nodo. Todos usan el .env del servicio y CLUSTER_FILE=cluster.local.json; este script
solo pisa lo que distingue a cada nodo: RAFT_NODO_ID y MONGODB_URI (D2: una base por nodo).

Requisitos: MongoDB local en 27017, Memurai/Redis en 6379, Catálogo en 3100 y
`npm install` hecho en services/inventario.

Uso (desde services/inventario):
  .\scripts\iniciar-local.ps1                         # los 3 nodos
  .\scripts\iniciar-local.ps1 -Nodos inventario-2     # solo uno (por ejemplo, para reincorporarlo)
#>

param(
    [string[]]$Nodos = @('inventario-1', 'inventario-2', 'inventario-3'),
    [string]$MongoServer = 'mongodb://127.0.0.1:27017'
)

$raiz = Resolve-Path "$PSScriptRoot\.."

foreach ($nodo in $Nodos) {
    $numero = $nodo.Split('-')[-1]
    $comando = @(
        "`$Host.UI.RawUI.WindowTitle = 'Inventario - $nodo'",
        "`$env:RAFT_NODO_ID = '$nodo'",
        "`$env:CLUSTER_FILE = 'cluster.local.json'",
        "`$env:MONGODB_URI = '$MongoServer/inventario_nodo$numero'",
        'npm start'
    ) -join '; '
    Start-Process powershell -WorkingDirectory $raiz -ArgumentList @('-NoExit', '-Command', $comando)
    Write-Host "Lanzado $nodo"
}
