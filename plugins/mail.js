// plugins/mail.js
// Email temporaire via mail.tm (API publique, gratuite, documentée — bien plus fiable que RapidAPI)
import axios from 'axios';
import { redis } from '../lib/redis.js';

const API_BASE = 'https://api.mail.tm';
const HOUR_MS  = 60 * 60 * 1000;
const HOUR_S   = 60 * 60;

// Client axios dédié avec timeout : on échoue vite plutôt que de laisser l'utilisateur attendre
const api = axios.create({ baseURL: API_BASE, timeout: 8000 });

function sessionKey(userId) { return `mail:${userId}`; }

async function loadSession(userId) {
    try {
        const raw = await redis.get(sessionKey(userId));
        return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch { return null; }
}
async function saveSession(userId, session) {
    await redis.set(sessionKey(userId), JSON.stringify(session), { ex: HOUR_S });
}
async function deleteSession(userId) { await redis.del(sessionKey(userId)); }

function getAge(createdAt) { return Math.floor((Date.now() - createdAt) / 60000); }
function isExpired(createdAt) { return getAge(createdAt) > 60; }

// ── Cache du domaine mail.tm ────────────────────────────────────────────────
// Le domaine change rarement : le mettre en cache évite un aller-retour HTTP
// à chaque "mail gen" (gain de vitesse direct, sans rien perdre en fiabilité).
let domainCache = { value: null, fetchedAt: 0 };
async function getDomain() {
    if (domainCache.value && Date.now() - domainCache.fetchedAt < HOUR_MS) {
        return domainCache.value;
    }
    const res = await api.get('/domains');
    const domain = res.data['hydra:member'][0].domain;
    domainCache = { value: domain, fetchedAt: Date.now() };
    return domain;
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

// ── API mail.tm ──────────────────────────────────────────────────────────────
async function createTempEmail() {
    const domain = await getDomain();
    const randomName = Math.random().toString(36).substring(2, 12);
    const email    = `${randomName}@${domain}`;
    const password = Math.random().toString(36).substring(2, 15);

    // Création du compte + récupération du token en parallèle dès que possible :
    // le token nécessite le compte créé, donc on ne peut paralléliser que la requête
    // de login juste après, mais on évite tout appel superflu (pas de vérif existante,
    // le nom étant aléatoire il n'existera jamais déjà).
    const accountRes = await api.post('/accounts', { address: email, password });
    if (!accountRes.data?.id) throw new Error('Création du compte échouée');

    const tokenRes = await api.post('/token', { address: email, password });
    const token = tokenRes.data?.token;
    if (!token) throw new Error('Récupération du token échouée');

    return { email, password, id: accountRes.data.id, token };
}

async function getMessages(token) {
    const res = await api.get('/messages', { headers: { Authorization: `Bearer ${token}` } });
    const messages = res.data['hydra:member'] || [];
    messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return messages;
}

async function getMessageContent(token, id) {
    const res = await api.get(`/messages/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    return res.data;
}

async function deleteAccount(id, token) {
    try { await api.delete(`/accounts/${id}`, { headers: { Authorization: `Bearer ${token}` } }); }
    catch (e) { /* best-effort : même si ça échoue côté serveur, on nettoie quand même la session locale */ }
}

export default {
    name: 'mail',
    description: 'Email temporaire via mail.tm — /mail gen | inbox | read [n] | delete',
    commands: ['mail'],
    async handler(bot, ctx, args) {
        const userId = ctx.from.id;
        const sub    = args[0]?.toLowerCase();

        if (!sub || sub === 'help') {
            return ctx.reply(
                `📧 *Email temporaire (mail.tm)*\n\n` +
                `/mail gen — créer une adresse (valide 1h)\n` +
                `/mail inbox — voir les messages reçus\n` +
                `/mail read [numéro] — lire un message\n` +
                `/mail delete — supprimer l'adresse`,
                { parse_mode: 'Markdown' }
            );
        }

        if (['gen', 'generate', 'new'].includes(sub)) {
            const existing = await loadSession(userId);
            if (existing && !isExpired(existing.createdAt)) {
                return ctx.reply(
                    `⚠️ Email déjà actif : \`${existing.email}\`\n⏱️ Expire dans ${60 - getAge(existing.createdAt)}m`,
                    { parse_mode: 'Markdown' }
                );
            }

            await ctx.reply('🔄 Création en cours...');
            try {
                const data = await createTempEmail();
                const session = { email: data.email, password: data.password, id: data.id, token: data.token, createdAt: Date.now(), lastMessages: null };
                await saveSession(userId, session);
                await ctx.reply(
                    `✅ *Email créé !*\n\n📧 \`${data.email}\`\n⏳ Durée : *1 heure*\n\n` +
                    `Commandes : /mail inbox — /mail read 1`,
                    { parse_mode: 'Markdown' }
                );
            } catch (err) {
                console.error('Erreur création mail:', err.response?.data || err.message);
                await ctx.reply(`❌ Erreur : ${err.response?.data?.detail || err.message}`);
            }
            return;
        }

        if (['inbox', 'messages', 'list'].includes(sub)) {
            const s = await loadSession(userId);
            if (!s) return ctx.reply('❌ Aucun email actif. Fais /mail gen d\'abord.');
            if (isExpired(s.createdAt)) {
                await deleteSession(userId);
                return ctx.reply('❌ Email expiré. Fais /mail gen.');
            }

            await ctx.reply('📥 Récupération...');
            try {
                const msgs = await getMessages(s.token);

                if (!msgs.length) {
                    return ctx.reply(
                        `📭 Aucun message.\n📧 \`${s.email}\`\n⏱️ Expire dans ${60 - getAge(s.createdAt)}m`,
                        { parse_mode: 'Markdown' }
                    );
                }

                let lines = `📥 *Inbox (${msgs.length})*\n\n`;
                msgs.slice(0, 10).forEach((m, i) => {
                    lines += `${i + 1}. ${m.subject || 'Sans objet'}\n   De : ${m.from?.address || 'Inconnu'}\n   → /mail read ${i + 1}\n\n`;
                });
                s.lastMessages = msgs.map(m => m.id);
                await saveSession(userId, s);
                await ctx.reply(lines, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error('Erreur inbox mail:', err.response?.data || err.message);
                await ctx.reply(`❌ Erreur de récupération : ${err.response?.data?.detail || err.message}`);
            }
            return;
        }

        if (sub === 'read') {
            const num = parseInt(args[1]);
            const s   = await loadSession(userId);
            if (!s) return ctx.reply('❌ Aucun email actif.');
            if (isExpired(s.createdAt)) {
                await deleteSession(userId);
                return ctx.reply('❌ Email expiré. Fais /mail gen.');
            }

            try {
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
                if (Array.isArray(content)) content = content[0] || '';
                content = String(content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

                const code  = extractMainCode(content);
                const clean = content.length > 800 ? content.slice(0, 800) + '...' : content;

                let text = `📧 *Message #${num}*\n\nDe : ${full.from?.address || 'Inconnu'}\nObjet : ${full.subject || 'Sans objet'}\n\n${clean}`;
                if (code) text += `\n\n🔑 ${code.type} : \`${code.value}\``;

                await ctx.reply(text, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error('Erreur lecture mail:', err.response?.data || err.message);
                await ctx.reply(`❌ Erreur de lecture : ${err.response?.data?.detail || err.message}`);
            }
            return;
        }

        if (['delete', 'del'].includes(sub)) {
            const s = await loadSession(userId);
            if (!s) return ctx.reply('❌ Aucun email actif.');

            await deleteAccount(s.id, s.token); // best-effort, ne bloque pas la suppression locale
            await deleteSession(userId);
            return ctx.reply(`✅ Email supprimé : \`${s.email}\``, { parse_mode: 'Markdown' });
        }

        return ctx.reply('❌ Commande invalide. Fais /mail help.');
    }
};
