// Netlify Function to categorize transactions using Gemini API
// Keeps API key secure on server-side

export const handler = async (event: any) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { descriptions, categories } = JSON.parse(event.body || '{}');
    
    if (!descriptions || !Array.isArray(descriptions) || descriptions.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Descriptions array is required' }),
      };
    }

    const apiKey = process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Gemini API key not configured' }),
      };
    }

    // Build prompt for batch categorization
    const categoriesList = categories.join(', ');
    const descriptionsList = descriptions.map((desc: string, idx: number) => `${idx + 1}. "${desc}"`).join('\n');
    
    const prompt = `You are a financial transaction categorizer. Categorize these transaction descriptions into exactly one of these categories: ${categoriesList}

Transactions:
${descriptionsList}

IMPORTANT: Return ONLY a valid JSON object mapping each transaction number to its category. Do not include any explanation or text outside the JSON.
Format: {"1": "CategoryName", "2": "CategoryName", ...}

Examples:
- "NETFLIX" → "Entertainment"
- "STARBUCKS" → "Coffee & Snacks"
- "UBER" → "Transportation"
- "AMAZON" → "Shopping"
- "GAS STATION" → "Transportation"

If you are unsure about a transaction, use "Other" for that transaction.`;
    
    console.log(`Sending ${descriptions.length} descriptions to Gemini with prompt length: ${prompt.length}`);

    // Call Gemini API
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3, // Lower temperature for more consistent categorization
          maxOutputTokens: 2000, // Increased for larger batches
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Gemini API error:', errorData);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: errorData.error?.message || 'Gemini API error' }),
      };
    }

    const data = await response.json();
    const geminiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log('Gemini response (first 500 chars):', geminiResponse.substring(0, 500));
    
    // Try to extract JSON from response
    const jsonMatch = geminiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        console.log('Parsed JSON result:', JSON.stringify(result).substring(0, 500));
        
        const categoryMap: Record<string, string> = {};
        
        descriptions.forEach((desc: string, idx: number) => {
          const category = result[String(idx + 1)] || result[idx + 1] || 'Other';
          categoryMap[desc] = category;
          if (category !== 'Other') {
            console.log(`  ✅ "${desc}" → ${category}`);
          }
        });
        
        const nonOtherCount = Object.values(categoryMap).filter(cat => cat !== 'Other').length;
        console.log(`Successfully categorized ${nonOtherCount}/${descriptions.length} as non-Other`);
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ categories: categoryMap }),
        };
      } catch (parseError) {
        console.error('JSON parsing error:', parseError, 'Response:', jsonMatch[0]);
      }
    } else {
      console.error('No JSON found in response. Full response:', geminiResponse);
    }

    // Fallback: return all as "Other"
    const fallback: Record<string, string> = {};
    descriptions.forEach((desc: string) => {
      fallback[desc] = 'Other';
    });
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ categories: fallback }),
    };
  } catch (error) {
    console.error('Error categorizing transactions:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

