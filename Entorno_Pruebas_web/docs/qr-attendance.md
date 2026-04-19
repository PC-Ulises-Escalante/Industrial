# Escaneo QR y toma de asistencia — Deportes, Conferencias y Proyectos

Resumen rápido
- El sistema genera QR (token UUID v4 + imagen dataURL) para eventos: conferencias, equipos deportivos y proyectos.
- Los QR se guardan en tablas específicas (`conferencia_qr_codes`, `deportes_qr_codes`, `proyectos_qr_codes`) con `expires_at` (7 días).
- El registro de asistencia lo hace el servidor al recibir una petición POST a un endpoint de "scan" que contiene el token. Solo alumnos autenticados pueden registrar asistencia.

Componentes implicados
- Frontend: páginas públicas /admin (UI de generación y vista de QR): `conferencias.html`, `deportes.html`, `proyectos.html`.
- Backend (Express): endpoints API para generar, ver y escanear QR.
- Base de datos: tablas de QR y tablas de asistencias (asistencias_conferencias, asistencias_deportes, asistencias_proyectos).

Flujo principal (alto nivel)
1. Generación del QR (por admin/maestro)
   - Endpoint: POST /api/conferencias/:id/qr  (equivalente para deportes y proyectos)
   - El servidor crea `qr_token` (uuidv4), construye `scan_url`:
     `https://<host>/api/{recurso}/qr/scan/{qr_token}`
   - Genera `qr_data_url` (imagen PNG base64) y guarda registro en DB con `expires_at` (~7 días).
   - Respuesta JSON: { qr_token, qr_data_url, scan_url, expires_at }.

2. Visualización del QR
   - La UI de administración muestra `qr_data_url` y el `scan_url`. El `scan_url` es el enlace que contiene el token.

3. Escaneo por parte del alumno (registro de asistencia)
   - Requisito: el alumno debe estar autenticado (sesión cookie o `Authorization: Bearer <token>`).
   - Endpoint de registro (ejemplos):
     - Conferencias: POST /api/conferencias/qr/scan/:token
     - Deportes: POST /api/deportes/qr/scan/:token
     - Proyectos: POST /api/proyectos/qr/scan/:token
   - Validaciones que hace el servidor:
     - Token existe y no está expirado (busca en la tabla correspondiente).
     - Usuario autenticado y con `rol === 'alumno'`.
     - Límite de asistencias por usuario en esa categoría: si `horario === 'vespertino'` → máximo 4, sino máximo 2. (Se cuenta el total de registros del usuario en la tabla correspondiente.)
     - El alumno no haya registrado asistencia ya para ese evento (unique por recurso_id + user_id).
   - Si pasa validaciones, se inserta un registro en la tabla `asistencias_*` con `qr_token` y `scanned_at` y se devuelve success JSON.

Rutas administrativas / consulta de asistencias
- Obtener QR (solo admin/maestro):
  - GET /api/conferencias/:id/qr
  - GET /api/deportes/equipos/:id/qr
  - GET /api/proyectos/:id/qr
- Listar asistencias por evento (solo admin/maestro):
  - GET /api/conferencias/:id/asistencias
  - GET /api/deportes/equipos/:id/asistencias
  - GET /api/proyectos/:id/asistencias
- Listar asistencias por usuario (alumno o admin):
  - GET /api/conferencias/asistencias/:userId?
  - GET /api/deportes/asistencias/:userId?
  - GET /api/proyectos/asistencias/:userId?

Detalles técnicos importantes
- Token y URL generada:
  - `qr_token` es un UUID v4 (valor único). `scan_url` apunta al endpoint POST `/api/.../qr/scan/:token`.
  - `qr_data_url` es una data URL (data:image/png;base64,...).
- Autenticación
  - El backend acepta sesión en cookie (`res.cookie('token', ...)`) o JWT Bearer en `Authorization`.
  - Para que el POST de registro funcione, la petición debe incluir credenciales (`credentials: 'include'`) o el header Authorization.
- Lógica de límites y duplicados
  - Se calcula cuántas asistencias totales tiene el alumno en la categoría (conferencias/deportes/proyectos) y se compara con `maxAsistencias` (4 o 2 según `horario`).
  - También se verifica si ya existe un registro para el mismo evento (evita duplicados).

