// plugins/mail.js
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAPID_KEY  = '25222978fdmshe6b4366767fb8e6p18086bjsnee54a88ff976';

// Sessions en mémoire — chatId → { email, token, provider, createdAt }
const sessions = new Map();

// ══════════════════════════════════════════
// API 1 — temp-mail44 (email jetable)
// ══════════════════════════════════════════
async function createTempMail44() {
    const res = await axios.post('https://temp-mail44.p.rapidapi.com/api/v3/email/new', {}, {
        headers: {
            'Content-Type': 'application/json',
            'x-rapidapi-host': 'temp-mail44.p.rapidapi.com',
            'x-rapidapi-key': RAPID_KEY
        },
        timeout: 15000
    });
    // Retourne { email, token }
    const email = res.data?.email || res.data?.data?.email;
    const token = res.data?.token || res.data?.data?.token || email;
    if (!email) throw new Error('Pas d\'email dans la réponse TempMail44');
    return { email, token, provider: 'tempmail44' };
}

async function getMessagesTempMail44(token) {
    const res = await axios.get(`https://temp-mail44.p.rapidapi.com/api/v3/email/${token}/messages`, {
        headers: {
            'x-rapidapi-host': 'temp-mail44.p.rapidapi.com',
            'x-rapidapi-key': RAPID_KEY
        },
        timeout: 15000
    });
    return res.data?.data || res.data || [];
}

// ══════════════════════════════════════════
// API 2 — temporary-gmail (Gmail jetable)
// ══════════════════════════════════════════
async function createGmail() {
    const res = await axios.post('https://temporary-gmail-account.p.rapidapi.com/GmailGetAccount', {
        generateNewAccount: 1
    }, {
        headers: {
            'Content-Type': 'application/json',
            'x-rapidapi-host': 'temporary-gmail-account.p.rapidapi.com',
            'x-rapidapi-key': RAPID_KEY
        },
        timeout: 15000
    });
    console.log('Gmail API response:', JSON.stringify(res.data).substring(0, 200));
    const email = res.data?.email || res.data?.gmail || res.data?.data?.email;
    const token = res.data?.token || res.data?.id || email;
    if (!email) throw new Error('Pas d\'email dans la réponse Gmail');
    return { email, token, provider: 'gmail' };
}

async function getMessagesGmail(token) {
    const res = await axios.post('https://temporary-gmail-account.p.rapidapi.com/GmailGetMessages', {
        email: token
    }, {
        headers: {
            'Content-Type': 'application/json',
            'x-rapidapi-host': 'temporary-gmail-account.p.rapidapi.com',
            'x-rapidapi-key': RAPID_KEY
        },
        timeout: 15000
    });
    return res.data?.messages || res.data?.data || res.data || [];
}

// ══════════════════════════════════════════
// Télécharge une pièce jointe et l'envoie
// ══════════════════════════════════════════
async function sendAttachment(ctx, attachment) {
    const url  = attachment.url || attachment.link;
    const name = attachment.filename || attachment.name || 'fichier';
    const mime = attachment.contentType || attachment.type || 'application/octet-stream';

    if (!url) return;

    const res    = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    const buffer = Buffer.from(res.data);

    if (mime.startsWith('image/')) {
        await ctx.replyWithPhoto({ source: buffer }, { caption: `📎 ${name}` });
    } else if (mime.startsWith('audio/')) {
        await ctx.replyWithAudio({ source: buffer, filename: name }, { caption: `📎 ${name}` });
    } else if (mime.startsWith('video/')) {
        await ctx.replyWithVideo({ source: buffer }, { caption: `📎 ${name}` });
    } else {
        await ctx.replyWithDocument({ source: buffer, filename: name }, { caption: `📎 ${name}` });
    }
}

