// =============================================
// RED MARIA — Auth Module (auth.js)
// Professional-grade security system
// =============================================

var auth = {
    STORAGE_KEY: 'redmaria_users',
    SESSION_KEY: 'redmaria_session',
    ATTEMPTS_KEY: 'redmaria_login_attempts',

    // Security config
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 minutes
    SESSION_EXPIRY_MS: 24 * 60 * 60 * 1000, // 24 hours
    PBKDF2_ITERATIONS: 100000,

    // ---- Crypto: PBKDF2 Key Derivation with Salt ----
    async hashPassword(password, salt) {
        if (!salt) {
            const saltArray = new Uint8Array(16);
            crypto.getRandomValues(saltArray);
            salt = Array.from(saltArray, b => b.toString(16).padStart(2, '0')).join('');
        }
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
        );
        const derivedBits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: encoder.encode(salt), iterations: this.PBKDF2_ITERATIONS, hash: 'SHA-256' },
            keyMaterial, 256
        );
        const hash = Array.from(new Uint8Array(derivedBits), b => b.toString(16).padStart(2, '0')).join('');
        return { hash, salt };
    },

    // Legacy SHA-256 (for migrating old users)
    async hashPasswordLegacy(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    // ---- Token Generation ----
    generateSessionToken() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    },

    generateId() {
        const arr = new Uint8Array(12);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    },

    // ---- Storage Helpers ----
    getUsers() {
        try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || []; }
        catch { return []; }
    },

    saveUsers(users) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(users));
    },

    getSession() {
        try { return JSON.parse(localStorage.getItem(this.SESSION_KEY)); }
        catch { return null; }
    },

    saveSession(session) {
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    },

    clearSession() {
        localStorage.removeItem(this.SESSION_KEY);
    },

    // ---- Rate Limiting ----
    getLoginAttempts(email) {
        try {
            const data = JSON.parse(localStorage.getItem(this.ATTEMPTS_KEY)) || {};
            return data[email] || { count: 0, firstAttempt: 0, lockedUntil: 0 };
        } catch { return { count: 0, firstAttempt: 0, lockedUntil: 0 }; }
    },

    recordLoginAttempt(email, success) {
        const data = JSON.parse(localStorage.getItem(this.ATTEMPTS_KEY) || '{}');
        if (success) {
            delete data[email];
        } else {
            const now = Date.now();
            const current = data[email] || { count: 0, firstAttempt: now, lockedUntil: 0 };
            // Reset counter if window expired
            if (now - current.firstAttempt > this.LOCKOUT_DURATION_MS) {
                current.count = 1;
                current.firstAttempt = now;
                current.lockedUntil = 0;
            } else {
                current.count++;
            }
            if (current.count >= this.MAX_LOGIN_ATTEMPTS) {
                current.lockedUntil = now + this.LOCKOUT_DURATION_MS;
            }
            data[email] = current;
        }
        localStorage.setItem(this.ATTEMPTS_KEY, JSON.stringify(data));
    },

    isAccountLocked(email) {
        const attempts = this.getLoginAttempts(email);
        if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
            const remainingMin = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
            return { locked: true, remainingMin };
        }
        return { locked: false, remainingMin: 0 };
    },

    getRemainingAttempts(email) {
        const attempts = this.getLoginAttempts(email);
        return Math.max(0, this.MAX_LOGIN_ATTEMPTS - attempts.count);
    },

    // ---- Session Expiry ----
    isSessionValid() {
        const session = this.getSession();
        if (!session || !session.token || !session.userId) return false;
        if (!session.loginAt) return false;
        const elapsed = Date.now() - new Date(session.loginAt).getTime();
        if (elapsed > this.SESSION_EXPIRY_MS) {
            this.clearSession();
            return false;
        }
        return true;
    },

    refreshSession() {
        const session = this.getSession();
        if (session) {
            session.loginAt = new Date().toISOString();
            this.saveSession(session);
        }
    },

    // ---- Validators ----
    validators: {
        name(value) {
            const v = (value || '').trim();
            if (!v) return 'El nombre es obligatorio';
            if (v.length < 3) return 'El nombre debe tener al menos 3 caracteres';
            if (v.length > 60) return 'El nombre es demasiado largo';
            if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/.test(v)) return 'El nombre contiene caracteres no válidos';
            return '';
        },

        email(value) {
            const v = (value || '').trim();
            if (!v) return 'El email es obligatorio';
            const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
            if (!re.test(v)) return 'Ingresa un email válido';
            if (v.length > 254) return 'Email demasiado largo';
            // Block disposable email patterns
            const blocked = ['tempmail','throwaway','guerrilla','mailinator','yopmail','trashmail'];
            const domain = v.split('@')[1]?.toLowerCase();
            if (blocked.some(b => domain?.includes(b))) return 'No se permiten emails temporales';
            return '';
        },

        password(value) {
            const v = value || '';
            if (!v) return 'La contraseña es obligatoria';
            if (v.length < 8) return 'Mínimo 8 caracteres';
            if (v.length > 128) return 'Máximo 128 caracteres';
            if (!/[A-Z]/.test(v)) return 'Debe incluir al menos una mayúscula';
            if (!/[a-z]/.test(v)) return 'Debe incluir al menos una minúscula';
            if (!/[0-9]/.test(v)) return 'Debe incluir al menos un número';
            if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v)) return 'Debe incluir un carácter especial (!@#$%...)';
            // Check common weak passwords
            const weak = ['password','12345678','qwerty12','admin123','letmein1','welcome1','abc12345'];
            if (weak.includes(v.toLowerCase())) return 'Contraseña demasiado común';
            return '';
        },

        confirmPassword(value, password) {
            if (!value) return 'Confirma tu contraseña';
            if (value !== password) return 'Las contraseñas no coinciden';
            return '';
        },

        city(value) {
            const v = (value || '').trim();
            if (!v) return 'La ciudad es obligatoria';
            if (v.length < 2) return 'Ciudad muy corta';
            return '';
        }
    },

    // ---- Password Strength Meter ----
    getPasswordStrength(password) {
        if (!password) return { score: 0, label: '', className: '', checks: {} };

        const checks = {
            length: password.length >= 8,
            lengthBonus: password.length >= 12,
            upper: /[A-Z]/.test(password),
            lower: /[a-z]/.test(password),
            number: /[0-9]/.test(password),
            special: /[^A-Za-z0-9]/.test(password),
            noRepeat: !/(.)\1{2,}/.test(password),
            noSequence: !/(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i.test(password)
        };

        let score = 0;
        if (checks.length) score++;
        if (checks.lengthBonus) score++;
        if (checks.upper) score++;
        if (checks.lower) score++;
        if (checks.number) score++;
        if (checks.special) score++;
        if (checks.noRepeat) score++;
        if (checks.noSequence) score++;

        let label, className;
        if (score <= 3) { label = 'Débil'; className = 'strength-weak'; }
        else if (score <= 5) { label = 'Media'; className = 'strength-medium'; }
        else if (score <= 7) { label = 'Fuerte'; className = 'strength-strong'; }
        else { label = 'Muy Fuerte'; className = 'strength-very-strong'; }

        return { score: Math.min(4, Math.ceil(score / 2)), label, className, checks };
    },

    // ---- Sanitize Input ----
    sanitize(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // ---- Register ----
    async registerUser({ name, email, password, city }) {
        // Sanitize
        name = this.sanitize(name.trim());
        email = this.sanitize(email.trim().toLowerCase());
        city = this.sanitize(city.trim());

        // Check if email already exists locally
        const users = this.getUsers();
        if (users.find(u => u.email === email)) {
            return { success: false, error: 'Este email ya está registrado localmente' };
        }

        // IMPORTANT: Check if email already exists in Supabase to prevent profile hijacking
        if (typeof sbClient !== 'undefined' && sbClient) {
            try {
                const { data } = await sbClient.from('profiles').select('id').eq('email', email).single();
                if (data) {
                    return { success: false, error: 'Este email ya está registrado en la red. Usa otro o inicia sesión.' };
                }
            } catch(e) {}
        }

        // Hash password with salt (PBKDF2)
        const { hash, salt } = await this.hashPassword(password);

        // Create user object
        const user = {
            id: this.generateId(),
            name,
            email,
            password: hash,
            salt: salt,
            city,
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            rosariosCount: 0,
            devotion: 'Ntra. Sra. de Luján'
        };

        users.push(user);
        this.saveUsers(users);

        // ALWAYS create Supabase profile directly for chat
        if (typeof sbClient !== 'undefined' && sbClient) {
            var newUUID = crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,function(c){return(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)});
            sbClient.from('profiles').insert({
                id: newUUID,
                name: name,
                email: email,
                username: '@' + name.toLowerCase().replace(/\s+/g, '_')
            }).then(function(res) {
                if (res.error) {
                    console.warn('Profile insert error:', res.error.message);
                    // If username conflict, try with a suffix
                    if (res.error.message && res.error.message.includes('duplicate')) {
                        var newUUID2 = crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,function(c){return(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)});
                        sbClient.from('profiles').insert({
                            id: newUUID2,
                            name: name,
                            email: email,
                            username: '@' + name.toLowerCase().replace(/\s+/g, '_') + '_' + Math.floor(Math.random()*999)
                        }).then(function(r2) {
                            if (r2.error) console.warn('Profile retry error:', r2.error.message);
                            else console.log('✅ Perfil Supabase creado (retry)');
                        });
                    }
                } else {
                    console.log('✅ Perfil Supabase creado:', name, email);
                }
            });
        }

        // Auto-login after registration
        const token = this.generateSessionToken();
        this.saveSession({
            token,
            userId: user.id,
            email: user.email,
            name: user.name,
            city: user.city,
            loginAt: new Date().toISOString()
        });
        localStorage.removeItem('redmaria_cenaculos');
        return { success: true, user };
    },

    // ---- Login ----
    async loginUser(email, password) {
        email = email.trim().toLowerCase();

        // Rate limiting check
        const lockStatus = this.isAccountLocked(email);
        if (lockStatus.locked) {
            return { success: false, error: `Cuenta bloqueada temporalmente. Intenta de nuevo en ${lockStatus.remainingMin} minuto(s)`, locked: true };
        }

        const users = this.getUsers();
        const user = users.find(u => u.email === email);

        if (!user) {
            this.recordLoginAttempt(email, false);
            const remaining = this.getRemainingAttempts(email);
            return { success: false, error: 'Email o contraseña incorrectos', attemptsLeft: remaining };
        }

        // Check password - support both PBKDF2 (new) and SHA-256 (legacy)
        let passwordMatch = false;
        if (user.salt) {
            // PBKDF2 verification
            const { hash } = await this.hashPassword(password, user.salt);
            passwordMatch = (hash === user.password);
        } else {
            // Legacy SHA-256 verification + migrate to PBKDF2
            const legacyHash = await this.hashPasswordLegacy(password);
            passwordMatch = (legacyHash === user.password);
            if (passwordMatch) {
                // Migrate to PBKDF2
                const { hash, salt } = await this.hashPassword(password);
                user.password = hash;
                user.salt = salt;
                this.saveUsers(users);
                console.log('🔑 Password migrated to PBKDF2');
            }
        }

        if (!passwordMatch) {
            this.recordLoginAttempt(email, false);
            const remaining = this.getRemainingAttempts(email);
            const msg = remaining <= 2 && remaining > 0
                ? `Email o contraseña incorrectos (${remaining} intento${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''})`
                : 'Email o contraseña incorrectos';
            return { success: false, error: msg, attemptsLeft: remaining };
        }

        // Success - clear attempts
        this.recordLoginAttempt(email, true);

        // Update last login
        user.lastLogin = new Date().toISOString();
        this.saveUsers(users);

        const token = this.generateSessionToken();
        this.saveSession({
            token,
            userId: user.id,
            email: user.email,
            name: user.name,
            city: user.city,
            loginAt: new Date().toISOString()
        });

        // Ensure Supabase profile exists for chat (auto-create if missing)
        if (typeof sbClient !== 'undefined' && sbClient) {
            sbClient.from('profiles').select('id').eq('email', email).single().then(function(r) {
                if (!r.data) {
                    // Profile missing - create it
                    var newId = crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,function(c){return(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)});
                    sbClient.from('profiles').insert({
                        id: newId,
                        name: user.name,
                        email: email,
                        username: '@' + user.name.toLowerCase().replace(/\s+/g, '_')
                    }).then(function(ins) {
                        if (ins.error) console.warn('Profile create on login:', ins.error.message);
                        else console.log('✅ Perfil Supabase creado al hacer login');
                    });
                } else {
                    console.log('✅ Perfil Supabase existe:', r.data.id);
                }
            });
        }
        localStorage.removeItem('redmaria_cenaculos');
        return { success: true, user };
    },

    // ---- Logout ----
    logoutUser() {
        this.clearSession();
        localStorage.removeItem('redmaria_cenaculos');
        // Sync with Supabase
        if (typeof db !== 'undefined' && db.signOut) { db.signOut(); }
    },

    // ---- Session Checks ----
    isAuthenticated() {
        return this.isSessionValid();
    },

    getCurrentUser() {
        if (!this.isSessionValid()) return null;
        const session = this.getSession();
        if (!session) return null;

        const users = this.getUsers();
        const user = users.find(u => u.id === session.userId);
        if (!user) {
            this.clearSession();
            return null;
        }

        // Refresh session on activity
        this.refreshSession();

        // Return safe data (no password, no salt)
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            city: user.city,
            rosariosCount: user.rosariosCount,
            devotion: user.devotion,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
        };
    },

    // ---- Reset Password ----
    async resetPassword(email, newPassword) {
        const users = this.getUsers();
        const idx = users.findIndex(u => u.email === email);
        if (idx === -1) return { success: false, error: 'Usuario no encontrado' };
        const { hash, salt } = await this.hashPassword(newPassword);
        users[idx].password = hash;
        users[idx].salt = salt;
        this.saveUsers(users);
        // Clear any lockouts
        const attempts = JSON.parse(localStorage.getItem(this.ATTEMPTS_KEY) || '{}');
        delete attempts[email];
        localStorage.setItem(this.ATTEMPTS_KEY, JSON.stringify(attempts));
        return { success: true };
    },

    // ---- Protected Screens ----
    isProtected(screenId) {
        const publicScreens = [
            'screen-splash',
            'screen-anuncios',
            'screen-login',
            'screen-register',
            'screen-forgot-password',
            'screen-reset-password'
        ];
        
        if (screenId === 'screen-situacion-calle') {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('alerta')) {
                return false;
            }
        }
        
        return !publicScreens.includes(screenId);
    }
};

