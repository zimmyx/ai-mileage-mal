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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Sistem Rekod Mileage AI</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; }
        body { 
            font-family: 'Inter', sans-serif; 
            margin: 0; padding: 20px; 
            min-height: 100vh;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container { width: 100%; max-width: 600px; }
        .card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            padding: 32px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.4);
            animation: fadeIn 0.8s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .header { text-align: center; margin-bottom: 32px; }
        .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 800;
            background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }
        .status-badge {
            display: inline-block;
            margin-top: 12px;
            padding: 6px 16px;
            border-radius: 50px;
            background: rgba(16, 185, 129, 0.15);
            color: #34d399;
            font-size: 14px;
            font-weight: 600;
            border: 1px solid rgba(16, 185, 129, 0.3);
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
        }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .stat-box {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 16px;
            padding: 20px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            transition: transform 0.3s ease, background 0.3s ease;
        }
        .stat-box:hover {
            transform: translateY(-5px);
            background: rgba(255, 255, 255, 0.08);
        }
        .stat-label {
            font-size: 13px;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .stat-value { font-size: 22px; font-weight: 800; color: #fff; }
        .footer { margin-top: 32px; text-align: center; font-size: 14px; color: #64748b; }
        @media (max-width: 480px) {
            .grid { grid-template-columns: 1fr; }
            .card { padding: 24px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="header">
                <h1>Sistem Mileage AI</h1>
                <div class="status-badge">● Sistem Aktif</div>
            </div>
            <div class="grid">
                <div class="stat-box">
                    <div class="stat-label">Uptime</div>
                    <div class="stat-value">${uptime}s</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Mode API</div>
                    <div class="stat-value">${mode}</div>
                </div>
                <div class="stat-box" style="grid-column: 1 / -1;">
                    <div class="stat-label">Waktu Malaysia</div>
                    <div class="stat-value">${now}</div>
                </div>
            </div>
            <div class="footer">
                Sistem sedang berjalan dan sedia menerima rekod dari Telegram.
            </div>
        </div>
    </div>
</body>
</html>`;
}

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'mileage-secret-token-123';

const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    } else if (req.method === 'POST') {
        if (req.headers['x-telegram-bot-api-secret-token'] === WEBHOOK_SECRET) {
            bot.webhookCallback('/')(req, res);
        } else {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
        }
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
        await bot.telegram.setWebhook(`${RENDER_URL}/`, { secret_token: WEBHOOK_SECRET });
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
