// plugins/mail.js
// Deux fournisseurs : temp-mail44 en priorité, repli automatique sur temporary-gmail
import axios from 'axios';
import { redis } from '../lib/redis.js';

const RAPID_KEY      = '25222978fdmshe6b4366767fb8e6p18086bjsnee54a88ff976';
const TEMPMAIL44_HOST = 'temp-mail44.p.rapidapi.com';
const GMAIL_HOST      = 'temporary-gmail-account.p.rapidapi.com';

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

// ── temp-mail44 ───────────────────────────────────────────────────────────────
async function createTempMail44() {
    const res = await axios.post(
        `https://${TEMPMAIL44_HOST}/api/v3/email/new`,
        {},
        {
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': TEMPMAIL44_HOST,
                'x-rapidapi-key': RAPID_KEY
            },
            timeout: 15000
        }
    );
    const email = res.data?.email || res.data?.data?.email;
    const token = res.data?.token || res.data?.data?.token || email;
    if (!email) throw new Error('temp-mail44 : création échouée');
    return { provider: 'tempmail44', email, token, createdAt: Date.now() };
}

async function getMessagesTempMail44(s) {
    const res = await axios.get(
        `https://${TEMPMAIL44_HOST}/api/v3/email/${s.token}/messages`,
        {
            headers: {
                'x-rapidapi-host': TEMPMAIL44_HOST,
                'x-rapidapi-key': RAPID_KEY
            },
            timeout: 15000
        }
    );
    const msgs = res.data?.data || res.data || [];
    msgs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return msgs.map(m => ({
        id:      m.id || m._id,
        from:    m.from?.address || m.from || m.sender,
        subject: m.subject || m.title || 'Sans objet'
    }));
}

async function getMessageContentTempMail44(s, id) {
    const res = await axios.get(
        `https://${TEMPMAIL44_HOST}/api/v3/email/${s.token}/messages/${id}`,
        {
            headers: {
                'x-rapidapi-host': TEMPMAIL44_HOST,
                'x-rapidapi-key': RAPID_KEY
            },
            timeout: 15000
        }
    );
    const data = res.data?.data || res.data;
    let content = data?.body || data?.text || data?.html || data?.content || '';
    if (Array.isArray(content)) content = content[0];
    content = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
        from:    data?.from?.address || data?.from || data?.sender || 'Inconnu',
        subject: data?.subject || data?.title || 'Sans objet',
        content
    };
}

// ── temporary-gmail (repli) ───────────────────────────────────────────────────
async function createGmailTemp() {
    const res = await axios.post(
        `https://${GMAIL_HOST}/GmailGetAccount`,
        { generateNewAccount: 1 },
        {
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': GMAIL_HOST,
                'x-rapidapi-key': RAPID_KEY
            },
            timeout: 15000
        }
    );
    const email = res.data?.email || res.data?.gmail || res.data?.data?.email;
    const token = res.data?.token || res.data?.id || email;
    if (!email) throw new Error('temporary-gmail : création échouée');
    return { provider: 'gmail', email, token, createdAt: Date.now() };
}

async function getMessagesGmail(s) {
    const res = await axios.post(
        `https://${GMAIL_HOST}/GmailGetMessages`,
        { email: s.token },
        {
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': GMAIL_HOST,
                'x-rapidapi-key': RAPID_KEY
            },
            timeout: 15000
        }
    );
    const msgs = res.data?.messages || res.data?.data || res.data || [];
    return msgs.map(m => ({
        id:      m.id || m._id,
        from:    m.from?.address || m.from || m.sender || 'Inconnu',
        subject: m.subject || m.title || 'Sans objet'
    }));
}

async function getMessageContentGmail(s, id) {
    // Gmail temporaire ne supporte pas la lecture par ID en général
    // On renvoie un message générique
    return {
        from:    'N/A',
        subject: 'N/A',
        content: 'Lecture détaillée non disponible pour Gmail temporaire. Utilise /mail inbox pour voir les messages.'
    };
}

// ── Wrapper commun (essaie temp-mail44, bascule sur Gmail si ça échoue) ──────
async function createTempEmail() {
    try {
        return await createTempMail44();
    } catch (err) {
        console.error('temp-mail44 indisponible, repli sur Gmail :', err.response?.data || err.message);
        return await createGmailTemp();
    }
}
async function getMessages(s) {
    return s.provider === 'gmail' ? getMessagesGmail(s) : getMessagesTempMail44(s);
}
async function getMessageContent(s, id) {
    return s.provider === 'gmail' ? getMessageContentGmail(s, id) : getMessageContentTempMail44(s, id);
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
