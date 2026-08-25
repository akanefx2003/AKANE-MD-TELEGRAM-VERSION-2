// lib/bot.js — instance du bot + système de plugins, en mode webhook (pas de bot.launch()).
import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadMembers, trackMember, untrackMember } from './members.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error('BOT_TOKEN manquant dans les variables d\'environnement Vercel');

export const bot = new Telegraf(TOKEN);

async function isAdmin(ctx) {
    if (ctx.chat.type === 'private') return true;
    try {
        const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
        return member.status === 'administrator' || member.status === 'creator';
    } catch {
        return false;
    }
}

bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private' && ctx.from) {
        await trackMember(ctx.chat.id, ctx.from.id, ctx.from.username);
    }
    return next();
});

bot.on('chat_member', async (ctx) => {
    const chatId = ctx.chat.id;
    const update = ctx.update.chat_member;
    const user   = update.new_chat_member.user;
    const status = update.new_chat_member.status;
    if (status === 'member' || status === 'administrator' || status === 'creator') {
        await trackMember(chatId, user.id, user.username);
    } else if (status === 'left' || status === 'kicked') {
        await untrackMember(chatId, user.id);
    }
});

const plugins = new Map();
let loaded = false;

async function loadAllPlugins() {
    if (loaded) return; // réutilisé sur les invocations "chaudes" du serverless
    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));
    for (const file of files) {
        try {
            const mod    = await import(pathToFileURL(path.join(PLUGINS_DIR, file)).href);
            const plugin = mod.default || mod;
            if (!plugin.name || !plugin.commands || !plugin.handler) {
                throw new Error('Plugin invalide : doit exporter { name, commands, handler }');
            }
            plugins.set(plugin.name, plugin);
            for (const cmd of plugin.commands) {
                bot.command(cmd, async (ctx) => {
                    const args = ctx.message.text.trim().split(/\s+/).slice(1);
                    try {
                        await plugin.handler(bot, ctx, args, { plugins, isAdmin, loadMembers, trackMember, untrackMember, cmd });
                    } catch (err) {
                        console.error(`❌ Erreur plugin "${plugin.name}":`, err.message);
                        ctx.reply(`❌ Erreur : ${err.message}`).catch(() => {});
                    }
                });
            }
            console.log(`✅ Plugin chargé : ${plugin.name} (${plugin.commands.join(', ')})`);
        } catch (err) {
            console.error(`❌ Erreur chargement plugin ${file}:`, err.message);
        }
    }
    loaded = true;
    console.log(`📦 ${plugins.size} plugin(s) chargé(s)`);
}

export async function getBot() {
    await loadAllPlugins();
    return bot;
}
