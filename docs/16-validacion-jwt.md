# 16. Validación del JWT en los microservicios

> Corresponde a las secciones 9, 11 y 12 del TP7. Parte 2 · Santiago Vicente.
> Decisiones D9, D13, D14 y D15 de [`14-modelo-seguridad.md`](./14-modelo-seguridad.md).

## 16.1 Quién emite, quién valida y qué usa cada uno (TP7 §12)

| Pregunta | Respuesta |
|---|---|
| ¿Qué componente emite los tokens? | Solo `auth-service`, en `POST /auth/login`, después de comparar la password contra el hash. No hay otro endpoint que entregue tokens (TP7 §7) |
| ¿Qué servicios validan tokens? | Catálogo, Inventario (los 3 nodos), Ventas y `auth-service` (para `/auth/me` y `/auth/usuarios`) |
| ¿Qué información del token usa cada uno? | Catálogo e Inventario: solo `role`. Ventas: `role` para el acceso y `sub` para la propiedad de la compra. Inventario también guarda el `sub` de quien ajusta stock. Nadie usa el email |
| ¿Cómo se comparte la configuración para verificar la firma? | `JWT_SECRET` y `JWT_ISSUER` llegan por variable de entorno, desde el `.env` de la raíz en Compose (D16). Ningún servicio consulta la base de usuarios ni llama a `auth-service` para validar |
| ¿Qué pasa si `auth-service` se cae con tokens ya emitidos? | Siguen funcionando hasta su `exp`, porque la verificación es local (D15). Solo fallan el login y el registro. Ver §16.6 |

**Principio (TP7 §12):** verificar un JWT firmado no requiere consultar la base de usuarios en cada
request. La autorización de negocio sí puede usar datos propios: Ventas compara el `sub` con el
`usuarioId` de **su** compra, en **su** base.

## 16.2 El middleware (TP7 §9)

Cada servicio tiene su copia en `src/middlewares/auth.js`. Las cuatro son iguales, y no se comparte
código entre servicios (regla del TP6). La de referencia está en
[`services/inventario/src/middlewares/auth.js`](../services/inventario/src/middlewares/auth.js).

```
Request
   |
   +-- sin header, o esquema distinto de Bearer ----> 401 "Token ausente"
   +-- token mal formado -----------------------------> 401 "Token inválido"
   +-- firma inválida (payload alterado, otra clave) -> 401 "Token inválido"
   +-- alg distinto de HS256 (incluido "none") -------> 401 "Token inválido"
   +-- iss distinto de "auth-service" ----------------> 401 "Token inválido"
   +-- sin sub, role o exp ---------------------------> 401 "Token inválido"
   +-- vencido ---------------------------------------> 401 "Token vencido"
   |
   +-- token válido ---> req.usuario = { id: sub, rol: role } ---> requerirRol(...)
                                                                     |
                                                  rol no alcanza ----+---> 403 "Permisos insuficientes"
                                                  rol permitido -----+---> controlador
```

| Pieza | Qué hace |
|---|---|
| `autenticar` | Lee `Authorization: Bearer <token>` y llama a `jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: 'auth-service' })`. Exige `sub`, `role` y `exp`. Si algo falla: `401` + `WWW-Authenticate: Bearer` |
| `requerirRol(...roles)` | Va **después** de `autenticar`. Si `req.usuario.rol` no está en la lista: `403` |
| Formato | `{ error, servicio }`, igual que el resto de los errores del TP6 (D14). Nunca el mensaje interno de la biblioteca ni el token |
| Logs | `warn` con `operacion`, `status` y `motivo` (401) o `usuarioId`, `rol` y `rolesPermitidos` (403). **El token no se loguea** |

Por qué estas reglas (TP7 §8.1):
- `algorithms: ['HS256']` fijo impide aceptar tokens sin firma (`alg: none`) o con otro algoritmo.
- `issuer` fijo impide aceptar un JWT firmado con la misma clave por otro emisor.
- Exigir `exp` impide tokens de vigencia indefinida (TP7 §8.2).

## 16.3 HS256 y el paso a RS256

Se usa HS256 (D9): una clave simétrica de al menos 32 caracteres, por entorno. Cada servicio arranca
solo si `JWT_SECRET` existe y tiene ese largo.

