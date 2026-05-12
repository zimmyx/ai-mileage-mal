const { bot } = require('./src/bot');
const http = require('http');

const PORT = process.env.PORT || 8080;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

const server = http.createServer((req, res) => {
    // Better Health Check
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health' || req.url === '/ping')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('AI Mileage Bot is Online and Healthy 🚀');
        return;
    }

    if (req.method === 'POST') {
        bot.webhookCallback('/')(req, res);
    } else {
        res.writeHead(404);
        res.end();
    }
});

if (RENDER_URL) {
    console.log(`🚀 AI Mileage starting in WEBHOOK mode on ${RENDER_URL}`);
    bot.telegram.setWebhook(`${RENDER_URL}/`);
    server.listen(PORT, () => {
        console.log(`✨ Mileage Bot is listening on port ${PORT}`);
    });
} else {
    console.log('🚀 AI Mileage starting in POLLING mode...');
    bot.launch()
        .then(() => console.log('✨ Mileage Bot is online (Polling)!'))
        .catch(err => console.error('❌ Launch failed:', err));
    
    server.listen(PORT);
}

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    server.close();
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    server.close();
});
