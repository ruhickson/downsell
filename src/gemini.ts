export async function listModels(apiKey: string): Promise<any> {
  const url = 'https://generativelanguage.googleapis.com/v1/models?key=' + apiKey;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const errorMessage = errorData.error?.message || `Gemini API error: ${res.status}`;
    throw new Error(errorMessage);
  }
  const data = await res.json();
  return data;
}

export async function getGeminiSuggestion(prompt: string, apiKey: string, maxTokens: number = 256): Promise<string> {
  const url = 'https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=' + apiKey;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: maxTokens
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const errorMessage = errorData.error?.message || `Gemini API error: ${res.status}`;
    throw new Error(errorMessage);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No suggestion generated.';
} 