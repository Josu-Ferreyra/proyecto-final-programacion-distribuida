# Arquitectura — TP5, TP6 y TP7

Punto de partida: la API de productos del TP4 (cluster Raft de 3 nodos), ubicada en
[`app-base/`](../app-base/) y marcada con el tag `tp5-base`. En el TP5 se analizó y propuso
la división en microservicios (tag `tp5-entrega`); en el TP6 se implementó en
[`services/`](../services/) y se ejecuta con Docker Compose. Los cambios que hubo que hacer
al implementar están en [TP6: cambios respecto del TP5](#tp6-cambios-respecto-del-tp5). En el TP7
se agregó identidad, autenticación y autorización: un servicio nuevo, `auth-service`, y la
protección de los tres servicios con JWT ([TP7: identidad y seguridad](#tp7-identidad-y-seguridad)).

## Resumen de la propuesta

La aplicación actual concentra en un único documento `productos` el catálogo (nombre,
precio y categoría) y el stock, y resuelve la compra en una sola función que valida, toma
el lock de Redis, calcula el stock nuevo y lo propone a Raft. Se propone dividirla en
**tres microservicios, uno por responsabilidad de negocio**:

| Servicio | Responsabilidad | Datos propios | Depende de |
|---|---|---|---|
| **Catálogo** | Qué se ofrece y a qué precio | Productos (nombre, precio vigente, categoría, activo) y categorías válidas | Nadie |
| **Inventario** | Cuántas unidades hay y que nunca se venda de más | Stock por producto, descuentos por referencia, movimientos y el lock de Redis (interno) | Catálogo, solo al dar de alta stock |
| **Ventas** | Concretar las compras y llevar su ciclo de vida | Compras e ítems con el nombre y el precio pagado | Catálogo e Inventario |

**Por qué así.** Es la única alternativa evaluada que elimina los cuatro acoplamientos
detectados. El stock pasa a tener un solo dueño, que lo descuenta sobre el valor vigente,
y con eso desaparece la pérdida de actualizaciones entre el `PUT` de stock y la compra. La
compra queda como un registro propio, con el precio congelado al momento de comprar.
Separar en más servicios (uno por entidad) o sacar Raft a un "servicio de consenso" se
descartó: aumenta las comunicaciones sin reducir el acoplamiento.

**Cómo se comunican.** Con llamadas HTTP/REST síncronas y sin ciclos: Ventas consulta los
productos a Catálogo (C1) y le pide a Inventario descontar o reintegrar unidades (C2 y C3),
e Inventario verifica en Catálogo que el producto exista al dar de alta su stock (C4).
Ningún servicio accede a la base de otro. Raft deja de ser parte del negocio y pasa a ser
un módulo de infraestructura que cada servicio puede usar para replicarse en su propio
cluster (Inventario es el primer candidato). En esta etapa no hay API Gateway.

## Documentos

**TP5**

| # | Sección | Documento | Autor/a |
|---|---|---|---|
| 1 | Inventario de la aplicación existente | [01-inventario.md](01-inventario.md) | Matías Porcari |
| 2 | Identificación de responsabilidades | [02-responsabilidades.md](02-responsabilidades.md) | Santiago Vicente |
| 3 | Acoplamientos detectados | [03-acoplamientos.md](03-acoplamientos.md) | Santiago Vicente |
| 4 | Propuesta de microservicios (fichas + tabla) | [04-microservicios.md](04-microservicios.md) | Santiago Vicente |
| 5 | Propiedad de los datos | [05-propiedad-datos.md](05-propiedad-datos.md) | Josué Ferreyra |
| 6 | Comunicaciones y casos de uso | [06-comunicaciones.md](06-comunicaciones.md) | Josué Ferreyra |
| 7 | Validación de límites | [07-validacion-limites.md](07-validacion-limites.md) | Josué Ferreyra |
| 8 | Diagrama de arquitectura (lógico y de despliegue) | [diagrama-arquitectura.md](diagrama-arquitectura.md) | Josué Ferreyra |

**TP6**

| # | Sección | Documento | Autor/a |
|---|---|---|---|
| 8 | Ratificación de la arquitectura y decisiones D1–D7 | [08-ratificacion-tp6.md](08-ratificacion-tp6.md) | Josué Ferreyra |
| 9 | Ejecución con Docker Compose: red, puertos y persistencia | [09-ejecucion-docker.md](09-ejecucion-docker.md) | Josué Ferreyra |
| 10 | Inventario replicado | [10-inventario-replicado.md](10-inventario-replicado.md) | Santiago Vicente |
| 11 | Configuración por entorno | [11-configuracion-por-entorno.md](11-configuracion-por-entorno.md) | Santiago Vicente |
| 12 | Comunicación entre servicios y fallos | [12-comunicacion-y-fallos.md](12-comunicacion-y-fallos.md) | Matías Porcari |
| 13 | Pruebas y evidencias | [13-pruebas.md](13-pruebas.md) | Josué Ferreyra |

**TP7**

| # | Sección | Documento | Autor/a |
|---|---|---|---|
| 14 | Modelo de seguridad, matriz de acceso y decisiones D8–D16 | [14-modelo-seguridad.md](14-modelo-seguridad.md) | Santiago Vicente |
| 15 | Identidad: `auth-service`, usuarios, hash, login y token | [15-identidad.md](15-identidad.md) | Josué Ferreyra |
| 16 | Validación del JWT en cada servicio | [16-validacion-jwt.md](16-validacion-jwt.md) | Santiago Vicente |
| 17 | Propagación de la identidad entre servicios | [17-propagacion-identidad.md](17-propagacion-identidad.md) | Matías Porcari |
| 18 | Pruebas de seguridad y evidencias | [18-pruebas-seguridad.md](18-pruebas-seguridad.md) | Santiago Vicente |

## TP6: cambios respecto del TP5

Al implementar aparecieron huecos que el TP5 había dejado abiertos. Se resolvieron en la
ratificación ([`08-ratificacion-tp6.md`](08-ratificacion-tp6.md) §8.4, decisiones D1–D7) y
se listan todas, aunque ninguna rompe un contrato: el TP pide documentar toda modificación
respecto del TP5. Las responsabilidades, la propiedad de los datos y los contratos C1–C4 no
cambiaron.

| Cambio | Motivo concreto | Impacto | Decisión |
|---|---|---|---|
| Los followers de Inventario reenvían las escrituras al Leader, y los 3 nodos comparten el alias DNS `inventario-service` | Si Ventas apuntaba a un follower, todas las compras fallaban con el cluster sano | Ningún contrato cambia; Ventas sigue sin saber que Inventario usa Raft. `421`/`503` solo durante una elección | D1 |
| Las bases de los 3 nodos de Inventario están en un solo contenedor `inventario-db` (`inventario_nodo1..3`) | Igual que en el TP4; 3 contenedores Mongo sumaban infraestructura sin cambiar contratos | Ninguno: las tres bases son del mismo servicio | D2 |
| `RAFT_COMMIT_TIMEOUT_MS=2500` (antes 5000) | Con 5 s, un descuento podía confirmarse después de que Ventas (3 s) se rindió y mandó la compensación | Inventario responde `503` antes del timeout de Ventas | D3 |
| Los endpoints propuestos se implementan sin `/api` (salvo `/api/cluster/*`) | Que fichas, Swagger y código coincidan | Las URLs del TP4 (`/api/productos`) dejan de existir | D4 |
| En Compose solo HTTP; el HTTPS del TP4 queda en `app-base/` | El TP6 no exige TLS entre contenedores | Sin certificados en las imágenes | D5 |
| Se mantiene C4 (Inventario → Catálogo al dar de alta stock) | El TP5 la dejó con ⚠️ y una alternativa | Ninguno respecto de la ficha | D6 |
| Ventas guarda la compra como `FALLIDA` con `reintegroPendiente: true` si falla la compensación | Si C2 vencía por timeout y C3 también fallaba, la compra no se guardaba y no había dónde encolar el reintegro | Estado nuevo en Ventas, reintentado por el proceso de 30 s de `CANCELACION_PENDIENTE` | D7 |
| Los errores agregan el campo `servicio` (`{ error, servicio }`) | Saber qué servicio generó un error cuando una respuesta cruza servicios | El formato de `app-base/` se mantiene; solo se agrega un campo | Convención §8.3 |
| `POST` y `PUT /productos` rechazan con `400` cualquier campo que no sea `nombre`, `precio` o `categoria`, no solo `stock` | Que un campo de otro servicio (o mal escrito) no se ignore en silencio | Más estricto que la ficha, que solo menciona `stock` | Implementación de Catálogo |
| Después de un timeout de C2, un `404` de la compensación (C3) no es definitivo | El descuento puede aplicarse en Inventario después del `404` (se reprodujo en las pruebas) | La compra queda `FALLIDA` con `reintegroPendiente` y el reintento de 30 s la revierte; los contratos C1–C3 no cambian | Hallazgo de Ventas (`12` §12.7) |
| Un `409` de C2 puede venir sin `faltantes` (el lock del producto sigue ocupado después de `LOCK_WAIT_MS`) | Inventario espera el lock un tiempo corto antes de rechazar | Ventas lo traduce a un `409` con el mensaje de Inventario | Hallazgo de Ventas (`12` §12.7) |
| Una respuesta inesperada de una dependencia da `502` (C1 con código o formato inesperado; C2 con `400` u otro `4xx`) | El TP5 no definía este caso; la sección 15.2 del TP6 pide una respuesta controlada | Nuevo código de error en Ventas, distinto de `503` | Hallazgo de Ventas (`12` §12.7) |
| La cancelación marca primero `CANCELACION_PENDIENTE` (atómico) y después llama a C3 | Evita dos cancelaciones simultáneas y que una caída de Ventas deje una compra `CONFIRMADA` con el stock ya reintegrado | Estado nuevo en Ventas, cerrado por el proceso de reintentos | Hallazgo de Ventas (`12` §12.7) |
| El `503` de una compra informa `compraId` y `compensacion` (`reintegrado` / `pendiente`) cuando hubo que compensar | Que el cliente pueda consultar la compra `FALLIDA` y que el fallo sea observable | Campos nuevos en el cuerpo del error | Hallazgo de Ventas (`12` §12.7) |
| Con la base de Ventas caída, `POST /compras` responde `503` antes de llamar a Catálogo o Inventario | No descontar stock de una compra que después no se podría guardar | Ninguno en los contratos | Hallazgo de Ventas (`12` §12.7) |

## TP7: identidad y seguridad

El TP7 agrega quién es cada usuario y qué puede hacer, **sin cambiar** las responsabilidades, la
propiedad de los datos ni los contratos C1–C4 del TP6. Las decisiones D8–D16 están en
[`14-modelo-seguridad.md`](14-modelo-seguridad.md).

| Cambio | Motivo | Impacto | Decisión |
|---|---|---|---|
| Servicio nuevo `auth-service` (puerto 3400) con su base `auth-db` | No había un dueño de la identidad; ponerla en Ventas mezclaba credenciales con compras | Cuarto servicio y dos contenedores más (11 en total). Ningún otro servicio accede a `auth-db` | D8 |
| Access token JWT HS256 de 15 minutos con `sub`, `role`, `iss`, `iat`, `exp` | Que cada servicio pueda autorizar sin consultar a nadie | `JWT_SECRET` en los 4 servicios, por variable de entorno | D9 |
| Roles `CLIENTE`, `ADMIN` y `SERVICIO` | Separar quién compra, quién administra y la cuenta técnica de Ventas | Matriz de acceso por endpoint | D10 |
| Escrituras de Catálogo e Inventario solo `ADMIN`; C2 y C3 solo `SERVICIO` o `ADMIN`; compras solo del dueño o `ADMIN` | Que un cliente no pueda cambiar precios, mover stock salteando Ventas ni ver compras ajenas | `401` / `403` nuevos en las APIs. Las consultas (`GET /productos`, `GET /stock`) siguen públicas | D10, D13 |
| Ventas llama a Inventario con su propio token de servicio y envía el `usuarioId` del cliente en C2 | El reintento de 30 s no tiene el token del cliente, y un `CLIENTE` no debe poder descontar stock | C2 y C3 llevan `Authorization`; C2 agrega `usuarioId`. Flecha nueva Ventas → auth-service (login de la cuenta técnica) | D13 |
| Los tokens se validan localmente; nadie tiene `depends_on` hacia `auth-service` | Que una caída de `auth-service` no tire abajo las compras | Con `auth-service` caído solo fallan login y registro | D15 |
| `.env` de la raíz obligatorio (`JWT_SECRET`, `ADMIN_PASSWORD`, `VENTAS_SERVICE_PASSWORD`) | Que ningún secreto quede escrito en `compose.yml` | `docker compose up` falla con un mensaje claro si falta alguno | D16 |

Diagrama de despliegue del TP7: [`diagrama-arquitectura.md`](diagrama-arquitectura.md#despliegue-en-el-tp7-con-auth-service).

