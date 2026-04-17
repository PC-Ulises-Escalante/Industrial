// QR Management for Conference Attendance
// Only visible to staff/admin roles

document.addEventListener('DOMContentLoaded', () => {
    // Wait for auth to load
    setTimeout(initQRManagement, 500);
});

async function initQRManagement() {
    try {
        const sessionRes = await fetch('/api/session');
        if (!sessionRes.ok) return;
        const session = await sessionRes.json();
        if (!session.user) return;
        
        const userRole = session.user.rol;
        const isStaffOrAdmin = userRole === 'administrador' || userRole === 'maestro';
        
        if (!isStaffOrAdmin) return;
        
        // Add QR functionality to conference cards
        addQRButtonsToConferences();
        
        // Listen for conference list updates
        observeConferenceGrid();
    } catch (err) {
        console.error('QR management init error:', err);
    }
}

function observeConferenceGrid() {
    // Watch for changes in the conference grid to re-add QR buttons
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
                addQRButtonsToConferences();
            }
        });
    });
    
    const grid = document.getElementById('conferencias-grid');
    if (grid) {
        observer.observe(grid, { childList: true, subtree: true });
    }
}

async function addQRButtonsToConferences() {
    const cards = document.querySelectorAll('.conferencia-card');
    if (!cards.length) return;
    
    // Check user role again
    let userRole = null;
    try {
        const sessionRes = await fetch('/api/session');
        if (sessionRes.ok) {
            const session = await sessionRes.json();
            userRole = session.user?.rol;
        }
    } catch (e) { return; }
    
    const isStaffOrAdmin = userRole === 'administrador' || userRole === 'maestro';
    if (!isStaffOrAdmin) return;
    
    cards.forEach(card => {
        // Check if QR button already exists
        if (card.querySelector('.qr-management-section')) return;
        
        const conferenceId = getConferenceIdFromCard(card);
        if (!conferenceId) return;
        
        const actionsDiv = card.querySelector('.conferencia-actions');
        if (!actionsDiv) return;
        
        // Create QR management section
        const qrSection = document.createElement('div');
        qrSection.className = 'qr-management-section';
        qrSection.style.marginTop = '12px';
        qrSection.style.paddingTop = '12px';
        qrSection.style.borderTop = '1px solid rgba(148, 163, 184, 0.1)';
        
        // QR status display
        const statusDiv = document.createElement('div');
        statusDiv.className = 'qr-status';
        statusDiv.style.display = 'flex';
        statusDiv.style.alignItems = 'center';
        statusDiv.style.justifyContent = 'space-between';
        statusDiv.style.marginBottom = '8px';
        
        const statusText = document.createElement('span');
        statusText.className = 'qr-status-text';
        statusText.style.fontSize = '0.8rem';
        statusText.style.color = 'var(--slate-400)';
        statusText.textContent = 'Cargando QR...';
        
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'qr-actions';
        actionsContainer.style.display = 'flex';
        actionsContainer.style.gap = '6px';
        
        // Generate QR button
        const generateBtn = document.createElement('button');
        generateBtn.className = 'btn-generate-qr';
        generateBtn.textContent = 'Generar QR';
        generateBtn.style.padding = '4px 8px';
        generateBtn.style.fontSize = '0.75rem';
        generateBtn.style.borderRadius = '4px';
        generateBtn.style.background = 'rgba(34, 211, 238, 0.1)';
        generateBtn.style.color = 'var(--cyan)';
        generateBtn.style.border = '1px solid rgba(34, 211, 238, 0.2)';
        generateBtn.style.cursor = 'pointer';
        generateBtn.dataset.conferenceId = conferenceId;
        
        // View QR button (initially hidden)
        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn-view-qr';
        viewBtn.textContent = 'Ver QR';
        viewBtn.style.padding = '4px 8px';
        viewBtn.style.fontSize = '0.75rem';
        viewBtn.style.borderRadius = '4px';
        viewBtn.style.background = 'rgba(139, 92, 246, 0.1)';
        viewBtn.style.color = 'var(--purple)';
        viewBtn.style.border = '1px solid rgba(139, 92, 246, 0.2)';
        viewBtn.style.cursor = 'pointer';
        viewBtn.dataset.conferenceId = conferenceId;
        viewBtn.style.display = 'none';
        
        // View attendance button
        const attendanceBtn = document.createElement('button');
        attendanceBtn.className = 'btn-view-attendance';
        attendanceBtn.textContent = 'Asistencias';
        attendanceBtn.style.padding = '4px 8px';
        attendanceBtn.style.fontSize = '0.75rem';
        attendanceBtn.style.borderRadius = '4px';
        attendanceBtn.style.background = 'rgba(34, 197, 94, 0.1)';
        attendanceBtn.style.color = 'var(--green)';
        attendanceBtn.style.border = '1px solid rgba(34, 197, 94, 0.2)';
        attendanceBtn.style.cursor = 'pointer';
        attendanceBtn.dataset.conferenceId = conferenceId;
        
        actionsContainer.appendChild(generateBtn);
        actionsContainer.appendChild(viewBtn);
        actionsContainer.appendChild(attendanceBtn);
        
        statusDiv.appendChild(statusText);
        statusDiv.appendChild(actionsContainer);
        
        // QR preview container (hidden by default)
        const previewContainer = document.createElement('div');
        previewContainer.className = 'qr-preview-container';
        previewContainer.style.display = 'none';
        previewContainer.style.textAlign = 'center';
        previewContainer.style.marginTop = '12px';
        previewContainer.style.padding = '12px';
        previewContainer.style.background = 'rgba(0, 0, 0, 0.2)';
        previewContainer.style.borderRadius = '8px';
        
        const qrImage = document.createElement('img');
        qrImage.className = 'qr-image';
        qrImage.style.maxWidth = '200px';
        qrImage.style.margin = '0 auto';
        qrImage.style.display = 'block';
        
        const scanUrl = document.createElement('div');
        scanUrl.className = 'qr-scan-url';
        scanUrl.style.fontSize = '0.7rem';
        scanUrl.style.color = 'var(--slate-500)';
        scanUrl.style.marginTop = '8px';
        scanUrl.style.wordBreak = 'break-all';
        
        const closePreviewBtn = document.createElement('button');
        closePreviewBtn.textContent = 'Cerrar';
        closePreviewBtn.style.marginTop = '8px';
        closePreviewBtn.style.padding = '2px 8px';
        closePreviewBtn.style.fontSize = '0.7rem';
        closePreviewBtn.style.background = 'rgba(239, 68, 68, 0.1)';
        closePreviewBtn.style.color = 'var(--red)';
        closePreviewBtn.style.border = '1px solid rgba(239, 68, 68, 0.2)';
        closePreviewBtn.style.borderRadius = '4px';
        closePreviewBtn.style.cursor = 'pointer';
        
        previewContainer.appendChild(qrImage);
        previewContainer.appendChild(scanUrl);
        previewContainer.appendChild(closePreviewBtn);
        
        qrSection.appendChild(statusDiv);
        qrSection.appendChild(previewContainer);
        
        // Insert after the original actions div
        actionsDiv.parentNode.insertBefore(qrSection, actionsDiv.nextSibling);
        
        // Load QR status
        loadQRStatus(conferenceId, statusText, viewBtn, generateBtn);
        
        // Add event listeners
        generateBtn.addEventListener('click', () => generateQR(conferenceId, statusText, viewBtn, previewContainer, qrImage, scanUrl));
        viewBtn.addEventListener('click', () => viewQR(conferenceId, previewContainer, qrImage, scanUrl));
        attendanceBtn.addEventListener('click', () => viewAttendance(conferenceId));
        closePreviewBtn.addEventListener('click', () => {
            previewContainer.style.display = 'none';
        });
    });
}

