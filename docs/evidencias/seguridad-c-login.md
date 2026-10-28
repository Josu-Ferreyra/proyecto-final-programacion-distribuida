# Evidencia · C — Login válido

**Objetivo (TP7 §19, escenario C):** `POST /auth/login` con credenciales válidas responde `200` con un JWT que tiene `sub`, `role`, `iss`, `iat` y `exp`.

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

Se decodifican solo el header y el payload (`Buffer.from(parte, 'base64url')`): la firma y el token completo no se muestran.

Comandos (`$ …`) y salida obtenida:

```text
$ curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Clave-de-prueba-A1"}'
200

# Campos de la respuesta (sin el token)
$ curl -s -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Clave-de-prueba-A1"}' | node -e 'const r=JSON.parse(require("fs").readFileSync(0)); console.log({ ...r, accessToken: r.accessToken.slice(0, 10) + "…(" + r.accessToken.length + " caracteres)" })'
{
  accessToken: 'eyJhbGciOi…(223 caracteres)',
  tokenType: 'Bearer',
  expiresIn: 900
}

# Header y payload decodificados (la firma no se muestra)
$ curl -s -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Clave-de-prueba-A1"}' | node -e "const t=JSON.parse(require(\"fs\").readFileSync(0)).accessToken; const [h,p]=t.split(\".\"); console.log(\"header:\", Buffer.from(h, \"base64url\").toString()); console.log(\"payload:\", JSON.stringify(JSON.parse(Buffer.from(p, \"base64url\")), null, 2))"
header: {"alg":"HS256","typ":"JWT"}
payload: {
  "role": "CLIENTE",
  "iat": 1793229928,
  "exp": 1793230828,
  "iss": "auth-service",
  "sub": "6ae28466a9973f47364822ab"
}

# El token sirve para identificarse
$ TOKEN=$(curl -s -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Clave-de-prueba-A1"}' | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).accessToken"); curl -s -w '\n%{http_code}\n' http://localhost:3400/auth/me -H "Authorization: Bearer $TOKEN"
{"id":"6ae28466a9973f47364822ab","email":"cliente-a@tp7.local","rol":"CLIENTE","activo":true}
200
```

**Resultado:** ✅ `200 { accessToken, tokenType: "Bearer", expiresIn: 900 }`. Firmado con `HS256`; el payload tiene solo `sub` (el `id` de la prueba A), `role`, `iss: "auth-service"`, `iat` y `exp` (`exp - iat = 900`, 15 minutos). No lleva email ni ningún dato de la password. El token sirve en `GET /auth/me`.
