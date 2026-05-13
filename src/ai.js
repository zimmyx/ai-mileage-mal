const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODELS = [
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'google/gemini-2.0-flash-001'
];

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
        temperature: 0.1
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
    if (!OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY is not configured');
    }

    if (type !== 'text') {
        throw new Error(`Unsupported input type: ${type}`);
    }

    const normalizedInput = typeof input === 'string' ? input.trim() : '';
    if (!normalizedInput) {
        throw new Error('Mileage input is empty');
    }

    const today = new Date().toISOString().split('T')[0];
    const prompt = `Act as an expert mileage tracking assistant for a TRAFFIC LIGHT TECH SUPPORT specialist.
The user visits many junctions (Spg 3, Spg 4), traffic light sites, client places, and JKR offices for technical work.

TODAY'S DATE: ${today}

Extract MULTIPLE trips into a MINIFIED JSON ARRAY.

FOR EACH TRIP:
- date: YYYY-MM-DD (use ${today} if user says "today", "hari ini", or no date mentioned)
- odoStart: Starting odometer number, or null if not provided
- odoEnd: Ending odometer number, or null if not provided
- destination: Detailed junctions/locations/client/office names
- distance: km if odo not provided, or null if not provided

Rules:
- Understand Malay, English, Manglish, short notes, and long sentences.
- Treat each date block as one trip record when one odometer range is provided for that date.
- Keep destinations/tasks only from the same date block. Never copy destinations from another date.
- Preserve all work/location lines in the same date block by joining them with semicolons.
- If the user gives multiple places/trips under one date with one odometer range, keep them as one trip unless separate odometer ranges or distances are clear.
- If a date looks unusual but is explicitly written, use the written date and do not silently change it.
- Do not invent distance or odometer values.
- Respond ONLY with the JSON array. No markdown, no backticks.`;

    const content = `${prompt}\n\nInput: "${normalizedInput}"`;

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

module.exports = { processMileage };
