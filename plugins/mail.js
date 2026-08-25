// plugins/mail.js
// Deux fournisseurs : mail.tm en priorité, repli automatique sur 1secmail.com
// si mail.tm échoue (leur API 500/plante parfois depuis des IP d'hébergeurs cloud).
import axios from 'axios';
import { redis } from '../lib/redis.js';

const MAILTM_BASE = 'https://api.mail.tm';
const SECMAIL_BASE = 'https://www.1secmail.com/api/v1/';

function sessionKey(userId) { return `mail:${userId}`; }

async function loadSession(userId) {
    try {
        const raw = await redis.get(sessionKey(userId));
        return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch { return null; }
}
async function saveSession(userId, session) {
    await redis.set(sessionKey(userId), JSON.stringify(session), { ex: 3600 });
}
async function deleteSession(userId) { await redis.del(sessionKey(userId)); }

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

// ── mail.tm ──────────────────────────────────────────────────────────────────
async function createMailTm() {
    const domainRes = await axios.get(`${MAILTM_BASE}/domains`, { timeout: 10000 });
    const domain = domainRes.data['hydra:member']?.[0]?.domain;
    if (!domain) throw new Error('mail.tm : aucun domaine disponible');
    const randomName = Math.random().toString(36).substring(2, 12);
    const email = `${randomName}@${domain}`;
    const password = Math.random().toString(36).substring(2, 15);
    const res = await axios.post(`${MAILTM_BASE}/accounts`, { address: email, password }, { timeout: 10000 });
    if (!res.data?.id) throw new Error('mail.tm : création échouée');
    const tokenRes = await axios.post(`${MAILTM_BASE}/token`, { address: email, password }, { timeout: 10000 });
    return { provider: 'mailtm', email, password, token: tokenRes.data.token, createdAt: Date.now() };
}
async function getMessagesMailTm(s) {
    const res = await axios.get(`${MAILTM_BASE}/messages`, { headers: { Authorization: `Bearer ${s.token}` }, timeout: 10000 });
    const messages = res.data['hydra:member'] || [];
    messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return messages.map(m => ({ id: m.id, from: m.from?.address, subject: m.subject }));
}
async function getMessageContentMailTm(s, id) {
    const res = await axios.get(`${MAILTM_BASE}/messages/${id}`, { headers: { Authorization: `Bearer ${s.token}` }, timeout: 10000 });
    let content = res.data.text || res.data.html || '';
    if (Array.isArray(content)) content = content[0];
    return { from: res.data.from?.address, subject: res.data.subject, content };
}

// ── 1secmail (repli) ─────────────────────────────────────────────────────────
async function createSecmail() {
    const res = await axios.get(SECMAIL_BASE, { params: { action: 'genRandomMailbox', count: 1 }, timeout: 10000 });
    const email = res.data?.[0];
    if (!email) throw new Error('1secmail : création échouée');
    const [login, domain] = email.split('@');
    return { provider: 'secmail', email, login, domain, createdAt: Date.now() };
}
async function getMessagesSecmail(s) {
    const res = await axios.get(SECMAIL_BASE, { params: { action: 'getMessages', login: s.login, domain: s.domain }, timeout: 10000 });
    return (res.data || []).map(m => ({ id: m.id, from: m.from, subject: m.subject }));
}
async function getMessageContentSecmail(s, id) {
    const res = await axios.get(SECMAIL_BASE, { params: { action: 'readMessage', login: s.login, domain: s.domain, id }, timeout: 10000 });
    return { from: res.data.from, subject: res.data.subject, content: res.data.textBody || res.data.htmlBody || '' };
}

// ── Wrapper commun (essaie mail.tm, bascule sur 1secmail si ça échoue) ──────
async function createTempEmail() {
    try {
        return await createMailTm();
    } catch (err) {
        console.error('mail.tm indisponible, repli sur 1secmail :', err.response?.data || err.message);
        return await createSecmail();
    }
}
async function getMessages(s) {
    return s.provider === 'secmail' ? getMessagesSecmail(s) : getMessagesMailTm(s);
}
async function getMessageContent(s, id) {
    return s.provider === 'secmail' ? getMessageContentSecmail(s, id) : getMessageContentMailTm(s, id);
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
                if (ageMin < 60) return ctx.reply(`⚠️ Email déjà actif : ${existing.email}\n⏱️ Expire dans ${60 - ageMin}m`);
            }
            await ctx.reply('🔄 Création en cours...');
            try {
                const data = await createTempEmail();
                await saveSession(userId, data);
                await ctx.reply(
                    `✅ *Email créé !*\n\n📧 ${data.email}${data.password ? `\n🔑 ${data.password}` : ''}\n⏳ Durée : 1 heure\n\n` +
                    `Commandes : /mail inbox — /mail read 1`,
                    { parse_mode: 'Markdown' }
                );
            } catch (err) {
                console.error('Erreur création mail (les deux fournisseurs ont échoué):', err.response?.data || err.message);
                await ctx.reply(`❌ Les deux services d'email temporaire sont indisponibles pour le moment : ${err.message}`);
            }
            return;
        }

        if (['inbox', 'messages', 'list'].includes(sub)) {
            const s = await loadSession(userId);
            if (!s) return ctx.reply('❌ Aucun email actif. Fais /mail gen d\'abord.');

            await ctx.reply('📥 Récupération...');
            try {
                const msgs = await getMessages(s);

                if (!msgs.length) {
                    const ageMin = Math.floor((Date.now() - s.createdAt) / 60000);
                    return ctx.reply(`📭 Aucun message.\n📧 ${s.email}\n⏱️ Expire dans ${60 - ageMin}m`);
                }

                let lines = `📥 *Inbox (${msgs.length})*\n\n`;
                msgs.slice(0, 10).forEach((m, i) => {
                    lines += `${i + 1}. ${m.subject || 'Sans objet'}\n   De : ${m.from}\n   → /mail read ${i + 1}\n\n`;
                });
                s.lastMessages = msgs.map(m => m.id);
                await saveSession(userId, s);
                await ctx.reply(lines, { parse_mode: 'Markdown' });
            } catch (err) {
                await ctx.reply(`❌ Erreur de récupération : ${err.message}`);
            }
            return;
        }

        if (sub === 'read') {
            const num = parseInt(args[1]);
            const s = await loadSession(userId);
            if (!s) return ctx.reply('❌ Aucun email actif.');

            try {
                let ids = s.lastMessages;
                if (!ids) {
                    const msgs = await getMessages(s);
                    ids = msgs.map(m => m.id);
                    s.lastMessages = ids;
                    await saveSession(userId, s);
                }
                if (!ids[num - 1]) return ctx.reply('❌ Message introuvable. Fais /mail inbox d\'abord.');

                const full = await getMessageContent(s, ids[num - 1]);
                const code = extractMainCode(full.content);
                let clean = full.content.length > 800 ? full.content.slice(0, 800) + '...' : full.content;

                let text = `📧 *Message #${num}*\n\nDe : ${full.from}\nObjet : ${full.subject}\n\n${clean}`;
                if (code) text += `\n\n🔑 ${code.type} : ${code.value}`;

                await ctx.reply(text, { parse_mode: 'Markdown' });
            } catch (err) {
                await ctx.reply(`❌ Erreur de lecture : ${err.message}`);
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
