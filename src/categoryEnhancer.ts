// Utility to enhance transaction categories using Gemini API
// Only enhances transactions categorized as "Other" to save API calls

import { categorizeTransaction, type Category } from './categories';

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
      
      const prompt = `Categorize these transaction descriptions into exactly one of these categories: ${categoriesList}

Transactions:
${descriptionsList}

Return a JSON object mapping each transaction number to its category. Format: {"1": "CategoryName", "2": "CategoryName", ...}
If unsure about any transaction, use "Other" for that transaction.`;

      const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const geminiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // Try to extract JSON from response
      const jsonMatch = geminiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          const categoryMap: Record<string, Category> = {};
          
          descriptions.forEach((desc, idx) => {
            const category = result[String(idx + 1)] || result[idx + 1] || 'Other';
            categoryMap[desc] = category as Category;
          });
          
          console.log(`✅ [DEV] Successfully parsed ${Object.keys(categoryMap).length} categories from Gemini`);
          return categoryMap;
        } catch (parseError) {
          console.error('❌ [DEV] JSON parsing error:', parseError, 'Response:', jsonMatch[0]);
        }
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
  // Get unique "Other" category transactions (by description to avoid duplicates)
  const otherTransactions = transactions.filter(tx => !tx.Category || tx.Category === 'Other');
  const uniqueDescriptions = Array.from(new Set(otherTransactions.map(tx => tx.Description)));
  
  if (uniqueDescriptions.length === 0) {
    return transactions; // Nothing to enhance
  }
  
  console.log(`🔄 Enhancing ${uniqueDescriptions.length} unique "Other" transactions with LLM...`);
  
  const enhancedTransactions = [...transactions];
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
      console.error(`❌ Failed to enhance batch ${i}-${i + batchSize}:`, error);
    }
  }
  
  // Update all transactions with enhanced categories
  let updatedCount = 0;
  enhancedTransactions.forEach(tx => {
    if (!tx.Category || tx.Category === 'Other') {
      const enhancedCategory = categoryMap[tx.Description] || 'Other';
      if (enhancedCategory !== 'Other') {
        updatedCount++;
      }
      tx.Category = enhancedCategory;
    }
  });
  
  console.log(`✅ Enhanced ${updatedCount} transactions (${uniqueDescriptions.length} unique descriptions processed)`);
  return enhancedTransactions;
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

