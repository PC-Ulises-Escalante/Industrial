# Resumen del proyecto — Semana Académica 2026

Fecha: 2026-04-16

## Descripción

Sitio web informativo para la "Semana Académica 2026 — Ingeniería Industrial".
Permite mostrar agenda y ponentes, y gestionar usuarios (registro/login). Incluye un panel público con listado de ponentes y una UI para que el administrador agregue ponentes con foto.

## Estructura principal del repositorio

- `index.html` — Página principal (hero, agenda, sidebar con ponentes).
- `package.json` — Dependencias y scripts (arranque con `node server.js` / `npm start`).
- `server.js` — Servidor Express (API, base de datos, manejo de sesiones y carga de imágenes).
- `database.sqlite` — Base de datos SQLite (persistida por sql.js).
- `CSS Styles/` — Carpeta con hojas de estilo (ej. `styles.css`, `navbar.css`, `ponentes.css`, `registro.css`, etc.).
- `Images/` — Imágenes del sitio; `Images/ponentes/` almacena fotos subidas.
- `Javascript/` — Código cliente: `auth.js` (sesiones, navbar, drawer), `script.js` (animaciones y helpers).
- `Paginas/` — Páginas estáticas: `ponentes.html`, `registro.html`, `administrador.html`, `usuarios.html`.
- `tools/dump_users.js` — Script auxiliar para inspeccionar/volcar usuarios de la BD.

## Backend (resumen técnico)

- `server.js` ejecuta un servidor Express que expone las APIs principales:
  - `POST /api/register` — registro de usuario (contraseña con `bcryptjs`, rol, sesiones).
  - `POST /api/login` — autenticación (inicia sesión).
  - `GET /api/session` — devuelve información de sesión actual.
  - `GET /api/ponentes` — lista de ponentes.
  - `POST /api/ponentes` — crea un ponente; acepta `imageData` (base64) y guarda la imagen en `Images/ponentes/` guardando `foto_path` en la BD.

- La app usa `express-session` para sesiones; las contraseñas se almacenan hasheadas con `bcryptjs`.
- Se utiliza una base de datos SQLite persistida (archivo `database.sqlite`) gestionada por utilidades internas (`queryOne`, `queryAll`, `saveDb`).
- Se aumentó el límite de body para aceptar imágenes (p. ej. `express.json({ limit: '10mb' })`) y se añadió middleware para capturar JSON mal formado y devolver 400 en lugar de crash.

## Frontend (resumen técnico)

- Páginas estáticas en `Paginas/` y recursos compartidos en `CSS Styles/` y `Javascript/`.
- `Paginas/ponentes.html`:
  - Muestra lista de ponentes desde `GET /api/ponentes`.
  - Contiene un botón flotante pequeño (+) para administradores que abre un modal de "Agregar ponente".
  - Modal con selector de foto estilizado (input file oculto + label personalizado), preview y envío como base64 al servidor.
  - Modal se cierra con Escape y con clic fuera; se posiciona dinámicamente debajo del `nav` (se usa un `EXTRA_OFFSET`).
- `Paginas/registro.html`: se agregaron campos `password` y `password_confirm` con validación cliente; al registrarse correctamente se redirige a la página principal.
- `Javascript/auth.js`:
  - Maneja sesión, actualización del navbar, el login/register en cliente.
  - Implementa el menú móvil: botón hamburguesa que abre un drawer lateral (derecha).
  - Drawer clona `.nav-links` y zona de `#nav-auth` para mostrar enlaces en móvil.
  - El botón hamburguesa ahora es `position: fixed` con `z-index` alto para permanecer visible sobre el drawer.

## Estilos y UI notables

- `CSS Styles/navbar.css` contiene reglas responsivas para ocultar la nav en móvil y mostrar el `nav-hamburger` + `nav-drawer`.
- El drawer usa fondo oscuro semi-transparente y `backdrop-filter: blur(8px)`; los enlaces del drawer tienen fondo semitransparente para mejor legibilidad.
- Las fotos de ponentes se guardan en disco y la ruta se muestra en el frontend como `src` relativo.

## Cómo ejecutar (rápido)

1. Abrir terminal en la raíz del proyecto:

```powershell
cd "c:\Users\ke5469\Entorno_Pruebas webS\Entorno_Pruebas web"
npm install
npm start
```

o directamente:

```powershell
node server.js
```

2. Abrir en el navegador: `http://localhost:3000` (puerto por defecto). Si hay conflicto de puerto (`EADDRINUSE`) hay que cerrar procesos node existentes o cambiar `PORT`.

## Notas y detalles importantes

- Las imágenes enviadas desde el modal se convierten a base64 en el cliente y el servidor las decodifica y escribe en `Images/ponentes/`.
- Asegúrate de que la carpeta `Images/ponentes/` tenga permisos de escritura si ejecutas en un servidor distinto.
- El proyecto tiene protección por roles; algunas acciones (guardar ponentes) deben estar restringidas a usuarios con rol `admin`.

## Archivos clave (referencias rápidas)

- `server.js` — punto de entrada y API.
- `Paginas/ponentes.html` — modal + listado de ponentes.
- `Paginas/registro.html` — formulario de registro con contraseña.
- `CSS Styles/navbar.css`, `CSS Styles/ponentes.css`, `CSS Styles/styles.css` — estilos principales.
- `Javascript/auth.js` — lógica de sesión, navbar y menu móvil.

## TODO / mejoras pendientes

- Mover estilos inline del modal a `CSS Styles/ponentes.css` para centralizar estilos.
- Reemplazar `alert()` con un componente de toast no bloqueante en todas las páginas.
- Añadir endpoints y UI para editar/eliminar ponentes (CRUD completo).
- Validación y sanitización de imágenes (tipo/size) antes de guardarlas.
- Añadir pruebas automatizadas y documentación de despliegue.

