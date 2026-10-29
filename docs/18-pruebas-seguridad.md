# 18. Pruebas de seguridad y evidencias

> Corresponde a la sección 19 del TP7 (pruebas obligatorias A–L) y a la revisión de secretos de la
> sección 15. Índice: Parte 2 · Santiago Vicente. Cada responsable agrega su evidencia en
> [`evidencias/`](./evidencias/) con el nombre `seguridad-<letra>-<nombre>.md`.

Igual que en el TP6 ([`13-pruebas.md`](./13-pruebas.md)), cada evidencia tiene el **objetivo**, los
**comandos exactos** y la **salida obtenida**. Ninguna muestra un token completo: se cortan
(`eyJhbGciOi…`) o se muestra solo el payload.

Preparación, desde la raíz del repositorio:

```bash
cp .env.example .env            # y completar JWT_SECRET, ADMIN_PASSWORD y VENTAS_SERVICE_PASSWORD
docker compose down -v          # laboratorio limpio (borra los datos)
docker compose up --build -d
docker compose ps               # esperar a que todo esté "healthy"
node scripts/seed.js            # datos de prueba con login de ADMIN (Parte 3)
```

Tokens: los reales se obtienen con `POST /auth/login`. Para las pruebas de rechazo se usa también
`node scripts/token.js` (ver [`scripts/README.md`](../scripts/README.md)), que firma con el mismo
`JWT_SECRET`.

## 18.1 Pruebas obligatorias (TP7 §19)

| | Escenario | Responsable | Evidencia | Resultado a demostrar | Estado |
|---|---|---|---|---|---|
| A | Registrar un usuario válido | Parte 1 | `seguridad-a-registro.md` | `201`, sin password ni hash en la respuesta | pendiente (Parte 1) |
| B | Registrar un usuario duplicado | Parte 1 | `seguridad-b-duplicado.md` | `409` | pendiente (Parte 1) |
| C | Login con credenciales válidas | Parte 1 | `seguridad-c-login.md` | `200` con JWT (`sub`, `role`, `iss`, `iat`, `exp`) | pendiente (Parte 1) |
| D | Login con password incorrecta | Parte 1 | `seguridad-d-password-incorrecta.md` | `401 "Credenciales inválidas"`, igual que con un email inexistente | pendiente (Parte 1) |
| E | Endpoint protegido sin token | Parte 2 | [`seguridad-e-sin-token.md`](./evidencias/seguridad-e-sin-token.md) | `401 "Token ausente"` + `WWW-Authenticate: Bearer` | ok (Inventario) · Catálogo al mergear la Parte 1 |
| F | Token modificado manualmente | Parte 2 | [`seguridad-f-token-modificado.md`](./evidencias/seguridad-f-token-modificado.md) | `401 "Token inválido"` (payload alterado, otra clave, `alg: none`, otro `iss`) | ok (Inventario) · Catálogo al mergear la Parte 1 |
| G | Token vencido | Parte 2 | [`seguridad-g-token-vencido.md`](./evidencias/seguridad-g-token-vencido.md) | `401 "Token vencido"`, también con un token que vence mientras se usa | ok (Inventario) · Catálogo al mergear la Parte 1 |
| H | Usuario válido sin rol suficiente | Parte 2 · Parte 3 (Ventas) | [`seguridad-h-rol-insuficiente.md`](./evidencias/seguridad-h-rol-insuficiente.md) | `403 "Permisos insuficientes"`; un CLIENTE no puede descontar stock directo | ok (Inventario) · ok (Ventas: [`seguridad-h-i-ventas.md`](./evidencias/seguridad-h-i-ventas.md)) · Catálogo en las evidencias de la Parte 1 |
| I | Usuario con rol autorizado | Parte 2 · Parte 3 (Ventas) | [`seguridad-i-rol-autorizado.md`](./evidencias/seguridad-i-rol-autorizado.md) | La operación se ejecuta (`200`/`201`/`204`) | ok (Inventario) · ok (Ventas: [`seguridad-h-i-ventas.md`](./evidencias/seguridad-h-i-ventas.md)) · Catálogo en las evidencias de la Parte 1 |
| J | Caso de uso que atraviesa dos servicios | Parte 3 | [`seguridad-j-compra.md`](./evidencias/seguridad-j-compra.md) | Ventas valida al cliente y llama a Inventario con su token de servicio; el `usuarioId` llega al movimiento | ok |
| K | Reiniciar la solución con Compose | Parte 1 | `seguridad-k-reinicio.md` | Los usuarios persisten y el login vuelve a funcionar | pendiente (Parte 1) |
| L | Inspeccionar la persistencia de usuarios | Parte 1 | `seguridad-l-hash.md` | `passwordHash` con formato bcrypt (`$2a$`/`$2b$`), sin la password | pendiente (Parte 1) |

Detalle completo de los casos del middleware de Inventario (los 9 tipos de `401`, los `403`, el
reenvío por un follower y la trazabilidad): [`seguridad-inventario-middleware.md`](./evidencias/seguridad-inventario-middleware.md).