function getConferenceIdFromCard(card) {
    // Try to get conference ID from the inscription button
    const btn = card.querySelector('.btn-inscribirse');
    if (btn && btn.dataset.id) return btn.dataset.id;
    
    // Try to find ID in the card structure
    const title = card.querySelector('.conferencia-title');
    if (title && title.dataset.id) return title.dataset.id;
    
    // Last resort: extract from card ID or data attribute
    if (card.dataset.conferenceId) return card.dataset.conferenceId;
    
    return null;
}

async function loadQRStatus(conferenceId, statusElement, viewBtn, generateBtn) {
    try {
        const res = await fetch(`/api/conferencias/${conferenceId}/qr`);
        if (res.ok) {
            const qrData = await res.json();
            
            const expiresAt = new Date(qrData.expires_at);
            const now = new Date();
            const timeLeft = expiresAt - now;
            const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
            
            let statusMsg = `QR activo`;
            if (hoursLeft > 0) {
                statusMsg += ` • Expira en ${hoursLeft}h`;
            } else {
                statusMsg += ` • Expirado`;
            }
            
            statusElement.textContent = statusMsg;
            statusElement.style.color = hoursLeft > 0 ? 'var(--green)' : 'var(--red)';
            viewBtn.style.display = 'inline-block';
            generateBtn.textContent = 'Regenerar QR';
            
        } else if (res.status === 404) {
            statusElement.textContent = 'QR no generado';
            statusElement.style.color = 'var(--slate-400)';
            viewBtn.style.display = 'none';
            generateBtn.textContent = 'Generar QR';
        } else {
            statusElement.textContent = 'Error al cargar QR';
            statusElement.style.color = 'var(--red)';
        }
    } catch (err) {
        console.error('Error loading QR status:', err);
        statusElement.textContent = 'Error de conexión';
        statusElement.style.color = 'var(--red)';
    }
}

