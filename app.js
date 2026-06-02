var app = {
    currentScreen: 'screen-splash',
    screens: ['screen-splash','screen-register','screen-login','screen-forgot-password','screen-reset-password','screen-map','screen-intenciones','screen-create-rosary','screen-rosary-detail','screen-rezo','screen-event','screen-live','screen-como-rezar','screen-profile','screen-porque-rezar','screen-notificaciones','screen-mensajes','screen-apariciones','screen-cenaculo','screen-Comedores','screen-situacion-calle','screen-anuncios','screen-voluntarios'],
    pickerMap: null, pickerMarker: null, pickerLocation: null,
    detailMap: null,
    buscarMap: null,
    ROSARY_STORAGE_KEY: 'redmaria_rosaries',
    JOINED_ROSARIES_KEY: 'redmaria_joined',
    CONTINUO_KEY: 'redmaria_continuo',
    continuoDate: new Date(),
    // Helper: get YYYY-MM-DD from a Date in LOCAL timezone (not UTC)
    localDateKey: function(d) {
        var y = d.getFullYear();
        var m = (d.getMonth() + 1).toString().padStart(2, '0');
        var day = d.getDate().toString().padStart(2, '0');
        return y + '-' + m + '-' + day;
    },
    recoveryEmail: null,
    recoveryCode: null,

    checkVersionUpdate: function() {
        var self = this;
        var CURRENT_VERSION = 'v114';
        fetch('version.json?t=' + Date.now())
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data && data.version && data.version !== CURRENT_VERSION) {
                    console.log('[Version] Nueva versión disponible:', data.version);
                    var banner = document.createElement('div');
                    banner.id = 'update-notification-banner';
                    banner.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.95);backdrop-filter:blur(10px);border:2px solid #6366f1;box-shadow:0 10px 30px rgba(0,0,0,0.15);padding:12px 20px;border-radius:18px;display:flex;align-items:center;gap:14px;z-index:999999;width:90%;max-width:380px;justify-content:space-between;box-sizing:border-box;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
                    banner.innerHTML = '<span style="font-size:0.85rem;color:#1e293b;font-weight:700;">✨ Actualización disponible</span>'
                        + '<button onclick="app.forceAppUpdate()" style="background:#6366f1;color:white;border:none;border-radius:12px;padding:8px 16px;font-size:0.75rem;font-weight:800;cursor:pointer;box-shadow:0 4px 10px rgba(99,102,241,0.3);font-family:inherit;">Actualizar</button>';
                    document.body.appendChild(banner);
                }
            })
            .catch(function(err) {
                console.warn('[VersionCheck] No se pudo verificar versión:', err.message);
            });
    },
    forceAppUpdate: function() {
        console.log('[Version] Forzando actualización de la app...');
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
                for (var r of regs) { r.unregister(); }
            });
        }
        if ('caches' in window) {
            caches.keys().then(function(names) {
                for (var name of names) { caches.delete(name); }
            });
        }
        setTimeout(function() {
            window.location.reload(true);
        }, 300);
    },

    init() {
        this.checkVersionUpdate();
        this.generateSplashBeads();
        // Clear stale continuo data on load - Supabase is the source of truth
        try { localStorage.removeItem(this.CONTINUO_KEY); } catch(e) {}
        this.renderContinuo().catch(function(e) { console.warn('[Init] Continuo render failed:', e); });
        this.generateParticipants();
        this.loadRosaryCards();
        authUI.init();
        this.setupCreateRosaryForm();
        this.setupForgotPasswordForm();
        this.setupResetPasswordForm();
        this.setupResetStrengthMeter();
        if (auth.isAuthenticated()) this.updateUserUI();

        const params = new URLSearchParams(window.location.search);
        const sharedAnuncio = params.get('anuncio');
        const sharedRosary = params.get('rosary');
        
        if (sharedAnuncio) {
            console.log('[Init] Shared anuncio detected, navigating...');
            this.navigate('screen-anuncios');
        } else if (sharedRosary) {
            // Handled in DOMContentLoaded
        } else {
            this.navigate(this.currentScreen);
        }
        document.querySelectorAll('.header-nav a').forEach(a => a.addEventListener('click', e => {
            const href = a.getAttribute('href');
            if (href && !href.startsWith('#')) return; // Allow normal navigation for external/standalone links
            e.preventDefault();
        }));
    },

    async loadRosaryCards() {
        const list = document.getElementById('rosary-list'); if (!list) return;
        // Load from Supabase first, fallback to localStorage
        var rosaries = this.getActiveRosaries();
        if (typeof db !== 'undefined' && db.getRosaries) {
            try {
                var remote = await db.getRosaries();
                if (remote && remote.length > 0) {
                    // Map Supabase fields to local format
                    rosaries = remote.map(function(r) {
                        return {
                            id: r.id, place: r.place, address: r.address || '', date: r.date, time: r.time,
                            mystery: r.mystery, intention: r.intention, lat: r.lat, lng: r.lng,
                            participants: r.participants || 1, creatorId: r.creator_id,
                            creatorName: r.creator_name || 'Anónimo'
                        };
                    });
                    // Save to localStorage for offline
                    localStorage.setItem('redmaria_rosaries', JSON.stringify(rosaries));
                    console.log('[Rosaries] Loaded', rosaries.length, 'from Supabase');
                }
            } catch(e) {
                console.warn('[Rosaries] Supabase failed, using local:', e.message);
            }
        }
        // Filter active
        rosaries = rosaries.filter(r => !this.isRosaryExpired(r));
        rosaries.forEach(r => this.addRosaryCard(r));
        // Update stats
        var countEl = document.getElementById('buscar-cards-count');
        var emptyEl = document.getElementById('buscar-empty');
        var statRos = document.getElementById('buscar-stat-rosaries');
        if (countEl) countEl.textContent = rosaries.length + ' encontrados';
        if (emptyEl) emptyEl.style.display = rosaries.length === 0 ? '' : 'none';
        if (statRos) statRos.textContent = rosaries.length;
    },

    initPickerMap() {
        if (this.pickerMap) { this.pickerMap.invalidateSize(); return; }
        this.pickerMap = L.map('picker-map', { zoomControl: false, attributionControl: false }).setView([-34.5955,-58.3739], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(this.pickerMap);
        L.control.zoom({ position: 'topright' }).addTo(this.pickerMap);
        this.pickerMap.on('click', e => this.setPickerLocation(e.latlng.lat, e.latlng.lng));
    },

    async initBuscarMap() {
        if (!this.buscarMap) {
            this.buscarMap = L.map('buscar-map', { zoomControl: false, attributionControl: false }).setView([-34.5955, -58.3739], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(this.buscarMap);
            L.control.zoom({ position: 'topright' }).addTo(this.buscarMap);
            this._buscarMarkers = [];
        } else {
            this.buscarMap.invalidateSize();
        }
        // Always reload rosaries
        await this._loadBuscarRosaries();
    },

    async _loadBuscarRosaries() {
        // Clear old markers
        if (this._buscarMarkers) {
            this._buscarMarkers.forEach(m => this.buscarMap.removeLayer(m));
            this._buscarMarkers = [];
        }

        // Load from Supabase first
        var activeRosaries = [];
        if (typeof db !== 'undefined' && db.getRosaries) {
            try {
                var remote = await db.getRosaries();
                if (remote && remote.length > 0) {
                    activeRosaries = remote.map(function(r) {
                        return {
                            id: r.id, place: r.place, address: r.address || '', date: r.date, time: r.time,
                            mystery: r.mystery, intention: r.intention, lat: r.lat, lng: r.lng,
                            participants: r.participants || 1, creatorId: r.creator_id,
                            creatorName: r.creator_name || 'Anónimo'
                        };
                    });
                    localStorage.setItem('redmaria_rosaries', JSON.stringify(activeRosaries));
                    console.log('[Map] Loaded', activeRosaries.length, 'rosaries from Supabase');
                }
            } catch(e) { console.warn('[Map] Supabase failed:', e.message); }
        }

        // Fallback to localStorage
        if (activeRosaries.length === 0) {
            activeRosaries = this.getActiveRosaries();
            console.log('[Map] Using', activeRosaries.length, 'rosaries from localStorage');
        }

        // Add markers
        let totalPeople = 0;
        activeRosaries.forEach(r => {
            if (r.lat && r.lng) {
                const pCount = r.participants || 1;
                totalPeople += pCount;
                const icon = L.divIcon({ className: 'custom-marker-wrapper', html: '<div class="custom-map-marker user-marker"><i class="ri-map-pin-fill" style="font-size:1rem;color:white"></i><span class="marker-count">' + pCount + '</span></div>', iconSize: [36, 44], iconAnchor: [18, 44] });
                const marker = L.marker([r.lat, r.lng], { icon }).addTo(this.buscarMap);
                marker.rosaryData = r;
                marker.bindPopup(() => this._buildMapPopup(r.id, r.place, r.time, r.mystery, r.intention, r.participants || 1), { className: 'rosary-map-popup', maxWidth: 260 });
                this._buscarMarkers.push(marker);
            }
        });

        // Update stats
        const statRos = document.getElementById('buscar-stat-rosaries');
        const statPpl = document.getElementById('buscar-stat-people');
        const countEl = document.getElementById('buscar-cards-count');
        const emptyEl = document.getElementById('buscar-empty');
        if (statRos) statRos.textContent = activeRosaries.length;
        if (statPpl) statPpl.textContent = totalPeople;
        if (countEl) countEl.textContent = activeRosaries.length + ' encontrados';
        if (emptyEl) emptyEl.style.display = activeRosaries.length === 0 ? '' : 'none';

        // Render cards
        const list = document.getElementById('rosary-list');
        if (list) list.innerHTML = '';
        activeRosaries.forEach(r => this.addRosaryCard(r));
    },

    _buildMapPopup(id, name, time, mystery, intention, participants) {
        const joined = this.getJoinedRosaries();
        const isJoined = joined.some(j => j.id === id);
        const btnClass = isJoined ? 'popup-btn-leave' : 'popup-btn-join';
        const btnText = isJoined ? '<i class="ri-close-circle-line"></i> Salir' : '<i class="ri-add-circle-line"></i> Unirme';
        const btnAction = isJoined
            ? 'app.leaveRosary(\'' + id + '\')'
            : 'app.joinRosary(\'' + id + '\',\'' + name.replace(/'/g, "\\'") + '\',\'' + time + '\',\'' + mystery + '\',\'' + intention.replace(/'/g, "\\'") + '\',' + participants + ')';
        return '<div class="map-popup-content">' +
            '<h4 class="map-popup-name">' + name + '</h4>' +
            '<div class="map-popup-detail"><i class="ri-time-line"></i> Hoy ' + time + ' hs</div>' +
            '<div class="map-popup-detail"><i class="ri-sparkling-line"></i> Misterios ' + mystery + '</div>' +
            '<div class="map-popup-detail"><i class="ri-candle-line"></i> ' + intention + '</div>' +
            '<div class="map-popup-detail"><i class="ri-group-line"></i> ' + participants + ' participantes</div>' +
            '<button class="map-popup-btn ' + btnClass + '" onclick="' + btnAction + '">' + btnText + '</button>' +
            '</div>';
    },

    getJoinedRosaries() {
        try { return JSON.parse(localStorage.getItem(this.JOINED_ROSARIES_KEY)) || []; } catch { return []; }
    },

    joinRosary(id, name, time, mystery, intention, participants, date) {
        if (!auth.isAuthenticated()) { this.navigate('screen-login'); return; }
        const joined = this.getJoinedRosaries();
        if (joined.some(j => j.id === id)) return;
        // Get date from current rosary data if not passed as argument
        var rosaryDate = date || '';
        if (!rosaryDate && this._currentRosary) rosaryDate = this._currentRosary.date || '';
        joined.push({ id, name, time, mystery, intention, participants, date: rosaryDate, joinedAt: new Date().toISOString() });
        localStorage.setItem(this.JOINED_ROSARIES_KEY, JSON.stringify(joined));
        // Sync with Supabase
        if (typeof db !== 'undefined' && db.joinRosary) {
            const user = auth.getCurrentUser();
            if (user) db.joinRosary(id, user.id).catch(e => console.error('Join sync error:', e));
        }
        // Close and reopen popup to refresh button
        if (this.buscarMap) this.buscarMap.closePopup();
        this.renderProfileJoined();
        this.renderProfileMyRosaries();
    },

    leaveRosary(id) {
        let joined = this.getJoinedRosaries();
        joined = joined.filter(j => j.id !== id);
        localStorage.setItem(this.JOINED_ROSARIES_KEY, JSON.stringify(joined));
        // Sync with Supabase
        if (typeof db !== 'undefined' && db.leaveRosary) {
            const user = auth.getCurrentUser();
            if (user) db.leaveRosary(id, user.id).catch(e => console.error('Leave sync error:', e));
        }
        if (this.buscarMap) this.buscarMap.closePopup();
        this.renderProfileJoined();
        this.renderProfileMyRosaries();
    },

    cancelRosary(id, placeName) {
        // Show confirmation modal
        var modal = document.createElement('div');
        modal.className = 'slot-signup-modal';
        modal.innerHTML = '<div class="slot-signup-card">' +
            '<h3><i class="ri-error-warning-fill" style="color:#e74c3c"></i> Cancelar Rosario</h3>' +
            '<p style="font-size:0.9rem;color:#5A7D9A;margin:12px 0">┬┐Estás seguro de cancelar el rosario <strong>' + (placeName || '') + '</strong>?</p>' +
            '<p style="font-size:0.8rem;color:#e74c3c;margin-bottom:16px">Esta acción no se puede deshacer. Se eliminará para todos los participantes.</p>' +
            '<div class="slot-signup-actions">' +
                '<button class="btn btn-secondary-outline" id="cancel-rosary-no">Volver</button>' +
                '<button class="btn btn-primary" id="cancel-rosary-yes" style="background:linear-gradient(135deg,#e74c3c,#c0392b)"><i class="ri-delete-bin-line"></i> Sá, Cancelar</button>' +
            '</div>' +
        '</div>';
        document.body.appendChild(modal);
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        modal.querySelector('#cancel-rosary-no').onclick = function() { modal.remove(); };
        var self = this;
        modal.querySelector('#cancel-rosary-yes').onclick = function() {
            // Remove from local storage
            var rosaries = self.getRosaries().filter(function(r) { return r.id !== id; });
            localStorage.setItem(self.ROSARY_STORAGE_KEY, JSON.stringify(rosaries));
            // Also remove from joined
            var joined = self.getJoinedRosaries().filter(function(j) { return j.id !== id; });
            localStorage.setItem(self.JOINED_ROSARIES_KEY, JSON.stringify(joined));
            // Sync delete to Supabase
            if (typeof db !== 'undefined' && db.deleteRosary) {
                db.deleteRosary(id).catch(function(e) { console.error('Delete sync error:', e); });
            }
            modal.remove();
            self.renderProfileMyRosaries();
            self.renderProfileJoined();
            if (typeof self.loadRosaryCards === 'function') {
                self.loadRosaryCards();
            }
        };
    },

    confirmLeaveRosary(id, placeName) {
        var modal = document.createElement('div');
        modal.className = 'slot-signup-modal';
        modal.innerHTML = '<div class="slot-signup-card">' +
            '<h3><i class="ri-logout-circle-r-line" style="color:#f0a500"></i> Desunirme</h3>' +
            '<p style="font-size:0.9rem;color:#5A7D9A;margin:12px 0">┬┐Deseas salir del rosario <strong>' + (placeName || '') + '</strong>?</p>' +
            '<div class="slot-signup-actions">' +
                '<button class="btn btn-secondary-outline" id="leave-rosary-no">Volver</button>' +
                '<button class="btn btn-primary" id="leave-rosary-yes" style="background:linear-gradient(135deg,#f0a500,#e09600)"><i class="ri-logout-circle-r-line"></i> Sá, Salir</button>' +
            '</div>' +
        '</div>';
        document.body.appendChild(modal);
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        modal.querySelector('#leave-rosary-no').onclick = function() { modal.remove(); };
        var self = this;
        modal.querySelector('#leave-rosary-yes').onclick = function() {
            self.leaveRosary(id);
            modal.remove();
        };
    },

    // ==================== ANUNCIOS ====================
    anuncioFile: null,
    _anuncioSearchTimeout: null,
    _anuncioActiveCreatorId: null,
    _anuncioActiveCreatorName: null,
    _anuncioCache: [],

    async loadAnuncios() {
        console.log('[Anuncios] loadAnuncios called');
        this._anuncioActiveCreatorId = null;
        this._anuncioActiveCreatorName = null;
        const list = document.getElementById('anuncios-list');
        if (!list) return;
        list.innerHTML = '<div style="text-align:center;padding:40px 0;"><i class="ri-loader-4-line ri-spin" style="font-size:2rem;color:var(--clr-primary)"></i><p style="margin-top:10px;color:var(--clr-text-muted);">Cargando anuncios...</p></div>';
        
        let anuncios = [];
        if (typeof db !== 'undefined' && db.getAnuncios) {
            anuncios = await db.getAnuncios();
        }
        this._anuncioCache = anuncios || [];
        console.log('[Anuncios] Cache size:', this._anuncioCache.length);
        
        // If landing from a shared link, filter to show that one first
        const params = new URLSearchParams(window.location.search);
        const sharedId = params.get('anuncio');
        console.log('[Anuncios] sharedId detected:', sharedId);

        if (sharedId) {
            const shared = this._anuncioCache.filter(a => {
                const aid = (a.id || a.created_at || '').toString();
                return aid === sharedId || aid.includes(sharedId) || sharedId.includes(aid);
            });
            console.log('[Anuncios] Matching announcements found:', shared.length);

            if (shared.length > 0) {
                this._renderAnuncioCards(shared);
                // ...
                const banner = document.createElement('div');
                banner.id = 'shared-anuncio-banner';
                banner.style.cssText = 'background:linear-gradient(135deg, #fff7ed, #ffedd5); border:2.5px solid #f97316; padding:16px; border-radius:18px; margin-bottom:15px; display:flex; flex-direction:column; align-items:center; gap:12px; animation:fadeInDown 0.4s ease; box-shadow:0 10px 25px rgba(249,115,22,0.2);';
                banner.innerHTML = `
                    <div style="display:flex;align-items:center;gap:10px;color:#c2410c;font-size:1rem;font-weight:800;text-align:center;">
                        <i class="ri-error-warning-fill" style="font-size:1.4rem;"></i>
                        <span>Para ver m\u00e1s y participar, necesitas registrarte</span>
                    </div>
                    <button onclick="app.navigate('screen-register')" style="width:100%;background:#f97316;color:white;border:none;padding:12px;border-radius:12px;font-size:1rem;font-weight:900;cursor:pointer;box-shadow:0 4px 12px rgba(249,115,22,0.4);text-transform:uppercase;letter-spacing:1px;display:flex;align-items:center;justify-content:center;gap:8px;">
                        <i class="ri-user-add-fill"></i> REGISTRARSE AHORA
                    </button>
                `;
                list.insertBefore(banner, list.firstChild);
                
                // HIDE ALL UNNECESSARY UI FOR GUESTS ON DEEP LINK
                const hero = document.querySelector('.intenciones-hero');
                if (hero) hero.style.display = 'none';
                
                const searchContainer = document.getElementById('anuncios-search-container');
                if (searchContainer) searchContainer.style.display = 'none';
                
                const topBar = document.querySelector('#screen-anuncios .top-bar');
                if (topBar) topBar.style.display = 'none';
                
                const mainNav = document.getElementById('main-nav');
                if (mainNav) mainNav.style.display = 'none';

                const scrollArea = document.querySelector('.intenciones-scrollarea');
                if (scrollArea) {
                    scrollArea.style.paddingTop = '0px';
                    scrollArea.scrollTop = 0;
                }
                
                const listContainer = document.querySelector('.community-intentions');
                if (listContainer) listContainer.style.paddingBottom = '20px';

                setTimeout(() => { 
                    if (scrollArea) scrollArea.scrollTop = 0;
                }, 200);
                
                this._initAnuncioReactions(shared.map(s => s.id || s.created_at));
                return;
            } else {
                console.warn('[Anuncios] Shared ID not found in cache. IDs available:', this._anuncioCache.map(a => a.id || a.created_at));
            }
        }

        this._renderAnuncioCards(this._anuncioCache);
        const _ids = this._anuncioCache.map(a => a.id || a.created_at).filter(Boolean);
        this._initAnuncioReactions(_ids);
    },

    clearAnuncioFilters() {
        // Restaurar UI
        const hero = document.querySelector('.intenciones-hero');
        if (hero) hero.style.display = 'flex';
        const searchContainer = document.getElementById('anuncios-search-container');
        if (searchContainer) searchContainer.style.display = 'block';
        const topBar = document.querySelector('#screen-anuncios .top-bar');
        if (topBar) topBar.style.display = 'flex';
        const mainNav = document.getElementById('main-nav');
        if (mainNav) mainNav.style.display = 'flex';
        const scrollArea = document.querySelector('.intenciones-scrollarea');
        if (scrollArea) scrollArea.style.paddingTop = '20px';
        const listContainer = document.querySelector('.community-intentions');
        if (listContainer) listContainer.style.paddingBottom = '80px';
        
        // Remove banner if exists
        const banner = document.getElementById('shared-anuncio-banner');
        if (banner) banner.remove();
        
        // Clear URL param without reload
        if (window.location.search.includes('anuncio=')) {
            const url = new URL(window.location);
            url.searchParams.delete('anuncio');
            window.history.replaceState({}, document.title, url.pathname);
        }
        
        this.clearAnuncioUserFilter(); // This handles rendering full cache
    },

    _renderAnuncioCards(anuncios) {
        const EMOJIS = ['\u2764\ufe0f','\ud83d\udc4d','\ud83d\udc4f','\ud83d\ude4c','\ud83d\ude09'];
        const reactions = this._anuncioRemoteReactions || {};
        const currentUserId = (typeof auth !== 'undefined' && auth.isAuthenticated() && auth.getCurrentUser())
            ? (auth.getCurrentUser().id || null) : null;
        const list = document.getElementById('anuncios-list');

        if (!list) return;
        list.innerHTML = '';
        if (!anuncios || anuncios.length === 0) {
            const who = this._anuncioActiveCreatorName;
            list.innerHTML = `<div style="text-align:center;padding:48px 20px;">
                <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#fde68a,#f59e0b);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;box-shadow:0 8px 24px rgba(245,158,11,0.25);">
                    <i class="ri-megaphone-line" style="font-size:2rem;color:white;"></i>
                </div>
                <h4 style="color:#64748b;margin:0 0 8px;font-size:1.1rem;">No hay anuncios${who ? ' de ' + who : ' a\u00fan'}</h4>
                <p style="color:#94a3b8;font-size:0.9rem;margin:0;">${who ? 'Este usuario no ha publicado nada todav\u00eda.' : 'S\u00e9 el primero en publicar una actividad solidaria.'}</p>
            </div>`;
            return;
        }
        anuncios.forEach(anuncio => {
            const id = anuncio.id || anuncio.created_at || Math.random().toString(36);
            if (!reactions[id]) reactions[id] = {};
            const card = document.createElement('div');
            card.style.cssText = 'border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.08);margin-bottom:4px;transition:transform 0.2s,box-shadow 0.2s;';
            const creator = anuncio.creator_name || 'Fundaci\u00f3n An\u00f3nima';
            const avatarGrad = this._anuncioAvatarColor(creator);
            const dateStr = anuncio.created_at
                ? new Date(anuncio.created_at).toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})
                : 'Reciente';
            const desc = (anuncio.description || '').trim();

            // ── FOTO: completa sin recorte, tap para lightbox ──
            let photoHtml = '';
            const isOwnerAnuncio = currentUserId && anuncio.creator_id && currentUserId === anuncio.creator_id;
            const deleteBtnHtml = isOwnerAnuncio
                ? `<button onclick="event.stopPropagation();app.confirmDeleteAnuncio('${id}','${(anuncio.title||'').replace(/'/g,"\\'")}')"
                    title="Eliminar anuncio"
                    style="position:absolute;top:10px;right:10px;z-index:10;width:34px;height:34px;border-radius:50%;background:rgba(239,68,68,0.92);border:2px solid rgba(255,255,255,0.6);color:white;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,0.3);transition:transform 0.15s,background 0.15s;"
                    onmouseover="this.style.transform='scale(1.12)';this.style.background='rgba(220,38,38,1)'"
                    onmouseout="this.style.transform='';this.style.background='rgba(239,68,68,0.92)'"
                    ><i class="ri-close-line"></i></button>`
                : '';
            if (anuncio.photo_url) {
                const safeUrl   = anuncio.photo_url.replace(/'/g, "\\'");
                const safeTit   = (anuncio.title || '').replace(/'/g, "\\'");
                photoHtml = `<div style="position:relative;width:100%;background:#0f172a;cursor:zoom-in;min-height:180px;" onclick="app.openAnuncioLightbox('${safeUrl}','${safeTit}')">
                    <img src="${anuncio.photo_url}" alt="${anuncio.title || ''}"
                        style="width:100%;height:auto;max-height:40vh;display:block;object-fit:contain;"
                        onerror="this.parentElement.style.display='none'">
                    <div style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.6);color:white;font-size:0.7rem;padding:4px 12px;border-radius:20px;pointer-events:none;backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.2);">
                        <i class="ri-zoom-in-line"></i> Pantalla completa
                    </div>
                    ${deleteBtnHtml}
                </div>`;
            }

            // ── BANNER (sin foto) ──
            const bannerHtml = !anuncio.photo_url ? `<div style="position:relative;padding:28px 20px 20px;background:linear-gradient(135deg,#f97316,#dc2626);">
                <div style="position:absolute;top:10px;left:10px;background:rgba(255,255,255,0.22);color:white;font-size:0.62rem;font-weight:900;padding:3px 9px;border-radius:8px;letter-spacing:1px;text-transform:uppercase;">Novedad</div>
                ${deleteBtnHtml}
                <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;margin-bottom:10px;">
                    <i class="ri-megaphone-fill" style="font-size:1.5rem;color:white;"></i>
                </div>
                <h3 style="margin:0;font-size:1.15rem;font-weight:800;color:white;line-height:1.3;">${anuncio.title || 'Sin T\u00edtulo'}</h3>
            </div>` : '';;

            // ── EMOJIS de reacci\u00f3n ──
            const emojiRow = EMOJIS.map(em => {
                const cnt = (reactions[id] && reactions[id][em]) ? reactions[id][em] : 0;
                return `<button onclick="if(auth.isAuthenticated()){app._anuncioReact('${id}','${em}',this)}else{app.navigate('screen-register')}"
                    data-emoji="${em}"
                    style="background:${cnt > 0 ? '#fff7ed' : '#f8fafc'};border:1.5px solid ${cnt > 0 ? '#fed7aa' : '#e2e8f0'};border-radius:20px;padding:5px 11px;cursor:pointer;font-size:0.92rem;display:inline-flex;align-items:center;gap:4px;transition:all 0.15s;font-family:inherit;">
                    <span>${em}</span>${cnt > 0 ? `<span style="font-size:0.75rem;font-weight:700;color:#f97316;">${cnt}</span>` : ''}
                </button>`;
            }).join('');

            const creatorEsc = creator.replace(/'/g, "\\'");
            const creatorId  = anuncio.creator_id || '';

            card.innerHTML = `
            ${photoHtml}
            ${bannerHtml}
            <div style="padding:12px 14px 14px; background: #fff;">
                <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:10px; gap:10px;">
                    <div style="flex:1;">
                        <h3 style="margin:0 0 4px; font-size:1.05rem; font-weight:800; color:#1e293b; line-height:1.2;">${anuncio.title || 'Sin T\u00edtulo'}</h3>
                        <button onclick="app.filterAnunciosByCreator('${creatorId}','${creatorEsc}',event)"
                            style="display:flex; align-items:center; gap:6px; background:none; border:none; cursor:pointer; padding:0; text-align:left;">
                            <div style="width:24px; height:24px; border-radius:50%; background:${avatarGrad}; display:flex; align-items:center; justify-content:center; color:white; font-weight:800; font-size:0.65rem; flex-shrink:0;">
                                ${creator.charAt(0).toUpperCase()}
                            </div>
                            <div style="font-size:0.75rem; font-weight:700; color:#f97316;">${creator}</div>
                        </button>
                    </div>
                    <div style="font-size:0.65rem; color:#94a3b8; white-space:nowrap; margin-top:4px;">${dateStr}</div>
                </div>

                <!-- Reacciones con emojis -->
                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;" id="emoji-row-${id}">${emojiRow}</div>
                
                ${desc ? `<p style="margin:0; color:#475569; line-height:1.5; font-size:0.88rem; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;">${desc}</p>` : ''}
                
                <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
                     <button onclick="app.shareAnuncio('${id}','${(anuncio.title||'').replace(/'/g,"\\'")}','','${(anuncio.photo_url||'').replace(/'/g,"\\'")}')"
                        style="width:34px; height:34px; border-radius:50%; background:#fff7ed; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; color:#f97316;">
                        <i class="ri-share-forward-line"></i>
                     </button>
                     <button onclick="openChatWith('${creatorId}','${creatorEsc}')" 
                        style="background:linear-gradient(135deg,#f97316,#ea580c); border:none; border-radius:10px; padding:6px 12px; color:white; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; box-shadow:0 2px 6px rgba(249,115,22,0.3);">
                        <i class="ri-chat-3-line"></i> Contactar
                     </button>
                </div>
            </div>`;
            list.appendChild(card);
        });
    },

    openAnuncioLightbox(url, title) {
        const ex = document.getElementById('anuncio-lightbox');
        if (ex) ex.remove();
        const lb = document.createElement('div');
        lb.id = 'anuncio-lightbox';
        lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.93);z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;';
        lb.innerHTML = `
            <button onclick="document.getElementById('anuncio-lightbox').remove()"
                style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.15);border:none;color:white;width:44px;height:44px;border-radius:50%;font-size:1.4rem;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);">
                <i class="ri-close-line"></i>
            </button>
            <img src="${url}" alt="${title || ''}"
                style="max-width:100%;max-height:85vh;object-fit:contain;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
            ${title ? `<p style="color:rgba(255,255,255,0.85);margin-top:14px;font-size:0.95rem;font-weight:600;text-align:center;max-width:340px;">${title}</p>` : ''}`;
        lb.onclick = e => { if (e.target === lb) lb.remove(); };
        document.body.appendChild(lb);
    },

    confirmDeleteAnuncio(id, title) {
        const ex = document.getElementById('delete-anuncio-modal');
        if (ex) ex.remove();
        const overlay = document.createElement('div');
        overlay.id = 'delete-anuncio-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.75);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;animation:scFadeIn 0.2s ease;';
        overlay.innerHTML = `
            <div style="background:white;border-radius:24px;width:100%;max-width:360px;padding:28px;box-shadow:0 30px 60px rgba(0,0,0,0.3);animation:waZoomIn 0.3s cubic-bezier(0.175,0.885,0.32,1.275);">
                <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#fee2e2,#fecaca);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                    <i class="ri-delete-bin-2-fill" style="font-size:1.7rem;color:#ef4444;"></i>
                </div>
                <h3 style="margin:0 0 8px;text-align:center;font-size:1.25rem;font-weight:800;color:#1e293b;">¿Eliminar anuncio?</h3>
                <p style="margin:0 0 6px;text-align:center;font-size:0.9rem;color:#64748b;line-height:1.5;">
                    Vas a eliminar <strong style="color:#1e293b;">&ldquo;${title || 'este anuncio'}&rdquo;</strong>
                </p>
                <p style="margin:0 0 24px;text-align:center;font-size:0.8rem;color:#ef4444;font-weight:600;">Esta acción no se puede deshacer.</p>
                <div style="display:flex;gap:12px;">
                    <button id="del-anuncio-cancel"
                        style="flex:1;padding:14px;border-radius:14px;border:none;background:#f1f5f9;color:#475569;font-weight:700;font-size:0.95rem;cursor:pointer;transition:background 0.2s;"
                        onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">
                        Cancelar
                    </button>
                    <button id="del-anuncio-confirm"
                        style="flex:1;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#ef4444,#dc2626);color:white;font-weight:700;font-size:0.95rem;cursor:pointer;box-shadow:0 4px 12px rgba(239,68,68,0.35);transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:6px;"
                        onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 16px rgba(239,68,68,0.45)'"
                        onmouseout="this.style.transform='';this.style.boxShadow='0 4px 12px rgba(239,68,68,0.35)'">
                        <i class="ri-delete-bin-line"></i> Sí, eliminar
                    </button>
                </div>
            </div>`;
        overlay.querySelector('#del-anuncio-cancel').onclick = () => overlay.remove();
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        overlay.querySelector('#del-anuncio-confirm').onclick = async () => {
            const btn = overlay.querySelector('#del-anuncio-confirm');
            btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Eliminando...';
            btn.disabled = true;
            let ok = false;
            if (typeof db !== 'undefined' && db.deleteAnuncio) {
                ok = await db.deleteAnuncio(id);
            }
            overlay.remove();
            if (ok) {
                // Remove from local cache and re-render
                this._anuncioCache = this._anuncioCache.filter(a => (a.id || a.created_at) !== id);
                this._renderAnuncioCards(this._anuncioCache);
                const t = document.createElement('div');
                t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;padding:10px 22px;border-radius:20px;font-size:0.88rem;font-weight:600;z-index:999999;box-shadow:0 4px 16px rgba(0,0,0,0.25);white-space:nowrap;animation:scFadeIn 0.2s ease;display:flex;align-items:center;gap:8px;';
                t.innerHTML = '<i class="ri-check-line" style="color:#22c55e"></i> Anuncio eliminado';
                document.body.appendChild(t);
                setTimeout(() => t.remove(), 2800);
            }
        };
        document.body.appendChild(overlay);
    },


    _anuncioReactionsChannel: null,
    _anuncioRemoteReactions: {},   // { [anuncioId]: { [emoji]: count } }

    // Carga reacciones desde Supabase y arranca suscripción Realtime
    async _initAnuncioReactions(anuncioIds) {
        // Load from localStorage first (instant, works offline)
        try {
            const stored = JSON.parse(localStorage.getItem('anuncio_reactions') || '{}' );
            this._anuncioRemoteReactions = Object.assign({}, stored);
        } catch(e) { this._anuncioRemoteReactions = {}; }
        // Cancelar suscripción anterior
        if (this._anuncioReactionsChannel && typeof sbClient !== 'undefined' && sbClient) {
            try { sbClient.removeChannel(this._anuncioReactionsChannel); } catch(e) {}
        }
        // Fetch inicial
        if (typeof db !== 'undefined' && db.getAnuncioReactions) {
            this._anuncioRemoteReactions = await db.getAnuncioReactions(anuncioIds) || {};
        }
        // Actualizar UI con los conteos iniciales
        this._applyRemoteReactionsToUI();
        // Suscripción Realtime
        if (typeof db !== 'undefined' && db.subscribeAnuncioReactions) {
            this._anuncioReactionsChannel = db.subscribeAnuncioReactions(row => {
                if (!this._anuncioRemoteReactions[row.anuncio_id]) this._anuncioRemoteReactions[row.anuncio_id] = {};
                this._anuncioRemoteReactions[row.anuncio_id][row.emoji] = row.count;
                this._updateEmojiBtn(row.anuncio_id, row.emoji, row.count);
            });
        }
    },

    _applyRemoteReactionsToUI() {
        const EMOJIS = ['\u2764\ufe0f','\ud83d\udc4d','\ud83d\udc4f','\ud83d\ude4c','\ud83d\ude09'];
        let myR = {}; try { myR = JSON.parse(localStorage.getItem('anuncio_my_reactions') || '{}'); } catch(e) {}
        Object.entries(this._anuncioRemoteReactions || {}).forEach(([anuncioId, emojis]) => {
            this._rebuildEmojiRow(anuncioId, emojis, EMOJIS, myR[anuncioId] || {});
        });
    },
    _updateEmojiBtn(anuncioId, emoji, count) {
        if (!this._anuncioRemoteReactions) this._anuncioRemoteReactions = {};
        if (!this._anuncioRemoteReactions[anuncioId]) this._anuncioRemoteReactions[anuncioId] = {};
        this._anuncioRemoteReactions[anuncioId][emoji] = count;
        const EMOJIS = ['\u2764\ufe0f','\ud83d\udc4d','\ud83d\udc4f','\ud83d\ude4c','\ud83d\ude09'];
        let myR = {}; try { myR = JSON.parse(localStorage.getItem('anuncio_my_reactions') || '{}'); } catch(e) {}
        this._rebuildEmojiRow(anuncioId, this._anuncioRemoteReactions[anuncioId], EMOJIS, myR[anuncioId] || {});
    },

    _rebuildEmojiRow(anuncioId, emojis, EMOJIS) {
        const rowEl = document.getElementById('emoji-row-' + anuncioId);
        if (!rowEl) return;
        rowEl.innerHTML = EMOJIS.map(em => {
            const cnt = (emojis && emojis[em]) ? Number(emojis[em]) : 0;
            const active = cnt > 0;
            return '<button onclick="app._anuncioReact(\'' + anuncioId + '\',\'' + em + '\',this)"'
                + ' data-emoji="' + em + '"'
                + ' style="background:' + (active ? '#fff7ed' : '#f8fafc') + ';'
                + 'border:1.5px solid ' + (active ? '#fed7aa' : '#e2e8f0') + ';'
                + 'border-radius:20px;padding:5px 11px;cursor:pointer;font-size:0.92rem;'
                + 'display:inline-flex;align-items:center;gap:4px;transition:all 0.15s;font-family:inherit;">'
                + '<span>' + em + '</span>'
                + (active ? '<span style="font-size:0.75rem;font-weight:700;color:#f97316;margin-left:3px;">' + cnt + '</span>' : '')
                + '</button>';
        }).join('');
    },
    _anuncioReact(anuncioId, emoji, btn) {
        // -- Load my personal reactions (toggle state) --
        let myR = {};
        try { myR = JSON.parse(localStorage.getItem('anuncio_my_reactions') || '{}'); } catch(e) {}
        if (!myR[anuncioId]) myR[anuncioId] = {};

        const alreadyReacted = !!myR[anuncioId][emoji];

        // -- Animate --
        btn.style.transform = 'scale(1.35)';
        btn.disabled = true;
        setTimeout(() => { btn.style.transform = ''; btn.disabled = false; }, 600);

        // -- Update state --
        if (!this._anuncioRemoteReactions) this._anuncioRemoteReactions = {};
        if (!this._anuncioRemoteReactions[anuncioId]) this._anuncioRemoteReactions[anuncioId] = {};

        let newCount;
        if (alreadyReacted) {
            // TOGGLE OFF: quitar reacción
            newCount = Math.max(0, (this._anuncioRemoteReactions[anuncioId][emoji] || 1) - 1);
            this._anuncioRemoteReactions[anuncioId][emoji] = newCount;
            delete myR[anuncioId][emoji];
        } else {
            // TOGGLE ON: agregar reacción
            newCount = (this._anuncioRemoteReactions[anuncioId][emoji] || 0) + 1;
            this._anuncioRemoteReactions[anuncioId][emoji] = newCount;
            myR[anuncioId][emoji] = true;
        }

        // -- Persist my reactions & global counts locally --
        try {
            localStorage.setItem('anuncio_my_reactions', JSON.stringify(myR));
            localStorage.setItem('anuncio_reactions', JSON.stringify(this._anuncioRemoteReactions));
        } catch(e) {}

        // -- Update button directly (fast, no DOM search) --
        const active = !alreadyReacted && newCount > 0;
        const mine   = !alreadyReacted;
        btn.style.background  = mine && newCount > 0 ? 'linear-gradient(135deg,#f97316,#ea580c)' : (newCount > 0 ? '#fff7ed' : '#f8fafc');
        btn.style.borderColor = newCount > 0 ? '#f97316' : '#e2e8f0';
        btn.style.color       = mine && newCount > 0 ? 'white' : '#374151';
        btn.innerHTML = '<span>' + emoji + '</span>'
            + (newCount > 0 ? '<span style="font-size:0.75rem;font-weight:800;margin-left:3px;">' + newCount + '</span>' : '');

        // -- Sync to Supabase (non-blocking) --
        const dbMethod = alreadyReacted ? 'unreactAnuncio' : 'reactAnuncio';
        if (typeof db !== 'undefined' && db[dbMethod]) {
            db[dbMethod](anuncioId, emoji).then(realCount => {
                if (realCount !== null && realCount !== undefined) {
                    this._anuncioRemoteReactions[anuncioId][emoji] = realCount;
                    // Reload the full row with corrected count
                    const EMOJIS = ['\u2764\ufe0f','\ud83d\udc4d','\ud83d\udc4f','\ud83d\ude4c','\ud83d\ude09'];
                    const myRFresh = (() => { try { return JSON.parse(localStorage.getItem('anuncio_my_reactions') || '{}'); } catch(e) { return {}; } })();
                    this._rebuildEmojiRow(anuncioId, this._anuncioRemoteReactions[anuncioId], EMOJIS, myRFresh[anuncioId] || {});
                }
            }).catch(() => {});
        }
    },

    _rebuildEmojiRow(anuncioId, emojis, EMOJIS, myEmojis) {
        const rowEl = document.getElementById('emoji-row-' + anuncioId);
        if (!rowEl) return;
        myEmojis = myEmojis || {};
        rowEl.innerHTML = EMOJIS.map(em => {
            const cnt  = (emojis && emojis[em]) ? Number(emojis[em]) : 0;
            const mine = !!myEmojis[em];
            const bg   = mine   ? 'linear-gradient(135deg,#f97316,#ea580c)' : (cnt > 0 ? '#fff7ed' : '#f8fafc');
            const bc   = cnt > 0 ? '#f97316' : '#e2e8f0';
            const col  = mine ? 'white' : '#374151';
            return '<button onclick="app._anuncioReact(\'' + anuncioId + '\',\'' + em + '\',this)"'
                + ' data-emoji="' + em + '"'
                + ' title="' + (mine ? 'Toca para quitar tu reacción' : 'Reaccionar') + '"'
                + ' style="background:' + bg + ';border:1.5px solid ' + bc + ';color:' + col + ';'
                + 'border-radius:20px;padding:5px 11px;cursor:pointer;font-size:0.92rem;'
                + 'display:inline-flex;align-items:center;gap:4px;transition:all 0.15s;font-family:inherit;">'
                + '<span>' + em + '</span>'
                + (cnt > 0 ? '<span style="font-size:0.75rem;font-weight:800;margin-left:3px;">' + cnt + '</span>' : '')
                + '</button>';
        }).join('');
    },

    async shareAnuncio(anuncioId, title, description, photoUrl) {
        let pageUrl = 'https://edurojo46-cmyk.github.io/solidaridad/';
        const shareUrl = pageUrl + '?anuncio=' + anuncioId;

        const shareData = {
            title: title || 'Anuncio Solidaridad',
            text: (description || '').substring(0, 120) + (description && description.length > 120 ? '...' : ''),
            url: shareUrl
        };
        if (navigator.share) {
            try {
                await navigator.share(shareData);
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
            }
        }
        try {
            await navigator.clipboard.writeText(shareUrl);
            this._showShareToast('Enlace copiado al portapapeles \uD83D\uDCCB');
        } catch(e) {
            this._showShareToast('CompartÃ­ este anuncio: ' + shareUrl);
        }
    },

    _showShareToast(msg) {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;padding:10px 20px;border-radius:20px;font-size:0.88rem;font-weight:600;z-index:999999;box-shadow:0 4px 16px rgba(0,0,0,0.25);white-space:nowrap;animation:scFadeIn 0.2s ease;';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2800);
    },

    _anuncioAvatarColor(name) {
        const colors = ['linear-gradient(135deg,#3b82f6,#2563eb)','linear-gradient(135deg,#8b5cf6,#6d28d9)','linear-gradient(135deg,#10b981,#059669)','linear-gradient(135deg,#f59e0b,#d97706)','linear-gradient(135deg,#ef4444,#dc2626)','linear-gradient(135deg,#ec4899,#db2777)'];
        let h = 0; for (let i = 0; i < (name||'').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
        return colors[Math.abs(h) % colors.length];
    },

    filterAnunciosByCreator(creatorId, creatorName, evt) {
        if (evt) evt.stopPropagation();
        this._anuncioActiveCreatorId = creatorId;
        this._anuncioActiveCreatorName = creatorName;
        // Update chip
        const chip = document.getElementById('anuncios-filter-chip');
        const label = document.getElementById('anuncios-filter-label');
        if (chip) chip.style.display = '';
        if (label) label.textContent = creatorName;
        // Filter cache
        let filtered = this._anuncioCache;
        if (creatorId) {
            filtered = this._anuncioCache.filter(a => a.creator_id === creatorId || a.creator_name === creatorName);
        } else {
            filtered = this._anuncioCache.filter(a => a.creator_name === creatorName);
        }
        this._renderAnuncioCards(filtered);
        // Update search input
        const inp = document.getElementById('anuncios-user-search');
        const clr = document.getElementById('anuncios-search-clear');
        if (inp) inp.value = creatorName;
        if (clr) clr.style.display = '';
        const dd = document.getElementById('anuncios-user-dropdown');
        if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
    },

    clearAnuncioUserFilter() {
        this._anuncioActiveCreatorId = null;
        this._anuncioActiveCreatorName = null;
        const chip = document.getElementById('anuncios-filter-chip');
        const inp = document.getElementById('anuncios-user-search');
        const clr = document.getElementById('anuncios-search-clear');
        const dd = document.getElementById('anuncios-user-dropdown');
        if (chip) chip.style.display = 'none';
        if (inp) inp.value = '';
        if (clr) clr.style.display = 'none';
        if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
        this._renderAnuncioCards(this._anuncioCache);
        const _ids = this._anuncioCache.map(a => a.id || a.created_at).filter(Boolean);
        this._initAnuncioReactions(_ids);
    },

    async onAnuncioUserSearch(query) {
        const clr = document.getElementById('anuncios-search-clear');
        if (clr) clr.style.display = query ? '' : 'none';
        // Clear chip if user is typing again
        if (this._anuncioActiveCreatorName && query !== this._anuncioActiveCreatorName) {
            this._anuncioActiveCreatorId = null;
            this._anuncioActiveCreatorName = null;
            const chip = document.getElementById('anuncios-filter-chip');
            if (chip) chip.style.display = 'none';
            this._renderAnuncioCards(this._anuncioCache);
        }
        if (!query || query.trim().length < 2) {
            const dd = document.getElementById('anuncios-user-dropdown');
            if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
            return;
        }
        clearTimeout(this._anuncioSearchTimeout);
        this._anuncioSearchTimeout = setTimeout(async () => {
            await this._fetchAnuncioUserSuggestions(query.trim());
        }, 280);
    },

    async _fetchAnuncioUserSuggestions(query) {
        const dd = document.getElementById('anuncios-user-dropdown');
        if (!dd) return;
        dd.innerHTML = '<div style="padding:12px 16px;color:#94a3b8;font-size:0.9rem;"><i class="ri-loader-4-line ri-spin"></i> Buscando...</div>';
        dd.style.display = '';

        // 1. Search from cached anuncios (local, instant)
        const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const q = norm(query);
        const seen = new Set();
        const localMatches = [];
        this._anuncioCache.forEach(a => {
            const key = a.creator_id || a.creator_name;
            if (!seen.has(key) && norm(a.creator_name).includes(q)) {
                seen.add(key);
                localMatches.push({ id: a.creator_id||null, name: a.creator_name, source: 'anuncio' });
            }
        });

        // 2. Also search profiles in Supabase
        let profileMatches = [];
        if (typeof db !== 'undefined' && db.searchUsers) {
            try {
                const results = await db.searchUsers(query);
                results.forEach(u => {
                    if (!seen.has(u.id)) {
                        seen.add(u.id);
                        profileMatches.push({ id: u.id, name: u.name, username: u.username, source: 'profile' });
                    }
                });
            } catch(e) {}
        }

        const all = [...localMatches, ...profileMatches].slice(0, 8);
        if (all.length === 0) {
            dd.innerHTML = '<div style="padding:14px 16px;color:#94a3b8;font-size:0.9rem;text-align:center;"><i class="ri-user-search-line" style="font-size:1.5rem;display:block;margin-bottom:6px;"></i>Sin resultados para "' + query + '"</div>';
            return;
        }
        dd.innerHTML = all.map((u, i) => {
            const avatarColor = app._anuncioAvatarColor(u.name);
            const badge = u.source === 'anuncio' ? '<span style="background:#eff6ff;color:#3b82f6;font-size:0.7rem;font-weight:700;padding:2px 7px;border-radius:6px;margin-left:4px;">Ha publicado</span>' : '';
            return `<div onclick="app.selectAnuncioUser('${(u.id||'').replace(/'/g,"\\'")}','${u.name.replace(/'/g,"\\'")}',${i})"
                style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;transition:background 0.15s;border-bottom:${i<all.length-1?'1px solid #f1f5f9':'none'};"
                onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''"
                id="anuncio-dd-item-${i}">
                <div style="width:36px;height:36px;border-radius:50%;background:${avatarColor};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:0.9rem;flex-shrink:0;">${u.name.charAt(0).toUpperCase()}</div>
                <div style="min-width:0;">
                    <div style="font-weight:600;color:#1e293b;font-size:0.9rem;">${u.name}${badge}</div>
                    ${u.username ? '<div style="font-size:0.8rem;color:#94a3b8;">' + u.username + '</div>' : ''}
                </div>
            </div>`;
        }).join('');
    },

    selectAnuncioUser(creatorId, creatorName, idx) {
        this.filterAnunciosByCreator(creatorId, creatorName, null);
    },

    openAnuncioModal() {
        const form = document.getElementById('form-anuncio');
        if (form) form.reset();
        const prev = document.getElementById('anuncio-photo-preview');
        if (prev) { prev.style.display = 'none'; prev.src = ''; }
        this.anuncioFile = null;
        const modal = document.getElementById('anuncio-modal-overlay');
        if (modal) { modal.style.display = 'flex'; setTimeout(() => modal.classList.add('active'), 10); }
    },

    closeAnuncioModal() {
        const modal = document.getElementById('anuncio-modal-overlay');
        if (!modal) return;
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
    },

    handleAnuncioPhoto(e) {
        const file = e.target.files[0];
        if (!file) return;
        this.anuncioFile = file;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = document.getElementById('anuncio-photo-preview');
            if (img) { img.src = ev.target.result; img.style.display = 'block'; }
        };
        reader.readAsDataURL(file);
    },

    async submitAnuncio() {
        const title = document.getElementById('anuncio-title')?.value.trim();
        const desc = document.getElementById('anuncio-desc')?.value.trim();
        if (!title || !desc) return;
        const btn = document.getElementById('btn-submit-anuncio');
        const orig = btn ? btn.innerHTML : '';
        if (btn) { btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Publicando...'; btn.disabled = true; }
        const user = (typeof auth !== 'undefined' && auth.isAuthenticated()) ? auth.getCurrentUser() : null;
        let photo_url = null;
        if (this.anuncioFile && typeof db !== 'undefined' && db.uploadAnuncioMedia) {
            photo_url = await db.uploadAnuncioMedia(this.anuncioFile);
        }
        const payload = {
            title,
            description: desc,
            photo_url,
            creator_id: user ? (user.id || null) : null,
            creator_name: user ? (user.name || 'An\u00f3nimo') : 'An\u00f3nimo',
            created_at: new Date().toISOString()
        };
        if (typeof db !== 'undefined' && db.createAnuncio) {
            await db.createAnuncio(payload);
        }
        this.closeAnuncioModal();
        if (btn) { btn.innerHTML = orig; btn.disabled = false; }
        this.loadAnuncios();
    },

    // Buscar page: filter cards by search text
    filterBuscarCards(query) {
        const cards = document.querySelectorAll('#rosary-list .rosary-card');
        const q = query.toLowerCase().trim();
        let visible = 0;
        let firstMatchMarker = null;

        cards.forEach(card => {
            const text = card.textContent.toLowerCase();
            const show = !q || text.includes(q);
            card.style.display = show ? '' : 'none';
            if (show) visible++;
        });

        if (this._buscarMarkers) {
            this._buscarMarkers.forEach(m => {
                if (!m.rosaryData) return;
                const match = !q || (m.rosaryData.place && m.rosaryData.place.toLowerCase().includes(q)) || (m.rosaryData.intention && m.rosaryData.intention.toLowerCase().includes(q));
                if (match && !firstMatchMarker && q.length > 2) {
                    firstMatchMarker = m;
                }
            });
            if (firstMatchMarker) {
                this.buscarMap.setView(firstMatchMarker.getLatLng(), 14);
                setTimeout(() => firstMatchMarker.openPopup(), 300);
            }
        }

        const countEl = document.getElementById('buscar-cards-count');
        if (countEl) countEl.textContent = visible + ' encontrados';
        const emptyEl = document.getElementById('buscar-empty');
        if (emptyEl) emptyEl.style.display = visible === 0 ? '' : 'none';
    },

    // Buscar page: filter by time chip
    filterByTime(btn, period) {
        document.querySelectorAll('.buscar-chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        // For now just show all - future: integrate with date filtering
        this.filterBuscarCards(document.getElementById('buscar-search-input')?.value || '');
    },

    async renderProfileMyRosaries() {
        const container = document.getElementById('profile-my-rosaries'); if (!container) return;
        const user = auth.getCurrentUser(); if (!user) return;

        // Load local rosaries first
        let localRosaries = this.getActiveRosaries();
        let allRosaries = localRosaries.slice(); // copy

        // Merge Supabase rosaries (don't replace local ones)
        if (typeof db !== 'undefined' && db.getRosaries) {
            try {
                var remote = await db.getRosaries();
                if (remote && remote.length > 0) {
                    var localIds = {};
                    localRosaries.forEach(function(r) { localIds[r.id] = true; if (r.supabaseId) localIds[r.supabaseId] = true; });
                    remote.forEach(function(r) {
                        if (!localIds[r.id]) {
                            allRosaries.push({
                                id: r.id, place: r.place, address: r.address || '', date: r.date, time: r.time,
                                mystery: r.mystery, intention: r.intention, lat: r.lat, lng: r.lng,
                                participants: r.participants || 1, creatorId: r.creator_id,
                                creatorName: r.creator_name || 'Anónimo'
                            });
                        }
                    });
                }
            } catch(e) { console.warn('[Profile] Supabase rosaries failed:', e.message); }
        }

        // Get Supabase user UUID for matching (local auth ID is different)
        var supabaseUserId = null;
        var sbSession = localStorage.getItem('sb-spplofkotgvumfkeltsr-auth-token');
        if (sbSession) { try { var p = JSON.parse(sbSession); supabaseUserId = p.user ? p.user.id : null; } catch(e) {} }
        var userName = user.name ? user.name.toLowerCase().trim() : '';

        const myRosaries = allRosaries.filter(function(r) {
            // Match by creator_id (UUID or local)
            if (r.creatorId) {
                if (supabaseUserId && r.creatorId === supabaseUserId) return true;
                if (r.creatorId === user.id) return true;
            }
            // Fallback: ALWAYS check by creator_name (works for local auth without Supabase UUID)
            if (r.creatorName && userName && r.creatorName.toLowerCase().trim() === userName) return true;
            return false;
        });

        if (myRosaries.length === 0) {
            container.innerHTML = '<div class="profile-no-slots glass card"><i class="ri-add-circle-line"></i><p>Aún no creaste ningún rosario</p><button class="btn btn-primary" onclick="app.navigate(\'screen-create-rosary\')"><i class="ri-add-line"></i> Crear Rosario</button></div>';
            return;
        }
        let html = '';
        myRosaries.forEach(r => {
            const ds = this.formatDate(r.date);
            const confirmCount = r.participants || 1;
            var safePlaceName = (r.place||'').replace(/'/g, "\\'");
            html += '<div class="profile-rosary-card glass card">' +
                '<div class="profile-rosary-header">' +
                    '<div class="profile-rosary-icon coord-icon"><i class="ri-shield-star-fill"></i></div>' +
                    '<div class="profile-rosary-info">' +
                        '<h4>' + r.place + '</h4>' +
                        '<p><i class="ri-time-line"></i> ' + ds + ' ' + r.time + ' hs ┬À Misterios ' + r.mystery + '</p>' +
                        '<span class="profile-rosary-intention"><i class="ri-candle-fill"></i> ' + r.intention + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="profile-rosary-footer">' +
                    '<div class="profile-rosary-stats">' +
                        '<span class="profile-rosary-badge coord-badge"><i class="ri-shield-star-fill"></i> Coordinador</span>' +
                        '<span class="profile-rosary-confirmed"><i class="ri-check-double-fill"></i> ' + confirmCount + ' confirmados</span>' +
                    '</div>' +
                    '<div class="profile-rosary-actions">' +
                        '<button class="btn btn-primary profile-rosary-btn" onclick="app._currentRosary = {id:\'' + r.id + '\',place:\'' + safePlaceName + '\',date:\'' + (r.date||'') + '\',time:\'' + (r.time||'') + '\',mystery:\'' + (r.mystery||'') + '\',intention:\'' + (r.intention||'').replace(/'/g, "\\'") + '\',creatorId:\'' + (r.creatorId||'') + '\',creatorName:\'' + (r.creatorName||'').replace(/'/g, "\\'") + '\',participants:' + (r.participants||1) + '}; app.navigate(\'screen-rezo\')"><i class="ri-play-circle-fill"></i> Rezar</button>' +
                        '<button class="btn profile-rosary-cancel-btn" onclick="app.cancelRosary(\'' + r.id + '\',\'' + safePlaceName + '\')" title="Cancelar rosario"><i class="ri-delete-bin-line"></i> Cancelar</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        });
        container.innerHTML = html;
    },

    async renderProfileJoined() {
        const container = document.getElementById('profile-joined-rosaries'); if (!container) return;
        const user = auth.getCurrentUser();
        var joined = this.getActiveJoinedRosaries();

        // Load full rosary data from Supabase to get creatorName and enrich joined data
        var fullRosaries = {};
        if (typeof db !== 'undefined' && db.getRosaries) {
            try {
                var remote = await db.getRosaries();
                if (remote) remote.forEach(function(r) {
                    fullRosaries[r.id] = { creatorId: r.creator_id, creatorName: r.creator_name || 'Anónimo', place: r.place, date: r.date, time: r.time, mystery: r.mystery, intention: r.intention, participants: r.participants || 1 };
                });
            } catch(e) {}
        }
        // Also check local rosaries
        this.getActiveRosaries().forEach(function(r) {
            if (!fullRosaries[r.id]) fullRosaries[r.id] = { creatorId: r.creatorId, creatorName: r.creatorName || 'Anónimo', place: r.place, date: r.date, time: r.time, mystery: r.mystery, intention: r.intention, participants: r.participants || 1 };
        });

        // Enrich joined rosaries with full data (fill missing fields)
        joined = joined.map(function(r) {
            var full = fullRosaries[r.id];
            if (full) {
                return {
                    id: r.id,
                    name: r.name || full.place || 'Rosario',
                    time: r.time || full.time || '',
                    mystery: r.mystery || full.mystery || '',
                    intention: r.intention || full.intention || '',
                    participants: full.participants || r.participants || 1,
                    date: r.date || full.date || '',
                    joinedAt: r.joinedAt
                };
            }
            return r;
        });

        // Filter out rosaries that user created (those go in 'Mis Rosarios')
        var supabaseUserId = null;
        var sbSession = localStorage.getItem('sb-spplofkotgvumfkeltsr-auth-token');
        if (sbSession) { try { var p = JSON.parse(sbSession); supabaseUserId = p.user ? p.user.id : null; } catch(e) {} }
        var userName = user ? (user.name || '').toLowerCase().trim() : '';
        const joinedOnly = joined.filter(function(r) {
            var full = fullRosaries[r.id];
            if (!full) return true;
            // Exclude if user is the creator
            if (full.creatorId && supabaseUserId && full.creatorId === supabaseUserId) return false;
            if (full.creatorId && user && full.creatorId === user.id) return false;
            if (full.creatorName && userName && full.creatorName.toLowerCase().trim() === userName) return false;
            return true;
        });

        if (joinedOnly.length === 0) {
            container.innerHTML = '<div class="profile-no-slots glass card"><i class="ri-map-pin-line"></i><p>Aún no te uniste a ningún rosario</p><button class="btn btn-primary" onclick="app.navigate(\'screen-map\')"><i class="ri-search-line"></i> Buscar Rosario</button></div>';
            return;
        }
        let html = '';
        joinedOnly.forEach(r => {
            var full = fullRosaries[r.id] || {};
            var coordName = full.creatorName || 'Anónimo';
            var coordId = full.creatorId || '';
            html += '<div class="profile-rosary-card glass card">' +
                '<div class="profile-rosary-header">' +
                    '<div class="profile-rosary-icon joined-icon"><i class="ri-map-pin-fill"></i></div>' +
                    '<div class="profile-rosary-info">' +
                        '<h4>' + r.name + '</h4>' +
                        '<p><i class="ri-time-line"></i> Hoy ' + r.time + ' hs ┬À Misterios ' + (r.mystery || '') + '</p>' +
                        '<span class="profile-rosary-intention"><i class="ri-candle-fill"></i> ' + r.intention + '</span>' +
                        '<span style="font-size:0.7rem;color:var(--clr-text-muted)"><i class="ri-shield-star-line"></i> Coordina: ' + coordName + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="profile-rosary-footer">' +
                    '<div class="profile-rosary-stats">' +
                        '<span class="profile-rosary-badge joined-badge"><i class="ri-check-line"></i> Unido</span>' +
                    '</div>' +
                    '<div class="profile-rosary-actions">' +
                        '<button class="btn btn-primary profile-rosary-btn" onclick="app._currentRosary = {id:\'' + r.id + '\',place:\'' + (r.name || '').replace(/'/g, "\\'") + '\',time:\'' + r.time + '\',mystery:\'' + (r.mystery || '') + '\',intention:\'' + (r.intention || '').replace(/'/g, "\\'") + '\',creatorId:\'' + coordId + '\',creatorName:\'' + coordName.replace(/'/g, "\\'") + '\'}; app.navigate(\'screen-rezo\')"><i class="ri-play-circle-fill"></i> Rezar</button>' +
                        '<button class="btn profile-rosary-leave-btn" onclick="app.confirmLeaveRosary(\'' + r.id + '\',\'' + (r.name || '').replace(/'/g, "\\'") + '\')" title="Desunirme"><i class="ri-logout-circle-r-line"></i> Salir</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        });
        container.innerHTML = html;
    },

    setPickerLocation(lat, lng) {
        if (this.pickerMarker) this.pickerMap.removeLayer(this.pickerMarker);
        const icon = L.divIcon({ className: 'custom-marker-wrapper', html: '<div class="custom-map-marker picker-pin"><i class="ri-map-pin-add-fill" style="font-size:1.2rem"></i></div>', iconSize: [48,56], iconAnchor: [24,56] });
        this.pickerMarker = L.marker([lat, lng], { icon }).addTo(this.pickerMap);
        this.pickerLocation = { lat, lng };
        const ov = document.getElementById('picker-overlay'); if (ov) ov.style.display = 'none';
        const co = document.getElementById('picker-coords'); if (co) { co.innerHTML = '<i class="ri-map-pin-fill"></i> ' + lat.toFixed(4) + ', ' + lng.toFixed(4); co.classList.add('visible'); }
        const er = document.getElementById('rosary-location-error'); if (er) er.textContent = '';
    },

    getRosaries() { try { return JSON.parse(localStorage.getItem(this.ROSARY_STORAGE_KEY)) || []; } catch { return []; } },

    // Check if a rosary's date+time has already passed
    isRosaryExpired(rosary) {
        if (!rosary.date) return false;
        const now = new Date();
        const rosaryDate = new Date(rosary.date + 'T' + (rosary.time || '23:59'));
        // Add 2 hours grace period after scheduled time
        rosaryDate.setHours(rosaryDate.getHours() + 2);
        return now > rosaryDate;
    },

    // Get only rosaries whose date hasn't passed yet
    getActiveRosaries() {
        return this.getRosaries().filter(r => !this.isRosaryExpired(r));
    },

    // Get only joined rosaries that haven't expired
    getActiveJoinedRosaries() {
        return this.getJoinedRosaries().filter(r => {
            // Joined rosaries may not have a date field, check via saved rosaries
            if (r.date) return !this.isRosaryExpired(r);
            // Look up the original rosary to check its date
            const original = this.getRosaries().find(o => o.id === r.id);
            if (original) return !this.isRosaryExpired(original);
            return true; // Keep if we can't determine expiry
        });
    },

    // Auto-select the best rosary for the Rezar screen
    async getAutoRosary() {
        var user = auth.isAuthenticated() ? auth.getCurrentUser() : null;
        if (!user) return null;
        
        var userName = (user.name || '').toLowerCase().trim();
        var now = new Date();
        
        // Merge local + Supabase rosaries for full coverage
        var localRosaries = this.getActiveRosaries();
        var allActive = [].concat(localRosaries);
        
        // Fetch from Supabase to include rosaries created on other devices
        if (typeof db !== 'undefined' && db.getRosaries) {
            try {
                var remote = await db.getRosaries();
                if (remote && remote.length > 0) {
                    var localIds = {};
                    allActive.forEach(function(r) { localIds[r.id] = true; });
                    remote.forEach(function(r) {
                        if (!localIds[r.id]) {
                            // Convert Supabase format to local format
                            allActive.push({
                                id: r.id, place: r.place, date: r.date, time: r.time,
                                mystery: r.mystery, intention: r.intention,
                                creatorId: r.creator_id, creatorName: r.creator_name,
                                participants: r.participants || 1, address: r.address,
                                lat: r.lat, lng: r.lng
                            });
                        }
                    });
                }
            } catch(e) { console.warn('[Auto] Supabase fetch failed:', e.message); }
        }
        
        // Helper: calculate time distance from now (in minutes)
        function timeDistance(r) {
            if (!r.date || !r.time) return 999999;
            var dt = new Date(r.date + 'T' + r.time);
            return Math.abs(dt.getTime() - now.getTime()) / 60000;
        }
        
        // 1. Priority: Rosary the user COORDINATES (closest to now)
        var supabaseUserId = null;
        var sbSession = localStorage.getItem('sb-spplofkotgvumfkeltsr-auth-token');
        if (sbSession) { try { var p = JSON.parse(sbSession); supabaseUserId = p.user ? p.user.id : null; } catch(e) {} }
        
        var coordinated = allActive.filter(function(r) {
            if (r.creatorId && supabaseUserId && r.creatorId === supabaseUserId) return true;
            if (r.creatorId && user && r.creatorId === user.id) return true;
            if (r.creatorName && userName && r.creatorName.toLowerCase().trim() === userName) return true;
            return false;
        }).sort(function(a, b) { return timeDistance(a) - timeDistance(b); });
        
        if (coordinated.length > 0) {
            console.log('[Auto] Selected coordinated rosary:', coordinated[0].place);
            return coordinated[0];
        }
        
        // 2. Fallback: Rosary the user JOINED (closest to now)
        var joined = this.getActiveJoinedRosaries().sort(function(a, b) {
            return timeDistance(a) - timeDistance(b);
        });
        
        if (joined.length > 0) {
            var j = joined[0];
            console.log('[Auto] Selected joined rosary:', j.name);
            // Try to enrich with creator info from allActive list
            var enriched = allActive.find(function(r) { return r.id === j.id; });
            var creatorId = (enriched && enriched.creatorId) ? enriched.creatorId : (j.creatorId || null);
            var creatorName = (enriched && enriched.creatorName) ? enriched.creatorName : (j.creatorName || 'Anónimo');
            return { id: j.id, place: j.name, time: j.time, mystery: j.mystery, intention: j.intention, date: j.date, participants: j.participants || 1, creatorId: creatorId, creatorName: creatorName };
        }
        
        // 3. Last fallback: Any active rosary closest to now
        var closest = allActive.sort(function(a, b) { return timeDistance(a) - timeDistance(b); });
        if (closest.length > 0) {
            console.log('[Auto] Selected closest rosary:', closest[0].place);
            return closest[0];
        }
        
        return null;
    },

    saveRosary(r) {
        // Save locally
        const a = this.getRosaries(); a.push(r); localStorage.setItem(this.ROSARY_STORAGE_KEY, JSON.stringify(a));
        // Sync to Supabase
        if (typeof db !== 'undefined' && db.createRosary) {
            // Try to get the Supabase user UUID from the session storage
            var supabaseCreatorId = null;
            var sbSession = localStorage.getItem('sb-spplofkotgvumfkeltsr-auth-token');
            if (sbSession) {
                try {
                    var parsed = JSON.parse(sbSession);
                    supabaseCreatorId = parsed.user ? parsed.user.id : null;
                } catch(e) {}
            }
            console.log('[SaveRosary] Local creatorId:', r.creatorId, '| Supabase UUID:', supabaseCreatorId);
            var payload = {
                place: r.place, address: r.address || '', date: r.date, time: r.time,
                mystery: r.mystery, intention: r.intention, lat: r.lat, lng: r.lng,
                creator_name: r.creatorName || 'Anónimo', participants: r.participants || 1
            };
            // Only include creator_id if we have a valid Supabase UUID (it's a FK to profiles.id)
            if (supabaseCreatorId) {
                payload.creator_id = supabaseCreatorId;
            }
            db.createRosary(payload).then(function(result) {
                console.log('Ô£à Rosario guardado en Supabase, id:', result.id);
                // Update local rosary with Supabase ID for dedup
                if (result.id && result.id !== r.id) {
                    r.supabaseId = result.id;
                    // Update localStorage with the supabaseId
                    try {
                        var stored = JSON.parse(localStorage.getItem('redmaria_rosaries') || '[]');
                        var found = stored.find(function(s) { return s.id === r.id; });
                        if (found) { found.supabaseId = result.id; localStorage.setItem('redmaria_rosaries', JSON.stringify(stored)); }
                    } catch(e) {}
                }
            }).catch(function(e) { console.error('ÔØî Error guardando rosario en Supabase:', e.message || e); });
        }
    },


    addRosaryCard(rosary) {
        const list = document.getElementById('rosary-list'); if (!list) return;
        const ds = this.formatDate(rosary.date);
        const joined = this.getJoinedRosaries();
        const isJoined = joined.some(j => j.id === rosary.id);
        const card = document.createElement('div');
        card.className = 'rosary-card glass card';
        card.onclick = () => { app._currentRosary = rosary; app.navigate('screen-rezo'); };
        var addrHtml = rosary.address ? '<div class="rosary-card-detail"><i class="ri-road-map-fill"></i> ' + rosary.address + '</div>' : '';
        var btnLabel = isJoined ? '<i class="ri-check-line"></i> Unido' : '<i class="ri-add-circle-line"></i> Unirme';
        var btnClass = isJoined ? 'btn btn-secondary-outline btn-join' : 'btn btn-primary btn-join';
        
        var shareBtnHtml = '<button class="btn-share-rosary" title="Compartir Rosario" style="background:none; border:none; color:var(--clr-primary); font-size:1.4rem; padding:4px; cursor:pointer; margin-left:auto;"><i class="ri-share-fill"></i></button>';
        
        var u = (typeof auth !== 'undefined' && auth.isAuthenticated()) ? auth.getCurrentUser() : null;
        var isCreator = u && rosary.creatorId === u.id;
        var cancelBtnHtml = isCreator ? '<button class="btn btn-cancel-rosary" style="margin-top:8px; width:100%; padding:10px; font-size:0.9rem; background:transparent; color:#e74c3c; border:1px solid #e74c3c; border-radius:12px; transition:all 0.2s;"><i class="ri-delete-bin-line"></i> Cancelar Rosario</button>' : '';
        
        card.innerHTML = '<div class="rosary-card-header"><div class="rosary-card-icon"><i class="ri-map-pin-fill"></i></div><div class="rosary-card-info"><h3>' + rosary.place + '</h3><p>' + ds + ' ' + rosary.time + ' hs ┬À Misterios ' + rosary.mystery + '</p></div>' + shareBtnHtml + '</div><div class="rosary-card-details">' + addrHtml + '<div class="rosary-card-detail"><i class="ri-candle-fill"></i> ' + rosary.intention + '</div><div class="rosary-card-detail"><i class="ri-group-fill"></i> ' + (rosary.participants || 1) + ' Participantes</div></div><button class="' + btnClass + '" data-rosary-id="' + rosary.id + '">' + btnLabel + '</button>' + cancelBtnHtml;
        
        // Attach join handler to button (stopPropagation to not trigger card click)
        var btn = card.querySelector('.btn-join');
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!auth || !auth.isAuthenticated()) {
                alert("Debes iniciar sesión para unirte a un rosario.");
                app.navigate('screen-login');
                return;
            }
            app._currentRosary = rosary;
            if (!isJoined) {
                app.joinRosary(rosary.id, rosary.place || 'Rosario', rosary.time || '', rosary.mystery || '', rosary.intention || '', rosary.participants || 1, rosary.date || '');
                btn.innerHTML = '<i class="ri-check-line"></i> Unido';
                btn.className = 'btn btn-secondary-outline btn-join';
            }
            app.navigate('screen-rezo');
        });
        
        // Attach share handler
        var shareBtn = card.querySelector('.btn-share-rosary');
        if (shareBtn) {
            shareBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                app.shareRosary(rosary);
            });
        }
        
        // Attach cancel handler
        var cancelBtn = card.querySelector('.btn-cancel-rosary');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                app.cancelRosary(rosary.id, rosary.place || 'Rosario');
            });
        }
        
        list.appendChild(card);
    },

    shareRosary(rosary) {
        var url = window.location.origin + window.location.pathname + '?rosary=' + rosary.id;
        var text = 'Ánete al rosario en ' + rosary.place + ' el ' + this.formatDate(rosary.date) + ' a las ' + rosary.time + ' hs.';
        
        if (navigator.share) {
            navigator.share({
                title: 'Red Maráa - Rosario',
                text: text,
                url: url
            }).catch(function(error) {
                console.log('Error compartiendo', error);
            });
        } else {
            // Fallback to copy clipboard
            navigator.clipboard.writeText(text + ' ' + url).then(function() {
                alert("Enlace copiado al portapapeles. ┬íPégalo donde quieras compartirlo!");
            }).catch(function(err) {
                alert("No se pudo copiar: " + url);
            });
        }
    },

    formatDate(s) {
        if (!s) return '';
        const d = new Date(s + 'T00:00:00'), t = new Date(); t.setHours(0,0,0,0);
        if (d.getTime() === t.getTime()) return 'Hoy';
        if (d.getTime() === t.getTime() + 86400000) return 'Mañana';
        return d.getDate() + ' ' + ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()];
    },

    setupCreateRosaryForm() {
        const form = document.getElementById('create-rosary-form'); if (!form) return;
        const di = document.getElementById('rosary-date'); if (di) { const td = new Date().toISOString().split('T')[0]; di.min = td; di.value = td; }
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const country = document.getElementById('rosary-country') ? document.getElementById('rosary-country').value : '';
            const citySelect = document.getElementById('rosary-city') ? document.getElementById('rosary-city').value : '';
            const ciudadInput = document.getElementById('rosary-ciudad') ? document.getElementById('rosary-ciudad').value.trim() : '';
            const city = ciudadInput || citySelect;
            const place = document.getElementById('rosary-place').value.trim();
            const date = document.getElementById('rosary-date').value;
            const time = document.getElementById('rosary-time').value;
            
            let hasErr = false;
            [
                {id:'rosary-country', v:country, m:'Selecciona un paás'},
                {id:'rosary-ciudad', v:city, m:'Ingresa una ciudad'},
                {id:'rosary-place', v:place, m:'Obligatorio'},
                {id:'rosary-date', v:date, m:'Obligatoria'},
                {id:'rosary-time', v:time, m:'Obligatoria'}
            ].forEach(f => {
                const el = document.getElementById(f.id), g = el?.closest('.auth-field'), er = g?.querySelector('.field-error');
                if (!f.v) { if (g) g.classList.add('has-error'); if (er) er.textContent = f.m; hasErr = true; }
                else { if (g) { g.classList.remove('has-error'); g.classList.add('has-success'); } if (er) er.textContent = ''; }
            });
            if (!this.pickerLocation) { const le = document.getElementById('rosary-location-error'); if (le) le.textContent = 'Marca una ubicación'; hasErr = true; }
            if (hasErr) { form.classList.add('shake'); setTimeout(() => form.classList.remove('shake'), 500); return; }
            const btn = form.querySelector('.btn-auth-submit'); btn.classList.add('loading'); btn.disabled = true;
            await new Promise(r => setTimeout(r, 800));
            const user = auth.getCurrentUser();
            const address = document.getElementById('rosary-address') ? document.getElementById('rosary-address').value.trim() : '';
            const countryName = document.getElementById('rosary-country') ? document.getElementById('rosary-country').options[document.getElementById('rosary-country').selectedIndex].text : '';
            const rosary = { id: Date.now().toString(36)+Math.random().toString(36).substr(2), place: auth.sanitize(place), address: auth.sanitize(address), country: country, countryName: countryName, city: city, date, time, mystery: '', intention: '', lat: this.pickerLocation.lat, lng: this.pickerLocation.lng, creatorId: user?.id||'anon', creatorName: user?.name||'Anónimo', createdAt: new Date().toISOString(), participants: 1 };
            this.saveRosary(rosary); this.addRosaryCard(rosary);
            btn.classList.remove('loading'); btn.disabled = false;
            form.reset(); this.pickerLocation = null;
            if (this.pickerMarker && this.pickerMap) { this.pickerMap.removeLayer(this.pickerMarker); this.pickerMarker = null; }
            const ov = document.getElementById('picker-overlay'); if (ov) ov.style.display = '';
            const co = document.getElementById('picker-coords'); if (co) { co.textContent = ''; co.classList.remove('visible'); }
            form.querySelectorAll('.auth-field').forEach(f => { f.classList.remove('has-success','has-error'); const e = f.querySelector('.field-error'); if (e) e.textContent = ''; });
            this.showRosaryDetail(rosary);
        });
    },

    showRosaryDetail(rosary) {
        const ds = this.formatDate(rosary.date);
        const user = auth.getCurrentUser();
        const details = document.getElementById('create-success-details');
        details.innerHTML = '<div class="success-detail-row"><i class="ri-map-pin-fill"></i> ' + rosary.place + '</div>' +
            (rosary.city ? '<div class="success-detail-row"><i class="ri-building-fill"></i> ' + rosary.city + ', ' + (rosary.countryName || '') + '</div>' : '') +
            (rosary.address ? '<div class="success-detail-row"><i class="ri-road-map-fill"></i> ' + rosary.address + '</div>' : '') +
            '<div class="success-detail-row"><i class="ri-calendar-fill"></i> ' + ds + ' ' + rosary.time + ' hs</div>' +
            '<div class="success-detail-row"><i class="ri-sparkling-fill"></i> Misterios ' + rosary.mystery + '</div>' +
            '<div class="success-detail-row"><i class="ri-candle-fill"></i> ' + rosary.intention + '</div>' +
            '<div class="success-detail-row"><i class="ri-user-fill"></i> Organizado por: ' + (user?.name || 'Tú') + '</div>';
        document.getElementById('create-rosary-form-wrapper').style.display = 'none';
        document.getElementById('create-success-banner').style.display = '';
    },

    resetCreateForm() {
        document.getElementById('create-success-banner').style.display = 'none';
        document.getElementById('create-rosary-form-wrapper').style.display = '';
        const form = document.getElementById('create-rosary-form');
        if (form) form.reset();
        const citySelect = document.getElementById('rosary-city');
        if (citySelect) { citySelect.innerHTML = '<option value="">Primero selecciona un paás...</option>'; citySelect.disabled = true; }
        this.pickerLocation = null;
        if (this.pickerMarker && this.pickerMap) { this.pickerMap.removeLayer(this.pickerMarker); this.pickerMarker = null; }
        const ov = document.getElementById('picker-overlay'); if (ov) ov.style.display = '';
        const co = document.getElementById('picker-coords'); if (co) { co.textContent = ''; co.classList.remove('visible'); }
    },

    // ---- Forgot / Reset Password ----
    setupForgotPasswordForm() {
        const form = document.getElementById('forgot-password-form'); if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('forgot-email').value.trim();
            const group = document.getElementById('forgot-email').closest('.auth-field');
            const errEl = group.querySelector('.field-error');
            if (!email || !auth.validators.email(email)) {
                group.classList.add('has-error'); errEl.textContent = 'Ingresa un email válido';
                return;
            }
            group.classList.remove('has-error'); group.classList.add('has-success'); errEl.textContent = '';
            const btn = form.querySelector('.btn-auth-submit'); btn.classList.add('loading'); btn.disabled = true;
            await new Promise(r => setTimeout(r, 1200));
            btn.classList.remove('loading'); btn.disabled = false;
            // Check user exists
            const users = auth.getUsers();
            const user = users.find(u => u.email === email.toLowerCase());
            if (!user) {
                group.classList.add('has-error'); errEl.textContent = 'No existe una cuenta con ese email';
                return;
            }
            // Generate 6-digit code
            this.recoveryEmail = email.toLowerCase();
            this.recoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
            // Navigate to reset screen and show code
            this.navigate('screen-reset-password');
            document.getElementById('recovery-code-value').textContent = this.recoveryCode;
        });
    },

    setupResetPasswordForm() {
        const form = document.getElementById('reset-password-form'); if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('reset-code').value.trim();
            const password = document.getElementById('reset-password').value;
            const confirm = document.getElementById('reset-confirm').value;
            let hasErr = false;
            // Validate code
            const codeGroup = document.getElementById('reset-code').closest('.auth-field');
            const codeErr = codeGroup.querySelector('.field-error');
            if (code !== this.recoveryCode) {
                codeGroup.classList.add('has-error'); codeErr.textContent = 'Código incorrecto'; hasErr = true;
            } else { codeGroup.classList.remove('has-error'); codeGroup.classList.add('has-success'); codeErr.textContent = ''; }
            // Validate password
            const pwGroup = document.getElementById('reset-password').closest('.auth-field');
            const pwErr = pwGroup.querySelector('.field-error');
            if (!auth.validators.password(password)) {
                pwGroup.classList.add('has-error'); pwErr.textContent = 'Min 8 chars, mayúscula, minúscula, número y especial'; hasErr = true;
            } else { pwGroup.classList.remove('has-error'); pwGroup.classList.add('has-success'); pwErr.textContent = ''; }
            // Validate confirm
            const cfGroup = document.getElementById('reset-confirm').closest('.auth-field');
            const cfErr = cfGroup.querySelector('.field-error');
            if (password !== confirm) {
                cfGroup.classList.add('has-error'); cfErr.textContent = 'Las contraseñas no coinciden'; hasErr = true;
            } else { cfGroup.classList.remove('has-error'); cfGroup.classList.add('has-success'); cfErr.textContent = ''; }
            if (hasErr) { form.classList.add('shake'); setTimeout(() => form.classList.remove('shake'), 500); return; }
            const btn = form.querySelector('.btn-auth-submit'); btn.classList.add('loading'); btn.disabled = true;
            // Update password
            const result = await auth.resetPassword(this.recoveryEmail, password);
            btn.classList.remove('loading'); btn.disabled = false;
            if (result.success) {
                let sb = form.querySelector('.form-success-banner');
                if (!sb) { sb = document.createElement('div'); sb.className = 'form-success-banner'; form.prepend(sb); }
                sb.innerHTML = '<i class="ri-checkbox-circle-fill"></i> ┬íContraseña actualizada!'; sb.classList.add('visible');
                this.recoveryCode = null; this.recoveryEmail = null;
                setTimeout(() => { sb.classList.remove('visible'); this.navigate('screen-login'); }, 2000);
            } else {
                let eb = form.querySelector('.form-error-banner');
                if (!eb) { eb = document.createElement('div'); eb.className = 'form-error-banner'; form.prepend(eb); }
                eb.innerHTML = '<i class="ri-error-warning-fill"></i> ' + result.error; eb.classList.add('visible');
                setTimeout(() => eb.classList.remove('visible'), 3000);
            }
        });
    },

    setupResetStrengthMeter() {
        const pw = document.getElementById('reset-password'); if (!pw) return;
        pw.addEventListener('input', () => {
            const s = auth.getPasswordStrength(pw.value);
            const meter = document.getElementById('reset-strength-meter');
            const label = document.getElementById('reset-strength-label');
            if (!meter || !label) return;
            const bars = meter.querySelectorAll('.strength-bar');
            bars.forEach((b, i) => { b.className = 'strength-bar'; if (i < s.level) b.classList.add('active', s.level === 1 ? 'weak' : s.level === 2 ? 'medium' : 'strong'); });
            label.textContent = s.label; label.className = 'password-strength-label ' + (s.level === 1 ? 'weak' : s.level === 2 ? 'medium' : 'strong');
        });
    },

    isDesktop() { return window.innerWidth >= 1024; },

    navigate(screenId) {
        if (!this.screens.includes(screenId)) return;
        if (auth.isProtected(screenId) && !auth.isAuthenticated()) {
            alert('Debes registrarte o iniciar sesión para acceder a esta sección.');
            screenId = 'screen-register';
        }
        const ac = document.getElementById('app-container');
        const single = ['screen-splash','screen-live','screen-rezo','screen-register','screen-login','screen-forgot-password','screen-reset-password','screen-map','screen-intenciones','screen-create-rosary','screen-rosary-detail','screen-como-rezar','screen-profile','screen-porque-rezar','screen-notificaciones','screen-mensajes','screen-apariciones','screen-cenaculo','screen-Comedores','screen-situacion-calle','screen-anuncios','screen-voluntarios'];
        const isDash = !single.includes(screenId);
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        if (this.isDesktop() && isDash) {
            ac.classList.add('dashboard-mode');
            ['screen-map','screen-profile'].forEach(s => document.getElementById(s).classList.add('active'));
        } else {
            ac.classList.remove('dashboard-mode');
            document.getElementById(screenId).classList.add('active');
        }
        this.currentScreen = screenId;
        this.updateHeaderNav(screenId); this.updateNavVisibility(screenId);

        if (screenId === 'screen-create-rosary') setTimeout(() => this.initPickerMap(), 400);
        if (screenId === 'screen-map') setTimeout(() => this.initBuscarMap(), 400);
        if (screenId === 'screen-profile') { setTimeout(function() { if(app.renderVolunteerProfile) app.renderVolunteerProfile(); if(app.loadVolMini) app.loadVolMini(); }, 300); }
        if (screenId === 'screen-voluntarios') { setTimeout(function() { if(app.loadVoluntarios) app.loadVoluntarios(true); }, 200); }
        if (screenId === 'screen-anuncios') {
            this.loadAnuncios();
            setTimeout(function() {
                if(app.loadVolMini) app.loadVolMini();
                if(app.renderAnunciosVolProfile) app.renderAnunciosVolProfile();
            }, 400);
        }
        if (screenId === 'screen-Comedores') { setTimeout(() => { if (typeof initComedoresGlobalMap === 'function') initComedoresGlobalMap(); if (typeof comedoresGlobalMap !== 'undefined' && comedoresGlobalMap) { comedoresGlobalMap.invalidateSize(); setTimeout(() => { comedoresGlobalMap.invalidateSize(); window.dispatchEvent(new Event('resize')); }, 500); setTimeout(() => { comedoresGlobalMap.invalidateSize(); window.dispatchEvent(new Event('resize')); }, 1000); } }, 400); }
        if (screenId === 'screen-rosary-detail' && this.detailMap) setTimeout(() => this.detailMap.invalidateSize(), 350);
        if (screenId === 'screen-rezo') {
            if (!this._counterStarted) { this._counterStarted = true; this.startOnlineCounter(); }
            // Auto-select rosary if none selected (async to check Supabase too)
            var self = this;
            if (!this._currentRosary) {
                this.getAutoRosary().then(function(auto) {
                    self._currentRosary = auto;
                    if (typeof updateRezoPage === 'function') {
                        updateRezoPage(self._currentRosary || null);
                    }
                });
            } else {
                if (typeof updateRezoPage === 'function') {
                    updateRezoPage(this._currentRosary || null);
                }
            }
        }
        if (screenId === 'screen-live') this.renderContinuo();
        if (screenId === 'screen-como-rezar') this.highlightTodayMystery();
        if (screenId === 'screen-situacion-calle') setTimeout(function() { if(typeof scInitMap === 'function') scInitMap(); }, 350);
        if (screenId === 'screen-cenaculo') setTimeout(function() { if (typeof initCenaculoMap === 'function') initCenaculoMap(); }, 400);
        if (screenId === 'screen-intenciones') { if (typeof loadCommunityIntenciones === 'function') loadCommunityIntenciones(); }
        if (screenId === 'screen-profile' || isDash) this.updateUserUI();
    },

    updateHeaderNav(s) {
        // Desktop header (now with dropdown: Inicio, Buscar, Crear, Continuo, [Rezar dropdown trigger + 4 sub], Apariciones, Mensajes, Perfil)
        document.querySelectorAll('.header-nav > a, .header-dropdown-trigger, .header-dropdown-menu a').forEach(a => a.classList.remove('active'));
        const h = document.querySelectorAll('.header-nav > a');
        const dd = document.querySelectorAll('.header-dropdown-menu a');
        const dt = document.querySelector('.header-dropdown-trigger');
        if (s === 'screen-splash') h[0]?.classList.add('active');
        else if (s === 'screen-map') h[1]?.classList.add('active');
        else if (s === 'screen-create-rosary') h[2]?.classList.add('active');
        else if (s === 'screen-live') h[3]?.classList.add('active');
        else if (s === 'screen-rezo') { h[4]?.classList.add('active'); }
        else if (s === 'screen-intenciones') { dd[0]?.classList.add('active'); if(dt) dt.classList.add('active'); }
        else if (s === 'screen-como-rezar') { dd[1]?.classList.add('active'); if(dt) dt.classList.add('active'); }
        else if (s === 'screen-porque-rezar') { dd[2]?.classList.add('active'); if(dt) dt.classList.add('active'); }
        else if (s === 'screen-apariciones') { dd[3]?.classList.add('active'); if(dt) dt.classList.add('active'); }
        else if (s === 'screen-Comedores') h[5]?.classList.add('active');
        else if (s === 'screen-cenaculo') h[6]?.classList.add('active');
        else if (s === 'screen-notificaciones') h[7]?.classList.add('active');
        else if (s === 'screen-profile') h[8]?.classList.add('active');
        // Mobile header
        document.querySelectorAll('.mobile-header-nav a').forEach(a => a.classList.remove('active'));
        const m = document.querySelectorAll('.mobile-header-nav a');
        if (s === 'screen-splash') m[0]?.classList.add('active');
        else if (s === 'screen-map') m[1]?.classList.add('active');
        else if (s === 'screen-create-rosary') m[2]?.classList.add('active');
        else if (s === 'screen-rezo') m[3]?.classList.add('active');
        else if (s === 'screen-como-rezar') m[4]?.classList.add('active');
        else if (s === 'screen-porque-rezar') m[5]?.classList.add('active');
        else if (s === 'screen-apariciones') m[6]?.classList.add('active');
        else if (s === 'screen-Comedores') m[7]?.classList.add('active');
        else if (s === 'screen-cenaculo') m[8]?.classList.add('active');
        else if (s === 'screen-notificaciones') m[9]?.classList.add('active');
        else if (s === 'screen-profile') m[10]?.classList.add('active');
    },

    toggleMobileMenu() {
        const nav = document.getElementById('mobile-nav-links');
        const btn = document.querySelector('#hamburger-btn i');
        nav.classList.toggle('open');
        btn.className = nav.classList.contains('open') ? 'ri-close-line' : 'ri-menu-line';
    },

    mobileNav(screenId) {
        this.navigate(screenId);
        const nav = document.getElementById('mobile-nav-links');
        const btn = document.querySelector('#hamburger-btn i');
        nav.classList.remove('open');
        btn.className = 'ri-menu-line';
    },

    updateNavVisibility(s) {
        const nav = document.getElementById('main-nav');
        const hideScreens = ['screen-register','screen-login','screen-forgot-password','screen-reset-password'];
        if (hideScreens.includes(s)) {
            nav.style.transform='translateY(100%)'; nav.style.opacity='0'; nav.style.pointerEvents='none';
        } else {
            nav.style.transform='translateY(0)'; nav.style.opacity='1'; nav.style.pointerEvents='all';
            // Map screens to nav items
            const navMap = {
                'screen-splash': 0,
                'screen-map': 1,
                'screen-create-rosary': 2,
                'screen-rezo': 3,
                'screen-live': 4,
                'screen-Comedores': 5,
                'screen-cenaculo': 6,
                'screen-notificaciones': 7,
                'screen-profile': 8,
                'screen-rosary-detail': 1,
                'screen-como-rezar': 3,
                'screen-porque-rezar': 3,
                'screen-apariciones': 3,
                'screen-intenciones': 3,
                'screen-event': 1
            };
            const items = document.querySelectorAll('#main-nav .nav-item');
            items.forEach(el => el.classList.remove('active'));
            const idx = navMap[s];
            if (idx !== undefined && items[idx]) items[idx].classList.add('active');
        }
    },

    onAuthSuccess: function() { 
        this.updateUserUI(); 
        this.loadUserAvatar();
        setTimeout(function() { app.renderCausaCard(); }, 300);
        this.navigate('screen-profile'); 
        this.requestGeolocation(); 
    },
    handleLogout: function() { 
        auth.logoutUser(); 
        this.setUserAvatar(null); 
        this.navigate('screen-splash'); 
    },


    // ══ OPCIÓN C: MIS COMPROMISOS ══
    COMPROMISO_CATEGORIAS: [
        { id:'comida',     icon:'🍲', label:'Llevar comida',     color:'#f97316' },
        { id:'ropa',       icon:'🧥', label:'Donar ropa/abrigo', color:'#8b5cf6' },
        { id:'transporte', icon:'🚗', label:'Dar transporte',    color:'#0ea5e9' },
        { id:'compania',   icon:'🤝', label:'Acompañar',         color:'#10b981' },
        { id:'dinero',     icon:'💵', label:'Donar dinero',      color:'#f59e0b' },
        { id:'tiempo',     icon:'⏰',       label:'Dar mi tiempo',     color:'#e74c3c' },
        { id:'habilidad',  icon:'🛠', label:'Ofrecer habilidad', color:'#6366f1' },
        { id:'otro',       icon:'💡', label:'Otro',              color:'#64748b' }
    ],

    getCompromisosKey: function() { var u=auth.getCurrentUser(); return u?'redmaria_compromisos_'+u.id:null; },
    getCompromisos: function() {
        var k=this.getCompromisosKey(); if(!k)return[];
        try{ var a=JSON.parse(localStorage.getItem(k)||'[]'); return a; }catch(e){return[];}
    },
    renderCompromisos: function() {
        var self = this;
        var lista = document.getElementById('compromisos-lista');
        var emp   = document.getElementById('compromisos-empty-msg');
        if (!lista) return;
        var u = auth.getCurrentUser();
        if (!u) return;

        // Leer siempre de localStorage
        var comps = this.getCompromisos();
        var hoy = new Date(); hoy.setHours(0,0,0,0);
        comps = comps.filter(function(c){ return !c.hasta || new Date(c.hasta) >= hoy; });

        Array.from(lista.children).forEach(function(c){ if(c.id !== 'compromisos-empty-msg') lista.removeChild(c); });
        if (comps.length === 0) { if(emp) emp.style.display = 'block'; return; }
        if (emp) emp.style.display = 'none';

        comps.forEach(function(comp) {
            var cat = self.COMPROMISO_CATEGORIAS && self.COMPROMISO_CATEGORIAS.find(function(c){ return c.id === comp.catId; });
            if (!cat) cat = { icon: '💡', label: comp.catId || 'Compromiso', color: '#64748b' };
            var ds = '';
            if (comp.hasta) { var df = Math.ceil((new Date(comp.hasta) - new Date()) / 86400000); ds = df <= 1 ? 'Vence hoy' : 'Vence en ' + df + ' dias'; }
            var card = document.createElement('div');
            card.style.cssText = 'display:flex;align-items:flex-start;gap:12px;border-left:4px solid ' + cat.color + ';border-radius:12px;padding:12px;background:rgba(16,185,129,0.04);border:1px solid rgba(16,185,129,0.15);margin-bottom:2px;';
            card.innerHTML = '<span style="font-size:1.5rem;flex-shrink:0;">' + cat.icon + '</span>'
                + '<div style="flex:1"><div style="font-size:0.78rem;font-weight:800;color:' + cat.color + ';">' + cat.label + '</div>'
                + '<div style="font-size:0.87rem;color:#334155;">' + (comp.desc || '') + '</div>'
                + (ds ? '<div style="font-size:0.74rem;color:#94a3b8;">⏱ ' + ds + '</div>' : '') + '</div>'
                + '<button onclick="app.eliminarCompromiso(\'' + comp.id + '\')" style="background:none;border:none;color:#cbd5e1;cursor:pointer;font-size:1.1rem;">✕</button>';
            lista.appendChild(card);
        });
    },
    eliminarCompromiso: async function(id) {
        var k = this.getCompromisosKey();
        var deletedComp = null;
        if (k) {
            var a = JSON.parse(localStorage.getItem(k) || '[]');
            deletedComp = a.find(function(c) { return c.id === id; });
            localStorage.setItem(k, JSON.stringify(a.filter(function(c) { return c.id !== id; })));
        }
        
        if (typeof db !== 'undefined' && db.deleteCompromiso) {
            try {
                if (id && id.length > 15) {
                    await db.deleteCompromiso(id);
                } else if (deletedComp) {
                    var u = auth.getCurrentUser();
                    if (u) {
                        await db.deleteCompromisoByCriteria(u.id, deletedComp.catId, deletedComp.desc);
                    }
                }
            } catch(e) {
                console.warn('[DB] Error deleting from Supabase:', e.message);
            }
        }
        
        this.renderCompromisos();
        if (this.renderAnunciosVolProfile) this.renderAnunciosVolProfile();
    },
    _compCatSel: null,
    abrirNuevoCompromiso: function() {
        if (!auth.isAuthenticated()) {
            alert('Debes iniciar sesión para agregar un compromiso.');
            this.navigate('screen-login');
            return;
        }
        var self=this,old=document.getElementById('compromiso-overlay');
        if(old&&old.parentNode)old.parentNode.removeChild(old);
        this._compCatSel=null;
        var overlay=document.createElement('div');
        overlay.id='compromiso-overlay';
        overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
        overlay.onclick=function(e){if(e.target===overlay){overlay.parentNode&&overlay.parentNode.removeChild(overlay);}};
        var sheet=document.createElement('div');
        sheet.style.cssText='background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:540px;padding:24px 20px 48px;max-height:90vh;overflow-y:auto;';
        sheet.onclick=function(e){e.stopPropagation();};
        var hdr=document.createElement('div');
        hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
        hdr.innerHTML='<h3 style="margin:0;font-size:1rem;font-weight:900;color:#10b981;">Nuevo Compromiso</h3>'
            +'<button onclick="var o=document.getElementById(\'compromiso-overlay\');if(o&&o.parentNode)o.parentNode.removeChild(o)" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#94a3b8;">&#x2715;</button>';
        sheet.appendChild(hdr);
        var grid=document.createElement('div');
        grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;';
        this.COMPROMISO_CATEGORIAS.forEach(function(cat){
            var btn=document.createElement('button');
            btn.id='comp-cat-'+cat.id;
            btn.style.cssText='border:2px solid #e2e8f0;background:white;border-radius:10px;padding:10px 8px;cursor:pointer;display:flex;align-items:center;gap:8px;font-family:inherit;';
            btn.innerHTML='<span style="font-size:1.3rem;">'+cat.icon+'</span><span style="font-size:0.78rem;font-weight:700;color:#475569;">'+cat.label+'</span>';
            btn.onclick=function(){
                self._compCatSel=cat.id;
                self.COMPROMISO_CATEGORIAS.forEach(function(c){
                    var b=document.getElementById('comp-cat-'+c.id); if(!b)return;
                    b.style.borderColor=c.id===cat.id?cat.color:'#e2e8f0';
                    b.style.background=c.id===cat.id?cat.color+'18':'white';
                });
            };
            grid.appendChild(btn);
        });
        sheet.appendChild(grid);
        var di=document.createElement('input');
        di.id='comp-desc'; di.placeholder='Descripcion breve';
        di.style.cssText='width:100%;border:1.5px solid #e2e8f0;border-radius:10px;padding:10px 12px;font-size:0.9rem;font-family:inherit;box-sizing:border-box;margin-bottom:12px;';
        sheet.appendChild(di);
        var dr=document.createElement('div');
        dr.style.cssText='display:flex;gap:10px;align-items:center;margin-bottom:16px;';
        dr.innerHTML='<label style="font-size:0.82rem;color:#64748b;font-weight:600;flex-shrink:0;">Vence el:</label>'
            +'<input id="comp-hasta" type="date" style="flex:1;border:1.5px solid #e2e8f0;border-radius:10px;padding:8px 10px;font-family:inherit;font-size:0.88rem;" />';
        sheet.appendChild(dr);
        var d=new Date(); d.setDate(d.getDate()+7);
        var dInp=sheet.querySelector('#comp-hasta'); if(dInp)dInp.value=d.toISOString().split('T')[0];
        var sb=document.createElement('button');
        sb.style.cssText='width:100%;background:#10b981;color:white;border:none;border-radius:12px;padding:13px;font-size:0.95rem;font-weight:800;cursor:pointer;font-family:inherit;';
        sb.textContent='Confirmar Compromiso';
        sb.onclick=function(){self._guardarCompromiso();};
        sheet.appendChild(sb);
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
    },
    _guardarCompromiso: function() {
        if(!this._compCatSel){alert('Elegi una categoria');return;}
        var desc=(document.getElementById('comp-desc')||{}).value||'';
        var hasta=(document.getElementById('comp-hasta')||{}).value||'';
        var u = auth.getCurrentUser();
        if(!u) return;

        // Guardar en localStorage siempre
        var k = this.getCompromisosKey();
        if(k){
            var all = JSON.parse(localStorage.getItem(k)||'[]');
            all.push({id:Date.now().toString(), catId:this._compCatSel, desc:desc, hasta:hasta, creado:new Date().toISOString()});
            localStorage.setItem(k, JSON.stringify(all));
        }

        // Intentar sync a Supabase de forma silenciosa (no bloquea)
        if (typeof db !== 'undefined' && db.saveCompromiso && u) {
            db.saveCompromiso(u.id, { catId: this._compCatSel, desc: desc, hasta: hasta }).catch(function(){});
        }

        this._compCatSel = null;
        var ov = document.getElementById('compromiso-overlay');
        if(ov && ov.parentNode) ov.parentNode.removeChild(ov);
        try { if (this.renderAnunciosVolProfile) this.renderAnunciosVolProfile(); } catch(e){}
        try { this.renderCompromisos(); } catch(e){}
    },

    // ══ OPCIÓN D: HABILIDADES SOLIDARIAS ══
    HABILIDADES_LISTA: [
        {id:'auto',      icon:'🚗', label:'Tengo auto',        color:'#0ea5e9'},
        {id:'cocina',    icon:'🍳', label:'Se cocinar',         color:'#f97316'},
        {id:'medico',    icon:'🩺', label:'Médico/Enf.',       color:'#e74c3c'},
        {id:'juridico',  icon:'⚖',       label:'Orientacion legal',  color:'#8b5cf6'},
        {id:'tech',      icon:'💻', label:'Tecnologia',         color:'#6366f1'},
        {id:'educacion', icon:'📚', label:'Dar clases',         color:'#14b8a6'},
        {id:'fuerza',    icon:'💪', label:'Trabajo físico',    color:'#84cc16'},
        {id:'almacen',   icon:'📦', label:'Tengo espacio',      color:'#64748b'},
        {id:'redes',     icon:'📢', label:'Redes sociales',     color:'#f43f5e'},
        {id:'fotografia',icon:'📷', label:'Foto/Video',         color:'#f59e0b'},
        {id:'musica',    icon:'🎸', label:'Musica/Arte',        color:'#a855f7'},
        {id:'idioma',    icon:'🌐', label:'Idiomas',            color:'#10b981'},
        {id:'peluqueria',icon:'✂',       label:'Peluqueria',         color:'#fb7185'},
        {id:'otro',      icon:'🌟', label:'Otra',               color:'#94a3b8'}
    ],

    getHabilidadesKey: function(){var u=auth.getCurrentUser();return u?'redmaria_habilidades_'+u.id:null;},
    getHabilidades: function(){var k=this.getHabilidadesKey();if(!k)return[];try{return JSON.parse(localStorage.getItem(k)||'[]');}catch(e){return[];}},
    renderHabilidades: function() {
        var self = this;
        var display = document.getElementById('habilidades-display');
        if (!display) return;
        var u = auth.getCurrentUser();
        if (!u) return;

        // Leer siempre de localStorage
        var habs = this.getHabilidades();

        display.innerHTML = '';
        if (habs.length === 0) {
            display.innerHTML = '<p style="color:#94a3b8;font-size:0.85rem;margin:4px 0;">¿Qué pods ofrecer? Agrega tus habilidades</p>';
            return;
        }
        habs.forEach(function(id) {
            var hab = self.HABILIDADES_LISTA && self.HABILIDADES_LISTA.find(function(h){ return h.id === id; });
            if (!hab) return;
            var tag = document.createElement('span');
            tag.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:' + hab.color + '18;border:1.5px solid ' + hab.color + ';color:' + hab.color + ';border-radius:20px;padding:5px 12px;font-size:0.78rem;font-weight:700;';
            tag.textContent = hab.icon + ' ' + hab.label;
            display.appendChild(tag);
        });
    },
    abrirHabilidades: async function() {
        if (!auth.isAuthenticated()) {
            alert('Debes iniciar sesión para editar tus habilidades.');
            this.navigate('screen-login');
            return;
        }
        var u = auth.getCurrentUser();
        var self=this,old=document.getElementById('habilidades-overlay');
        if(old&&old.parentNode)old.parentNode.removeChild(old);

        var actuales = [];
        if (typeof db !== 'undefined' && db.getHabilidades) {
            actuales = await db.getHabilidades(u.id);
        } else {
            actuales = this.getHabilidades().slice();
        }
        var overlay=document.createElement('div');
        overlay.id='habilidades-overlay';
        overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
        overlay.onclick=function(e){if(e.target===overlay){overlay.parentNode&&overlay.parentNode.removeChild(overlay);}};
        var sheet=document.createElement('div');
        sheet.style.cssText='background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:540px;padding:24px 20px 48px;max-height:88vh;overflow-y:auto;';
        sheet.onclick=function(e){e.stopPropagation();};
        var hdr=document.createElement('div');
        hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        hdr.innerHTML='<h3 style="margin:0;font-size:1rem;font-weight:900;color:#6366f1;">Mis Habilidades</h3>'
            +'<button onclick="var o=document.getElementById(\'habilidades-overlay\');if(o&&o.parentNode)o.parentNode.removeChild(o)" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#94a3b8;">&#x2715;</button>';
        sheet.appendChild(hdr);
        var sub=document.createElement('p');
        sub.style.cssText='margin:0 0 14px;font-size:0.8rem;color:#94a3b8;';
        sub.textContent='Toca para agregar o quitar. Son visibles en tu perfil.';
        sheet.appendChild(sub);
        var grid=document.createElement('div');
        grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:20px;';
        this.HABILIDADES_LISTA.forEach(function(hab){
            var sel=actuales.indexOf(hab.id)!==-1;
            var btn=document.createElement('button');
            btn.style.cssText='border:2px solid '+(sel?hab.color:'#e2e8f0')+';background:'+(sel?hab.color+'18':'white')+';border-radius:12px;padding:11px 8px;cursor:pointer;display:flex;align-items:center;gap:7px;font-family:inherit;';
            var lbl=document.createElement('span');
            lbl.style.cssText='font-size:0.76rem;font-weight:700;color:'+(sel?hab.color:'#475569')+';';
            lbl.textContent=hab.label;
            btn.innerHTML='<span style="font-size:1.3rem;flex-shrink:0;">'+hab.icon+'</span>';
            btn.appendChild(lbl);
            btn.onclick=function(){
                var idx=actuales.indexOf(hab.id);
                if(idx!==-1)actuales.splice(idx,1); else actuales.push(hab.id);
                var s=actuales.indexOf(hab.id)!==-1;
                btn.style.borderColor=s?hab.color:'#e2e8f0';
                btn.style.background=s?hab.color+'18':'white';
                lbl.style.color=s?hab.color:'#475569';
            };
            grid.appendChild(btn);
        });
        sheet.appendChild(grid);
        var sb=document.createElement('button');
        sb.style.cssText='width:100%;background:#6366f1;color:white;border:none;border-radius:12px;padding:13px;font-size:0.95rem;font-weight:800;cursor:pointer;font-family:inherit;';
        sb.onclick = function(){
            // Guardar en localStorage siempre
            var k = self.getHabilidadesKey();
            if(k) localStorage.setItem(k, JSON.stringify(actuales));

            // Intentar sync a Supabase de forma silenciosa
            if (typeof db !== 'undefined' && db.saveHabilidades && u) {
                db.saveHabilidades(u.id, actuales).catch(function(){});
            }

            var ov = document.getElementById('habilidades-overlay');
            if(ov && ov.parentNode) ov.parentNode.removeChild(ov);
            try { if (self.renderAnunciosVolProfile) self.renderAnunciosVolProfile(); } catch(e){}
            try { self.renderHabilidades(); } catch(e){}
        };

        sheet.appendChild(sb);
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
    },
    renderVolunteerProfile: function() {
        this.renderCompromisos();
        this.renderHabilidades();
    },
    // ── MI CAUSA ACTUAL ──

    // ══════════════════════════════════════════
    //  BANCO DE VOLUNTARIOS  (v2 – simple)
    // ══════════════════════════════════════════
    _volFiltro: null,
    _volQuery:  '',

    // ── helpers de datos ─────────────────────
    _getVoluntariosLocal: function() {
        var self = this;
        var u = auth.getCurrentUser();
        var list = [];
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (!key || key.indexOf('redmaria_habilidades_') !== 0) continue;
            var userId = key.replace('redmaria_habilidades_', '');
            var habs = [];
            try { habs = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
            if (habs.length === 0) continue;
            // nombre
            var nombre = localStorage.getItem('redmaria_nombre_' + userId) || 'Voluntario';
            try {
                var s = JSON.parse(localStorage.getItem('redmaria_session') || '{}');
                if (s && s.id === userId) nombre = s.name || s.email || nombre;
            } catch(e) {}
            // avatar
            var avatar = localStorage.getItem('redmaria_avatar_' + userId) ||
                         (u && u.id === userId ? localStorage.getItem('redmaria_avatar') : null);
            // compromisos vigentes
            var comps = [];
            try {
                var hoy = new Date(); hoy.setHours(0,0,0,0);
                comps = JSON.parse(localStorage.getItem('redmaria_compromisos_' + userId) || '[]')
                    .filter(function(c){ return !c.hasta || new Date(c.hasta) >= hoy; });
            } catch(e) {}

            list.push({
                userId: userId,
                nombre: nombre,
                habs:   habs,
                comps:  comps,
                avatar: avatar,
                esYo:   !!(u && u.id === userId)
            });
        }
        return list;
    },

    _cachedVoluntarios: null,

    loadVoluntarios: async function(forceRefresh) {
        var self = this;
        var container = document.getElementById('vol-lista');
        var urgentesBox = document.getElementById('vol-urgentes');
        if (!container) return;

        // If we have cached list and are not forcing a refresh, filter and render synchronously
        if (this._cachedVoluntarios && this._cachedVoluntarios.length > 0 && !forceRefresh) {
            this._renderVoluntariosFiltrados(this._cachedVoluntarios, container, urgentesBox);
            return;
        }

        // Mostrar loader on initial load or force refresh
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;"><div style="font-size:2rem;margin-bottom:8px;">⏳</div><p style="font-size:0.85rem;margin:0;">Cargando voluntarios...</p></div>';

        var voluntarios = [];

        // ── Sincronizar datos locales del usuario actual a Supabase de fondo ──
        (async function() {
            try {
                var u = auth.getCurrentUser();
                if (u && typeof db !== 'undefined') {
                    var localHabs = self.getHabilidades ? self.getHabilidades() : [];
                    if (localHabs.length > 0 && db.saveHabilidades) {
                        await db.saveHabilidades(u.id, localHabs).catch(function(){});
                    }
                    var localComps = self.getCompromisos ? self.getCompromisos() : [];
                    var unsyncedComps = localComps.filter(function(c) {
                        return c && c.id && c.id.indexOf('-') === -1;
                    });
                    if (unsyncedComps.length > 0 && db.saveCompromiso) {
                        for (var c of unsyncedComps) {
                            await db.saveCompromiso(u.id, { catId: c.catId, desc: c.desc, hasta: c.hasta }).catch(function(){});
                        }
                    }
                }
            } catch(e) {
                console.warn('[Sync] Falló sync de fondo:', e.message);
            }
        })();

        try {
            if (typeof db !== 'undefined' && db.getAllVolunteers) {
                var sbVols = await db.getAllVolunteers();
                if (sbVols && sbVols.length > 0) {
                    var u = auth.getCurrentUser();
                    var resolvedId = null;
                    if (u) {
                        try {
                            resolvedId = localStorage.getItem('redmaria_sb_uuid_' + u.id);
                        } catch(e) {}
                    }
                    sbVols.forEach(function(v) {
                        var isMe = u && (v.id === u.id || v.id === resolvedId);
                        var searchId = isMe ? u.id : v.id;

                        // Habilidades con fallback
                        var habs = v.habs || [];
                        if (habs.length === 0) {
                            try {
                                var localHabs = JSON.parse(localStorage.getItem('redmaria_habilidades_' + searchId) || '[]');
                                if (localHabs && localHabs.length > 0) habs = localHabs;
                            } catch(e) {}
                        }

                        // Compromisos con fallback
                        var comps = v.comps || [];
                        if (comps.length === 0) {
                            try {
                                var localComps = JSON.parse(localStorage.getItem('redmaria_compromisos_' + searchId) || '[]');
                                if (localComps && localComps.length > 0) comps = localComps;
                            } catch(e) {}
                        }

                        // Avatar con fallback local
                        var avatar = v.avatar || null;
                        if (!avatar) {
                            try {
                                avatar = localStorage.getItem('redmaria_avatar_' + searchId) ||
                                         (isMe ? localStorage.getItem('redmaria_avatar') : null);
                            } catch(e) {}
                        }

                        voluntarios.push({
                            id:      v.id,
                            nombre:  v.nombre || 'Voluntario',
                            habs:    habs,
                            comps:   comps,
                            avatar:  avatar,
                            esYo:    isMe
                        });
                    });
                    console.log('[Voluntarios] Cargados desde Supabase:', voluntarios.length);
                }
            }
        } catch(e) {
            console.warn('[Voluntarios] Supabase falló, usando localStorage:', e.message);
        }

        // ── Fallback a localStorage si Supabase no devolvió nada ──
        if (voluntarios.length === 0) {
            voluntarios = this._getVoluntariosLocal();
            console.log('[Voluntarios] Usando localStorage:', voluntarios.length);
        }

        // Save to cache
        this._cachedVoluntarios = voluntarios;

        // Render them
        this._renderVoluntariosFiltrados(voluntarios, container, urgentesBox);
    },

    _renderVoluntariosFiltrados: function(rawVoluntarios, container, urgentesBox) {
        var self = this;
        var voluntarios = [].concat(rawVoluntarios);

        // Sync filter chips UI and search input value
        document.querySelectorAll('.vol-filtro-btn').forEach(function(btn) {
            var isActive = btn.dataset.hid === (self._volFiltro || '');
            btn.style.background = isActive ? btn.dataset.color : 'white';
            btn.style.color = isActive ? 'white' : btn.dataset.color;
        });
        var searchInput = document.getElementById('vol-search');
        if (searchInput && document.activeElement !== searchInput) {
            searchInput.value = this._volQuery || '';
        }

        // ── Búsqueda ──
        var q = (this._volQuery || '').toLowerCase().trim();
        if (q) {
            voluntarios = voluntarios.filter(function(v) {
                return v.nombre.toLowerCase().indexOf(q) !== -1 ||
                       v.habs.some(function(hId) {
                           var h = self.HABILIDADES_LISTA && self.HABILIDADES_LISTA.find(function(x){ return x.id === hId; });
                           return h && h.label.toLowerCase().indexOf(q) !== -1;
                       });
            });
        }

        // ── Filtro por habilidad ──
        var filtrados = this._volFiltro
            ? voluntarios.filter(function(v){ return v.habs.indexOf(self._volFiltro) !== -1; })
            : voluntarios;

        // ── Contador ──
        var countEl = document.getElementById('vol-count');
        if (countEl) countEl.textContent = filtrados.length + ' voluntario' + (filtrados.length !== 1 ? 's' : '');

        // ── Lista principal ──
        container.innerHTML = '';
        if (filtrados.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px 16px;color:#94a3b8;">'
                + '<div style="font-size:3rem;margin-bottom:12px;">🔍</div>'
                + '<p style="font-weight:700;margin:0 0 4px;color:#64748b;">Nadie por aqui aún</p>'
                + '<p style="font-size:0.85rem;margin:0;">Agrega tus habilidades en tu perfil y public&#225; tu tarjeta</p>'
                + '</div>';
        } else {
            filtrados.forEach(function(vol) {
                var card = document.createElement('div');
                card.style.cssText = 'display:flex;gap:14px;align-items:flex-start;padding:14px;border-radius:16px;background:white;box-shadow:0 2px 10px rgba(0,0,0,0.07);margin-bottom:12px;';

                var avatarUrl = vol.avatar;
                if (!avatarUrl) {
                    var strForHash = vol.id || vol.nombre || "";
                    var hashVal = 0;
                    for (var hIdx = 0; hIdx < strForHash.length; hIdx++) {
                        hashVal = strForHash.charCodeAt(hIdx) + ((hashVal << 5) - hashVal);
                    }
                    var premiumVols = [
                        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200",
                        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200",
                        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200",
                        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200",
                        "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200",
                        "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=200",
                        "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200",
                        "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200"
                    ];
                    avatarUrl = premiumVols[Math.abs(hashVal) % premiumVols.length];
                }
                var avatarHtml = '<img src="' + avatarUrl + '" style="width:50px;height:50px;border-radius:50%;object-fit:cover;flex-shrink:0;box-shadow: 0 2px 8px rgba(0,0,0,0.15); border: 2px solid #fff;">';

                var habsHtml = '';
                vol.habs.slice(0, 3).forEach(function(hId) {
                    var h = self.HABILIDADES_LISTA && self.HABILIDADES_LISTA.find(function(x){ return x.id === hId; });
                    if (h) habsHtml += '<span style="display:inline-flex;align-items:center;gap:3px;background:' + h.color + '15;border:1px solid ' + h.color + ';color:' + h.color + ';border-radius:12px;padding:3px 8px;font-size:0.72rem;font-weight:700;">' + h.icon + ' ' + h.label + '</span>';
                });
                if (vol.habs.length > 3) habsHtml += '<span style="font-size:0.72rem;color:#94a3b8;padding:3px 6px;">+' + (vol.habs.length - 3) + ' m&#225;s</span>';

                var compHtml = '';
                if (vol.comps && vol.comps.length > 0) {
                    vol.comps.forEach(function(c) {
                        var cat = self.COMPROMISO_CATEGORIAS && self.COMPROMISO_CATEGORIAS.find(function(x){ return x.id === c.catId; });
                        if (cat) {
                            compHtml += '<div style="margin-top:6px;font-size:0.78rem;color:' + cat.color + ';font-weight:700;display:flex;align-items:center;gap:4px;">' + cat.icon + ' ' + cat.label + (c.desc ? ' &mdash; ' + c.desc : '') + '</div>';
                        }
                    });
                }

                var sub = vol.habs.length > 0 
                    ? vol.habs.length + ' habilidad' + (vol.habs.length !== 1 ? 'es' : '')
                    : 'Sin habilidades registradas';
                if (vol.comps.length > 0) {
                    sub += ' &middot; ' + vol.comps.length + ' compromiso' + (vol.comps.length !== 1 ? 's' : '');
                } else if (vol.habs.length === 0) {
                    sub += ' &middot; Sin compromisos';
                }

                var contactBtn = !vol.esYo
                    ? '<button onclick="if(typeof openMensajesPanel===\'function\') openMensajesPanel()" style="background:#6366f1;color:white;border:none;border-radius:20px;padding:5px 14px;font-size:0.75rem;font-weight:800;cursor:pointer;flex-shrink:0;">Contactar</button>'
                    : '<span style="font-size:0.7rem;color:#6366f1;font-weight:700;background:#ede9fe;border-radius:12px;padding:4px 10px;">Vos</span>';

                card.innerHTML = avatarHtml +
                    '<div style="flex:1;min-width:0;">'
                    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">'
                    +   '<div><div style="font-weight:800;color:#1e293b;font-size:0.95rem;">' + vol.nombre + '</div>'
                    +   '<div style="font-size:0.78rem;color:#94a3b8;margin-top:2px;">' + sub + '</div></div>'
                    +   contactBtn
                    + '</div>'
                    + '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;">' + habsHtml + '</div>'
                    + compHtml
                    + '</div>';
                container.appendChild(card);
            });
        }

        // ── Urgentes (compromisos que vencen en 48h) ──
        if (urgentesBox) {
            var urgList = [];
            rawVoluntarios.forEach(function(vol) {
                vol.comps.forEach(function(c) {
                    if (!c.hasta) return;
                    var diff = (new Date(c.hasta) - new Date()) / 3600000;
                    if (diff <= 48) urgList.push({ vol: vol, comp: c, diff: diff });
                });
            });
            urgList.sort(function(a, b){ return a.diff - b.diff; });
            if (urgList.length > 0) {
                urgentesBox.style.display = 'block';
                var ul = document.getElementById('vol-urgentes-lista');
                if (ul) {
                    ul.innerHTML = '';
                    urgList.slice(0, 5).forEach(function(item) {
                        var cat = self.COMPROMISO_CATEGORIAS && self.COMPROMISO_CATEGORIAS.find(function(x){ return x.id === item.comp.catId; });
                        var li = document.createElement('div');
                        li.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(239,68,68,0.05);border-left:3px solid #ef4444;border-radius:10px;margin-bottom:8px;';
                        li.innerHTML = '<span style="font-size:1.4rem;">' + (cat ? cat.icon : '💡') + '</span>'
                            + '<div style="flex:1"><div style="font-size:0.82rem;font-weight:700;color:#1e293b;">' + item.vol.nombre + '</div>'
                            + '<div style="font-size:0.78rem;color:#64748b;">' + (cat ? cat.label : '') + (item.comp.desc ? ' &mdash; ' + item.comp.desc : '') + '</div></div>'
                            + '<span style="font-size:0.72rem;font-weight:800;color:#ef4444;white-space:nowrap;">' + (item.diff <= 1 ? 'Hoy!' : Math.ceil(item.diff / 24) + 'd') + '</span>';
                        ul.appendChild(li);
                    });
                }
            } else {
                urgentesBox.style.display = 'none';
            }
        }
    },


    volFiltrar: function(habilidadId) {
        this._volFiltro = (this._volFiltro === habilidadId) ? null : habilidadId;
        document.querySelectorAll('.vol-filtro-btn').forEach(function(btn) {
            var isActive = btn.dataset.hid === (app._volFiltro || '');
            btn.style.background = isActive ? btn.dataset.color : 'white';
            btn.style.color = isActive ? 'white' : btn.dataset.color;
        });
        this.loadVoluntarios();
        this.loadVolMini();
    },

    volBuscar: function(query) {
        this._volQuery = query;
        this.loadVoluntarios();
    },

    loadVolMini: async function() {
        var miniLista = document.getElementById('vol-mini-lista');
        if (!miniLista) return;
        var self = this;
        var voluntarios = [];

        // ── Intentar Supabase primero ──
        try {
            if (typeof db !== 'undefined' && db.getAllVolunteers) {
                var sbVols = await db.getAllVolunteers();
                if (sbVols && sbVols.length > 0) {
                    var u = auth.getCurrentUser();
                    var resolvedId = null;
                    if (u) {
                        try {
                            resolvedId = localStorage.getItem('redmaria_sb_uuid_' + u.id);
                        } catch(e) {}
                    }
                    sbVols.forEach(function(v) {
                        var isMe = u && (v.id === u.id || v.id === resolvedId);
                        var searchId = isMe ? u.id : v.id;

                        // Avatar con fallback local
                        var avatar = v.avatar || null;
                        if (!avatar) {
                            try {
                                avatar = localStorage.getItem('redmaria_avatar_' + searchId) ||
                                         (isMe ? localStorage.getItem('redmaria_avatar') : null);
                            } catch(e) {}
                        }

                        voluntarios.push({
                            id:      v.id,
                            nombre:  v.nombre || 'Voluntario',
                            habs:    v.habs || [],
                            comps:   v.comps || [],
                            avatar:  avatar,
                            esYo:    isMe
                        });
                    });
                }
            }
        } catch(e) {
            console.warn('[VolMini] Supabase falló:', e.message);
        }

        // ── Fallback a localStorage ──
        if (voluntarios.length === 0) {
            voluntarios = this._getVoluntariosLocal();
        }

        miniLista.innerHTML = '';
        if (voluntarios.length === 0) {
            miniLista.innerHTML = '<div style="text-align:center;min-width:80px;padding:10px 8px;background:white;border-radius:14px;border:1px solid #e2e8f0;"><div style="font-size:1.6rem;margin-bottom:4px;">👤</div><div style="font-size:0.7rem;color:#94a3b8;font-weight:600;">Se el primero</div></div>';
            return;
        }

        // Mostrar siempre los últimos 10
        voluntarios.slice(0, 10).forEach(function(v) {
            var card = document.createElement('div');
            card.style.cssText = 'text-align:center;min-width:72px;padding:10px 8px;background:white;border-radius:14px;border:1px solid #e2e8f0;cursor:pointer;flex-shrink:0;';
            card.onclick = function(){ app.navigate('screen-voluntarios'); };
            var avatarUrlMini = v.avatar;
            if (!avatarUrlMini) {
                var strForHashMini = v.id || v.nombre || "";
                var hashValMini = 0;
                for (var hIdxMini = 0; hIdxMini < strForHashMini.length; hIdxMini++) {
                    hashValMini = strForHashMini.charCodeAt(hIdxMini) + ((hashValMini << 5) - hashValMini);
                }
                var premiumVolsMini = [
                    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200",
                    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200",
                    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200",
                    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200",
                    "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200",
                    "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=200",
                    "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200",
                    "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200"
                ];
                avatarUrlMini = premiumVolsMini[Math.abs(hashValMini) % premiumVolsMini.length];
            }
            var avatarHtml = '<img src="' + avatarUrlMini + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;margin-bottom:5px;box-shadow: 0 2px 6px rgba(0,0,0,0.12); border: 1.5px solid #fff;">';
            var topHab = (self.HABILIDADES_LISTA && v.habs.length > 0) ? self.HABILIDADES_LISTA.find(function(h){ return h.id === v.habs[0]; }) : null;
            var habHtml = topHab ? '<div style="font-size:0.85rem;">' + topHab.icon + '</div>' : '';
            card.innerHTML = avatarHtml + habHtml + '<div style="font-size:0.68rem;color:#475569;font-weight:700;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70px;">' + v.nombre.split(' ')[0] + '</div>';
            miniLista.appendChild(card);
        });

        if (voluntarios.length > 10) {
            var more = document.createElement('div');
            more.style.cssText = 'text-align:center;min-width:60px;padding:10px 6px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;';
            more.onclick = function(){ app.navigate('screen-voluntarios'); };
            more.innerHTML = '<div style="width:40px;height:40px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:900;color:#6366f1;margin-bottom:4px;">+' + (voluntarios.length - 10) + '</div><div style="font-size:0.68rem;color:#94a3b8;font-weight:600;">Ver todos</div>';
            miniLista.appendChild(more);
        }
    },


    volPublicarMiPerfil: async function() {
        var u = auth.getCurrentUser();
        if (!u) { alert('Debes iniciar sesion primero'); return; }
        var habs = this.getHabilidades ? this.getHabilidades() : [];
        if (habs.length === 0) {
            alert('Primero agrega tus habilidades en tu perfil!');
            this.navigate('screen-profile');
            return;
        }
        // guardar nombre para que aparezca en la lista local
        localStorage.setItem('redmaria_nombre_' + u.id, u.name || u.email || 'Voluntario');
        // guardar avatar por ID local
        var av = localStorage.getItem('redmaria_avatar');
        if (av) localStorage.setItem('redmaria_avatar_' + u.id, av);
        // re-guardar habilidades con clave por ID (asegura visibilidad local)
        localStorage.setItem('redmaria_habilidades_' + u.id, JSON.stringify(habs));

        // ── Sincronizar de forma forzada a Supabase ──
        if (typeof db !== 'undefined' && u) {
            try {
                var resolvedId = localStorage.getItem('redmaria_sb_uuid_' + u.id) || u.id;
                
                // Sincronizar avatar a profiles
                if (db.upsertProfile) {
                    await db.upsertProfile(resolvedId, u.name || 'Voluntario', u.email, av).catch(function(){});
                }
                
                if (db.saveHabilidades) {
                    await db.saveHabilidades(u.id, habs).catch(function(){});
                }
                if (db.saveCompromiso) {
                    var comps = this.getCompromisos ? this.getCompromisos() : [];
                    for (var c of comps) {
                        await db.saveCompromiso(u.id, { catId: c.catId, desc: c.desc, hasta: c.hasta }).catch(function(){});
                    }
                }
            } catch(e) {
                console.warn('[Sync] Error al sincronizar:', e.message);
            }
        }

        alert('Tu perfil ya esta visible en el Banco de Voluntarios!');
        this.loadVoluntarios(true);
    },

    CAUSAS: [
        { id: 'comedor',    icon: '🍲', nombre: 'Comedor',           desc: 'Colaboro en un comedor comunitario',         color: '#f97316' },
        { id: 'calle',      icon: '🏠', nombre: 'Situacion de Calle', desc: 'Ayudo a personas en situacion de calle',     color: '#8b5cf6' },
        { id: 'anuncios',   icon: '📢', nombre: 'Difusion',           desc: 'Difundo actividades solidarias',             color: '#0ea5e9' },
        { id: 'rosario',    icon: '🤝', nombre: 'Rosario/Oracion',    desc: 'Organizo momentos comunitarios de oracion',  color: '#10b981' },
        { id: 'voluntario', icon: '🎯', nombre: 'Voluntario General', desc: 'Disponible para ayudar donde se necesite',   color: '#e74c3c' }
    ],


    getCausaKey: function() {
        var u = auth.getCurrentUser();
        return u ? 'redmaria_causa_' + u.id : null;
    },

    getCausaGuardada: function() {
        var key = this.getCausaKey();
        if (!key) return null;
        try { return JSON.parse(localStorage.getItem(key)); } catch(e) { return null; }
    },

    selectCausa: function(causaId) {
        var key = this.getCausaKey();
        if (!key) return;
        var causa = this.CAUSAS.find(function(c) { return c.id === causaId; });
        if (!causa) return;
        localStorage.setItem(key, JSON.stringify({ id: causaId, desde: new Date().toISOString() }));
        this.closeCausaPicker();
        this.renderCausaCard();
    },

    openCausaPicker: function() {
        var self = this;
        var old = document.getElementById('causa-picker-overlay');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        var overlay = document.createElement('div');
        overlay.id = 'causa-picker-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === overlay) self.closeCausaPicker(); };

        var sheet = document.createElement('div');
        sheet.style.cssText = 'background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:540px;padding:24px 20px 44px;box-shadow:0 -8px 32px rgba(0,0,0,0.25);';
        sheet.onclick = function(e) { e.stopPropagation(); };

        var closeBtn = '<button onclick="app.closeCausaPicker()" style="background:none;border:none;font-size:1.6rem;cursor:pointer;color:#94a3b8;line-height:1;">✕</button>';
        var hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;';
        hdr.innerHTML = '<h3 style="margin:0;font-size:1.1rem;font-weight:900;color:#1e293b;">¿Cuál es tu causa ahora?</h3>' + closeBtn;
        sheet.appendChild(hdr);

        var grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;';
        this.CAUSAS.forEach(function(c) {
            var btn = document.createElement('button');
            btn.style.cssText = 'border:2px solid ' + c.color + ';background:#fff;border-radius:14px;padding:16px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;font-family:inherit;';
            btn.innerHTML = '<span style="font-size:2rem;">' + c.icon + '</span><span style="font-size:0.8rem;font-weight:800;color:' + c.color + ';">' + c.nombre + '</span>';
            btn.onclick = function() { self.selectCausa(c.id); };
            grid.appendChild(btn);
        });
        sheet.appendChild(grid);
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
    },

    closeCausaPicker: function() {
        var overlay = document.getElementById('causa-picker-overlay');
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    },

    renderCausaCard: function() {
        var self = this;
        var data = this.getCausaGuardada();
        var display = document.getElementById('causa-display');
        var empty = document.getElementById('causa-empty');
        if (!display || !empty) return;

        if (data && data.id) {
            var causa = this.CAUSAS.find(function(c) { return c.id === data.id; });
            if (causa) {
                document.getElementById('causa-icon').textContent = causa.icon;
                document.getElementById('causa-nombre').textContent = causa.nombre;
                document.getElementById('causa-desc').textContent = causa.desc;
                var desde = new Date(data.desde);
                var diffMs = new Date() - desde;
                var diffDias = Math.floor(diffMs / 86400000);
                var diffHoras = Math.floor(diffMs / 3600000);
                var tiempoStr = diffDias > 0 ? 'Activo hace ' + diffDias + ' día' + (diffDias > 1 ? 's' : '') : diffHoras > 0 ? 'Activo hace ' + diffHoras + ' hora' + (diffHoras > 1 ? 's' : '') : 'Recién activado';
                var desdeEl = document.getElementById('causa-desde');
                if (desdeEl) desdeEl.innerHTML = '<i class="ri-time-line"></i> ' + tiempoStr;
                var badge = document.getElementById('causa-badge');
                if (badge) badge.style.background = 'linear-gradient(135deg,' + causa.color + ',#6366f1)';
                display.style.display = 'block';
                empty.style.display = 'none';
                return;
            }
        }
        display.style.display = 'none';
        empty.style.display = 'block';
        this.checkCausaSugerencia();
    },

    _causaSugerida: null,

    checkCausaSugerencia: function() {
        var sug = null;
        var u = auth.getCurrentUser();
        if (!u) return;
        var continuo = JSON.parse(localStorage.getItem('redmaria_continuo') || '{}');
        outerLoop:
        for (var dateKey in continuo) {
            for (var h in continuo[dateKey]) {
                var people = continuo[dateKey][h];
                if (Array.isArray(people) && people.indexOf(u.name) !== -1) { sug = 'comedor'; break outerLoop; }
            }
        }
        if (!sug) {
            var rosarios = JSON.parse(localStorage.getItem('redmaria_rosaries') || '[]');
            if (rosarios.some(function(r) { return r.creatorId === u.id; })) sug = 'rosario';
        }
        if (!sug) {
            var anuncios = JSON.parse(localStorage.getItem('redmaria_anuncios') || '[]');
            if (anuncios.some(function(a) { return a.creator_email === u.email; })) sug = 'anuncios';
        }
        var sugDiv = document.getElementById('causa-sugerencia');
        var sugText = document.getElementById('causa-sug-text');
        if (!sugDiv || !sugText) return;
        if (sug) {
            var causa = this.CAUSAS.find(function(c) { return c.id === sug; });
            if (causa) {
                this._causaSugerida = sug;
                sugText.textContent = 'basado en tu actividad, ¿tu causa es ' + causa.icon + ' ' + causa.nombre + '?';
                sugDiv.style.display = 'block';
                return;
            }
        }
        sugDiv.style.display = 'none';
    },

    acceptCausaSugerencia: function() {
        if (this._causaSugerida) {
            this.selectCausa(this._causaSugerida);
            this._causaSugerida = null;
        }
    },

    requestGeolocation() {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                localStorage.setItem('redmaria_location', JSON.stringify(loc));
                // Reverse geocode to get city name
                fetch('https://nominatim.openstreetmap.org/reverse?lat=' + loc.lat + '&lon=' + loc.lng + '&format=json&accept-language=es')
                    .then(r => r.json())
                    .then(data => {
                        const city = data.address?.city || data.address?.town || data.address?.village || data.address?.state || '';
                        if (city) {
                            const pc = document.getElementById('profile-user-city');
                            if (pc) pc.textContent = city;
                            localStorage.setItem('redmaria_user_city', city);
                        }
                    }).catch(function(){});
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    },

    updateUserUI: function() {
        var u = auth.getCurrentUser(); 
        console.log('[Profile] Updating UI for user:', u);
        if (!u) {
            console.warn('[Profile] No user session found');
            return;
        }
        
        var nameEl = document.getElementById('profile-name-main');
        var emailEl = document.getElementById('profile-email-main');
        var hn = document.getElementById('header-user-name'); 
        
        if (nameEl) nameEl.textContent = u.name || 'Usuario';
        if (emailEl) emailEl.textContent = u.email ? u.email.split('@')[0] : 'usuario';
        if (hn) hn.textContent = u.name || 'Usuario';
        
        this.loadUserAvatar();

        var pc = document.getElementById('profile-user-city');
        var savedCity = localStorage.getItem('redmaria_user_city');
        if (savedCity && pc) pc.textContent = savedCity;

        var savedBio = localStorage.getItem('redmaria_user_bio');
        var bioText = document.getElementById('profile-bio-text');
        if (bioText) {
            if (savedBio) {
                bioText.textContent = '"' + savedBio + '"';
                bioText.style.fontStyle = 'normal';
                bioText.style.color = 'var(--clr-text-title)';
            } else {
                bioText.textContent = '"Toca aquí para agregar una frase..."';
                bioText.style.fontStyle = 'italic';
                bioText.style.color = 'var(--clr-text-muted)';
            }
        }

        if (typeof db !== 'undefined' && db.getProfileByEmail) {
            db.getProfileByEmail(u.email).then(function(p) {
                if (p && p.bio) {
                    localStorage.setItem('redmaria_user_bio', p.bio);
                    if (bioText) {
                        bioText.textContent = '"' + p.bio + '"';
                        bioText.style.fontStyle = 'normal';
                        bioText.style.color = 'var(--clr-text-title)';
                    }
                }
                if (p && p.likes !== undefined) {
                    var countEl = document.querySelector('.profile-like-count');
                    if (countEl) countEl.textContent = p.likes;
                }
            }).catch(function(e) { console.warn('[Profile] Error loading remote details:', e); });
        }

        var self = this;
        if (typeof db !== 'undefined' && db.getCompromisos && u) {
            db.getCompromisos(u.id).then(function(remoteComps) {
                if (remoteComps) {
                    var k = self.getCompromisosKey();
                    if (k) {
                        localStorage.setItem(k, JSON.stringify(remoteComps));
                        try { self.renderCompromisos(); } catch(err){}
                        try { if (self.renderAnunciosVolProfile) self.renderAnunciosVolProfile(); } catch(err){}
                    }
                }
            }).catch(function(err) { console.warn('[Profile] Error loading remote commitments:', err); });
        }

        try { this.renderProfileSlots(); } catch(e) {}
        try { this.renderProfileJoined(); } catch(e) {}
        try { this.renderProfileMyRosaries(); } catch(e) {}
        try { if(this.renderVolunteerProfile) this.renderVolunteerProfile(); } catch(e) {}
    },

    getAvatarKey: function() {
        var u = auth.getCurrentUser();
        return u ? 'redmaria_avatar_' + u.id : 'redmaria_avatar';
    },

    handleAvatarUpload: function(e) {
        var self = this;
        var input = e.target || e;
        if (!input.files || !input.files[0]) return;
        var file = input.files[0];
        if (!file.type.startsWith('image/')) return;
        
        var reader = new FileReader();
        reader.onload = function(evt) {
            var dataUrl = evt.target.result;
            self.setUserAvatar(dataUrl);
            localStorage.setItem(self.getAvatarKey(), dataUrl);
            console.log('[Profile] Avatar uploaded and saved');
            
            // Sincronizar en el fondo a Supabase
            var u = auth.getCurrentUser();
            if (u && typeof db !== 'undefined' && db.upsertProfile) {
                var resolvedId = localStorage.getItem('redmaria_sb_uuid_' + u.id) || u.id;
                db.upsertProfile(resolvedId, u.name || 'Voluntario', u.email, dataUrl).then(function() {
                    console.log('[Profile] Avatar synced successfully to Supabase');
                }).catch(function(err) {
                    console.warn('[Profile] Error syncing avatar to Supabase:', err.message);
                });
            }
        };
        reader.readAsDataURL(file);
    },

    setUserAvatar: function(dataUrl) {
        var mainImg = document.getElementById('profile-avatar-img-main');
        var mainPlace = document.getElementById('profile-avatar-placeholder-main');
        var miniImg = document.getElementById('header-avatar-mini-img');
        var miniPlace = document.getElementById('header-avatar-mini');

        if (dataUrl) {
            if (mainImg) { mainImg.src = dataUrl; mainImg.style.display = 'block'; }
            if (mainPlace) mainPlace.style.display = 'none';
            if (miniImg) { miniImg.src = dataUrl; miniImg.style.display = 'block'; }
            if (miniPlace) miniPlace.style.display = 'none';
        } else {
            if (mainImg) { mainImg.src = ''; mainImg.style.display = 'none'; }
            if (mainPlace) mainPlace.style.display = 'flex';
            if (miniImg) { miniImg.src = ''; miniImg.style.display = 'none'; }
            if (miniPlace) miniPlace.style.display = 'flex';
        }
    },

    loadUserAvatar: function() {
        var key = this.getAvatarKey();
        var saved = localStorage.getItem(key) || localStorage.getItem('redmaria_avatar');
        console.log('[Profile] Loading avatar from:', key, 'Success:', !!saved);
        this.setUserAvatar(saved);
    },

    renderProfileSlots() {
        const container = document.getElementById('profile-my-slots'); if (!container) return;
        const session = auth.isAuthenticated() ? JSON.parse(localStorage.getItem('redmaria_session')) : null;
        if (!session) return;
        const userName = session.name;
        const all = JSON.parse(localStorage.getItem(this.CONTINUO_KEY) || '{}');
        const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
        const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        const mySlots = [];

        for (const dateKey in all) {
            const slots = all[dateKey];
            for (const h in slots) {
                let people = slots[h];
                if (typeof people === 'string') people = [people];
                if (!Array.isArray(people)) continue; // skip corrupt data
                if (people.includes(userName)) {
                    const d = new Date(dateKey + 'T00:00:00');
                    const today = new Date(); today.setHours(0,0,0,0);
                    const tomorrow = new Date(today.getTime() + 86400000);
                    let dayLabel;
                    if (d.getTime() === today.getTime()) dayLabel = 'Hoy';
                    else if (d.getTime() === tomorrow.getTime()) dayLabel = 'Mañana';
                    else dayLabel = days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()];
                    const hour = parseInt(h);
                    const hourStr = hour.toString().padStart(2, '0') + ':00';
                    const nextHourStr = ((hour + 1) % 24).toString().padStart(2, '0') + ':00';
                    mySlots.push({ dateKey, date: d, dayLabel, hour, hourStr, nextHourStr, count: people.length });
                }
            }
        }

        // Sort by date and hour
        mySlots.sort((a, b) => a.date - b.date || a.hour - b.hour);

        if (mySlots.length === 0) {
            container.innerHTML = '<div class="profile-no-slots glass card"><i class="ri-calendar-line"></i><p>Aún no te anotaste a ningún turno</p><button class="btn btn-primary" onclick="app.navigate(\'screen-live\')"><i class="ri-add-line"></i> Anotarme</button></div>';
            return;
        }

        let html = '';
        mySlots.forEach(s => {
            html += '<div class="profile-slot-card glass card">' +
                '<div class="profile-slot-left">' +
                    '<div class="profile-slot-icon"><i class="ri-time-line"></i></div>' +
                    '<div class="profile-slot-info">' +
                        '<h4>' + s.hourStr + ' - ' + s.nextHourStr + '</h4>' +
                        '<p><i class="ri-calendar-event-fill"></i> ' + s.dayLabel + '</p>' +
                        '<span class="profile-slot-people"><i class="ri-group-fill"></i> ' + s.count + ' persona' + (s.count > 1 ? 's' : '') + '</span>' +
                    '</div>' +
                '</div>' +
                '<button class="profile-slot-cancel" onclick="app.cancelSlot(\'' + s.dateKey + '\',' + s.hour + '); app.renderProfileSlots();" title="Cancelar turno"><i class="ri-close-circle-line"></i></button>' +
            '</div>';
        });
        container.innerHTML = html;
    },

    generateSplashBeads() { const c = document.getElementById('splash-beads'); for (let i=0;i<44;i++) { const a=(i/44)*Math.PI*2; if(a>Math.PI*0.35&&a<Math.PI*0.65)continue; const b=document.createElement('div'); b.className='rosary-bead'; b.style.left=(90+80*Math.cos(a))+'px'; b.style.top=(90+80*Math.sin(a))+'px'; c.appendChild(b); } },
    generateLiveBeads() { const c=document.getElementById('live-beads'); for(let i=0;i<7;i++){const b=document.createElement('div');b.className='live-bead';if(i===3)b.classList.add('active');c.appendChild(b);} },
    generateParticipants() {
        // No fake participants - real data only
    },
    startOnlineCounter() { /* disabled - no fake counter */ },

    // ---- ROSARIO CONTINUO ----
    continuoChangeDay(delta) {
        this.continuoDate.setDate(this.continuoDate.getDate() + delta);
        this.renderContinuo();
    },

    async getContinuoSlots(dateKey) {
        var all = JSON.parse(localStorage.getItem(this.CONTINUO_KEY) || '{}');
        if (!all[dateKey]) all[dateKey] = {};
        
        // Migrate string values to arrays in local
        for (var h in all[dateKey]) {
            if (typeof all[dateKey][h] === 'string') all[dateKey][h] = [all[dateKey][h]];
            if (!Array.isArray(all[dateKey][h])) all[dateKey][h] = [];
        }
        
        // Supabase is the SOURCE OF TRUTH when available
        if (typeof db !== 'undefined' && db.getContinuoSlots) {
            try {
                var remote = await db.getContinuoSlots(dateKey);
                if (remote && typeof remote === 'object') {
                    // Replace local with Supabase data entirely for this date
                    var supabaseSlots = {};
                    for (var rh in remote) {
                        supabaseSlots[rh] = Array.isArray(remote[rh]) ? remote[rh] : [remote[rh]];
                    }
                    // Also include any LOCAL-ONLY entries added in the last 10 seconds
                    // (to handle the gap between local save and Supabase propagation)
                    var localSlots = all[dateKey] || {};
                    var recentKey = '_continuo_recent_' + dateKey;
                    var recentRaw = localStorage.getItem(recentKey);
                    if (recentRaw) {
                        try {
                            var recent = JSON.parse(recentRaw);
                            var now = Date.now();
                            // Add recent local entries not yet in Supabase (within 10s)
                            recent.forEach(function(entry) {
                                if (now - entry.ts < 10000) {
                                    var hr = entry.hour;
                                    if (!supabaseSlots[hr]) supabaseSlots[hr] = [];
                                    if (!supabaseSlots[hr].includes(entry.name)) {
                                        supabaseSlots[hr].push(entry.name);
                                    }
                                }
                            });
                            // Clean old entries
                            var fresh = recent.filter(function(e) { return now - e.ts < 10000; });
                            if (fresh.length > 0) localStorage.setItem(recentKey, JSON.stringify(fresh));
                            else localStorage.removeItem(recentKey);
                        } catch(e) { localStorage.removeItem(recentKey); }
                    }
                    all[dateKey] = supabaseSlots;
                    localStorage.setItem(this.CONTINUO_KEY, JSON.stringify(all));
                    console.log('[Continuo] Using Supabase as source of truth for', dateKey);
                    return supabaseSlots;
                }
            } catch(e) { console.warn('[Continuo] Supabase failed, using local:', e.message); }
        }
        
        // Fallback: use localStorage only (offline mode)
        console.log('[Continuo] Using localStorage fallback for', dateKey);
        return all[dateKey] || {};
    },

    async renderContinuo() {
        const d = this.continuoDate;
        const today = new Date();
        const isToday = d.toDateString() === today.toDateString();
        const isTomorrow = new Date(today.getTime() + 86400000).toDateString() === d.toDateString();
        const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
        const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const titleEl = document.getElementById('continuo-date-title');
        const subEl = document.getElementById('continuo-date-sub');
        if (titleEl) titleEl.textContent = isToday ? 'Hoy' : (isTomorrow ? 'Mañana' : days[d.getDay()]);
        if (subEl) subEl.textContent = d.getDate() + ' de ' + months[d.getMonth()] + ', ' + d.getFullYear();

        const dateKey = this.localDateKey(d);
        const slots = await this.getContinuoSlots(dateKey);
        const user = auth.isAuthenticated() ? JSON.parse(localStorage.getItem('redmaria_session')).name : null;
        const grid = document.getElementById('continuo-grid');
        if (!grid) return;
        grid.innerHTML = '';
        let totalPeople = 0;

        for (let h = 0; h < 24; h++) {
            const card = document.createElement('div');
            const hour = h.toString().padStart(2, '0') + ':00';
            const nextHour = ((h + 1) % 24).toString().padStart(2, '0') + ':00';
            let people = slots[h] || [];
            if (typeof people === 'string') people = [people];
            if (!Array.isArray(people)) people = [];
            const count = people.length;
            const isMine = user && people.includes(user);
            totalPeople += count;

            if (count > 0) {
                card.className = 'slot-card ' + (isMine ? 'mine' : 'taken');
                card.innerHTML = '<div class="slot-hour">' + hour + '</div><div class="slot-count">' + count + '</div><div class="slot-status">' + (isMine ? '­ƒÖÅ Tú + ' + (count - 1) : count + ' persona' + (count > 1 ? 's' : '')) + '</div>';
                card.onclick = () => this.showSlotSignup(dateKey, h, hour, nextHour);
            } else {
                card.className = 'slot-card free';
                card.innerHTML = '<div class="slot-hour">' + hour + '</div><div class="slot-count">0</div><div class="slot-status">Libre</div>';
                card.onclick = () => this.showSlotSignup(dateKey, h, hour, nextHour);
            }
            grid.appendChild(card);
        }

        var takenEl = document.getElementById('continuo-taken');
        if (takenEl) takenEl.textContent = totalPeople;

        // Mis Turnos
        const mySection = document.getElementById('continuo-my-slots');
        const myList = document.getElementById('continuo-my-list');
        if (!myList) return;
        myList.innerHTML = '';
        let hasSlots = false;
        for (let h = 0; h < 24; h++) {
            let people = slots[h] || [];
            if (typeof people === 'string') people = [people];
            if (!Array.isArray(people)) people = [];
            if (user && people.includes(user)) {
                hasSlots = true;
                const hour = h.toString().padStart(2, '0') + ':00';
                const nextHour = ((h + 1) % 24).toString().padStart(2, '0') + ':00';
                const item = document.createElement('div');
                item.className = 'my-slot-item';
                item.innerHTML = '<div class="my-slot-info"><div class="my-slot-icon"><i class="ri-time-line"></i></div><div class="my-slot-text"><h4>' + hour + ' - ' + nextHour + '</h4><p>' + (subEl ? subEl.textContent : '') + '</p></div></div><button class="my-slot-cancel" onclick="app.cancelSlot(\'' + dateKey + '\',' + h + ')">Cancelar</button>';
                myList.appendChild(item);
            }
        }
        if (mySection) mySection.style.display = hasSlots ? 'block' : 'none';
    },

    showSlotSignup(dateKey, hour, hourStr, nextHourStr) {
        if (!auth.isAuthenticated()) { this.navigate('screen-login'); return; }
        const user = JSON.parse(localStorage.getItem('redmaria_session')).name;
        // Use the last rendered data (already synced from Supabase) instead of stale localStorage
        const all = JSON.parse(localStorage.getItem(this.CONTINUO_KEY) || '{}');
        const slots = all[dateKey] || {};
        let people = slots[hour] || [];
        if (typeof people === 'string') people = [people];
        if (!Array.isArray(people)) people = [];
        const alreadyIn = people.includes(user);
        // Parse date from dateKey to avoid timezone drift from continuoDate
        const dateParts = dateKey.split('-');
        const modalDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
        const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const dateStr = modalDate.getDate() + ' de ' + months[modalDate.getMonth()] + ', ' + modalDate.getFullYear();
        const modal = document.createElement('div');
        modal.className = 'slot-signup-modal';
        if (alreadyIn) {
            modal.innerHTML = '<div class="slot-signup-card"><h3>Cancelar Turno</h3><div class="slot-signup-time">' + hourStr + ' - ' + nextHourStr + '</div><div class="slot-signup-date">' + dateStr + '</div><p style="font-size:0.85rem;color:#5A7D9A;margin-bottom:12px">Ya estás anotado en este horario. ┬┐Deseas cancelar?</p><div class="slot-signup-actions"><button class="btn btn-secondary-outline" onclick="this.closest(\'.slot-signup-modal\').remove()">Volver</button><button class="btn btn-primary" id="confirm-slot-btn" style="background:linear-gradient(135deg,#e74c3c,#c0392b)">Cancelar Turno</button></div></div>';
            document.body.appendChild(modal);
            modal.querySelector('#confirm-slot-btn').onclick = () => { this.cancelSlot(dateKey, hour); modal.remove(); };
        } else {
            modal.innerHTML = '<div class="slot-signup-card"><h3>Anotarse al Rosario</h3><div class="slot-signup-time">' + hourStr + ' - ' + nextHourStr + '</div><div class="slot-signup-date">' + dateStr + '</div>' + (people.length > 0 ? '<p style="font-size:0.85rem;color:#5A7D9A;margin-bottom:12px">' + people.length + ' persona' + (people.length > 1 ? 's' : '') + ' ya anotada' + (people.length > 1 ? 's' : '') + '</p>' : '') + '<div class="slot-signup-actions"><button class="btn btn-secondary-outline" onclick="this.closest(\'.slot-signup-modal\').remove()">Cancelar</button><button class="btn btn-primary" id="confirm-slot-btn">Confirmar</button></div></div>';
            document.body.appendChild(modal);
            modal.querySelector('#confirm-slot-btn').onclick = () => { this.confirmSlot(dateKey, hour); modal.remove(); };
        }
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    },

    async confirmSlot(dateKey, hour) {
        const session = JSON.parse(localStorage.getItem('redmaria_session'));
        if (!session) return;
        // Save locally for immediate feedback
        const all = JSON.parse(localStorage.getItem(this.CONTINUO_KEY) || '{}');
        if (!all[dateKey]) all[dateKey] = {};
        if (!all[dateKey][hour]) all[dateKey][hour] = [];
        if (typeof all[dateKey][hour] === 'string') all[dateKey][hour] = [all[dateKey][hour]];
        if (!all[dateKey][hour].includes(session.name)) all[dateKey][hour].push(session.name);
        localStorage.setItem(this.CONTINUO_KEY, JSON.stringify(all));
        // Track as recent entry (for instant feedback before Supabase propagates)
        var recentKey = '_continuo_recent_' + dateKey;
        var recent = [];
        try { recent = JSON.parse(localStorage.getItem(recentKey) || '[]'); } catch(e) { recent = []; }
        recent.push({ hour: hour, name: session.name, ts: Date.now() });
        localStorage.setItem(recentKey, JSON.stringify(recent));
        // Sync to Supabase (await so renderContinuo reads fresh data)
        if (typeof db !== 'undefined' && db.addContinuoSlot) {
            await db.addContinuoSlot(dateKey, hour, session.name);
        }
        this.renderContinuo();
    },

    async cancelSlot(dateKey, hour) {
        const session = JSON.parse(localStorage.getItem('redmaria_session'));
        if (!session) return;
        // Remove locally
        const all = JSON.parse(localStorage.getItem(this.CONTINUO_KEY) || '{}');
        if (all[dateKey] && all[dateKey][hour]) {
            if (typeof all[dateKey][hour] === 'string') all[dateKey][hour] = [all[dateKey][hour]];
            all[dateKey][hour] = all[dateKey][hour].filter(n => n !== session.name);
            if (all[dateKey][hour].length === 0) delete all[dateKey][hour];
        }
        localStorage.setItem(this.CONTINUO_KEY, JSON.stringify(all));
        // Sync to Supabase
        if (typeof db !== 'undefined' && db.removeContinuoSlot) {
            await db.removeContinuoSlot(dateKey, hour, session.name);
        }
        this.renderContinuo();
    },

    highlightTodayMystery() {
        const el = document.getElementById('rezar-today-highlight');
        if (!el) return;
        const day = new Date().getDay(); // 0=Dom, 1=Lun...
        const dayMap = { 0: 'Gloriosos', 1: 'Gozosos', 2: 'Dolorosos', 3: 'Gloriosos', 4: 'Luminosos', 5: 'Dolorosos', 6: 'Gozosos' };
        const dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
        const mystery = dayMap[day];
        const colorMap = { 'Gozosos': '#56d992', 'Dolorosos': '#e74c3c', 'Gloriosos': '#f0a500', 'Luminosos': '#3DA3D4' };
        el.innerHTML = '<i class="ri-calendar-check-fill"></i> Hoy es <strong>' + dayNames[day] + '</strong> ÔÇö rezamos los <strong>Misterios ' + mystery + '</strong>';
        el.style.borderLeft = '4px solid ' + (colorMap[mystery] || '#3DA3D4');
    },

    addIntencion() {
        const ta = document.getElementById('intencion-text');
        const text = ta?.value.trim();
        if (!text) { ta?.focus(); return; }
        const user = auth.isAuthenticated() ? auth.getCurrentUser() : null;
        if (!user) { this.navigate('screen-login'); return; }
        const name = user.name || 'Anónimo';
        const initial = name.charAt(0).toUpperCase();
        const colors = ['#A8C4DE','#F4D35E','#B5D6A7','#E8A0BF','#C4B5FD','#8FACC5','#FFB4A2','#89CFF0','#FFC6FF','#CAFFBF'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const color2 = colors[(Math.floor(Math.random() * colors.length) + 3) % colors.length];

        // Build intention object (same format as rezo intenciones for unification)
        var intencion = {
            id: Date.now().toString(36),
            name: name,
            initial: initial,
            text: text,
            color: color,
            color2: color2,
            time: new Date().toISOString()
        };

        // Save to shared localStorage (used by both Rezar and Intenciones screens)
        if (typeof getRezoIntenciones === 'function') {
            var list = getRezoIntenciones();
            list.push(intencion);
            saveRezoIntenciones(list);
        }

        // Update the community intentions list visually (on Intenciones screen)
        const communityList = document.getElementById('community-intentions-list');
        if (communityList) {
            const item = document.createElement('div');
            item.className = 'community-intention glass';
            item.style.animation = 'fadeInUp 0.4s ease-out';
            item.innerHTML = '<div class="ci-avatar" style="background:' + color + '">' + initial + '</div><div class="ci-content"><span class="ci-name">' + auth.sanitize(name) + '</span><p>' + auth.sanitize(text) + '</p></div><div class="ci-heart-area"><button class="ci-heart-btn" onclick="toggleRezoHeart(this,\'' + intencion.id + '\')"><i class="ri-heart-line"></i></button><span class="ci-heart-count">0</span></div>';
            communityList.insertBefore(item, communityList.firstChild);
        }

        // Also update the rezo intenciones list if it exists (on Rezar screen)
        if (typeof renderRezoIntenciones === 'function') {
            renderRezoIntenciones();
        }

        ta.value = '';

        // Sync to Supabase with user name
        if (typeof db !== 'undefined' && db.createIntencion) {
            db.createIntencion({ text: text, user_name: name })
                .then(function(result) { console.log('[Intenciones] Saved to Supabase'); })
                .catch(function(e) { console.error('[Intenciones] Sync error:', e); });
        }
    }
};

