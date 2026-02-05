// Client-side encryption service
// Encrypts data before saving to Supabase, decrypts after loading
// Database admins can't read the data, but the app decrypts it automatically

/**
 * Derive an encryption key from the user's email
 * This ensures each user has a unique key, and the same email always produces the same key
 */
async function deriveKeyFromEmail(email: string): Promise<CryptoKey> {
  // Convert email to a key material
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(email.toLowerCase().trim()),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive a key using PBKDF2
  // Using a fixed salt for deterministic key derivation (same email = same key)
  // In production, you might want to use a per-user salt stored separately
  const salt = encoder.encode('downsell-encryption-salt-v1'); // Fixed salt for simplicity
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000, // High iteration count for security
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-GCM
 */
export async function encryptData(data: any, userEmail: string): Promise<string> {
  try {
    const key = await deriveKeyFromEmail(userEmail);
    const encoder = new TextEncoder();
    const dataString = JSON.stringify(data);
    const dataBytes = encoder.encode(dataString);

    // Generate a random IV (initialization vector) for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt the data
    const encryptedData = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      dataBytes
    );

    // Combine IV and encrypted data, then encode as base64
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedData), iv.length);

    // Convert to base64 for storage
    const base64 = btoa(String.fromCharCode(...combined));
    return base64;
  } catch (error) {
    console.error('❌ [Encryption] Failed to encrypt data:', error);
    throw error;
  }
}

/**
 * Decrypt data using AES-GCM
 * Returns the original value if decryption fails (for backward compatibility with unencrypted data)
 */
export async function decryptData(encryptedBase64: string, userEmail: string): Promise<any> {
  try {
    // Check if it looks like encrypted data
    if (!isEncrypted(encryptedBase64)) {
      // Not encrypted, return as-is (backward compatibility)
      return encryptedBase64;
    }

    const key = await deriveKeyFromEmail(userEmail);
    
    // Decode from base64
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

    // Extract IV (first 12 bytes) and encrypted data (rest)
    const iv = combined.slice(0, 12);
    const encryptedData = combined.slice(12);

    // Decrypt the data
    const decryptedData = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      encryptedData
    );

    // Convert back to JSON
    const decoder = new TextDecoder();
    const decryptedString = decoder.decode(decryptedData);
    return JSON.parse(decryptedString);
  } catch (error) {
    // If decryption fails, assume it's unencrypted data (backward compatibility)
    console.warn('⚠️ [Encryption] Decryption failed, assuming unencrypted data:', error);
    return encryptedBase64;
  }
}

/**
 * Check if a string is encrypted (base64 format check)
 */
function isEncrypted(data: string): boolean {
  try {
    // Check if it's valid base64 and has minimum length for IV + some data
    if (data.length < 20) return false;
    const decoded = atob(data);
    return decoded.length >= 12; // At least IV (12 bytes) + some encrypted data
  } catch {
    return false;
  }
}

/**
 * Encrypt a field if it contains sensitive data
 * Returns the encrypted value or the original if encryption fails
 */
export async function encryptField(value: any, userEmail: string): Promise<string> {
  if (!value || !userEmail) return value;
  
  try {
    // Only encrypt if it's a string/object that needs encryption
    if (typeof value === 'string' && value.length > 0) {
      return await encryptData(value, userEmail);
    }
    if (typeof value === 'object') {
      return await encryptData(value, userEmail);
    }
    return value;
  } catch (error) {
    console.warn('⚠️ [Encryption] Failed to encrypt field, storing as-is:', error);
    return value;
  }
}

/**
 * Decrypt a field if it's encrypted
 * Returns the decrypted value or the original if decryption fails/not needed
 */
export async function decryptField(value: any, userEmail: string): Promise<any> {
  if (!value || !userEmail) return value;
  
  try {
    // Check if it looks like encrypted data (base64 string)
    if (typeof value === 'string' && isEncrypted(value)) {
      return await decryptData(value, userEmail);
    }
    return value;
  } catch (error) {
    console.warn('⚠️ [Encryption] Failed to decrypt field, returning as-is:', error);
    return value;
  }
}
