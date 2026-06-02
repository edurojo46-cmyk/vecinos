// === SUPABASE CONFIG ===
var SUPABASE_URL = 'https://sqimiuwnhecspmugmacu.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxaW1pdXduaGVjc3BtdWdtYWN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzODg0NjMsImV4cCI6MjA5Mzk2NDQ2M30.Tq0VRRY7yfiubn6ZrInT_iAEogGr0e3R7oll0EPne_c';

// Initialize Supabase client (named sbClient to avoid conflict with window.supabase CDN)
var sbClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// === DATABASE SERVICE ===
var db = {

    // ==================== AUTH ====================
    async signUp(email, password, name) {
        if (!sbClient) return { error: 'Supabase no inicializado' };
        const { data, error } = await sbClient.auth.signUp({
            email,
            password,
            options: { data: { name: name, username: '@' + name.toLowerCase().replace(/\s+/g, '_') } }
        });
        if (!error && data.user) {
            await this.upsertProfile(data.user.id, name, email);
        }
        return { data, error };
    },

    async signIn(email, password) {
        if (!sbClient) return { error: 'Supabase no inicializado' };
        const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
        return { data, error };
    },

    async signOut() {
        if (!sbClient) return;
        await sbClient.auth.signOut();
    },

    async getUser() {
        if (!sbClient) return null;
        const { data } = await sbClient.auth.getUser();
        return data?.user || null;
    },

    async getSession() {
        if (!sbClient) return null;
        const { data } = await sbClient.auth.getSession();
        return data?.session || null;
    },

    // ==================== PROFILES ====================
    async upsertProfile(userId, name, email, avatarUrl) {
        if (!sbClient) return;
        const username = '@' + name.toLowerCase().replace(/\s+/g, '_');
        const payload = {
            id: userId,
            name: name,
            email: email,
            username: username,
            updated_at: new Date().toISOString()
        };
        if (avatarUrl) {
            payload.avatar_url = avatarUrl;
        }
        await sbClient.from('profiles').upsert(payload);
    },

    async updateProfileBio(userId, bio) {
        if (!sbClient) return;
        await sbClient.from('profiles').update({ bio: bio }).eq('id', userId);
    },

    async updateProfileLikes(userIdOrEmail, incrementAmount) {
        if (!sbClient) return;
        
        let profileMatch = sbClient.from('profiles').select('likes');
        if (userIdOrEmail.includes('@')) {
            profileMatch = profileMatch.eq('email', userIdOrEmail);
        } else {
            profileMatch = profileMatch.eq('id', userIdOrEmail);
        }
        
        const { data: profile } = await profileMatch.single();
        const currentLikes = profile && profile.likes ? parseInt(profile.likes, 10) : 0;
        const newLikes = currentLikes + incrementAmount;
        
        let updateMatch = sbClient.from('profiles').update({ likes: newLikes });
        if (userIdOrEmail.includes('@')) {
            updateMatch = updateMatch.eq('email', userIdOrEmail);
        } else {
            updateMatch = updateMatch.eq('id', userIdOrEmail);
        }
        await updateMatch;
        return newLikes;
    },

    async getProfile(userId) {
        if (!sbClient) return null;
        const { data } = await sbClient.from('profiles').select('*').eq('id', userId).single();
        return data;
    },

    async searchUsers(query) {
        if (!sbClient) return [];
        const { data } = await sbClient.from('profiles')
            .select('id, name, username, email')
            .or(`username.ilike.%${query}%,name.ilike.%${query}%`)
            .limit(10);
        return data || [];
    },

    async getProfileByEmail(email) {
        if (!sbClient) return null;
        const { data } = await sbClient.from('profiles')
            .select('*')
            .eq('email', email)
            .order('updated_at', { ascending: false })
            .limit(1);
        return (data && data.length > 0) ? data[0] : null;
    },

    // ==================== ROSARIOS ====================
    async createRosary(rosary) {
        if (!sbClient) { saveLocal('rosaries', rosary); return rosary; }
        // Don't send 'id' if it's not a valid UUID — let Supabase generate it
        var payload = Object.assign({}, rosary);
        if (payload.id && !/^[0-9a-f]{8}-/.test(payload.id)) {
            delete payload.id; // Remove non-UUID id, let DB auto-generate
        }
        // Remove creator_id if null/undefined to avoid FK constraint issues
        if (!payload.creator_id) {
            delete payload.creator_id;
        }
        console.log('[DB] Creating rosary with payload:', JSON.stringify(payload));
        const { data, error } = await sbClient.from('rosaries').insert(payload).select().single();
        if (error) {
            console.error('[DB] Error creating rosary:', error.message, '| Details:', error.details, '| Hint:', error.hint, '| Code:', error.code);
            saveLocal('rosaries', rosary);
            return rosary;
        }
        console.log('[DB] Rosary created successfully:', data.id);
        return data;
    },

    async getRosaries() {
        if (!sbClient) { console.warn('[DB] No sbClient, using local'); return getLocal('rosaries'); }
        const { data, error } = await sbClient.from('rosaries')
            .select('*')
            .gte('date', new Date().toISOString().split('T')[0])
            .order('date', { ascending: true });
            
        if (error) { console.error('[DB] Error loading rosaries:', error.message, error); return getLocal('rosaries'); }
        
        // Filter out rosaries that are older than 10 hours from their scheduled start time
        var filteredData = [];
        if (data) {
            var now = new Date();
            for (var i = 0; i < data.length; i++) {
                var r = data[i];
                if (r.date && r.time) {
                    var rosaryTime = new Date(r.date + 'T' + r.time);
                    var diffHours = (now - rosaryTime) / (1000 * 60 * 60);
                    // If it's been more than 10 hours since the start time, skip it
                    if (diffHours > 10) {
                        continue;
                    }
                }
                filteredData.push(r);
            }
        }
        
        console.log('[DB] Rosaries from Supabase:', filteredData.length);
        return filteredData;
    },

    async deleteRosary(rosaryId) {
        if (!sbClient) return;
        console.log('[DB] Deleting rosary:', rosaryId);
        // First delete participants
        await sbClient.from('rosary_participants').delete().eq('rosary_id', rosaryId);
        // Then delete the rosary
        const { error } = await sbClient.from('rosaries').delete().eq('id', rosaryId);
        if (error) console.error('[DB] Error deleting rosary:', error.message);
        else console.log('[DB] Rosary deleted:', rosaryId);
    },

    async joinRosary(rosaryId, userId) {
        if (!sbClient) return;
        console.log('[DB] Joining rosary:', rosaryId, 'user:', userId);
        const { error } = await sbClient.from('rosary_participants').upsert({
            rosary_id: rosaryId,
            user_id: userId,
            joined_at: new Date().toISOString()
        }, { onConflict: 'rosary_id,user_id' });
        if (error) {
            console.error('[DB] Error joining rosary:', error.message, '| Code:', error.code, '| Details:', error.details);
        } else {
            console.log('[DB] Successfully joined rosary');
        }
        // Increment participant count
        try { await sbClient.rpc('increment_participants', { row_id: rosaryId }); } catch(e) {}
    },

    async leaveRosary(rosaryId, userId) {
        if (!sbClient) return;
        const { error } = await sbClient.from('rosary_participants')
            .delete()
            .eq('rosary_id', rosaryId)
            .eq('user_id', userId);
        if (error) console.error('[DB] Error leaving rosary:', error.message);
        try { await sbClient.rpc('decrement_participants', { row_id: rosaryId }); } catch(e) {}
    },

    async getParticipants(rosaryId) {
        if (!sbClient) return [];
        console.log('[DB] Fetching participants for rosary:', rosaryId);
        // Get participant user_ids
        const { data, error } = await sbClient.from('rosary_participants')
            .select('user_id, joined_at')
            .eq('rosary_id', rosaryId)
            .order('joined_at', { ascending: true });
        if (error) {
            console.error('[DB] Error fetching participants:', error.message, '| Code:', error.code);
            return [];
        }
        if (!data || data.length === 0) return [];
        console.log('[DB] Found', data.length, 'participants');

        // Fetch names from profiles
        var userIds = data.map(function(p) { return p.user_id; });
        var profiles = {};
        try {
            const { data: profileData } = await sbClient.from('profiles')
                .select('id, name')
                .in('id', userIds);
            if (profileData) {
                profileData.forEach(function(pr) { profiles[pr.id] = pr.name; });
            }
        } catch(e) { console.warn('[DB] Could not fetch profile names:', e.message); }

        return data.map(function(p) {
            return { id: p.user_id, name: profiles[p.user_id] || 'Anónimo', role: 'participante' };
        });
    },

    // ==================== ROSARIO CONTINUO ====================
    async getContinuoSlots(dateKey) {
        if (!sbClient) return {};
        const { data, error } = await sbClient.from('continuo_slots')
            .select('hour, user_name')
            .eq('date', dateKey)
            .order('hour', { ascending: true });
        if (error) { console.error('[DB] Error loading continuo:', error.message); return {}; }
        // Convert to { hour: [name1, name2, ...] }
        var slots = {};
        (data || []).forEach(function(row) {
            if (!slots[row.hour]) slots[row.hour] = [];
            if (!slots[row.hour].includes(row.user_name)) slots[row.hour].push(row.user_name);
        });
        console.log('[DB] Continuo slots for', dateKey, ':', Object.keys(slots).length, 'hours with', (data||[]).length, 'entries');
        return slots;
    },

    async addContinuoSlot(dateKey, hour, userName) {
        if (!sbClient) return;
        // Check if already signed up (avoid duplicates)
        var { data: existing } = await sbClient.from('continuo_slots')
            .select('id')
            .eq('date', dateKey)
            .eq('hour', hour)
            .eq('user_name', userName)
            .limit(1);
        if (existing && existing.length > 0) {
            console.log('[DB] Already signed up for this slot');
            return;
        }
        // Insert new slot
        const { error } = await sbClient.from('continuo_slots')
            .insert({ date: dateKey, hour: hour, user_name: userName });
        if (error) console.error('[DB] Error adding continuo slot:', error.message);
        else console.log('[DB] Added continuo slot:', dateKey, hour, userName);
    },

    async removeContinuoSlot(dateKey, hour, userName) {
        if (!sbClient) return;
        const { error } = await sbClient.from('continuo_slots')
            .delete()
            .eq('date', dateKey)
            .eq('hour', hour)
            .eq('user_name', userName);
        if (error) console.error('[DB] Error removing continuo slot:', error.message);
        else console.log('[DB] Removed continuo slot:', dateKey, hour);
    },

    // ==================== CENACULOS ====================
    async createCenaculo(cenaculo) {
        if (!sbClient) { saveLocal('cenaculos', cenaculo); return cenaculo; }
        // Build payload - don't send non-UUID ids (let Supabase generate)
        var payload = {
            name: cenaculo.name,
            access: cenaculo.access,
            color: cenaculo.color,
            icon: cenaculo.icon,
            lat: cenaculo.lat || null,
            lng: cenaculo.lng || null
        };
        // Only include id if it's a valid UUID
        if (cenaculo.id && /^[0-9a-f]{8}-/.test(cenaculo.id)) {
            payload.id = cenaculo.id;
        }
        // Only include creator_id if it's a valid UUID (avoid FK constraint)
        if (cenaculo.creatorId && /^[0-9a-f]{8}-/.test(cenaculo.creatorId)) {
            payload.creator_id = cenaculo.creatorId;
        }
        console.log('[DB] Creating cenaculo:', payload.name, 'creator:', payload.creator_id || 'auto');
        const { data, error } = await sbClient.from('cenaculos').insert(payload).select().single();
        if (error) { console.error('[DB] Error creating cenaculo:', error.message, error.details, error.hint); saveLocal('cenaculos', cenaculo); return cenaculo; }
        console.log('[DB] Cenaculo created:', data.id, data.name);

        // Add members
        if (cenaculo.members) {
            for (const m of cenaculo.members) {
                var memberPayload = {
                    cenaculo_id: data.id,
                    name: m.name,
                    role: m.role
                };
                // Only include user_id if it's a valid UUID
                if (m.profileId && /^[0-9a-f]{8}-/.test(m.profileId)) {
                    memberPayload.user_id = m.profileId;
                }
                if (m.username) memberPayload.username = m.username;
                await sbClient.from('cenaculo_members').insert(memberPayload);
            }
        }
        return data;
    },

    async getCenaculos(userId) {
        if (!sbClient) return getLocal('cenaculos');
        try {
            // Try join query first — fetch ALL cenaculos, frontend filters by membership
            const { data, error } = await sbClient.from('cenaculos')
                .select('*, cenaculo_members(*)')
                .order('created_at', { ascending: false });
            if (!error && data) {
                console.log('[DB] Cenaculos from Supabase:', data.length);
                return data;
            }
            console.warn('[DB] Join query failed:', error?.message);
        } catch(e) { console.warn('[DB] Join query exception:', e.message); }
        // Fallback: separate queries
        const { data: cenaculos, error: listErr } = await sbClient.from('cenaculos')
            .select('*')
            .order('created_at', { ascending: false });
        if (listErr) { console.error('[DB] Error listing cenaculos:', listErr.message); return []; }
        if (!cenaculos) return [];
        for (const c of cenaculos) {
            const { data: members } = await sbClient.from('cenaculo_members')
                .select('*')
                .eq('cenaculo_id', c.id);
            c.cenaculo_members = members || [];
        }
        console.log('[DB] Cenaculos (fallback):', cenaculos.length);
        return cenaculos;
    },

    async addCenaculoMember(cenaculoId, username, name) {
        if (!sbClient) return;
        // Try to find user's profile to link user_id
        var memberPayload = {
            cenaculo_id: cenaculoId,
            username: username,
            name: name,
            role: 'miembro'
        };
        // Search by name to get the real user_id
        try {
            var { data: profiles } = await sbClient.from('profiles')
                .select('id, name, username')
                .ilike('name', name)
                .limit(1);
            if (profiles && profiles.length > 0) {
                memberPayload.user_id = profiles[0].id;
                console.log('[DB] Found user_id for member:', name, '->', profiles[0].id);
            }
        } catch(e) { console.warn('[DB] Profile lookup failed for member:', e.message); }
        var { error } = await sbClient.from('cenaculo_members').insert(memberPayload);
        if (error) console.error('[DB] Error adding cenaculo member:', error.message, error.details);
        else console.log('[DB] Cenaculo member added:', name);
    },

    async leaveCenaculoDb(cenaculoId, userId) {
        if (!sbClient) return;
        await sbClient.from('cenaculo_members')
            .delete()
            .eq('cenaculo_id', cenaculoId)
            .eq('user_id', userId);
    },

    // ==================== INTENCIONES ====================
    async createIntencion(intencion) {
        if (!sbClient) return null;
        
        // Supabase requires a valid UUID
        function uuidv4() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }

        const payload = {
            id: uuidv4(),
            text: intencion.text,
            user_name: intencion.user_name || 'Anónimo'
        };
        // Only include user_id if it's a valid UUID
        if (intencion.user_id && /^[0-9a-f]{8}-/.test(intencion.user_id)) {
            payload.user_id = intencion.user_id;
        }
        
        let { data, error } = await sbClient.from('intenciones').insert(payload).select();
        
        // If it failed because of missing user_name column (schema mismatch), try category instead
        if (error && error.message && error.message.toLowerCase().includes('column')) {
            delete payload.user_name;
            payload.category = intencion.user_name || 'Anónimo';
            const retry = await sbClient.from('intenciones').insert(payload).select();
            data = retry.data;
            error = retry.error;
        }

        if (error) {
            console.error('[DB] Error inserting intencion:', error.message, error.details);
            return null;
        }
        return data;
    },

    async getIntenciones() {
        if (!sbClient) return [];
        let query = sbClient.from('intenciones')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);
        
        const { data, error } = await query;
        if (error) { console.error('[DB] Error fetching intenciones:', error); return []; }
        return data || [];
    },

    async updateIntencionHearts(id, currentHearts, increment) {
        if (!sbClient || !id) return false;
        const newHearts = Math.max(0, currentHearts + increment);
        const { error } = await sbClient.from('intenciones')
            .update({ hearts: newHearts })
            .eq('id', id);
        if (error) { console.error('[DB] Error updating hearts:', error); return false; }
        return true;
    },

    async deleteAllIntenciones() {
        if (!sbClient) return;
        const { error } = await sbClient.from('intenciones').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) console.error('[DB] Error deleting intenciones:', error);
        else console.log('[DB] All intenciones deleted');
    },

    // ==================== MENSAJES (REAL) ====================
        async getMessageById(id) {
        if (!sbClient) return null;
        const { data } = await sbClient.from('messages').select('*').eq('id', id).single();
        return data;
    },
    async sendMessage(fromId, toId, text, replyTo) {
        if (!sbClient) return null;
        
        // Verificar si alguno de los dos está bloqueado
        const blocked = await this.isUserBlocked(fromId, toId);
        if (blocked) {
            console.warn('[Chat] No se puede enviar: Usuario bloqueado');
            return null;
        }

        const payload = {
            from_id: fromId,
            to_id: toId,
            text: text
        };
        if (replyTo) payload.reply_to = replyTo;
        
        const { data, error } = await sbClient.from('messages').insert(payload).select().single();
        if (error) { console.error('Error sending message:', error); return null; }
        return data;
    },

    async blockUser(myId, partnerId) {
        if (!sbClient) return { error: 'No client' };
        console.log('[DB] Blocking:', myId, '->', partnerId);
        const { data, error } = await sbClient.from('blocked_users').insert([{ user_id: myId, blocked_id: partnerId }]);
        if (error) console.error('[DB] Block error:', error.message);
        return { data, error };
    },
    async unblockUser(myId, partnerId) {
        if (!sbClient) return { error: 'No client' };
        console.log('[DB] Unblocking:', myId, '->', partnerId);
        const { data, error } = await sbClient.from('blocked_users').delete().match({ user_id: myId, blocked_id: partnerId });
        if (error) console.error('[DB] Unblock error:', error.message);
        return { data, error };
    },
    async isUserBlocked(myId, partnerId) {
        if (!sbClient) return false;
        const { data, error } = await sbClient.from('blocked_users').select('*').or('and(user_id.eq.' + myId + ',blocked_id.eq.' + partnerId + '),and(user_id.eq.' + partnerId + ',blocked_id.eq.' + myId + ')');
        if (error) {
            console.error('[DB] isUserBlocked error:', error.message);
            return false;
        }
        return data && data.length > 0;
    },

    async getConversations(userId) {
        if (!sbClient) return [];
        // Get all messages involving this user, ordered by most recent
        const { data, error } = await sbClient.from('messages')
            .select('*')
            .or(`from_id.eq.${userId},to_id.eq.${userId}`)
            .order('created_at', { ascending: false });
        if (error) { console.error('Error getting conversations:', error); return []; }
        if (!data || data.length === 0) return [];

        // Group by conversation partner
        var convMap = {};
        data.forEach(function(msg) {
            var partnerId = msg.from_id === userId ? msg.to_id : msg.from_id;
            if (!convMap[partnerId]) {
                convMap[partnerId] = {
                    partnerId: partnerId,
                    lastMessage: msg,
                    unreadCount: 0
                };
            }
            if (msg.to_id === userId && !msg.read) {
                convMap[partnerId].unreadCount++;
            }
        });
        return Object.values(convMap);
    },

    async getConversationMessages(userId, partnerId) {
        if (!sbClient) return [];
        const { data, error } = await sbClient.from('messages')
            .select('*')
            .or(`and(from_id.eq.${userId},to_id.eq.${partnerId}),and(from_id.eq.${partnerId},to_id.eq.${userId})`)
            .order('created_at', { ascending: true });
        if (error) { console.error('Error getting messages:', error); return []; }
        return data || [];
    },

    async markConversationAsRead(userId, partnerId) {
        if (!sbClient) return;
        await sbClient.from('messages')
            .update({ read: true })
            .eq('from_id', partnerId)
            .eq('to_id', userId)
            .eq('read', false);
    },

    async resolveUserUuid(userId) {
        if (!userId) return null;
        var isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
        if (isUUID) return userId;
        
        var cacheKey = 'redmaria_sb_uuid_' + userId;
        var cached = localStorage.getItem(cacheKey);
        if (cached) return cached;
        
        if (typeof auth !== 'undefined' && auth.getCurrentUser) {
            var cu = auth.getCurrentUser();
            if (cu && cu.email) {
                try {
                    const { data } = await sbClient.from('profiles').select('id').eq('email', cu.email).single();
                    if (data && data.id) {
                        localStorage.setItem(cacheKey, data.id);
                        return data.id;
                    } else {
                        // PROFILE MISSING - AUTO CREATE IN SUPABASE!
                        var newId = crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,function(c){return(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)});
                        const { error } = await sbClient.from('profiles').insert({
                            id: newId,
                            name: cu.name || cu.email.split('@')[0],
                            email: cu.email,
                            username: '@' + (cu.name || cu.email.split('@')[0]).toLowerCase().replace(/\s+/g, '_')
                        });
                        if (!error) {
                            localStorage.setItem(cacheKey, newId);
                            console.log('[DB] Perfil creado automáticamente en Supabase para:', cu.email);
                            return newId;
                        } else {
                            console.error('[DB] Falló auto-creación de perfil:', error.message);
                        }
                    }
                } catch(e) {
                    console.error('[DB] Error resolviendo UUID:', e);
                }
            }
        }
        return null;
    },


    async getUnreadCount(userId) {
        if (!sbClient) return 0;
        try {
            var realUuid = await this.resolveUserUuid(userId);
            if (!realUuid) return 0;
            const { count, error } = await sbClient.from('messages')
                .select('*', { count: 'exact', head: true })
                .eq('to_id', realUuid)
                .eq('read', false);
            if (error) return 0;
            return count || 0;
        } catch(e) { return 0; }
    },

    async getAllUsers() {
        if (!sbClient) return [];
        const { data } = await sbClient.from('profiles')
            .select('id, name, username, email')
            .order('name', { ascending: true });
        return data || [];
    },

    subscribeToMessages(room, callback) {
        if (!sbClient) return null;
        // El room viene como "id1_id2" (usamos guión bajo porque los UUID tienen guiones)
        var ids = room.split('_');
        var channel = sbClient.channel('chat-room-' + room, {
            config: {
                broadcast: { self: true },
                presence: { key: room }
            }
        });
        
        console.log('[Realtime] Subscribing to room:', room);

        return channel
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'messages'
            }, function(payload) {
                var m = payload.new;
                if (!m) return;
                if ((ids.indexOf(m.from_id) !== -1) && (ids.indexOf(m.to_id) !== -1)) {
                    callback(m, payload.eventType, null);
                }
            })
            .on('broadcast', { event: 'reaction' }, function(payload) {
                console.log('[Realtime] Broadcast received in supabase.js:', payload);
                callback(null, 'BROADCAST', payload);
            })
            .subscribe(function(status) {
                console.log('[Realtime] Room', room, 'status:', status);
                // Notificamos el estado inicial al callback
                if (status === 'SUBSCRIBED') {
                    callback(null, 'CONNECTED', null);
                }
            });
    },

    // ==================== CHAT MEDIA UPLOAD ====================
    async uploadChatMedia(fromId, toId, file) {
        if (!sbClient) return null;
        const ext = file.name.split('.').pop().toLowerCase();
        const isVideo = file.type.startsWith('video/');
        const bucket = 'chat-media';
        const path = `${fromId}/${toId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await sbClient.storage.from(bucket).upload(path, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type
        });
        if (upErr) {
            console.error('[Chat] Upload error:', upErr.message);
            return null;
        }
        const { data: urlData } = sbClient.storage.from(bucket).getPublicUrl(path);
        const mediaUrl = urlData?.publicUrl || null;
        if (!mediaUrl) return null;
        const msgText = isVideo ? '[video]' : '[imagen]';
        const { data, error } = await sbClient.from('messages').insert({
            from_id: fromId,
            to_id: toId,
            text: msgText,
            media_url: mediaUrl,
            media_type: isVideo ? 'video' : 'image'
        }).select().single();
        if (error) { console.error('[Chat] Media message insert error:', error.message); return null; }
        return data;
    },
    async reactToMessage(msgId, userId, emoji) {
        if (!sbClient) return null;
        try {
            const { data, error } = await sbClient.from('messages').select('reactions').eq('id', msgId).single();
            if (error) return null;
            let reactions = data.reactions || {};
            if (!reactions[emoji]) reactions[emoji] = [];
            const idx = reactions[emoji].indexOf(userId);
            if (idx !== -1) {
                reactions[emoji].splice(idx, 1);
                if (reactions[emoji].length === 0) delete reactions[emoji];
            } else {
                reactions[emoji].push(userId);
            }
            await sbClient.from('messages').update({ reactions: reactions }).eq('id', msgId);
            return reactions;
        } catch (e) {
            console.error('[Chat] React error:', e);
            return null;
        }
    },
    // ==================== ANUNCIOS ====================
    async createAnuncio(anuncio) {
        if (!sbClient) { saveLocal('anuncios', anuncio); return anuncio; }
        let payload = Object.assign({}, anuncio);
        // Remove non-UUID id so Supabase auto-generates
        if (payload.id && !/^[0-9a-f]{8}-/.test(payload.id)) delete payload.id;
        // Remove creator_id if not a valid UUID
        if (payload.creator_id && !/^[0-9a-f]{8}-/.test(payload.creator_id)) delete payload.creator_id;
        const { data, error } = await sbClient.from('anuncios').insert(payload).select().single();
        if (error) {
            console.error('[DB] Error inserting anuncio:', error.message);
            saveLocal('anuncios', anuncio);
            return anuncio;
        }
        return data;
    },

    async getAnuncios() {
        if (!sbClient) return getLocal('anuncios');
        const { data, error } = await sbClient.from('anuncios')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) {
            console.error('[DB] Error fetching anuncios:', error.message);
            return getLocal('anuncios');
        }
        return data || [];
    },

    async uploadAnuncioMedia(file) {
        if (!sbClient) return null;
        const ext = file.name.split('.').pop().toLowerCase();
        const path = 'anuncios/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.' + ext;
        const { error: upErr } = await sbClient.storage.from('chat-media').upload(path, file, {
            cacheControl: '3600', upsert: false, contentType: file.type
        });
        if (upErr) { console.error('[Anuncios] Upload error:', upErr.message); return null; }
        const { data: urlData } = sbClient.storage.from('chat-media').getPublicUrl(path);
        return urlData?.publicUrl || null;
    },

    // Incremento atómico de reacción (usando la función SQL)
    async reactAnuncio(anuncioId, emoji) {
        if (!sbClient) return null;
        const { data, error } = await sbClient.rpc('increment_reaction', {
            p_anuncio_id: anuncioId,
            p_emoji: emoji
        });
        if (error) {
            console.warn('[Reactions] RPC error, fallback to upsert:', error.message);
            // Fallback manual si la función SQL no existe aún
            const { data: existing } = await sbClient
                .from('anuncio_reactions')
                .select('count')
                .eq('anuncio_id', anuncioId)
                .eq('emoji', emoji)
                .single();
            const newCount = (existing?.count || 0) + 1;
            await sbClient.from('anuncio_reactions').upsert({
                anuncio_id: anuncioId, emoji, count: newCount, updated_at: new Date().toISOString()
            }, { onConflict: 'anuncio_id,emoji' });
            return newCount;
        }
        return data;
    },
    async unreactAnuncio(anuncioId, emoji) {
        if (!sbClient) return null;
        const { data, error } = await sbClient.rpc('decrement_reaction', {
            p_anuncio_id: anuncioId,
            p_emoji: emoji
        });
        if (error) {
            console.warn('[Reactions] Decrement RPC error, fallback:', error.message);
            const { data: existing } = await sbClient
                .from('anuncio_reactions')
                .select('count')
                .eq('anuncio_id', anuncioId)
                .eq('emoji', emoji)
                .single();
            const newCount = Math.max(0, (existing?.count || 1) - 1);
            await sbClient.from('anuncio_reactions').upsert({
                anuncio_id: anuncioId, emoji, count: newCount, updated_at: new Date().toISOString()
            }, { onConflict: 'anuncio_id,emoji' });
            return newCount;
        }
        return data;
    },

    // Fetch inicial: devuelve mapa { [anuncioId]: { [emoji]: count } }
    async getAnuncioReactions(anuncioIds) {
        if (!sbClient || !anuncioIds || anuncioIds.length === 0) return {};
        const { data, error } = await sbClient
            .from('anuncio_reactions')
            .select('anuncio_id, emoji, count')
            .in('anuncio_id', anuncioIds);
        if (error) { console.warn('[Reactions] Fetch error:', error.message); return {}; }
        const map = {};
        (data || []).forEach(row => {
            if (!map[row.anuncio_id]) map[row.anuncio_id] = {};
            map[row.anuncio_id][row.emoji] = row.count;
        });
        return map;
    },

    // Suscripción Realtime — llama callback({ anuncio_id, emoji, count }) en cada cambio
    subscribeAnuncioReactions(callback) {
        if (!sbClient) return null;
        const channel = sbClient.channel('anuncio-reactions-rt')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'anuncio_reactions'
            }, payload => {
                const row = payload.new || payload.old;
                if (row) callback({ anuncio_id: row.anuncio_id, emoji: row.emoji, count: row.count || 0 });
            })
            .subscribe();
        return channel;
    },

    // ==================== IGLESIAS COMUNIDAD ====================
    async addIglesiaComunidad(iglesia) {
        if (!sbClient) { saveLocal('iglesias_comunidad', iglesia); return iglesia; }
        let payload = Object.assign({}, iglesia);
        const { data, error } = await sbClient.from('iglesias_comunidad').insert(payload).select().single();
        if (error) {
            console.error('[DB] Error inserting iglesia:', error.message);
            saveLocal('iglesias_comunidad', iglesia);
            return iglesia;
        }
        return data;
    },

    async getIglesiasComunidad() {
        if (!sbClient) return getLocal('iglesias_comunidad');
        const { data, error } = await sbClient.from('iglesias_comunidad').select('*').order('pais', {ascending:true}).order('ciudad', {ascending:true});
        if (error) {
            console.error('[DB] Error fetching iglesias:', error.message);
            return getLocal('iglesias_comunidad');
        }
        return data || [];
    },

    // ==================== REALTIME ====================
    subscribeToRosaries(callback) {
        if (!sbClient) return;
        return sbClient.channel('rosaries-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rosaries' }, callback)
            .subscribe();
    },

    subscribeToCenaculo(cenaculoId, callback) {
        if (!sbClient) return;
        return sbClient.channel('cenaculo-' + cenaculoId)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cenaculo_members', filter: 'cenaculo_id=eq.' + cenaculoId }, callback)
            .subscribe();
    },
    // ==================== BANCO DE VOLUNTARIOS ====================
    async saveHabilidades(userId, habilidadesArray) {
        if (!sbClient) return;
        var realUuid = await this.resolveUserUuid(userId);
        if (!realUuid) return;
        const { error } = await sbClient.from('habilidades_voluntarios').upsert({
            user_id: realUuid,
            habilidades: habilidadesArray,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) console.error('[DB] Error saving habilidades:', error.message);
    },

    async getHabilidades(userId) {
        if (!sbClient) return [];
        var realUuid = await this.resolveUserUuid(userId);
        if (!realUuid) return [];
        const { data, error } = await sbClient.from('habilidades_voluntarios')
            .select('habilidades')
            .eq('user_id', realUuid)
            .single();
        if (error) return [];
        return data ? data.habilidades : [];
    },

    async saveCompromiso(userId, compromisoObj) {
        if (!sbClient) return;
        var realUuid = await this.resolveUserUuid(userId);
        if (!realUuid) return;

        // Prevent duplicate insertion of identical commitments
        try {
            const { data: existing } = await sbClient.from('compromisos_voluntarios')
                .select('id')
                .eq('user_id', realUuid)
                .eq('cat_id', compromisoObj.catId)
                .eq('descripcion', compromisoObj.desc || '')
                .limit(1);
            if (existing && existing.length > 0) {
                console.log('[DB] Commitment already exists in Supabase, skipping duplicate insertion.');
                return;
            }
        } catch(e) {
            console.warn('[DB] Error checking for duplicate commitments:', e.message);
        }

        const payload = {
            user_id: realUuid,
            cat_id: compromisoObj.catId,
            descripcion: compromisoObj.desc || '',
            hasta: compromisoObj.hasta || null
        };
        const { error } = await sbClient.from('compromisos_voluntarios').insert(payload);
        if (error) console.error('[DB] Error saving compromiso:', error.message);
    },

    async getCompromisos(userId) {
        if (!sbClient) return [];
        var realUuid = await this.resolveUserUuid(userId);
        if (!realUuid) return [];
        const { data, error } = await sbClient.from('compromisos_voluntarios')
            .select('*')
            .eq('user_id', realUuid)
            .order('created_at', { ascending: false });
        if (error) return [];
        // Map to expected format
        return (data || []).map(function(row) {
            return { id: row.id, catId: row.cat_id, desc: row.descripcion, hasta: row.hasta, creado: row.created_at };
        });
    },

    async deleteCompromiso(id) {
        if (!sbClient) return;
        const { error } = await sbClient.from('compromisos_voluntarios').delete().eq('id', id);
        if (error) console.error('[DB] Error deleting compromiso:', error.message);
    },

    async deleteCompromisoByCriteria(userId, catId, desc) {
        if (!sbClient) return;
        var realUuid = await this.resolveUserUuid(userId);
        if (!realUuid) return;
        const { error } = await sbClient.from('compromisos_voluntarios')
            .delete()
            .eq('user_id', realUuid)
            .eq('cat_id', catId)
            .eq('descripcion', desc || '');
        if (error) console.error('[DB] Error deleting compromiso by criteria:', error.message);
    },


    async deleteAnuncio(id) {
        if (!sbClient) return false;
        const { error } = await sbClient.from('anuncios').delete().eq('id', id);
        if (error) { console.error('[DB] Error deleting anuncio:', error.message); return false; }
        console.log('[DB] Anuncio deleted:', id);
        return true;
    },

    async getAllVolunteers() {

        if (!sbClient) return [];
        const { data: profiles } = await sbClient.from('profiles').select('id, name, username, email, avatar_url');
        if (!profiles) return [];
        
        const { data: allHabilidades } = await sbClient.from('habilidades_voluntarios').select('user_id, habilidades, updated_at');
        const { data: allCompromisos } = await sbClient.from('compromisos_voluntarios').select('*');
        
        var currentUserId = null;
        var currentResolvedId = null;
        if (typeof auth !== 'undefined' && auth.getCurrentUser) {
            var cu = auth.getCurrentUser();
            if (cu) {
                currentUserId = cu.id;
                try {
                    currentResolvedId = localStorage.getItem('redmaria_sb_uuid_' + cu.id);
                } catch(e) {}
            }
        }

        var volunteers = [];
        profiles.forEach(function(p) {
            var userHabs = allHabilidades ? allHabilidades.find(function(h){ return h.user_id === p.id; }) : null;
            var userComps = allCompromisos ? allCompromisos.filter(function(c){ return c.user_id === p.id; }) : [];
            
            var habs = userHabs ? userHabs.habilidades : [];
            var comps = userComps.map(function(c){
                return { id: c.id, catId: c.cat_id, desc: c.descripcion, hasta: c.hasta, creado: c.created_at };
            });
            
            // Calcular última actividad
            var lastActive = 0;
            if (userHabs && userHabs.updated_at) {
                lastActive = Math.max(lastActive, new Date(userHabs.updated_at).getTime());
            }
            userComps.forEach(function(c) {
                if (c.created_at) {
                    lastActive = Math.max(lastActive, new Date(c.created_at).getTime());
                }
            });

            // Solo mostrar perfiles con habilidades/compromisos o al propio usuario logueado para pruebas
            if (habs.length > 0 || comps.length > 0 || p.id === currentUserId || p.id === currentResolvedId) {
                volunteers.push({
                    id: p.id,
                    nombre: p.name || p.username || 'Anónimo',
                    email: p.email,
                    avatar: p.avatar_url,
                    habs: habs,
                    comps: comps,
                    lastActive: lastActive
                });
            }
        });

        // Ordenar de más reciente a menos reciente (últimos activos primero)
        volunteers.sort(function(a, b) {
            return b.lastActive - a.lastActive;
        });

        return volunteers;
    }
};


// === LOCAL STORAGE FALLBACK ===
function saveLocal(key, item) {
    try {
        const items = JSON.parse(localStorage.getItem('solidaridad_' + key) || '[]');
        items.push(item);
        localStorage.setItem('solidaridad_' + key, JSON.stringify(items));
    } catch(e) {}
}

function getLocal(key) {
    try { return JSON.parse(localStorage.getItem('solidaridad_' + key) || '[]'); } catch(e) { return []; }
}

// === CONNECTION STATUS ===
async function checkSupabaseConnection() {
    var status = document.getElementById('db-status');
    if (!sbClient) {
        console.log('⚠️ Supabase no disponible, usando localStorage');
        if (status) { status.textContent = 'Offline (Local)'; status.style.color = '#f0a500'; }
        return false;
    }
    try {
        const { data, error } = await sbClient.from('profiles').select('count', { count: 'exact', head: true });
        if (error) throw error;
        console.log('✅ Conectado a Supabase');
        if (status) { status.textContent = 'Conectado'; status.style.color = '#27ae60'; }
        return true;
    } catch(e) {
        console.log('❌ Error de conexión:', e.message);
        if (status) { status.textContent = 'Error: ' + e.message; status.style.color = '#e74c3c'; }
        return false;
    }
}

// Auto-check on load
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(checkSupabaseConnection, 1000);
});

// Ensure global access for inline onclick handlers
window.db = db;
window.sbClient = sbClient;

