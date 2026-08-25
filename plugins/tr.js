// plugins/translate.js — fusionne tr.js et traduit.js (même chose, deux noms différents à l'origine)
import axios from 'axios';

const languages = {
    fr: '🇫🇷 Français', en: '🇬🇧 Anglais', es: '🇪🇸 Espagnol', de: '🇩🇪 Allemand', it: '🇮🇹 Italien',
    pt: '🇵🇹 Portugais', nl: '🇳🇱 Néerlandais', ru: '🇷🇺 Russe', ja: '🇯🇵 Japonais', ko: '🇰🇷 Coréen',
    zh: '🇨🇳 Chinois', ar: '🇸🇦 Arabe', hi: '🇮🇳 Hindi', tr: '🇹🇷 Turc', th: '🇹🇭 Thaï', vi: '🇻🇳 Vietnamien'
};

export default {
    name: 'translate',
    description: 'Traduire un texte — /tr [langue] [texte] (ou réponds à un message)',
    commands: ['tr', 'traduit'],
    async handler(bot, ctx, args) {
        const quotedText = ctx.message.reply_to_message?.text;
        const targetLang = args[0]?.toLowerCase();

        if (!targetLang) {
            const list = Object.entries(languages).map(([code, name]) => `${name} : \`${code}\``).join('\n');
            return ctx.reply(
                `🌐 *Traducteur*\n\n/tr [langue] [texte]\n/tr [langue] (en réponse à un message)\n\nExemple : /tr en Bonjour\n\n*Langues :*\n${list}`,
                { parse_mode: 'Markdown' }
            );
        }

        const textToTranslate = quotedText || args.slice(1).join(' ').trim();
        if (!textToTranslate) return ctx.reply('❓ Indique un texte, ou réponds à un message avec /tr [langue]');

        try {
            const res = await axios.get('https://translate.googleapis.com/translate_a/single', {
                params: { client: 'gtx', sl: 'auto', tl: targetLang, dt: 't', q: textToTranslate },
                timeout: 8000
            });
            if (res.data?.[0]) {
                const translated = res.data[0].map(seg => seg[0] || '').join('');
                return ctx.reply(`🌐 *${languages[targetLang] || targetLang}*\n\n${translated}`, { parse_mode: 'Markdown' });
            }
            throw new Error('empty');
        } catch {
            try {
                const res2 = await axios.get('https://api.mymemory.translated.net/get', {
                    params: { q: textToTranslate, langpair: `auto|${targetLang}` },
                    timeout: 8000
                });
                const translated = res2.data?.responseData?.translatedText;
                if (translated) return ctx.reply(`🌐 *${languages[targetLang] || targetLang}*\n\n${translated}`, { parse_mode: 'Markdown' });
            } catch {}
            await ctx.reply('❌ Traduction indisponible pour le moment, réessaie plus tard.');
        }
    }
};
