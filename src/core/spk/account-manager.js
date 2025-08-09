const crypto = require('crypto');
const { EventEmitter } = require('events');
const Store = require('electron-store');
const hiveTx = require('hive-tx');

/**
 * Account Manager for SPK Desktop
 * Handles secure key storage, encryption, and transaction signing
 * Based on dluxPEN approach but optimized for desktop environment
 */
class AccountManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Initialize secure storage
    // Use a different store name to avoid conflicts with old encrypted data
    try {
      this.store = new Store({
        name: 'spk-accounts-v2',
        clearInvalidConfig: true
      });
    } catch (error) {
      console.error('Error initializing store:', error);
      // If store is corrupted, create a new one
      this.store = new Store({
        name: 'spk-accounts-v2-' + Date.now(),
        clearInvalidConfig: true
      });
    }

    // In-memory decrypted state (cleared on app close)
    this.decrypted = {
      pin: false,
      accounts: {}
    };

    // Session management
    this.sessionPin = null;
    this.sessionTimeout = null;
    this.sessionDuration = config.sessionDuration || 15 * 60 * 1000; // 15 minutes
    // 'inactivity' resets timer on use; 'continuous' counts down regardless
    this.sessionMode = config.sessionMode || 'inactivity';
    this.lastActivityMs = 0;

    // Encryption settings
    this.pbkdf2Iterations = config.pbkdf2Iterations || 100000;
    this.encryptionVersion = '1.0';
  }

  /**
   * Initialize account manager
   */
  async init() {
    // Load any saved settings
    const settings = this.store.get('settings', {});
    if (settings.pbkdf2Iterations) {
      this.pbkdf2Iterations = settings.pbkdf2Iterations;
    }

    this.emit('initialized');
  }

  /**
   * Check if PIN has been set up (without unlocking)
   */
  hasPinSetup() {
    const encrypted = this.store.get('encryptedAccounts');
    return !!encrypted;
  }

  /**
   * Set up a new PIN for encryption
   */
  async setupPin(pin) {
    if (!pin || pin.length < 4) {
      throw new Error('PIN must be at least 4 characters');
    }

    // Generate salt and encrypt empty accounts object
    const salt = this.generateSalt();
    const encrypted = await this.encrypt({}, pin, salt);

    // Save encrypted data
    this.store.set('encryptedAccounts', encrypted);
    
    // Set up session
    this.decrypted.pin = true;
    this.decrypted.accounts = {};
    this.sessionPin = pin;
    this.startSessionTimer();

    this.emit('pin-setup');
    return true;
  }

  /**
   * Unlock accounts with PIN
   */
  async unlock(pin) {
    const encrypted = this.store.get('encryptedAccounts');
    if (!encrypted) {
      throw new Error('No accounts found. Please set up PIN first.');
    }

    try {
      const decrypted = await this.decrypt(encrypted, pin);
      
      // Verify decryption worked
      if (typeof decrypted !== 'object' || decrypted === null) {
        throw new Error('Invalid PIN');
      }

      // Set up session
      this.decrypted.pin = true;
      this.decrypted.accounts = decrypted;
      this.sessionPin = pin;
      this.startSessionTimer();

      this.emit('unlocked', Object.keys(decrypted));
      return true;
    } catch (error) {
      throw new Error('Invalid PIN');
    }
  }

  /**
   * Check if accounts are unlocked
   */
  isUnlocked() {
    return !!this.sessionPin;
  }

  /**
   * Lock accounts (clear session)
   */
  lock() {
    this.decrypted = {
      pin: false,
      accounts: {}
    };
    this.sessionPin = null;
    this.clearSessionTimer();
    this.emit('locked');
  }

  /**
   * Add or update an account
   */
  async addAccount(username, keys = {}) {
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }

    // Validate keys
    const validKeys = ['posting', 'active', 'memo', 'owner'];
    const accountKeys = {};
    
    for (const [keyType, wif] of Object.entries(keys)) {
      if (validKeys.includes(keyType)) {
        // Validate WIF format
        try {
          const privateKey = hiveTx.PrivateKey.from(wif);
          const pubKey = privateKey.createPublic().toString();
          accountKeys[keyType] = wif;
        } catch (error) {
          throw new Error(`Invalid ${keyType} key`);
        }
      }
    }

    // Check if account exists
    const existingAccount = this.decrypted.accounts[username];
    
    if (existingAccount) {
      // Update existing account - merge keys
      this.decrypted.accounts[username] = {
        ...existingAccount,
        ...accountKeys,
        publicKeys: existingAccount.publicKeys || {},
        noPrompt: existingAccount.noPrompt || {},
        updatedAt: Date.now()
      };
    } else {
      // Create new account
      this.decrypted.accounts[username] = {
        ...accountKeys,
        publicKeys: {},
        noPrompt: {},
        addedAt: Date.now()
      };
    }

    // Generate public keys for new keys
    for (const [keyType, wif] of Object.entries(accountKeys)) {
      const privateKey = hiveTx.PrivateKey.from(wif);
      this.decrypted.accounts[username].publicKeys[keyType] = privateKey.createPublic().toString();
    }

    // Save encrypted
    await this.saveAccounts();

    this.emit(existingAccount ? 'account-updated' : 'account-added', username);
    return this.decrypted.accounts[username];
  }

  /**
   * Delete a specific key from an account
   */
  async deleteKey(username, keyType) {
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }
    const validKeys = ['posting', 'active', 'memo', 'owner'];
    if (!validKeys.includes(keyType)) {
      throw new Error('Invalid key type');
    }
    const account = this.decrypted.accounts[username];
    if (!account) throw new Error('Account not found');
    if (!account[keyType]) throw new Error(`${keyType} key not present`);
    delete account[keyType];
    if (account.publicKeys) delete account.publicKeys[keyType];
    await this.saveAccounts();
    this.emit('account-updated', username);
    return true;
  }

  /**
   * Export posting key to settings for automation use
   */
  async exportPostingForAutomation(username, settingsManager) {
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }
    const account = this.decrypted.accounts[username];
    if (!account || !account.posting) {
      throw new Error('Posting key not found');
    }
    if (!settingsManager) {
      throw new Error('Settings manager not available');
    }
    const automation = {
      enabled: true,
      username,
      postingKey: account.posting,
      createdAt: Date.now()
    };
    await settingsManager.updateSettings({ automation });
    return true;
  }

  /**
   * Remove an account
   */
  async removeAccount(username) {
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }

    if (!this.decrypted.accounts[username]) {
      throw new Error('Account not found');
    }

    delete this.decrypted.accounts[username];
    await this.saveAccounts();

    this.emit('account-removed', username);
    return true;
  }

  /**
   * Get account info (public data only)
   */
  getAccount(username) {
    if (!this.decrypted.pin) {
      return null;
    }

    const account = this.decrypted.accounts[username];
    if (!account) {
      return null;
    }

    // Return only public information
    return {
      username,
      publicKeys: account.publicKeys,
      hasPosting: !!account.posting,
      hasActive: !!account.active,
      hasMemo: !!account.memo,
      hasOwner: !!account.owner,
      addedAt: account.addedAt
    };
  }

  /**
   * List all accounts (public data only)
   */
  listAccounts() {
    if (!this.decrypted.pin) {
      return [];
    }

    return Object.keys(this.decrypted.accounts).map(username => 
      this.getAccount(username)
    );
  }

  /**
   * Set active account
   */
  setActiveAccount(username) {
    this.store.set('activeAccount', username);
  }

  /**
   * Get active account
   */
  getActiveAccount() {
    return this.store.get('activeAccount', null);
  }

  /**
   * Get private key for an account (internal use only)
   */
  async getPrivateKey(username, keyType = 'posting') {
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }

    const account = this.decrypted.accounts[username];
    if (!account) {
      throw new Error('Account not found');
    }

    // Normalize keyType to lowercase for consistency
    const normalizedKeyType = keyType.toLowerCase();

    // Check key hierarchy: try requested key, then higher authority keys
    const keyHierarchy = {
      posting: ['posting', 'active', 'owner'],
      active: ['active', 'owner'],
      owner: ['owner']
    };

    let privateKey = null;
    const tryKeys = keyHierarchy[normalizedKeyType] || [normalizedKeyType];

    for (const key of tryKeys) {
      if (account[key]) {
        privateKey = account[key];
        break;
      }
    }

    if (!privateKey) {
      throw new Error(`No ${normalizedKeyType} key available for ${username}`);
    }

    this.resetSessionTimer();
    return privateKey;
  }

  /**
   * Sign a transaction
   */
  async signTransaction(username, tx, keyType = 'posting') {
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }

    const account = this.decrypted.accounts[username];
    if (!account) {
      throw new Error('Account not found');
    }

    // Check key hierarchy: try requested key, then higher authority keys
    const keyHierarchy = {
      posting: ['posting', 'active', 'owner'],
      active: ['active', 'owner'],
      owner: ['owner']
    };

    let privateKey = null;
    const tryKeys = keyHierarchy[keyType] || [keyType];

    for (const key of tryKeys) {
      if (account[key]) {
        privateKey = account[key];
        break;
      }
    }

    if (!privateKey) {
      throw new Error(`No ${keyType} key available for ${username}`);
    }

    // Sign transaction
    const signedTx = hiveTx.auth.signTransaction(tx, [privateKey]);
    
    this.resetSessionTimer();
    this.emit('transaction-signed', { username, keyType });
    
    return signedTx;
  }

  /**
   * Sign a transaction and broadcast it
   * @returns {Object} The broadcast result with transaction ID
   */
  async signAndBroadcast(username, tx, keyType = 'posting') {
    // Check if we're in the main process (Electron)
    if (typeof window === 'undefined' && typeof require !== 'undefined') {
      try {
        const { BrowserWindow, ipcMain } = require('electron');
        const mainWindow = BrowserWindow.getAllWindows()[0];
        
        if (mainWindow) {
          // Send request to renderer process to show signing modal
          return new Promise((resolve, reject) => {
            // Generate unique request ID
            const requestId = `sign-${Date.now()}-${Math.random()}`;
            
            // Set up one-time listener for response
            ipcMain.once(`signing-response-${requestId}`, (event, approved) => {
              if (approved) {
                // User approved, continue with signing
                this._performSignAndBroadcast(username, tx, keyType)
                  .then(resolve)
                  .catch(reject);
              } else {
                reject(new Error('Transaction rejected by user'));
              }
            });
            
            // Send request to renderer
            mainWindow.webContents.send('show-signing-modal', {
              requestId,
              transaction: tx,
              keyType,
              username
            });
          });
        }
      } catch (error) {
        console.error('Failed to request signature from renderer:', error);
      }
    }
    
    // In renderer process, request user approval
    if (typeof window !== 'undefined' && window.signingModal) {
      try {
        await window.signingModal.requestSignature(tx, keyType, username);
      } catch (error) {
        throw new Error('Transaction rejected by user');
      }
    }
    
    // If no UI available, proceed with signing
    return this._performSignAndBroadcast(username, tx, keyType);
  }

  /**
   * Internal method to perform actual signing and broadcasting
   */
  async _performSignAndBroadcast(username, tx, keyType = 'posting') {
    // Get the private key
    const privateKey = await this.getPrivateKey(username, keyType);
    
    // Use hive-tx for signing and broadcasting
    const hiveTx = require('hive-tx');
    
    // Create a new transaction object
    const txObj = new hiveTx.Transaction();
    
    // Set the transaction properties if not already a Transaction instance
    if (tx.operations) {
      // It's a plain transaction object
      await txObj.create(tx.operations);
    } else {
      // It might already be a Transaction instance
      txObj.transaction = tx;
    }
    
    // Sign with the private key
    const key = hiveTx.PrivateKey.from(privateKey);
    txObj.sign(key);
    
    // Now broadcast
    const broadcastResult = await txObj.broadcast();
    
    this.emit('transaction-broadcast', { username, result: broadcastResult });
    
    return broadcastResult;
  }

  /**
   * Sign a message (for authentication)
   */
  async signMessage(username, message, keyType = 'posting') {
    console.log('AccountManager.signMessage called:', { username, message, keyType });
    
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }

    const account = this.decrypted.accounts[username];
    if (!account) {
      throw new Error('Account not found');
    }

    // Normalize key type to lowercase
    const normalizedKeyType = keyType.toLowerCase();
    console.log('Available keys for account:', Object.keys(account).filter(k => k !== 'publicKeys'));
    
    const privateKeyStr = account[normalizedKeyType];
    if (!privateKeyStr) {
      throw new Error(`No ${normalizedKeyType} key available for ${username}`);
    }

    console.log('Checking environment - window:', typeof window, 'require:', typeof require);
    
    // Check if we're in the main process (Electron)
    if (typeof window === 'undefined' && typeof require !== 'undefined') {
      console.log('In main process, attempting to show signing modal...');
      try {
        const { BrowserWindow, ipcMain } = require('electron');
        const mainWindow = BrowserWindow.getAllWindows()[0];
        
        console.log('Main window found:', !!mainWindow);
        
        if (mainWindow) {
          // Send request to renderer process to show signing modal
          return new Promise((resolve, reject) => {
            // Generate unique request ID
            const requestId = `sign-message-${Date.now()}-${Math.random()}`;
            
            // Set up one-time listener for response
            const responseHandler = (approved) => {
              if (approved) {
                // User approved, continue with signing
                this._performMessageSigning(username, message, keyType, privateKeyStr)
                  .then(resolve)
                  .catch(reject);
              } else {
                reject(new Error('Signature rejected by user'));
              }
            };
            
            // Store the handler so it can be called from the IPC handler
            global.signingHandlers = global.signingHandlers || {};
            global.signingHandlers[requestId] = responseHandler;
            
            // Send request to renderer with message details
            mainWindow.webContents.send('show-message-signing-modal', {
              requestId,
              message,
              keyType,
              username,
              purpose: 'SPK Network File Upload Authorization'
            });
          });
        }
      } catch (error) {
        console.error('Failed to request signature from renderer:', error);
      }
    }
    
    // If no UI available or in renderer process, proceed with signing
    return this._performMessageSigning(username, message, keyType, privateKeyStr);
  }

  /**
   * Internal method to perform actual message signing
   */
  async _performMessageSigning(username, message, keyType, privateKeyStr) {
    // Sign using hive-tx
    // Based on the dlux v3-nav.js implementation
    
    try {
      // Create private key object from string
      const privateKey = hiveTx.PrivateKey.from(privateKeyStr);
      
      // Create hash of the message
      const messageHash = crypto.createHash('sha256').update(message, 'utf8').digest();
      
      // Sign the hash
      const signature = privateKey.sign(messageHash);
      const publicKey = privateKey.createPublic();
      
      // Convert signature to hex format with recovery byte - match HKC format
      const recoveryByte = signature.recovery + (signature.compressed ? 4 : 0) + 27;
      const recoveryByteHex = recoveryByte.toString(16).padStart(2, '0');
      
      // Convert signature data to hex
      let signatureDataHex;
      if (signature.data instanceof Uint8Array) {
        signatureDataHex = this.uint8ArrayToHex(signature.data);
      } else {
        signatureDataHex = signature.data.toString('hex');
      }
      
      const signatureString = recoveryByteHex + signatureDataHex;
      
      this.resetSessionTimer();
      this.emit('message-signed', { username, keyType });
      
      return `${message}:${signatureString}`;
      
    } catch (error) {
      console.error('Signing error:', error);
      throw new Error(`Failed to sign message: ${error.message}`);
    }
  }

  /**
   * Convert Uint8Array to hex string
   */
  uint8ArrayToHex(uint8Array) {
    return Array.from(uint8Array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Encrypt memo
   */
  async encryptMemo(username, memo, recipientPubKey) {
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }

    const account = this.decrypted.accounts[username];
    if (!account || !account.memo) {
      throw new Error('Memo key not found');
    }

    const encrypted = hiveTx.memo.encode(account.memo, recipientPubKey, memo);
    this.resetSessionTimer();
    
    return encrypted;
  }

  /**
   * Decrypt memo
   */
  async decryptMemo(username, encryptedMemo) {
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }

    const account = this.decrypted.accounts[username];
    if (!account || !account.memo) {
      throw new Error('Memo key not found');
    }

    const decrypted = hiveTx.memo.decode(account.memo, encryptedMemo);
    this.resetSessionTimer();
    
    return decrypted;
  }

  // Private helper methods

  /**
   * Save accounts to encrypted storage
   */
  async saveAccounts() {
    const salt = this.generateSalt();
    const encrypted = await this.encrypt(this.decrypted.accounts, this.sessionPin, salt);
    this.store.set('encryptedAccounts', encrypted);
  }

  /**
   * Generate cryptographically secure salt
   */
  generateSalt() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Encrypt data with PBKDF2 + AES
   */
  async encrypt(data, pin, salt) {
    const key = await this.deriveKey(pin, salt);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    const jsonStr = JSON.stringify(data);
    let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return versioned format
    return JSON.stringify({
      version: this.encryptionVersion,
      salt,
      iv: iv.toString('hex'),
      data: encrypted,
      iterations: this.pbkdf2Iterations
    });
  }

  /**
   * Decrypt data
   */
  async decrypt(encryptedStr, pin) {
    const encrypted = JSON.parse(encryptedStr);
    
    // Handle version differences if needed
    const salt = encrypted.salt;
    const iterations = encrypted.iterations || this.pbkdf2Iterations;
    
    const key = await this.deriveKey(pin, salt, iterations);
    const iv = Buffer.from(encrypted.iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  /**
   * Derive key using PBKDF2
   */
  async deriveKey(pin, salt, iterations = null) {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(pin, salt, iterations || this.pbkdf2Iterations, 32, 'sha256', (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
  }

  /**
   * Session timer management
   */
  startSessionTimer() {
    this.clearSessionTimer();
    this.sessionTimeout = setTimeout(() => {
      this.lock();
      this.emit('session-expired');
    }, this.sessionDuration);
  }

  clearSessionTimer() {
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
  }

  resetSessionTimer() {
    if (this.sessionPin && this.sessionMode === 'inactivity') {
      this.startSessionTimer();
    }
  }

  /**
   * Update last activity timestamp and optionally reset timer
   */
  updateLastActivity() {
    this.lastActivityMs = Date.now();
    if (this.sessionMode === 'inactivity') {
      this.resetSessionTimer();
    }
  }

  getLastActivity() {
    return this.lastActivityMs;
  }

  /**
   * Export account (encrypted)
   */
  async exportAccount(username, exportPin) {
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }

    const account = this.decrypted.accounts[username];
    if (!account) {
      throw new Error('Account not found');
    }

    // Create export data with just this account
    const exportData = {
      [username]: account
    };

    // Encrypt with export PIN
    const salt = this.generateSalt();
    const encrypted = await this.encrypt(exportData, exportPin, salt);

    return {
      type: 'spk-account-export',
      version: this.encryptionVersion,
      encrypted
    };
  }

  /**
   * Import account
   */
  async importAccount(exportData, importPin) {
    if (!this.sessionPin) {
      throw new Error('Accounts locked. Please unlock first.');
    }

    if (exportData.type !== 'spk-account-export') {
      throw new Error('Invalid export data');
    }

    try {
      const decrypted = await this.decrypt(exportData.encrypted, importPin);
      
      // Add imported accounts
      for (const [username, account] of Object.entries(decrypted)) {
        this.decrypted.accounts[username] = {
          ...account,
          importedAt: Date.now()
        };
      }

      await this.saveAccounts();
      
      const usernames = Object.keys(decrypted);
      this.emit('accounts-imported', usernames);
      
      return usernames;
    } catch (error) {
      throw new Error('Invalid import PIN or corrupted data');
    }
  }

  /**
   * Delete all accounts and reset the wallet
   */
  async deleteAllAccounts() {
    // Clear all data
    this.store.delete('encryptedAccounts');
    this.store.delete('activeAccount');
    this.store.delete('salt');
    
    // Clear session data
    this.decrypted = null;
    this.sessionPin = null;
    this.isUnlocked = false;
    
    // Clear session timer
    this.clearSessionTimer();
    
    // Emit event
    this.emit('accounts-reset');
    
    return true;
  }
}

module.exports = AccountManager;