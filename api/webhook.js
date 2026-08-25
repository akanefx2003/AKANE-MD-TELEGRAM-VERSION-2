// api/webhook.js — Vercel appelle ceci à chaque message reçu par le bot (mode webhook)
import { getBot } from '../lib/bot.js';

// Certaines opérations (ex: kickall sur beaucoup de membres) peuvent prendre du temps.
// 60s est le maximum accepté sur le plan Vercel Hobby pour ce type de fonction.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('Bot Telegram actif (webhook) ✅');
    }
    try {
        const bot = await getBot();
        await bot.handleUpdate(req.body, res);
    } catch (err) {
        console.error('Erreur webhook:', err);
    } finally {
        // Toujours répondre 200 à Telegram, même en cas d'erreur interne,
        // sinon Telegram considère l'update en échec et le renvoie en boucle.
        if (!res.writableEnded) res.status(200).end();
    }
}
