// Category cache management - stores transaction name to category mappings
// Uses Supabase for persistent storage, with localStorage as fallback

import { createClient } from '@supabase/supabase-js';

const CACHE_KEY = 'downsell_category_cache';
const CACHE_VERSION = 1;

// Get Supabase client (if configured)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// LocalStorage cache structure
type LocalCache = {
  version: number;
  mappings: Record<string, { category: string; timestamp: number }>;
};

/**
 * Get category from cache (Supabase first, then localStorage)
 */
export async function getCachedCategory(transactionName: string): Promise<string | null> {
  const normalizedName = transactionName.trim().toUpperCase();
  
  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('category_transaction')
        .select('category')
        .eq('transaction_name', normalizedName)
        .single();
      
      if (!error && data) {
        // Also cache in localStorage for offline use
        cacheInLocalStorage(normalizedName, data.category);
        return data.category;
      }
    } catch (err) {
      console.warn('Supabase lookup failed, falling back to localStorage:', err);
    }
  }
  
  // Fallback to localStorage
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const cache: LocalCache = JSON.parse(cached);
      if (cache.version === CACHE_VERSION && cache.mappings[normalizedName]) {
        const mapping = cache.mappings[normalizedName];
        // Check if cache is still valid (30 days)
        const age = Date.now() - mapping.timestamp;
        if (age < 30 * 24 * 60 * 60 * 1000) {
          return mapping.category;
        }
      }
    }
  } catch (err) {
    console.warn('LocalStorage lookup failed:', err);
  }
  
  return null;
}

/**
 * Store category in cache (Supabase first, then localStorage)
 */
export async function cacheCategory(transactionName: string, category: string): Promise<void> {
  const normalizedName = transactionName.trim().toUpperCase();
  
  // Try Supabase first
  if (supabase) {
    try {
      const { error } = await supabase
        .from('category_transaction')
        .upsert({
          transaction_name: normalizedName,
          category: category,
          usage_count: 1,
        }, {
          onConflict: 'transaction_name',
          ignoreDuplicates: false,
        });
      
      if (!error) {
        // Also cache in localStorage
        cacheInLocalStorage(normalizedName, category);
        return;
      } else {
        console.warn('Supabase cache write failed, using localStorage only:', error);
      }
    } catch (err) {
      console.warn('Supabase cache write error, using localStorage only:', err);
    }
  }
  
  // Fallback to localStorage
  cacheInLocalStorage(normalizedName, category);
}

/**
 * Cache in localStorage (helper function)
 */
function cacheInLocalStorage(transactionName: string, category: string): void {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    let cache: LocalCache = cached 
      ? JSON.parse(cached) 
      : { version: CACHE_VERSION, mappings: {} };
    
    // Update version if needed
    if (cache.version !== CACHE_VERSION) {
      cache = { version: CACHE_VERSION, mappings: {} };
    }
    
    cache.mappings[transactionName] = {
      category,
      timestamp: Date.now(),
    };
    
    // Limit cache size to 1000 entries to prevent localStorage bloat
    const entries = Object.entries(cache.mappings);
    if (entries.length > 1000) {
      // Remove oldest entries
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toKeep = entries.slice(-1000);
      cache.mappings = Object.fromEntries(toKeep);
    }
    
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('LocalStorage cache write failed:', err);
  }
}

/**
 * Get all cached categories (for debugging/stats)
 */
export function getCacheStats(): { total: number; entries: Array<{ name: string; category: string }> } {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const cache: LocalCache = JSON.parse(cached);
      const entries = Object.entries(cache.mappings).map(([name, data]) => ({
        name,
        category: data.category,
      }));
      return { total: entries.length, entries };
    }
  } catch (err) {
    console.warn('Failed to get cache stats:', err);
  }
  return { total: 0, entries: [] };
}

