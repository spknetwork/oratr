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
   * Broadcast custom JSON operation (required for DirectUpload)
   * @param {string} account - Hive username
   * @param {string} customJsonId - Custom JSON ID (e.g., 'spk-direct-upload')
   * @param {string} keyType - Key type ('Active' or 'Posting')
   * @param {Object} json - JSON data to broadcast
   * @param {string} displayMessage - Message to show user
   */
  async broadcastCustomJson(account, customJsonId, keyType, json, displayMessage) {
    try {
      console.log(`🔑 [KeychainAdapter] Broadcasting custom JSON: ${customJsonId} for ${account}`);
      console.log(`📝 [KeychainAdapter] Message: ${displayMessage}`);
      console.log(`🔐 [KeychainAdapter] Key type: ${keyType}`);
      console.log(`📋 [KeychainAdapter] Data:`, JSON.stringify(json, null, 2));

      // Ensure correct account
      const currentAccount = this.accountManager.getActiveAccount();
      if (!currentAccount || currentAccount !== account) {
        const hasAccount = await this.accountManager.hasAccount(account);
        if (!hasAccount) {
          throw new Error('Account not found');
        }
        await this.accountManager.switchAccount(account);
      }

      // Create custom JSON operation
      const operation = [
        'custom_json',
        {
          required_auths: keyType === 'Active' ? [account] : [],
          required_posting_auths: keyType === 'Posting' ? [account] : [],
          id: customJsonId,
          json: JSON.stringify(json)
        }
      ];

      // Sign and broadcast
      const tx = { operations: [operation] };
      const result = await this.accountManager.signAndBroadcast(
        account, 
        tx, 
        keyType.toLowerCase()
      );

      console.log(`✅ [KeychainAdapter] Custom JSON broadcast successful:`, result.id || result.transaction_id);
      console.log(`📊 [KeychainAdapter] Full result:`, result);

      return {
        success: true,
        id: result.id || result.transaction_id
      };
    } catch (error) {
      console.error(`❌ [KeychainAdapter] Custom JSON broadcast failed:`, error.message);
      console.error(`❌ [KeychainAdapter] Error stack:`, error.stack);
      throw error;
    }
  }

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