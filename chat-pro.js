// ── SISTEMA DE MODALES Y BLOQUEO PREMIUM (Carpeta Nuevo) ──
if (typeof window.showQuickFeedback !== 'function') {
    window.showQuickFeedback = function(msg) {
        var toast = document.createElement('div');
        toast.style = "position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(17, 27, 33, 0.9);backdrop-filter:blur(10px);color:white;padding:12px 24px;border-radius:30px;font-size:0.9rem;font-weight:600;z-index:100000;box-shadow:0 10px 30px rgba(0,0,0,0.3);animation:scFadeIn 0.3s ease;border:1px solid rgba(255,255,255,0.1);";
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(function(){ toast.style.opacity='0'; toast.style.transform='translateX(-50%) translateY(10px)'; toast.style.transition='0.3s'; setTimeout(function(){toast.remove();},300); }, 2500);
    };
}

function showWaConfirm(title, body, confirmText, isDanger, onConfirm) {
    var overlay = document.createElement('div');
    overlay.className = 'wa-modal-overlay';
    overlay.innerHTML = `
        <div class="wa-modal-card">
            <div class="wa-modal-title">${title}</div>
            <div class="wa-modal-body">${body}</div>
            <div class="wa-modal-actions">
                <button class="wa-modal-btn wa-modal-btn-cancel" onclick="this.closest('.wa-modal-overlay').remove()">Cancelar</button>
                <button class="wa-modal-btn ${isDanger ? 'wa-modal-btn-danger' : 'wa-modal-btn-confirm'}" id="wa-modal-ok">${confirmText}</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#wa-modal-ok').onclick = function() {
        overlay.remove();
        onConfirm();
    };
}

async function checkBlockStatus() {
    if (!chatCurrentPartner) return;
    if (typeof auth === 'undefined' || !auth.isAuthenticated()) return;
    var mySbId = await getChatUserId();
    console.log('[Chat] checkBlockStatus for:', chatCurrentPartner, 'myId:', mySbId);
    if (!mySbId) {
        console.warn('[Chat] No mySbId found, skipping block check');
        return;
    }

    var isBlocked = await db.isUserBlocked(mySbId, chatCurrentPartner);
    console.log('[Chat] isBlocked result:', isBlocked);
    var btn = document.getElementById('chat-block-btn');
    var input = document.getElementById('chat-input');
    var sendBtn = document.querySelector('.chat-send-btn');
    var msgContainer = document.getElementById('chat-messages');
    
    var oldBanner = document.getElementById('chat-block-banner');
    if (oldBanner) oldBanner.remove();

    if (isBlocked) {
        var banner = document.createElement('div');
        banner.id = 'chat-block-banner';
        banner.innerHTML = `
            <span>Has bloqueado a este contacto</span>
            <button onclick="blockChatUser()" style="background:#008069; color:white; border:none; padding:8px 24px; border-radius:20px; font-weight:700; cursor:pointer; font-size:0.85rem;">DESBLOQUEAR</button>
        `;
        if (msgContainer) msgContainer.prepend(banner);
    }

    if (btn) {
        btn.innerHTML = isBlocked ? '<i class="ri-checkbox-circle-line"></i> Desbloquear' : '<i class="ri-forbid-line"></i> Bloquear usuario';
        btn.style.color = isBlocked ? '#00a884' : '#ef4444';
    }

    if (input) {
        input.disabled = isBlocked;
        input.placeholder = isBlocked ? 'Usuario bloqueado' : 'Escribe un mensaje...';
        if (sendBtn) sendBtn.style.opacity = isBlocked ? '0.5' : '1';
    }
}

async function blockChatUser() {
    if (!chatCurrentPartner) return;
    if (typeof auth === 'undefined' || !auth.isAuthenticated()) return;
    var mySbId = await getChatUserId();
    if (!mySbId) return;

    var isBlocked = await db.isUserBlocked(mySbId, chatCurrentPartner);
    
    if (isBlocked) {
        showWaConfirm('¿Desbloquear?', 'Podrás volver a enviar y recibir mensajes de este contacto.', 'DESBLOQUEAR', false, async () => {
            await db.unblockUser(mySbId, chatCurrentPartner);
            if (typeof showQuickFeedback === 'function') showQuickFeedback('✅ Usuario desbloqueado');
            checkBlockStatus();
        });
    } else {
        showWaConfirm('¿Bloquear contacto?', 'Los contactos bloqueados no podrán enviarte mensajes ni llamarte.', 'BLOQUEAR', true, async () => {
            await db.blockUser(mySbId, chatCurrentPartner);
            if (typeof showQuickFeedback === 'function') showQuickFeedback('🚫 Usuario bloqueado');
            checkBlockStatus();
        });
    }
    if (typeof closeChatMenu === 'function') closeChatMenu();
}

console.log('✅ Chat Pro Features Loaded (Nuevo)');