// Init app
document.addEventListener('DOMContentLoaded', function() {
    app.init();
    if (typeof loadCommunityIntenciones === 'function') {
        loadCommunityIntenciones();
    }

    // Check for shared rosary in URL
    var urlParams = new URLSearchParams(window.location.search);
    var sharedRosary = urlParams.get('rosary');
    if (sharedRosary) {
        setTimeout(function() {
            app.navigate('screen-map');
            // Remove the param from URL so it doesn't persist on reload
            window.history.replaceState({}, document.title, window.location.pathname);
            
            // Optionally, scroll to the specific rosary card or highlight it
            setTimeout(function() {
                var cardBtn = document.querySelector('.btn-join[data-rosary-id="' + sharedRosary + '"]');
                if (cardBtn) {
                    var card = cardBtn.closest('.rosary-card');
                    if (card) {
                        card.scrollIntoView({behavior: 'smooth', block: 'center'});
                        card.style.boxShadow = '0 0 20px rgba(243, 156, 18, 0.8)';
                        setTimeout(function() { card.style.boxShadow = ''; }, 3000);
                    }
                }
            }, 1000);
        }, 300);
    }

    // Check for shared anuncio in URL
    var sharedAnuncio = urlParams.get('anuncio');
    if (sharedAnuncio) {
        console.log('[DOMContentLoaded] Immediate navigation to screen-anuncios for ID:', sharedAnuncio);
        app.navigate('screen-anuncios');
    }
});

