const { Telegraf } = require('telegraf');
const { processMileage } = require('./ai');
const { logMileage, getMileageSummary, getWeeklySummary, getMonthlyReport } = require('./sheets');
const dotenv = require('dotenv');

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_MILEAGE_BOT_TOKEN);

bot.start((ctx) => {
    ctx.reply(
        '🚗 *AI Mileage by Mal*\n' +
        'Log perjalanan anda sepantas kilat!\n\n' +
        '✍️ *Teks:* "Office ke KLCC 30km"\n' +
        '📝 Hantar rekod mileage dalam bentuk text sahaja.\n\n' +
        '📊 /summary — Lihat total claim bulan ni\n' +
        '📅 /weekly — Lihat total minggu ni\n' +
        '🧾 /report — Laporan bulanan ikut minggu\n' +
        '⚙️ /rate — Cek kadar claim per km\n' +
        '✅ /status — Check bot online/offline',
        { parse_mode: 'Markdown' }
    );
});

bot.command('summary', async (ctx) => {
    try {
        const summary = await getMileageSummary();
        await ctx.reply(
            `📊 *Ringkasan Mileage Bulan Ini:*\n\n` +
            `🛣️ Jumlah Jarak: *${summary.totalKm.toFixed(1)} km*\n` +
            `💵 Total Claim: *RM ${summary.totalClaim.toFixed(2)}*\n` +
            `📝 Jumlah Trip: *${summary.count}*`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error('Summary Error:', err.message);
        await ctx.reply('❌ Gagal ambil summary. Sila cuba lagi nanti.');
    }
});

bot.command('rate', (ctx) => {
    const rate = process.env.MILEAGE_RATE || '0.60';
    ctx.reply(`⚙️ *Kadar Claim:* RM ${rate} per km`, { parse_mode: 'Markdown' });
});

bot.command('status', async (ctx) => {
    const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' });
    await ctx.reply(
        `✅ *Bot Online*\n\n` +
        `⏰ Masa: *${now}*\n` +
        `🤖 Mode: *${process.env.RENDER_EXTERNAL_URL ? 'Webhook' : 'Polling'}*\n` +
        `📊 Sheets: *Configured*\n` +
        `🧠 AI: *OpenRouter fallback enabled*`,
        { parse_mode: 'Markdown' }
    );
});

async function handleIncoming(ctx, input, type) {
    const normalizedInput = typeof input === 'string' ? input.trim() : '';

    if (!normalizedInput) {
        await ctx.reply('❌ Sila hantar rekod mileage dalam bentuk text yang jelas.');
        return;
    }

    const msg = await ctx.reply('⏳ Memproses Batch Mileage...');

    try {
        const results = await processMileage(normalizedInput, type);
        
        if (results && results.length > 0) {
            let successCount = 0;
            for (const data of results) {
                if (data.distance || (data.odoStart && data.odoEnd)) {
                    await logMileage(data);
                    successCount++;
                }
            }

            const firstResult = results[0];
            const firstDistance = firstResult.odoStart != null && firstResult.odoEnd != null
                ? Math.abs(Number(firstResult.odoEnd) - Number(firstResult.odoStart))
                : Number(firstResult.distance || 0);

            const summary = results.length > 1
                ? `✅ *Batch Berjaya!* \n📦 *${successCount}* rekod telah disimpan ke Google Sheet.`
                : `✅ *Mileage Direkod!* \n📍 Destinasi: *${firstResult.destination || 'Unknown'}*\n🛣️ Jarak: *${firstDistance.toFixed(1)} km*`;

            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, summary, { parse_mode: 'Markdown' });
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Gagal membaca format. Sila pastikan tarikh, destinasi dan jarak/odo jelas.');
        }
    } catch (err) {
        console.error('Handle Incoming Error:', err.message);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Ada error masa proses mileage. Sila cuba lagi nanti.');
    }
}

bot.command('weekly', async (ctx) => {
    try {
        const summary = await getWeeklySummary();
        await ctx.reply(
            `📅 *Ringkasan ${summary.week}:*\n\n` +
            `🛣️ Total Jarak: *${summary.totalKm.toFixed(1)} km*\n` +
            `💵 Total Claim: *RM ${summary.totalClaim.toFixed(2)}*\n` +
            `✅ Jumlah Rekod: *${summary.count}*`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error('Weekly Error:', err.message);
        await ctx.reply('❌ Gagal ambil weekly summary. Sila cuba lagi nanti.');
    }
});

bot.command('report', async (ctx) => {
    try {
        const report = await getMonthlyReport();
        let msg = `📊 *Laporan Mileage Bulanan (Ikut Minggu):*\n\n`;
        
        Object.keys(report).sort().forEach(w => {
            msg += `🔹 *${w}*\n   Jarak: ${report[w].km.toFixed(1)} km\n   Claim: RM ${report[w].rm.toFixed(2)}\n\n`;
        });

        if (Object.keys(report).length === 0) msg = "❌ Tiada data untuk bulan ini.";
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error('Report Error:', err.message);
        await ctx.reply('❌ Gagal ambil monthly report. Sila cuba lagi nanti.');
    }
});

// Friday Night Reminder (9 PM)
const cron = require('node-cron');
cron.schedule('0 21 * * 5', async () => {
    if (!process.env.MY_CHAT_ID) {
        console.warn('MY_CHAT_ID missing, skipping Friday reminder.');
        return;
    }

    try {
        await bot.telegram.sendMessage(process.env.MY_CHAT_ID, '🔔 *Peringatan Jumaat Malam!*\n\nBos, jangan lupa masukkan rekod odo untuk minggu ni supaya tak terlepas claim! 🚗💨', { parse_mode: 'Markdown' });
    } catch (err) {
        console.error('Friday Reminder Error:', err.message);
    }
}, { timezone: "Asia/Kuala_Lumpur" });

bot.on('text', async (ctx) => {
    const text = ctx.message.text || '';
    if (text.startsWith('/')) return;
    await handleIncoming(ctx, text, 'text');
});
bot.on('voice', async (ctx) => {
    await ctx.reply('🎤 Voice message belum disokong. Sila hantar rekod mileage dalam bentuk text. Contoh: "Office ke KLCC 30km"');
});

module.exports = { bot };
