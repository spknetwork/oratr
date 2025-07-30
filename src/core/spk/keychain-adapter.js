/**
 * Keychain adapter that bridges spk-desktop's AccountManager with spk-js
 * Implements the custom signer interface expected by spk-js
 */

class SPKKeychainAdapter {
  constructor(accountManager) {
    this.accountManager = accountManager;
  }

  /**
   * Request signature for a message/challenge
   * @param {string} account - Hive username
   * @param {string} challenge - Message to sign
   * @param {string} keyType - Key type (posting, active, etc)
   * @param {Function} callback - Callback with response
   */
  async requestSignature(account, challenge, keyType, callback) {
    try {
      // Ensure we have the correct account active
      const currentAccount = this.accountManager.getActiveAccount();
      if (!currentAccount || currentAccount !== account) {
        const hasAccount = await this.accountManager.hasAccount(account);
        if (!hasAccount) {
          return callback({
            error: 'Account not found'
          });
        }
        await this.accountManager.switchAccount(account);
      }

      // Sign the challenge
      const signResult = await this.accountManager.signMessage(account, challenge, keyType);
      
      // Extract just the signature part (after the last colon)
      // signResult format is "message:signature"
      const lastColonIndex = signResult.lastIndexOf(':');
      const signature = lastColonIndex !== -1 ? signResult.substring(lastColonIndex + 1) : signResult;
      
      // Get public key for the response
      const accountData = await this.accountManager.getAccount(account);
      const publicKey = accountData.publicKeys?.[keyType];

      // Return in the format expected by spk-js KeychainAdapter
      callback({
        success: true,
        signature,
        publicKey
      });
    } catch (error) {
      callback({
        error: error.message
      });
    }
  }

  /**
   * Request transaction broadcast
   * @param {string} account - Hive username
   * @param {Array} operations - Array of operations
   * @param {string} keyType - Key type (posting, active, etc)
   * @param {Function} callback - Callback with response
   */
  async requestBroadcast(account, operations, keyType, callback) {
    try {
      // Ensure correct account
      const currentAccount = this.accountManager.getActiveAccount();
      if (!currentAccount || currentAccount !== account) {
        const hasAccount = await this.accountManager.hasAccount(account);
        if (!hasAccount) {
          return callback({
            error: 'Account not found'
          });
        }
        await this.accountManager.switchAccount(account);
      }

      // Sign and broadcast transaction
      // Pass operations in the format expected by accountManager
      const tx = { operations };
      const result = await this.accountManager.signAndBroadcast(account, tx, keyType);

      callback({
        success: true,
        result: {
          id: result.id || result.transaction_id
        }
      });
    } catch (error) {
      callback({
        error: error.message
      });
    }
  }

  // Note: Synchronous methods are intentionally not implemented
  // The spk-js KeychainAdapter will fall back to async methods

  /**
   * Check if adapter is available (always true for desktop)
   */
  isAvailable() {
    return true;
  }

  /**
   * Get adapter type
   */
  getType() {
    return 'spk-desktop';
  }
}

module.exports = SPKKeychainAdapter;