/* ═══════════════════════════════════════════
   AUTH.JS — Sistema de autenticación
   Maneja: sesión, navbar dinámica, login modal
   ═══════════════════════════════════════════ */
console.debug('[auth.js] loaded');
(function () {
    const isSubpage = window.location.pathname.includes('/Paginas/');
    const paginasPath = isSubpage ? '.' : 'Paginas';

    /* ── Small helper to include credentials and optional bearer token ── */
    function apiFetch(url, opts = {}) {
        opts = Object.assign({}, opts);
        // ensure cookies are sent for same-origin requests
        if (!opts.credentials) opts.credentials = 'same-origin';

        // Normalize headers: allow either a Headers instance or a plain object
        const isHeadersInstance = (typeof Headers === 'function' && opts.headers instanceof Headers);
        if (!isHeadersInstance) opts.headers = Object.assign({}, opts.headers || {});

        try {
            const token = localStorage.getItem('token');
            if (token) {
                if (isHeadersInstance) {
                    if (!opts.headers.has('Authorization')) opts.headers.set('Authorization', 'Bearer ' + token);
                } else {
                    if (!opts.headers.Authorization && !opts.headers.authorization) opts.headers['Authorization'] = 'Bearer ' + token;
                }
            }
        } catch (e) { /* ignore localStorage errors */ }

        return fetch(url, opts).catch(err => {
            console.debug('[auth.js] apiFetch network error for', url, err);
            throw err;
        });
    }

    /* ── Check session on load ── */
    async function checkSession() {
        try {
            console.debug('[auth.js] checkSession: fetching /api/session');
            const res = await apiFetch('/api/session');
            console.debug('[auth.js] checkSession status:', res.status, res.statusText, res.headers && res.headers.get ? res.headers.get('content-type') : null);

            // Read raw text first so we can log non-JSON errors from the server (helps diagnose 500s)
            const text = await res.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                console.debug('[auth.js] checkSession invalid JSON response:', text);
                throw new Error('Invalid JSON from /api/session: ' + text);
            }

            console.debug('[auth.js] checkSession result:', data);
            updateNavbar(data.user);
            protectPage(data.user);
            return data.user;
        } catch (err) {
            console.debug('[auth.js] checkSession error:', err);
            updateNavbar(null);
            return null;
        }
    }

    /* ── Update navbar based on auth state ── */
    function updateNavbar(user) {
        const nav = document.querySelector('.nav-links');
        const authContainer = document.getElementById('nav-auth');
        if (!nav) return;

        // Usuarios link (admin/maestro only)
        let usuariosLink = document.getElementById('nav-usuarios');
        if (user && ['administrador', 'maestro'].includes(user.rol)) {
            if (!usuariosLink) {
                const link = document.createElement('a');
                link.id = 'nav-usuarios';
            link.href = 'usuarios.html';
                link.className = 'nav-link';
                link.textContent = 'Usuarios';
                const contactoLink = Array.from(nav.querySelectorAll('.nav-link')).find(
                    a => a.getAttribute('href') && a.getAttribute('href').includes('contacto')
                );
                if (contactoLink) {
                    nav.insertBefore(link, contactoLink);
                } else {
                    nav.appendChild(link);
                }
            }
        } else if (usuariosLink) {
            usuariosLink.remove();
        }

        // Auth buttons area
        if (authContainer) {
            if (user) {
                authContainer.innerHTML = `
                    <div class="nav-user-info">
                        <span class="nav-user-name">${escapeHtml(user.nombre)}</span>
                        <span class="nav-role-badge nav-role-${user.rol}">${user.rol}</span>
                    </div>
                    ${user.rol === 'administrador' ? `<a href="administrador.html" class="btn-admin-link">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                        Dashboard
                    </a>` : ''}
                    <button class="btn-logout" id="btn-logout">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        Cerrar Sesión
                    </button>
                `;
                document.getElementById('btn-logout').addEventListener('click', handleLogout);
            } else {
                // Mostrar botón de registro y login para usuarios no autenticados.
                const regOpen = (typeof window.REGISTRATION_OPEN !== 'undefined') ? Boolean(window.REGISTRATION_OPEN) : true;
                authContainer.innerHTML = `
                    ${regOpen ? `<a href="registro.html" class="btn-register" id="nav-register">Registro</a>` : `<button class="btn-register disabled" id="nav-register" disabled>Registro cerrado</button>`}
                    <button class="btn-login" id="btn-login">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                        Iniciar Sesión
                    </button>
                `;
                // If registration is closed, show a friendly alert instead of navigating
                const navRegisterEl = document.getElementById('nav-register');
                if (navRegisterEl && navRegisterEl.tagName === 'BUTTON') {
                    navRegisterEl.addEventListener('click', (e) => { e.preventDefault(); alert('Registro cerrado. No se permiten nuevos usuarios en este momento.'); });
                }
                document.getElementById('btn-login').addEventListener('click', showLoginModal);
            }
            // update mobile drawer contents if present
            if (typeof updateMobileDrawerContent === 'function') updateMobileDrawerContent();
        }
    }

    /* ── Protect pages ── */
    function protectPage(user) {
        const page = window.location.pathname;
            if (page.includes('administrador.html')) {
            if (!user || user.rol !== 'administrador') {
                window.location.href = 'index.html';
            }
        }
        if (page.includes('usuarios.html')) {
            if (!user || !['administrador', 'maestro'].includes(user.rol)) {
                window.location.href = 'index.html';
            }
        }
    }

    /* ── Login Modal ── */
    function createLoginModal() {
        if (document.getElementById('login-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'login-overlay';
        overlay.className = 'login-overlay';
        overlay.innerHTML = `
            <div class="login-card glass">
                <button class="login-close" id="login-close" type="button" aria-label="Cerrar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <div class="login-header">
                    <div class="login-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                    </div>
                    <h2 class="login-title">Iniciar Sesión</h2>
                    <p class="login-subtitle">Ingresa con tus credenciales para acceder al sistema</p>
                </div>
                <form id="login-form" novalidate>
                    <div class="form-group">
                        <label class="form-label" for="login-email">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                            Correo electrónico
                        </label>
                        <input id="login-email" class="form-input" type="email" placeholder="correo@ejemplo.com" required autocomplete="email">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="login-password">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            Contraseña
                        </label>
                        <input id="login-password" class="form-input" type="password" placeholder="••••••••" required autocomplete="current-password">
                    </div>
                    <span class="form-error visible" id="login-error" style="display:none;"></span>
                    <button type="submit" class="registro-submit login-submit-btn">
                        Iniciar Sesión
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </button>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);

        // Close events
        document.getElementById('login-close').addEventListener('click', hideLoginModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) hideLoginModal();
        });
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') {
                hideLoginModal();
                document.removeEventListener('keydown', escHandler);
            }
        });

        // Form submit
        document.getElementById('login-form').addEventListener('submit', handleLogin);
    }

    function showLoginModal() {
        createLoginModal();
        const overlay = document.getElementById('login-overlay');
        requestAnimationFrame(() => overlay.classList.add('active'));
        document.body.style.overflow = 'hidden';
    }

    function hideLoginModal() {
        const overlay = document.getElementById('login-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
            setTimeout(() => overlay.remove(), 300);
        }
    }

    /* ── Login handler ── */
    async function handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');

        if (!email || !password) {
            errorEl.textContent = 'Completa todos los campos';
            errorEl.style.display = 'block';
            return;
        }

        try {
            console.debug('[auth.js] handleLogin: sending login for', email);
            const res = await apiFetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            console.debug('[auth.js] handleLogin response:', res.status, data);

            if (!res.ok) {
                errorEl.textContent = data.error || 'Error al iniciar sesión';
                errorEl.style.display = 'block';
                return;
            }

            // Save token (if provided) as a fallback for API calls when cookies aren't available
            try { if (data && data.token) localStorage.setItem('token', data.token); } catch (e) { }

            hideLoginModal();
            // Redirect admin to dashboard, others to home with full reload
            if (data.user.rol === 'administrador') {
                window.location.href = 'administrador.html';
            } else {
                window.location.href = 'index.html';
                setTimeout(() => location.reload(), 100);
            }
        } catch (err) {
            console.debug('[auth.js] handleLogin error:', err);
            errorEl.textContent = 'Error de conexión con el servidor';
            errorEl.style.display = 'block';
        }
    }

    /* ── Logout handler ── */
    async function handleLogout() {
        try {
            await apiFetch('/api/logout', { method: 'POST' });
        } catch { /* ignore */ }
        try { localStorage.removeItem('token'); } catch (e) { }
        window.location.href = 'index.html';
    }

    /* ── Utility ── */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /* ── Mobile hamburger & drawer ── */
    function createMobileMenu() {
        if (document.getElementById('nav-hamburger')) return;
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;

        const hamburger = document.createElement('button');
        hamburger.id = 'nav-hamburger';
        hamburger.className = 'nav-hamburger';
        hamburger.setAttribute('aria-label', 'Abrir menú');
        hamburger.setAttribute('aria-expanded', 'false');
        hamburger.innerHTML = '<span class="hamb-lines" aria-hidden="true"><span></span><span></span><span></span></span>';
        // append hamburger to body so it remains above the drawer stacking context
        document.body.appendChild(hamburger);

        const drawer = document.createElement('div');
        drawer.id = 'nav-drawer';
        drawer.className = 'nav-drawer';
        drawer.setAttribute('aria-hidden', 'true');
        drawer.innerHTML = '<div class="drawer-inner"><div class="drawer-links"></div><div class="drawer-auth"></div></div>';
        document.body.appendChild(drawer);

        const strip = document.createElement('div');
        strip.id = 'nav-drawer-strip';
        strip.className = 'nav-drawer-strip';
        strip.title = 'Cerrar menú';
        strip.style.display = 'none';
        document.body.appendChild(strip);

        let _outsideClickHandler = null;
        function openDrawer() {
            drawer.classList.add('active');
            hamburger.setAttribute('aria-expanded', 'true');
            drawer.setAttribute('aria-hidden', 'false');
            strip.style.display = 'block';
            // close when clicking outside the drawer/hamburger
            _outsideClickHandler = (ev) => {
                const isInside = ev.target.closest('#nav-drawer') || ev.target.closest('#nav-hamburger');
                if (!isInside) closeDrawer();
            };
            // use capture so it fires before other handlers
            document.addEventListener('click', _outsideClickHandler, true);
        }
        function closeDrawer() {
            drawer.classList.remove('active');
            hamburger.setAttribute('aria-expanded', 'false');
            drawer.setAttribute('aria-hidden', 'true');
            strip.style.display = 'none';
            if (_outsideClickHandler) {
                document.removeEventListener('click', _outsideClickHandler, true);
                _outsideClickHandler = null;
            }
        }

        hamburger.addEventListener('click', () => {
            if (drawer.classList.contains('active')) closeDrawer(); else { updateMobileDrawerContent(); openDrawer(); }
        });
        strip.addEventListener('click', closeDrawer);

        // close on desktop resize
        window.addEventListener('resize', () => { if (window.innerWidth > 640 && drawer.classList.contains('active')) closeDrawer(); });

        // close when a link is clicked
        drawer.addEventListener('click', (e) => {
            const a = e.target.closest('a');
            if (a) closeDrawer();
        });
    }

    function updateMobileDrawerContent() {
        const drawer = document.getElementById('nav-drawer');
        if (!drawer) return;
        const drawerLinks = drawer.querySelector('.drawer-links');
        const drawerAuth = drawer.querySelector('.drawer-auth');
        drawerLinks.innerHTML = '';
        drawerAuth.innerHTML = '';

        const navLinks = document.querySelector('.nav-links');
        if (navLinks) {
            const cloneLinks = navLinks.cloneNode(true);
            cloneLinks.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
            drawerLinks.appendChild(cloneLinks);
        }

        const navAuth = document.getElementById('nav-auth');
        if (navAuth) {
            const cloneAuth = navAuth.cloneNode(true);
            cloneAuth.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
            drawerAuth.appendChild(cloneAuth);

            // attach handlers to cloned controls
            const clonedLogin = drawerAuth.querySelector('.btn-login');
            if (clonedLogin) clonedLogin.addEventListener('click', (ev) => { ev.preventDefault(); showLoginModal(); });
            const clonedLogout = drawerAuth.querySelector('.btn-logout');
            if (clonedLogout) clonedLogout.addEventListener('click', (ev) => { ev.preventDefault(); handleLogout(); });
        }
    }

    /* ── Expose for external use ── */
    window.authLogout = handleLogout;
    window.showLoginModal = showLoginModal;
    window.authCheckSession = checkSession;
    window.apiFetch = apiFetch;

    /* ── Init ── */
    createMobileMenu();
    checkSession();
})();
