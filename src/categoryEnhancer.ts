// Utility to enhance transaction categories using Gemini API
// Uses a hybrid approach: check cache first, then use AI if needed

import { type Category } from './categories';
import { getCachedCategory, cacheCategory } from './categoryCache';

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
  batchSize: number = 50 // Increased batch size for better performance with large datasets
): Promise<Transaction[]> {
  // Get unique "Other" category transactions (by description to avoid duplicates)
  const otherTransactions = transactions.filter(tx => !tx.Category || tx.Category === 'Other');
  const uniqueDescriptions = Array.from(new Set(otherTransactions.map(tx => tx.Description)));
  
  if (uniqueDescriptions.length === 0) {
    return transactions; // Nothing to enhance
  }
  
  console.log(`🔄 Enhancing ${uniqueDescriptions.length} unique "Other" transactions...`);
  
  // Step 1: Check cache for known transaction names
  const cacheResults: Record<string, Category> = {};
  const uncachedDescriptions: string[] = [];
  
  console.log(`📚 Checking cache for ${uniqueDescriptions.length} transaction names...`);
  for (const desc of uniqueDescriptions) {
    const cached = await getCachedCategory(desc);
    if (cached) {
      cacheResults[desc] = cached as Category;
    } else {
      uncachedDescriptions.push(desc);
    }
  }
  
  const cachedCount = Object.keys(cacheResults).length;
  const uncachedCount = uncachedDescriptions.length;
  console.log(`✅ Found ${cachedCount} in cache, ${uncachedCount} need AI categorization`);
  
  // Step 2: Use AI only for uncached transactions
  const categoryMap: Record<string, Category> = { ...cacheResults };
  
  if (uncachedDescriptions.length > 0) {
    console.log(`🤖 Using AI to categorize ${uncachedDescriptions.length} new transaction names...`);
  
    // Process in batches with retry logic and timeout handling
    for (let i = 0; i < uncachedDescriptions.length; i += batchSize) {
      const batch = uncachedDescriptions.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(uncachedDescriptions.length / batchSize);
    console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} transactions, ${uniqueDescriptions.length - i} remaining)...`);
    
    let batchResults: Record<string, Category> | null = null;
    let retries = 3;
    
    // Retry logic for failed batches
    while (retries > 0 && !batchResults) {
      try {
        // In development, pass API key for fallback; in production, it's not needed
        const devApiKey = import.meta.env.DEV ? (apiKey || import.meta.env.VITE_GEMINI_API_KEY) : undefined;
        
        // Add timeout to prevent hanging (30 seconds per batch)
        batchResults = await Promise.race([
          batchCategorizeWithGemini(batch, devApiKey),
          new Promise<Record<string, Category>>((_, reject) => 
            setTimeout(() => reject(new Error('Batch timeout after 30 seconds')), 30000)
          )
        ]);
        
        const categorizedCount = Object.values(batchResults).filter(cat => cat !== 'Other').length;
        console.log(`✅ Batch ${batchNumber}: Categorized ${categorizedCount}/${batch.length} transactions`);
        Object.assign(categoryMap, batchResults);
        break; // Success, exit retry loop
      } catch (error) {
        retries--;
        if (retries > 0) {
          const waitTime = (4 - retries) * 2000; // Exponential backoff: 2s, 4s, 6s
          console.warn(`⚠️ Batch ${batchNumber} failed, retrying in ${waitTime/1000}s... (${retries} attempts left)`, error);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          console.error(`❌ Failed to enhance batch ${batchNumber} after 3 attempts:`, error);
          // Fallback: mark all in this batch as "Other" to continue processing
          batch.forEach(desc => {
            if (!categoryMap[desc]) {
              categoryMap[desc] = 'Other';
            }
          });
        }
      }
    }
    
    // Small delay between batches to respect rate limits (reduced for large datasets)
    if (i + batchSize < uniqueDescriptions.length) {
      await new Promise(resolve => setTimeout(resolve, 300)); // 0.3 second delay (reduced for faster processing)
    }
  }
  
  // Update all transactions with enhanced categories
  // Create new array with new objects to ensure React detects the change
  let updatedCount = 0;
  const finalTransactions = enhancedTransactions.map(tx => {
    if (!tx.Category || tx.Category === 'Other') {
      const enhancedCategory = categoryMap[tx.Description] || 'Other';
      if (enhancedCategory !== 'Other') {
        updatedCount++;
        console.log(`  🔄 Updating "${tx.Description}" from "Other" to "${enhancedCategory}"`);
      }
      // Return new object with updated category
      return { ...tx, Category: enhancedCategory };
    }
    return tx; // Return unchanged transaction
  });
  
  const totalProcessed = uniqueDescriptions.length;
  const fromCache = cachedCount;
  const fromAI = uncachedCount;
  console.log(`✅ Enhanced ${updatedCount} transactions (${totalProcessed} total: ${fromCache} from cache, ${fromAI} from AI)`);
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

