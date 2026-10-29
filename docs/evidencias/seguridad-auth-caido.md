# Evidencia · auth-service caído (D15)

**Objetivo (TP7 §12):** mostrar qué pasa cuando el componente de autenticación no está disponible después
de que se emitieron tokens válidos.

Corrida del 28/10/2026 con la solución completa en Docker Compose (11 contenedores `healthy`):
`main` más los PRs del TP7 de auth-service, Catálogo y Compose (Parte 1), Inventario (Parte 2) y
Ventas, seed y smoke test (Parte 3). Datos cargados con `node scripts/seed.js` (ADMIN y los clientes
`cliente1` y `cliente2`, ver [`scripts/README.md`](../../scripts/README.md)). Ningún token aparece
completo: los scripts los usan sin imprimirlos.

```bash
cp .env.example .env              # completar JWT_SECRET, ADMIN_PASSWORD y VENTAS_SERVICE_PASSWORD
docker compose up --build -d
node scripts/seed.js
node scripts/smoke-test.js
```

Para que el token de la cuenta técnica de Ventas venza rápido, se recrearon `auth-service` y
`ventas-service` con `JWT_EXPIRES_IN=65s` (Ventas renueva su token 60 s antes del `exp`):

```bash
JWT_EXPIRES_IN=65s docker compose up -d --force-recreate auth-service ventas-service
# token de cliente1 obtenido con POST /auth/login
```

```text
JWT_EXPIRES_IN=65s en auth-service (Ventas renueva su token 60 s antes del exp: el de 65 s queda en caché solo 5 s)
stock del mouse: 10
1) compra con auth-service arriba: [201]
2) docker compose stop auth-service
3) compra con el token del cliente todavía vigente: {"error":"No se pudo registrar la compra: Ventas no pudo autenticarse ante Inventario","servicio":"ventas-service","dependencia":"auth-service"} [503]
   stock del mouse: 9 (no se descontó nada)
4) consultar stock público con auth caído: [200]
5) docker compose start auth-service
6) compra de nuevo: [201]
   stock del mouse: 8
```

**Resultado:**
- Con `auth-service` caído, el token del cliente sigue siendo válido (Ventas lo verifica localmente),
  pero Ventas no puede renovar su token de servicio: responde `503 { dependencia: "auth-service" }`
  **antes** de descontar. El stock no se tocó: no hay estado parcial ni compensación.
- Las consultas públicas (`GET /stock`) siguen funcionando.
- Cuando vuelve `auth-service`, la compra responde `201`.
