// plugins/bible.js
import axios from 'axios';

const bibleBooks = {
    'genèse': 'Genesis', 'genese': 'Genesis', 'exode': 'Exodus', 'lévitique': 'Leviticus', 'levitique': 'Leviticus',
    'nombres': 'Numbers', 'deutéronome': 'Deuteronomy', 'deuteronome': 'Deuteronomy', 'josué': 'Joshua', 'josue': 'Joshua',
    'juges': 'Judges', 'ruth': 'Ruth', '1 samuel': '1 Samuel', '2 samuel': '2 Samuel', '1 rois': '1 Kings', '2 rois': '2 Kings',
    '1 chroniques': '1 Chronicles', '2 chroniques': '2 Chronicles', 'esdras': 'Ezra', 'néhémie': 'Nehemiah', 'nehemie': 'Nehemiah',
    'esther': 'Esther', 'job': 'Job', 'psaumes': 'Psalms', 'psaume': 'Psalms', 'proverbes': 'Proverbs',
    'ecclésiaste': 'Ecclesiastes', 'ecclesiaste': 'Ecclesiastes', 'cantique': 'Song of Solomon', 'ésaïe': 'Isaiah', 'esaie': 'Isaiah',
    'jérémie': 'Jeremiah', 'jeremie': 'Jeremiah', 'lamentations': 'Lamentations', 'ézéchiel': 'Ezekiel', 'ezechiel': 'Ezekiel',
    'daniel': 'Daniel', 'osée': 'Hosea', 'osee': 'Hosea', 'joël': 'Joel', 'joel': 'Joel', 'amos': 'Amos', 'abdias': 'Obadiah',
    'jonas': 'Jonah', 'michée': 'Micah', 'michee': 'Micah', 'nahum': 'Nahum', 'habacuc': 'Habakkuk', 'sophonie': 'Zephaniah',
    'aggée': 'Haggai', 'aggee': 'Haggai', 'zacharie': 'Zechariah', 'malachie': 'Malachi', 'matthieu': 'Matthew', 'marc': 'Mark',
    'luc': 'Luke', 'jean': 'John', 'actes': 'Acts', 'romains': 'Romans', '1 corinthiens': '1 Corinthians',
    '2 corinthiens': '2 Corinthians', 'galates': 'Galatians', 'éphésiens': 'Ephesians', 'ephesiens': 'Ephesians',
    'philippiens': 'Philippians', 'colossiens': 'Colossians', '1 thessaloniciens': '1 Thessalonians',
    '2 thessaloniciens': '2 Thessalonians', '1 timothée': '1 Timothy', '2 timothée': '2 Timothy', 'tite': 'Titus',
    'philémon': 'Philemon', 'philemon': 'Philemon', 'hébreux': 'Hebrews', 'hebreux': 'Hebrews', 'jacques': 'James',
    '1 pierre': '1 Peter', '2 pierre': '2 Peter', '1 jean': '1 John', '2 jean': '2 John', '3 jean': '3 John',
    'jude': 'Jude', 'apocalypse': 'Revelation'
};

function translateReference(ref) {
    ref = ref.toLowerCase().trim();
    for (const [fr, en] of Object.entries(bibleBooks)) {
        if (ref.startsWith(fr)) return en + ref.substring(fr.length);
    }
    return ref;
}

export default {
    name: 'bible',
    description: 'Chercher un verset biblique — /bible [référence]',
    commands: ['bible'],
    async handler(bot, ctx, args) {
        const ref = args.join(' ').trim();
        if (!ref) return ctx.reply('❓ Utilisation : /bible [référence]\nExemple : /bible Jean 3:16');

        try {
            const englishRef = translateReference(ref);
            const apiUrl = `https://labs.bible.org/api/?passage=${encodeURIComponent(englishRef)}&type=json`;
            const response = await axios.get(apiUrl, { timeout: 10000 });

            if (!response.data?.length) throw new Error('Verset non trouvé');
            const v = response.data[0];
            const englishText = v.text.replace(/\(.*?\)/g, '').trim();

            const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fr&dt=t&q=${encodeURIComponent(englishText)}`;
            const tRes = await axios.get(translateUrl, { timeout: 10000 });
            const frenchText = tRes.data?.[0]?.map(item => item[0]).join(' ') || '';
            if (!frenchText) throw new Error('Traduction échouée');

            await ctx.reply(`📖 *${v.bookname} ${v.chapter}:${v.verse}*\n\n"${frenchText}"`, { parse_mode: 'Markdown' });
        } catch (err) {
            await ctx.reply(`❌ Verset non trouvé pour "${ref}"`);
        }
    }
};
