const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const dotenv = require('dotenv');

dotenv.config();

const MILEAGE_HEADERS = ['Date', 'Destination', 'Odo Start', 'Odo End', 'Distance (km)', 'Claim (RM)', 'Logged At'];

function getAuth() {
    return new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

async function getSheet() {
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_MILEAGE_SHEET_ID, getAuth());
    await doc.loadInfo();
    let sheet = doc.sheetsByIndex[0];
    try {
        await sheet.loadHeaderRow();
    } catch (e) {
        await sheet.setHeaderRow(MILEAGE_HEADERS);
    }
    return sheet;
}

async function logMileage(data) {
    const sheet = await getSheet();
    const rate = parseFloat(process.env.MILEAGE_RATE) || 0.55; // Default to 0.55 as requested
    
    let distance = data.distance;
    if (data.odoStart && data.odoEnd) {
        distance = Math.abs(data.odoEnd - data.odoStart);
    }

    const claim = distance * rate;
    
    await sheet.addRow({
        'Date': data.date || new Date().toISOString().split('T')[0],
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
    
    const thisMonthRows = rows.filter(r => {
        const d = new Date(r.get('Date'));
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const totalKm = thisMonthRows.reduce((sum, r) => sum + (parseFloat(r.get('Distance (km)')) || 0), 0);
    const totalClaim = thisMonthRows.reduce((sum, r) => sum + (parseFloat(r.get('Claim (RM)')) || 0), 0);
    
    return { totalKm, totalClaim, count: thisMonthRows.length };
}

module.exports = { logMileage, getMileageSummary };
