const { Telegraf, Markup } = require('telegraf');
const path = require('path');
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

bot.start(async (ctx) => {
    const webAppUrl = process.env.RENDER_EXTERNAL_URL || 'https://dashboard.render.com';
    await ctx.reply(
        '🏢 *AI Mileage Tracking System*\n\n' +
        'Welcome! I am your automated assistant, designed to seamlessly log and manage your mileage claims.\n\n' +
        '💡 *How to Log a Trip:*\n' +
        'Simply send a brief text message in the chat:\n' +
        '📝 `Office to KLCC 30km`\n\n' +
        'Please select an option below or send your trip details:',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📊 Today\'s Report', callback_data: 'menu_today' },
                        { text: '📈 Weekly Report', callback_data: 'menu_weekly' }
                    ],
                    [
                        { text: '🧾 Monthly Summary', callback_data: 'menu_summary' },
                        { text: '📁 Export PDF', callback_data: 'menu_export' }
                    ],
                    [
                        { text: '🌐 OPEN MINI APP', web_app: { url: webAppUrl } }
                    ],
                    [
                        { text: '⚙️ Formatting Guide', callback_data: 'menu_help' }
                    ]
                ]
            }
        }
    );
});

bot.command('help', (ctx) => {
    ctx.reply(
        '📖 *TEXT FORMATTING GUIDE*\n' +
        'You can type naturally. Here are the supported formats:\n\n' +
        '*1. Standard Text (Easiest)*\n' +
        '`Office to Site A 30km`\n\n' +
        '*2. Text with Date*\n' +
        '`13/5/2026`\n' +
        '`Office to Project Site 45km`\n\n' +
        '*3. Using Odometer Readings*\n' +
        '`Today to KLCC`\n' +
        '`Odo 12000 - 12045`\n\n' +
        '*4. Continuous Odometer (Memory)*\n' +
        '`Junction 4 Cheng odo 12080`\n' +
        '_*The bot will automatically use your previous End Odo as the new Start Odo._\n\n' +
        '*Additional Commands:*\n' +
        '• `/editlast distance 35` — Edit distance of the last record\n' +
        '• `/editlast destination KLCC` — Edit destination of the last record\n' +
        '• `/undo` — Delete the last record\n' +
        '• `/delete 25` — Delete the record on row 25',
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
            `📊 *MILEAGE REPORT (${label})*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🛣️ Total Distance: *${summary.totalKm.toFixed(1)} km*\n` +
            `💰 Total Claim: *RM ${summary.totalClaim.toFixed(2)}*\n` +
            `📝 Total Records: *${summary.count} Trips*`,
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
        `🟢 *SYSTEM STATUS*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⏰ Current Time: *${now}*\n` +
        `🤖 Operating Mode: *${process.env.RENDER_EXTERNAL_URL ? 'Webhook' : 'Polling'}*\n` +
        `📊 Google Sheets: *Active*\n` +
        `🧠 AI Parser: *OpenRouter fallback enabled*\n` +
        `🔒 Access: *${ALLOWED_CHAT_IDS.length > 0 ? 'Restricted (Whitelist)' : 'Open (Public)'}*`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('undo', async (ctx) => {
    try {
        const deleted = await deleteLastRecord();
        if (deleted) {
            await ctx.reply(
                `✅ *LATEST RECORD DELETED*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📍 Destination: *${escapeMarkdown(deleted.destination)}*\n` +
                `🛣️ Distance: *${deleted.distance} km*\n` +
                `💰 Claim Amount: *RM ${deleted.claim}*`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply('❌ No records found to delete.');
        }
    } catch (err) {
        console.error('Undo Error:', err.message);
        await logError('undo', err.message);
        await ctx.reply('❌ Failed to delete record. Please try again later.');
    }
});

bot.command('delete', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2 || isNaN(args[1])) {
        await ctx.reply('❌ Invalid format. Usage: `/delete <row_number>`\n\nExample: `/delete 25`', { parse_mode: 'Markdown' });
        return;
    }

    const rowNumber = parseInt(args[1]);
    try {
        const deleted = await deleteRecordByRow(rowNumber);
        if (deleted) {
            await ctx.reply(
                `✅ *RECORD (ROW ${rowNumber}) DELETED*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📍 Destination: *${escapeMarkdown(deleted.destination)}*\n` +
                `🛣️ Distance: *${deleted.distance} km*\n` +
                `💰 Claim Amount: *RM ${deleted.claim}*`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply(`❌ Row ${rowNumber} not found.`);
        }
    } catch (err) {
        console.error('Delete Error:', err.message);
        await logError('delete', err.message);
        await ctx.reply('❌ Failed to delete record. Please try again later.');
    }
});

bot.command('editlast', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) {
        await ctx.reply(
            '❌ Invalid format. Usage:\n\n' +
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
            await ctx.reply('❌ No record found to edit.');
            return;
        }
        await ctx.reply(
            `✅ *LATEST RECORD UPDATED*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `✏️ Field: *${escapeMarkdown(field)}*\n` +
            `🆕 New Value: *${escapeMarkdown(value)}*\n\n` +
            `📍 Destination: *${escapeMarkdown(updated.destination)}*\n` +
            `🛣️ Distance: *${updated.distance} km*\n` +
            `💰 Claim Amount: *RM ${updated.claim}*`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error('Edit Last Error:', err.message);
        await logError('editlast', err.message);
        await ctx.reply('❌ Failed to edit record. Allowed fields: distance, destination, date, odostart, odoend.');
    }
});

bot.command('export', async (ctx) => {
    try {
        const msg = await ctx.reply('⏳ Generating PDF report...');
        
        const args = ctx.message.text.split(' ');
        const month = args.length > 1 ? args[1] : null;
        
        const pdfBuffer = await generatePDF(month);
        
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
        
        await ctx.replyWithDocument(
            { source: pdfBuffer, filename: `mileage-report-${month || 'current'}.pdf` },
            { caption: `📄 Mileage Report: ${month || 'This Month'}` }
        );
    } catch (err) {
        console.error('Export Error:', err.message);
        await logError('export', err.message);
        await ctx.reply('❌ Failed to export PDF. Please try again later.');
    }
});

async function handleIncoming(ctx, input, type) {
    const normalizedInput = typeof input === 'string' ? input.trim() : '';

    if (!normalizedInput) {
        await ctx.reply('❌ Sila hantar rekod mileage dalam format teks yang jelas.');
        return;
    }

    const msg = await ctx.reply('⏳ Sedang memproses Batch Mileage...');

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
                await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ No valid records found. Please ensure distance/odometer readings are correct.');
                return;
            }

            // Store pending confirmation
            const confirmId = `${ctx.chat.id}-${Date.now()}`;
            pendingConfirmations.set(confirmId, validResults);

            // Build confirmation message
            const rate = parseFloat(process.env.MILEAGE_RATE) || 0.60;
            let confirmMsg = '📝 *TRIP CONFIRMATION*\nPlease review the details below before saving:\n\n';
            if (validResults.some(d => d._duplicateWarning)) {
                confirmMsg += '⚠️ *WARNING:* Possible duplicate records detected. Please review carefully.\n\n';
            }
            
            validResults.forEach((data, idx) => {
                const distance = data._calculatedDistance || 0;
                const claim = distance * rate;
                
                const rawDest = String(data.destination || 'Unknown');
                const shortDestination = rawDest.length > 90
                    ? rawDest.slice(0, 87) + '...'
                    : rawDest;
                confirmMsg += `*${idx + 1}. [${data.date || 'Today'}]*\n`;
                confirmMsg += `   📍 Destination: ${escapeMarkdown(shortDestination)}\n`;
                if (data.odoStart != null && data.odoEnd != null) {
                    confirmMsg += `   🔢 Odometer: ${data.odoStart} ➔ ${data.odoEnd}\n`;
                }
                if (data._duplicateWarning) {
                    confirmMsg += `   ⚠️ (Possible Duplicate)\n`;
                }
                confirmMsg += `   🛣️ Distance: ${distance.toFixed(1)} km\n`;
                confirmMsg += `   💰 Claim Amount: RM ${claim.toFixed(2)}\n\n`;
            });

            const totalKm = validResults.reduce((sum, d) => sum + (d._calculatedDistance || 0), 0);
            const totalClaim = totalKm * rate;

            confirmMsg += `━━━━━━━━━━━━━━━━━━━━\n📈 *OVERALL SUMMARY*\nDistance: *${totalKm.toFixed(1)} km*  |  Claim: *RM ${totalClaim.toFixed(2)}*`;

            if (confirmMsg.length > 3800) {
                confirmMsg = '📝 *TRIP CONFIRMATION*\n\n' +
                    `Successfully processed *${validResults.length} records*.\n` +
                    `📈 Overall Summary: *${totalKm.toFixed(1)} km* (RM ${totalClaim.toFixed(2)})\n\n` +
                    '_Note: Details are too long to display, but all records are ready to be saved. You can check the PDF later._';
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
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Failed to read format. Please ensure date, destination, and distance/odometer are clear.');
        }
    } catch (err) {
        console.error('Handle Incoming Error:', err.message);
        await logError('handleIncoming', err.message);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Error processing mileage. Please try again later.');
    }
}

// Handle confirmation callbacks
bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data) return next();

    if (data.startsWith('menu_')) {
        return next();
    }

    const [action, confirmId] = data.split(':');

    if (action === 'cancel') {
        pendingConfirmations.delete(confirmId);
        await ctx.answerCbQuery('❌ Cancelled');
        await ctx.editMessageText('❌ *Record logging cancelled. No data was saved.*', { parse_mode: 'Markdown' });
        return;
    }

    if (action === 'confirm') {
        const results = pendingConfirmations.get(confirmId);
        if (!results) {
            await ctx.answerCbQuery('⚠️ Confirmation expired');
            await ctx.editMessageText('⚠️ Confirmation expired. Please submit the record again.');
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
            ? `✅ *BATCH SAVED SUCCESSFULLY!*\n━━━━━━━━━━━━━━━━━━━━\n📦 *${successCount} records* have been added to Google Sheets.`
            : `✅ *RECORD SAVED SUCCESSFULLY!*\n━━━━━━━━━━━━━━━━━━━━\n📍 Destination: *${escapeMarkdown(results[0].destination)}*`;

        try {
            await ctx.answerCbQuery('✅ Saved successfully!');
            await ctx.editMessageText(summary, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('Confirm Telegram Reply Error:', err.message);
            await logError('confirm_reply', err.stack || err.message);
            if (saved) {
                try {
                    await ctx.reply('✅ Record successfully saved to Google Sheets.');
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
        await ctx.reply('❌ Failed to retrieve weekly summary. Please try again later.');
    }
});

bot.command('report', async (ctx) => {
    try {
        const args = ctx.message.text.split(' ');
        const month = args.length > 1 ? args[1] : null;
        const report = await getMonthlyReport(month);
        const label = month || 'Bulan Ini';
        let msg = `🧾 *DETAILED REPORT (${label})*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        Object.keys(report).sort().forEach(w => {
            msg += `🔹 *${w}*\n   Distance: ${report[w].km.toFixed(1)} km\n   Claim: RM ${report[w].rm.toFixed(2)}\n\n`;
        });

        if (Object.keys(report).length === 0) msg = `❌ No data found for ${label}.`;
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error('Report Error:', err.message);
        await logError('report', err.message);
        await ctx.reply('❌ Failed to retrieve monthly report.\n\nFormat: `/report 2026-02`', { parse_mode: 'Markdown' });
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
        await bot.telegram.sendMessage(process.env.MY_CHAT_ID, '🔔 *Friday Night Reminder!*\n\nNo mileage records found for this week. Don\'t forget to log your odometer/trips so you don\'t miss out on your claims! 🚗💨', { parse_mode: 'Markdown' });
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
    await ctx.reply('🎤 Voice messages are not supported yet. Please send your mileage records as text. Example: "Office to KLCC 30km"');
});

// --- Menu Action Handlers ---
bot.action('menu_today', async (ctx) => {
    await ctx.answerCbQuery();
    try {
        const summary = await getTodaySummary();
        await ctx.reply(
            `📊 *MILEAGE REPORT: TODAY*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🛣️ Total Distance: *${summary.totalKm.toFixed(1)} km*\n` +
            `💰 Total Claim: *RM ${summary.totalClaim.toFixed(2)}*\n` +
            `📝 Total Records: *${summary.count} Trips*`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        await ctx.reply('❌ Failed to retrieve today\'s data.');
    }
});

bot.action('menu_weekly', async (ctx) => {
    await ctx.answerCbQuery();
    try {
        const summary = await getWeeklySummary();
        await ctx.reply(
            `📊 *WEEKLY REPORT (${summary.week})*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🛣️ Total Distance: *${summary.totalKm.toFixed(1)} km*\n` +
            `💰 Total Claim: *RM ${summary.totalClaim.toFixed(2)}*\n` +
            `📝 Total Records: *${summary.count} Trips*`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        await ctx.reply('❌ Failed to retrieve this week\'s summary.');
    }
});

bot.action('menu_summary', async (ctx) => {
    await ctx.answerCbQuery();
    try {
        const summary = await getMileageSummary(null);
        await ctx.reply(
            `📊 *MILEAGE REPORT (This Month)*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🛣️ Total Distance: *${summary.totalKm.toFixed(1)} km*\n` +
            `💰 Total Claim: *RM ${summary.totalClaim.toFixed(2)}*\n` +
            `📝 Total Records: *${summary.count} Trips*`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        await ctx.reply('❌ Failed to retrieve this month\'s summary.');
    }
});

bot.action('menu_export', async (ctx) => {
    await ctx.answerCbQuery('Generating PDF...');
    try {
        await ctx.reply('⏳ Generating PDF report for this month. Please wait...');
        const { exportPdf } = require('./export');
        const pdfPath = await exportPdf(null);
        if (pdfPath) {
            await ctx.replyWithDocument({ source: pdfPath, filename: path.basename(pdfPath) });
            const fs = require('fs');
            fs.unlinkSync(pdfPath);
        } else {
            await ctx.reply('❌ No records found to export.');
        }
    } catch (err) {
        await ctx.reply('❌ Error generating PDF.');
    }
});

bot.action('menu_help', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        '📖 *TEXT FORMATTING GUIDE*\n' +
        'You can type naturally. Here are the supported formats:\n\n' +
        '*1. Standard Text (Easiest)*\n`Office to Site A 30km`\n\n' +
        '*2. Text with Date*\n`13/5/2026`\n`Office to Project Site 45km`\n\n' +
        '*3. Using Odometer Readings*\n`Today to KLCC`\n`Odo 12000 - 12045`\n\n' +
        '*4. Continuous Odometer*\n`Junction 4 Cheng odo 12080`\n',
        { parse_mode: 'Markdown' }
    );
});

module.exports = { bot };