// Ensure global access for inline onclick handlers
window.app = app;

// Profile Bio functions
function editProfileBio() {
    var textEl = document.getElementById('profile-bio-text');
    var editorEl = document.getElementById('profile-bio-editor');
    if (textEl) textEl.style.display = 'none';
    if (editorEl) editorEl.style.display = 'flex';
    var savedBio = localStorage.getItem('redmaria_user_bio') || '';
    var inputEl = document.getElementById('profile-bio-input');
    if (inputEl) {
        inputEl.value = savedBio;
        inputEl.focus();
    }
}

function cancelEditBio() {
    var textEl = document.getElementById('profile-bio-text');
    var editorEl = document.getElementById('profile-bio-editor');
    if (textEl) textEl.style.display = 'block';
    if (editorEl) editorEl.style.display = 'none';
}

function saveProfileBio() {
    var inputEl = document.getElementById('profile-bio-input');
    if (!inputEl) return;
    var bio = inputEl.value.trim();
    // check word count
    var words = bio.match(/\S+/g);
    var wordCount = words ? words.length : 0;
    if (wordCount > 80) {
        if (typeof showMsgToast === 'function') showMsgToast('La frase no puede tener más de 80 palabras.');
        return;
    }
    
    localStorage.setItem('redmaria_user_bio', bio);
    
    var bioText = document.getElementById('profile-bio-text');
    if (bioText) {
        if (bio) {
            bioText.textContent = '"' + bio + '"';
            bioText.style.fontStyle = 'normal';
            bioText.style.color = 'var(--clr-text-title)';
        } else {
            bioText.textContent = '"Toca aquá para agregar una frase que te represente..."';
            bioText.style.fontStyle = 'italic';
            bioText.style.color = 'var(--clr-text-muted)';
        }
    }
    
    cancelEditBio();
    
    var u = auth.getCurrentUser();
    if (u && typeof db !== 'undefined' && db.updateProfileBio) {
        db.updateProfileBio(u.id, bio).catch(function(e) { console.error('Error saving bio:', e); });
    }
}

