const { Telegraf, Markup } = require('telegraf');
const { processMileage } = require('./ai');
const {
    logMileage,
    logMileageBatch,
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
    if (!ALLOWED_CHAT_IDS || ALLOWED_CHAT_IDS.length === 0) {
        console.warn('CRITICAL: ALLOWED_CHAT_IDS is not set. Bot is locked down.');
        return false;
    }
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

function escapeMarkdown(text) {
    return String(text ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/([_*`\[])/g, '\\$1');
}

bot.start((ctx) => {
    ctx.reply(
        '🏢 *Sistem Rekod Mileage AI*\n\n' +
        'Selamat datang! Saya di sini untuk membantu anda merekod dan mengurus tuntutan perjalanan (mileage) dengan mudah dan pantas.\n\n' +
        '💡 *Cara Merekod:*\n' +
        'Hanya hantar mesej teks ringkas seperti:\n' +
        '📝 `Office ke KLCC 30km`\n\n' +
        '📌 *Menu Utama:*\n' +
        '📊 /today — Semakan Hari Ini\n' +
        '📈 /weekly — Laporan Mingguan\n' +
        '🧾 /summary — Laporan Bulanan\n' +
        '📁 /export — Jana PDF Tuntutan\n' +
        '⚙️ /help — Bantuan & Format Teks',
        { parse_mode: 'Markdown' }
    );
});

bot.command('help', (ctx) => {
    ctx.reply(
        '📖 *PANDUAN FORMAT TEKS*\n' +
        'Anda boleh menaip secara natural. Berikut adalah contoh yang disokong:\n\n' +
        '*1. Teks Biasa (Paling Mudah)*\n' +
        '`Office ke JKR 30km`\n\n' +
        '*2. Teks Bersama Tarikh*\n' +
        '`13/5/2026`\n' +
        '`Office ke Tapak Projek 45km`\n\n' +
        '*3. Menggunakan Odometer*\n' +
        '`Hari ini ke KLCC`\n' +
        '`Odo 12000 - 12045`\n\n' +
        '*4. Odometer Bersambung (Odo Memory)*\n' +
        '`Spg 4 Cheng odo 12080`\n' +
        '_*Bot akan guna Odo akhir sebelumnya sebagai Odo mula automatik._\n\n' +
        '*Arahan Tambahan:*\n' +
        '• `/editlast distance 35` — Edit jarak rekod terakhir\n' +
        '• `/editlast destination KLCC` — Edit destinasi terakhir\n' +
        '• `/undo` — Padam rekod terakhir\n' +
        '• `/delete 25` — Padam rekod baris ke-25',
        { parse_mode: 'Markdown' }
    );
});

bot.command('summary', async (ctx) => {
    try {
        const args = ctx.message.text.split(' ');
        const month = args.length > 1 ? args[1] : null;
        const summary = await getMileageSummary(month);
        const label = month || 'Bulan Ini';
        await ctx.reply(
            `📊 *LAPORAN MILEAGE (${label})*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🛣️ Jarak Keseluruhan: *${summary.totalKm.toFixed(1)} km*\n` +
            `💰 Jumlah Tuntutan: *RM ${summary.totalClaim.toFixed(2)}*\n` +
            `📝 Jumlah Rekod: *${summary.count} Perjalanan*`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error('Summary Error:', err.message);
        await logError('summary', err.message);
        await ctx.reply('❌ Gagal ambil summary. Sila cuba lagi nanti.\n\nFormat: `/summary 2026-02`', { parse_mode: 'Markdown' });
    }
});

bot.command('today', async (ctx) => {
    try {
        const summary = await getTodaySummary();
        await ctx.reply(
            `📊 *LAPORAN MILEAGE: HARI INI*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🛣️ Jarak Keseluruhan: *${summary.totalKm.toFixed(1)} km*\n` +
            `💰 Jumlah Tuntutan: *RM ${summary.totalClaim.toFixed(2)}*\n` +
            `📝 Jumlah Rekod: *${summary.count} Perjalanan*`,
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
        `🟢 *STATUS SISTEM*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⏰ Waktu Semasa: *${now}*\n` +
        `🤖 Mod Operasi: *${process.env.RENDER_EXTERNAL_URL ? 'Webhook' : 'Polling'}*\n` +
        `📊 Google Sheets: *Aktif*\n` +
        `🧠 AI Parser: *OpenRouter fallback enabled*\n` +
        `🔒 Akses: *${ALLOWED_CHAT_IDS.length > 0 ? 'Terhad (Whitelist)' : 'Terbuka (Public)'}*`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('undo', async (ctx) => {
    try {
        const deleted = await deleteLastRecord();
        if (deleted) {
            await ctx.reply(
                `✅ *REKOD TERAKHIR BERJAYA DIPADAM*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📍 Destinasi: *${escapeMarkdown(deleted.destination)}*\n` +
                `🛣️ Jarak: *${deleted.distance} km*\n` +
                `💰 Tuntutan: *RM ${deleted.claim}*`,
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
                `✅ *REKOD (BARIS ${rowNumber}) BERJAYA DIPADAM*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📍 Destinasi: *${escapeMarkdown(deleted.destination)}*\n` +
                `🛣️ Jarak: *${deleted.distance} km*\n` +
                `💰 Tuntutan: *RM ${deleted.claim}*`,
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
            `✅ *REKOD TERAKHIR TELAH DIKEMASKINI*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `✏️ Ruangan: *${escapeMarkdown(field)}*\n` +
            `🆕 Nilai Baru: *${escapeMarkdown(value)}*\n\n` +
            `📍 Destinasi: *${escapeMarkdown(updated.destination)}*\n` +
            `🛣️ Jarak: *${updated.distance} km*\n` +
            `💰 Tuntutan: *RM ${updated.claim}*`,
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
            let confirmMsg = '📝 *PENGESAHAN REKOD PERJALANAN*\nSila semak butiran di bawah sebelum menyimpan:\n\n';
            if (validResults.some(d => d._duplicateWarning)) {
                confirmMsg += '⚠️ *AMARAN:* Ada rekod yang mungkin bertindih (duplicate). Sila semak dengan teliti.\n\n';
            }
            
            validResults.forEach((data, idx) => {
                const distance = data._calculatedDistance || 0;
                const claim = distance * rate;
                
                const rawDest = String(data.destination || 'Unknown');
                const shortDestination = rawDest.length > 90
                    ? rawDest.slice(0, 87) + '...'
                    : rawDest;
                confirmMsg += `*${idx + 1}. [${data.date || 'Hari ini'}]*\n`;
                confirmMsg += `   📍 Destinasi: ${escapeMarkdown(shortDestination)}\n`;
                if (data.odoStart != null && data.odoEnd != null) {
                    confirmMsg += `   🔢 Odometer: ${data.odoStart} ➔ ${data.odoEnd}\n`;
                }
                if (data._duplicateWarning) {
                    confirmMsg += `   ⚠️ (Kemungkinan Duplicate)\n`;
                }
                confirmMsg += `   🛣️ Jarak: ${distance.toFixed(1)} km\n`;
                confirmMsg += `   💰 Tuntutan: RM ${claim.toFixed(2)}\n\n`;
            });

            const totalKm = validResults.reduce((sum, d) => sum + (d._calculatedDistance || 0), 0);
            const totalClaim = totalKm * rate;

            confirmMsg += `━━━━━━━━━━━━━━━━━━━━\n📈 *JUMLAH KESELURUHAN*\nJarak: *${totalKm.toFixed(1)} km*  |  Tuntutan: *RM ${totalClaim.toFixed(2)}*`;

            if (confirmMsg.length > 3800) {
                confirmMsg = '📝 *PENGESAHAN REKOD PERJALANAN*\n\n' +
                    `Bot berjaya membaca *${validResults.length} rekod*.\n` +
                    `📈 Jumlah Keseluruhan: *${totalKm.toFixed(1)} km* (RM ${totalClaim.toFixed(2)})\n\n` +
                    '_Nota: Butiran terlalu panjang, tetapi semua rekod sedia untuk disimpan. Anda boleh semak PDF selepas ini._';
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
                                { text: '✅ Sahkan', callback_data: `confirm:${confirmId}` },
                                { text: '❌ Batal', callback_data: `cancel:${confirmId}` }
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
        await ctx.editMessageText('❌ *Rekod dibatalkan dan tidak disimpan.*', { parse_mode: 'Markdown' });
        return;
    }

    if (action === 'confirm') {
        const results = pendingConfirmations.get(confirmId);
        if (!results) {
            await ctx.answerCbQuery('⚠️ Confirmation expired atau sudah diproses');
            await ctx.editMessageText('⚠️ Confirmation expired. Sila hantar semula.');
            return;
        }

        let saved = false;
        let successCount = 0;

        try {
            if (results.length > 1) {
                successCount = await logMileageBatch(results);
            } else {
                await logMileage(results[0]);
                successCount = 1;
            }
            saved = true;
            pendingConfirmations.delete(confirmId);
        } catch (err) {
            console.error('=== CONFIRM SAVE ERROR ===');
            console.error('Error name:', err.name);
            console.error('Error message:', err.message);
            console.error('Error stack:', err.stack);
            console.error('Results count:', results.length);
            console.error('First result:', JSON.stringify(results[0]));
            console.error('========================');
            
            try { await logError('confirm_save', err.stack || err.message); } catch (logErr) {
                console.error('logError failed:', logErr.message);
            }
            
            const errorDetail = `${err.name || 'Error'}: ${String(err.message).slice(0, 200)}`;
            
            try {
                await ctx.answerCbQuery('❌ Error simpan');
            } catch (cbErr) {
                console.error('answerCbQuery failed:', cbErr.message);
            }
            
            try {
                await ctx.editMessageText(`❌ Ada error masa simpan.\n\n${errorDetail}`);
            } catch (editErr) {
                console.error('editMessageText failed:', editErr.message);
                try {
                    await ctx.reply(`❌ Ada error masa simpan.\n\n${errorDetail}`);
                } catch (replyErr) {
                    console.error('reply fallback failed:', replyErr.message);
                }
            }
            return;
        }

        const summary = results.length > 1
            ? `✅ *BATCH BERJAYA DISIMPAN!*\n━━━━━━━━━━━━━━━━━━━━\n📦 *${successCount} rekod* telah dikemaskini ke dalam Google Sheets.`
            : `✅ *REKOD BERJAYA DISIMPAN!*\n━━━━━━━━━━━━━━━━━━━━\n📍 Destinasi: *${escapeMarkdown(results[0].destination)}*`;

        try {
            await ctx.answerCbQuery('✅ Berjaya disimpan!');
            await ctx.editMessageText(summary, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('Confirm Telegram Reply Error:', err.message);
            await logError('confirm_reply', err.stack || err.message);
            if (saved) {
                try {
                    await ctx.reply('✅ Rekod berjaya disimpan ke Google Sheet.');
                } catch (replyErr) {
                    console.error('Fallback Reply Error:', replyErr.message);
                }
            }
        }
    }
});

bot.command('weekly', async (ctx) => {
    try {
        const summary = await getWeeklySummary();
        await ctx.reply(
            `📊 *LAPORAN MINGGUAN (${summary.week})*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🛣️ Jarak Keseluruhan: *${summary.totalKm.toFixed(1)} km*\n` +
            `💰 Jumlah Tuntutan: *RM ${summary.totalClaim.toFixed(2)}*\n` +
            `📝 Jumlah Rekod: *${summary.count} Perjalanan*`,
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
        const args = ctx.message.text.split(' ');
        const month = args.length > 1 ? args[1] : null;
        const report = await getMonthlyReport(month);
        const label = month || 'Bulan Ini';
        let msg = `🧾 *LAPORAN TERPERINCI (${label})*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        Object.keys(report).sort().forEach(w => {
            msg += `🔹 *${w}*\n   Jarak: ${report[w].km.toFixed(1)} km\n   Tuntutan: RM ${report[w].rm.toFixed(2)}\n\n`;
        });

        if (Object.keys(report).length === 0) msg = `❌ Tiada data untuk ${label}.`;
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error('Report Error:', err.message);
        await logError('report', err.message);
        await ctx.reply('❌ Gagal ambil monthly report.\n\nFormat: `/report 2026-02`', { parse_mode: 'Markdown' });
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
