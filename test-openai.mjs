import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log('Testing OpenAI API with model gpt-5-mini-2025-08-07...\n');

try {
  const completion = await client.responses.create({
    model: "gpt-5-mini-2025-08-07",
    input: [
      { role: "system", content: "Return valid JSON only." },
      { role: "user", content: 'Return exactly: {"test": "success"}' }
    ],
  });
  console.log('Raw response:', completion);
  console.log('Output text:', completion.output_text);
} catch (err) {
  console.error('OpenAI Error:', err.message);
  console.error('Full error:', err);
}