## 18.2 Pruebas adicionales

| Prueba | Responsable | Evidencia | Resultado | Estado |
|---|---|---|---|---|
| Escritura protegida por un follower de Inventario | Parte 2 | [`seguridad-inventario-middleware.md`](./evidencias/seguridad-inventario-middleware.md) §5 | ADMIN: el follower reenvía con el `Authorization` y responde `200`. CLIENTE: `403` en el follower, sin reenviar | ok |
| Trazabilidad del `usuarioId` en Inventario | Parte 2 | [`seguridad-i-rol-autorizado.md`](./evidencias/seguridad-i-rol-autorizado.md) | Cada movimiento guarda quién lo originó (D13) | ok |
| Tokens en los logs | Parte 2 | [`seguridad-inventario-middleware.md`](./evidencias/seguridad-inventario-middleware.md) | `grep -c "eyJ"` sobre los logs de Inventario → `0` | ok |
| `auth-service` caído con tokens ya emitidos (D15) | Parte 3 | [`seguridad-auth-caido.md`](./evidencias/seguridad-auth-caido.md) | `docker compose stop auth-service`: el token del cliente sigue valiendo; con el token de servicio de Ventas vencido, la compra da `503` antes de descontar, y vuelve a `201` al levantar `auth-service` | ok |
| Cuenta deshabilitada (D12) | Parte 1 | `seguridad-cuenta-deshabilitada.md` | Login → `403 "Cuenta deshabilitada"` | pendiente (Parte 1) |

## 18.3 Revisión de secretos (TP7 §15)

Corrida el 28/10/2026 sobre todas las ramas y el historial completo del repositorio:

| Control | Comando | Resultado |
|---|---|---|
| `.env` ignorado | `grep -nE "^\.env\|^!\.env" .gitignore` | `.env` y `.env.*` ignorados, con la excepción `!.env.example` ✅ |
| Ningún `.env` real versionado nunca | `git log --all --name-only --format= \| grep -E "(^\|/)\.env($\|\.)" \| grep -v "\.env\.example$"` | Sin resultados ✅ |
| Ningún valor de secreto en el código | `git log --all -p -- . ':!*.example' ':!*.md' \| grep -E "^\+.*(JWT_SECRET\|ADMIN_PASSWORD\|VENTAS_SERVICE_PASSWORD\|SSL_PASSPHRASE\|REDIS_PASSWORD)\s*[=:]"` | Sin resultados ✅ |
| Ningún token JWT pegado | `git grep -nE "eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}" <cada rama>` | Sin resultados ✅ |
| Claves privadas o certificados | `git log --all --name-only --format= \| grep -iE "\.(pem\|key\|pfx\|p12)$"` | ⚠️ **Hallazgo:** `certs/cert.pem`, `certs/key.pem` y `certs/pfx.pfx` |

### Hallazgo: certificado del proyecto anterior en el historial

- **Qué es:** un certificado autofirmado para `localhost` (`CN=localhost`), con su clave privada, que
  venía de la aplicación anterior del grupo.
- **Dónde está:** entró en el primer commit del repositorio (`6f5d0c1`, "Initial Commit") y se borró al
  día siguiente (`6a16b8a`, "Eliminar proyecto previo"). **No está en `main` ni en ningún tag**
  (`tp5-base`, `tp5-entrega`, `tp6-entrega`). Ningún archivo de la solución lo referencia.
- **Riesgo:** bajo. Es un certificado de desarrollo para `localhost`, que no protege ningún entorno
  real. Pero como la clave privada quedó en un repositorio público, **se considera comprometido**.
- **Corrección:**
  1. No se usa: el HTTPS de `app-base/` lo genera cada integrante en su máquina con
     `app-base/scripts/generar-certificado.ps1`, y en Compose solo se usa HTTP (D5 del TP6).
  2. `.gitignore` ignora `certs/`, `*.pfx`, `*.pem` y `*.key` desde el TP5: no se puede volver a subir
     por error.
  3. Si alguien todavía lo tiene instalado como certificado de confianza en su máquina, tiene que
     eliminarlo.
- **Por qué no se reescribe el historial:** borrarlo del historial (`git filter-repo`) cambiaría el
  hash de todos los commits y rompería los tags de las entregas ya evaluadas (`tp5-entrega`,
  `tp6-entrega`), los PRs y los clones de los tres integrantes. Como el certificado no se usa y está
  revocado en la práctica, el TP7 §15 se cumple reemplazándolo y documentándolo.

El `env.example` de ese mismo commit solo tenía valores de ejemplo (`CAMBIAR…`, una URI de Mongo
local), no secretos reales.

### Para repetir la revisión antes del tag

```bash
git log --all --name-only --format= | grep -E "(^|/)\.env($|\.)" | grep -v "\.env\.example$"     # vacío
git grep -nE "eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}" -- .                             # vacío
git log --all --name-only --format= | grep -iE "\.(pem|key|pfx|p12)$"                             # solo los 3 del hallazgo
```
