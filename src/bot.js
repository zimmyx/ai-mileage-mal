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
        '🎤 *Voice:* "Balik dari client Shah Alam 15km"\n\n' +
        '📊 /summary — Lihat total claim bulan ni\n' +
        '⚙️ /rate — Cek kadar claim per km',
        { parse_mode: 'Markdown' }
    );
});

bot.command('summary', async (ctx) => {
    const summary = await getMileageSummary();
    ctx.reply(
        `📊 *Ringkasan Mileage Bulan Ini:*\n\n` +
        `🛣️ Jumlah Jarak: *${summary.totalKm.toFixed(1)} km*\n` +
        `💵 Total Claim: *RM ${summary.totalClaim.toFixed(2)}*\n` +
        `📝 Jumlah Trip: *${summary.count}*`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('rate', (ctx) => {
    const rate = process.env.MILEAGE_RATE || '0.60';
    ctx.reply(`⚙️ *Kadar Claim:* RM ${rate} per km`);
});

async function handleIncoming(ctx, input, type) {
    const msg = await ctx.reply('⏳ Memproses Batch Mileage...');
    const results = await processMileage(input, type);
    
    if (results && results.length > 0) {
        let successCount = 0;
        for (const data of results) {
            if (data.distance || (data.odoStart && data.odoEnd)) {
                await logMileage(data);
                successCount++;
            }
        }

        const summary = results.length > 1 
            ? `✅ *Batch Berjaya!* \n📦 *${successCount}* rekod telah disimpan ke Google Sheet.`
            : `✅ *Mileage Direkod!* \n📍 Destinasi: *${results[0].destination}*\n🛣️ Jarak: *${(results[0].odoEnd - results[0].odoStart) || results[0].distance} km*`;

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, summary, { parse_mode: 'Markdown' });
    } else {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Gagal membaca format. Sila pastikan tarikh dan odo jelas.');
    }
}

bot.command('weekly', async (ctx) => {
    const summary = await getWeeklySummary();
    ctx.reply(
        `📅 *Ringkasan ${summary.week}:*\n\n` +
        `🛣️ Total Jarak: *${summary.totalKm.toFixed(1)} km*\n` +
        `💵 Total Claim: *RM ${summary.totalClaim.toFixed(2)}*\n` +
        `✅ Jumlah Rekod: *${summary.count}*`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('report', async (ctx) => {
    const report = await getMonthlyReport();
    let msg = `📊 *Laporan Mileage Bulanan (Ikut Minggu):*\n\n`;
    
    Object.keys(report).sort().forEach(w => {
        msg += `🔹 *${w}*\n   Jarak: ${report[w].km.toFixed(1)} km\n   Claim: RM ${report[w].rm.toFixed(2)}\n\n`;
    });

    if (Object.keys(report).length === 0) msg = "❌ Tiada data untuk bulan ini.";
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Friday Night Reminder (9 PM)
const cron = require('node-cron');
cron.schedule('0 21 * * 5', () => {
    bot.telegram.sendMessage(process.env.MY_CHAT_ID, '🔔 *Peringatan Jumaat Malam!*\n\nBos, jangan lupa masukkan rekod odo untuk minggu ni supaya tak terlepas claim! 🚗💨', { parse_mode: 'Markdown' });
}, { timezone: "Asia/Kuala_Lumpur" });

bot.on('text', ctx => handleIncoming(ctx, ctx.message.text, 'text'));
bot.on('voice', async (ctx) => {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    handleIncoming(ctx, fileLink.href, 'voice');
});

module.exports = { bot };
