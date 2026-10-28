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

## 14.4 Decisiones D8–D16

| # | Tema | Decisión | Alternativa descartada y por qué |
|---|---|---|---|
| D8 | Responsable de identidad | Nuevo `auth-service` (puerto 3400, base propia `auth-db`, colección `usuarios`) | Credenciales en Ventas: mezclaría identidad con compras, y Catálogo e Inventario dependerían de Ventas para autenticar |
| D9 | Firma del JWT | **HS256** con `JWT_SECRET` (≥ 32 bytes aleatorios) por variable de entorno, igual en los 4 servicios. Al verificar: `algorithms: ['HS256']`, `issuer: 'auth-service'` y `exp` obligatorio. Biblioteca `jsonwebtoken` | **RS256** (firma con clave privada en `auth-service`, verificación con la pública). Es más seguro porque los servicios no pueden firmar, pero suma manejo de claves; queda documentado como ampliación posible (TP7 §8.1) |
| D10 | Roles | `CLIENTE`, `ADMIN` y `SERVICIO`, uno por usuario, en el claim `role` | Lista de permisos finos: el dominio tiene pocas operaciones y tres perfiles claros alcanzan |
| D11 | Alta de usuarios | `POST /auth/register` público que **siempre** crea `CLIENTE` (si llega `rol`, se ignora). El primer `ADMIN` y la cuenta de servicio de Ventas se crean al arrancar `auth-service` desde variables de entorno, de forma idempotente. Más `ADMIN`: `POST /auth/usuarios`, solo `ADMIN` | Aceptar el rol en el registro: cualquiera se haría `ADMIN` (TP7 §7: "no aceptar roles enviados libremente por el cliente") |
| D12 | Cuenta deshabilitada | Login con password correcta pero `activo: false` → **403** "Cuenta deshabilitada". Se responde después de validar la password, así no revela si el email existe. Los tokens ya emitidos valen hasta su `exp` | 401: es más críptico para un usuario legítimo. Revocar tokens: exige consultar `auth-service` en cada request (contradice TP7 §12); lo mitiga un vencimiento corto (15 min) |
| D13 | Propagación entre servicios | Ventas **valida el token del cliente** y llama a Inventario (C2, C3) con **su propio token de servicio** (rol `SERVICIO`, obtenido con `POST /auth/login` de la cuenta técnica y cacheado hasta 1 min antes de su `exp`). El contexto del cliente viaja como `usuarioId` (el `sub`) en el body de C2, e Inventario lo guarda en el descuento y en los movimientos. C1 y C4 son `GET` públicos: van sin token | **Propagar el token del cliente**, que el TP7 §13 admite. Ver los motivos abajo |
| D14 | Formato de 401 y 403 | `401 { error, servicio }` + header `WWW-Authenticate: Bearer`, con `error` = "Token ausente", "Token inválido" o "Token vencido". `403 { error: "Permisos insuficientes", servicio }`. Nunca el detalle de la biblioteca ni el token | Un solo 401 genérico: distinguir "vencido" ayuda al cliente a renovar sin revelar nada sensible |
| D15 | `auth-service` caído | Los tokens ya emitidos se siguen validando localmente en cada servicio: no se consulta a `auth-service` por request. Solo fallan login y registro. Ventas: si su token de servicio vence y `auth-service` no responde, la compra da `503` antes de descontar, y el reintento de 30 s (D7) espera. Ningún servicio tiene `depends_on` hacia `auth-service` | Validar cada token contra `auth-service` (introspección): un servicio caído tiraría a todos |
| D16 | Secretos | `.env` de la raíz (no versionado) con `JWT_SECRET`, `ADMIN_PASSWORD` y `VENTAS_SERVICE_PASSWORD`. `.env.example` con valores ficticios. `compose.yml` usa `${JWT_SECRET:?…}` para fallar si falta. Cada servicio no arranca si `JWT_SECRET` falta o tiene menos de 32 caracteres | Un valor por defecto en el código: quedaría versionado y sería el mismo en todos los clones |

### Por qué no se propaga el token del cliente (D13)

1. **Un cliente podría mover stock solo.** Si Inventario aceptara tokens `CLIENTE` en `POST /descuentos`,
   cualquier cliente podría descontar stock directamente, salteando Ventas: los puertos 3201–3203 están
   publicados para diagnóstico.
2. **El reintento de compensación no tiene token.** El reintento de 30 s del TP6 (D7) corre en segundo
   plano: no hay ningún cliente conectado. Si se guardara el token del cliente, a los 15 minutos ya
   estaría vencido.
3. **Se propaga el contexto, no la credencial.** Inventario sabe que la operación la autorizó Ventas (el
   token de servicio) y para qué usuario fue (`usuarioId`), que queda en el historial de movimientos.

## 14.5 Convenciones

| Componente | Puerto | Datos |
|---|---|---|
| `auth-service` | 3400 (publicado) | `auth-db` → `mongodb://auth-db:27017/auth`, colección `usuarios` |
| Catálogo, Inventario, Ventas | igual que en el TP6 | igual que en el TP6 |

| Variable | Servicios | Valor |
|---|---|---|
| `JWT_SECRET` | los 4 | Secreto HS256. Solo en `.env` |
| `JWT_ISSUER` | los 4 | `auth-service` |
| `JWT_EXPIRES_IN` | auth | `15m` (se puede bajar para la prueba de vencimiento) |
| `BCRYPT_ROUNDS` | auth | `12` |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` | auth y scripts de seed | Primer `ADMIN` (D11) |
| `VENTAS_SERVICE_EMAIL` · `VENTAS_SERVICE_PASSWORD` | auth y ventas | Cuenta técnica de Ventas (D13) |
| `AUTH_SERVICE_URL` | ventas | `http://localhost:3400` local · `http://auth-service:3400` en Compose |

Claims del access token (TP7 §8): `{ sub, role, iss: "auth-service", iat, exp }`. No llevan email,
password, hash ni ningún dato que no haga falta para autorizar (TP7 §8.3).

Los tokens se envían con `Authorization: Bearer <token>` (TP7 §9). La validación está en un middleware
por servicio (`src/middlewares/auth.js`), igual en los cuatro y sin código compartido entre ellos (regla
del TP6). El detalle va en `docs/16-validacion-jwt.md`.

## 14.6 Cambios respecto del TP6

| Cambio | Motivo |
|---|---|
| Nuevo servicio `auth-service` con su base `auth-db` | D8 |
| Las escrituras de Catálogo e Inventario dejan de ser públicas | Matriz §14.3 |
| C2 suma el campo opcional `usuarioId`, y C2 y C3 llevan `Authorization: Bearer <token de servicio>` | D13. Se actualiza en [`06-comunicaciones.md`](./06-comunicaciones.md) §6.2 |
| Nueva comunicación Ventas → `auth-service` (`POST /auth/login` de la cuenta técnica) | D13 |
| Las compras guardan `usuarioId` | Regla de propiedad (TP7 §11.2) |
| Los contratos C1 y C4 no cambian | Son `GET` públicos |

## 14.7 Condición de avance (TP7 §4)

- [x] Podemos explicar qué identidad existe en el dominio (§14.1).
- [x] Sabemos qué endpoints necesitan conocerla y qué dato del token usa cada servicio (§14.1, §14.3).
- [x] Sabemos qué operaciones requieren autorización adicional: roles en Catálogo e Inventario, rol y propiedad en Ventas (§14.3).
- [x] El responsable de identidad está elegido y justificado (§14.2, D8).
- [ ] Aprobado por los tres integrantes en el PR de este documento.