// Profile Intention functions (for map broadcasting)
function editProfileIntention() {
    var textEl = document.getElementById('profile-intention-text');
    var editorEl = document.getElementById('profile-intention-editor');
    if (textEl) textEl.style.display = 'none';
    if (editorEl) editorEl.style.display = 'flex';
    var savedIntention = localStorage.getItem('redmaria_user_intention') || '';
    var inputEl = document.getElementById('profile-intention-input');
    if (inputEl) {
        inputEl.value = savedIntention;
        inputEl.focus();
    }
}

function cancelEditIntention() {
    var textEl = document.getElementById('profile-intention-text');
    var editorEl = document.getElementById('profile-intention-editor');
    if (textEl) textEl.style.display = 'block';
    if (editorEl) editorEl.style.display = 'none';
}

function saveProfileIntention() {
    var inputEl = document.getElementById('profile-intention-input');
    if (!inputEl) return;
    var intention = inputEl.value.trim();
    // check word count
    var words = intention.match(/\S+/g);
    var wordCount = words ? words.length : 0;
    if (wordCount > 80) {
        if (typeof showMsgToast === 'function') showMsgToast('La intención no puede tener más de 80 palabras.');
        return;
    }
    
    localStorage.setItem('redmaria_user_intention', intention);
    
    var textEl = document.getElementById('profile-intention-text');
    if (textEl) {
        if (intention) {
            textEl.textContent = '"' + intention + '"';
            textEl.style.fontStyle = 'normal';
            textEl.style.color = 'var(--clr-text-title)';
        } else {
            textEl.textContent = '"Toca aquá para escribir una intención por la cual quieres que la comunidad rece..."';
            textEl.style.fontStyle = 'italic';
            textEl.style.color = 'var(--clr-text-muted)';
        }
    }
    
    // Broadcast instantly if active
    if (typeof _myRezandoId !== 'undefined' && _myRezandoId && typeof broadcastRezando === 'function') {
        var userName = 'Tú';
        try { userName = auth.getCurrentUser().name || 'Tú'; } catch(e){}
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(function(pos) {
                broadcastRezando(_myRezandoId, userName, pos.coords.latitude, pos.coords.longitude, '', intention);
                if (typeof addMyMarker === 'function') addMyMarker(userName, pos.coords.latitude, pos.coords.longitude, intention);
            }, function(){}, {enableHighAccuracy: true, timeout: 8000});
        }
    }

    cancelEditIntention();
}

