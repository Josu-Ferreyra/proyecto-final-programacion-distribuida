# Proyecto final — Programación Distribuida

Repositorio único del grupo para los trabajos prácticos a partir del TP5. En el TP5 se
parte de una API REST existente (el TP4: API de productos replicada con Raft) y se
analiza cómo descomponerla en microservicios: inventario de la aplicación actual,
responsabilidades, acoplamientos, propuesta de servicios, propiedad de los datos,
comunicaciones y diagrama de arquitectura.

Repositorio: <https://github.com/Josu-Ferreyra/proyecto-final-programacion-distribuida>

## Integrantes

| Nombre y apellido | Usuario GitHub | Parte del TP5 |
|---|---|---|
| Matías Porcari | [@matiasporcari](https://github.com/matiasporcari) | 1 · Repositorio, base e inventario |

> Cada integrante se agrega a esta tabla con su propio Pull Request
> (rama `docs/integrante-<nombre>`).

## Punto de partida

La aplicación base es el **TP4 de Santiago Vicente**: un cluster de 3 nodos con una
implementación educativa de Raft sobre la API de productos (MongoDB, Redis/Memurai,
HTTPS, Winston y Swagger). Se eligió por ser la versión más completa: instala y arranca
sin errores, todos sus endpoints funcionan y es la que más reglas de negocio tiene para
analizar.

El código está en [`app-base/`](app-base/), sin modificaciones respecto de la entrega
del TP4. Cómo instalarla y ejecutarla: [`app-base/README.md`](app-base/README.md).

## Estructura del repositorio

```
├── README.md          ← este archivo
├── .gitignore
├── .github/
│   └── pull_request_template.md
├── app-base/          ← API REST del TP anterior (punto de partida)
├── services/          ← reservado para los microservicios (TP6 en adelante)
└── docs/              ← documentación de arquitectura del TP5
```
