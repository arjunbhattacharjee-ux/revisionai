export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY not configured in environment variables' });
  }

  try {
    // Convert Anthropic-style request to Groq/OpenAI format
    const { messages, max_tokens } = req.body;

    const groqBody = {
      model: 'llama-3.3-70b-versatile', // Best free Llama model on Groq
      messages: messages,
      max_tokens: max_tokens || 3000,
      temperature: 0.7,
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(groqBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Groq error:', data);
      return res.status(response.status).json(data);
    }

    // Convert Groq response back to Anthropic-style format
    // so the frontend doesn't need to change
    const converted = {
      content: [
        {
          type: 'text',
          text: data.choices?.[0]?.message?.content || '',
        }
      ]
    };

    return res.status(200).json(converted);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Failed to reach Groq API' });
  }
}
