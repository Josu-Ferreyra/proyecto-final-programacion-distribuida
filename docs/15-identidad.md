# 15. Identidad: `auth-service`

> Corresponde a las secciones 5 a 8 y 17 del TP7 (componente de identidad, usuarios, hash, login,
> token y logs). Parte 1 · Josué Ferreyra. Las decisiones D8–D16 y la matriz de acceso están en
> [`14-modelo-seguridad.md`](./14-modelo-seguridad.md); cómo valida el token cada servicio, en
> [`16-validacion-jwt.md`](./16-validacion-jwt.md). Código: [`services/auth/`](../services/auth/).

## 15.1 Por qué un servicio nuevo (D8)

El TP6 no tiene un servicio de usuarios, así que no hay un dueño natural de la identidad. Las
alternativas que plantea el TP7 §5, aplicadas a esta solución:

| Alternativa | Qué implicaba | Decisión |
|---|---|---|
| Integrar la autenticación en un `users-service` existente | — | No aplica: no existe |
| Guardar usuarios y passwords en Ventas | Ventas es el único servicio que "conoce clientes" (las compras tienen dueño) | Descartada: mezcla credenciales con compras, y Catálogo e Inventario tendrían que consultar a Ventas para autorizar, creando dependencias que hoy no existen |
| Que cada servicio tenga sus propios usuarios | Tres bases de usuarios, tres logins | Descartada: tres copias de las credenciales y un token distinto por servicio |
| **Crear `auth-service`** | Un servicio más (puerto 3400, base `auth-db`) | **Elegida.** Las credenciales quedan en un solo lugar; los demás servicios solo reciben un token firmado y no dependen de `auth-service` en tiempo de ejecución |

`auth-service` es **la única autoridad sobre las credenciales**: es el único que guarda hashes,
verifica passwords y emite tokens. **No contiene reglas de negocio** de los otros servicios: no sabe
qué es un producto, un stock ni una compra. Ningún otro servicio accede a `auth-db` (la regla de
propiedad de los datos del TP5 sigue valiendo).

## 15.2 Modelo de usuario (TP7 §6)

Colección `usuarios` de la base `auth` ([`usuario.model.js`](../services/auth/src/models/usuario.model.js)):

| Campo | Tipo | Regla |
|---|---|---|
| `_id` | ObjectId | Es el `sub` del token y el `usuarioId` que ven los demás servicios |
| `email` | String | Único (índice), `trim` y minúsculas: `" Ana@X.com "` y `"ana@x.com"` son el mismo usuario |
| `passwordHash` | String | `bcrypt(password, 12)`. La password **nunca** se guarda |
| `rol` | String | `CLIENTE`, `ADMIN` o `SERVICIO` (D10). Uno solo por usuario |
| `activo` | Boolean | `true` por defecto. `false` impide el login (D12) |
| `createdAt` · `updatedAt` | Date | Timestamps de Mongoose |

El `toJSON` del schema es una **lista blanca** (`id`, `email`, `rol`, `activo`, `createdAt`): aunque
un controller devuelva el documento entero por error, el hash no sale.

Validación de entrada: email con formato válido (máximo 254 caracteres) y password de **8 a 72
caracteres**. El tope existe porque bcrypt usa solo los primeros 72 bytes: una password más larga se
rechaza con `400` en lugar de truncarla en silencio (si no, dos passwords distintas con el mismo
comienzo serían la misma).

## 15.3 Hash de passwords

- Biblioteca **`bcryptjs`** (bcrypt en JavaScript puro): evita compilar binarios nativos en la imagen
  `node:24-alpine`. Es el mismo algoritmo bcrypt, con salt aleatorio por hash que guarda la propia
  biblioteca dentro del resultado.
- Costo **12** (`BCRYPT_ROUNDS`, configurable entre 10 y 15): unos 450 ms por hash en la imagen.
  Es lento a propósito: es lo que hace caro probar passwords contra un hash robado.
- El resultado tiene la forma `$2b$12$<salt de 22 caracteres><hash de 31>`; `$2b$` es la versión del
  algoritmo y `12` el costo. Se ve en la evidencia [L](./evidencias/seguridad-l-hash.md).

## 15.4 Registro (D11)

`POST /auth/register { email, password }` es público y **siempre crea `CLIENTE`**. Si el body trae
`rol`, se ignora: nadie se auto-asigna `ADMIN` (se probó con `"rol": "ADMIN"` en la evidencia
[A](./evidencias/seguridad-a-registro.md)). Respuestas: `201 { id, email, rol, activo, createdAt }`,
`400` con datos inválidos, `409` si el email ya está registrado (también con otra capitalización o
espacios, porque se normaliza antes de comparar). Si dos registros con el mismo email llegan a la
vez, el índice único de Mongo rechaza el segundo y también responde `409`.

