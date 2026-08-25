// plugins/tiktok.js
import axios from 'axios';

export default {
    name: 'tiktok',
    description: 'Télécharger une vidéo TikTok — /tiktok [lien]',
    commands: ['tiktok'],
    async handler(bot, ctx, args) {
        const link = args.join(' ').trim();
        if (!link || !link.includes('tiktok.com')) {
            return ctx.reply('❓ Envoie un lien TikTok : /tiktok [lien]');
        }

        const wait = await ctx.reply('⏳ Téléchargement...');

        try {
            const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(link)}`;
            const response = await axios.get(apiUrl, { timeout: 15000 });

            if (!response.data?.data) throw new Error('Aucune vidéo trouvée');

            const { play: videoUrl, title, author } = response.data.data;
            const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 30000 });
            const buffer = Buffer.from(videoRes.data);

            await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
            await ctx.replyWithVideo({ source: buffer }, {
                caption: `🎬 ${title || 'Vidéo TikTok'}\n👤 @${author?.unique_id || 'inconnu'}`
            });
        } catch (err) {
            await ctx.reply(`❌ Erreur lors du téléchargement : ${err.message}`);
        }
    }
};
