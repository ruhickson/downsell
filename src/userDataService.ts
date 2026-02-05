// User Data Service - Saves and loads user data from Supabase
// Falls back to localStorage if Supabase is not configured
// Encrypts sensitive data before saving, decrypts after loading

import { createClient } from '@supabase/supabase-js';
import { encryptData, decryptData } from './encryption';

// Get Supabase client (if configured)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Types matching App.tsx
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

type Subscription = {
  description: string;
  total: number;
  count: number;
  average: number;
  maxAmount: number;
  standardDeviation: number;
  timeSpan: number | null;
  frequency: number | null;
  avgDaysBetween: number | null;
  subscriptionScore: number;
  firstDate: Date | null;
  lastDate: Date | null;
  frequencyLabel: string;
};

// UploadedFile can be either:
// 1. From App.tsx state: { file: File; bankType: string; rowCount: number; account: string }
// 2. From storage: { bankType: string; rowCount: number; account: string; fileName?: string; fileSize?: number; fileType?: string; lastModified?: number; createdAt?: string }
type UploadedFileInput = {
  file?: File;
  bankType: string;
  rowCount: number;
  account: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  lastModified?: number;
  createdAt?: string; // ISO timestamp from database
};

type UserData = {
  csvData: Transaction[];
  subscriptions: Subscription[];
  uploadedFiles: UploadedFileInput[];
};

// LocalStorage fallback functions
function getUserDataKey(email: string): string {
  return `downsell_user_data_${email}`;
}

function saveUserDataToLocalStorage(email: string, data: UserData): void {
  try {
    const serializableData = {
      csvData: data.csvData,
      subscriptions: data.subscriptions.map(sub => ({
        ...sub,
        firstDate: sub.firstDate ? sub.firstDate.toISOString() : null,
        lastDate: sub.lastDate ? sub.lastDate.toISOString() : null
      })),
      uploadedFiles: data.uploadedFiles.map(file => ({
        bankType: file.bankType,
        rowCount: file.rowCount,
        account: file.account,
        // Extract file metadata if File object exists
        fileName: file.file?.name || file.fileName,
        fileSize: file.file?.size || file.fileSize,
        fileType: file.file?.type || file.fileType,
        lastModified: file.file?.lastModified || file.lastModified,
        createdAt: file.createdAt || new Date().toISOString() // Include timestamp, use current time as fallback
      }))
    };
    localStorage.setItem(getUserDataKey(email), JSON.stringify(serializableData));
    console.log('💾 [UserDataService] User data saved to localStorage for', email);
  } catch (error) {
    console.error('❌ [UserDataService] Failed to save user data to localStorage:', error);
  }
}

function loadUserDataFromLocalStorage(email: string): UserData | null {
  try {
    const data = localStorage.getItem(getUserDataKey(email));
    if (data) {
      const parsed = JSON.parse(data);
      const restoredData: UserData = {
        ...parsed,
        subscriptions: parsed.subscriptions?.map((sub: any) => ({
          ...sub,
          firstDate: sub.firstDate ? new Date(sub.firstDate) : null,
          lastDate: sub.lastDate ? new Date(sub.lastDate) : null
        })) || []
      };
      console.log('📂 [UserDataService] User data loaded from localStorage for', email);
      return restoredData;
    }
  } catch (error) {
    console.error('❌ [UserDataService] Failed to load user data from localStorage:', error);
  }
  return null;
}

