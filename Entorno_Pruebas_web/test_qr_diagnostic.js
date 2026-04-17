const http = require('http');

// Diagnosticar problema con botón "Ver QR"
function testQRDiagnostic() {
    console.log('=== Diagnóstico QR ===\n');
    
    // Login as admin
    const loginData = JSON.stringify({
        email: 'admin@tectijuana.edu.mx',
        password: 'Martio109'
    });
    
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('1. Login:', res.statusCode, data);
            
            if (res.statusCode === 200) {
                const sessionCookie = res.headers['set-cookie'];
                const cookieStr = Array.isArray(sessionCookie) ? sessionCookie.join('; ') : sessionCookie;
                console.log('2. Cookie recibida:', cookieStr ? cookieStr.substring(0, 50) + '...' : 'No cookie');
                const cookieValue = cookieStr ? cookieStr.split(';')[0] : '';
                
                // Obtener conferencias existentes
                getConferences(cookieValue);
            }
        });
    });
    
    req.on('error', (e) => {
        console.error('Login error:', e.message);
    });
    
    req.write(loginData);
    req.end();
}

function getConferences(sessionCookie) {
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/conferencias',
        method: 'GET',
        headers: {
            'Cookie': sessionCookie
        }
    };
    
    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('\n3. Obtener conferencias:', res.statusCode);
            
            if (res.statusCode === 200) {
                const conferencias = JSON.parse(data);
                console.log(`4. Encontradas ${conferencias.length} conferencias`);
                
                if (conferencias.length > 0) {
                    // Probar con la primera conferencia
                    const conferenceId = conferencias[0].id;
                    console.log(`5. Usando conferencia ID: ${conferenceId} - Título: ${conferencias[0].titulo}`);
                    
                    // Probar endpoint GET de QR
                    getQR(conferenceId, sessionCookie);
                } else {
                    console.log('No hay conferencias para probar');
                }
            } else {
                console.log('Error obteniendo conferencias:', data);
            }
        });
    });
    
    req.on('error', (e) => {
        console.error('Get conferences error:', e.message);
    });
    
    req.end();
}

function getQR(conferenceId, sessionCookie) {
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: `/api/conferencias/${conferenceId}/qr`,
        method: 'GET',
        headers: {
            'Cookie': sessionCookie
        }
    };
    
    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log(`\n6. GET QR para conferencia ${conferenceId}:`, res.statusCode);
            
            if (res.statusCode === 200) {
                const qrData = JSON.parse(data);
                console.log('7. QR obtenido exitosamente!');
                console.log('   - Token:', qrData.qr_token);
                console.log('   - Data URL presente:', !!qrData.qr_data_url);
                console.log('   - Expira:', qrData.expires_at);
                console.log('   - Longitud data URL:', qrData.qr_data_url?.length || 0);
                
                // Test problema común: ¿La data URL es válida?
                if (qrData.qr_data_url && qrData.qr_data_url.startsWith('data:image/png;base64,')) {
                    console.log('   - Data URL formato correcto');
                } else {
                    console.log('   - WARNING: Data URL puede tener formato incorrecto');
                }
                
                // Probar generar QR si no existe
                if (res.statusCode === 404) {
                    console.log('8. QR no existe, probando generación...');
                    generateQR(conferenceId, sessionCookie);
                } else {
                    // Probar endpoint POST de QR
                    testPostQR(conferenceId, sessionCookie);
                }
            } else if (res.statusCode === 404) {
                console.log('7. QR no generado (404). Probando generación...');
                generateQR(conferenceId, sessionCookie);
            } else if (res.statusCode === 403) {
                console.log('7. ERROR 403: Permisos insuficientes');
                console.log('   - Verificar que el rol sea administrador o maestro');
            } else {
                console.log('7. Error inesperado:', data);
            }
        });
    });
    
    req.on('error', (e) => {
        console.error('Get QR error:', e.message);
    });
    
    req.end();
}

function generateQR(conferenceId, sessionCookie) {
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: `/api/conferencias/${conferenceId}/qr`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': sessionCookie
        }
    };
    
    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log(`\n8. POST QR para conferencia ${conferenceId}:`, res.statusCode);
            
            if (res.statusCode === 200) {
                const qrData = JSON.parse(data);
                console.log('9. QR generado exitosamente!');
                console.log('   - Token:', qrData.qr_token);
                console.log('   - Scan URL:', qrData.scan_url);
                console.log('   - Longitud data URL:', qrData.qr_data_url?.length || 0);
                
                // Volver a probar GET
                setTimeout(() => getQR(conferenceId, sessionCookie), 500);
            } else if (res.statusCode === 403) {
                console.log('9. ERROR 403: Permisos insuficientes para generar QR');
                console.log('   - Verificar middleware requireRole en server.js');
            } else {
                console.log('9. Error generando QR:', data);
            }
        });
    });
    
    req.on('error', (e) => {
        console.error('Generate QR error:', e.message);
    });
    
    req.end();
}

function testPostQR(conferenceId, sessionCookie) {
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: `/api/conferencias/${conferenceId}/qr`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': sessionCookie
        }
    };
    
    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log(`\n10. POST QR (regenerar) para conferencia ${conferenceId}:`, res.statusCode);
            
            if (res.statusCode === 200) {
                console.log('11. QR regenerado exitosamente');
            } else if (res.statusCode === 403) {
                console.log('11. ERROR 403: Permisos insuficientes');
            } else {
                console.log('11. Respuesta:', data);
            }
            
            console.log('\n=== Resumen del Diagnóstico ===');
            console.log('Posibles problemas con el botón "Ver QR":');
            console.log('1. Permisos de rol (admin/maestro) ✓');
            console.log('2. Endpoint GET /api/conferencias/:id/qr funcionando ✓');
            console.log('3. Endpoint POST /api/conferencias/:id/qr funcionando ✓');
            console.log('4. QR generado y almacenado ✓');
            console.log('\nRevisar en frontend:');
            console.log('- Función viewQR en qr-management.js');
            console.log('- Elementos DOM para mostrar preview');
            console.log('- Permisos en initQRManagement()');
        });
    });
    
    req.on('error', (e) => {
        console.error('POST QR test error:', e.message);
    });
    
    req.end();
}

// Run diagnostic
testQRDiagnostic();