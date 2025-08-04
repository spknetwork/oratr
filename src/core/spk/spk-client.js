const { EventEmitter } = require('events');
const AccountManager = require('./account-manager');

// Import from the installed spk-js package
const SPK = require('@disregardfiat/spk-js');

/**
 * SPK Client for Desktop
 * Integrates account management with SPK network operations
 */
class SPKClient extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      spkNode: config.spkNode || 'https://spkinstant.hivehoneycomb.com',
      ...config
    };

    // Initialize account manager
    this.accountManager = new AccountManager({
      sessionDuration: config.sessionDuration,
      pbkdf2Iterations: config.pbkdf2Iterations
    });

    // Current active account
    this.activeAccount = null;
    this.spkInstance = null;

    // Forward account manager events
    this.accountManager.on('unlocked', (accounts) => {
      this.emit('accounts-unlocked', accounts);
    });

    this.accountManager.on('locked', () => {
      this.activeAccount = null;
      this.spkInstance = null;
      this.emit('accounts-locked');
    });

    this.accountManager.on('session-expired', () => {
      this.emit('session-expired');
    });
  }

  /**
   * Initialize SPK client
   */
  async init() {
    await this.accountManager.init();
    this.emit('initialized');
  }

  /**
   * Set up PIN for new installation
   */
  async setupPin(pin) {
    return await this.accountManager.setupPin(pin);
  }

  /**
   * Unlock accounts with PIN
   */
  async unlock(pin) {
    return await this.accountManager.unlock(pin);
  }

  /**
   * Lock accounts
   */
  lock() {
    this.accountManager.lock();
  }

  /**
   * Add account with keys
   */
  async addAccount(username, keys) {
    const account = await this.accountManager.addAccount(username, keys);
    
    // If no active account, set this as active
    if (!this.activeAccount) {
      await this.setActiveAccount(username);
    }
    
    return account;
  }

  /**
   * Import account from master password or keys
   */
  async importAccountFromMaster(username, masterPassword) {
    // Generate keys from master password using @hiveio/hive-js
    const hive = require('@hiveio/hive-js');
    const keys = {};
    const roles = ['posting', 'active', 'memo', 'owner'];
    
    for (const role of roles) {
      try {
        const privateKey = hive.auth.toWif(username, masterPassword, role);
        keys[role] = privateKey;
      } catch (error) {
        // Some roles might not be derivable
        console.warn(`Could not derive ${role} key:`, error.message);
      }
    }

    if (Object.keys(keys).length === 0) {
      throw new Error('Could not derive any keys from master password');
    }

    return await this.addAccount(username, keys);
  }

  /**
   * Remove account
   */
  async removeAccount(username) {
    const result = await this.accountManager.removeAccount(username);
    
    // If this was the active account, clear it
    if (this.activeAccount === username) {
      this.activeAccount = null;
      this.spkInstance = null;
      
      // Try to set another account as active
      const accounts = this.accountManager.listAccounts();
      if (accounts.length > 0) {
        await this.setActiveAccount(accounts[0].username);
      }
    }
    
    return result;
  }

  /**
   * Set active account for operations
   */
  async setActiveAccount(username) {
    const account = this.accountManager.getAccount(username);
    if (!account) {
      throw new Error('Account not found');
    }

    this.activeAccount = username;
    
    // Initialize SPK instance for this account
    this.spkInstance = new SPK(username, {
      node: this.config.spkNode
    });
    
    // Initialize the SPK instance
    try {
      await this.spkInstance.init();
    } catch (error) {
      console.warn('Failed to initialize SPK instance:', error);
      // Continue anyway - some operations might still work
    }
    
    // For direct upload, we'll need to create a custom implementation
    // that works with our existing account system
    this.setupDirectUpload();
    
    this.emit('active-account-changed', username);
    return account;
  }

  /**
   * Get active account info
   */
  getActiveAccount() {
    if (!this.activeAccount) {
      return null;
    }
    return this.accountManager.getAccount(this.activeAccount);
  }

  /**
   * List all accounts
   */
  listAccounts() {
    return this.accountManager.listAccounts();
  }

  /**
   * Get balances for active account
   */
  async getBalances(refresh = false) {
    if (!this.spkInstance || !this.activeAccount) {
      throw new Error('No active account');
    }

    try {
      // Use spk-js account to get proper balances
      const balances = await this.spkInstance.getBalances(refresh);
      
      // Calculate BROCA available
      const { BrocaCalculator } = require('@disregardfiat/spk-js');
      const brocaAvailable = BrocaCalculator.available(this.spkInstance.account);
      
      // Add BROCA info to balances
      balances.BROCA = {
        balance: balances.broca || 0,
        allocated: 0, // Not tracked separately in new spk-js
        available: brocaAvailable,
        regeneration: BrocaCalculator.REGEN_RATE
      };
      
      return balances;
    } catch (error) {
      console.error('Error getting balances:', error);
      // Throw the error so the UI can show a proper message
      throw error;
    }
  }

  /**
   * Upload file with automatic signing
   */
  async uploadFile(file, options = {}) {
    if (!this.spkInstance) {
      throw new Error('No active account');
    }

    // Calculate storage cost using the new API
    const costResult = await this.spkInstance.calculateStorageCost(
      file.size,
      options.days || 30
    );

    // Check current BROCA balance
    const balances = await this.getBalances();
    if (balances.BROCA.available < costResult.broca) {
      throw new Error(`Insufficient BROCA. Need ${costResult.broca}, have ${balances.BROCA.available}`);
    }

    // Create custom signer that uses our account manager
    const signer = async (tx) => {
      return await this.accountManager.signTransaction(
        this.activeAccount,
        tx,
        'posting'
      );
    };

    // Create storage contract with signer
    const contractOptions = {
      ...options,
      size: file.size,
      cid: options.cid, // Will be calculated if not provided
      signer
    };

    const result = await this.spkInstance.createContract(contractOptions);
    
    this.emit('file-uploaded', {
      cid: result.cid,
      size: file.size,
      cost: costResult.broca
    });
    
    return result;
  }

  /**
   * Create storage contract
   */
  async createContract(fileData, options = {}) {
    if (!this.spkInstance) {
      throw new Error('No active account');
    }

    const signer = async (tx) => {
      return await this.accountManager.signTransaction(
        this.activeAccount,
        tx,
        'posting'
      );
    };

    const contract = await this.spkInstance.createStorageContract({
      ...fileData,
      ...options,
      signer
    });

    this.emit('contract-created', contract);
    return contract;
  }

  /**
   * Sign arbitrary transaction
   */
  async signTransaction(tx, keyType = 'posting') {
    if (!this.activeAccount) {
      throw new Error('No active account');
    }

    return await this.accountManager.signTransaction(
      this.activeAccount,
      tx,
      keyType
    );
  }

  /**
   * Sign message for authentication
   */
  async signMessage(message, keyType = 'posting') {
    if (!this.activeAccount) {
      throw new Error('No active account');
    }

    return await this.accountManager.signMessage(
      this.activeAccount,
      message,
      keyType
    );
  }

  /**
   * Transfer tokens
   * @param {string} to - Recipient account
   * @param {number} amount - Amount to transfer
   * @param {string} token - Token type
   * @param {string} memo - Transfer memo
   * @param {Object} options - Transfer options including signing method
   */
  async transfer(to, amount, token, memo = '', options = {}) {
    if (!this.spkInstance) {
      throw new Error('No active account');
    }

    const signer = this.createFlexibleSigner('active', options);
    const result = await this.spkInstance.transfer(to, amount, token, memo, { signer });

    // If manual signing was requested, return the transaction data
    if (options.method === 'manual' && result.method === 'manual') {
      return result;
    }

    this.emit('transfer-sent', {
      to,
      amount,
      token,
      memo
    });

    return result;
  }

  /**
   * Power up/down operations
   */
  async powerUp(amount, options = {}) {
    if (!this.spkInstance) {
      throw new Error('No active account');
    }

    const signer = this.createFlexibleSigner('active', options);
    const result = await this.spkInstance.stake(amount, 'LARYNX', { signer });
    
    if (options.method === 'manual' && result.method === 'manual') {
      return result;
    }
    
    this.emit('power-up', { amount });
    return result;
  }

  async powerDown(amount, options = {}) {
    if (!this.spkInstance) {
      throw new Error('No active account');
    }

    const signer = this.createFlexibleSigner('active', options);
    // Note: The JS SPK class might not have a direct powerDown method
    // This might need to be implemented differently based on the SPK network API
    const result = await this.spkInstance.account.unstake(amount, 'LARYNX', { signer });
    
    if (options.method === 'manual' && result.method === 'manual') {
      return result;
    }
    
    this.emit('power-down', { amount });
    return result;
  }

  /**
   * List files for active account
   */
  async listFiles(filters = {}) {
    if (!this.spkInstance) {
      throw new Error('No active account');
    }

    return await this.spkInstance.listFiles(filters);
  }

  /**
   * List contracts for active account
   */
  async listContracts() {
    if (!this.spkInstance) {
      throw new Error('No active account');
    }

    return await this.spkInstance.listContracts();
  }

  /**
   * Renew contract
   */
  async renewContract(contractId, options = {}) {
    if (!this.spkInstance) {
      throw new Error('No active account');
    }

    const signer = async (tx) => {
      return await this.accountManager.signTransaction(
        this.activeAccount,
        tx,
        'posting'
      );
    };

    const result = await this.spkInstance.renewContract(contractId, options);

    this.emit('contract-renewed', { contractId });
    return result;
  }

  /**
   * Export account (encrypted)
   */
  async exportAccount(username, exportPin) {
    return await this.accountManager.exportAccount(username, exportPin);
  }

  /**
   * Import account from export
   */
  async importAccount(exportData, importPin) {
    const usernames = await this.accountManager.importAccount(exportData, importPin);
    
    // If no active account, set first imported as active
    if (!this.activeAccount && usernames.length > 0) {
      await this.setActiveAccount(usernames[0]);
    }
    
    return usernames;
  }

  /**
   * Encrypt memo
   */
  async encryptMemo(memo, recipientPubKey) {
    if (!this.activeAccount) {
      throw new Error('No active account');
    }

    return await this.accountManager.encryptMemo(
      this.activeAccount,
      memo,
      recipientPubKey
    );
  }

  /**
   * Decrypt memo
   */
  async decryptMemo(encryptedMemo) {
    if (!this.activeAccount) {
      throw new Error('No active account');
    }

    return await this.accountManager.decryptMemo(
      this.activeAccount,
      encryptedMemo
    );
  }

  /**
   * Get BROCA calculator utility
   */
  get broca() {
    if (!this.spkInstance) {
      // Return a static calculator that doesn't need an instance
      const { BrocaCalculator } = require('@disregardfiat/spk-js');
      return BrocaCalculator;
    }
    return this.spkInstance.broca;
  }

  /**
   * Check user services registration (delegates to spk-js)
   */
  async checkUserServices(username) {
    if (!this.spkInstance) {
      throw new Error('No active account');
    }
    return await this.spkInstance.account.checkUserServices(username);
  }

  /**
   * Check if storage node is registered (delegates to spk-js)
   */
  async checkStorageRegistration(username, ipfsId) {
    if (!this.spkInstance) {
      throw new Error('No active account');
    }
    return await this.spkInstance.account.checkStorageRegistration(username, ipfsId);
  }

  /**
   * Register storage node on SPK Network
   * @param {string} ipfsId - IPFS peer ID
   * @param {string} domain - Domain for the storage node
   * @param {number} price - Price in IPFSRate
   * @param {Object} options - Options including signing method
   */
  async registerStorageNode(ipfsId, domain, price = 2000, options = {}) {
    if (!this.activeAccount) {
      throw new Error('No active account');
    }
    
    // Prepare service data
    const serviceData = {
      amount: price,
      type: 'IPFS',
      id: ipfsId
    };
    
    // Only add api field if domain is provided (gateway nodes)
    // P2P-only nodes don't need a public API endpoint
    if (domain && domain.trim()) {
      serviceData.api = `https://ipfs.${domain}`;
    }
    
    const operations = [[
      'custom_json',
      {
        required_auths: [this.activeAccount],
        required_posting_auths: [],
        id: "spkccT_register_service",
        json: JSON.stringify(serviceData)
      }
    ]];

    // If manual signing requested, prepare and return transaction data
    if (options.method === 'manual') {
      return await this.prepareTransactionForSigning(operations, 'active');
    }

    try {
      // Use flexible signer
      const signer = this.createFlexibleSigner('active', options);
      
      // Build transaction
      const hiveTx = require('hive-tx');
      
      // Get dynamic global properties using fetch
      const propsResponse = await fetch('https://api.hive.blog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'condenser_api.get_dynamic_global_properties',
          params: [],
          id: 1
        })
      });
      const propsData = await propsResponse.json();
      const props = propsData.result;
      
      const tx = {
        ref_block_num: props.head_block_number & 0xFFFF,
        ref_block_prefix: Buffer.from(props.head_block_id, 'hex').readUInt32LE(4),
        expiration: new Date(Date.now() + 600000).toISOString().slice(0, -5),
        operations: operations,
        extensions: []
      };
      
      const result = await signer(tx);
      
      // If manual signing was requested, return the unsigned transaction
      if (result && result.method === 'manual') {
        return result;
      }
      
      // Broadcast if we have a signed transaction
      const broadcastResult = await client.broadcast.send(result);
      
      this.emit('storage-registered', { ipfsId, domain });
      return { success: true, transaction: broadcastResult };
    } catch (error) {
      console.error('Failed to register storage node:', error);
      throw error;
    }
  }

  /**
   * Register as validator
   */
  async registerValidator(amount) {
    if (!this.activeAccount) {
      throw new Error('No active account');
    }
    
    const customJson = {
      required_auths: [this.activeAccount],
      required_posting_auths: [],
      id: "spkccT_validator_burn",
      json: JSON.stringify({ amount })
    };

    try {
      const tx = await this.accountManager.signTransaction(
        this.activeAccount,
        customJson,
        'active'
      );
      
      this.emit('validator-registered', { amount });
      return { success: true, transaction: tx };
    } catch (error) {
      console.error('Failed to register validator:', error);
      throw error;
    }
  }

  /**
   * Register SPK authority (first time setup)
   */
  async registerAuthority(publicKey) {
    if (!this.activeAccount) {
      throw new Error('No active account');
    }
    
    const customJson = {
      required_auths: [this.activeAccount],
      required_posting_auths: [],
      id: "spkccT_register_authority",
      json: JSON.stringify({ pubKey: publicKey })
    };

    try {
      const tx = await this.accountManager.signTransaction(
        this.activeAccount,
        customJson,
        'active'
      );
      
      this.emit('authority-registered', { publicKey });
      return { success: true, transaction: tx };
    } catch (error) {
      console.error('Failed to register authority:', error);
      throw error;
    }
  }

  /**
   * Get SPK network stats
   */
  async getNetworkStats() {
    try {
      const response = await fetch(`${this.config.spkNode}/`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to get network stats:', error);
      throw error;
    }
  }

  /**
   * Get available IPFS storage providers
   */
  async getStorageProviders() {
    try {
      const response = await fetch(`${this.config.spkNode}/services/IPFS`);
      const data = await response.json();
      
      // Transform the data into a more usable format
      const providers = {};
      const services = [];
      
      // Process provider list
      if (data.providers) {
        for (const [node, idString] of Object.entries(data.providers)) {
          providers[node] = idString.split(',');
        }
      }
      
      // Process services with stats
      if (data.services) {
        for (const serviceGroup of data.services) {
          for (const [id, service] of Object.entries(serviceGroup)) {
            services.push({
              id,
              api: service.a,
              account: service.b,
              price: service.c,
              ...service
            });
          }
        }
      }
      
      return { providers, services, raw: data };
    } catch (error) {
      console.error('Failed to get storage providers:', error);
      throw error;
    }
  }

  // Provider selection is now handled internally by spk-js

  /**
   * Get storage provider stats
   * @param {string} providerUrl - Provider API URL
   */
  async getProviderStats(providerUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${providerUrl}/upload-stats`, { 
        signal: controller.signal 
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Provider stats request timed out');
      }
      throw error;
    }
  }

  /**
   * Calculate BROCA cost for storage using live network stats
   * @param {number} sizeInBytes - Size of data in bytes
   * @param {Object} options - Optional parameters
   * @param {boolean} options.includeContractMin - Include minimum contract cost (default: false)
   * @param {Object} options.stats - Pre-fetched network stats (optional)
   * @returns {Promise<Object>} BROCA cost details
   */
  async calculateBrocaCost(sizeInBytes, options = {}) {
    try {
      // Use provided stats or fetch fresh ones
      const stats = options.stats || await this.getNetworkStats();
      
      if (!stats || !stats.result) {
        throw new Error('Invalid network stats');
      }
      
      const { channel_bytes, channel_min } = stats.result;
      
      // Calculate base cost: 1 BROCA per channel_bytes (typically 1024 bytes)
      const baseCost = Math.ceil(sizeInBytes / channel_bytes);
      
      // For contracts, there's a minimum cost
      const minCost = options.includeContractMin ? channel_min : 0;
      const actualCost = Math.max(baseCost, minCost);
      
      // Calculate how much data this BROCA can store
      const brocaCapacity = actualCost * channel_bytes;
      const refundableBroca = options.includeContractMin ? Math.max(0, minCost - baseCost) : 0;
      
      return {
        cost: actualCost,
        baseCost,
        minCost,
        refundableBroca,
        sizeInBytes,
        sizeInKB: sizeInBytes / 1024,
        sizeInMB: sizeInBytes / (1024 * 1024),
        brocaCapacity,
        bytesPerBroca: channel_bytes,
        contractDays: 30
      };
    } catch (error) {
      console.error('Failed to calculate BROCA cost:', error);
      throw error;
    }
  }

  /**
   * Check if account is registered on SPK
   */
  async checkAccountRegistration(username) {
    try {
      const response = await fetch(`${this.config.spkNode}/@${username}`);
      const data = await response.json();
      return {
        registered: !!data.pubKey,
        data
      };
    } catch (error) {
      console.error('Failed to check account registration:', error);
      return { registered: false };
    }
  }

  /**
   * Generate SPK keypair
   */
  static generateKeyPair() {
    const dhive = require('@hiveio/dhive');
    const crypto = require('crypto');
    
    const opts = { addressPrefix: 'STM' };
    const rando = crypto.randomBytes(32).toString('hex');
    const ownerKey = dhive.PrivateKey.fromLogin('thestandarduser', rando, 'spk');
    
    return {
      privateKey: ownerKey.toString(),
      publicKey: ownerKey.createPublic(opts.addressPrefix).toString()
    };
  }

  /**
   * Ensure account is ready for operations
   */
  ensureActiveAccount() {
    if (!this.activeAccount) {
      throw new Error('No active account selected');
    }
    if (!this.spkInstance) {
      throw new Error('SPK instance not initialized');
    }
  }

  /**
   * Create a flexible signer that can use different signing methods
   * @param {string} keyType - Key type needed (posting, active, owner)
   * @param {Object} options - Signing options
   * @returns {Function} Signer function that signs AND broadcasts
   */
  createFlexibleSigner(keyType = 'posting', options = {}) {
    const method = options.method || 'auto';
    
    return async (tx) => {
      if (method === 'manual') {
        // Return transaction data for manual signing
        return {
          account: this.activeAccount,
          transaction: tx,
          keyType: keyType,
          method: 'manual',
          instructions: 'Sign this transaction with your preferred method'
        };
      } else if (method === 'keychain' && typeof window !== 'undefined' && window.hive_keychain) {
        // Use Hive Keychain - it signs AND broadcasts
        return new Promise((resolve, reject) => {
          window.hive_keychain.requestBroadcast(
            this.activeAccount,
            tx.operations,
            keyType,
            (response) => {
              if (response.success) {
                // Keychain returns the broadcast result
                resolve(response.result);
              } else {
                reject(new Error(response.message || 'Keychain broadcast failed'));
              }
            }
          );
        });
      } else {
        // Use local wallet - account manager handles signing AND broadcasting
        const broadcastResult = await this.accountManager.signAndBroadcast(
          this.activeAccount,
          tx,
          keyType
        );
        
        return broadcastResult;
      }
    };
  }

  /**
   * Prepare transaction for external signing
   * Returns transaction data ready for signing
   * @param {Array} operations - Array of operations [[op_type, op_data], ...]
   * @param {string} keyType - Key type needed (posting, active, owner)
   * @returns {Object} Transaction data for external signing
   */
  async prepareTransactionForSigning(operations, keyType = 'posting') {
    this.ensureActiveAccount();
    
    const dhive = require('@hiveio/dhive');
    const client = new dhive.Client(['https://api.hive.blog']);
    const props = await client.database.getDynamicGlobalProperties();
    
    const refBlockNum = props.head_block_number & 0xFFFF;
    const refBlockPrefix = Buffer.from(props.head_block_id, 'hex').readUInt32LE(4);
    
    const expireTime = new Date(Date.now() + 600000); // 10 minutes
    
    const transaction = {
      ref_block_num: refBlockNum,
      ref_block_prefix: refBlockPrefix,
      expiration: expireTime.toISOString().slice(0, -5),
      operations: operations,
      extensions: []
    };
    
    return {
      account: this.activeAccount,
      transaction: transaction,
      operations: operations,
      keyType: keyType
    };
  }

  /**
   * Check for existing contracts with a broker
   * @param {string} broker - The broker account name
   * @returns {Promise<Object|null>} Existing contract or null
   */
  async getExistingContract(broker) {
    try {
      const response = await fetch(`${this.config.spkNode}/@${this.activeAccount}`);
      if (!response.ok) {
        return null;
      }
      
      const userData = await response.json();
      
      // Check channels for existing contract with this broker
      if (userData.channels && userData.channels[this.activeAccount]) {
        const channels = userData.channels[this.activeAccount];
        
        for (const [channelNum, channel] of Object.entries(channels)) {
          if (channel.b === broker) {
            // Found existing contract
            // Now look up the API URL for this broker
            let apiUrl = null;
            try {
              const { services } = await this.getStorageProviders();
              const provider = services.find(s => s.account === broker);
              if (provider) {
                apiUrl = provider.api;
              }
            } catch (error) {
              console.warn('Failed to look up provider API:', error);
            }
            
            return {
              id: channel.i,
              broker: channel.b,
              amount: channel.a,
              used: channel.r || 0,
              available: (channel.a || 0) - (channel.r || 0),
              api: apiUrl
            };
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Failed to check existing contracts:', error);
      return null;
    }
  }

  /**
   * Create a storage contract on the SPK Network
   * @param {Object} contractData - Contract creation data
   * @returns {Promise<Object>} Contract creation result
   */
  async createStorageContract(contractData, options = {}) {
    this.ensureActiveAccount();
    
    const operations = [[
      'custom_json',
      {
        required_auths: [this.activeAccount],
        required_posting_auths: [],
        id: "spkccT_channel_open",
        json: JSON.stringify({
          to: contractData.to || this.activeAccount,
          broca: parseInt(contractData.amount),
          broker: contractData.broker,
          contract: contractData.contract || "0",
          slots: contractData.slots || undefined // For beneficiary contracts
        })
      }
    ]];

    // If manual signing requested, prepare and return transaction data
    if (options.method === 'manual') {
      return await this.prepareTransactionForSigning(operations, 'active');
    }

    try {
      // Use hive-tx for transaction creation
      const hiveTx = require('hive-tx');
      
      // Create the transaction
      const tx = new hiveTx.Transaction();
      await tx.create(operations);
      
      // Get the unsigned transaction
      const unsignedTx = tx.transaction;
      
      // If manual signing requested, return unsigned transaction
      if (options.method === 'manual') {
        return {
          account: this.activeAccount,
          transaction: unsignedTx,
          keyType: 'active',
          method: 'manual',
          instructions: 'Sign this transaction with your preferred method'
        };
      }
      
      // Use flexible signer - this will handle signing AND broadcasting
      const signer = this.createFlexibleSigner('active', options);
      const result = await signer(unsignedTx);
      
      if (result && result.method === 'manual') {
        return result;
      }
      
      // The signer should return the broadcast result with transaction ID
      let transactionId;
      if (typeof result === 'object' && result.id) {
        transactionId = result.id;
      } else if (typeof result === 'object' && result.trx_id) {
        transactionId = result.trx_id;
      } else if (typeof result === 'string') {
        // Some signers might return just the transaction ID
        transactionId = result;
      } else {
        throw new Error('No transaction ID returned from broadcast');
      }
      
      // Now poll the SPK API to get the actual contract ID
      const contractId = await this.pollForContractId(transactionId, contractData.broker);
      
      this.emit('contract-created', { contractData, contractId, transactionId });
      return { 
        success: true, 
        contractId,
        transactionId,
        contractData 
      };
    } catch (error) {
      console.error('Failed to create storage contract:', error);
      throw error;
    }
  }

  /**
   * Poll SPK API for contract ID using transaction ID
   * @param {string} transactionId - The blockchain transaction ID
   * @param {string} broker - The broker/provider ID
   * @returns {Promise<string>} The contract ID
   */
  async pollForContractId(transactionId, broker) {
    const maxAttempts = 15; // 15 seconds max
    const pollInterval = 1000; // 1 second
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Query user's account data which includes channels
        const userResponse = await fetch(`${this.config.spkNode}/@${this.activeAccount}`);
        if (userResponse.ok) {
          const userData = await userResponse.json();
          
          // Check channels for new contract
          if (userData.channels && userData.channels[this.activeAccount]) {
            const channels = userData.channels[this.activeAccount];
            
            // Look for a channel with the matching broker
            for (const [channelNum, channel] of Object.entries(channels)) {
              if (channel.b === broker) {
                // Found the contract!
                return channel.i;
              }
            }
          }
        }
        
        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        console.warn(`Poll attempt ${attempt + 1} failed:`, error.message);
      }
    }
    
    throw new Error('Contract ID not found after 15 seconds. Transaction may have failed or is still processing.');
  }

  /**
   * Upload files to a public SPK storage node
   * @param {Array<File>} files - Array of File objects to upload
   * @param {Object} contract - Contract object with id, api, etc.
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result
   */
  async uploadToPublicNode(files, contract, options = {}) {
    if (!files || files.length === 0) {
      throw new Error('No files provided');
    }

    if (!contract || !contract.i || !contract.api) {
      throw new Error('Invalid contract object');
    }

    // Calculate CIDs for all files
    const fileData = await this.prepareFilesForUpload(files, options);
    
    // Sign the upload authorization
    const signature = await this.signUploadChallenge(contract, fileData.cids, options);
    
    // Build metadata string
    const metaString = this.buildMetadataString(fileData, options);
    
    // Start uploading files
    const uploadResults = await this.uploadFiles(fileData.files, {
      contract,
      signature,
      metaString,
      cids: fileData.cids,
      ...options
    });

    this.emit('upload-complete', { contract, files: uploadResults });
    return { success: true, results: uploadResults };
  }

  /**
   * Upload files from data arrays (for IPC compatibility)
   * @param {Array<Object>} filesData - Array of file data objects {name, data, type}
   * @param {Object} contract - Contract object with id, api, etc.
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result
   */
  async uploadToPublicNodeFromData(filesData, contract, options = {}) {
    if (!filesData || filesData.length === 0) {
      throw new Error('No files provided');
    }

    if (!contract || !contract.i || !contract.api) {
      throw new Error('Invalid contract object');
    }

    // Convert data arrays back to proper format for upload
    const ipfsOnlyHash = await import('ipfs-only-hash');
    const fileData = [];
    const cids = [];

    for (const file of filesData) {
      const buffer = Buffer.from(file.data);
      
      // Calculate IPFS CID
      const cid = await ipfsOnlyHash.of(buffer);
      
      fileData.push({
        name: file.name,
        buffer: buffer,
        cid,
        metadata: {
          name: file.name.substring(0, 32).replace(/,/g, '-'),
          ext: file.name.split('.').pop().substring(0, 4).toLowerCase(),
          size: buffer.length,
          type: file.type,
          ...options.metadata?.[file.name]
        }
      });
      
      cids.push(cid);
    }

    // Sign the upload authorization
    const signature = await this.signUploadChallenge(contract, cids, options);
    
    // Build metadata string
    const metaString = this.buildMetadataString({ files: fileData, cids }, {
      folderPath: options.folderPath,
      encryptionKeys: options.encryptionKeys
    });
    
    // Start uploading files
    const uploadResults = await this.uploadFilesFromData(fileData, {
      contract,
      signature,
      metaString,
      cids,
      ...options
    });

    this.emit('upload-complete', { contract, files: uploadResults });
    return { success: true, results: uploadResults };
  }

  /**
   * Prepare files for upload by calculating CIDs
   */
  async prepareFilesForUpload(files, options = {}) {
    const ipfsOnlyHash = await import('ipfs-only-hash');
    const fileData = [];
    const cids = [];

    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      
      // Calculate IPFS CID
      const cid = await ipfsOnlyHash.of(uint8Array);
      
      fileData.push({
        file,
        cid,
        buffer: uint8Array,
        metadata: {
          name: file.name.substring(0, 32).replace(/,/g, '-'),
          ext: file.name.split('.').pop().substring(0, 4).toLowerCase(),
          size: file.size,
          type: file.type,
          ...options.metadata?.[file.name]
        }
      });
      
      cids.push(cid);
    }

    return { files: fileData, cids };
  }

  /**
   * Sign the upload challenge for authorization
   */
  async signUploadChallenge(contract, cids, options = {}) {
    // Build challenge as: account:contract:files - this is what the server will reconstruct for verification
    const challenge = `${this.activeAccount}:${contract.i}:,${cids.join(',')}`;
    
    console.log('About to sign upload challenge:', {
      account: this.activeAccount,
      contract: contract.i,
      cids: cids,
      challenge: challenge
    });
    
    // For desktop app, we need to sign through IPC
    // The account manager is in the main process
    try {
      console.log('Calling accountManager.signMessage...');
      const signedMessage = await this.accountManager.signMessage(
        this.activeAccount,
        challenge,
        'posting'
      );
      
      console.log('SignMessage returned:', signedMessage);
      
      // The response format from signMessage is: challenge:signature
      // Extract just the signature part (everything after the last colon)
      const lastColonIndex = signedMessage.lastIndexOf(':');
      const signature = lastColonIndex !== -1 ? signedMessage.substring(lastColonIndex + 1) : signedMessage;
      
      console.log('Challenge:', challenge);
      console.log('Signature:', signature);
      
      return signature;
    } catch (error) {
      console.error('Failed to sign upload challenge:', error);
      throw new Error(`Failed to sign upload challenge: ${error.message}`);
    }
  }

  /**
   * Build metadata string for upload using spk-js metadata system
   */
  buildMetadataString(fileData, options = {}) {
    // Use proper spk-js metadata building
    const { buildMetadataFromFiles } = require('@disregardfiat/spk-js/storage/metadata');
    
    // Convert fileData to SimpleFileData format expected by spk-js
    const files = [];
    for (const data of fileData.files) {
      const meta = data.metadata;
      
      // Determine folder path - for videos, use Videos preset folder
      let folderPath = '';
      if (meta.ext === 'mp4' || meta.ext === 'mov' || meta.ext === 'm3u8' || meta.ext === 'ts') {
        folderPath = 'Videos';
      }
      
      files.push({
        cid: data.cid || 'placeholder', // CID will be set during upload
        name: meta.name || '',
        ext: meta.ext || '',
        path: folderPath ? `${folderPath}/${meta.name}.${meta.ext}` : '',
        thumb: meta.thumb || '',
        encrypted: false, // Not encrypted by default
        hidden: !meta.name || meta.name === '', // Hidden if no name (video segments)
        nsfw: false,
        executable: false,
        license: meta.license || '',
        labels: meta.labels || '',
      });
    }
    
    // Build metadata string using spk-js
    const metadataString = buildMetadataFromFiles(files, options.encryptionKeys || '');
    
    return encodeURI(metadataString);
  }

  /**
   * Upload files with chunking support
   */
  async uploadFiles(fileDataArray, uploadOptions) {
    const results = [];
    
    for (const fileData of fileDataArray) {
      try {
        const result = await this.uploadSingleFile(fileData, uploadOptions);
        results.push(result);
      } catch (error) {
        console.error(`Failed to upload ${fileData.file.name}:`, error);
        results.push({ 
          file: fileData.file.name, 
          cid: fileData.cid,
          success: false, 
          error: error.message 
        });
      }
    }
    
    return results;
  }

  /**
   * Upload files from data (for IPC compatibility)
   */
  async uploadFilesFromData(fileDataArray, uploadOptions) {
    const results = [];
    
    for (const fileData of fileDataArray) {
      try {
        const result = await this.uploadSingleFileFromData(fileData, uploadOptions);
        results.push(result);
      } catch (error) {
        console.error(`Failed to upload ${fileData.name}:`, error);
        results.push({ 
          file: fileData.name, 
          cid: fileData.cid,
          success: false, 
          error: error.message 
        });
      }
    }
    
    return results;
  }

  /**
   * Upload a single file from data
   */
  async uploadSingleFileFromData(fileData, options) {
    const { contract, signature, metaString, cids } = options;
    
    try {
      // Use the appropriate fetch based on environment
      const fetchToUse = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
      const FormData = require('form-data');
      
      const form = new FormData();
      
      // Add the file buffer
      form.append('chunk', fileData.buffer, {
        filename: fileData.name,
        contentType: fileData.metadata.type || 'application/octet-stream'
      });

      // Get form headers first to preserve boundary
      const formHeaders = form.getHeaders();
      
      // Build headers - DO NOT override Content-Type!
      const headers = {
        'Content-Type': formHeaders['content-type'], // Keep the boundary!
        'Content-Range': `bytes=0-${fileData.buffer.length - 1}/${fileData.buffer.length}`,
        'X-Cid': fileData.cid,
        'X-Contract': contract.i,
        'X-Sig': signature,
        'X-Account': this.activeAccount,
        'X-Files': `,${cids.join(',')}`,
        'X-Meta': metaString
      };

      console.log('Upload details:', {
        url: `${contract.api}/upload`,
        contractId: contract.i,
        account: this.activeAccount,
        cid: fileData.cid,
        files: `,${cids.join(',')}`,
        metaString: metaString,
        signature: signature,
        fileSize: fileData.buffer.length,
        contentRange: `bytes=0-${fileData.buffer.length - 1}/${fileData.buffer.length}`,
        contentType: headers['Content-Type']
      });

      // Get the form buffer and length for proper streaming
      const formBuffer = form.getBuffer();
      const formLength = form.getLengthSync();
      
      // Add Content-Length header
      headers['Content-Length'] = formLength;

      const uploadResponse = await fetchToUse(`${contract.api}/upload`, {
        method: 'POST',
        headers: headers,
        body: formBuffer
      });

      const responseText = await uploadResponse.text();
      
      if (!uploadResponse.ok) {
        console.error('Upload failed:', uploadResponse.status, responseText);
        throw new Error(`Upload failed: ${uploadResponse.statusText} - ${responseText}`);
      }

      console.log('Upload success:', fileData.name);
      
      return {
        file: fileData.name,
        cid: fileData.cid,
        success: true,
        url: `https://ipfs.dlux.io/ipfs/${fileData.cid}`
      };
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  }

  /**
   * Upload a single file with chunking
   */
  async uploadSingleFile(fileData, options) {
    const { contract, signature, metaString, cids } = options;
    
    // Upload the file
    const formData = new FormData();
    formData.append('chunk', fileData.file);

    const uploadResponse = await fetch(`${contract.api}/upload`, {
      method: 'POST',
      headers: {
        'Content-Range': `bytes=0-${fileData.file.size - 1}/${fileData.file.size}`,
        'X-Cid': fileData.cid,
        'X-Contract': contract.i,
        'X-Sig': signature,
        'X-Account': this.activeAccount,
        'X-Files': `,${cids.join(',')}`,
        'X-Meta': metaString
      },
      body: formData
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed: ${uploadResponse.statusText} - ${errorText}`);
    }

    return {
      file: fileData.file.name,
      cid: fileData.cid,
      success: true,
      url: `https://ipfs.dlux.io/ipfs/${fileData.cid}`
    };
  }

  /**
   * Setup direct upload functionality
   */
  setupDirectUpload() {
    if (!this.spkInstance) return;
    
    // Add direct upload method to the file object
    this.spkInstance.file = this.spkInstance.file || {};
    
    /**
     * Direct upload method - uploads files directly to IPFS without broker verification
     * This creates a completed storage contract immediately upon upload
     */
    this.spkInstance.file.directUpload = async (files, options = {}) => {
      if (!files || files.length === 0) {
        throw new Error('No files provided');
      }

      // Calculate total size
      let totalSize = 0;
      const fileData = [];
      
      for (const file of files) {
        const size = file.size || (file.content ? file.content.length : 0);
        fileData.push({
          file,
          size,
          cid: file.cid || null // Will be calculated if not provided
        });
        totalSize += size;
      }

      // Calculate BROCA cost (simplified - 1 BROCA per MB per day)
      const duration = options.duration || 30;
      const brocaCost = Math.ceil((totalSize / (1024 * 1024)) * duration);
      
      // Contract ID will be assigned by the blockchain after transaction
      // For now, use a placeholder that will be replaced with the actual transaction ID
      const contractId = 'pending';

      // Prepare CIDs and sizes for the direct_upload operation
      const cids = fileData.map(f => f.cid || 'Qm' + Math.random().toString(36).substr(2, 20)).join(',');
      const sizes = fileData.map(f => f.size).join(',');

      // Create the direct upload transaction
      const json = {
        op: 'direct_upload',
        c: cids,
        s: sizes,
        id: contractId,
      };

      // Add metadata if provided
      if (options.metadata) {
        json.m = Buffer.from(JSON.stringify(options.metadata)).toString('base64');
      }

      // Determine the correct SPK network ID based on the node being used
      const spkNetworkId = this.config.spkNode.includes('spktest') ? 'spkcc_spktest' : 'spkcc_dlux';

      // Execute the direct upload transaction using our account manager
      const signedTx = await this.signTransaction({
        required_auths: [this.activeAccount],
        required_posting_auths: [],
        id: spkNetworkId,
        json: JSON.stringify(json)
      }, 'active');

      return {
        success: true,
        contractId,
        transactionId: signedTx.id || 'pending',
        files: fileData.map(f => ({
          cid: f.cid,
          size: f.size,
          url: `https://ipfs.dlux.io/ipfs/${f.cid}`
        })),
        totalSize,
        brocaCost,
      };
    };
  }

  // Provider selection is now handled internally by spk-js
}

module.exports = SPKClient;