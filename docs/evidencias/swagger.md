# Swagger

**Objetivo:** cada servicio documenta en `/api-docs` exactamente lo que implementa, incluidos
los contratos C1–C4 con sus respuestas.

| Servicio | URL | Contratos que documenta |
|---|---|---|
| Catálogo | <http://localhost:3100/api-docs> | C1 `GET /productos?ids=…` · C4 `GET /productos/:id` |
| Inventario | <http://localhost:3201/api-docs> | C2 `POST /descuentos` · C3 `DELETE /descuentos/:referencia` |
| Ventas | <http://localhost:3300/api-docs> | — (es consumidor) |

Pasos: abrir cada URL, ejecutar "Try it out" en un endpoint de cada servicio (por ejemplo
`GET /categorias` en Catálogo) y verificar que la respuesta coincida con la documentada.

```bash
curl -s http://localhost:3100/api-docs.json | node -e "process.stdin.on('data',d=>console.log(Object.keys(JSON.parse(d).paths)))"
```

## Salida obtenida

_Pendiente de ejecutar (con captura de "Try it out" en cada servicio)._
