// plugins/url.js
import axios from 'axios';
import FormData from 'form-data';
import { fileTypeFromBuffer } from 'file-type';

async function uploadToCrysnovax(buffer, fileName) {
    const form = new FormData();
    form.append('file', buffer, { filename: fileName });
    const res = await axios.post('https://cdn.crysnovax.link/upload', form, {
        headers: { ...form.getHeaders() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 20000
    });
    let url = res.data?.url || res.data?.link || res.data;
    if (typeof url === 'object') url = url.url || url.link || JSON.stringify(url);
    return url ? String(url).trim() : null;
}

function extractMedia(msg) {
    if (!msg) return null;
    if (msg.photo) return { type: 'photo', fileId: msg.photo[msg.photo.length - 1].file_id };
    if (msg.video) return { type: 'video', fileId: msg.video.file_id };
    if (msg.audio) return { type: 'audio', fileId: msg.audio.file_id };
    if (msg.voice) return { type: 'audio', fileId: msg.voice.file_id };
    if (msg.document) return { type: 'document', fileId: msg.document.file_id, fileName: msg.document.file_name };
    return null;
}

export default {
    name: 'url',
    description: 'Générer un lien direct pour un média — réponds à un fichier avec /url',
    commands: ['url'],
    async handler(bot, ctx) {
        const media = extractMedia(ctx.message.reply_to_message) || extractMedia(ctx.message);

        if (!media) {
            return ctx.reply('❓ Réponds à une image, vidéo, audio ou document avec /url pour générer son lien direct.');
        }

        const wait = await ctx.reply('⏳ Upload en cours...');

        try {
            const fileLink = await ctx.telegram.getFileLink(media.fileId);
            const res = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 30000 });
            const buffer = Buffer.from(res.data);

            let extension = 'bin';
            try {
                const type = await fileTypeFromBuffer(buffer);
                extension = type?.ext || media.fileName?.split('.').pop() || 'bin';
            } catch {
                extension = media.fileName?.split('.').pop() || 'bin';
            }

            const link = await uploadToCrysnovax(buffer, `akane_${Date.now()}.${extension}`);
            const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);

            await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
            await ctx.reply(`✅ *Lien généré !*\n\n🌐 ${link}\n⚖️ ${sizeMB} MB`, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('Erreur url:', err.message);
            await ctx.reply(`❌ Échec de l'upload : ${err.message}`);
        }
    }
};