function toggleProfileLike(el) {
    var icon = el.querySelector('.profile-like-icon');
    var countEl = el.querySelector('.profile-like-count');
    if (!icon || !countEl) return;
    
    var isLiked = icon.classList.contains('liked-emoji');
    var count = parseInt(countEl.textContent, 10) || 0;
    var increment = 0;
    var u = auth.getCurrentUser();
    
    if (isLiked) {
        // Was liked (filled hand) -> unlike (empty hand), subtract 1
        icon.classList.remove('liked-emoji');
        icon.textContent = '­ƒÖÅ';
        icon.style.filter = 'grayscale(80%)';
        icon.style.opacity = '0.5';
        icon.style.transform = 'scale(1)';
        countEl.textContent = Math.max(0, count - 1);
        increment = -1;
        localStorage.setItem('redmaria_my_profile_liked', 'false');
    } else {
        // Was not liked (empty hand) -> like (filled hand), add 1
        icon.classList.add('liked-emoji');
        icon.textContent = '­ƒÖÅ';
        icon.style.filter = 'none';
        icon.style.opacity = '1';
        icon.style.transform = 'scale(1.3)';
        setTimeout(function(){ icon.style.transform = 'scale(1.1)'; }, 200);
        countEl.textContent = count + 1;
        increment = 1;
        localStorage.setItem('redmaria_my_profile_liked', 'true');
    }

    if (u && typeof db !== 'undefined' && db.updateProfileLikes) {
        db.updateProfileLikes(u.email, increment).catch(function(e) { console.error('Error syncing likes:', e); });
    }
}



