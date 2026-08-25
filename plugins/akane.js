// plugins/anime.js
import axios from 'axios';

const API_URL = 'https://christus-api.vercel.app/anime/anime';
const TRANSLATE_API = 'https://translate.googleapis.com/translate_a/single';

async function translateToFrench(text) {
    if (!text || text.length < 5) return text;
    try {
        const response = await axios.get(TRANSLATE_API, {
            params: { client: 'gtx', sl: 'auto', tl: 'fr', dt: 't', q: text },
            timeout: 10000
        });
        if (response.data && response.data[0]) {
            return response.data[0].map(seg => seg[0] || '').join('') || text;
        }
        return text;
    } catch {
        return text;
    }
}

const genreFr = {
    'Action': 'Action', 'Adventure': 'Aventure', 'Fantasy': 'Fantastique', 'Comedy': 'Comédie',
    'Drama': 'Drame', 'Romance': 'Romance', 'Sci-Fi': 'Science-Fiction', 'Slice of Life': 'Tranche de vie',
    'Mystery': 'Mystère', 'Horror': 'Horreur', 'Thriller': 'Thriller', 'Supernatural': 'Surnaturel',
    'Psychological': 'Psychologique', 'Sports': 'Sport', 'Music': 'Musique', 'Historical': 'Historique',
    'Martial Arts': 'Arts martiaux', 'Mecha': 'Mecha'
};
const typeFr = { 'TV': 'Série TV', 'Movie': 'Film', 'OVA': 'OVA', 'ONA': 'ONA', 'Special': 'Spécial' };
const statusFr = { 'Finished Airing': 'Terminé', 'Currently Airing': 'En cours', 'Not yet aired': 'Pas encore diffusé' };

export default {
    name: 'anime',
    description: 'Rechercher un anime — /anime [titre]',
    commands: ['anime'],
    async handler(bot, ctx, args) {
        const query = args.join(' ').trim();
        if (!query) return ctx.reply('❓ Utilisation : /anime [nom de l\'anime]\nExemple : /anime Naruto');

        try {
            const res = await axios.get(API_URL, { params: { q: query, limit: 1, sfw: true }, timeout: 15000 });
            const results = res.data?.status === true ? res.data.results : [];
            if (!results?.length) return ctx.reply(`❌ Aucun anime trouvé pour "${query}"`);

            const anime = results[0];
            let synopsis = (anime.synopsis || 'Synopsis non disponible.').replace(/\[.*?\]/g, '').trim();
            synopsis = await translateToFrench(synopsis);
            if (synopsis.length > 900) synopsis = synopsis.slice(0, 900) + '...';

            const genres = (anime.genres || []).map(g => genreFr[g] || g).join(', ') || 'Non disponible';
            const caption =
                `🎬 *${anime.title}*\n\n` +
                `🌐 Type : ${typeFr[anime.type] || anime.type || 'Inconnu'}\n` +
                `📺 Épisodes : ${anime.episodes || '?'}\n` +
                `📅 Année : ${anime.year || '???'}\n` +
                `⭐ Note : ${anime.score || '?'}/10\n` +
                `📊 Statut : ${statusFr[anime.status] || anime.status || 'Inconnu'}\n` +
                `🏷️ Genres : ${genres}\n\n` +
                `📖 ${synopsis}`;

            if (anime.image) {
                await ctx.replyWithPhoto({ url: anime.image }, { caption });
            } else {
                await ctx.reply(caption);
            }
        } catch (err) {
            console.error('Erreur anime:', err.message);
            await ctx.reply('❌ Erreur lors de la recherche, réessaie plus tard.');
        }
    }
};
