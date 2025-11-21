// Transaction categorization system
// Uses rule-based keyword matching for fast, privacy-friendly categorization
// Falls back to Gemini API for unknown merchants with caching

import { getGeminiSuggestion } from './gemini';

export type Category = 
  | 'Entertainment'
  | 'Food & Dining'
  | 'Coffee & Snacks'
  | 'Shopping'
  | 'Transportation'
  | 'Utilities'
  | 'Healthcare'
  | 'Education'
  | 'Travel'
  | 'Subscriptions'
  | 'Insurance'
  | 'Banking & Finance'
  | 'Charity & Donations'
  | 'Home & Garden'
  | 'Personal Care'
  | 'Other';

export interface CategoryRule {
  keywords: string[];
  category: Category;
  priority?: number; // Higher priority = checked first
}

// Category rules - ordered by priority (most specific first)
const categoryRules: CategoryRule[] = [
  // Entertainment - Streaming, gaming, etc.
  {
    keywords: ['netflix', 'spotify', 'disney', 'hulu', 'prime video', 'amazon prime', 'youtube premium', 'apple tv', 'hbo', 'paramount', 'peacock'],
    category: 'Entertainment',
    priority: 10
  },
  {
    keywords: ['steam', 'playstation', 'xbox', 'nintendo', 'epic games', 'ubisoft', 'ea games'],
    category: 'Entertainment',
    priority: 10
  },
  {
    keywords: ['cinema', 'odeon', 'vue', 'cineworld', 'imax', 'movie', 'theatre', 'theater'],
    category: 'Entertainment',
    priority: 9
  },
  
  // Subscriptions
  {
    keywords: ['patreon', 'onlyfans', 'substack', 'medium', 'newsletter'],
    category: 'Subscriptions',
    priority: 10
  },
  {
    keywords: ['adobe', 'microsoft', 'office 365', 'google workspace', 'dropbox', 'icloud'],
    category: 'Subscriptions',
    priority: 9
  },
  
  // Coffee & Snacks
  {
    keywords: ['starbucks', 'costa', 'nero', 'cafe', 'coffee', 'espresso', 'latte', 'cappuccino'],
    category: 'Coffee & Snacks',
    priority: 10
  },
  {
    keywords: ['bakery', 'pastry', 'donut', 'muffin', 'croissant'],
    category: 'Coffee & Snacks',
    priority: 8
  },
  
  // Food & Dining
  {
    keywords: ['restaurant', 'dining', 'bistro', 'brasserie', 'pub', 'bar & grill'],
    category: 'Food & Dining',
    priority: 10
  },
  {
    keywords: ['mcdonald', 'burger king', 'kfc', 'subway', 'pizza hut', 'domino', 'papa john'],
    category: 'Food & Dining',
    priority: 9
  },
  {
    keywords: ['deliveroo', 'just eat', 'ubereats', 'doordash', 'grubhub', 'takeaway'],
    category: 'Food & Dining',
    priority: 9
  },
  {
    keywords: ['tesco', 'supervalu', 'dunnes', 'lidl', 'aldi', 'spar', 'centra', 'eurospar', 'groceries', 'supermarket'],
    category: 'Food & Dining',
    priority: 8
  },
  
  // Transportation
  {
    keywords: ['uber', 'lyft', 'taxi', 'cab', 'bolt'],
    category: 'Transportation',
    priority: 10
  },
  {
    keywords: ['dublin bus', 'luas', 'dart', 'irish rail', 'bus eireann'],
    category: 'Transportation',
    priority: 9
  },
  {
    keywords: ['petrol', 'gas station', 'fuel', 'esso', 'shell', 'bp', 'texaco'],
    category: 'Transportation',
    priority: 8
  },
  {
    keywords: ['parking', 'park & ride', 'ncp', 'q-park'],
    category: 'Transportation',
    priority: 8
  },
  
  // Utilities
  {
    keywords: ['electric ireland', 'sse airtricity', 'energia', 'bord gais', 'prepaypower'],
    category: 'Utilities',
    priority: 10
  },
  {
    keywords: ['eir', 'vodafone', 'three', 'virgin media', 'sky', 'bt'],
    category: 'Utilities',
    priority: 9
  },
  {
    keywords: ['water', 'irish water', 'uisce eireann'],
    category: 'Utilities',
    priority: 9
  },
  
  // Healthcare
  {
    keywords: ['pharmacy', 'chemist', 'boots', 'meaghers', 'hickey', 'lloyds'],
    category: 'Healthcare',
    priority: 10
  },
  {
    keywords: ['doctor', 'gp', 'medical', 'clinic', 'hospital', 'dental', 'dentist', 'optician', 'physio'],
    category: 'Healthcare',
    priority: 9
  },
  {
    keywords: ['vhi', 'laya', 'irish life health', 'health insurance'],
    category: 'Healthcare',
    priority: 8
  },
  
  // Insurance
  {
    keywords: ['aviva', 'allianz', 'axa', 'fbd', 'liberty', 'zurich', 'insurance'],
    category: 'Insurance',
    priority: 9
  },
  
  // Shopping
  {
    keywords: ['amazon', 'ebay', 'etsy', 'asos', 'zalando', 'boohoo'],
    category: 'Shopping',
    priority: 9
  },
  {
    keywords: ['ikea', 'argos', 'currys', 'harvey norman', 'did electrical'],
    category: 'Shopping',
    priority: 8
  },
  {
    keywords: ['penneys', 'primark', 'hm ', 'zara', 'mango', 'next'],
    category: 'Shopping',
    priority: 8
  },
  
  // Education
  {
    keywords: ['university', 'college', 'school', 'tuition', 'course', 'training'],
    category: 'Education',
    priority: 9
  },
  
  // Travel
  {
    keywords: ['hotel', 'airbnb', 'booking.com', 'expedia', 'trivago'],
    category: 'Travel',
    priority: 10
  },
  {
    keywords: ['aer lingus', 'ryanair', 'easyjet', 'airline', 'airport'],
    category: 'Travel',
    priority: 9
  },
  {
    keywords: ['train', 'bus', 'ferry', 'car rental', 'hertz', 'avis'],
    category: 'Travel',
    priority: 8
  },
  
  // Banking & Finance
  {
    keywords: ['revolut', 'n26', 'aib', 'bank of ireland', 'ulster bank', 'kbc', 'ptsb'],
    category: 'Banking & Finance',
    priority: 10
  },
  {
    keywords: ['atm', 'withdrawal', 'transfer', 'fee', 'interest'],
    category: 'Banking & Finance',
    priority: 8
  },
  
  // Charity & Donations
  {
    keywords: ['charity', 'donation', 'go fund me', 'justgiving'],
    category: 'Charity & Donations',
    priority: 9
  },
  
  // Home & Garden
  {
    keywords: ['b&q', 'woodies', 'homebase', 'diy', 'hardware', 'garden centre'],
    category: 'Home & Garden',
    priority: 8
  },
  
  // Personal Care
  {
    keywords: ['hairdresser', 'barber', 'salon', 'spa', 'beauty', 'gym', 'fitness'],
    category: 'Personal Care',
    priority: 8
  }
];

