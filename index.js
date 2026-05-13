const { bot } = require('./src/bot');
const http = require('http');

const PORT = process.env.PORT || 8080;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
const START_TIME = new Date();

function renderDashboard() {
    const uptime = Math.floor((Date.now() - START_TIME.getTime()) / 1000);
    const mode = RENDER_URL ? 'Webhook' : 'Polling';
    const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' });

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Mileage Bot Status</title>
    <style>
        body { font-family: Arial, sans-serif; background: #f4f7fb; margin: 0; padding: 30px; color: #222; }
        .card { max-width: 720px; margin: 0 auto; background: white; border-radius: 16px; padding: 28px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
        h1 { margin-top: 0; color: #1f7a4d; }
        .status { display: inline-block; padding: 8px 14px; border-radius: 999px; background: #d9fbe8; color: #116b3a; font-weight: bold; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 24px; }
        .item { background: #f8fafc; padding: 14px; border-radius: 12px; }
        .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
        .value { font-size: 18px; margin-top: 6px; font-weight: bold; }
        code { background: #eef2ff; padding: 3px 6px; border-radius: 6px; }
        @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="card">
        <h1>🚗 AI Mileage Bot</h1>
        <span class="status">✅ Online</span>
        <div class="grid">
            <div class="item"><div class="label">Mode</div><div class="value">${mode}</div></div>
            <div class="item"><div class="label">Health</div><div class="value">OK</div></div>
            <div class="item"><div class="label">Uptime</div><div class="value">${uptime}s</div></div>
            <div class="item"><div class="label">Malaysia Time</div><div class="value">${now}</div></div>
        </div>
        <p style="margin-top:24px;">Health endpoint: <code>/health</code></p>
        <p>Use Telegram commands: <code>/start</code>, <code>/status</code>, <code>/help</code></p>
    </div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    } else if (req.method === 'POST') {
        bot.webhookCallback('/')(req, res);
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(renderDashboard());
    }
});

const commands = [
    { command: 'start', description: 'Mula guna bot' },
    { command: 'help', description: 'Panduan format input' },
    { command: 'status', description: 'Check bot online/offline' },
    { command: 'today', description: 'Ringkasan mileage hari ini' },
    { command: 'summary', description: 'Ringkasan mileage bulan ini' },
    { command: 'weekly', description: 'Ringkasan minggu ini' },
    { command: 'report', description: 'Laporan bulanan ikut minggu' },
    { command: 'export', description: 'Export laporan PDF' },
    { command: 'editlast', description: 'Edit rekod terakhir' },
    { command: 'undo', description: 'Padam rekod terakhir' },
    { command: 'delete', description: 'Padam rekod ikut row number' },
    { command: 'rate', description: 'Check kadar claim per km' }
];

async function startBot() {
    server.listen(PORT, () => console.log(`✨ Mileage Bot listening on port ${PORT}`));

    await bot.telegram.setMyCommands(commands);
    console.log('✅ Telegram command menu updated');

    if (RENDER_URL) {
        console.log(`🚀 AI Mileage starting in WEBHOOK mode on ${RENDER_URL}`);
        await bot.telegram.setWebhook(`${RENDER_URL}/`);
    } else {
        console.log('🚀 AI Mileage starting in POLLING mode...');
        await bot.launch();
    }
}

startBot().catch(err => {
    console.error('❌ Failed to start bot:', err.message);
});

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    server.close();
});

process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    server.close();
});
