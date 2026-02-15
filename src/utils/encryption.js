const crypto = require('crypto');

/**
 * Encryption Service for sensitive data (API keys, tokens, etc.)
 * Uses AES-256-GCM authenticated encryption with per-user key derivation
 */
class EncryptionService {
  constructor() {
    // Master key from environment (32 bytes = 256 bits)
    const masterKeyHex = process.env.ENCRYPTION_MASTER_KEY;
    
    if (!masterKeyHex) {
      throw new Error('ENCRYPTION_MASTER_KEY environment variable is required');
    }
    
    this.masterKey = Buffer.from(masterKeyHex, 'hex');
    
    if (this.masterKey.length !== 32) {
      throw new Error('ENCRYPTION_MASTER_KEY must be 64 hex characters (32 bytes)');
    }
    
    this.algorithm = 'aes-256-gcm';
    this.keyIterations = 100000; // PBKDF2 iterations
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   * @param {string} plaintext - Data to encrypt
   * @param {string} userId - User ID for key derivation (provides per-user encryption)
   * @returns {string} - Base64 encoded: iv:authTag:encrypted
   */
  encrypt(plaintext, userId) {
    if (!plaintext) {
      throw new Error('Plaintext is required for encryption');
    }
    
    if (!userId) {
      throw new Error('User ID is required for encryption');
    }

    // Derive user-specific key using PBKDF2
    const salt = Buffer.from(userId.toString(), 'utf8');
    const key = crypto.pbkdf2Sync(
      this.masterKey,
      salt,
      this.keyIterations,
      32,
      'sha256'
    );

    // Generate random IV (Initialization Vector)
    const iv = crypto.randomBytes(16);

    // Create cipher
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    // Encrypt
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // Get auth tag for integrity verification
    const authTag = cipher.getAuthTag().toString('base64');

    // Return format: iv:authTag:encrypted
    return `${iv.toString('base64')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypt sensitive data
   * @param {string} encryptedData - Format: iv:authTag:encrypted
   * @param {string} userId - User ID for key derivation
   * @returns {string} - Decrypted plaintext
   */
  decrypt(encryptedData, userId) {
    if (!encryptedData) {
      throw new Error('Encrypted data is required for decryption');
    }
    
    if (!userId) {
      throw new Error('User ID is required for decryption');
    }

    // Parse encrypted data
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format. Expected: iv:authTag:encrypted');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = parts[2];

    // Derive user-specific key (same process as encryption)
    const salt = Buffer.from(userId.toString(), 'utf8');
    const key = crypto.pbkdf2Sync(
      this.masterKey,
      salt,
      this.keyIterations,
      32,
      'sha256'
    );

    // Create decipher
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Generate a random encryption master key (for initial setup)
   * @returns {string} - 64 character hex string (32 bytes)
   */
  static generateMasterKey() {
    return crypto.randomBytes(32).toString('hex');
  }
}

// Export singleton instance
module.exports = new EncryptionService();
module.exports.EncryptionService = EncryptionService;
