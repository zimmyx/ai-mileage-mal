const { Telegraf, Markup } = require('telegraf');
const { processMileage } = require('./ai');
const { 
    logMileage, 
    getMileageSummary, 
    getWeeklySummary, 
    getMonthlyReport,
    getTodaySummary,
    deleteLastRecord,
    deleteRecordByRow,
    editLastRecord,
    logError,
    enrichWithOdoMemory,
    findDuplicate,
    hasRecordsThisWeek
} = require('./sheets');
const { generatePDF } = require('./export');
const dotenv = require('dotenv');

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_MILEAGE_BOT_TOKEN);

// Whitelist check
const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_IDS 
    ? process.env.ALLOWED_CHAT_IDS.split(',').map(id => id.trim())
    : [];

function isAllowed(chatId) {
    if (ALLOWED_CHAT_IDS.length === 0) return true;
    return ALLOWED_CHAT_IDS.includes(String(chatId));
}

// Middleware for whitelist
bot.use(async (ctx, next) => {
    if (!isAllowed(ctx.chat?.id)) {
        await ctx.reply('❌ Anda tidak dibenarkan menggunakan bot ini.');
        return;
    }
    return next();
});

// Pending confirmations storage
const pendingConfirmations = new Map();

bot.start((ctx) => {
    ctx.reply(
        '🚗 *AI Mileage by Mal*\n' +
        'Log perjalanan anda sepantas kilat!\n\n' +
        '✍️ *Teks:* "Office ke KLCC 30km"\n' +
        '📝 Hantar rekod mileage dalam bentuk text sahaja.\n\n' +
        '📊 /summary — Lihat total claim bulan ni\n' +
        '📅 /weekly — Lihat total minggu ni\n' +
        '🗓️ /today — Lihat total hari ini\n' +
        '🧾 /report — Laporan bulanan ikut minggu\n' +
        '📤 /export — Export laporan PDF\n' +
        '✏️ /editlast — Edit rekod terakhir\n' +
        '🗑️ /undo — Padam rekod terakhir\n' +
        '⚙️ /rate — Cek kadar claim per km\n' +
        '❓ /help — Panduan format input\n' +
        '✅ /status — Check bot online/offline',
        { parse_mode: 'Markdown' }
    );
});

bot.command('help', (ctx) => {
    ctx.reply(
        '📖 *Panduan Format Input*\n\n' +
        '*Format 1: Jarak sahaja*\n' +
        '`Office ke KLCC 30km`\n\n' +
        '*Format 2: Dengan tarikh*\n' +
        '`13/5/2026\nOffice ke Shah Alam 45km`\n\n' +
        '*Format 3: Dengan odometer*\n' +
        '`Hari ini pergi JKR\nOdo 12000 - 12045`\n\n' +
        '*Format 4: Batch multiple trips*\n' +
        '`10/5 Office 30km\n11/5 Client site 25km\n12/5 JKR 40km`\n\n' +
        '*Tips:*\n' +
        '• Bot faham Bahasa Melayu, English, dan Manglish\n' +
        '• Jika tiada tarikh, bot guna tarikh hari ini\n' +
        '• Boleh sebut lokasi seperti Spg 3, Spg 4, JKR, client site\n' +
        '• Odo memory: jika pernah simpan odo end, anda boleh taip `KLCC odo 12080`\n' +
        '• Edit last: `/editlast distance 35` atau `/editlast destination KLCC`\n' +
        '• Bot akan minta confirmation sebelum simpan',
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
        await logError('summary', err.message);
        await ctx.reply('❌ Gagal ambil summary. Sila cuba lagi nanti.');
    }
});