Problemas habituales y soluciones
- Error 401 (No autenticado): el alumno no está logueado; pedir que inicie sesión antes de escanear.
- Error 403 (No autorizado): el usuario no tiene rol `alumno` (p. ej. admin o invitado). Solo alumnos registran asistencias.
- Error 404 / 400 (QR inválido o expirado): el token no existe o `expires_at` ya pasó.
- Error 400 (Límite alcanzado / Ya registrado): revisar el campo `horario` del alumno y las entradas en `asistencias_*`.
- Nota práctica: muchos escáneres QR abren la URL con GET. Los endpoints de scan esperan POST — por eso se recomienda usar una "landing page" que haga la petición POST automáticamente (ver más abajo).

Ejemplos: curl para pruebas
- Login (guardar cookie):
```bash
curl -c admin_cookies.txt -H "Content-Type: application/json" \
  -d '{"email":"admin@tectijuana.edu.mx","password":"Martio109"}' \
  http://localhost:3000/api/login
```

- Generar QR (como admin) para conferencia id=1:
```bash
curl -b admin_cookies.txt -X POST http://localhost:3000/api/conferencias/1/qr
```

- Ver QR (como admin):
```bash
curl -b admin_cookies.txt http://localhost:3000/api/conferencias/1/qr
```

- Simular escaneo por alumno (login alumno y POST al token):
```bash
# Login alumno (guardar cookie)
curl -c alumno_cookies.txt -H "Content-Type: application/json" \
  -d '{"email":"alumno@example.com","password":"su_pass"}' \
  http://localhost:3000/api/login

# Registrar asistencia (usar token obtenido del QR)
curl -b alumno_cookies.txt -X POST http://localhost:3000/api/conferencias/qr/scan/<QR_TOKEN>
```

Ejemplo de fetch en una "landing page" (recomendado)
- Si el QR apunta a la ruta `https://tusitio/qr/scan/<token>` (GET), esa página puede llamar al endpoint POST internamente para registrar asistencia, así evitas depender de que el app-scanner haga POST.

HTML de ejemplo (scan-landing.html):
```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Registrar asistencia</title></head>
<body>
  <div id="msg">Registrando asistencia...</div>
  <script>
    async function register() {
      try {
        const parts = location.pathname.split('/');
        const token = parts[parts.length-1];
        // Detectar tipo de recurso en la URL si lo incluyes en la ruta (conferencias/deportes/proyectos)
        // Ej: /qr/scan/conferencias/<token> -> resource = 'conferencias'
        // Aquí asumimos que el token se corresponde con la ruta de API de conferencias (ajusta según generación)
        const apiScanUrl = `/api/conferencias/qr/scan/${token}`; // o /api/deportes/qr/scan/

        const res = await fetch(apiScanUrl, { method: 'POST', credentials: 'include' });
        const data = await res.json();
        if (res.ok) document.getElementById('msg').textContent = data.message || 'Asistencia registrada';
        else document.getElementById('msg').textContent = data.error || 'Error al registrar asistencia';
      } catch (err) {
        document.getElementById('msg').textContent = 'Error de conexión';
        console.error(err);
      }
    }
    register();
  </script>
</body>
</html>
```

Recomendaciones prácticas
- Recomendado: generar un endpoint GET público `/qr/scan/:resource/:token` que sirva un `scan-landing.html` como el anterior y que detecte el `resource` (conferencias/deportes/proyectos). Así el QR puede apuntar a `/qr/scan/conferencias/<token>` y la página se encargará de POSTear al API adecuado.
- Asegurar que el front use `credentials: 'include'` si confía en cookies de sesión; para móviles es más robusto usar un flujo con JWT Bearer tokens.
- Registrar logs de servidor para detectar tokens expirados o errores 403/401.

Tablas clave en la DB
- conferencia_qr_codes (conferencia_id, qr_token, qr_data_url, expires_at)
- deportes_qr_codes (equipo_id, qr_token, qr_data_url, expires_at)
- proyectos_qr_codes (proyecto_id, qr_token, qr_data_url, expires_at)
- asistencias_conferencias (conferencia_id, user_id, qr_token, scanned_at)
- asistencias_deportes (equipo_id, user_id, qr_token, scanned_at)
- asistencias_proyectos (proyecto_id, user_id, qr_token, scanned_at)

¿Quieres que añada la página `qr/scan` (landing) y la ruta GET para automatizar el POST desde el QR? Si quieres, la creo y añado el HTML/route de ejemplo.
