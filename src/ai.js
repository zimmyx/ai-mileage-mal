const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODELS = [
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'nvidia/nemotron-3-nano-30b-a3b:free'
];

function getToday() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

function normalizeDate(raw) {
    if (!raw) return null;
    const today = getToday();
    const lower = raw.toLowerCase();
    if (/hari ini|today/.test(lower)) return today;
    if (/semalam|yesterday/.test(lower)) {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
    }
    const m = raw.match(/(^|\s)(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?(?=\s|$)/);
    if (!m) return null;
    const day = String(Number(m[2])).padStart(2, '0');
    const month = String(Number(m[3])).padStart(2, '0');
    let year = m[4] ? Number(m[4]) : new Date().getFullYear();
    if (year < 100) year += 2000;
    return `${year}-${month}-${day}`;
}

function isDateLine(line) {
    return /^\s*\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\s*$/.test(line.trim());
}

function isTimeLine(line) {
    const l = line.trim().toLowerCase();
    return /^\d{1,2}\.\d{2}\s*-\s*\d{1,2}(?:\.\d{2})?\s*(?:am|pm)?$/.test(l) || /^\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.\d{2}\s*(?:am|pm)?$/.test(l);
}

function extractOdoRange(text) {
    const match = text.match(/(?:^|\s)(\d{4,7})\s*(?:-|–|—|ke|to|hingga|sampai|→)\s*(\d{4,7})(?=\s|$)/i);
    if (!match) return null;
    return { odoStart: Number(match[1]), odoEnd: Number(match[2]) };
}

function extractSingleOdo(text) {
    const match = text.match(/(?:odo|odometer|meter)\s*(?:end|akhir)?\s*(\d{4,7})/i);
    return match ? Number(match[1]) : null;
}

function cleanDestination(text) {
    return text
        .replace(/\b(hari ini|today|semalam|yesterday|belum buat mileage)\b/gi, '')
        .replace(/(^|\s)\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?(?=\s|$)/g, ' ')
        .replace(/\b(?:odo|odometer|meter)\b\s*\d+(?:\s*(?:-|ke|to|hingga|sampai|→)\s*\d+)?/gi, '')
        .replace(/\d{4,7}\s*(?:-|–|—|ke|to|hingga|sampai|→)\s*\d{4,7}/gi, '')
        .replace(/\b\d+(?:\.\d+)?\s*(?:km|kilometer|kilometre)\b/gi, '')
        .split(/\n/)
        .map(line => line.trim())
        .filter(line => line && !isTimeLine(line) && !/^[-–—]+$/.test(line))
        .join('; ')
        .replace(/\s+/g, ' ')
        .replace(/^[-–:,.;\s]+|[-–:,.;\s]+$/g, '')
        .trim();
}

function parseLine(line) {
    const original = line.trim();
    if (!original) return null;
    const date = normalizeDate(original) || getToday();
    const odoRange = extractOdoRange(original);
    const singleOdo = extractSingleOdo(original);
    const distanceMatch = original.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometer|kilometre)\b/i);
    const destination = cleanDestination(original) || 'Unknown';
    const distance = distanceMatch ? Number(distanceMatch[1]) : null;
    const odoStart = odoRange ? odoRange.odoStart : null;
    const odoEnd = odoRange ? odoRange.odoEnd : singleOdo;
    if (!distance && !odoEnd && !odoStart) return null;
    return { date, odoStart, odoEnd, destination, distance };
}

function parseDateBlocks(input) {
    const lines = String(input || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const blocks = [];
    let current = null;

    for (const line of lines) {
        if (isDateLine(line)) {
            if (current) blocks.push(current);
            current = { date: normalizeDate(line), lines: [] };
        } else if (current) {
            current.lines.push(line);
        }
    }
    if (current) blocks.push(current);

    const parsed = [];
    for (const block of blocks) {
        const body = block.lines.join('\n');
        const odoRange = extractOdoRange(body);
        const distanceMatch = body.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometer|kilometre)\b/i);
        if (!odoRange && !distanceMatch) continue;
        const destination = cleanDestination(body) || 'Unknown';
        parsed.push({
            date: block.date || getToday(),
            odoStart: odoRange ? odoRange.odoStart : null,
            odoEnd: odoRange ? odoRange.odoEnd : null,
            destination,
            distance: distanceMatch ? Number(distanceMatch[1]) : null
        });
    }
    return parsed.length ? parsed : null;
}

function parseLocal(input) {
    const normalized = String(input || '').trim();
    if (!normalized) return null;

    const blockResult = parseDateBlocks(normalized);
    if (blockResult) return blockResult;

    const lines = normalized.split(/\n|;/).map(l => l.trim()).filter(Boolean);
    const parsed = [];
    for (const line of lines.length ? lines : [normalized]) {
        if (isTimeLine(line) || isDateLine(line)) continue;
        const result = parseLine(line);
        if (result) parsed.push(result);
    }
    if (parsed.length > 0) return parsed;
    const whole = parseLine(normalized.replace(/\n/g, ' '));
    return whole ? [whole] : null;
}

function extractJsonArray(text) {
    if (!text) return null;
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
}

async function callAI(model, content) {
    console.log(`Calling AI model: ${model}`);
    const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model,
        messages: [{ role: 'user', content }],
        temperature: 0
    }, {
        headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 90000
    });
    if (!res.data || !res.data.choices || res.data.choices.length === 0) return null;
    const text = res.data.choices[0].message.content;
    console.log(`AI Raw Response from ${model}: ${text}`);
    return extractJsonArray(text);
}

async function processMileage(input, type = 'text') {
    if (type !== 'text') throw new Error(`Unsupported input type: ${type}`);
    const normalizedInput = typeof input === 'string' ? input.trim() : '';
    if (!normalizedInput) throw new Error('Mileage input is empty');

    const localResult = parseLocal(normalizedInput);
    if (Array.isArray(localResult) && localResult.length > 0) {
        console.log('Using free local mileage parser');
        return localResult;
    }

    if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured and local parser could not parse input');

    const today = getToday();
    const prompt = `Act as an expert free mileage parser for a Malaysian traffic light technical support worker.
TODAY: ${today}
Extract trips into minified JSON array only.
Fields: date YYYY-MM-DD, odoStart number/null, odoEnd number/null, destination string, distance number/null.
For pasted work logs, group each date block as one trip when it has one odometer range.
Ignore time ranges like 8.30-1.00. Ignore incomplete odometer like 90804-.
Use ${today} if no date. Never invent distance or odo. Return JSON array only.`;
    const content = `${prompt}\n\nInput: ${JSON.stringify(normalizedInput)}`;

    for (const model of AI_MODELS) {
        try {
            const result = await callAI(model, content);
            if (Array.isArray(result)) return result;
        } catch (err) {
            const errorData = err.response ? JSON.stringify(err.response.data) : err.message;
            console.error(`AI Error (${model}):`, errorData);
        }
    }
    return null;
}

module.exports = { processMileage, parseLocal, parseDateBlocks };
