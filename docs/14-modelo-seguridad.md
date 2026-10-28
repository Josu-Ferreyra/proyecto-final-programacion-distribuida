# 14. Modelo de seguridad (Hito 1 del TP7)

> Corresponde a la sección 4 del TP7 (Hito 1: modelo de seguridad y clasificación de endpoints) y a
> las decisiones que la implementación necesita antes de empezar. Parte 2 · Santiago Vicente.
>
> Las decisiones siguen la numeración del TP6 (D1–D7 en [`08-ratificacion-tp6.md`](./08-ratificacion-tp6.md)):
> acá van de **D8 a D16**.

## 14.1 Qué identidad existe en el dominio

Hasta el TP6 cualquier cliente podía ejecutar cualquier operación: dar de alta productos, fijar el
stock o cancelar la compra de otro. El TP7 agrega identidad. En este dominio se autentican tres tipos
de actores:

| Actor | Qué hace | Rol |
|---|---|---|
| Cliente | Consulta la oferta, compra, consulta y cancela **sus** compras | `CLIENTE` |
| Administrador | Mantiene el catálogo y el stock, ve todas las compras, da de alta otros administradores | `ADMIN` |
| Ventas (cuenta técnica) | Pide a Inventario descontar y reintegrar stock en nombre de una compra | `SERVICIO` |

Qué necesita saber cada servicio de esa identidad:

| Servicio | Necesita | Para qué |
|---|---|---|
| Catálogo | `role` | Solo `ADMIN` modifica la oferta |
| Inventario | `role` | Solo `ADMIN` ajusta stock; solo `SERVICIO` o `ADMIN` descuentan y reintegran |
| Ventas | `role` y `sub` | El rol para comprar, y el `sub` para saber de quién es cada compra (regla de propiedad, TP7 §11.2) |
| `auth-service` | todo | Es el dueño de las identidades |

Nadie fuera de `auth-service` necesita el email ni ningún otro dato personal.

## 14.2 Componente responsable de identidad (TP7 §5)

| Alternativa | ¿Aplica? | Motivo |
|---|---|---|
| Integrar la autenticación en un `users-service` existente | No | La solución del TP6 no tiene un servicio de usuarios. Catálogo, Inventario y Ventas no son dueños de identidades: Ventas guarda compras, no personas |
| **Crear `auth-service`** | **Sí (elegida, D8)** | No hay un responsable natural de la identidad. Un servicio nuevo concentra las credenciales en un solo lugar, sin mezclarlas con las compras |

`auth-service` es **la única autoridad sobre las credenciales**: guarda los hashes, verifica las
passwords y emite los tokens. **No contiene reglas de negocio** de los otros servicios: no sabe qué es
un producto, un stock ni una compra. Ningún otro servicio consulta su base.

## 14.3 Matriz de acceso (TP7 §4 y §10)

| Servicio | Endpoint | Acceso | Roles | Justificación |
|---|---|---|---|---|
| auth | `POST /auth/register` | Público | — | Auto-registro de clientes. Siempre crea `CLIENTE`: el rol no lo elige quien se registra (D11) |
| auth | `POST /auth/login` | Público | — | Es la forma de obtener un token |
| auth | `GET /auth/me` | Autenticado | cualquiera | Ver la propia identidad, sin el hash |
| auth | `POST /auth/usuarios` | Restringido | `ADMIN` | Alta administrada de otros administradores (D11) |
| auth | `PATCH /auth/usuarios/:id` | Restringido | `ADMIN` | Habilitar o deshabilitar una cuenta (D12) |
| catálogo | `GET /productos`, `GET /productos/:id`, `GET /categorias` | Público | — | Mirar la oferta no requiere cuenta. Además, C1 (Ventas) y C4 (Inventario) los usan sin token |
| catálogo | `POST /productos`, `PUT /productos/:id`, `DELETE /productos/:id` | Restringido | `ADMIN` | Modifican la oferta y el precio |
| inventario | `GET /stock` | Público | — | La disponibilidad se muestra antes de comprar |
| inventario | `PUT /stock/:productoId` | Restringido | `ADMIN` | Alta y ajuste manual de stock |
| inventario | `POST /descuentos` (C2), `DELETE /descuentos/:referencia` (C3) | Restringido | `SERVICIO`, `ADMIN` | Solo Ventas mueve stock por compras. Un `CLIENTE` recibe 403: si pudiera llamarlos, descontaría stock salteando Ventas (D13) |
| inventario | `GET /movimientos` | Restringido | `ADMIN` | Historial administrativo, con el `usuarioId` de cada operación |
| inventario | `GET /api/cluster/estado` | Público | — | Diagnóstico del cluster (rol, término, commit): no expone datos de negocio. Lo usan `estado-cluster.js` y las pruebas de failover |
| inventario | `GET /api/cluster/log` | Restringido | `ADMIN` | Cada entrada del log contiene el comando, con productos, cantidades y `usuarioId` |
| inventario | `/raft/*` (puerto 4200) | Interno | — | RPC entre los nodos. El puerto no se publica fuera de la red de Compose: se protege por la red, no con JWT |
| ventas | `POST /compras` | Autenticado | `CLIENTE`, `ADMIN` | La compra queda a nombre del `sub` del token. La cuenta `SERVICIO` no compra |
| ventas | `GET /compras/:id` | Autenticado + propiedad | dueño o `ADMIN` | Un cliente no puede ver compras ajenas (TP7 §11.2): 403 |
| ventas | `PATCH /compras/:id/cancelar` | Autenticado + propiedad | dueño o `ADMIN` | Un cliente no puede cancelar compras ajenas: 403 |
| todos | `GET /health`, `/api-docs` | Público | — | Healthcheck de Compose y documentación. No exponen secretos |

**Criterio:** se protege lo que **modifica** datos administrados o expone datos de otra persona. Las
consultas de la oferta y de la disponibilidad siguen públicas porque el dominio lo pide: cualquiera
puede mirar qué se vende antes de crearse una cuenta (TP7 §10, "no proteger todo sin justificación").

### Resumen por rol (TP7 §11)

| Servicio | Endpoint | Público | CLIENTE | ADMIN | SERVICIO |
|---|---|---|---|---|---|
| Catálogo | `GET /productos` | Sí | Sí | Sí | Sí |
| Catálogo | `POST /productos` | No | No | Sí | No |
| Inventario | `GET /stock` | Sí | Sí | Sí | Sí |
| Inventario | `PUT /stock/:productoId` | No | No | Sí | No |
| Inventario | `POST /descuentos` | No | No | Sí | Sí |
| Inventario | `GET /movimientos` | No | No | Sí | No |
| Ventas | `POST /compras` | No | Sí | Sí | No |
| Ventas | `GET /compras/:id` | No | Solo las propias | Todas | No |
| auth | `POST /auth/usuarios` | No | No | Sí | No |