> El `409` revela que un email está registrado. Es lo que pide el TP7 (prueba B) y es lo habitual en
> un registro; lo que sí se evita es que el **login** lo revele (§15.5).

## 15.5 Login sin filtrar información

`POST /auth/login { email, password }` ([`usuarios.service.js`](../services/auth/src/services/usuarios.service.js)):

1. Valida el formato (`400` si falta algo o la password pasa de 72 bytes).
2. Busca el usuario por email normalizado.
3. **Compara siempre con bcrypt**, aunque el usuario no exista: en ese caso contra un hash ficticio
   calculado al arrancar con el mismo costo. Si no, un email inexistente respondería en 1 ms y uno
   existente en 450 ms, y se podría saber qué emails están registrados midiendo el tiempo.
4. Usuario inexistente **o** password incorrecta: el mismo `401 "Credenciales inválidas"`. El motivo
   real queda solo en el log.
5. Password correcta pero cuenta deshabilitada: `403 "Cuenta deshabilitada"` (D12). Se responde
   **después** de validar la password, así que sin la password correcta tampoco revela nada.
6. Todo bien: `200 { accessToken, tokenType: "Bearer", expiresIn }` con `Cache-Control: no-store`.

En la evidencia [D](./evidencias/seguridad-d-password-incorrecta.md) los dos `401` tardan lo mismo
(0,49 s y 0,48 s).

## 15.6 El access token (D9)

[`tokens.js`](../services/auth/src/services/tokens.js) firma con `jsonwebtoken`:

```json
{ "alg": "HS256", "typ": "JWT" }
{ "role": "CLIENTE", "iat": 1793229928, "exp": 1793230828, "iss": "auth-service", "sub": "6ae28466a9973f47364822ab" }
```

| Claim | Valor | Para qué |
|---|---|---|
| `sub` | `_id` del usuario | Quién es. Ventas lo usa como dueño de la compra e Inventario lo guarda en los movimientos (D13) |
| `role` | `CLIENTE` · `ADMIN` · `SERVICIO` | Qué puede hacer (matriz de [`14`](./14-modelo-seguridad.md)) |
| `iss` | `auth-service` | Quién lo emitió. Los servicios rechazan otro emisor |
| `iat` · `exp` | segundos epoch | Emisión y vencimiento: `exp - iat = 900` (15 minutos) |

**No lleva** email, password, hash ni ningún dato que no haga falta para autorizar (TP7 §8.3): el
payload de un JWT se lee sin la clave (es base64, no está cifrado).

- **Firma:** HS256 con `JWT_SECRET`, el mismo en los 4 servicios. `config/env.js` hace que el
  servicio **no arranque** si falta o tiene menos de 32 caracteres; no hay valor por defecto en el
  código. La firma asimétrica (RS256, donde solo `auth-service` tendría la clave privada y los demás
  la pública) queda como ampliación: con HS256 cualquier servicio que valida también podría firmar.
- **Vencimiento:** `JWT_EXPIRES_IN=15m`. Se valida al arrancar (`900`, `30s`, `15m`, `1h`), para que
  un valor mal escrito no termine en un `500` en cada login.
- **Sin refresh token:** al vencer, el cliente vuelve a hacer login. Para este TP alcanza; un refresh
  token implicaría guardarlo y poder revocarlo.

## 15.7 Cuentas que se crean al arrancar (D11)

`register` nunca crea un `ADMIN`, así que el primero tiene que existir antes. Al arrancar, después de
conectar a Mongo, [`bootstrap.js`](../services/auth/src/services/bootstrap.js):

