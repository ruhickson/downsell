// Netlify Function to categorize transactions using Gemini API
// Keeps API key secure on server-side
// Also caches results in Supabase for future use

import { supabase } from './_supabase';

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

    // Build prompt for batch categorization with web search reasoning
    const categoriesList = categories.join(', ');
    const descriptionsList = descriptions.map((desc: string, idx: number) => `${idx + 1}. "${desc}"`).join('\n');
    
    const prompt = `You are a financial transaction categorizer. For each transaction description, use web search knowledge to understand what the merchant or service is, then categorize it.

Available categories: ${categoriesList}

Transactions to categorize:
${descriptionsList}

For each transaction:
1. Use your web search knowledge to understand what the merchant/service is
2. Categorize it into the most appropriate category from the list above
3. Use common sense: "Hairdressing" → "Health & Beauty", "Tesco" → "Groceries", "Netflix" → "Entertainment"

IMPORTANT: Return ONLY a valid JSON object mapping each transaction number to its category. Do not include any explanation or text outside the JSON.
Format: {"1": "CategoryName", "2": "CategoryName", ...}

Examples of good categorization:
- "HAIRDRESSING SALON" → "Health & Beauty"
- "TESCO STORES" → "Groceries"
- "NETFLIX" → "Entertainment"
- "STARBUCKS" → "Coffee & Snacks"
- "UBER" → "Transportation"
- "AMAZON" → "Shopping"
- "BP GAS STATION" → "Transportation"

Only use "Other" if you truly cannot determine what the merchant/service is even after considering web search knowledge.`;
    
    console.log(`Sending ${descriptions.length} descriptions to Gemini with web search-based categorization`);

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
          temperature: 0.2, // Lower temperature for more consistent categorization
          maxOutputTokens: 4000, // Increased for larger batches (up to 50 transactions)
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
        
        // Cache results in Supabase for future use (fire and forget)
        if (supabase && nonOtherCount > 0) {
          const cacheEntries = Object.entries(categoryMap)
            .filter(([_, category]) => category !== 'Other')
            .map(([name, category]) => ({
              transaction_name: name.trim().toUpperCase(),
              category: category,
            }));
          
          if (cacheEntries.length > 0) {
            supabase
              .from('category_transaction')
              .upsert(cacheEntries, {
                onConflict: 'transaction_name',
                ignoreDuplicates: false,
              })
              .then(({ error }) => {
                if (error) {
                  console.warn('Failed to cache categories:', error);
                } else {
                  console.log(`✅ Cached ${cacheEntries.length} category mappings`);
                }
              })
              .catch(err => console.warn('Cache write error (non-blocking):', err));
          }
        }
        
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