bot.command('today', async (ctx) => {
    try {
        const summary = await getTodaySummary();
        await ctx.reply(
            `📅 *Mileage Hari Ini:*\n\n` +
            `🛣️ Total Jarak: *${summary.totalKm.toFixed(1)} km*\n` +
            `💵 Total Claim: *RM ${summary.totalClaim.toFixed(2)}*\n` +
            `📝 Jumlah Trip: *${summary.count}*`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error('Today Error:', err.message);
        await logError('today', err.message);
        await ctx.reply('❌ Gagal ambil data hari ini. Sila cuba lagi nanti.');
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
        `🧠 AI: *OpenRouter fallback enabled*\n` +
        `🔒 Whitelist: *${ALLOWED_CHAT_IDS.length > 0 ? 'Enabled' : 'Disabled'}*`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('undo', async (ctx) => {
    try {
        const deleted = await deleteLastRecord();
        if (deleted) {
            await ctx.reply(
                `✅ *Rekod Terakhir Dipadam*\n\n` +
                `📍 Destinasi: *${deleted.destination}*\n` +
                `🛣️ Jarak: *${deleted.distance} km*\n` +
                `💵 Claim: *RM ${deleted.claim}*`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply('❌ Tiada rekod untuk dipadam.');
        }
    } catch (err) {
        console.error('Undo Error:', err.message);
        await logError('undo', err.message);
        await ctx.reply('❌ Gagal padam rekod. Sila cuba lagi nanti.');
    }
});

bot.command('delete', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2 || isNaN(args[1])) {
        await ctx.reply('❌ Format salah. Guna: `/delete <row_number>`\n\nContoh: `/delete 25`', { parse_mode: 'Markdown' });
        return;
    }

    const rowNumber = parseInt(args[1]);
    try {
        const deleted = await deleteRecordByRow(rowNumber);
        if (deleted) {
            await ctx.reply(
                `✅ *Rekod Row ${rowNumber} Dipadam*\n\n` +
                `📍 Destinasi: *${deleted.destination}*\n` +
                `🛣️ Jarak: *${deleted.distance} km*\n` +
                `💵 Claim: *RM ${deleted.claim}*`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply(`❌ Row ${rowNumber} tidak dijumpai.`);
        }
    } catch (err) {
        console.error('Delete Error:', err.message);
        await logError('delete', err.message);
        await ctx.reply('❌ Gagal padam rekod. Sila cuba lagi nanti.');
    }
});

bot.command('editlast', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) {
        await ctx.reply(
            '❌ Format salah. Guna:\n\n' +
            '`/editlast distance 35`\n' +
            '`/editlast destination KLCC`\n' +
            '`/editlast date 2026-05-13`\n' +
            '`/editlast odoend 12080`',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const field = parts[1].toLowerCase();
    const value = parts.slice(2).join(' ');

    try {
        const updated = await editLastRecord(field, value);
        if (!updated) {
            await ctx.reply('❌ Tiada rekod untuk diedit.');
            return;
        }
        await ctx.reply(
            `✅ *Rekod Terakhir Dikemaskini*\n\n` +
            `✏️ Field: *${field}*\n` +
            `🆕 Value: *${value}*\n` +
            `📍 Destinasi: *${updated.destination}*\n` +
            `🛣️ Jarak: *${updated.distance} km*\n` +
            `💵 Claim: *RM ${updated.claim}*`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error('Edit Last Error:', err.message);
        await logError('editlast', err.message);
        await ctx.reply('❌ Gagal edit rekod. Field dibenarkan: distance, destination, date, odostart, odoend.');
    }
});

bot.command('export', async (ctx) => {
    try {
        const msg = await ctx.reply('⏳ Menjana laporan PDF...');
        
        const args = ctx.message.text.split(' ');
        const month = args.length > 1 ? args[1] : null;
        
        const pdfBuffer = await generatePDF(month);
        
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
        
        await ctx.replyWithDocument(
            { source: pdfBuffer, filename: `mileage-report-${month || 'current'}.pdf` },
            { caption: `📄 Laporan Mileage ${month || 'Bulan Ini'}` }
        );
    } catch (err) {
        console.error('Export Error:', err.message);
        await logError('export', err.message);
        await ctx.reply('❌ Gagal export PDF. Sila cuba lagi nanti.');
    }
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
            // Validate results
            const validResults = [];
            const shouldCheckDuplicate = results.length <= 5;
            const shouldEnrichOdo = results.length <= 5;
            for (const rawData of results) {
                let data = rawData;
                if (shouldEnrichOdo) {
                    try { data = await enrichWithOdoMemory(rawData); } catch (e) { /* skip */ }
                }
                if (shouldCheckDuplicate) {
                    try {
                        const duplicate = await findDuplicate(data);
                        if (duplicate) data._duplicateWarning = true;
                    } catch (dupErr) { /* skip */ }
                }

                // Validation
                if (!data.destination || data.destination.trim() === '') continue;

                let distance = Number(data.distance) || 0;
                if (data.odoStart != null && data.odoEnd != null) {
                    distance = Math.abs(Number(data.odoEnd) - Number(data.odoStart));
                    if (Number(data.odoEnd) < Number(data.odoStart)) continue;
                }

                if (distance > 1000) continue;
                if (distance <= 0) continue;

                data._calculatedDistance = distance;
                validResults.push(data);
            }

            if (validResults.length === 0) {
                await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Tiada rekod valid. Pastikan ada jarak/odo yang betul.');
                return;
            }

            // Store pending confirmation
            const confirmId = `${ctx.chat.id}-${Date.now()}`;
            pendingConfirmations.set(confirmId, validResults);

            // Build confirmation message
            const rate = parseFloat(process.env.MILEAGE_RATE) || 0.60;
            let confirmMsg = '📋 *Sila Confirm Rekod Mileage:*\n\n';
            if (validResults.some(d => d._duplicateWarning)) {
                confirmMsg += '⚠️ *Warning:* Ada rekod yang nampak duplicate dengan data sedia ada. Semak sebelum confirm.\n\n';
            }
            
            validResults.forEach((data, idx) => {
                const distance = data._calculatedDistance || 0;
                const claim = distance * rate;
                
                const shortDestination = String(data.destination || '').length > 90
                    ? String(data.destination).slice(0, 87) + '...'
                    : String(data.destination || 'Unknown');
                confirmMsg += `*${idx + 1}.* ${data.date || 'Hari ini'}\n`;
                confirmMsg += `   📍 ${shortDestination}\n`;
                if (data.odoStart != null && data.odoEnd != null) {
                    confirmMsg += `   🔢 Odo: ${data.odoStart} → ${data.odoEnd}\n`;
                }
                if (data._duplicateWarning) {
                    confirmMsg += `   ⚠️ Possible duplicate\n`;
                }
                confirmMsg += `   🛣️ ${distance.toFixed(1)} km\n`;
                confirmMsg += `   💵 RM ${claim.toFixed(2)}\n\n`;
            });

            const totalKm = validResults.reduce((sum, d) => sum + (d._calculatedDistance || 0), 0);
            const totalClaim = totalKm * rate;

            confirmMsg += `*Total:* ${totalKm.toFixed(1)} km | RM ${totalClaim.toFixed(2)}`;

            if (confirmMsg.length > 3800) {
                confirmMsg = '📋 *Sila Confirm Rekod Mileage:*\n\n' +
                    `Bot berjaya baca *${validResults.length} rekod*.\n` +
                    `Total: *${totalKm.toFixed(1)} km* | *RM ${totalClaim.toFixed(2)}*\n\n` +
                    'Nota: Detail terlalu panjang untuk Telegram, tapi semua rekod akan disimpan ikut date/odo/destinasi yang dibaca. Gunakan /export selepas simpan untuk semak PDF.';
            }

            await ctx.telegram.editMessageText(
                ctx.chat.id,
                msg.message_id,
                null,
                confirmMsg,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Confirm', callback_data: `confirm:${confirmId}` },
                                { text: '❌ Cancel', callback_data: `cancel:${confirmId}` }
                            ]
                        ]
                    }
                }
            );

            // Auto-expire after 5 minutes
            setTimeout(() => {
                pendingConfirmations.delete(confirmId);
            }, 5 * 60 * 1000);

        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Gagal membaca format. Sila pastikan tarikh, destinasi dan jarak/odo jelas.');
        }
    } catch (err) {
        console.error('Handle Incoming Error:', err.message);
        await logError('handleIncoming', err.message);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Ada error masa proses mileage. Sila cuba lagi nanti.');
    }
}

