// plugins/sticker.js
// Conversion IMAGE → sticker uniquement. La conversion vidéo (ffmpeg) n'est pas incluse
// ici : les binaires natifs ffmpeg sont peu fiables sur l'environnement serverless de Vercel.
import axios from 'axios';
import sharp from 'sharp';

export default {
    name: 'sticker',
    description: 'Créer un sticker depuis une image — réponds à une image avec /sticker',
    commands: ['sticker'],
    async handler(bot, ctx) {
        const photo = ctx.message.photo || ctx.message.reply_to_message?.photo;

        if (!photo) {
            return ctx.reply('❓ Envoie une image avec /sticker en légende, ou réponds à une image avec /sticker.\n\n⚠️ Les vidéos ne sont pas supportées sur cette version.');
        }

        try {
            // Prend la plus grande résolution disponible
            const fileId = photo[photo.length - 1].file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);

            const res = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 20000 });
            const inputBuffer = Buffer.from(res.data);

            const webpBuffer = await sharp(inputBuffer)
                .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .webp()
                .toBuffer();

            await ctx.replyWithSticker({ source: webpBuffer });
        } catch (err) {
            console.error('Erreur sticker:', err.message);
            await ctx.reply('❌ Erreur lors de la création du sticker.');
        }
    }
};
