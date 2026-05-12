const { bot } = require('./src/bot');
const http = require('http');

const PORT = process.env.PORT || 8080;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL; 

// 1. Health Check & Webhook Handler
const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/ping') {
        res.writeHead(200);
        res.end('OK');
    } else {
        bot.webhookCallback('/')(req, res);
    }
});

if (RENDER_URL) {
    // PRODUCTION: Webhook mode (Render)
    console.log(`🚀 AI Mileage starting in WEBHOOK mode on ${RENDER_URL}`);
    bot.telegram.setWebhook(`${RENDER_URL}/`);
    server.listen(PORT, () => {
        console.log(`✨ Mileage Bot is listening on port ${PORT}`);
    });
} else {
    // DEVELOPMENT: Polling mode (Local)
    console.log('🚀 AI Mileage starting in POLLING mode...');
    bot.launch()
        .then(() => console.log('✨ Mileage Bot is online (Polling)!'))
        .catch(err => console.error('❌ Launch failed:', err));
    
    server.listen(PORT);
}

// Enable graceful stop
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    server.close();
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    server.close();
});
