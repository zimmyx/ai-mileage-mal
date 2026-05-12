const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

async function processMileage(input, type = 'text') {
    const today = new Date().toISOString().split('T')[0];
    const prompt = `Act as an expert mileage tracking assistant for a TRAFFIC LIGHT TECH SUPPORT specialist. 
The user visits many junctions (Spg 3, Spg 4) and JKR offices for technical work.

Extract MULTIPLE trips into a MINIFIED JSON ARRAY.

FOR EACH TRIP:
- date: YYYY-MM-DD
- odoStart: Starting odometer number
- odoEnd: Ending odometer number
- destination: Detailed junctions/locations
- distance: km if odo not provided.

Respond ONLY with the JSON array. No markdown, no backticks.`;

    let content = [{ type: 'text', text: `${prompt}\n\nInput: "${input}"` }];
    if (type === 'voice') {
        content = [{ type: 'text', text: `${prompt}\n\nListen and extract ALL traffic light service trips: ${input}` }];
    }

    try {
        console.log(`Calling High-Performance AI for Traffic Tech Batch...`);
        const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'google/gemini-2.0-flash-001', 
            messages: [{ role: 'user', content }],
            temperature: 0.1
        }, {
            headers: { 
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        if (!res.data || !res.data.choices || res.data.choices.length === 0) {
            console.error('AI Empty Response:', res.data);
            return null;
        }

        let text = res.data.choices[0].message.content;
        console.log(`AI Raw Response: ${text}`);
        
        if (!text) return null;

        // Clean markdown
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return null;
    } catch (err) {
        console.error('AI Error:', err.response ? JSON.stringify(err.response.data) : err.message);
        return null;
    }
}

module.exports = { processMileage };
