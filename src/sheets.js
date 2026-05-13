const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const dotenv = require('dotenv');

dotenv.config();

const MILEAGE_HEADERS = ['Date', 'Week', 'Destination', 'Odo Start', 'Odo End', 'Distance (km)', 'Claim (RM)', 'Logged At'];
const LOG_HEADERS = ['Time', 'Module', 'Error'];

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not configured`);
    return value;
}

function getAuth() {
    return new JWT({
        email: getRequiredEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
        key: getRequiredEnv('GOOGLE_PRIVATE_KEY').replace(/\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

async function getDoc() {
    const doc = new GoogleSpreadsheet(getRequiredEnv('GOOGLE_MILEAGE_SHEET_ID'), getAuth());
    await doc.loadInfo();
    return doc;
}

async function getSheet() {
    const doc = await getDoc();
    let sheet = doc.sheetsByIndex[0];
    try { await sheet.loadHeaderRow(); } catch (e) { await sheet.setHeaderRow(MILEAGE_HEADERS); }
    return sheet;
}

async function getLogSheet() {
    const doc = await getDoc();
    let sheet = doc.sheetsByTitle['Logs'];
    if (!sheet) sheet = await doc.addSheet({ title: 'Logs', headerValues: LOG_HEADERS });
    try { await sheet.loadHeaderRow(); } catch (e) { await sheet.setHeaderRow(LOG_HEADERS); }
    return sheet;
}

function getMalaysiaDateString(date = new Date()) {
    const malaysiaDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
    return malaysiaDate.toISOString().split('T')[0];
}

function getWeekNumber(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 4 - (date.getDay() || 7));
    const yearStart = new Date(date.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `Week ${weekNo}`;
}

function calculateDistance(data) {
    let distance = Number(data.distance || 0);
    if (data.odoStart != null && data.odoEnd != null && data.odoStart !== '' && data.odoEnd !== '') {
        distance = Math.abs(Number(data.odoEnd) - Number(data.odoStart));
    }
    return distance;
}

async function getLastOdoEnd() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    for (let i = rows.length - 1; i >= 0; i--) {
        const val = rows[i].get('Odo End');
        if (val && !isNaN(Number(val))) return Number(val);
    }
    return null;
}

async function enrichWithOdoMemory(data) {
    if ((data.odoStart == null || data.odoStart === '') && data.odoEnd != null && data.distance == null) {
        const lastOdo = await getLastOdoEnd();
        if (lastOdo != null && Number(data.odoEnd) > lastOdo) {
            return { ...data, odoStart: lastOdo, distance: null };
        }
    }
    return data;
}

async function findDuplicate(data) {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const date = data.date || getMalaysiaDateString();
    const distance = calculateDistance(data);
    const dest = String(data.destination || '').toLowerCase().trim();

    return rows.find(r => {
        const rowDate = r.get('Date');
        const rowDest = String(r.get('Destination') || '').toLowerCase().trim();
        const rowKm = parseFloat(r.get('Distance (km)')) || 0;
        return rowDate === date && rowDest === dest && Math.abs(rowKm - distance) < 0.1;
    }) || null;
}

async function logMileage(data) {
    const sheet = await getSheet();
    const rate = parseFloat(process.env.MILEAGE_RATE) || 0.60;
    const enriched = await enrichWithOdoMemory(data);
    const distance = calculateDistance(enriched);
    const claim = distance * rate;
    const dateStr = enriched.date || getMalaysiaDateString();
    
    await sheet.addRow({
        'Date': dateStr,
        'Week': getWeekNumber(dateStr),
        'Destination': enriched.destination || 'Unknown',
        'Odo Start': enriched.odoStart || '',
        'Odo End': enriched.odoEnd || '',
        'Distance (km)': distance,
        'Claim (RM)': claim.toFixed(2),
        'Logged At': new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })
    });
    return { distance, claim, data: enriched };
}

async function getMileageSummary() {
    const rows = await getMonthlyRows();
    return summarizeRows(rows);
}

function summarizeRows(rows) {
    const totalKm = rows.reduce((sum, r) => sum + (parseFloat(r.get('Distance (km)')) || 0), 0);
    const totalClaim = rows.reduce((sum, r) => sum + (parseFloat(r.get('Claim (RM)')) || 0), 0);
    return { totalKm, totalClaim, count: rows.length };
}

async function getTodaySummary() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const today = getMalaysiaDateString();
    return summarizeRows(rows.filter(r => r.get('Date') === today));
}

async function getWeeklySummary() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const currentWeek = getWeekNumber(new Date());
    const currentYear = new Date().getFullYear();
    const weeklyRows = rows.filter(r => r.get('Week') === currentWeek && new Date(r.get('Date')).getFullYear() === currentYear);
    return { ...summarizeRows(weeklyRows), week: currentWeek };
}

async function hasRecordsThisWeek() {
    const summary = await getWeeklySummary();
    return summary.count > 0;
}

async function getMonthlyRows(month = null) {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    let targetYear, targetMonth;
    if (month) {
        const [year, monthNum] = month.split('-').map(Number);
        targetYear = year; targetMonth = monthNum - 1;
    } else {
        const now = new Date(); targetYear = now.getFullYear(); targetMonth = now.getMonth();
    }
    return rows.filter(r => {
        const rowDate = new Date(r.get('Date'));
        return rowDate.getMonth() === targetMonth && rowDate.getFullYear() === targetYear;
    });
}

async function getMonthlyReport(month = null) {
    const monthlyRows = await getMonthlyRows(month);
    const weeks = {};
    monthlyRows.forEach(r => {
        const w = r.get('Week');
        if (!weeks[w]) weeks[w] = { km: 0, rm: 0, count: 0 };
        weeks[w].km += parseFloat(r.get('Distance (km)')) || 0;
        weeks[w].rm += parseFloat(r.get('Claim (RM)')) || 0;
        weeks[w].count += 1;
    });
    return weeks;
}

function rowToDeleted(row) {
    return { destination: row.get('Destination'), distance: row.get('Distance (km)'), claim: row.get('Claim (RM)') };
}

async function deleteLastRecord() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    if (rows.length === 0) return null;
    const lastRow = rows[rows.length - 1];
    const deleted = rowToDeleted(lastRow);
    await lastRow.delete();
    return deleted;
}

async function deleteRecordByRow(rowNumber) {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const dataIndex = rowNumber - 2;
    if (dataIndex < 0 || dataIndex >= rows.length) return null;
    const row = rows[dataIndex];
    const deleted = rowToDeleted(row);
    await row.delete();
    return deleted;
}

async function editLastRecord(field, value) {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    if (rows.length === 0) return null;
    const row = rows[rows.length - 1];
    const rate = parseFloat(process.env.MILEAGE_RATE) || 0.60;
    const map = { destination: 'Destination', date: 'Date', distance: 'Distance (km)', odostart: 'Odo Start', odoend: 'Odo End' };
    const key = map[String(field).toLowerCase()];
    if (!key) throw new Error('Unsupported edit field');
    row.set(key, value);
    if (key === 'Date') row.set('Week', getWeekNumber(value));
    if (['Distance (km)', 'Odo Start', 'Odo End'].includes(key)) {
        const distance = calculateDistance({
            distance: row.get('Distance (km)'),
            odoStart: row.get('Odo Start'),
            odoEnd: row.get('Odo End')
        });
        row.set('Distance (km)', distance);
        row.set('Claim (RM)', (distance * rate).toFixed(2));
    }
    await row.save();
    return { destination: row.get('Destination'), distance: row.get('Distance (km)'), claim: row.get('Claim (RM)'), field, value };
}

async function logError(module, error) {
    try {
        const sheet = await getLogSheet();
        await sheet.addRow({
            'Time': new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' }),
            'Module': module,
            'Error': String(error).substring(0, 1000)
        });
    } catch (err) { console.error('Failed to log error to sheet:', err.message); }
}

module.exports = {
    logMileage, getMileageSummary, getWeeklySummary, getMonthlyReport, getTodaySummary,
    getMonthlyRows, deleteLastRecord, deleteRecordByRow, editLastRecord, logError,
    calculateDistance, getLastOdoEnd, enrichWithOdoMemory, findDuplicate, hasRecordsThisWeek
};