// Cache for LLM categorization results (stored in localStorage)
const CACHE_KEY = 'downsell_category_cache';
const CACHE_EXPIRY_DAYS = 90; // Cache results for 90 days

interface CachedCategory {
  category: Category;
  timestamp: number;
}

function getCachedCategory(description: string): Category | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    
    const cache: Record<string, CachedCategory> = JSON.parse(cached);
    const normalizedDesc = description.toLowerCase().trim();
    const entry = cache[normalizedDesc];
    
    if (entry) {
      const ageInDays = (Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24);
      if (ageInDays < CACHE_EXPIRY_DAYS) {
        return entry.category;
      }
    }
  } catch (error) {
    console.warn('Failed to read category cache:', error);
  }
  return null;
}

function setCachedCategory(description: string, category: Category): void {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    const cache: Record<string, CachedCategory> = cached ? JSON.parse(cached) : {};
    const normalizedDesc = description.toLowerCase().trim();
    
    cache[normalizedDesc] = {
      category,
      timestamp: Date.now()
    };
    
    // Limit cache size to 1000 entries to avoid localStorage bloat
    const entries = Object.entries(cache);
    if (entries.length > 1000) {
      // Remove oldest 100 entries
      const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      sorted.slice(0, 100).forEach(([key]) => delete cache[key]);
    }
    
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Failed to write category cache:', error);
  }
}