// Supabase functions
async function saveUserDataToSupabase(email: string, data: UserData): Promise<boolean> {
  if (!supabase || !email) {
    return false;
  }

  try {
    // Delete existing data for this user first (to replace, not append)
    await Promise.all([
      supabase.from('user_transactions').delete().eq('user_email', email),
      supabase.from('user_subscriptions').delete().eq('user_email', email),
      supabase.from('user_uploaded_files').delete().eq('user_email', email)
    ]);

    // Insert transactions (with encryption of sensitive fields)
    if (data.csvData.length > 0) {
      const transactions = await Promise.all(
        data.csvData.map(async (tx) => {
          // Encrypt sensitive fields
          const encryptedDescription = await encryptData(tx.Description, email);
          const encryptedOriginalData = tx.OriginalData 
            ? await encryptData(tx.OriginalData, email)
            : null;

          return {
            user_email: email,
            description: encryptedDescription, // Encrypted
            amount: tx.Amount,
            type: tx.Type,
            date: tx.Date,
            currency: tx.Currency,
            balance: tx.Balance || null,
            bank_source: tx.BankSource,
            account: tx.Account,
            category: tx.Category || null,
            original_data: encryptedOriginalData // Encrypted
          };
        })
      );

      // Insert in batches of 1000 to avoid payload size limits
      const batchSize = 1000;
      for (let i = 0; i < transactions.length; i += batchSize) {
        const batch = transactions.slice(i, i + batchSize);
        const { error } = await supabase.from('user_transactions').insert(batch);
        if (error) {
          console.error('❌ [UserDataService] Error inserting transactions:', error);
          return false;
        }
      }
    }

    // Insert subscriptions (with encryption of sensitive fields)
    if (data.subscriptions.length > 0) {
      const subscriptions = await Promise.all(
        data.subscriptions.map(async (sub) => {
          // Encrypt sensitive fields
          const encryptedDescription = await encryptData(sub.description, email);

          return {
            user_email: email,
            description: encryptedDescription, // Encrypted
            total: sub.total,
            count: sub.count,
            average: sub.average,
            max_amount: sub.maxAmount,
            standard_deviation: sub.standardDeviation,
            time_span: sub.timeSpan,
            frequency: sub.frequency,
            avg_days_between: sub.avgDaysBetween,
            first_date: sub.firstDate ? sub.firstDate.toISOString().split('T')[0] : null,
            last_date: sub.lastDate ? sub.lastDate.toISOString().split('T')[0] : null
            // Note: subscriptionScore and frequencyLabel are calculated fields, not stored
          };
        })
      );

      const { error } = await supabase.from('user_subscriptions').insert(subscriptions);
      if (error) {
        console.error('❌ [UserDataService] Error inserting subscriptions:', error);
        return false;
      }
    }

    // Insert uploaded files (no encryption needed)
    if (data.uploadedFiles.length > 0) {
      const uploadedFiles = data.uploadedFiles.map(file => ({
        user_email: email,
        bank_type: file.bankType,
        row_count: file.rowCount,
        account: file.account,
        file_name: file.file?.name || file.fileName || null,
        file_size: file.file?.size || file.fileSize || null,
        file_type: file.file?.type || file.fileType || null,
        last_modified: file.file?.lastModified || file.lastModified || null
      }));

      const { error } = await supabase.from('user_uploaded_files').insert(uploadedFiles);
      if (error) {
        console.error('❌ [UserDataService] Error inserting uploaded files:', error);
        return false;
      }
    }

    console.log('✅ [UserDataService] User data saved to Supabase for', email, {
      csvDataCount: data.csvData.length,
      subscriptionsCount: data.subscriptions.length,
      uploadedFilesCount: data.uploadedFiles.length
    });
    return true;
  } catch (error) {
    console.error('❌ [UserDataService] Failed to save user data to Supabase:', error);
    return false;
  }
}

async function loadUserDataFromSupabase(email: string): Promise<UserData | null> {
  if (!supabase || !email) {
    return null;
  }

  try {
    // Load transactions
    const { data: transactions, error: txError } = await supabase
      .from('user_transactions')
      .select('*')
      .eq('user_email', email)
      .order('date', { ascending: false });

    if (txError) {
      console.error('❌ [UserDataService] Error loading transactions:', txError);
      return null;
    }

    // Load subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_email', email);

    if (subError) {
      console.error('❌ [UserDataService] Error loading subscriptions:', subError);
      return null;
    }

    // Load uploaded files (including created_at timestamp)
    const { data: uploadedFiles, error: filesError } = await supabase
      .from('user_uploaded_files')
      .select('*, created_at')
      .eq('user_email', email)
      .order('created_at', { ascending: false });

    if (filesError) {
      console.error('❌ [UserDataService] Error loading uploaded files:', filesError);
      return null;
    }

    // Convert database format to app format (with decryption of sensitive fields)
    const csvData: Transaction[] = await Promise.all(
      (transactions || []).map(async (tx) => {
        // Decrypt sensitive fields
        let decryptedDescription: string;
        let decryptedOriginalData: any = {};
        
        try {
          decryptedDescription = await decryptData(tx.description, email);
        } catch (error) {
          console.warn('⚠️ [UserDataService] Failed to decrypt transaction description, using fallback:', error);
          decryptedDescription = tx.description; // Fallback to encrypted value if decryption fails
        }
        
        if (tx.original_data) {
          try {
            decryptedOriginalData = await decryptData(tx.original_data, email);
          } catch (error) {
            console.warn('⚠️ [UserDataService] Failed to decrypt original_data:', error);
            decryptedOriginalData = {};
          }
        }

        return {
          Description: decryptedDescription,
          Amount: parseFloat(tx.amount),
          Type: tx.type,
          Date: tx.date,
          Currency: tx.currency,
          Balance: tx.balance ? parseFloat(tx.balance) : undefined,
          BankSource: tx.bank_source,
          Account: tx.account,
          Category: tx.category || undefined,
          OriginalData: decryptedOriginalData
        };
      })
    );

    const subs: Subscription[] = await Promise.all(
      (subscriptions || []).map(async (sub) => {
        // Decrypt sensitive fields
        let decryptedDescription: string;
        try {
          decryptedDescription = await decryptData(sub.description, email);
        } catch (error) {
          console.warn('⚠️ [UserDataService] Failed to decrypt subscription description:', error);
          decryptedDescription = sub.description; // Fallback
        }

        return {
          description: decryptedDescription,
          total: parseFloat(sub.total),
          count: sub.count,
          average: parseFloat(sub.average),
          maxAmount: parseFloat(sub.max_amount),
          standardDeviation: parseFloat(sub.standard_deviation),
          timeSpan: sub.time_span,
          frequency: sub.frequency ? parseFloat(sub.frequency) : null,
          avgDaysBetween: sub.avg_days_between ? parseFloat(sub.avg_days_between) : null,
          subscriptionScore: 0, // Will be recalculated when subscriptions are processed
          firstDate: sub.first_date ? new Date(sub.first_date) : null,
          lastDate: sub.last_date ? new Date(sub.last_date) : null,
          frequencyLabel: '' // Will be recalculated when subscriptions are processed
        };
      })
    );

    const files: UploadedFileInput[] = (uploadedFiles || []).map(file => ({
      bankType: file.bank_type,
      rowCount: file.row_count,
      account: file.account,
      fileName: file.file_name || undefined,
      fileSize: file.file_size || undefined,
      fileType: file.file_type || undefined,
      lastModified: file.last_modified || undefined,
      createdAt: file.created_at || undefined
    }));

    console.log('📂 [UserDataService] User data loaded from Supabase for', email, {
      csvDataCount: csvData.length,
      subscriptionsCount: subs.length,
      uploadedFilesCount: files.length
    });

    return {
      csvData,
      subscriptions: subs,
      uploadedFiles: files
    };
  } catch (error) {
    console.error('❌ [UserDataService] Failed to load user data from Supabase:', error);
    return null;
  }
}

