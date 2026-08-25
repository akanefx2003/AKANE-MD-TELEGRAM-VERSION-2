// plugins/kickall.js
export default {
    name: 'kickall',
    description: 'Retirer tous les membres suivis, sauf les admins (voir limites Telegram avec /help)',
    commands: ['kickall'],
    async handler(bot, ctx, args, { isAdmin, loadMembers, untrackMember }) {
        if (ctx.chat.type === 'private') return ctx.reply('❌ Commande réservée aux groupes.');
        if (!(await isAdmin(ctx))) return ctx.reply('❌ Réservé aux admins du groupe.');

        const chatId  = ctx.chat.id;
        const members = await loadMembers(chatId);
        const ids     = Object.keys(members);

        if (ids.length === 0) {
            return ctx.reply(
                "ℹ️ Aucun membre suivi pour l'instant.\n\n" +
                "⚠️ Telegram ne permet pas à un bot de lister tous les membres d'un groupe — " +
                "je ne peux retirer que les membres que j'ai déjà \"vus\" passer " +
                "(message envoyé, ou entrée dans le groupe depuis que je suis actif ici)."
            );
        }

        let admins = [];
        try {
            const admList = await ctx.telegram.getChatAdministrators(chatId);
            admins = admList.map(a => a.user.id);
        } catch {}

        const botId = ctx.botInfo?.id;
        let targets = ids.map(Number).filter(id => !admins.includes(id) && id !== botId);

        if (targets.length === 0) {
            return ctx.reply('ℹ️ Aucun membre à retirer (il ne reste que des admins parmi les membres suivis).');
        }

        // Limite Vercel (plan gratuit) : 60s max par appel. On retire ~2 membres/seconde,
        // donc on plafonne le nombre traité en un seul /kickall pour rester dans le temps imparti.
        const MAX_PER_RUN = 100;
        const truncated = targets.length > MAX_PER_RUN;
        targets = targets.slice(0, MAX_PER_RUN);

        await ctx.reply(
            `💥 Suppression en cours... (${targets.length} membre(s) suivi(s))` +
            (truncated ? `\n⚠️ Plus de ${MAX_PER_RUN} membres suivis : relance /kickall plusieurs fois pour finir le reste.` : '')
        );

        let removed = 0, failed = 0;
        for (const id of targets) {
            try {
                await ctx.telegram.banChatMember(chatId, id);
                await ctx.telegram.unbanChatMember(chatId, id);
                await untrackMember(chatId, id);
                removed++;
            } catch {
                failed++;
            }
            await new Promise(r => setTimeout(r, 400));
        }

        await ctx.reply(`✅ Terminé — ${removed} retiré(s), ${failed} échec(s).`);
    }
};
