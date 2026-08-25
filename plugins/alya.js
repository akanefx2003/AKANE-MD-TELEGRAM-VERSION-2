// plugins/alya.js
import axios from 'axios';

const waitingMessages = [
    "💕 Je réfléchis à ta question, mon amour...", "🌸 Un instant, mon cœur...",
    "✨ Je prépare une belle réponse pour toi...", "🥰 Ta question me touche..."
];

const userHistories = new Map();
let currentApiIndex = 0;

const stablediffusionAPIs = [
    { name: 'sd-fr-1', url: 'https://stablediffusion.fr/gpt4/predict2', referer: 'https://stablediffusion.fr/chatgpt4' },
    { name: 'sd-fr-2', url: 'https://stablediffusion.fr/gpt4/predict', referer: 'https://stablediffusion.fr/chatgpt4' },
    { name: 'sd-fr-3', url: 'https://stablediffusion.fr/gpt3/predict2', referer: 'https://stablediffusion.fr/chatgpt3' },
    { name: 'sd-fr-4', url: 'https://stablediffusion.fr/gpt3/predict', referer: 'https://stablediffusion.fr/chatgpt3' }
];
const backupAPIs = [
    { name: 'blackbox', url: 'https://www.blackbox.ai/api/chat',
      body: p => ({ messages: [{ role: 'user', content: p }], model: 'llama-3.1-8b' }),
      extract: d => typeof d === 'string' && d.length > 10 ? d : null }
];

async function callStableDiffusion(prompt, api) {
    try {
        const refererResp = await axios.get(api.referer, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const setCookie = refererResp.headers?.['set-cookie'];
        const cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : undefined;

        const { data } = await axios.post(api.url, { prompt }, {
            headers: {
                accept: '*/*', 'content-type': 'application/json', origin: 'https://stablediffusion.fr',
                referer: api.referer, ...(cookieHeader ? { cookie: cookieHeader } : {}), 'user-agent': 'Mozilla/5.0'
            },
            timeout: 25000
        });
        if (data?.message?.length > 5) return data.message;
        return null;
    } catch {
        return null;
    }
}

async function callBackupAPI(prompt, api) {
    try {
        const response = await axios.post(api.url, api.body(prompt), { timeout: 20000, headers: { 'Content-Type': 'application/json' } });
        const reply = api.extract(response.data);
        return (reply && reply.length > 10 && !reply.includes('<html>')) ? reply : null;
    } catch {
        return null;
    }
}

async function callAlyaGPT(prompt) {
    let attempts = 0;
    const maxAttempts = stablediffusionAPIs.length + backupAPIs.length;
    while (attempts < maxAttempts) {
        const sdApi = stablediffusionAPIs[currentApiIndex % stablediffusionAPIs.length];
        currentApiIndex++;
        let reply = await callStableDiffusion(prompt, sdApi);
        if (reply && !reply.includes('<html>')) return reply;
        attempts++;
        if (attempts >= stablediffusionAPIs.length) {
            for (const backup of backupAPIs) {
                reply = await callBackupAPI(prompt, backup);
                if (reply) return reply;
                attempts++;
            }
        }
    }
    throw new Error('Toutes les API sont indisponibles');
}

export default {
    name: 'alya',
    description: 'Discuter avec Alya, ta petite amie virtuelle — /alya [message]',
    commands: ['alya', 'alyahistory', 'alyareset'],
    async handler(bot, ctx, args, { cmd }) {
        const userId = ctx.from.id;

        if (cmd === 'alyareset') {
            userHistories.delete(userId);
            return ctx.reply('✅ Historique Alya réinitialisé ! 💕');
        }

        if (cmd === 'alyahistory') {
            const h = userHistories.get(userId);
            if (!h?.messages.length) return ctx.reply('💕 Aucune discussion pour l\'instant, mon cœur.');
            const lines = h.messages.map(m => `${m.role === 'user' ? '👤' : '💕'} ${m.content.slice(0, 60)}`);
            return ctx.reply(`🌸 *Historique (${h.messages.length} messages)*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
        }

        const query = args.join(' ').trim();
        if (!query) return ctx.reply('💕 Utilisation : /alya [ton message]\nExemple : /alya comment s\'est passée ta journée ?');

        await ctx.reply(waitingMessages[Math.floor(Math.random() * waitingMessages.length)]);

        let history = userHistories.get(userId) || { messages: [] };
        history.messages.push({ role: 'user', content: query });
        if (history.messages.length > 10) history.messages = history.messages.slice(-10);

        let prompt = '';
        for (const m of history.messages.slice(0, -1)) {
            prompt += `${m.role === 'user' ? 'Mon amour' : 'Alya'}: ${m.content}\n`;
        }
        prompt += `Mon amour: ${query}\nAlya: Tu es Alya, une petite amie douce, affectueuse et attentionnée. Utilise des mots doux (mon cœur, mon chéri, mon amour). Réponds avec tendresse en 3-4 lignes, en français.`;

        try {
            let reply = await callAlyaGPT(prompt);
            reply = reply.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, '').replace(/\n+/g, '\n').trim();
            if (reply.length > 800) reply = reply.slice(0, 797) + '...';

            history.messages.push({ role: 'assistant', content: reply });
            userHistories.set(userId, history);

            await ctx.reply(`💕 ${reply}`);
        } catch (err) {
            await ctx.reply('💔 Oh mon cœur, l\'API ne répond pas. Réessaie dans un instant.');
        }
    }
};
