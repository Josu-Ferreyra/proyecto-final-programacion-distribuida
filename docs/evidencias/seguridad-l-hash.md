# Evidencia · L — Hash en la base

**Objetivo (TP7 §19, escenario L):** en la base de `auth-service` la password se guarda como hash bcrypt y no aparece en ningún lado.

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

Comandos (`$ …`) y salida obtenida:

```text
$ docker compose exec auth-db mongosh auth --quiet --eval 'db.usuarios.findOne({ email: "cliente-a@tp7.local" }, { email: 1, passwordHash: 1 })'
{
  _id: ObjectId('6ae28466a9973f47364822ab'),
  email: 'cliente-a@tp7.local',
  passwordHash: '$2b$12$T9.QbW1ogn76.SlWB8WJ8O77/ffruxsn0mAD.ehTrWwesZT4znOPG'
}

# Todos los usuarios: ningún documento tiene un campo con la password
$ docker compose exec auth-db mongosh auth --quiet --eval 'db.usuarios.find({}, { _id: 0, email: 1, rol: 1, activo: 1, campos: { $objectToArray: "$$ROOT" } }).toArray().map(u => ({ email: u.email, rol: u.rol, campos: u.campos.map(c => c.k).join(",") }))'
[
  {
    email: 'admin@tp7.local',
    rol: 'ADMIN',
    campos: '_id,email,passwordHash,rol,activo,createdAt,updatedAt,__v'
  },
  {
    email: 'ventas@servicio.local',
    rol: 'SERVICIO',
    campos: '_id,email,passwordHash,rol,activo,createdAt,updatedAt,__v'
  },
  {
    email: 'cliente-a@tp7.local',
    rol: 'CLIENTE',
    campos: '_id,email,passwordHash,rol,activo,createdAt,updatedAt,__v'
  },
  {
    email: 'quiere-ser-admin@tp7.local',
    rol: 'CLIENTE',
    campos: '_id,email,passwordHash,rol,activo,createdAt,updatedAt,__v'
  }
]

# La password de prueba no aparece en la base ni en los logs
$ docker compose exec auth-db mongosh auth --quiet --eval 'JSON.stringify(db.usuarios.find().toArray()).includes("Clave-de-prueba-A1")'
false

$ docker compose logs auth-service | grep -c 'Clave-de-prueba-A1'
0
```

**Resultado:** ✅ `passwordHash: "$2b$12$…"`: bcrypt versión `2b` con costo 12 y el salt incluido en el propio hash. Ningún documento tiene un campo con la password, el texto de la password de prueba no aparece en la base ni en los logs de `auth-service`.