// ==================== CHAT JS LOGIC ====================
let chatCurrentPartner = null;
let chatMessagesSubscription = null;

function loadChatContacts() {
    var list = document.getElementById('chat-contacts-list');
    var empty = document.getElementById('chat-empty');
    var loading = document.getElementById('chat-loading');
    if(!list) return;

    if (typeof auth === 'undefined' || !auth.isAuthenticated()) {
        empty.style.display = 'block';
        list.innerHTML = '';
        list.appendChild(empty);
        return;
    }

    loading.style.display = 'block';
    empty.style.display = 'none';
    
    var currentUser = auth.getCurrentUser();
    
    if (typeof db !== 'undefined' && db.getConversations) {
        db.getConversations(currentUser.id).then(function(conversations) {
            loading.style.display = 'none';
            // Also get all users to find names
            db.getAllUsers().then(function(users) {
                window._chatAllContacts = users;
                var usersMap = {};
                users.forEach(function(u) { usersMap[u.id] = u; });
                
                // Clear existing (except empty/loading)
                var toRemove = [];
                for(var i=0; i<list.children.length; i++) {
                    if (list.children[i].id !== 'chat-empty' && list.children[i].id !== 'chat-loading') {
                        toRemove.push(list.children[i]);
                    }
                }
                toRemove.forEach(function(el) { el.remove(); });

                if (conversations.length === 0) {
                    empty.style.display = 'block';
                } else {
                    empty.style.display = 'none';
                    conversations.forEach(function(conv) {
                        var partner = usersMap[conv.partnerId];
                        var name = partner ? partner.name : 'Usuario Desconocido';
                        var avatarLetter = name.charAt(0).toUpperCase();
                        var lastMsg = conv.lastMessage ? conv.lastMessage.text : '';
                        if (lastMsg.length > 30) lastMsg = lastMsg.substring(0,30) + '...';
                        var time = conv.lastMessage ? new Date(conv.lastMessage.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
                        
                        var item = document.createElement('div');
                        item.className = 'chat-contact-item';
                        item.setAttribute('data-name', name.toLowerCase());
                        item.onclick = function() { openChat(conv.partnerId, name); };
                        
                        var unreadHtml = conv.unreadCount > 0 ? '<span class="chat-contact-unread" style="display:inline-block">' + conv.unreadCount + '</span>' : '<span class="chat-contact-unread"></span>';
                        
                        item.innerHTML = '<div class="chat-contact-avatar-wrap"><div class="chat-contact-avatar">' + avatarLetter + '</div></div>' +
                            '<div class="chat-contact-info">' +
                                '<div class="chat-contact-header"><h4 class="chat-contact-name">' + name + '</h4><span class="chat-contact-time">' + time + '</span></div>' +
                                '<div class="chat-contact-body"><p class="chat-contact-lastmsg">' + lastMsg + '</p>' + unreadHtml + '</div>' +
                            '</div>';
                        list.appendChild(item);
                    });
                }
            });
        }).catch(function(e) {
            console.error('Error loading contacts', e);
            loading.style.display = 'none';
            empty.style.display = 'block';
        });
    } else {
        loading.style.display = 'none';
        empty.style.display = 'block';
    }
}

function filterChats() {
    var val = document.getElementById('chat-search').value.toLowerCase();
    var items = document.querySelectorAll('.chat-contact-item');
    items.forEach(function(item) {
        var name = item.getAttribute('data-name');
        if (name && name.includes(val)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function filterChatTab(btn, type) {
    var tabs = document.querySelectorAll('.chat-tab');
    tabs.forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');
}

function showNewChatModal() {
    var userName = prompt("Ingresa el nombre del usuario con el que quieres chatear:");
    if (userName && userName.trim() !== '') {
        if (typeof db !== 'undefined' && db.searchUsers) {
            db.searchUsers(userName.trim()).then(function(users) {
                if (users && users.length > 0) {
                    // Pick the first match
                    openChat(users[0].id, users[0].name);
                } else {
                    alert("No se encontró ningún usuario con ese nombre.");
                }
            }).catch(function(e){
                console.error('Search error', e);
            });
        }
    }
}

function openChatWith(id, name) {
    app.navigate('screen-mensajes');
    setTimeout(function() {
        if(typeof openChat === 'function') openChat(id, name);
    }, 100);
}

async function getChatUserId() {
    var cu = typeof auth !== 'undefined' && auth.getCurrentUser ? auth.getCurrentUser() : null;
    if (!cu || !cu.email) return null;
    var profile = await db.getProfileByEmail(cu.email);
    return profile ? profile.id : null;
}

async function openChat(partnerId, partnerName) {
    console.log('[Chat] Opening chat with:', partnerName, partnerId);
    chatCurrentPartner = partnerId;
    var contactsView = document.getElementById('chat-contacts-view');
    var convView = document.getElementById('chat-conversation-view');
    
    if(contactsView) contactsView.style.display = 'none';
    if(convView) {
        convView.style.display = 'flex';
        convView.style.zIndex = '9999'; // Force on top
        console.log('[Chat] convView displayed');
    } else {
        console.error('[Chat] convView NOT FOUND');
    }
    
    // Hide all possible general headers
    var hMain = document.getElementById('chat-list-header');
    var hMob = document.getElementById('mobile-header');
    var hDesk = document.getElementById('desktop-header');
    if (hMain) hMain.style.display = 'none';
    if (hMob) hMob.style.display = 'none';
    if (hDesk) hDesk.style.display = 'none';
    
    var hBot = document.getElementById('main-nav');
    if (hBot) hBot.style.display = 'none';
    
    var screenMensajes = document.getElementById('screen-mensajes');
    if (screenMensajes) screenMensajes.style.paddingTop = '0';
    
    var nameEl = document.getElementById('chat-conv-name');
    var avatarEl = document.getElementById('chat-conv-avatar');
    if(nameEl) nameEl.textContent = partnerName;
    if(avatarEl) {
        avatarEl.textContent = partnerName.charAt(0).toUpperCase();
        avatarEl.style.background = (typeof getChatColor === 'function') ? getChatColor(partnerName) : '#ccc';
    }
    
    // Premium status update
    updatePartnerStatus(partnerId);
    if (typeof checkBlockStatus === 'function') checkBlockStatus();

    var msgContainer = document.getElementById('chat-messages');
    if(msgContainer) msgContainer.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;"><i class="ri-loader-4-line" style="animation:spin 1s linear infinite;font-size:1.5rem;"></i></div>';

    var currentUser = auth.getCurrentUser();
    if (!currentUser) return;
    
    if (typeof db !== 'undefined' && db.markConversationAsRead) {
        db.markConversationAsRead(currentUser.id, partnerId);
        if (typeof updateChatBadges === 'function') updateChatBadges();
    }

    if (typeof db !== 'undefined' && db.getConversationMessages) {
        db.getConversationMessages(currentUser.id, partnerId).then(function(msgs) {
            if(msgContainer) msgContainer.innerHTML = '';
            var lastDate = '';
            if(msgContainer) {
                msgs.forEach(function(m) {
                    var dateStr = new Date(m.created_at).toLocaleDateString();
                    if (dateStr !== lastDate) {
                        var dH = document.createElement('div');
                        dH.className = 'chat-date-header';
                        dH.style.cssText = 'text-align:center; margin:20px 0; font-size:0.75rem; color:#94a3b8; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;';
                        dH.textContent = dateStr === new Date().toLocaleDateString() ? 'Hoy' : dateStr;
                        msgContainer.appendChild(dH);
                        lastDate = dateStr;
                    }
                    
                    var isSent = m.from_id === currentUser.id;
                    var mDiv = renderChatMsg(m, isSent);
                    msgContainer.appendChild(mDiv);
                });
                msgContainer.scrollTop = msgContainer.scrollHeight;
            }
        });
    }

    if (typeof db !== 'undefined' && db.subscribeToMessages) {
        if (chatMessagesSubscription) chatMessagesSubscription.unsubscribe();
        var room = [currentUser.id, partnerId].sort().join('_');
        chatMessagesSubscription = db.subscribeToMessages(room, function(newMsg, eventType, broadcastPayload) {
            // Handle reactions, new messages etc. (keeping existing logic)
            if (eventType === 'BROADCAST') {
                var data = broadcastPayload.payload || broadcastPayload;
                if (data && data.msgId) {
                    var wrap = document.querySelector('.wa-msg-row[data-msg-id="' + data.msgId + '"]');
                    if (wrap) _renderReactions({ id: data.msgId, reactions: data.reactions }, wrap);
                }
                return;
            }
            if (!newMsg) return;
            if (eventType === 'INSERT' || eventType === 'UPDATE') {
                db.getMessageById(newMsg.id).then(function(fullMsg) {
                    if (!fullMsg) return;
                    if (eventType === 'UPDATE') {
                        var wrap = document.querySelector('.wa-msg-row[data-msg-id="' + fullMsg.id + '"]');
                        if (wrap) _renderReactions(fullMsg, wrap);
                    } else if (eventType === 'INSERT') {
                        if (fullMsg.from_id === currentUser.id) return;
                        if (document.querySelector('.wa-msg-row[data-msg-id="' + fullMsg.id + '"]')) return;
                        if (fullMsg.from_id === chatCurrentPartner) {
                            if (msgContainer) {
                                var mDiv = renderChatMsg(fullMsg, false);
                                msgContainer.appendChild(mDiv);
                                msgContainer.scrollTop = msgContainer.scrollHeight;
                            }
                            db.markConversationAsRead(currentUser.id, chatCurrentPartner);
                        } else {
                            if (typeof updateChatBadges === 'function') updateChatBadges();
                        }
                    }
                });
            }
        });
    }
    
    // Check block status for UI
    if (typeof checkBlockStatus === 'function') checkBlockStatus();
}

function updatePartnerStatus(partnerId) {
    var statusEl = document.getElementById('chat-conv-status');
    var dotEl = document.getElementById('chat-status-dot');
    if (!statusEl || !dotEl) return;
    
    // Simulating presence (ideally linked to Supabase Realtime Presence)
    var isOnline = Math.random() > 0.4; 
    if (isOnline) {
        statusEl.textContent = 'en línea';
        statusEl.classList.add('online');
        dotEl.classList.add('online');
    } else {
        statusEl.textContent = 'últ. vez hace un momento';
        statusEl.classList.remove('online');
        dotEl.classList.remove('online');
    }
}

function closeChat() {
    chatCurrentPartner = null;
    var convView = document.getElementById('chat-conversation-view');
    var contactsView = document.getElementById('chat-contacts-view');
    if(convView) convView.style.display = 'none';
    if(contactsView) contactsView.style.display = 'flex';
    
    // Show headers back
    var hMain = document.getElementById('chat-list-header');
    var hMob = document.getElementById('mobile-header');
    var hDesk = document.getElementById('desktop-header');
    if (hMain) hMain.style.display = 'flex';
    if (hMob) hMob.style.display = 'block';
    if (hDesk) hDesk.style.display = 'flex';
    
    var hBot = document.getElementById('main-nav');
    if (hBot) hBot.style.display = 'flex';
    
    var screenMensajes = document.getElementById('screen-mensajes');
    if (screenMensajes) screenMensajes.style.paddingTop = '50px';
    
    if (chatMessagesSubscription) {
        chatMessagesSubscription.unsubscribe();
        chatMessagesSubscription = null;
    }
    loadChatContacts();
}

function toggleChatMenu() {
    var menu = document.getElementById('chat-more-menu');
    if (!menu) return;
    var isHidden = (menu.style.display === 'none' || !menu.style.display);
    menu.style.display = isHidden ? 'block' : 'none';
    
    if (isHidden) {
        setTimeout(function() {
            var closer = function(ev) {
                if (!menu.contains(ev.target) && !ev.target.closest('.chat-kebab-btn')) {
                    menu.style.display = 'none';
                    document.removeEventListener('click', closer);
                }
            };
            document.addEventListener('click', closer);
        }, 10);
    }
}

function clearChatHistory() {
    if (!chatCurrentPartner) return;
    if (confirm('¿Estás seguro de que deseas vaciar esta conversación?')) {
        var msgArea = document.getElementById('chat-messages');
        if (msgArea) msgArea.innerHTML = '';
        if (typeof showMsgToast === 'function') showMsgToast('Conversación vaciada');
        var menu = document.getElementById('chat-more-menu');
        if (menu) menu.style.display = 'none';
    }
}

function sendMessage() {
    var input = document.getElementById('chat-input');
    if(!input) return;
    var text = input.value.trim();
    if (!text || !chatCurrentPartner) return;
    
    var currentUser = auth.getCurrentUser();
    if (!currentUser) return;
    
    var replyData = null;
    if (window._chatReplyTo) {
        replyData = {
            id: window._chatReplyTo.id,
            text: window._chatReplyTo.text,
            media_url: window._chatReplyTo.media_url,
            sender_name: document.getElementById('chat-conv-name') ? document.getElementById('chat-conv-name').textContent : 'Usuario'
        };
        var preview = document.getElementById('wa-reply-preview');
        if (preview) preview.remove();
        window._chatReplyTo = null;
    }

    var msgContainer = document.getElementById('chat-messages');
    var tempMsg = {
        id: 'temp-' + Date.now(),
        text: text,
        reply_to: replyData,
        created_at: new Date().toISOString(),
        read: false
    };
    var mDiv = null;
    if(msgContainer) {
        mDiv = renderChatMsg(tempMsg, true);
        msgContainer.appendChild(mDiv);
        msgContainer.scrollTop = msgContainer.scrollHeight;
    }
    input.value = '';

    if (typeof db !== 'undefined' && db.sendMessage) {
        db.sendMessage(currentUser.id, chatCurrentPartner, text, replyData).then(function(msg) {
            if (msg && mDiv && mDiv.parentNode) {
                var realDiv = renderChatMsg(msg, true);
                mDiv.parentNode.replaceChild(realDiv, mDiv);
            }
        });
    }
}

// ══════════════════════════════════════════════════════════════
//  SISTEMA DE MENSAJES ESTILO WHATSAPP
// ══════════════════════════════════════════════════════════════

var _chatCtxMenu = null; // menú contextual activo

// ── Construye la burbuja completa con wrapper y acciones ──
// ── Construye la burbuja completa con wrapper y acciones ──
// ── Construye la burbuja completa con wrapper y acciones ──
var WA_EMOJIS = ['❤️','👍','😂','😮','😢','🙏','🔥'];

function renderChatMsg(m, isSent) {
    if (!m) return document.createElement('div');

    // --- Renderizado de Respuesta (Reply) ---
    var replyBlock = null;
    if (m.reply_to) {
        replyBlock = document.createElement('div');
        replyBlock.className = 'wa-bubble-reply';
        replyBlock.style.cssText = 'background:rgba(0,0,0,0.05); border-left:4px solid #34b7f1; padding:6px 10px; border-radius:6px; margin-bottom:6px; font-size:0.85rem; display:flex; gap:8px; align-items:center; cursor:pointer;';
        
        var replyTextWrap = document.createElement('div');
        replyTextWrap.style.flex = '1';
        var replySender = document.createElement('div');
        replySender.style.fontWeight = '700';
        replySender.style.color = '#34b7f1';
        replySender.textContent = m.reply_to.sender_name || 'Usuario';
        
        var replyContent = document.createElement('div');
        replyContent.style.color = '#666';
        replyContent.style.whiteSpace = 'nowrap';
        replyContent.style.overflow = 'hidden';
        replyContent.style.textOverflow = 'ellipsis';
        replyContent.style.maxWidth = '180px';
        
        if (m.reply_to.media_url) {
            replyContent.innerHTML = '<i class="ri-image-line"></i> Foto';
        } else {
            replyContent.textContent = m.reply_to.text || '';
        }
        
        replyTextWrap.appendChild(replySender);
        replyTextWrap.appendChild(replyContent);
        replyBlock.appendChild(replyTextWrap);
        
        if (m.reply_to.media_url) {
            var replyImg = document.createElement('img');
            replyImg.src = m.reply_to.media_url;
            replyImg.style.cssText = 'width:40px; height:40px; object-fit:cover; border-radius:4px;';
            replyBlock.appendChild(replyImg);
        }
        
        replyBlock.onclick = function() {
            var target = document.querySelector('.wa-msg-row[data-msg-id="' + m.reply_to.id + '"]');
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.style.background = 'rgba(52, 183, 241, 0.2)';
                setTimeout(function() { target.style.background = ''; }, 1500);
            }
        };
    }
    
    // Limpieza de URL de medios (v334)
    if (m.media_url && m.media_url.indexOf('http') !== 0 && m.media_url.indexOf('data:') !== 0) {
        m.media_url = SUPABASE_URL + '/storage/v1/object/public/chat-media/' + m.media_url;
    }
    
    var wrapper = document.createElement('div');
    wrapper.className = 'wa-msg-row ' + (isSent ? 'wa-row-sent' : 'wa-row-recv');
    wrapper.setAttribute('data-msg-id', m.id || '');

    var bubble = document.createElement('div');
    bubble.className = 'wa-bubble ' + (isSent ? 'wa-bubble-sent' : 'wa-bubble-recv');
    if (m.media_url) {
        bubble.style.padding = '4px';
        // bubble.style.overflow = 'hidden'; removed to fix popup
    }

    var timeStr = m.created_at
        ? new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
        : new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

    var contentContainer = document.createElement('div');
    contentContainer.style.position = 'relative';

    if (m.media_url) {
        var mediaWrap = document.createElement('div');
        mediaWrap.className = 'wa-media-wrap';
        mediaWrap.style.cssText = 'position:relative; width:260px; height:260px; border-radius:8px; overflow:hidden; background:#e0e0e0; cursor:pointer;';
        
        var isVid = m.media_type === 'video';
        if (isVid) {
            var vid = document.createElement('video');
            vid.src = m.media_url;
            vid.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
            mediaWrap.appendChild(vid);
            var playIcon = document.createElement('div');
            playIcon.innerHTML = '<i class="ri-play-circle-fill"></i>';
            playIcon.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-size:3rem; color:rgba(255,255,255,0.8); pointer-events:none;';
            mediaWrap.appendChild(playIcon);
        } else {
            var img = document.createElement('img');
            img.src = m.media_url;
            img.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
            mediaWrap.appendChild(img);
        }
        mediaWrap.onclick = function(e) { chatOpenViewer(isVid ? 'vid' : 'img', m.media_url); };
        contentContainer.appendChild(mediaWrap);
        
        if (m.text && m.text.trim().length > 0) {
            var caption = document.createElement('div');
            caption.className = 'wa-msg-text wa-msg-caption';
            caption.style.cssText = 'padding:6px 4px 20px 4px; font-size:0.95rem; line-height:1.3; word-wrap:break-word;';
            caption.textContent = m.text;
            contentContainer.appendChild(caption);
        }
    } else {
        var txt = document.createElement('div');
        txt.className = 'wa-msg-text';
        txt.style.cssText = 'font-size:0.95rem; line-height:1.3; word-wrap:break-word; padding-right:20px;';
        txt.textContent = m.text || '';
        contentContainer.appendChild(txt);
    }

    if (replyBlock) bubble.appendChild(replyBlock);
    bubble.appendChild(contentContainer);

    var footerHtml = document.createElement('div');
    footerHtml.className = 'wa-bubble-footer';
    footerHtml.style.cssText = 'display:flex; align-items:center; justify-content:flex-end; gap:3px; margin-left:auto; margin-top:4px;';
    
    if (m.media_url) {
        footerHtml.style.cssText = 'display:flex; align-items:center; justify-content:flex-end; gap:3px; position:absolute; bottom:8px; right:12px; z-index:5;';
    }
    
    var timeColor = m.media_url ? 'rgba(255,255,255,0.9)' : '';
    var tickColor = m.media_url ? (isSent && m.read ? '#53bdeb' : 'white') : '';
    
    var menuBtnStr = '<button class="wa-msg-menu-btn" style="background:none; border:none; color:' + (m.media_url ? 'white' : '#999') + '; font-size:1.2rem; padding:0 2px; cursor:pointer; margin-left:2px; text-shadow:' + (m.media_url ? '0 1px 2px rgba(0,0,0,0.5)' : 'none') + ';"><i class="ri-arrow-down-s-line"></i></button>';

    footerHtml.innerHTML = '<span class="wa-bubble-time" style="color:' + timeColor + '; text-shadow:' + (m.media_url ? '0 1px 2px rgba(0,0,0,0.5)' : 'none') + ';">' + timeStr + '</span>' + 
        (isSent ? (m.read ? '<i class="ri-check-double-line" style="color:' + (m.media_url ? '#53bdeb' : '#53bdeb') + ';font-size:0.85rem;text-shadow:' + (m.media_url ? '0 1px 2px rgba(0,0,0,0.5)' : 'none') + '"></i>' : '<i class="ri-check-line" style="color:' + tickColor + ';font-size:0.85rem;text-shadow:' + (m.media_url ? '0 1px 2px rgba(0,0,0,0.5)' : 'none') + '"></i>') : '') +
        menuBtnStr;

    if (m.media_url) {
        contentContainer.appendChild(footerHtml);
    } else {
        bubble.appendChild(footerHtml);
    }
    
    wrapper.appendChild(bubble);

    if (m.reactions && Object.keys(m.reactions).length > 0) {
        _renderReactions(m, wrapper);
    }

    setTimeout(function() {
        var btn = wrapper.querySelector('.wa-msg-menu-btn');
        if (btn) {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                _showWhatsAppDropdown(e, m, wrapper);
            };
        }
    }, 10);

    return wrapper;
}

function _showWhatsAppDropdown(e, m, wrapper) {
    var existing = document.querySelector('.wa-dropdown-menu');
    if (existing) {
        existing.remove();
        if (existing.dataset.msgId === m.id) return;
    }

    var menu = document.createElement('div');
    menu.className = 'wa-dropdown-menu';
    menu.dataset.msgId = m.id || '';
    // Estilo mÃƒÂ¡s WhatsApp: fondo blanco, sombra suave, bordes redondeados
    menu.style.cssText = 'position:fixed; background:white; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.2); z-index:10000; min-width:180px; overflow:hidden;';
    
    // 1. BARRA DE EMOJIS (DIRECTA)
    var emojiBar = document.createElement('div');
    emojiBar.style.cssText = 'display:flex; justify-content:space-around; padding:10px; border-bottom:1px solid #f0f0f0; background:#fcfcfc;';
    WA_EMOJIS.forEach(function(emoji) {
        var btn = document.createElement('button');
        btn.textContent = emoji;
        btn.style.cssText = 'font-size:1.6rem; background:none; border:none; cursor:pointer; padding:4px; transition:transform 0.1s;';
        btn.onclick = function(ev) {
            ev.stopPropagation();
            _addReaction(m, wrapper, emoji);
            menu.remove();
        };
        btn.onmouseover = function() { this.style.transform = 'scale(1.3)'; };
        btn.onmouseout = function() { this.style.transform = 'scale(1)'; };
        emojiBar.appendChild(btn);
    });
    menu.appendChild(emojiBar);

    // 2. OPCIONES
    var options = [
        { label: 'Responder', icon: 'ri-reply-line', fn: function() { _chatReply(m); } },
        { label: 'Reenviar', icon: 'ri-share-forward-line', fn: function() { _chatForward(m); } },
        { label: 'Eliminar', icon: 'ri-delete-bin-line', color: '#ef4444', fn: function() { _deleteMsg(m, wrapper); } }
    ];

    options.forEach(function(opt) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:12px 16px; font-size:1rem; color:' + (opt.color || '#333') + '; cursor:pointer; display:flex; align-items:center; gap:12px; transition:background 0.2s;';
        item.innerHTML = '<i class="' + opt.icon + '" style="font-size:1.2rem; opacity:0.8;"></i> ' + opt.label;
        item.onmouseover = function() { this.style.background = '#f5f5f5'; };
        item.onmouseout = function() { this.style.background = 'transparent'; };
        item.onclick = function(ev) {
            ev.stopPropagation();
            menu.remove();
            opt.fn();
        };
        menu.appendChild(item);
    });

    var rect = e.target.closest('button').getBoundingClientRect();
    var topPos = rect.bottom + 8;
    var leftPos = rect.left - 140;
    
    // Ajuste de pantalla
    if (topPos + 250 > window.innerHeight) topPos = rect.top - 250;
    if (leftPos < 10) leftPos = 10;
    if (leftPos + 200 > window.innerWidth) leftPos = window.innerWidth - 210;

    menu.style.top = topPos + 'px';
    menu.style.left = leftPos + 'px';

    document.body.appendChild(menu);

    setTimeout(function() {
        var closer = function(ev) {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('click', closer);
            }
        };
        document.addEventListener('click', closer);
    }, 10);
}

function _showEmojiBarPopup(m, wrapper) {
    var old = wrapper.querySelector('.wa-emoji-bar-popup');
    if (old) { old.remove(); return; }

    var bar = document.createElement('div');
    bar.className = 'wa-emoji-bar-popup';
    bar.style.cssText = 'position:absolute; display:flex; gap:4px; background:white; padding:6px 10px; border-radius:30px; box-shadow:0 4px 15px rgba(0,0,0,0.15); z-index:100; opacity:0; transition:opacity 0.2s; bottom:100%; right:0; margin-bottom:5px;';
    
    WA_EMOJIS.forEach(function(emoji) {
        var btn = document.createElement('button');
        btn.textContent = emoji;
        btn.style.cssText = 'font-size:1.5rem; background:none; border:none; cursor:pointer; padding:2px; transition:transform 0.1s;';
        btn.onclick = function(e) {
            e.stopPropagation();
            _addReaction(m, wrapper, emoji);
            bar.remove();
        };
        btn.onmouseover = function() { this.style.transform = 'scale(1.2)'; };
        btn.onmouseout = function() { this.style.transform = 'scale(1)'; };
        bar.appendChild(btn);
    });

    var bubble = wrapper.querySelector('.wa-bubble');
    if (bubble) {
        bubble.appendChild(bar);
        setTimeout(function() { bar.style.opacity = '1'; }, 10);
    }
}
async function _addReaction(m, wrapper, emoji) {
    var cu = typeof auth !== 'undefined' && auth.getCurrentUser ? auth.getCurrentUser() : null;
    if (!cu || typeof db === 'undefined' || !db.reactToMessage || !m.id) {
        console.error('[Chat] Missing data for reaction:', { hasCu: !!cu, hasDb: !!db, msgId: m?.id });
        return;
    }
    
    console.log('[Chat] Reacting to:', m.id, 'with:', emoji);

    // 1. Optimistic Update
    if (!m.reactions) m.reactions = {};
    if (!m.reactions[emoji]) m.reactions[emoji] = [];
    var idx = m.reactions[emoji].indexOf(cu.id);
    if (idx === -1) m.reactions[emoji].push(cu.id);
    else m.reactions[emoji].splice(idx, 1);
    
    _renderReactions(m, wrapper);

    // 2. Broadcast INMEDIATO (antes de la DB) para máxima velocidad
    if (chatMessagesSubscription) {
        console.log('[Realtime] Sending instant broadcast for:', m.id);
        chatMessagesSubscription.send({
            type: 'broadcast',
            event: 'reaction',
            payload: { msgId: m.id, reactions: m.reactions, sender: cu.id }
        });
    }

    // 3. Persistencia en DB
    try {
        var newReactions = await db.reactToMessage(m.id, cu.id, emoji);
        if (newReactions) {
            m.reactions = newReactions;
            _renderReactions(m, wrapper);
        }
    } catch(e) {
        console.error('[Chat] Error saving reaction:', e);
    }
}

function _renderReactions(m, wrapper) {
    console.log('[Chat] Rendering reactions for msg:', m.id, m.reactions);
    
    // 1. Encontrar el contenedor de contenido (donde estÃƒÂ¡ la foto o el texto)
    var content = wrapper.querySelector('.wa-media-wrap') || wrapper.querySelector('.wa-msg-text');
    var bubble = wrapper.querySelector('.wa-bubble');
    
    if (!bubble) return;

    // 2. Eliminar si ya existe para redibujar
    var old = wrapper.querySelector('.wa-reactions');
    if (old) old.remove();

    // 3. Si no hay reacciones, salir
    if (!m.reactions || Object.keys(m.reactions).length === 0) return;

    var hasData = false;
    Object.keys(m.reactions).forEach(function(k) { if(m.reactions[k].length > 0) hasData = true; });
    if (!hasData) return;

    // 4. Crear el contenedor de reacciones
    var display = document.createElement('div');
    display.className = 'wa-reactions';
    
    // ESTILO CRÃƒÂTICO: Si es foto, debe ser ABSOLUTO para estar "dentro" del contenedor visualmente
    if (m.media_url) {
        display.style.cssText = 'position:absolute; bottom:10px; left:12px; display:flex; gap:5px; z-index:100; pointer-events:none;';
    } else {
        display.style.cssText = 'display:flex; gap:4px; margin-top:4px; flex-wrap:wrap;';
    }

    // 5. Agregar las pÃƒÂ­ldoras
    Object.keys(m.reactions).forEach(function(em) {
        var users = m.reactions[em];
        if (users && users.length > 0) {
            var pill = document.createElement('div');
            // Fondo blanco con borde sutil y sombra para que resalte sobre cualquier imagen
            pill.style.cssText = 'background:white; border:1.5px solid #e9edef; border-radius:20px; padding:2px 8px; font-size:1rem; display:flex; align-items:center; gap:4px; box-shadow:0 2px 4px rgba(0,0,0,0.1);';
            pill.innerHTML = '<span>' + em + '</span>' + (users.length > 1 ? '<span style="font-size:0.8rem; font-weight:bold; color:#666;">' + users.length + '</span>' : '');
            display.appendChild(pill);
        }
    });

    // 6. Inyectar en el lugar correcto
    if (m.media_url) {
        // En fotos, inyectamos en el bubble (que tiene position:relative y envuelve a la foto)
        bubble.style.position = 'relative'; 
        bubble.appendChild(display);
    } else {
        bubble.appendChild(display);
    }
}

// ── Responder mensaje ──
function _chatReply(m) {
    var input = document.getElementById('chat-input');
    var bar = document.getElementById('chat-input-bar') || document.querySelector('.chat-input-bar');
    if (!bar || !input) return;
    var old = document.getElementById('wa-reply-preview');
    if (old) old.remove();
    var preview = document.createElement('div');
    preview.id = 'wa-reply-preview';
    preview.className = 'wa-reply-preview';
    var snippet = m.media_url ? (m.media_type === 'video' ? '\uD83C\uDF9E Video' : '\uD83D\uDCF7 Imagen') : (m.text || '').slice(0, 60);
    preview.innerHTML =
        '<div class="wa-reply-line"></div>' +
        '<div class="wa-reply-text">' + _escapeHtml(snippet) + '</div>' +
        '<button class="wa-reply-close" onclick="document.getElementById(\'wa-reply-preview\').remove()"><i class="ri-close-line"></i></button>';
    bar.insertBefore(preview, bar.firstChild);
    input.focus();
    window._chatReplyTo = m;
}

// ── Reenviar ──
function _chatForward(m) {
    var allUsers = window._chatAllContacts || [];
    var overlay = document.createElement('div');
    overlay.className = 'wa-forward-overlay';
    var snippet = m.media_url ? '\uD83D\uDCF7 Multimedia' : '\u201C' + (m.text||'').slice(0,40) + '\u2026\u201D';
    var listHtml = allUsers.length
        ? allUsers.map(function(u) {
            return '<label class="wa-forward-item"><input type="checkbox" value="' + u.id + '"> ' +
                   '<span class="wa-forward-avatar">' + (u.name||'?').charAt(0).toUpperCase() + '</span>' +
                   '<span>' + _escapeHtml(u.name||u.username||u.email||'Usuario') + '</span></label>';
          }).join('')
        : '<p style="color:#8896a4;padding:20px;text-align:center">No hay contactos disponibles</p>';
    overlay.innerHTML =
        '<div class="wa-forward-card">' +
          '<div class="wa-forward-header"><h4>\uD83D\uDD01 Reenviar mensaje</h4>' +
            '<button onclick="this.closest(\'.wa-forward-overlay\').remove()" class="wa-forward-close"><i class="ri-close-line"></i></button>' +
          '</div>' +
          '<div class="wa-forward-snippet">' + _escapeHtml(snippet) + '</div>' +
          '<div class="wa-forward-list">' + listHtml + '</div>' +
          '<button class="wa-forward-send" onclick="_doForward(this, \'' + (m.text||'') + '\', \'' + (m.media_url||'') + '\', \'' + (m.media_type||'') + '\')">Reenviar</button>' +
        '</div>';
    document.body.appendChild(overlay);
}

function _doForward(btn, text, mediaUrl, mediaType) {
    var checks = btn.closest('.wa-forward-card').querySelectorAll('input[type=checkbox]:checked');
    if (!checks.length) { if(typeof showQuickFeedback==='function') showQuickFeedback('\u26a0\uFE0F Seleccion\xe1 al menos un contacto'); return; }
    var cu = typeof auth!=='undefined' && auth.getCurrentUser ? auth.getCurrentUser() : null;
    if (!cu || typeof db==='undefined') return;
    checks.forEach(function(c) {
        db.sendMessage(cu.id, c.value, (mediaUrl ? (mediaType==='video'?'[video]':'[imagen]') : text) || '');
    });
    btn.closest('.wa-forward-overlay').remove();
    if(typeof showQuickFeedback==='function') showQuickFeedback('\u2705 Reenviado a ' + checks.length + ' contacto(s)');
}

// ── Eliminar ──
function _deleteMsg(m, wrapper) {
    if (!m.id) { wrapper.remove(); return; }
    if (typeof showWaConfirm === 'function') {
        showWaConfirm('Eliminar mensaje', '\xbfEliminarlo para todos?', 'ELIMINAR', true, function() {
            if (typeof db!=='undefined' && db.deleteMessage) {
                db.deleteMessage(m.id).then(function() { wrapper.remove(); });
            } else {
                wrapper.style.opacity = '0.3';
                wrapper.querySelector('.wa-bubble-text') && (wrapper.querySelector('.wa-bubble-text').textContent = 'Mensaje eliminado');
            }
        });
    } else {
        wrapper.remove();
    }
}

// ── Descargar media ──
function _downloadMedia(url) {
    var a = document.createElement('a');
    a.href = url; a.download = 'chat-media-' + Date.now();
    a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove();
}

// ── Compartir ──
function _shareMedia(url, text) {
    if (navigator.share) {
        navigator.share({ title: 'Solidaridad', text: text || '', url: url }).catch(function(){});
    } else {
        navigator.clipboard && navigator.clipboard.writeText(url);
        if(typeof showQuickFeedback==='function') showQuickFeedback('\uD83D\uDD17 Enlace copiado');
    }
}

// ── Visor de foto/video premium ──
function chatOpenViewer(type, src) {
    // _closeChatCtxMenu(); removed
    var ov = document.createElement('div');
    ov.className = 'wa-viewer-overlay';
    ov.innerHTML =
        '<div class="wa-viewer-topbar">' +
          '<button class="wa-viewer-btn" onclick="this.closest(\'.wa-viewer-overlay\').remove()">' +
            '<i class="ri-arrow-left-line"></i>' +
          '</button>' +
          '<span style="color:white;font-weight:600;flex:1;text-align:center">Vista previa</span>' +
          '<button class="wa-viewer-btn" onclick="_shareMedia(\'' + src + '\')"><i class="ri-share-line"></i></button>' +
          '<button class="wa-viewer-btn" onclick="_downloadMedia(\'' + src + '\')"><i class="ri-download-line"></i></button>' +
        '</div>' +
        '<div class="wa-viewer-body">' +
          (type === 'video'
            ? '<video src="' + src + '" controls autoplay playsinline class="wa-viewer-media"></video>'
            : '<img src="' + src + '" class="wa-viewer-media wa-viewer-img" id="wa-viewer-img" alt="">') +
        '</div>' +
        (type !== 'video' ? '<div class="wa-viewer-footer">' +
          '<button class="wa-viewer-action" onclick="waImgZoom(1)"><i class="ri-zoom-in-line"></i></button>' +
          '<button class="wa-viewer-action" onclick="waImgZoom(-1)"><i class="ri-zoom-out-line"></i></button>' +
          '<button class="wa-viewer-action" onclick="_downloadMedia(\'' + src + '\')"><i class="ri-download-2-line"></i></button>' +
          '<button class="wa-viewer-action" onclick="_shareMedia(\'' + src + '\')"><i class="ri-share-forward-line"></i></button>' +
        '</div>' : '');
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target===ov) ov.remove(); });
    setTimeout(function(){ ov.classList.add('wa-viewer-in'); }, 10);
}