// Handle confirmation callbacks
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const [action, confirmId] = data.split(':');

    if (action === 'cancel') {
        pendingConfirmations.delete(confirmId);
        await ctx.answerCbQuery('❌ Dibatalkan');
        await ctx.editMessageText('❌ Rekod mileage dibatalkan.');
        return;
    }

    if (action === 'confirm') {
        const results = pendingConfirmations.get(confirmId);
        if (!results) {
            await ctx.answerCbQuery('⚠️ Confirmation expired atau sudah diproses');
            await ctx.editMessageText('⚠️ Confirmation expired. Sila hantar semula.');
            return;
        }

        try {
            let successCount = 0;
            for (const data of results) {
                await logMileage(data);
                successCount++;
            }

            pendingConfirmations.delete(confirmId);

            const summary = results.length > 1
                ? `✅ *Batch Berjaya!*\n📦 *${successCount}* rekod telah disimpan ke Google Sheet.`
                : `✅ *Mileage Direkod!*\n📍 Destinasi: *${results[0].destination}*`;

            await ctx.answerCbQuery('✅ Berjaya disimpan!');
            await ctx.editMessageText(summary, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('Confirm Error:', err.message);
            await logError('confirm', err.message);
            await ctx.answerCbQuery('❌ Error');
            await ctx.editMessageText('❌ Ada error masa simpan. Sila cuba lagi nanti.');
        }
    }
});

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
        await logError('weekly', err.message);
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
        await logError('report', err.message);
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
        const alreadyLogged = await hasRecordsThisWeek();
        if (alreadyLogged) {
            console.log('Friday reminder skipped: weekly mileage already logged.');
            return;
        }
        await bot.telegram.sendMessage(process.env.MY_CHAT_ID, '🔔 *Peringatan Jumaat Malam!*\n\nMinggu ni belum ada rekod mileage. Jangan lupa masukkan odo/trip supaya tak terlepas claim! 🚗💨', { parse_mode: 'Markdown' });
    } catch (err) {
        console.error('Friday Reminder Error:', err.message);
        await logError('friday_reminder', err.message);
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
