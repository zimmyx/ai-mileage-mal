const { bot } = require('./src/bot');
const http = require('http');

const PORT = process.env.PORT || 8080;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
    } else if (req.method === 'POST') {
        bot.webhookCallback('/')(req, res);
    } else {
        res.writeHead(200);
        res.end('AI Mileage Bot is Running');
    }
});

const commands = [
    { command: 'start', description: 'Mula guna bot' },
    { command: 'status', description: 'Check bot online/offline' },
    { command: 'summary', description: 'Ringkasan mileage bulan ini' },
    { command: 'weekly', description: 'Ringkasan minggu ini' },
    { command: 'report', description: 'Laporan bulanan ikut minggu' },
    { command: 'rate', description: 'Check kadar claim per km' }
];

async function startBot() {
    await bot.telegram.setMyCommands(commands);
    console.log('✅ Telegram command menu updated');

    if (RENDER_URL) {
        console.log(`🚀 AI Mileage starting in WEBHOOK mode on ${RENDER_URL}`);
        await bot.telegram.setWebhook(`${RENDER_URL}/`);
        server.listen(PORT, () => console.log(`✨ Mileage Bot listening on port ${PORT}`));
    } else {
        console.log('🚀 AI Mileage starting in POLLING mode...');
        await bot.launch();
        server.listen(PORT, () => console.log(`✨ Mileage Bot listening on port ${PORT}`));
    }
}

startBot().catch(err => {
    console.error('❌ Failed to start bot:', err.message);
    process.exit(1);
});

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    server.close();
});

process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    server.close();
});