// Public API
export async function saveUserData(email: string, data: UserData): Promise<void> {
  if (!email) {
    console.warn('⚠️ [UserDataService] No email provided, skipping save');
    return;
  }

  // Try Supabase first, fall back to localStorage
  const supabaseSuccess = await saveUserDataToSupabase(email, data);
  
  // Always save to localStorage as backup
  saveUserDataToLocalStorage(email, data);
  
  if (supabaseSuccess) {
    console.log('✅ [UserDataService] Data saved to Supabase and localStorage');
  } else {
    console.log('⚠️ [UserDataService] Data saved to localStorage only (Supabase not configured or failed)');
  }
}

export async function loadUserData(email: string): Promise<UserData | null> {
  if (!email) {
    console.warn('⚠️ [UserDataService] No email provided, skipping load');
    return null;
  }

  // Try Supabase first
  const supabaseData = await loadUserDataFromSupabase(email);
  if (supabaseData) {
    // Also update localStorage with the data from Supabase
    saveUserDataToLocalStorage(email, supabaseData);
    return supabaseData;
  }

  // Fall back to localStorage
  const localStorageData = loadUserDataFromLocalStorage(email);
  if (localStorageData) {
    // Try to sync to Supabase in the background
    saveUserDataToSupabase(email, localStorageData).catch(err => {
      console.warn('⚠️ [UserDataService] Failed to sync localStorage data to Supabase:', err);
    });
    return localStorageData;
  }

  console.log('📭 [UserDataService] No saved data found for', email);
  return null;
}

export async function clearUserData(email: string): Promise<void> {
  if (!email) {
    return;
  }

  // Clear from Supabase
  if (supabase) {
    try {
      await Promise.all([
        supabase.from('user_transactions').delete().eq('user_email', email),
        supabase.from('user_subscriptions').delete().eq('user_email', email),
        supabase.from('user_uploaded_files').delete().eq('user_email', email)
      ]);
      console.log('🗑️ [UserDataService] User data cleared from Supabase for', email);
    } catch (error) {
      console.error('❌ [UserDataService] Failed to clear user data from Supabase:', error);
    }
  }

  // Clear from localStorage
  try {
    localStorage.removeItem(getUserDataKey(email));
    console.log('🗑️ [UserDataService] User data cleared from localStorage for', email);
  } catch (error) {
    console.error('❌ [UserDataService] Failed to clear user data from localStorage:', error);
  }
}

/**
 * Delete a specific file and all associated transactions and subscriptions
 * @param email User email
 * @param account Account identifier for the file (e.g., "AIB-1", "REV-1")
 */
export async function deleteFileAndAssociatedData(email: string, account: string): Promise<boolean> {
  if (!email || !account) {
    return false;
  }

  try {
    // Delete from Supabase
    if (supabase) {
      // Delete all transactions with this account
      const { error: txError } = await supabase
        .from('user_transactions')
        .delete()
        .eq('user_email', email)
        .eq('account', account);

      if (txError) {
        console.error('❌ [UserDataService] Error deleting transactions:', txError);
        return false;
      }

      // Delete the file record
      const { error: fileError } = await supabase
        .from('user_uploaded_files')
        .delete()
        .eq('user_email', email)
        .eq('account', account);

      if (fileError) {
        console.error('❌ [UserDataService] Error deleting file:', fileError);
        return false;
      }

      // Note: Subscriptions are derived from transactions, so they will be recalculated
      // when the app reloads data. We don't need to delete them explicitly here.
      // However, we can delete subscriptions that might have been calculated from this account's transactions.
      // For now, we'll let them be recalculated on next load.

      console.log('✅ [UserDataService] File and associated data deleted for account:', account);
      return true;
    }

    // If Supabase not available, just return false
    return false;
  } catch (error) {
    console.error('❌ [UserDataService] Failed to delete file and associated data:', error);
    return false;
  }
}