// Alias para compatibilidad con llamadas previas
function chatZoomImg(src) { chatOpenViewer('img', src); }

var _viewerScale = 1;
function waImgZoom(dir) {
    _viewerScale = Math.min(4, Math.max(0.5, _viewerScale + dir * 0.5));
    var img = document.getElementById('wa-viewer-img');
    if (img) img.style.transform = 'scale(' + _viewerScale + ')';
}


// chatZoomImg → delegado a chatOpenViewer (definido arriba en el sistema WA)


function chatVideoCall() {
    if (!chatCurrentPartner) return;
    var me = (typeof auth !== 'undefined' && auth.getCurrentUser ? (auth.getCurrentUser() || {}).id : '') || 'anon';
    var roomId = 'solidaridad-' + [chatCurrentPartner, me].sort().join('-').slice(0, 24);
    var url = 'https://meet.jit.si/' + roomId;
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = '<div style="background:#1a2535;border-radius:20px;padding:32px 28px;max-width:360px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5)">' +
        '<div style="font-size:3rem;margin-bottom:12px">\uD83D\uDCF9</div>' +
        '<h3 style="color:#fff;margin:0 0 8px;font-size:1.1rem">Videollamada</h3>' +
        '<p style="color:#8896a4;font-size:0.85rem;margin:0 0 20px">Sala privada en Jitsi Meet.<br>Compartí el enlace con tu contacto.</p>' +
        '<a href="' + url + '" target="_blank" style="display:block;background:linear-gradient(135deg,#3DA3D4,#2E8BC0);color:#fff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:700;font-size:0.9rem;margin-bottom:12px" onclick="this.closest(\'div\').parentElement.remove()">\uD83C\uDF9E Abrir Videollamada</a>' +
        '<button onclick="this.closest(\'div\').parentElement.remove()" style="background:transparent;border:1px solid #3a4a5c;color:#8896a4;padding:10px 24px;border-radius:12px;cursor:pointer;font-size:0.85rem">Cancelar</button>' +
        '</div>';
    document.body.appendChild(overlay);
}

