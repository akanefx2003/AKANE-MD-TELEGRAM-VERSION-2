// setup-webhook.js — à lancer UNE FOIS après chaque déploiement (ou si l'URL Vercel change).
// Usage : node setup-webhook.js   (avec un fichier .env contenant BOT_TOKEN et WEBHOOK_URL)
import 'dotenv/config';
import { Telegraf } from 'telegraf';

const TOKEN = process.env.BOT_TOKEN;
const URL   = process.env.WEBHOOK_URL; // ex: https://ton-projet.vercel.app/api/webhook

if (!TOKEN || !URL) {
    console.error('❌ BOT_TOKEN et WEBHOOK_URL doivent être définis dans .env');
    process.exit(1);
}

const bot = new Telegraf(TOKEN);

const result = await bot.telegram.setWebhook(URL);
console.log(result ? '✅ Webhook configuré avec succès ->' : '❌ Échec de la configuration ->', URL);

const info = await bot.telegram.getWebhookInfo();
console.log('ℹ️ Infos webhook actuelles :', info);

process.exit(0);