// =============================================
// AUTH UI CONTROLLER
// Handles form interactions and visual feedback
// =============================================

var authUI = {
    currentForm: 'register',

    init() {
        this.setupRegisterForm();
        this.setupLoginForm();
        this.setupPasswordToggles();
        this.setupPasswordStrength();
        this.setupRealTimeValidation();
        this.setupPasswordChecklist();
    },

    // ---- Register Form ----
    setupRegisterForm() {
        const form = document.getElementById('register-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            const confirmPw = document.getElementById('reg-confirm-password').value;
            const city = document.getElementById('reg-city').value;
            const tosCheck = document.getElementById('reg-tos');

            // Validate all fields
            const errors = {
                name: auth.validators.name(name),
                email: auth.validators.email(email),
                password: auth.validators.password(password),
                confirmPassword: auth.validators.confirmPassword(confirmPw, password),
                city: auth.validators.city(city)
            };

            // Show errors
            let hasErrors = false;
            for (const [field, error] of Object.entries(errors)) {
                const inputId = field === 'confirmPassword' ? 'reg-confirm-password' : `reg-${field}`;
                this.setFieldError(inputId, error);
                if (error) hasErrors = true;
            }

            // Terms check
            if (tosCheck && !tosCheck.checked) {
                const tosField = tosCheck.closest('.auth-tos');
                if (tosField) tosField.classList.add('has-error');
                hasErrors = true;
            }

            if (hasErrors) {
                this.shakeForm('register-form');
                return;
            }

            // Show loading
            const btn = form.querySelector('.btn-auth-submit');
            btn.classList.add('loading');
            btn.disabled = true;

            await new Promise(r => setTimeout(r, 600));

            const result = await auth.registerUser({ name, email, password, city });

            btn.classList.remove('loading');
            btn.disabled = false;

            if (result.success) {
                this.showSuccess('register-form', '¡Cuenta creada exitosamente!');
                setTimeout(() => {
                    app.onAuthSuccess();
                }, 1000);
            } else {
                this.setFieldError('reg-email', result.error);
                this.shakeForm('register-form');
            }
        });
    },

    // ---- Login Form ----
    setupLoginForm() {
        const form = document.getElementById('login-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            // Validate
            const emailError = auth.validators.email(email);
            const pwError = password ? '' : 'La contraseña es obligatoria';

            this.setFieldError('login-email', emailError);
            this.setFieldError('login-password', pwError);

            if (emailError || pwError) {
                this.shakeForm('login-form');
                return;
            }

            // Show loading
            const btn = form.querySelector('.btn-auth-submit');
            btn.classList.add('loading');
            btn.disabled = true;

            await new Promise(r => setTimeout(r, 600));

            const result = await auth.loginUser(email, password);

            btn.classList.remove('loading');
            btn.disabled = false;

            if (result.success) {
                this.showSuccess('login-form', '¡Bienvenido de vuelta!');
                setTimeout(() => {
                    app.onAuthSuccess();
                }, 1000);
            } else {
                // Show appropriate error
                if (result.locked) {
                    this.showFormError('login-form', result.error);
                    this.showLockoutTimer('login-form');
                } else {
                    this.showFormError('login-form', result.error);
                }
                this.shakeForm('login-form');
            }
        });
    },

    // ---- Lockout Timer Display ----
    showLockoutTimer(formId) {
        const form = document.getElementById(formId);
        if (!form) return;
        const btn = form.querySelector('.btn-auth-submit');
        if (!btn) return;
        btn.disabled = true;
        btn.classList.add('locked-out');

        const interval = setInterval(() => {
            const email = document.getElementById('login-email')?.value?.trim().toLowerCase();
            if (!email) { clearInterval(interval); btn.disabled = false; btn.classList.remove('locked-out'); return; }
            const lock = auth.isAccountLocked(email);
            if (!lock.locked) {
                clearInterval(interval);
                btn.disabled = false;
                btn.classList.remove('locked-out');
                const banner = form.querySelector('.form-error-banner');
                if (banner) banner.classList.remove('visible');
            }
        }, 5000);
    },

    // ---- Password Visibility Toggle ----
    setupPasswordToggles() {
        document.querySelectorAll('.toggle-password').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = btn.parentElement.querySelector('input');
                const icon = btn.querySelector('i');
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.className = 'ri-eye-off-line';
                } else {
                    input.type = 'password';
                    icon.className = 'ri-eye-line';
                }
            });
        });
    },

    // ---- Password Strength Meter ----
    setupPasswordStrength() {
        const pwInput = document.getElementById('reg-password');
        if (!pwInput) return;

        pwInput.addEventListener('input', () => {
            const strength = auth.getPasswordStrength(pwInput.value);
            const meter = document.getElementById('password-strength-meter');
            const label = document.getElementById('password-strength-label');
            
            if (meter) {
                meter.className = 'password-strength-meter';
                if (pwInput.value) {
                    meter.classList.add(strength.className);
                    meter.dataset.score = strength.score;
                }
            }
            if (label) {
                label.textContent = strength.label;
                label.className = 'password-strength-label ' + strength.className;
            }
        });
    },

    // ---- Password Requirement Checklist ----
    setupPasswordChecklist() {
        const pwInput = document.getElementById('reg-password');
        const checklist = document.getElementById('password-checklist');
        if (!pwInput || !checklist) return;

        pwInput.addEventListener('input', () => {
            const v = pwInput.value;
            const items = checklist.querySelectorAll('.pw-check-item');
            const checks = [
                v.length >= 8,
                /[A-Z]/.test(v),
                /[a-z]/.test(v),
                /[0-9]/.test(v),
                /[^A-Za-z0-9]/.test(v)
            ];
            items.forEach((item, i) => {
                if (checks[i]) { item.classList.add('passed'); item.classList.remove('failed'); }
                else { item.classList.remove('passed'); item.classList.add('failed'); }
            });
            if (v) { checklist.classList.add('visible'); }
            else { checklist.classList.remove('visible'); }
        });

        pwInput.addEventListener('focus', () => {
            if (pwInput.value) checklist.classList.add('visible');
        });
    },

    // ---- Real-time Validation ----
    setupRealTimeValidation() {
        const fields = [
            { id: 'reg-name', validator: 'name' },
            { id: 'reg-email', validator: 'email' },
            { id: 'reg-city', validator: 'city' }
        ];

        fields.forEach(({ id, validator }) => {
            const input = document.getElementById(id);
            if (!input) return;

            input.addEventListener('blur', () => {
                const error = auth.validators[validator](input.value);
                this.setFieldError(id, error);
            });

            input.addEventListener('input', () => {
                this.clearFieldError(id);
            });
        });

        // Confirm password real-time check
        const confirmPw = document.getElementById('reg-confirm-password');
        const pw = document.getElementById('reg-password');
        if (confirmPw && pw) {
            confirmPw.addEventListener('input', () => {
                if (confirmPw.value) {
                    const error = auth.validators.confirmPassword(confirmPw.value, pw.value);
                    this.setFieldError('reg-confirm-password', error);
                } else {
                    this.clearFieldError('reg-confirm-password');
                }
            });
        }
    },

    // ---- UI Feedback Helpers ----
    setFieldError(inputId, errorMsg) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const group = input.closest('.auth-field');
        if (!group) return;
        const errorEl = group.querySelector('.field-error');

        if (errorMsg) {
            group.classList.add('has-error');
            group.classList.remove('has-success');
            if (errorEl) errorEl.textContent = errorMsg;
        } else {
            group.classList.remove('has-error');
            if (input.value.trim()) {
                group.classList.add('has-success');
            }
            if (errorEl) errorEl.textContent = '';
        }
    },

    clearFieldError(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const group = input.closest('.auth-field');
        if (!group) return;
        group.classList.remove('has-error');
        const errorEl = group.querySelector('.field-error');
        if (errorEl) errorEl.textContent = '';
    },

    showFormError(formId, message) {
        const form = document.getElementById(formId);
        if (!form) return;
        let errorBanner = form.querySelector('.form-error-banner');
        if (!errorBanner) {
            errorBanner = document.createElement('div');
            errorBanner.className = 'form-error-banner';
            form.prepend(errorBanner);
        }
        errorBanner.innerHTML = `<i class="ri-error-warning-fill"></i> ${message}`;
        errorBanner.classList.add('visible');
        setTimeout(() => errorBanner.classList.remove('visible'), 6000);
    },

    showSuccess(formId, message) {
        const form = document.getElementById(formId);
        if (!form) return;
        let successBanner = form.querySelector('.form-success-banner');
        if (!successBanner) {
            successBanner = document.createElement('div');
            successBanner.className = 'form-success-banner';
            form.prepend(successBanner);
        }
        successBanner.innerHTML = `<i class="ri-checkbox-circle-fill"></i> ${message}`;
        successBanner.classList.add('visible');
    },

    shakeForm(formId) {
        const form = document.getElementById(formId);
        if (!form) return;
        form.classList.add('shake');
        setTimeout(() => form.classList.remove('shake'), 500);
    },

    // Switch between login/register views
    showRegister() {
        document.getElementById('auth-register-view')?.classList.add('active');
        document.getElementById('auth-login-view')?.classList.remove('active');
        this.currentForm = 'register';
    },

    showLogin() {
        document.getElementById('auth-login-view')?.classList.add('active');
        document.getElementById('auth-register-view')?.classList.remove('active');
        this.currentForm = 'login';
    }
};

// Ensure global access for inline onclick handlers
window.auth = auth;
window.authUI = authUI;
