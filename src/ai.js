const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

async function processMileage(input, type = 'text') {
    const today = new Date().toISOString().split('T')[0];
    const prompt = `Act as a mileage tracking assistant using ODOMETER readings.
Extract:
1. destination: where the user went.
2. odoStart: the starting odometer number.
3. odoEnd: the ending odometer number.
4. distance: If user gives km directly instead of odo, put it here.
5. date: YYYY-MM-DD.

Respond ONLY with valid JSON.
Example 1: "75461 to 84231 kl" -> {"odoStart":75461, "odoEnd":84231, "destination":"kl"}
Example 2: "odo 100-200 office" -> {"odoStart":100, "odoEnd":200, "destination":"office"}`;

    let content = [{ type: 'text', text: `${prompt}\n\nInput: "${input}"` }];
    if (type === 'voice') {
        content = [{ type: 'text', text: `${prompt}\n\nListen to this audio and extract odo readings and destination: ${input}` }];
    }

    try {
        const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'google/gemini-2.0-flash-001',
            messages: [{ role: 'user', content }],
            temperature: 0.1
        }, {
            headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` }
        });

        const text = res.data.choices?.[0]?.message?.content;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (err) {
        return null;
    }
}

module.exports = { processMileage };
