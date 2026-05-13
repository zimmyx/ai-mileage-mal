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

    const m = raw.match(/(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/);
    if (!m) return null;

    const day = String(Number(m[1])).padStart(2, '0');
    const month = String(Number(m[2])).padStart(2, '0');
    let year = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (year < 100) year += 2000;
    return `${year}-${month}-${day}`;
}

function cleanDestination(text) {
    return text
        .replace(/\b(hari ini|today|semalam|yesterday)\b/gi, '')
        .replace(/(^|\s)\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?(?=\s|$)/g, ' ')
        .replace(/\b(?:odo|odometer|meter)\b\s*\d+(?:\s*(?:-|ke|to|hingga|sampai|→)\s*\d+)?/gi, '')
        .replace(/\d{4,7}\s*(?:-|–|—|ke|to|hingga|sampai|→)\s*\d{4,7}/gi, '')
        .replace(/\b\d+(?:\.\d+)?\s*(?:km|kilometer|kilometre)\b/gi, '')
        .replace(/\b(?:pergi|ke|dari|from|to)\b\s*$/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/^[-–:,.\s]+|[-–:,.\s]+$/g, '')
        .trim();
}

function parseLine(line) {
    const original = line.trim();
    if (!original) return null;

    const date = normalizeDate(original) || getToday();

    const odoMatch = original.match(/(?:odo|odometer|meter)?\s*(\d{4,7})\s*(?:-|ke|to|hingga|sampai|→)\s*(\d{4,7})/i);
    const singleOdoMatch = original.match(/(?:odo|odometer|meter)\s*(?:end|akhir)?\s*(\d{4,7})/i);
    const distanceMatch = original.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometer|kilometre)\b/i);

    let odoStart = null;
    let odoEnd = null;
    let distance = null;

    if (odoMatch) {
        odoStart = Number(odoMatch[1]);
        odoEnd = Number(odoMatch[2]);
    } else if (singleOdoMatch) {
        odoEnd = Number(singleOdoMatch[1]);
    }

    if (distanceMatch) {
        distance = Number(distanceMatch[1]);
    }

    const destination = cleanDestination(original) || 'Unknown';

    if (!distance && !odoEnd && !odoStart) return null;

    return { date, odoStart, odoEnd, destination, distance };
}

function parseLocal(input) {
    const normalized = String(input || '').trim();
    if (!normalized) return null;

    const lines = normalized
        .split(/\n|;/)
        .map(l => l.trim())
        .filter(Boolean);

    const parsed = [];

    for (const line of lines.length ? lines : [normalized]) {
        const result = parseLine(line);
        if (result) parsed.push(result);
    }

    if (parsed.length > 0) return parsed;

    // Try whole input as one trip when multi-line notes contain one distance/odo.
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
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: 90000
    });

    if (!res.data || !res.data.choices || res.data.choices.length === 0) {
        console.error('AI Empty Response:', res.data);
        return null;
    }

    const text = res.data.choices[0].message.content;
    console.log(`AI Raw Response from ${model}: ${text}`);
    return extractJsonArray(text);
}

async function processMileage(input, type = 'text') {
    if (type !== 'text') {
        throw new Error(`Unsupported input type: ${type}`);
    }

    const normalizedInput = typeof input === 'string' ? input.trim() : '';
    if (!normalizedInput) {
        throw new Error('Mileage input is empty');
    }

    const localResult = parseLocal(normalizedInput);
    if (Array.isArray(localResult) && localResult.length > 0) {
        console.log('Using free local mileage parser');
        return localResult;
    }

    if (!OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY is not configured and local parser could not parse input');
    }

    const today = getToday();
    const prompt = `Act as an expert free mileage parser for a Malaysian traffic light technical support worker.
TODAY: ${today}

Extract trips into minified JSON array only.
Fields: date YYYY-MM-DD, odoStart number/null, odoEnd number/null, destination string, distance number/null.
Understand Malay, English, Manglish, short notes, odometer notes, places like JKR, SPG, simpang, site, client, office.
If only one final odometer is given, put it in odoEnd and odoStart null.
Use ${today} if no date.
Never invent distance or odo.
Return JSON array only.`;

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

module.exports = { processMileage, parseLocal };
