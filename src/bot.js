const { Telegraf } = require('telegraf');
const { processMileage } = require('./ai');
const { logMileage, getMileageSummary } = require('./sheets');
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
    const msg = await ctx.reply('⏳ Memproses Odo...');
    const data = await processMileage(input, type);
    
    if (data && (data.distance || (data.odoStart && data.odoEnd))) {
        const result = await logMileage(data);
        let odoInfo = '';
        if (data.odoStart && data.odoEnd) {
            odoInfo = `🔢 Odo: *${data.odoStart} → ${data.odoEnd}*\n`;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, 
            `✅ *Mileage Direkod!*\n\n` +
            `📍 Destinasi: *${data.destination}*\n` +
            odoInfo +
            `🛣️ Jarak: *${result.distance} km*\n` +
            `💵 Claim: *RM ${result.claim.toFixed(2)}*\n\n` +
            `🟢 _Berjaya disimpan ke Google Sheet!_`, 
            { parse_mode: 'Markdown' }
        );
    } else {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Gagal membaca Odo/jarak. Sila cuba lagi.');
    }
}

bot.on('text', ctx => handleIncoming(ctx, ctx.message.text, 'text'));
bot.on('voice', async (ctx) => {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    handleIncoming(ctx, fileLink.href, 'voice');
});

module.exports = { bot };
