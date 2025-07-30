const { EventEmitter } = require('events');
const fetch = require('node-fetch');

/**
 * Contract Monitor
 * Monitors SPK network for storage contracts and manages IPFS pinning
 */
class ContractMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      spkApiUrl: config.spkApiUrl || 'https://spktest.dlux.io',
      username: config.username || null,
      checkInterval: config.checkInterval || 60000, // Check every minute
      ipfsManager: config.ipfsManager || null,
      storageNode: config.storageNode || null,
      ...config
    };
    
    this.contracts = new Map(); // contractId -> contract data
    this.pinnedCIDs = new Set(); // Track what we've pinned
    this.monitorInterval = null;
    this.isMonitoring = false;
  }

  /**
   * Start monitoring contracts
   */
  async start() {
    if (this.isMonitoring) return;
    
    if (!this.config.username) {
      throw new Error('Username is required to monitor contracts');
    }
    
    if (!this.config.ipfsManager) {
      throw new Error('IPFS Manager is required for pinning');
    }
    
    this.isMonitoring = true;
    
    // Do initial check
    await this.checkContracts();
    
    // Start periodic monitoring
    this.monitorInterval = setInterval(() => {
      this.checkContracts().catch(err => {
        this.emit('error', err);
      });
    }, this.config.checkInterval);
    
    this.emit('started');
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    this.isMonitoring = false;
    this.emit('stopped');
  }

  /**
   * Check for new contracts and files to pin
   */
  async checkContracts() {
    try {
      // Get list of contracts from SPK network
      const contracts = await this.fetchUserContracts();
      
      this.emit('log', {
        level: 'info',
        message: `Found ${contracts.length} contracts for ${this.config.username}`
      });
      
      // Process each contract
      for (const contract of contracts) {
        await this.processContract(contract);
      }
      
      // Clean up old pins (contracts that are no longer active)
      await this.cleanupOldPins(contracts);
      
      this.emit('check-complete', {
        contracts: contracts.length,
        pinned: this.pinnedCIDs.size
      });
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Fetch user contracts from SPK network
   */
  async fetchUserContracts() {
    try {
      // Get user services to find storage contracts
      const servicesUrl = `${this.config.spkApiUrl}/user_services/${this.config.username}`;
      const servicesResponse = await fetch(servicesUrl);
      
      if (!servicesResponse.ok) {
        throw new Error(`Failed to fetch user services: ${servicesResponse.status}`);
      }
      
      const servicesData = await servicesResponse.json();
      
      // Extract IPFS storage contracts
      const contracts = [];
      
      if (servicesData.services && servicesData.services.IPFS) {
        for (const [ipfsId, service] of Object.entries(servicesData.services.IPFS)) {
          // Each IPFS service may have associated contracts
          contracts.push({
            id: ipfsId,
            service: service,
            type: 'IPFS'
          });
        }
      }
      
      // Also check for active storage contracts
      const contractsUrl = `${this.config.spkApiUrl}/list-contracts`;
      const contractsResponse = await fetch(contractsUrl);
      
      if (contractsResponse.ok) {
        const contractsData = await contractsResponse.json();
        
        // Filter contracts for this storage node
        if (contractsData.contracts) {
          for (const contract of contractsData.contracts) {
            if (contract.storage_node === this.config.username || 
                contract.broker === this.config.username) {
              contracts.push({
                id: contract.id,
                cid: contract.cid,
                size: contract.size,
                duration: contract.duration,
                type: 'storage',
                ...contract
              });
            }
          }
        }
      }
      
      return contracts;
    } catch (error) {
      this.emit('log', {
        level: 'error',
        message: `Failed to fetch contracts: ${error.message}`
      });
      return [];
    }
  }

  /**
   * Process a single contract
   */
  async processContract(contract) {
    try {
      // Store contract data
      this.contracts.set(contract.id, contract);
      
      // Extract CIDs to pin
      const cidsToPin = this.extractCIDsFromContract(contract);
      
      for (const cid of cidsToPin) {
        if (!this.pinnedCIDs.has(cid)) {
          await this.pinCID(cid, contract.id);
        }
      }
    } catch (error) {
      this.emit('log', {
        level: 'error',
        message: `Failed to process contract ${contract.id}: ${error.message}`
      });
    }
  }

  /**
   * Extract CIDs from contract data
   */
  extractCIDsFromContract(contract) {
    const cids = [];
    
    // Direct CID in contract
    if (contract.cid) {
      cids.push(contract.cid);
    }
    
    // CIDs in files array
    if (contract.files && Array.isArray(contract.files)) {
      for (const file of contract.files) {
        if (file.cid) cids.push(file.cid);
      }
    }
    
    // CIDs in metadata
    if (contract.meta && contract.meta.cids) {
      if (Array.isArray(contract.meta.cids)) {
        cids.push(...contract.meta.cids);
      } else if (typeof contract.meta.cids === 'string') {
        // Comma-separated CIDs
        cids.push(...contract.meta.cids.split(',').map(c => c.trim()));
      }
    }
    
    // Remove duplicates and validate
    return [...new Set(cids)].filter(cid => this.isValidCID(cid));
  }

  /**
   * Validate CID format
   */
  isValidCID(cid) {
    return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || 
           /^bafy[a-z0-9]{50,}$/.test(cid);
  }

  /**
   * Pin a CID to IPFS
   */
  async pinCID(cid, contractId) {
    try {
      this.emit('log', {
        level: 'info',
        message: `Pinning CID ${cid} for contract ${contractId}`
      });
      
      // Pin the file
      await this.config.ipfsManager.pinFile(cid);
      
      // Track that we've pinned it
      this.pinnedCIDs.add(cid);
      
      this.emit('cid-pinned', {
        cid,
        contractId
      });
      
      // Report to POA if running
      if (this.config.storageNode && this.config.storageNode.running) {
        this.emit('log', {
          level: 'info',
          message: `Reporting pinned CID ${cid} to POA`
        });
      }
    } catch (error) {
      this.emit('log', {
        level: 'error',
        message: `Failed to pin CID ${cid}: ${error.message}`
      });
      throw error;
    }
  }

  /**
   * Clean up pins for expired contracts
   */
  async cleanupOldPins(activeContracts) {
    try {
      // Get all currently pinned files
      const pinnedFiles = await this.config.ipfsManager.getPinnedFiles();
      const activeCIDs = new Set();
      
      // Collect all CIDs from active contracts
      for (const contract of activeContracts) {
        const cids = this.extractCIDsFromContract(contract);
        cids.forEach(cid => activeCIDs.add(cid));
      }
      
      // Unpin files that are no longer in active contracts
      let unpinned = 0;
      for (const pin of pinnedFiles) {
        const cid = pin.cid?.toString() || pin.hash;
        
        if (this.pinnedCIDs.has(cid) && !activeCIDs.has(cid)) {
          try {
            await this.config.ipfsManager.unpinFile(cid);
            this.pinnedCIDs.delete(cid);
            unpinned++;
            
            this.emit('cid-unpinned', { cid });
          } catch (error) {
            this.emit('log', {
              level: 'warn',
              message: `Failed to unpin CID ${cid}: ${error.message}`
            });
          }
        }
      }
      
      if (unpinned > 0) {
        this.emit('log', {
          level: 'info',
          message: `Cleaned up ${unpinned} expired pins`
        });
      }
    } catch (error) {
      this.emit('log', {
        level: 'error',
        message: `Failed to cleanup old pins: ${error.message}`
      });
    }
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      monitoring: this.isMonitoring,
      contracts: this.contracts.size,
      pinnedCIDs: this.pinnedCIDs.size,
      username: this.config.username
    };
  }

  /**
   * Get contract details
   */
  getContracts() {
    return Array.from(this.contracts.values());
  }

  /**
   * Get pinned CIDs list
   */
  getPinnedCIDs() {
    return Array.from(this.pinnedCIDs);
  }
}

module.exports = ContractMonitor;