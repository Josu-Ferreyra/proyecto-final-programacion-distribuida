# 17. Propagación de identidad y propiedad de las compras

> Corresponde a las secciones 11.2 y 13 del TP7. Parte 3 (Ventas).
> Decisiones D13 y D15 de [`14-modelo-seguridad.md`](./14-modelo-seguridad.md).

## 17.1 El caso de uso "comprar" con dos identidades

```
Cliente
  | POST /compras   Authorization: Bearer <token del CLIENTE>
  v
Ventas ── valida el token del cliente (middleware): role CLIENTE o ADMIN, sub = dueño de la compra
  |
  |  C1 GET /productos?ids=...   (público, sin token) ───────────────────────────> Catálogo
  |
  |  POST /auth/login de la cuenta técnica (solo si el token en caché vence) ───> auth-service
  |
  |  C2 POST /descuentos   Authorization: Bearer <token de SERVICIO de Ventas>
  |     { referencia: compraId, items, usuarioId: <sub del cliente> } ──────────> Inventario
  |                                     valida el token de servicio y guarda el usuarioId
  v
Ventas ── guarda la compra CONFIRMADA con usuarioId = sub del cliente
  |
  v
201 { compraId, usuarioId, estado, items, total }
```

| Paso | Servicio | Qué decide | Qué dato de identidad usa |
|---|---|---|---|
| 1 | Ventas | ¿La identidad es válida y puede comprar? | `role` del token del cliente |
| 2 | Catálogo | Nada: informa precio y existencia | Ninguno (C1 es público) |
| 3 | auth-service | Emite el token de la cuenta técnica | La cuenta `ventas@servicio.local` (rol `SERVICIO`) |
| 4 | Inventario | ¿Quien pide puede mover stock? ¿Alcanza? | `role` del token de servicio + el `usuarioId` del body para el historial |
| 5 | Ventas | Registra la compra | `sub` del token del cliente → `usuarioId` |

## 17.2 Por qué no se propaga el token del cliente

El TP7 §13 admite reenviar el token del cliente a los servicios internos. Acá no conviene (D13):

1. **Un cliente podría mover stock solo.** Si Inventario aceptara tokens `CLIENTE` en `POST /descuentos`,
   cualquiera podría descontar stock salteando Ventas. Con la decisión tomada, un `CLIENTE` recibe
   `403` en Inventario (probado en el smoke test).
2. **El reintento de compensación de 30 s (D7) no tiene token de cliente.** Corre en segundo plano y,
   aunque se guardara el token, a los 15 minutos estaría vencido. Con la cuenta técnica, el reintento
   siempre tiene identidad.
3. **Se propaga el contexto, no la credencial.** Inventario sabe que la operación la autorizó Ventas
   (token `SERVICIO`) y para quién fue (`usuarioId`), que queda en el descuento y en el movimiento.

## 17.3 La cuenta técnica de Ventas

| Aspecto | Cómo funciona |
|---|---|
| Quién la crea | `auth-service` al arrancar, desde `VENTAS_SERVICE_EMAIL` / `VENTAS_SERVICE_PASSWORD` (D11) |
| Cómo se obtiene el token | `src/clients/authClient.js`: `POST /auth/login` con esa cuenta |
| Caché | En memoria, hasta 60 s antes de su `exp`. No hay un login por compra |
| Si Inventario responde 401 | El token pudo vencer en el medio: se descarta la caché, se pide otro y se reintenta **una vez** (C2 y C3 son idempotentes por referencia) |
| Dónde se usa | Solo en C2 y C3 (`src/clients/inventarioClient.js`), también desde el reintento de 30 s |
| Qué no hace | Ventas no verifica la firma de su propio token (lo hace Inventario): solo lee `exp` |

## 17.4 Propiedad de la compra (TP7 §11.2)

La compra guarda `usuarioId` = el `sub` del token de quien la registró: nunca algo del body (un
`usuarioId` enviado en el body se ignora; probado). Es una referencia lógica a un usuario de
`auth-service`: Ventas no consulta su base. La regla vive en la capa de servicios de Ventas, porque es
una regla de negocio de Ventas:

| Situación | Respuesta |
|---|---|
| El dueño consulta o cancela su compra | `200` |
| Otro `CLIENTE` consulta o cancela esa compra | `403 "No podés acceder a una compra de otro usuario"` |
| `ADMIN` consulta o cancela cualquier compra | `200` |
| La compra no existe | `404` |
| Token de la cuenta técnica (`SERVICIO`) | `403`: la cuenta técnica no compra ni consulta compras |

En la cancelación, la condición de propiedad va **dentro** de la misma operación atómica que pasa la
compra a `CANCELACION_PENDIENTE` (`findOneAndUpdate` con `usuarioId` en el filtro): no hay una ventana
entre verificar el dueño y cancelar.

## 17.5 `auth-service` no disponible (D15)

| Momento | Qué pasa |
|---|---|
| El token de servicio en caché sigue vigente | Las compras funcionan normalmente: Ventas no necesita a `auth-service` |
| Venció y `auth-service` no responde | `POST /compras` → `503 { dependencia: "auth-service" }` **antes** de descontar: no queda nada a medias ni hay que compensar |
| Reintento de 30 s sin token disponible | Esa vuelta no reintegra; lo intenta en la siguiente. Las unidades siguen descontadas (el error menos grave) |
| Vuelve `auth-service` | La siguiente compra obtiene un token nuevo y responde `201` |

Los tokens de los clientes ya emitidos siguen siendo válidos mientras `auth-service` está caído: Ventas
los verifica localmente.

## 17.6 Fallo parcial con identidad

El análisis de fallo parcial del TP6 ([`12-comunicacion-y-fallos.md`](./12-comunicacion-y-fallos.md)) no
cambia: la compensación (C3) y el reintento de 30 s usan la cuenta técnica, así que no dependen de que
el cliente siga conectado ni de que su token siga vigente. Lo nuevo es un punto de falla **antes** del
descuento (obtener el token de servicio), que no deja estado parcial.

## 17.7 Pruebas

Evidencias en [`18-pruebas-seguridad.md`](./18-pruebas-seguridad.md): J (compra que atraviesa los
servicios), H e I en Ventas (propiedad de la compra), y `auth-service` caído con el token de servicio
vencido.
