// plugins/mail.js
// Fournisseur unique : temporary-gmail (dure 1 semaine)
import axios from 'axios';
import { redis } from '../lib/redis.js';

const RAPID_KEY  = '25222978fdmshe6b4366767fb8e6p18086bjsnee54a88ff976';
const GMAIL_HOST = 'temporary-gmail-account.p.rapidapi.com';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000; // 1 semaine en ms
const WEEK_S  = 7 * 24 * 60 * 60;         // 1 semaine en secondes (pour redis)

function sessionKey(userId) { return `mail:${userId}`; }

async function loadSession(userId) {
    try {
        const raw = await redis.get(sessionKey(userId));
        return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch { return null; }
}
async function saveSession(userId, session) {
    await redis.set(sessionKey(userId), JSON.stringify(session), { ex: WEEK_S });
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

// ── temporary-gmail ───────────────────────────────────────────────────────────
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
    const email = res.data?.email || res.data?.gmail || res.data?.address || res.data?.data?.email || res.data?.data?.address;
    const token = res.data?.token || res.data?.id || email;
    if (!email) throw new Error('temporary-gmail : création échouée — ' + JSON.stringify(res.data).substring(0, 100));
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
    if (!Array.isArray(msgs)) return [];
    return msgs.map(m => ({
        id:      m.id || m._id || m.messageId,
        from:    m.from?.address || m.from || m.sender || 'Inconnu',
        subject: m.subject || m.title || 'Sans objet',
        content: m.body || m.text || m.content || m.snippet || ''
    }));
}

async function getMessageContentGmail(s, id) {
    // Récupère depuis la liste déjà chargée (Gmail ne permet pas toujours la lecture par ID)
    const msgs = await getMessagesGmail(s);
    const msg  = msgs.find(m => String(m.id) === String(id)) || msgs[0];
    if (!msg) return { from: 'N/A', subject: 'N/A', content: 'Message introuvable.' };

    let content = msg.content || '';
    content = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { from: msg.from, subject: msg.subject, content };
}

function daysLeft(createdAt) {
    const diff = WEEK_MS - (Date.now() - createdAt);
    return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

export default {
    name: 'mail',
    description: 'Email temporaire Gmail — /mail gen | inbox | read [n] | delete',
    commands: ['mail'],
    async handler(bot, ctx, args) {
        const userId = ctx.from.id;
        const sub    = args[0]?.toLowerCase();

        if (!sub || sub === 'help') {
            return ctx.reply(
                `📧 *Email temporaire Gmail*\n\n` +
                `/mail gen — créer une adresse Gmail (valide 7 jours)\n` +
                `/mail inbox — voir les messages reçus\n` +
                `/mail read [numéro] — lire un message\n` +
                `/mail delete — supprimer l'adresse`,
                { parse_mode: 'Markdown' }
            );
        }

        if (['gen', 'generate', 'new'].includes(sub)) {
            const existing = await loadSession(userId);
            if (existing) {
                const days = daysLeft(existing.createdAt);
                if (days > 0) return ctx.reply(
                    `⚠️ Email déjà actif : \`${existing.email}\`\n⏱️ Expire dans ${days} jour(s)`,
                    { parse_mode: 'Markdown' }
                );
            }
            await ctx.reply('🔄 Création en cours...');
            try {
                const data = await createGmailTemp();
                await saveSession(userId, data);
                await ctx.reply(
                    `✅ *Gmail créé !*\n\n📧 \`${data.email}\`\n⏳ Durée : *7 jours*\n\n` +
                    `Commandes : /mail inbox — /mail read 1`,
                    { parse_mode: 'Markdown' }
                );
            } catch (err) {
                console.error('Erreur création Gmail:', err.response?.data || err.message);
                await ctx.reply(`❌ Erreur : ${err.message}`);
            }
            return;
        }

        if (['inbox', 'messages', 'list'].includes(sub)) {
            const s = await loadSession(userId);
            if (!s) return ctx.reply('❌ Aucun email actif. Fais /mail gen d\'abord.');

            await ctx.reply('📥 Récupération...');
            try {
                const msgs = await getMessagesGmail(s);

                if (!msgs.length) {
                    return ctx.reply(
                        `📭 Aucun message.\n📧 \`${s.email}\`\n⏱️ Expire dans ${daysLeft(s.createdAt)} jour(s)`,
                        { parse_mode: 'Markdown' }
                    );
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
            const s   = await loadSession(userId);
            if (!s) return ctx.reply('❌ Aucun email actif.');

            try {
                let ids = s.lastMessages;
                if (!ids) {
                    const msgs = await getMessagesGmail(s);
                    ids = msgs.map(m => m.id);
                    s.lastMessages = ids;
                    await saveSession(userId, s);
                }
                if (!ids[num - 1]) return ctx.reply('❌ Message introuvable. Fais /mail inbox d\'abord.');

                const full = await getMessageContentGmail(s, ids[num - 1]);
                const code = extractMainCode(full.content);
                let clean  = full.content.length > 800 ? full.content.slice(0, 800) + '...' : full.content;

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
            return ctx.reply(`✅ Email supprimé : \`${s.email}\``, { parse_mode: 'Markdown' });
        }

        return ctx.reply('❌ Commande invalide. Fais /mail help.');
    }
};
