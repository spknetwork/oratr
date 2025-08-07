const { EventEmitter } = require('events');
const fetch = require('node-fetch');

/**
 * File Sync Service
 * Polls SPK network for contracts the storage node should be storing
 * and ensures IPFS pins are in sync
 */
class FileSyncService extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Extract username from storage node if available
    const username = config.username || 
      (config.storageNode && config.storageNode.config ? config.storageNode.config.account : null);
    
    if (!username) {
      throw new Error('Username is required for file sync service');
    }
    
    if (!config.ipfsManager) {
      throw new Error('IPFS Manager is required for file sync service');
    }
    
    this.config = {
      username,
      spkApiUrl: config.spkApiUrl || 'https://spktest.dlux.io',
      syncInterval: config.syncInterval || 60 * 1000, // 1 minute default (reduced from 5 minutes)
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      autoStart: config.autoStart || false,
      ipfsManager: config.ipfsManager,
      storageNode: config.storageNode,
      maxConcurrentPins: config.maxConcurrentPins || 50, // Limit concurrent pin requests
      ...config
    };
    
    this.running = false;
    this.syncInterval = null;
    this.pinnedCIDs = new Set(); // Track CIDs we've pinned
    this.stats = {
      syncCount: 0,
      totalContracts: 0,
      totalPinned: 0,
      errorCount: 0,
      lastSync: null,
      lastError: null
    };
    
    // Auto-start integration with storage node
    if (this.config.autoStart && this.config.storageNode) {
      this.setupStorageNodeIntegration();
    }
  }

  /**
   * Setup integration with storage node lifecycle
   */
  setupStorageNodeIntegration() {
    const storageNode = this.config.storageNode;
    
    storageNode.on('started', () => {
      this.start().catch(err => {
        this.emit('error', new Error(`Failed to auto-start file sync: ${err.message}`));
      });
    });
    
    storageNode.on('stopped', () => {
      this.stop().catch(err => {
        this.emit('error', new Error(`Failed to stop file sync: ${err.message}`));
      });
    });
  }

  /**
   * Start the file sync service
   */
  async start() {
    if (this.running) {
      return;
    }
    
    this.running = true;
    
    // Perform initial sync
    await this.performSync();
    
    // Start periodic sync
    this.syncInterval = setInterval(() => {
      this.performSync().catch(err => {
        this.emit('error', err);
      });
    }, this.config.syncInterval);
    
    this.emit('started');
  }

  /**
   * Stop the file sync service
   */
  async stop() {
    if (!this.running) {
      return;
    }
    
    this.running = false;
    
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    
    this.emit('stopped');
  }

  /**
   * Check if service is running
   */
  isRunning() {
    return this.running;
  }

  /**
   * Perform a complete sync cycle
   */
  async performSync() {
    this.emit('sync-start');
    
    try {
      // Fetch contracts this node should be storing
      const contracts = await this.fetchStoredContracts();
      
      // Sync the files (pin new ones, unpin expired ones)
      const syncResult = await this.syncContracts(contracts);
      
      // Update statistics
      this.stats.syncCount++;
      this.stats.totalContracts = contracts.length;
      this.stats.lastSync = new Date();
      
      this.emit('sync-complete', {
        contracts: contracts.length,
        newPins: syncResult.pinned,
        removedPins: syncResult.unpinned
      });
    } catch (error) {
      this.stats.errorCount++;
      this.stats.lastError = error;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Fetch contracts this storage node should be storing
   */
  async fetchStoredContracts() {
    const url = `${this.config.spkApiUrl}/api/spk/contracts/stored-by/${this.config.username}`;
    
    let lastError;
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.contracts || [];
      } catch (error) {
        lastError = error;
        
        if (attempt < this.config.maxRetries - 1) {
          // Wait before retry
          await new Promise(resolve => 
            setTimeout(resolve, this.config.retryDelay * (attempt + 1))
          );
        }
      }
    }
    
    // All retries failed
    this.emit('log', {
      level: 'error',
      message: `Failed to fetch contracts after ${this.config.maxRetries} attempts: ${lastError.message}`
    });
    
    return [];
  }

  /**
   * Sync contracts - pin new files and unpin expired ones
   */
  async syncContracts(contracts) {
    const result = {
      pinned: 0,
      unpinned: 0,
      errors: 0
    };
    
    try {
      // Get currently pinned files
      const pinnedFiles = await this.config.ipfsManager.getPinnedFiles();
      const currentlyPinned = new Set(pinnedFiles.map(pin => {
        // Handle different CID formats from IPFS
        const cid = pin.cid?.toString() || pin.hash;
        return cid;
      }));
      
      // Extract all CIDs that should be pinned
      const shouldBePinned = new Set();
      for (const contract of contracts) {
        const cids = this.extractCIDsFromContract(contract);
        cids.forEach(cid => shouldBePinned.add(cid));
      }
      
      // Pin files that aren't currently pinned (with rolling concurrency limit)
      const cidsToPin = [];
      for (const cid of shouldBePinned) {
        if (!currentlyPinned.has(cid)) {
          cidsToPin.push(cid);
        }
      }
      
      // Create a map to track CID to contract for scatter-shot approach
      const cidToContract = new Map();
      for (const contract of contracts) {
        const cids = this.extractCIDsFromContract(contract);
        cids.forEach(cid => cidToContract.set(cid, contract));
      }
      
      // Scatter-shot approach: interleave CIDs from different contracts
      const scatteredCids = [];
      const contractGroups = new Map();
      
      // Group CIDs by contract
      for (const cid of cidsToPin) {
        const contract = cidToContract.get(cid);
        const contractId = contract?.id || 'unknown';
        if (!contractGroups.has(contractId)) {
          contractGroups.set(contractId, []);
        }
        contractGroups.get(contractId).push(cid);
      }
      
      // Interleave CIDs from different contracts for better distribution
      const maxLength = Math.max(...Array.from(contractGroups.values()).map(arr => arr.length));
      for (let i = 0; i < maxLength; i++) {
        for (const [contractId, cids] of contractGroups) {
          if (i < cids.length) {
            scatteredCids.push(cids[i]);
          }
        }
      }
      
      // Use a rolling window approach with max concurrent pins
      const maxConcurrent = this.config.maxConcurrentPins;
      const activePromises = new Set();
      
      const pinWithLimit = async (cid) => {
        const promise = (async () => {
          try {
            await this.config.ipfsManager.pinFile(cid);
            this.pinnedCIDs.add(cid);
            result.pinned++;
            
            const contract = cidToContract.get(cid);
            this.emit('file-pinned', {
              cid,
              contractId: contract ? contract.id : 'unknown'
            });
          } catch (error) {
            result.errors++;
            this.emit('error', new Error(`Failed to pin CID ${cid}: ${error.message}`));
          } finally {
            activePromises.delete(promise);
          }
        })();
        
        activePromises.add(promise);
        return promise;
      };
      
      // Process CIDs with rolling window
      for (const cid of scatteredCids) {
        // Wait if we've hit the concurrent limit
        while (activePromises.size >= maxConcurrent) {
          // Wait for at least one to complete
          await Promise.race(activePromises);
        }
        
        // Start new pin without waiting for it
        pinWithLimit(cid);
      }
      
      // Wait for remaining pins to complete
      if (activePromises.size > 0) {
        await Promise.allSettled(activePromises);
      }
      
      // Clean up expired pins
      const cleanupResult = await this.cleanupExpiredPins(contracts);
      result.unpinned = cleanupResult.unpinned;
      result.errors += cleanupResult.errors;
      
      // Update stats
      this.stats.totalPinned = this.pinnedCIDs.size;
      
    } catch (error) {
      result.errors++;
      throw error;
    }
    
    return result;
  }

  /**
   * Extract CIDs from contract data
   */
  extractCIDsFromContract(contract) {
    const cids = [];
    
    // Main CID
    if (contract.cid && this.config.ipfsManager.isValidCID(contract.cid)) {
      cids.push(contract.cid);
    }
    
    // Files array
    if (contract.files && Array.isArray(contract.files)) {
      for (const file of contract.files) {
        if (file.cid && this.config.ipfsManager.isValidCID(file.cid)) {
          cids.push(file.cid);
        }
      }
    }
    
    // Metadata CIDs
    if (contract.metadata) {
      // Thumbnails
      if (contract.metadata.thumbnails && Array.isArray(contract.metadata.thumbnails)) {
        contract.metadata.thumbnails.forEach(cid => {
          if (this.config.ipfsManager.isValidCID(cid)) {
            cids.push(cid);
          }
        });
      }
      
      // Other metadata CIDs
      Object.values(contract.metadata).forEach(value => {
        if (typeof value === 'string' && this.config.ipfsManager.isValidCID(value)) {
          cids.push(value);
        }
      });
    }
    
    // Remove duplicates and return
    return [...new Set(cids)];
  }

  /**
   * Clean up pins for expired contracts
   */
  async cleanupExpiredPins(activeContracts) {
    const result = {
      unpinned: 0,
      errors: 0
    };
    
    try {
      // Get all CIDs from active contracts
      const activeCIDs = new Set();
      for (const contract of activeContracts) {
        const cids = this.extractCIDsFromContract(contract);
        cids.forEach(cid => activeCIDs.add(cid));
      }
      
      // Get currently pinned files
      const pinnedFiles = await this.config.ipfsManager.getPinnedFiles();
      
      // Unpin files that are no longer in active contracts
      for (const pin of pinnedFiles) {
        const cid = pin.cid?.toString() || pin.hash;
        
        // Only unpin files we pinned (tracked in our set)
        // and that are no longer in active contracts
        if (this.pinnedCIDs.has(cid) && !activeCIDs.has(cid)) {
          try {
            await this.config.ipfsManager.unpinFile(cid);
            this.pinnedCIDs.delete(cid);
            result.unpinned++;
            
            this.emit('file-unpinned', { cid });
          } catch (error) {
            result.errors++;
            this.emit('error', new Error(`Failed to unpin CID ${cid}: ${error.message}`));
          }
        }
      }
    } catch (error) {
      result.errors++;
      throw error;
    }
    
    return result;
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      ...this.stats,
      pinnedCIDs: this.pinnedCIDs.size
    };
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      running: this.running,
      username: this.config.username,
      spkApiUrl: this.config.spkApiUrl,
      syncInterval: this.config.syncInterval,
      totalPinned: this.pinnedCIDs.size,
      lastSync: this.stats.lastSync,
      stats: this.getStats()
    };
  }

  /**
   * Force immediate sync
   */
  async forceSync() {
    if (!this.running) {
      throw new Error('Service is not running');
    }
    
    return this.performSync();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    
    // Restart sync interval if running and interval changed
    if (this.running && newConfig.syncInterval && this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = setInterval(() => {
        this.performSync().catch(err => {
          this.emit('error', err);
        });
      }, this.config.syncInterval);
    }
  }

  /**
   * Get pinned CIDs list
   */
  getPinnedCIDs() {
    return Array.from(this.pinnedCIDs);
  }

  /**
   * Check if a CID is tracked as pinned by this service
   */
  isPinnedByService(cid) {
    return this.pinnedCIDs.has(cid);
  }
}

module.exports = FileSyncService;