# Evidencia · B — Registro duplicado

**Objetivo (TP7 §19, escenario B):** registrar otra vez un email que ya existe responde `409`.

Corrida del 28/10/2026 en Docker Compose (Linux, Docker 29.7, Compose 5.5), con los 11 contenedores
`healthy`. Rama local de integración que junta `feature/auth-service` (commit `80e8f09`),
`feature/catalogo-jwt` (`4cad6ce`) y `feature/compose-auth` (`29732f2`) de la Parte 1, y
`feature/inventario-jwt` (`7fa8af6`) y `feature/token-pruebas` (`2a1a124`) de la Parte 2. Ventas
todavía en su versión del TP6 (no interviene en estas pruebas).

Preparación, desde la raíz del repositorio:

```bash
cp .env.example .env     # JWT_SECRET generado con randomBytes(48) y passwords propias para ADMIN y Ventas
docker compose up --build -d
docker compose ps        # los 11 contenedores "healthy"
```

Los usuarios `cliente-a@tp7.local` y `quiere-ser-admin@tp7.local` son cuentas de laboratorio con
passwords de prueba; la del `ADMIN` sale del `.env` y no aparece en la evidencia. Ningún token se
muestra completo.

El usuario `cliente-a@tp7.local` ya fue creado en la [prueba A](./seguridad-a-registro.md).

Comandos (`$ …`) y salida obtenida:

```text
$ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3400/auth/register -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Otra-clave-distinta"}'
{"error":"El email ya está registrado","servicio":"auth-service"}
409

# El email se normaliza (trim + minúsculas): con mayúsculas y espacios también es duplicado
$ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3400/auth/register -H 'Content-Type: application/json' -d '{"email":"  Cliente-A@TP7.local ","password":"Otra-clave-distinta"}'
{"error":"El email ya está registrado","servicio":"auth-service"}
409
```

**Resultado:** ✅ `409 "El email ya está registrado"`, también con el email en mayúsculas y con espacios, porque se normaliza antes de comparar. El usuario original no se modifica (la prueba C hace login con su password original).
