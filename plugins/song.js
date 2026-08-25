// plugins/song.js
import yts from 'yt-search';
import axios from 'axios';

const API_HOST = 'youtube-mp36.p.rapidapi.com';
let keyIndex = 0;

function getApiKeys() {
    return (process.env.RAPIDAPI_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
}

async function getAudioBuffer(videoId) {
    const keys = getApiKeys();
    if (keys.length === 0) throw new Error('Aucune clé RAPIDAPI_KEYS configurée');

    const apiKey = keys[keyIndex % keys.length];
    keyIndex++;

    const dlRes = await axios.get(`https://${API_HOST}/dl`, {
        params: { id: videoId },
        headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': API_HOST },
        timeout: 20000
    });

    const data = dlRes.data;
    if (data?.status === 'processing') {
        await new Promise(r => setTimeout(r, 2500));
        return getAudioBuffer(videoId);
    }
    if (data?.status !== 'ok' || !data?.link) throw new Error('Échec du téléchargement (source indisponible)');

    // On télécharge nous-mêmes le fichier, avec les en-têtes que le service RapidAPI exige
    // (Referer/User-Agent) — sans eux, le serveur tiers refuse la requête directe de Telegram
    // et renvoie une réponse invalide (fichier illisible, bloqué à 0:00).
    const audioRes = await axios.get(data.link, {
        responseType: 'arraybuffer',
        timeout: 45000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': `https://${API_HOST}/` }
    });

    return { buffer: Buffer.from(audioRes.data), title: data.title };
}

export default {
    name: 'song',
    description: 'Télécharger une musique depuis YouTube — /song [titre]',
    commands: ['song'],
    async handler(bot, ctx, args) {
        const query = args.join(' ').trim();
        if (!query) return ctx.reply('❓ Utilisation : /song [titre de la musique]');

        const searching = await ctx.reply('🔍 Recherche en cours...');

        const resultat = await yts(query);
        if (!resultat?.videos?.length) {
            return ctx.telegram.editMessageText(ctx.chat.id, searching.message_id, undefined, `❌ "${query}" introuvable sur YouTube`);
        }

        const video = resultat.videos[0];
        await ctx.telegram.editMessageText(ctx.chat.id, searching.message_id, undefined, `⏳ Téléchargement de "${video.title}"...`);

        try {
            const { buffer, title } = await getAudioBuffer(video.videoId);
            const caption = `🎵 ${title}\n⏱️ ${video.timestamp}`;

            let lastErr = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await ctx.replyWithAudio({ source: buffer, filename: `${title}.mp3` }, { title, caption });
                    return;
                } catch (err) {
                    lastErr = err;
                    if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
                }
            }

            try {
                await ctx.replyWithDocument({ source: buffer, filename: `${title}.mp3` }, { caption });
            } catch (err2) {
                await ctx.reply(`❌ Échec de l'envoi après plusieurs tentatives : ${lastErr?.message || err2.message}`);
            }
        } catch (err) {
            await ctx.reply(`❌ Erreur : ${err.message}`);
        }
    }
};