| Variables | Cuenta | Rol |
|---|---|---|
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` | Primer administrador (`admin@tp7.local` por defecto en Compose) | `ADMIN` |
| `VENTAS_SERVICE_EMAIL` · `VENTAS_SERVICE_PASSWORD` | Cuenta técnica de Ventas (`ventas@servicio.local`) | `SERVICIO` |

- **Idempotente:** si la cuenta ya existe, no se toca. Reiniciar el servicio (o cambiar
  `ADMIN_PASSWORD` en el `.env`) no cambia la password guardada. Se ve en la evidencia
  [K](./evidencias/seguridad-k-reinicio.md): "Cuenta ADMIN ya existente: no se modifica".
- Si faltan las variables, el servicio arranca igual y lo avisa con un `warn`.
- Si están pero la password no cumple la regla de 8 a 72 caracteres, el servicio **no arranca**: es un
  error de configuración y es mejor verlo que quedar sin administrador.
- La cuenta `SERVICIO` solo se crea así: `POST /auth/usuarios` no acepta ese rol.

En Compose, `ADMIN_PASSWORD` y `VENTAS_SERVICE_PASSWORD` son obligatorias (`${…:?}`): sin ellas
`docker compose up` no arranca.

## 15.8 Administración de usuarios y cuenta deshabilitada (D12)

| Endpoint | Rol | Qué hace |
|---|---|---|
| `POST /auth/usuarios { email, password, rol }` | `ADMIN` | Alta de otro `ADMIN` o de un `CLIENTE`. `rol: "SERVICIO"` → `400` |
| `PATCH /auth/usuarios/:id { activo }` | `ADMIN` | Habilita o deshabilita una cuenta. Solo acepta el campo `activo` (no se cambia el rol ni la password por acá). Un administrador no puede deshabilitarse a sí mismo (`400`), para no dejar el sistema sin `ADMIN` por error |

Una cuenta deshabilitada no puede hacer login (`403`), pero **los tokens que ya tenía siguen valiendo
hasta su `exp`**: los servicios validan el token localmente y no consultan si la cuenta sigue activa
(D12, D15). No hay revocación; el riesgo se acota con el vencimiento de 15 minutos. Revocar al
instante implicaría que cada servicio consulte una lista de tokens revocados en cada request, que es
justamente la dependencia que D15 evita.

## 15.9 Logs (TP7 §17)

| Evento | Nivel | Campos |
|---|---|---|
| Registro | `info` | `usuarioId`, `rol` |
| Login exitoso | `info` | `usuarioId`, `rol` |
| Login fallido | `warn` | `motivo` (`password incorrecta` / `usuario inexistente`), email enmascarado (`c***@tp7.local`) |
| Login de cuenta deshabilitada | `warn` | `motivo`, `usuarioId` |
| Alta administrada | `info` | `usuarioId`, `rol`, `adminId` |
| Cuenta habilitada / deshabilitada | `info` | `usuarioId`, `adminId` |
| Request rechazada por autenticación o autorización | `warn` | `operacion`, `status`, `motivo` o `usuarioId` y `rol` (middleware) |
| Cuentas iniciales | `info` / `warn` | `usuarioId`, `rol` |

**Nunca** se loguea la password, el hash, el token ni `JWT_SECRET`. El log de cada request tiene solo
`method`, `url`, `status` y `ms`: no el body (donde va la password) ni los headers (donde va el
token). En la evidencia [L](./evidencias/seguridad-l-hash.md) se buscó la password de prueba en los
logs y en la base: 0 apariciones.

## 15.10 Si `auth-service` se cae (D15)

Ningún servicio consulta a `auth-service` por request: validan la firma y el `exp` con el
`JWT_SECRET` que ya tienen. Por eso ningún servicio tiene `depends_on` hacia él en
[`compose.yml`](../compose.yml).

| Operación | Con `auth-service` caído |
|---|---|
| Login y registro | Fallan (sin respuesta en el puerto 3400) |
| Requests con un token ya emitido y vigente | Siguen funcionando en Catálogo, Inventario y Ventas |
| Compras | Siguen mientras el token de servicio de Ventas esté vigente; si vence, `503` (D13, ver [`17-propagacion-identidad.md`](./17-propagacion-identidad.md)) |

Se verificó en la corrida de integración del 28/10/2026: con `docker compose stop auth-service`, un
`PUT /productos/:id` en Catálogo con el token `ADMIN` emitido antes respondió `200`, y el login quedó
sin respuesta.

## 15.11 Configuración y secretos (D16)

| Variable | Valor en Compose | De dónde sale |
|---|---|---|
| `JWT_SECRET` | `${JWT_SECRET:?…}` | `.env` de la raíz, obligatoria |
| `JWT_ISSUER` | `auth-service` | `compose.yml` |
| `JWT_EXPIRES_IN` | `${JWT_EXPIRES_IN:-15m}` | `.env` (opcional) |
| `BCRYPT_ROUNDS` | `12` | `compose.yml` |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` | `${ADMIN_EMAIL:-admin@tp7.local}` · `${ADMIN_PASSWORD:?…}` | `.env` |
| `VENTAS_SERVICE_EMAIL` · `VENTAS_SERVICE_PASSWORD` | `ventas@servicio.local` · `${VENTAS_SERVICE_PASSWORD:?…}` | `compose.yml` · `.env` |

El `.env` no se versiona; [`.env.example`](../.env.example) tiene valores ficticios y el comando para
generar el secreto (`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`).

## 15.12 Limitaciones conocidas

| Limitación | Por qué se acepta | Ampliación posible |
|---|---|---|
| No hay revocación de tokens | D12/D15: revocar exige consultar algo central en cada request | Lista de revocados en Redis, o tokens de 1–5 minutos con refresh token |
| No hay límite de intentos de login | El costo 12 de bcrypt hace cada intento lento (~0,5 s) | Rate limiting por IP y por email, o bloqueo temporal de la cuenta |
| HS256: el secreto está en los 4 servicios | Es lo más simple que cumple el TP | RS256 con clave pública en Catálogo, Inventario y Ventas |
| Sin HTTPS dentro de Compose (D5 del TP6) | Las passwords y tokens viajan en claro por la red `backend` y por `localhost` | TLS en un gateway o entre servicios |