**Limitación conocida:** con HS256, todo servicio que puede verificar también podría firmar. Se
acepta porque los cuatro servicios son del mismo equipo y corren en la misma red. La ampliación es
**RS256**: `auth-service` firma con una clave privada que solo tiene él, y los demás verifican con la
pública. El código cambia en dos lugares: `algorithms: ['RS256']` y la clave pública en lugar de
`JWT_SECRET`. Queda como mejora posible (TP7 §8.1).

## 16.4 Inventario: roles, orden de los middlewares y reenvío al Leader

| Endpoint | Middlewares, en orden |
|---|---|
| `GET /stock` | — (público) |
| `PUT /stock/:productoId` | `autenticar` → `requerirRol('ADMIN')` → `soloEscrituraEnLeader` |
| `POST /descuentos` · `DELETE /descuentos/:referencia` | `autenticar` → `requerirRol('SERVICIO', 'ADMIN')` → `soloEscrituraEnLeader` |
| `GET /movimientos` | `autenticar` → `requerirRol('ADMIN')` |
| `GET /api/cluster/estado` | — (público) |
| `GET /api/cluster/log` | `autenticar` → `requerirRol('ADMIN')` |

**La autenticación va antes del reenvío al Leader (D1 del TP6).** Así:
1. Un follower rechaza con `401`/`403` sin reenviar nada.
2. Lo que sí se reenvía lleva el header `Authorization` original. El Leader **vuelve a validar** el
   token: no confía en que el follower ya lo hizo. Sin ese header, toda escritura que entrara por un
   follower daría `401` en el Leader.

**Trazabilidad (D13):** la State Machine guarda un `usuarioId` en cada movimiento y en cada descuento:

| Operación | `usuarioId` guardado |
|---|---|
| `PUT /stock` (`ALTA` / `AJUSTE`) | El `sub` del ADMIN que ajustó |
| `POST /descuentos` (`DESCUENTO`) | El `usuarioId` que manda Ventas: el cliente de la compra. Si no viene, el `sub` del token |
| `DELETE /descuentos/:referencia` (`REINTEGRO`) | El `sub` de quien pidió el reintegro (Ventas o un ADMIN) |

El dato viaja **dentro del comando Raft**: la State Machine sigue sin leer tokens ni hacer HTTP, y las
tres réplicas guardan lo mismo.

## 16.5 Propagación entre servicios (TP7 §13, D13)

```
Cliente --(Bearer token del CLIENTE)--> Ventas
                                          |  valida el token del cliente: role y sub
                                          |  C1 GET /productos?ids=...  (público, sin token) --> Catálogo
                                          |  C2 POST /descuentos
                                          |     Authorization: Bearer <token de SERVICIO de Ventas>
                                          |     body: { referencia, items, usuarioId: <sub del cliente> }
                                          v
                                      Inventario  valida el token de servicio (role SERVICIO) y
                                                  guarda el usuarioId en el descuento y los movimientos
```

El token del cliente **no** viaja a Inventario. Los motivos están en
[`14-modelo-seguridad.md`](./14-modelo-seguridad.md) §14.4: un cliente no tiene que poder mover stock
directamente, y el reintento de compensación de 30 s no tiene token de cliente. El detalle del lado
de Ventas (la cuenta técnica y la caché del token) está en `docs/17-propagacion-identidad.md`.

## 16.6 `auth-service` no disponible (D15)

| Situación | Resultado |
|---|---|
| Token emitido antes de la caída, todavía vigente | Catálogo, Inventario y Ventas lo aceptan: la verificación es local |
| Login o registro durante la caída | Error de conexión con `auth-service`: no hay tokens nuevos |
| El token vence durante la caída | `401 "Token vencido"`: hay que esperar a que vuelva `auth-service` para hacer login |
| Ventas con su token de servicio vencido | La compra responde `503` antes de descontar. El reintento de 30 s espera a la próxima vuelta |

Ningún servicio tiene `depends_on` hacia `auth-service` en `compose.yml`: su caída no impide que los
demás arranquen.

## 16.7 Pruebas

Los resultados están en [`18-pruebas-seguridad.md`](./18-pruebas-seguridad.md) (pruebas E a I, y el
detalle completo del middleware de Inventario).
