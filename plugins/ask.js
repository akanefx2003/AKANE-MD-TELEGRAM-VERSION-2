// plugins/ask.js — assistant IA généraliste, alternative normale à darkgpt.js
import axios from 'axios';

export default {
    name: 'ask',
    description: 'Poser une question à une IA généraliste — /ask [question]',
    commands: ['ask'],
    async handler(bot, ctx, args) {
        const query = args.join(' ').trim();
        if (!query) return ctx.reply('❓ Utilisation : /ask [ta question]');

        const wait = await ctx.reply('⏳ Réflexion en cours...');

        try {
            const apiUrl = `https://digix-core.vercel.app/ia/venice?question=${encodeURIComponent(query + ' (Réponds en français)')}`;
            const response = await axios.get(apiUrl, { timeout: 20000 });

            let reply = '';
            if (response.data && typeof response.data === 'object') {
                reply = response.data.réponse || response.data.result || response.data.response || '';
            } else {
                reply = String(response.data || '');
            }
            if (!reply) throw new Error('Réponse vide');

            await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
            await ctx.reply(reply.slice(0, 3500));
        } catch (err) {
            await ctx.reply('❌ Erreur de connexion avec l\'IA, réessaie plus tard.');
        }
    }
};
