// plugins/mail.js
import axios from 'axios';
import { redis } from '../lib/redis.js';

const API_BASE = 'https://api.mail.tm';

function sessionKey(userId) { return `mail:${userId}`; }

async function loadSession(userId) {
    try {
        const raw = await redis.get(sessionKey(userId));
        return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch { return null; }
}

async function saveSession(userId, session) {
    // Expire automatiquement après 1h (durée de vie de l'email temporaire)
    await redis.set(sessionKey(userId), JSON.stringify(session), { ex: 3600 });
}

async function deleteSession(userId) {
    await redis.del(sessionKey(userId));
}

function extractMainCode(text) {
    const otpMatches = text.match(/\b\d{4,8}\b/g) || [];
    if (otpMatches.length > 0 && !otpMatches[0].startsWith('20') && !otpMatches[0].startsWith('19')) {
        return { type: 'OTP', value: otpMatches[0] };
    }
    const alphaMatches = text.match(/\b[A-Z]{4,10}\b/g) || [];
    if (alphaMatches.length > 0) return { type: 'CODE', value: alphaMatches[0] };
    if (otpMatches.length > 0) return { type: 'OTP', value: otpMatches[0] };
    return null;
}

async function createTempEmail() {
    const domainRes = await axios.get(`${API_BASE}/domains`);
    const domain = domainRes.data['hydra:member'][0].domain;
    const randomName = Math.random().toString(36).substring(2, 12);
    const email = `${randomName}@${domain}`;
    const password = Math.random().toString(36).substring(2, 15);
    const res = await axios.post(`${API_BASE}/accounts`, { address: email, password });
    if (!res.data?.id) throw new Error('Création échouée');
    return { email, password, createdAt: Date.now() };
}

async function getToken(email, password) {
    const res = await axios.post(`${API_BASE}/token`, { address: email, password });
    return res.data.token;
}

async function getMessages(token) {
    const res = await axios.get(`${API_BASE}/messages`, { headers: { Authorization: `Bearer ${token}` } });
    const messages = res.data['hydra:member'] || [];
    messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return messages;
}

async function getMessageContent(token, id) {
    const res = await axios.get(`${API_BASE}/messages/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    return res.data;
}

export default {
    name: 'mail',
    description: 'Email temporaire — /mail gen | /mail inbox | /mail read [n] | /mail delete',
    commands: ['mail'],
    async handler(bot, ctx, args) {
        const userId = ctx.from.id;
        const sub = args[0]?.toLowerCase();

        if (!sub || sub === 'help') {
            return ctx.reply(
                `📧 *Email temporaire*\n\n` +
                `/mail gen — créer une adresse (valide 1h)\n` +
                `/mail inbox — voir les messages reçus\n` +
                `/mail read [numéro] — lire un message\n` +
                `/mail delete — supprimer l'adresse`,
                { parse_mode: 'Markdown' }
            );
        }

        if (['gen', 'generate', 'new'].includes(sub)) {
            const existing = await loadSession(userId);
            if (existing) {
                const ageMin = Math.floor((Date.now() - existing.createdAt) / 60000);
                if (ageMin < 60) {
                    return ctx.reply(`⚠️ Email déjà actif : ${existing.email}\n⏱️ Expire dans ${60 - ageMin}m`);
                }
            }
            await ctx.reply('🔄 Création en cours...');
            try {
                const data = await createTempEmail();
                await saveSession(userId, data);
                await ctx.reply(
                    `✅ *Email créé !*\n\n📧 ${data.email}\n🔑 ${data.password}\n⏳ Durée : 1 heure\n\n` +
                    `Commandes : /mail inbox — /mail read 1`,
                    { parse_mode: 'Markdown' }
                );
            } catch (err) {
                await ctx.reply('❌ Erreur lors de la création.');
            }
            return;
        }

        if (['inbox', 'messages', 'list'].includes(sub)) {
            const s = await loadSession(userId);
            if (!s) return ctx.reply('❌ Aucun email actif. Fais /mail gen d\'abord.');

            await ctx.reply('📥 Récupération...');
            try {
                if (!s.token) { s.token = await getToken(s.email, s.password); await saveSession(userId, s); }
                const msgs = await getMessages(s.token);

                if (!msgs.length) {
                    const ageMin = Math.floor((Date.now() - s.createdAt) / 60000);
                    return ctx.reply(`📭 Aucun message.\n📧 ${s.email}\n⏱️ Expire dans ${60 - ageMin}m`);
                }

                let lines = `📥 *Inbox (${msgs.length})*\n\n`;
                msgs.slice(0, 10).forEach((m, i) => {
                    lines += `${i + 1}. ${m.subject || 'Sans objet'}\n   De : ${m.from?.address}\n   → /mail read ${i + 1}\n\n`;
                });
                s.lastMessages = msgs.map(m => m.id);
                await saveSession(userId, s);
                await ctx.reply(lines, { parse_mode: 'Markdown' });
            } catch {
                await ctx.reply('❌ Erreur de récupération.');
            }
            return;
        }

        if (sub === 'read') {
            const num = parseInt(args[1]);
            const s = await loadSession(userId);
            if (!s) return ctx.reply('❌ Aucun email actif.');

            try {
                if (!s.token) { s.token = await getToken(s.email, s.password); await saveSession(userId, s); }
                let ids = s.lastMessages;
                if (!ids) {
                    const msgs = await getMessages(s.token);
                    ids = msgs.map(m => m.id);
                    s.lastMessages = ids;
                    await saveSession(userId, s);
                }
                if (!ids[num - 1]) return ctx.reply('❌ Message introuvable. Fais /mail inbox d\'abord.');

                const full = await getMessageContent(s.token, ids[num - 1]);
                let content = full.text || full.html || '';
                if (Array.isArray(content)) content = content[0];

                const code = extractMainCode(content);
                let clean = content.length > 800 ? content.slice(0, 800) + '...' : content;

                let text = `📧 *Message #${num}*\n\nDe : ${full.from?.address}\nObjet : ${full.subject}\n\n${clean}`;
                if (code) text += `\n\n🔑 ${code.type} : ${code.value}`;

                await ctx.reply(text, { parse_mode: 'Markdown' });
            } catch {
                await ctx.reply('❌ Erreur de lecture.');
            }
            return;
        }

        if (['delete', 'del'].includes(sub)) {
            const s = await loadSession(userId);
            if (!s) return ctx.reply('❌ Aucun email actif.');
            await deleteSession(userId);
            return ctx.reply(`✅ Email supprimé : ${s.email}`);
        }

        return ctx.reply('❌ Commande invalide. Fais /mail help.');
    }
};