// ══════════════════════════════════════════
// Plugin
// ══════════════════════════════════════════
export default {
    name: 'mail',
    description: 'Email temporaire — /mail gen | inbox | read [n] | delete',
    commands: ['mail'],

    async handler(bot, ctx, args) {
        const chatId = String(ctx.chat.id);
        const sub    = (args[0] || '').toLowerCase();

        // ─────────── HELP ───────────
        if (!sub || sub === 'help') {
            return ctx.reply(
`📧 *EMAIL TEMPORAIRE*

Commandes :
• /mail gen — Créer un email jetable
• /mail gmail — Créer un Gmail jetable
• /mail inbox — Voir les messages reçus
• /mail read [n] — Lire le message n
• /mail delete — Supprimer l'email

Les pièces jointes (images, fichiers, audio) sont envoyées automatiquement.`,
                { parse_mode: 'Markdown' }
            );
        }

        // ─────────── GEN (temp-mail44) ───────────
        if (sub === 'gen') {
            const old = sessions.get(chatId);
            if (old && (Date.now() - old.createdAt) < 3600000) {
                const age = Math.floor((Date.now() - old.createdAt) / 60000);
                return ctx.reply(
`📧 *Email déjà actif*

📮 \`${old.email}\`
⏱️ Expire dans ${60 - age} minutes
📥 /mail inbox pour voir les messages`,
                    { parse_mode: 'Markdown' }
                );
            }

            const creating = await ctx.reply('⏳ Création de l\'email en cours...');

            try {
                const data = await createTempMail44();
                sessions.set(chatId, { ...data, createdAt: Date.now(), messages: [] });

                await ctx.telegram.editMessageText(ctx.chat.id, creating.message_id, undefined,
`✅ *Email créé !*

📮 \`${data.email}\`
⏱️ Valide 1 heure
📥 /mail inbox pour vérifier`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {
                console.error('TempMail44 error:', e.message);
                await ctx.telegram.editMessageText(ctx.chat.id, creating.message_id, undefined,
                    `❌ Erreur : ${e.message}`
                );
            }
            return;
        }

        // ─────────── GMAIL ───────────
        if (sub === 'gmail') {
            const creating = await ctx.reply('⏳ Création du Gmail en cours...');
            try {
                const data = await createGmail();
                sessions.set(chatId, { ...data, createdAt: Date.now(), messages: [] });

                await ctx.telegram.editMessageText(ctx.chat.id, creating.message_id, undefined,
`✅ *Gmail créé !*

📮 \`${data.email}\`
⏱️ Valide 1 heure
📥 /mail inbox pour vérifier`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {
                console.error('Gmail error:', e.message);
                await ctx.telegram.editMessageText(ctx.chat.id, creating.message_id, undefined,
                    `❌ Erreur : ${e.message}`
                );
            }
            return;
        }

        // Vérif session active pour les autres sous-commandes
        const session = sessions.get(chatId);
        if (!session) {
            return ctx.reply('❌ Aucun email actif. Crée-en un avec /mail gen ou /mail gmail');
        }

        // ─────────── INBOX ───────────
        if (sub === 'inbox') {
            const checking = await ctx.reply('📥 Vérification des messages...');

            try {
                let msgs = [];
                if (session.provider === 'gmail') {
                    msgs = await getMessagesGmail(session.token);
                } else {
                    msgs = await getMessagesTempMail44(session.token);
                }

                session.messages = msgs;

                if (!msgs.length) {
                    return ctx.telegram.editMessageText(ctx.chat.id, checking.message_id, undefined,
`📭 *Boîte vide*

📮 \`${session.email}\`
Aucun message pour l\'instant.
Réessaie avec /mail inbox`,
                        { parse_mode: 'Markdown' }
                    );
                }

                let text = `📥 *Inbox — ${msgs.length} message(s)*\n📮 \`${session.email}\`\n\n`;
                msgs.slice(0, 10).forEach((m, i) => {
                    const from    = m.from?.name || m.from?.address || m.sender || m.from || 'Inconnu';
                    const subject = m.subject || m.title || 'Sans objet';
                    text += `*${i + 1}.* ${subject}\n   De : ${from}\n   /mail read ${i + 1}\n\n`;
                });

                await ctx.telegram.editMessageText(ctx.chat.id, checking.message_id, undefined,
                    text, { parse_mode: 'Markdown' }
                );
            } catch (e) {
                await ctx.telegram.editMessageText(ctx.chat.id, checking.message_id, undefined,
                    `❌ Erreur : ${e.message}`
                );
            }
            return;
        }

        // ─────────── READ ───────────
        if (sub === 'read') {
            const num = parseInt(args[1]);
            if (!num || isNaN(num)) return ctx.reply('❌ Précise le numéro : /mail read 1');

            const msgs = session.messages;
            if (!msgs.length) return ctx.reply('❌ Pas de messages. Fais /mail inbox d\'abord');

            const msg = msgs[num - 1];
            if (!msg) return ctx.reply(`❌ Message ${num} introuvable`);

            const from    = msg.from?.name || msg.from?.address || msg.sender || msg.from || 'Inconnu';
            const subject = msg.subject || msg.title || 'Sans objet';
            let body      = msg.body || msg.text || msg.html || msg.content || '';

            // Retire les balises HTML basiques
            body = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (body.length > 1000) body = body.slice(0, 1000) + '...';

            await ctx.reply(
`📧 *Message #${num}*

*De :* ${from}
*Objet :* ${subject}

${body || '(Corps vide)'}`,
                { parse_mode: 'Markdown' }
            );

            // ── Pièces jointes ──
            const attachments = msg.attachments || msg.files || msg.att || [];
            if (attachments.length > 0) {
                await ctx.reply(`📎 *${attachments.length} pièce(s) jointe(s) — envoi en cours...*`, { parse_mode: 'Markdown' });
                for (const att of attachments) {
                    try {
                        await sendAttachment(ctx, att);
                    } catch (e) {
                        await ctx.reply(`❌ Erreur pièce jointe : ${e.message}`);
                    }
                }
            }

            // ── Inline images dans HTML ──
            const htmlBody = msg.html || '';
            const imgUrls  = [...htmlBody.matchAll(/src=["']([^"']+)["']/g)].map(m => m[1]).filter(u => u.startsWith('http'));
            if (imgUrls.length > 0) {
                await ctx.reply(`🖼️ *${imgUrls.length} image(s) intégrée(s)*`, { parse_mode: 'Markdown' });
                for (const url of imgUrls.slice(0, 5)) {
                    try {
                        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
                        await ctx.replyWithPhoto({ source: Buffer.from(res.data) });
                    } catch (e) {}
                }
            }

            return;
        }

        // ─────────── DELETE ───────────
        if (sub === 'delete') {
            const email = session.email;
            sessions.delete(chatId);
            return ctx.reply(`🗑️ Email \`${email}\` supprimé.`, { parse_mode: 'Markdown' });
        }

        return ctx.reply('❓ Commande inconnue. Fais /mail help');
    }
};