function toggleChatMenu() {
    var menu = document.getElementById('chat-more-menu');
    if(menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function closeChatMenu() {
    var menu = document.getElementById('chat-more-menu');
    if (menu) menu.style.display = 'none';
}

function blockChatUser() {
    closeChatMenu();
    var currentUser = typeof auth !== 'undefined' && auth.getCurrentUser ? auth.getCurrentUser() : null;
    if (!currentUser || !chatCurrentPartner) return;
    var myId = currentUser.id;
    if (typeof showWaConfirm === 'function') {
        if (typeof db !== 'undefined' && db.isUserBlocked) {
            db.isUserBlocked(myId, chatCurrentPartner).then(function(blocked) {
                showWaConfirm(
                    blocked ? '\xbfDesbloquear?' : '\xbfBloquear contacto?',
                    blocked ? 'Podr\xe1s volver a comunicarte.' : 'No podr\xe1 enviarte mensajes.',
                    blocked ? 'DESBLOQUEAR' : 'BLOQUEAR',
                    !blocked,
                    function() {
                        var fn = blocked ? db.unblockUser : db.blockUser;
                        fn(myId, chatCurrentPartner).then(function() {
                            if (typeof showQuickFeedback === 'function') showQuickFeedback(blocked ? '\u2705 Desbloqueado' : '\uD83D\uDEAB Bloqueado');
                            if (typeof checkBlockStatus === 'function') checkBlockStatus();
                        });
                    }
                );
            });
        }
    }
}


function handleChatFileUpload(input) {
    if (!input.files || input.files.length === 0) return;
    var currentUser = typeof auth !== 'undefined' && auth.getCurrentUser ? auth.getCurrentUser() : null;
    if (!currentUser || !chatCurrentPartner) {
        if (typeof showQuickFeedback === 'function') showQuickFeedback('Inici\xe1 sesi\xf3n para enviar archivos');
        return;
    }
    var msgContainer = document.getElementById('chat-messages');
    Array.from(input.files).forEach(function(file) {
        if (file.size > 20 * 1024 * 1024) {
            if (typeof showQuickFeedback === 'function') showQuickFeedback('\u26a0\uFE0F Archivo muy grande (m\xe1x 20MB)');
            return;
        }
        var isVideo = file.type.startsWith('video/');
        var loadDiv = document.createElement('div');
        loadDiv.className = 'chat-msg chat-msg-sent';
        var thumbHtml = isVideo
            ? '<div style="width:160px;height:90px;background:#1a2535;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:2.2rem">\uD83C\uDF9E</div>'
            : '<img src="' + URL.createObjectURL(file) + '" style="max-width:180px;max-height:180px;border-radius:10px;opacity:0.55;display:block">';
        loadDiv.innerHTML = thumbHtml + '<div class="chat-msg-meta"><span class="chat-msg-time">subiendo...</span><span class="chat-msg-status"><i class="ri-loader-4-line" style="animation:spin 1s linear infinite"></i></span></div>';
        if (msgContainer) { msgContainer.appendChild(loadDiv); msgContainer.scrollTop = msgContainer.scrollHeight; }
        if (typeof db !== 'undefined' && db.uploadChatMedia) {
            db.uploadChatMedia(currentUser.id, chatCurrentPartner, file).then(function(msg) {
                if (msg) {
                    var realDiv = renderChatMsg(msg, true);
                    if (loadDiv.parentNode) loadDiv.parentNode.replaceChild(realDiv, loadDiv);
                } else {
                    var errEl = loadDiv.querySelector('.chat-msg-time');
                    if (errEl) errEl.textContent = 'error al subir';
                    loadDiv.style.opacity = '0.4';
                    if (typeof showQuickFeedback === 'function') showQuickFeedback('\u274C Error al subir. Verific\xe1 el bucket "chat-media" en Supabase.');
                }
                if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
            });
        } else {
            if (loadDiv.parentNode) loadDiv.parentNode.removeChild(loadDiv);
            if (typeof showQuickFeedback === 'function') showQuickFeedback('\u26a0\uFE0F Supabase no disponible');
        }
    });
    input.value = '';
}

function updateChatBadges() {
    if (typeof auth === 'undefined' || !auth.isAuthenticated()) return;
    var currentUser = auth.getCurrentUser();
    if (!currentUser) return;
    
    if (typeof db !== 'undefined' && db.getUnreadCount) {
        db.getUnreadCount(currentUser.id).then(function(count) {
            var badge1 = document.getElementById('sidebar-msg-badge');
            var badge2 = document.getElementById('bottom-msg-badge');
            if (count > 0) {
                if(badge1) { badge1.textContent = count; badge1.style.display = 'inline-block'; }
                if(badge2) { badge2.textContent = count; badge2.style.display = 'inline-block'; }
            } else {
                if(badge1) badge1.style.display = 'none';
                if(badge2) badge2.style.display = 'none';
            }
        });
    }
}

// Hook into navigation or set interval
setInterval(updateChatBadges, 15000);
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(updateChatBadges, 2000);
    
    // We try to hook into app.navigate if it exists
    if (typeof app !== 'undefined' && app.navigate) {
        var originalNavigate = app.navigate;
        app.navigate = function(screenId) {
            originalNavigate.call(app, screenId);
            if (screenId === 'screen-mensajes') {
                loadChatContacts();
            }
        };
    }
});


// =========== JS GLOBAL SEARCH ===========
var chatGlobalSearchTimer = null;
window.filterMsgList = function(q) {
    q = (q || '').trim().toLowerCase();
    
    // 1. Filter existing local chats
    var listContainer = document.getElementById('msg-list-container');
    if (listContainer) {
        var items = listContainer.querySelectorAll('.msg-item:not(#global-search-results-container)');
        items.forEach(function(item) {
            var name = (item.querySelector('h4') ? item.querySelector('h4').textContent : '').toLowerCase();
            if (!q || name.indexOf(q) > -1) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }
    
    // 2. Global search
    var globalContainer = document.getElementById('global-search-results-container');
    if (!globalContainer) {
        globalContainer = document.createElement('div');
        globalContainer.id = 'global-search-results-container';
        globalContainer.style.marginTop = '10px';
        globalContainer.style.borderTop = '1px solid #e2e8f0';
        globalContainer.style.paddingTop = '10px';
        if (listContainer) listContainer.appendChild(globalContainer);
    }
    
    if (!q || q.length < 3) {
        globalContainer.innerHTML = '';
        return;
    }
    
    globalContainer.innerHTML = '<div style="text-align:center;padding:10px;color:#94a3b8;font-size:0.8rem;"><i class="ri-loader-4-line ri-spin"></i> Buscando usuarios globales...</div>';
    
    clearTimeout(chatGlobalSearchTimer);
    chatGlobalSearchTimer = setTimeout(async function() {
        if (!window.db || !window.db.searchUsersGlobal) return;
        var results = await window.db.searchUsersGlobal(q);
        
        if (results.length === 0) {
            globalContainer.innerHTML = '<div style="text-align:center;padding:10px;color:#94a3b8;font-size:0.8rem;">No se encontraron usuarios nuevos</div>';
            return;
        }
        
        var html = '<div style="font-size:0.75rem;font-weight:800;color:#64748b;text-transform:uppercase;margin-bottom:8px;padding-left:16px;">Descubrir Usuarios</div>';
        results.forEach(function(u) {
            var ini = u.nombre ? u.nombre.substring(0, 2).toUpperCase() : '??';
            var color = u.color || '#3498db';
            var avatarHtml = u.avatar_url 
                ? '<img src="' + u.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">' 
                : '<div style="width:100%;height:100%;border-radius:50%;background:'+color+';color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;">'+ini+'</div>';
                
            var uData = { id: u.id, name: u.nombre || 'Sin Nombre', color: color, avatar: u.avatar_url };
            
            html += '<div class="msg-item new-contact" onclick=\'openGlobalChat('+JSON.stringify(uData)+')\' style="background:#f8fafc;border:1px dashed #cbd5e1;">' +
                        '<div class="msg-avatar">' + avatarHtml + '</div>' +
                        '<div class="msg-content">' +
                            '<h4>' + (u.nombre || 'Sin Nombre') + ' <span style="font-size:0.65rem;background:#3b82f6;color:white;padding:2px 6px;border-radius:10px;margin-left:4px;vertical-align:middle;">Nuevo</span></h4>' +
                            '<p style="color:#3b82f6;font-size:0.8rem;"><i class="ri-chat-new-line"></i> Toca para iniciar chat</p>' +
                        '</div>' +
                    '</div>';
        });
        globalContainer.innerHTML = html;
    }, 500);
};

window.openGlobalChat = function(userObj) {
    // 1. Check if chat exists locally
    var existingId = null;
    for (var k in chatConversations) {
        if (chatConversations[k].otherUser && chatConversations[k].otherUser.id === userObj.id) {
            existingId = k; break;
        }
    }
    
    if (existingId) {
        openChat(existingId, chatConversations[existingId].otherUser.name, chatConversations[existingId].otherUser.color || '#e74c3c');
    } else {
        // Create an optimistic local conversation
        var tempId = 'temp_' + Date.now();
        chatConversations[tempId] = {
            id: tempId,
            otherUser: userObj,
            messages: [],
            unread: 0,
            lastActivity: new Date().toISOString()
        };
        openChat(tempId, userObj.name, userObj.color || '#e74c3c');
    }
    document.getElementById('msg-search-input').value = '';
    filterMsgList('');
};

function _escapeHtml(unsafe) {
    return (unsafe || '').toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
