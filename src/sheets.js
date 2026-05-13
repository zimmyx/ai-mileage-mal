const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const dotenv = require('dotenv');

dotenv.config();

const MILEAGE_HEADERS = ['Date', 'Week', 'Destination', 'Odo Start', 'Odo End', 'Distance (km)', 'Claim (RM)', 'Logged At'];

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

async function getSheet() {
    const doc = new GoogleSpreadsheet(getRequiredEnv('GOOGLE_MILEAGE_SHEET_ID'), getAuth());
    await doc.loadInfo();
    let sheet = doc.sheetsByIndex[0];
    try {
        await sheet.loadHeaderRow();
    } catch (e) {
        await sheet.setHeaderRow(MILEAGE_HEADERS);
    }
    return sheet;
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

async function logMileage(data) {
    const sheet = await getSheet();
    const rate = parseFloat(process.env.MILEAGE_RATE) || 0.55;
    
    let distance = data.distance;
    if (data.odoStart && data.odoEnd) {
        distance = Math.abs(data.odoEnd - data.odoStart);
    }

    const claim = distance * rate;
    const dateStr = data.date || new Date().toISOString().split('T')[0];
    
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

async function getWeeklySummary() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const now = new Date();
    const currentWeek = getWeekNumber(now);
    
    const weeklyRows = rows.filter(r => r.get('Week') === currentWeek);

    const totalKm = weeklyRows.reduce((sum, r) => sum + (parseFloat(r.get('Distance (km)')) || 0), 0);
    const totalClaim = weeklyRows.reduce((sum, r) => sum + (parseFloat(r.get('Claim (RM)')) || 0), 0);
    
    return { totalKm, totalClaim, count: weeklyRows.length, week: currentWeek };
}

async function getMonthlyReport() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const monthlyRows = rows.filter(r => {
        const rowDate = new Date(r.get('Date'));
        return rowDate.getMonth() === currentMonth && rowDate.getFullYear() === currentYear;
    });
    
    // Group by week
    const weeks = {};
    monthlyRows.forEach(r => {
        const w = r.get('Week');
        if (!weeks[w]) weeks[w] = { km: 0, rm: 0 };
        weeks[w].km += parseFloat(r.get('Distance (km)')) || 0;
        weeks[w].rm += parseFloat(r.get('Claim (RM)')) || 0;
    });

    return weeks;
}

module.exports = { logMileage, getMileageSummary, getWeeklySummary, getMonthlyReport };
