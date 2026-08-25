// plugins/uptime.js
export default {
    name: 'uptime',
    description: 'Voir le statut du bot',
    commands: ['uptime'],
    async handler(bot, ctx) {
        const uptimeSeconds = process.uptime();
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = Math.floor(uptimeSeconds % 60);
        const ramUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

        // Sur Vercel (serverless), chaque instance peut être recréée à tout moment —
        // cet "uptime" reflète la durée depuis le dernier démarrage à froid, pas une disponibilité continue.
        await ctx.reply(
            `⏳ *Statut du bot*\n\n` +
            `📡 En ligne ✅\n` +
            `⏱️ Instance active depuis : ${minutes}m ${seconds}s\n` +
            `📂 Mémoire : ${ramUsage} MB`,
            { parse_mode: 'Markdown' }
        );
    }
};
