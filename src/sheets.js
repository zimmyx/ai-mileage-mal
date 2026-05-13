const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const dotenv = require('dotenv');

dotenv.config();

const MILEAGE_HEADERS = ['Date', 'Week', 'Destination', 'Odo Start', 'Odo End', 'Distance (km)', 'Claim (RM)', 'Logged At'];
const LOG_HEADERS = ['Time', 'Module', 'Error'];

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not configured`);
    }
    return value;
}

function getAuth() {
    return new JWT({
        email: getRequiredEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
        key: getRequiredEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
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
    try {
        await sheet.loadHeaderRow();
    } catch (e) {
        await sheet.setHeaderRow(MILEAGE_HEADERS);
    }
    return sheet;
}

async function getLogSheet() {
    const doc = await getDoc();
    let sheet = doc.sheetsByTitle['Logs'];
    if (!sheet) {
        sheet = await doc.addSheet({ title: 'Logs', headerValues: LOG_HEADERS });
    }
    try {
        await sheet.loadHeaderRow();
    } catch (e) {
        await sheet.setHeaderRow(LOG_HEADERS);
    }
    return sheet;
}

function getMalaysiaDateString(date = new Date()) {
    const malaysiaDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
    return malaysiaDate.toISOString().split('T')[0];
}

// Helper to get week number
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

async function logMileage(data) {
    const sheet = await getSheet();
    const rate = parseFloat(process.env.MILEAGE_RATE) || 0.60;
    const distance = calculateDistance(data);
    const claim = distance * rate;
    const dateStr = data.date || getMalaysiaDateString();
    
    await sheet.addRow({
        'Date': dateStr,
        'Week': getWeekNumber(dateStr),
        'Destination': data.destination || 'Unknown',
        'Odo Start': data.odoStart || '',
        'Odo End': data.odoEnd || '',
        'Distance (km)': distance,
        'Claim (RM)': claim.toFixed(2),
        'Logged At': new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })
    });
    
    return { distance, claim };
}

async function getMileageSummary() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthlyRows = rows.filter(r => {
        const rowDate = new Date(r.get('Date'));
        return rowDate.getMonth() === currentMonth && rowDate.getFullYear() === currentYear;
    });

    const totalKm = monthlyRows.reduce((sum, r) => sum + (parseFloat(r.get('Distance (km)')) || 0), 0);
    const totalClaim = monthlyRows.reduce((sum, r) => sum + (parseFloat(r.get('Claim (RM)')) || 0), 0);

    return { totalKm, totalClaim, count: monthlyRows.length };
}

async function getTodaySummary() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const today = getMalaysiaDateString();

    const todayRows = rows.filter(r => r.get('Date') === today);

    const totalKm = todayRows.reduce((sum, r) => sum + (parseFloat(r.get('Distance (km)')) || 0), 0);
    const totalClaim = todayRows.reduce((sum, r) => sum + (parseFloat(r.get('Claim (RM)')) || 0), 0);

    return { totalKm, totalClaim, count: todayRows.length };
}

async function getWeeklySummary() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const now = new Date();
    const currentWeek = getWeekNumber(now);
    const currentYear = now.getFullYear();
    
    const weeklyRows = rows.filter(r => {
        const rowDate = new Date(r.get('Date'));
        return r.get('Week') === currentWeek && rowDate.getFullYear() === currentYear;
    });

    const totalKm = weeklyRows.reduce((sum, r) => sum + (parseFloat(r.get('Distance (km)')) || 0), 0);
    const totalClaim = weeklyRows.reduce((sum, r) => sum + (parseFloat(r.get('Claim (RM)')) || 0), 0);
    
    return { totalKm, totalClaim, count: weeklyRows.length, week: currentWeek };
}

async function getMonthlyRows(month = null) {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    
    let targetYear;
    let targetMonth;

    if (month) {
        const [year, monthNum] = month.split('-').map(Number);
        targetYear = year;
        targetMonth = monthNum - 1;
    } else {
        const now = new Date();
        targetYear = now.getFullYear();
        targetMonth = now.getMonth();
    }

    return rows.filter(r => {
        const rowDate = new Date(r.get('Date'));
        return rowDate.getMonth() === targetMonth && rowDate.getFullYear() === targetYear;
    });
}

async function getMonthlyReport(month = null) {
    const monthlyRows = await getMonthlyRows(month);
    
    // Group by week
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

async function deleteLastRecord() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    if (rows.length === 0) return null;

    const lastRow = rows[rows.length - 1];
    const deleted = {
        destination: lastRow.get('Destination'),
        distance: lastRow.get('Distance (km)'),
        claim: lastRow.get('Claim (RM)')
    };

    await lastRow.delete();
    return deleted;
}

async function deleteRecordByRow(rowNumber) {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    
    // Google Sheet row includes header at row 1, data starts at row 2
    const dataIndex = rowNumber - 2;
    if (dataIndex < 0 || dataIndex >= rows.length) return null;

    const row = rows[dataIndex];
    const deleted = {
        destination: row.get('Destination'),
        distance: row.get('Distance (km)'),
        claim: row.get('Claim (RM)')
    };

    await row.delete();
    return deleted;
}

async function logError(module, error) {
    try {
        const sheet = await getLogSheet();
        await sheet.addRow({
            'Time': new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' }),
            'Module': module,
            'Error': String(error).substring(0, 1000)
        });
    } catch (err) {
        console.error('Failed to log error to sheet:', err.message);
    }
}

module.exports = { 
    logMileage, 
    getMileageSummary, 
    getWeeklySummary, 
    getMonthlyReport,
    getTodaySummary,
    getMonthlyRows,
    deleteLastRecord,
    deleteRecordByRow,
    logError,
    calculateDistance
};
