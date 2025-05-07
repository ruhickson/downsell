export async function getGeminiSuggestion(prompt: string, apiKey: string): Promise<string> {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 256
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Gemini API error');
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No suggestion generated.';
} 