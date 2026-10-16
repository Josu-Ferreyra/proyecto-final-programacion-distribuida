<#
Abre una ventana de PowerShell por nodo (nodo1, nodo2, nodo3), cada una con su
proceso independiente. Para simular la caida de un nodo basta con cerrar su ventana
(o Ctrl+C), y para reincorporarlo, volver a correr "npm run nodoX" en otra.

Uso:
  .\scripts\iniciar-cluster.ps1
  .\scripts\iniciar-cluster.ps1 -Nodos nodo1,nodo3
#>

param(
    [string[]]$Nodos = @('nodo1', 'nodo2', 'nodo3')
)

$raiz = Resolve-Path "$PSScriptRoot\.."

foreach ($nodo in $Nodos) {
    Start-Process powershell -WorkingDirectory $raiz -ArgumentList @(
        '-NoExit',
        '-Command',
        "`$Host.UI.RawUI.WindowTitle = 'TP4 - $nodo'; npm run $nodo"
    )
    Write-Host "Lanzado $nodo"
}