async function generateQR(conferenceId, statusElement, viewBtn, previewContainer, qrImage, scanUrl) {
    try {
        const res = await fetch(`/api/conferencias/${conferenceId}/qr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Error al generar QR');
            return;
        }
        
        const qrData = await res.json();
        
        // Update status
        const expiresAt = new Date(qrData.expires_at);
        const now = new Date();
        const timeLeft = expiresAt - now;
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        
        statusElement.textContent = `QR generado • Expira en ${hoursLeft}h`;
        statusElement.style.color = 'var(--green)';
        viewBtn.style.display = 'inline-block';
        
        // Show preview
        qrImage.src = qrData.qr_data_url;
        scanUrl.textContent = `URL: ${qrData.scan_url}`;
        previewContainer.style.display = 'block';
        
        alert('QR generado exitosamente');
        
    } catch (err) {
        console.error('Error generating QR:', err);
        alert('Error al conectar con el servidor');
    }
}

async function viewQR(conferenceId, previewContainer, qrImage, scanUrl) {
    try {
        const res = await fetch(`/api/conferencias/${conferenceId}/qr`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Error al cargar QR');
            return;
        }
        
        const qrData = await res.json();
        qrImage.src = qrData.qr_data_url;
        scanUrl.textContent = `URL: ${qrData.scan_url}`;
        previewContainer.style.display = 'block';
        
    } catch (err) {
        console.error('Error viewing QR:', err);
        alert('Error al conectar con el servidor');
    }
}

async function viewAttendance(conferenceId) {
    try {
        const res = await fetch(`/api/conferencias/${conferenceId}/asistencias`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Error al cargar asistencias');
            return;
        }
        
        const data = await res.json();
        
        // Create attendance modal
        const modal = document.createElement('div');
        modal.className = 'modal-overlay active';
        modal.style.position = 'fixed';
        modal.style.inset = '0';
        modal.style.background = 'rgba(3, 7, 18, 0.8)';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '3000';
        modal.style.backdropFilter = 'blur(8px)';
        
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-card glass';
        modalContent.style.width = '90%';
        modalContent.style.maxWidth = '800px';
        modalContent.style.maxHeight = '80vh';
        modalContent.style.overflow = 'auto';
        modalContent.style.padding = '24px';
        
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '20px';
        
        const title = document.createElement('h3');
        title.textContent = `Asistencias a la Conferencia`;
        title.style.margin = '0';
        title.style.color = 'var(--white)';
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.color = 'var(--slate-400)';
        closeBtn.style.fontSize = '24px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.padding = '4px 12px';
        closeBtn.style.borderRadius = '4px';
        
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
            document.body.style.overflow = '';
        });
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        
        const stats = document.createElement('div');
        stats.style.background = 'rgba(0, 0, 0, 0.2)';
        stats.style.padding = '16px';
        stats.style.borderRadius = '8px';
        stats.style.marginBottom = '20px';
        stats.style.display = 'flex';
        stats.style.justifyContent = 'space-between';
        
        const totalAttendees = document.createElement('div');
        totalAttendees.innerHTML = `<strong>Total asistentes:</strong> ${data.total_asistencias}`;
        
        stats.appendChild(totalAttendees);
        
        const tableContainer = document.createElement('div');
        tableContainer.style.overflowX = 'auto';
        
        if (data.asistencias.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.textContent = 'No hay asistencias registradas aún.';
            emptyMsg.style.textAlign = 'center';
            emptyMsg.style.padding = '40px';
            emptyMsg.style.color = 'var(--slate-400)';
            tableContainer.appendChild(emptyMsg);
        } else {
            const table = document.createElement('table');
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';
            
            const thead = document.createElement('thead');
            thead.innerHTML = `
                <tr>
                    <th style="padding: 12px; text-align: left; border-bottom: 1px solid rgba(148, 163, 184, 0.2); color: var(--slate-300)">Nombre</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 1px solid rgba(148, 163, 184, 0.2); color: var(--slate-300)">Email</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 1px solid rgba(148, 163, 184, 0.2); color: var(--slate-300)">N° Control</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 1px solid rgba(148, 163, 184, 0.2); color: var(--slate-300)">Horario</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 1px solid rgba(148, 163, 184, 0.2); color: var(--slate-300)">Escaneado el</th>
                </tr>
            `;
            
            const tbody = document.createElement('tbody');
            
            data.asistencias.forEach(att => {
                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid rgba(148, 163, 184, 0.1)';
                
                const scannedDate = new Date(att.scanned_at).toLocaleString('es-ES');
                
                row.innerHTML = `
                    <td style="padding: 12px;">${escapeHtml(att.nombre)}</td>
                    <td style="padding: 12px;">${escapeHtml(att.email)}</td>
                    <td style="padding: 12px;">${escapeHtml(att.numero_control || '-')}</td>
                    <td style="padding: 12px;">${escapeHtml(att.horario || '-')}</td>
                    <td style="padding: 12px;">${escapeHtml(scannedDate)}</td>
                `;
                
                tbody.appendChild(row);
            });
            
            table.appendChild(thead);
            table.appendChild(tbody);
            tableContainer.appendChild(table);
        }
        
        modalContent.appendChild(header);
        modalContent.appendChild(stats);
        modalContent.appendChild(tableContainer);
        modal.appendChild(modalContent);
        
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        // Close modal on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                document.body.style.overflow = '';
            }
        });
        
        // Close on Escape key
        const closeOnEscape = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(modal);
                document.body.style.overflow = '';
                document.removeEventListener('keydown', closeOnEscape);
            }
        };
        document.addEventListener('keydown', closeOnEscape);
        
    } catch (err) {
        console.error('Error viewing attendance:', err);
        alert('Error al conectar con el servidor');
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}