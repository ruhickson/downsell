// Utility to enhance transaction categories using Gemini API
// Only enhances transactions categorized as "Other" to save API calls

import { type Category } from './categories';

// Transaction type (matches App.tsx)
type Transaction = {
  Description: string;
  Amount: number;
  Type: string;
  Date: string;
  Currency: string;
  Balance?: number;
  BankSource: string;
  Account: string;
  Category?: string;
  OriginalData: any;
};

/**
 * Batch categorize multiple transactions using Netlify Function (server-side)
 * Keeps API key secure on server
 * Falls back to direct API call in development mode
 */
async function batchCategorizeWithGemini(
  descriptions: string[],
  apiKey?: string // Used as fallback in development
): Promise<Record<string, Category>> {
  const { getAllCategories } = await import('./categories');
  
  const categories = getAllCategories();
  const isDevelopment = import.meta.env.DEV;
  
  try {
    // In development, try Netlify Function first, fall back to direct API call
    // In production, always use Netlify Function
    if (!isDevelopment) {
      console.log(`📤 Sending ${descriptions.length} descriptions to server for categorization...`);
      
      const response = await fetch('/.netlify/functions/categorize-transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          descriptions,
          categories,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      const categoryMap: Record<string, Category> = data.categories || {};
      
      console.log(`✅ Successfully received ${Object.keys(categoryMap).length} categories from server`);
      return categoryMap;
    } else {
      // Development mode: try Netlify Function first, fall back to direct API
      try {
        console.log(`📤 [DEV] Trying Netlify Function first...`);
        const response = await fetch('/.netlify/functions/categorize-transactions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            descriptions,
            categories,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const categoryMap: Record<string, Category> = data.categories || {};
          console.log(`✅ [DEV] Successfully received ${Object.keys(categoryMap).length} categories from server`);
          return categoryMap;
        }
      } catch (netlifyError) {
        console.warn('⚠️ [DEV] Netlify Function not available, falling back to direct API call');
      }
      
      // Fallback to direct API call in development
      if (!apiKey) {
        console.warn('⚠️ [DEV] No API key available for direct call. Install Netlify Dev or set VITE_GEMINI_API_KEY');
        throw new Error('No API key available');
      }
      
      console.log(`📤 [DEV] Calling Gemini API directly (API key exposed in network tab - development only)`);
      
      const categoriesList = categories.join(', ');
      const descriptionsList = descriptions.map((desc, idx) => `${idx + 1}. "${desc}"`).join('\n');
      
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

      const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2000,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const geminiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      console.log(`📥 [DEV] Gemini response (first 500 chars):`, geminiResponse.substring(0, 500));
      
      // Try to extract JSON from response
      const jsonMatch = geminiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          console.log(`📋 [DEV] Parsed JSON result:`, result);
          
          const categoryMap: Record<string, Category> = {};
          
          descriptions.forEach((desc, idx) => {
            const category = result[String(idx + 1)] || result[idx + 1] || 'Other';
            categoryMap[desc] = category as Category;
            if (category !== 'Other') {
              console.log(`  ✅ "${desc}" → ${category}`);
            }
          });
          
          const nonOtherCount = Object.values(categoryMap).filter(cat => cat !== 'Other').length;
          console.log(`✅ [DEV] Successfully parsed ${Object.keys(categoryMap).length} categories from Gemini (${nonOtherCount} non-Other)`);
          return categoryMap;
        } catch (parseError) {
          console.error('❌ [DEV] JSON parsing error:', parseError, 'Response:', jsonMatch[0]);
        }
      } else {
        console.error('❌ [DEV] No JSON found in response. Full response:', geminiResponse);
      }
      
      throw new Error('Failed to parse Gemini response');
    }
  } catch (error) {
    console.error('❌ Batch categorization failed:', error);
    // Fallback: return all as "Other"
    const fallback: Record<string, Category> = {};
    descriptions.forEach(desc => { fallback[desc] = 'Other'; });
    return fallback;
  }
}

/**
 * Enhance categories for transactions marked as "Other"
 * Uses Netlify Function (server-side) to call Gemini API securely
 * 
 * @param transactions - Array of transactions to enhance
 * @param apiKey - Not used (kept for compatibility, API key is on server)
 * @param batchSize - Number of transactions per API call (default: 20)
 * @returns Promise that resolves with enhanced transactions
 */
export async function enhanceCategoriesWithLLM(
  transactions: Transaction[],
  apiKey?: string, // Used in development mode as fallback
  batchSize: number = 20
): Promise<Transaction[]> {
  // Get all unique transaction descriptions (categorize everything via AI)
  const uniqueDescriptions = Array.from(new Set(transactions.map(tx => tx.Description)));
  
  if (uniqueDescriptions.length === 0) {
    return transactions; // Nothing to categorize
  }
  
  console.log(`🔄 Categorizing ${uniqueDescriptions.length} unique transactions with AI...`);
  
  const categoryMap: Record<string, Category> = {};
  
  // Process in batches
  for (let i = 0; i < uniqueDescriptions.length; i += batchSize) {
    const batch = uniqueDescriptions.slice(i, i + batchSize);
    console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(uniqueDescriptions.length / batchSize)} (${batch.length} transactions)...`);
    
    try {
      // In development, pass API key for fallback; in production, it's not needed
      const devApiKey = import.meta.env.DEV ? (apiKey || import.meta.env.VITE_GEMINI_API_KEY) : undefined;
      const batchResults = await batchCategorizeWithGemini(batch, devApiKey);
      const categorizedCount = Object.values(batchResults).filter(cat => cat !== 'Other').length;
      console.log(`✅ Batch ${Math.floor(i / batchSize) + 1}: Categorized ${categorizedCount}/${batch.length} transactions`);
      Object.assign(categoryMap, batchResults);
      
      // Small delay between batches to respect rate limits
      if (i + batchSize < uniqueDescriptions.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    } catch (error) {
      console.error(`❌ Failed to categorize batch ${i}-${i + batchSize}:`, error);
    }
  }
  
  // Update all transactions with AI-categorized categories
  // Create new array with new objects to ensure React detects the change
  let updatedCount = 0;
  const finalTransactions = transactions.map(tx => {
    const aiCategory = categoryMap[tx.Description] || 'Other';
    if (aiCategory !== 'Other') {
      updatedCount++;
    }
    // Return new object with AI-assigned category
    return { ...tx, Category: aiCategory };
  });
  
  console.log(`✅ Categorized ${updatedCount} transactions via AI (${uniqueDescriptions.length} unique descriptions processed)`);
  console.log(`📊 Final category distribution:`, Object.entries(
    finalTransactions.reduce((acc, tx) => {
      const cat = tx.Category || 'Other';
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ));
  return finalTransactions;
}

/**
 * Get statistics about category distribution
 */
export function getCategoryStats(transactions: Transaction[]): Record<Category, number> {
  const stats: Record<string, number> = {};
  
  transactions.forEach(tx => {
    const category = tx.Category || 'Other';
    stats[category] = (stats[category] || 0) + 1;
  });
  
  return stats as Record<Category, number>;
}

