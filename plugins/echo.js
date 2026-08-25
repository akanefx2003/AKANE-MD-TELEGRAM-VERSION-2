// plugins/echo.js
// Version adaptée à Vercel : l'original (jusqu'à 500 messages sur ~1h en tâche de fond)
// n'est pas possible en serverless — chaque invocation s'arrête après sa réponse.
// Ici : envoi de plusieurs messages dans la MÊME exécution, plafonné pour rester
// sous la limite de temps Vercel (maxDuration).
const MAX_COUNT = 6;
const INTERVAL_MS = 4000;

export default {
    name: 'echo',
    description: `Répéter un texte plusieurs fois (max ${MAX_COUNT} sur Vercel) — /echo [nombre] [texte]`,
    commands: ['echo'],
    async handler(bot, ctx, args) {
        if (!args[0]) {
            return ctx.reply(
                `🔁 *ECHO*\n\n` +
                `Utilisation : /echo [nombre] [texte]\n` +
                `Exemple : /echo 3 Salut|École|CV (les textes séparés par | s'alternent)\n\n` +
                `⚠️ Limité à ${MAX_COUNT} messages sur cette version (contrainte technique Vercel — ` +
                `impossible de faire tourner une tâche en arrière-plan sur plusieurs minutes en serverless).`,
                { parse_mode: 'Markdown' }
            );
        }

        const count = parseInt(args[0]);
        const rawText = args.slice(1).join(' ').trim();

        if (isNaN(count) || count < 1) return ctx.reply('❌ Nombre invalide.');
        if (!rawText) return ctx.reply('❌ Texte manquant. Exemple : /echo 3 Salut');
        if (count > MAX_COUNT) {
            return ctx.reply(`❌ Maximum ${MAX_COUNT} messages sur cette version (limite de temps Vercel).`);
        }

        const texts = rawText.split('|').map(t => t.trim()).filter(Boolean);

        for (let i = 0; i < count; i++) {
            await ctx.reply(texts[i % texts.length]);
            if (i < count - 1) await new Promise(r => setTimeout(r, INTERVAL_MS));
        }
    }
};
