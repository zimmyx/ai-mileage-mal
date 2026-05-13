const PDFDocument = require('pdfkit');
const { getMonthlyRows } = require('./sheets');

async function generatePDF(month = null) {
    const rows = await getMonthlyRows(month);
    
    if (rows.length === 0) {
        throw new Error('Tiada data untuk bulan yang dipilih');
    }

    const userName = process.env.USER_NAME || 'Akmal';
    const rate = parseFloat(process.env.MILEAGE_RATE) || 0.60;

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Title
        doc.fontSize(22).font('Helvetica-Bold').text('LAPORAN TUNTUTAN MILEAGE', { align: 'center' });
        doc.moveDown(0.5);

        // Month info
        const firstDate = new Date(rows[0].get('Date'));
        const monthName = firstDate.toLocaleString('ms-MY', { month: 'long', year: 'numeric' });
        doc.fontSize(14).font('Helvetica').text(monthName, { align: 'center' });
        doc.moveDown(1);

        // User info
        doc.fontSize(11);
        doc.text(`Nama: ${userName}`, 50);
        doc.text(`Kadar Claim: RM ${rate.toFixed(2)} per km`, 50);
        doc.text(`Tarikh Jana: ${new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })}`, 50);
        doc.moveDown(1.5);

        // Table headers
        doc.fontSize(10);
        const tableTop = doc.y;
        const colWidths = { date: 70, destination: 200, distance: 60, claim: 60 };

        doc.font('Helvetica-Bold');
        doc.text('Tarikh', 50, tableTop, { width: colWidths.date });
        doc.text('Destinasi', 50 + colWidths.date, tableTop, { width: colWidths.destination });
        doc.text('Jarak (km)', 50 + colWidths.date + colWidths.destination, tableTop, { width: colWidths.distance, align: 'right' });
        doc.text('Claim (RM)', 50 + colWidths.date + colWidths.destination + colWidths.distance, tableTop, { width: colWidths.claim, align: 'right' });

        doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
        doc.moveDown();

        // Table rows
        doc.font('Helvetica');
        let totalKm = 0;
        let totalClaim = 0;

        rows.forEach((row, idx) => {
            const y = doc.y;
            
            if (y > 700) {
                doc.addPage();
                doc.y = 50;
            }

            const date = row.get('Date');
            const destination = row.get('Destination') || 'Unknown';
            const distance = parseFloat(row.get('Distance (km)')) || 0;
            const claim = parseFloat(row.get('Claim (RM)')) || 0;

            totalKm += distance;
            totalClaim += claim;

            doc.text(date, 50, doc.y, { width: colWidths.date });
            doc.text(destination.substring(0, 45), 50 + colWidths.date, doc.y - 12, { width: colWidths.destination });
            doc.text(distance.toFixed(1), 50 + colWidths.date + colWidths.destination, doc.y - 12, { width: colWidths.distance, align: 'right' });
            doc.text(claim.toFixed(2), 50 + colWidths.date + colWidths.destination + colWidths.distance, doc.y - 12, { width: colWidths.claim, align: 'right' });

            doc.moveDown(0.5);
        });

        // Total line
        doc.moveDown();
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);

        doc.font('Helvetica-Bold');
        doc.text('JUMLAH', 50, doc.y, { width: colWidths.date + colWidths.destination });
        doc.text(totalKm.toFixed(1), 50 + colWidths.date + colWidths.destination, doc.y - 12, { width: colWidths.distance, align: 'right' });
        doc.text(totalClaim.toFixed(2), 50 + colWidths.date + colWidths.destination + colWidths.distance, doc.y - 12, { width: colWidths.claim, align: 'right' });

        // Signature section
        doc.moveDown(3);
        doc.font('Helvetica');
        doc.fontSize(10);
        doc.text('Disediakan oleh:', 50);
        doc.moveDown(2);
        doc.text('_______________________', 50);
        doc.text(userName, 50);
        doc.text('Tarikh: ______________', 50);

        doc.moveDown(2);
        doc.text('Disahkan oleh:', 350);
        doc.moveDown(2);
        doc.text('_______________________', 350);
        doc.text('Penyelia', 350);
        doc.text('Tarikh: ______________', 350);

        // Footer
        doc.moveDown(2);
        doc.fontSize(8);
        doc.text('Dijana secara automatik oleh AI Mileage Bot', { align: 'center' });

        doc.end();
    });
}

module.exports = { generatePDF };
