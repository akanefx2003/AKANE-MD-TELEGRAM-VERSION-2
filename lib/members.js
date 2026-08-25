// lib/members.js — suivi des membres de groupe, stocké dans Upstash Redis.
// Nécessaire car Vercel n'a pas de disque persistant entre les invocations,
// et Telegram ne fournit de toute façon aucun moyen de lister tous les membres
// d'un groupe : on ne peut agir que sur ceux qu'on a déjà "vus" passer.
import { redis } from './redis.js';

function key(chatId) { return `members:${chatId}`; }

export async function trackMember(chatId, userId, username) {
    try {
        await redis.hset(key(chatId), {
            [String(userId)]: JSON.stringify({ username: username || null, seenAt: new Date().toISOString() })
        });
    } catch (err) {
        console.error('Erreur trackMember (Redis) :', err.message);
    }
}

export async function untrackMember(chatId, userId) {
    try {
        await redis.hdel(key(chatId), String(userId));
    } catch (err) {
        console.error('Erreur untrackMember (Redis) :', err.message);
    }
}

// Retourne { userId: { username, seenAt } } pour un chat donné
export async function loadMembers(chatId) {
    try {
        const raw = await redis.hgetall(key(chatId));
        if (!raw) return {};
        const out = {};
        for (const [id, val] of Object.entries(raw)) {
            try { out[id] = typeof val === 'string' ? JSON.parse(val) : val; }
            catch { out[id] = { username: null, seenAt: null }; }
        }
        return out;
    } catch (err) {
        console.error('Erreur loadMembers (Redis) :', err.message);
        return {};
    }
}
