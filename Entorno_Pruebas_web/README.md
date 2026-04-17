# Semana Académica 2026 — README

Este repositorio contiene la web estática y el backend (Express) para la Semana Académica 2026.

Resumen rápido
- Backend: `server.js` (expone la API en `/api/*`).
- Funciona en modo local con SQLite por defecto (`database.sqlite`).
- Para producción se recomienda usar Postgres y JWT (ya soportado mediante `lib/db.js` y `lib/jwt.js`).
- Funciones serverless: `api/index.js` adapta `app` para Vercel.

Archivos importantes
- **Migración**: [tools/migrate_sqlite_to_postgres.js](tools/migrate_sqlite_to_postgres.js#L1)
- **Adaptador DB**: [lib/db.js](lib/db.js#L1)
- **Server**: [server.js](server.js#L1)
- **Serverless handler**: [api/index.js](api/index.js#L1)

Requisitos
- Node.js 18+ (recomendado)
- Postgres (si vas a usar `DATABASE_URL`)

Instalación local
1. Instala dependencias:

```bash
npm install
```

2. Ejecutar con SQLite (fallback por defecto):

```bash
npm start
# o
node server.js
```

Nota: el servidor si no encuentra Postgres utiliza `database.sqlite` y crea tablas/seed automáticamente.

Migración a Postgres (script)
- El proyecto incluye `tools/migrate_sqlite_to_postgres.js` que lee el `database.sqlite` y copia filas a Postgres.
- Opciones importantes:
  - `--db <ruta>`: ruta al archivo sqlite (por defecto `./database.sqlite`).
  - `--clean` o `-c`: trunca tablas objetivo antes de insertar.

Ejemplos:

Linux/macOS:
```bash
DATABASE_URL='postgres://USER:PASS@HOST:5432/DBNAME' \
JWT_SECRET='mi-secreto-fuerte' \
node tools/migrate_sqlite_to_postgres.js --clean
```

PowerShell (Windows):
```powershell
$env:DATABASE_URL='postgres://USER:PASS@HOST:5432/DBNAME'; \
$env:JWT_SECRET='mi-secreto-fuerte'; \
node tools/migrate_sqlite_to_postgres.js --clean
```

Despliegue en Vercel — qué configurar

1) Root / Build
- Asegúrate de que el **Root Directory** del proyecto en Vercel apunte a la carpeta que contiene `package.json` y el directorio `api/` (por ejemplo la carpeta del proyecto principal). Vercel detecta las funciones en `api/` y servirá los estáticos desde `public/`.

2) Variables de entorno (mínimas)
- **DATABASE_URL**: cadena de conexión Postgres. Formato ejemplo:

```
postgres://USER:PASSWORD@HOST:PORT/DATABASE
```

- **JWT_SECRET**: secreto fuerte para firmar tokens JWT.
- **PGSSLMODE**: pon `1` o `require` si tu proveedor necesita SSL.
- **PG_MAX_CLIENTS**: (opcional) número máximo de clientes en el pool (recomendado 2-5 en serverless).

Dónde añadir las variables (UI):
- Entra a tu proyecto en Vercel → Settings → Environment Variables → Add
  - Name: `DATABASE_URL`  Value: `postgres://...`  Environment: `Production` (y agrega en `Preview` si quieres).
  - Repite para `JWT_SECRET`, `PGSSLMODE`, `PG_MAX_CLIENTS`.

Dónde añadir las variables (CLI):

```bash
npm i -g vercel
vercel login
vercel env add DATABASE_URL production
vercel env add JWT_SECRET production
vercel env add PGSSLMODE production
```

3) Recomendaciones para Postgres en serverless
- Usa `PG_MAX_CLIENTS=2` o `3` para evitar agotar conexiones.
- Si tu proveedor ofrece un pooler (pgbouncer) o modalidad serverless (Neon, Supabase), sigue sus recomendaciones.

4) Despliegue
- Con las env vars configuradas, despliega desde la UI vinculando el repo, o usa la CLI:

```bash
vercel --prod
```

Comprobaciones post-deploy
- Verifica `/api/session` y `/api/stats` en la URL de producción.
- Asegúrate de que el `admin` fue creado (el proceso de `initDb()` crea un admin por defecto si no existe).

Problemas comunes
- Error SSL: prueba a setear `PGSSLMODE=1` o añade `?sslmode=require` en la cadena de conexión.
- Tablas no vacías al migrar: ejecuta el script con `--clean` para truncar antes.

¿Siguiente paso?
- Puedo ejecutar el script de migración localmente si me das `DATABASE_URL` (o lo ejecutas tú y me pegas la salida). También puedo añadir instrucciones para crear el proyecto en Vercel (paso a paso con capturas de comandos CLI) si quieres.

***
Archivo de referencia de ejecución rápida:

- `tools/migrate_sqlite_to_postgres.js` — script de migración
- `server.js` — servidor principal (inicializa DB con `initDb()`)

Gracias — dime si quieres que ejecute la migración localmente o que genere comandos para la importación a un proveedor específico (Supabase/Neon/Heroku).