/**
 * Categorize a transaction using Gemini API
 * Only called for transactions that don't match rule-based patterns
 */
async function categorizeWithGemini(description: string, apiKey: string): Promise<Category> {
  const categories = getAllCategories().join(', ');
  const prompt = `Category this transaction description into exactly one of these categories: ${categories}

Transaction: "${description}"

Return ONLY the category name, nothing else. If unsure, return "Other".`;

  try {
    const response = await getGeminiSuggestion(prompt, apiKey, 20); // Max 20 tokens (just category name)
    const category = response.trim() as Category;
    
    // Validate the response is a valid category
    if (getAllCategories().includes(category)) {
      return category;
    }
    return 'Other';
  } catch (error) {
    console.warn('Gemini categorization failed:', error);
    return 'Other';
  }
}

/**
 * Categorize a transaction based on its description
 * Uses keyword matching first (fast, free), then falls back to Gemini API with caching
 * 
 * @param description - Transaction description/merchant name
 * @param useLLMFallback - Whether to use Gemini API for unknown merchants (default: true)
 * @param apiKey - Gemini API key (required if useLLMFallback is true)
 * @returns Category
 */
export async function categorizeTransaction(
  description: string,
  useLLMFallback: boolean = true,
  apiKey?: string
): Promise<Category> {
  if (!description) return 'Other';
  
  const normalizedDescription = description.toLowerCase().trim();
  
  // Step 1: Check cache first
  const cached = getCachedCategory(description);
  if (cached) {
    return cached;
  }
  
  // Step 2: Try rule-based matching
  const sortedRules = [...categoryRules].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  
  for (const rule of sortedRules) {
    for (const keyword of rule.keywords) {
      if (normalizedDescription.includes(keyword.toLowerCase())) {
        const category = rule.category;
        // Cache the result
        setCachedCategory(description, category);
        return category;
      }
    }
  }
  
  // Step 3: Fall back to LLM if enabled and API key provided
  if (useLLMFallback && apiKey) {
    const category = await categorizeWithGemini(description, apiKey);
    // Cache the LLM result
    setCachedCategory(description, category);
    return category;
  }
  
  // Step 4: Default to 'Other' if no match and no LLM fallback
  return 'Other';
}

/**
 * Synchronous version - uses only rule-based matching (no LLM)
 * Use this for initial categorization, then enhance with async version if needed
 */
export function categorizeTransactionSync(description: string): Category {
  if (!description) return 'Other';
  
  const normalizedDescription = description.toLowerCase().trim();
  
  // Check cache first
  const cached = getCachedCategory(description);
  if (cached) {
    return cached;
  }
  
  // Try rule-based matching
  const sortedRules = [...categoryRules].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  
  for (const rule of sortedRules) {
    for (const keyword of rule.keywords) {
      if (normalizedDescription.includes(keyword.toLowerCase())) {
        const category = rule.category;
        setCachedCategory(description, category);
        return category;
      }
    }
  }
  
  return 'Other';
}

/**
 * Get all categories
 */
export function getAllCategories(): Category[] {
  return [
    'Entertainment',
    'Food & Dining',
    'Coffee & Snacks',
    'Shopping',
    'Transportation',
    'Utilities',
    'Healthcare',
    'Education',
    'Travel',
    'Subscriptions',
    'Insurance',
    'Banking & Finance',
    'Charity & Donations',
    'Home & Garden',
    'Personal Care',
    'Other'
  ];
}

/**
 * Get category color for UI display
 */
export function getCategoryColor(category: Category): string {
  const colors: Record<Category, string> = {
    'Entertainment': '#e91e63',
    'Food & Dining': '#ff9800',
    'Coffee & Snacks': '#795548',
    'Shopping': '#9c27b0',
    'Transportation': '#2196f3',
    'Utilities': '#00bcd4',
    'Healthcare': '#f44336',
    'Education': '#4caf50',
    'Travel': '#009688',
    'Subscriptions': '#ff5722',
    'Insurance': '#607d8b',
    'Banking & Finance': '#3f51b5',
    'Charity & Donations': '#8bc34a',
    'Home & Garden': '#cddc39',
    'Personal Care': '#ffc107',
    'Other': '#9e9e9e'
  };
  return colors[category] || colors['Other'];
}

