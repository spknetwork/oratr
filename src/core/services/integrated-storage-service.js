const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs').promises;

/**
 * Integrated Storage Service
 * Combines IPFS, PoA, and direct upload to provide a complete storage solution
 * that allows users to earn rewards by storing files
 */
class IntegratedStorageService extends EventEmitter {
  constructor({ ipfsManager, poaStorageNode, spkClient, videoUploadService }) {
    super();
    
    this.ipfs = ipfsManager;
    this.poa = poaStorageNode;
    this.spk = spkClient;
    this.videoUpload = videoUploadService;
    
    this.storageContracts = new Map();
    this.replicationQueue = [];
    this.isReplicating = false;
    
    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for various components
   */
  setupEventListeners() {
    // Only setup listeners if components are available
    if (this.poa) {
      // Listen for PoA validation requests
      this.poa.on('validation', async (event) => {
        await this.handleValidationRequest(event);
      });
      
      // Listen for new contracts from the network
      this.poa.on('contract-registered', async (contract) => {
        await this.handleNewContract(contract);
      });
    }
    
    if (this.ipfs && this.ipfs.on) {
      // Listen for file additions to IPFS
      this.ipfs.on('file-added', async (result) => {
        await this.handleFileAdded(result);
      });
    }
  }

  /**
   * Initialize the integrated storage service
   */
  async init() {
    // Ensure IPFS is running
    if (!this.ipfs.running) {
      await this.ipfs.start();
    }
    
    // Ensure PoA is running
    if (!this.poa.running) {
      await this.poa.start();
    }
    
    // Load existing contracts
    await this.loadStorageContracts();
    
    // Start replication worker
    this.startReplicationWorker();
    
    this.emit('initialized');
  }

  /**
   * Direct upload with automatic IPFS pinning and PoA registration
   */
  async directUploadWithStorage(files, options = {}) {
    try {
      // Step 1: Add files to local IPFS first
      console.log('Adding files to local IPFS...');
      const ipfsResults = [];
      
      for (const file of files) {
        let content;
        if (file instanceof File) {
          content = await file.arrayBuffer();
        } else if (file.arrayBuffer) {
          content = await file.arrayBuffer();
        } else if (file.content) {
          content = file.content;
        } else {
          throw new Error('Invalid file format');
        }
        
        const result = await this.ipfs.addFile(Buffer.from(content), {
          pin: true,
          wrapWithDirectory: false
        });
        
        ipfsResults.push({
          cid: result.cid.toString(),
          size: result.size,
          path: result.path,
          originalFile: file
        });
        
        console.log(`Added ${file.name || 'file'} to IPFS: ${result.cid}`);
      }
      
      // Step 2: Use direct upload to create storage contract on SPK network
      console.log('Creating storage contract via direct upload...');
      const spkFile = this.spk.spkInstance.file;
      
      const uploadResult = await spkFile.directUpload(files, {
        duration: options.duration || 30,
        metadata: {
          ...options.metadata,
          ipfsNode: this.ipfs.nodeInfo?.id,
          poaEnabled: true
        }
      });
      
      // Step 3: Register contract with local PoA node
      console.log('Registering contract with PoA node...');
      for (const ipfsResult of ipfsResults) {
        const contractData = {
          contractId: uploadResult.contractId,
          cid: ipfsResult.cid,
          size: ipfsResult.size,
          owner: this.spk.getActiveAccount().username,
          created: Date.now(),
          duration: (options.duration || 30) * 24 * 60 * 60 * 1000, // Convert days to ms
          metadata: options.metadata
        };
        
        await this.poa.registerContract(contractData);
        this.storageContracts.set(ipfsResult.cid, contractData);
      }
      
      // Step 4: Announce availability to the network
      await this.announceFileAvailability(ipfsResults.map(r => r.cid));
      
      this.emit('direct-upload-complete', {
        ...uploadResult,
        ipfsResults,
        poaRegistered: true
      });
      
      return {
        ...uploadResult,
        ipfsResults,
        poaRegistered: true
      };
      
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Handle validation requests from the PoA network
   */
  async handleValidationRequest(event) {
    try {
      const { cid, challenge } = event.data || event;
      
      // Check if we have the file
      const hasFile = await this.checkFileExists(cid);
      if (!hasFile) {
        console.log(`Validation request for unknown file: ${cid}`);
        return;
      }
      
      // Generate proof
      const proof = await this.generateProof(cid, challenge);
      
      // Send proof back
      await this.poa.wsClient.send(JSON.stringify({
        type: 'validation-response',
        cid,
        challenge,
        proof,
        timestamp: Date.now()
      }));
      
      this.emit('validation-completed', { cid, challenge });
      
    } catch (error) {
      console.error('Validation error:', error);
      this.emit('validation-error', error);
    }
  }

  /**
   * Generate proof of storage for a file
   */
  async generateProof(cid, challenge) {
    // Get file content
    const content = await this.ipfs.getFile(cid);
    
    // Use challenge to determine which parts of the file to include in proof
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    
    // Simple proof: hash of challenge + file content
    // In production, this would be more sophisticated
    hash.update(challenge);
    hash.update(content);
    
    return hash.digest('hex');
  }

  /**
   * Check if a file exists in local IPFS
   */
  async checkFileExists(cid) {
    try {
      const pins = await this.ipfs.getPinnedFiles();
      return pins.some(pin => pin.cid.toString() === cid);
    } catch (error) {
      return false;
    }
  }

  /**
   * Handle new contracts announced on the network
   */
  async handleNewContract(contract) {
    // Check if this is our contract
    if (contract.owner === this.spk.getActiveAccount()?.username) {
      return; // Skip our own contracts
    }
    
    // Check if we should replicate this file
    if (await this.shouldReplicate(contract)) {
      this.replicationQueue.push(contract);
      this.emit('replication-queued', contract);
    }
  }

  /**
   * Determine if we should replicate a file
   */
  async shouldReplicate(contract) {
    // Check available space
    const stats = await this.poa.getStorageStats();
    if (stats.spaceAvailable < contract.size) {
      return false;
    }
    
    // Check if file is already stored
    if (await this.checkFileExists(contract.cid)) {
      return false;
    }
    
    // Check profitability (simplified)
    // In production, this would consider network demand, our reputation, etc.
    const estimatedReward = this.estimateReplicationReward(contract);
    return estimatedReward > 0;
  }

  /**
   * Estimate potential rewards for replicating a file
   */
  estimateReplicationReward(contract) {
    // Simplified calculation
    // In production, this would be based on network parameters
    const dailyReward = 0.1; // SPK per day per GB
    const sizeInGB = contract.size / (1024 * 1024 * 1024);
    const daysRemaining = Math.floor(contract.duration / (24 * 60 * 60 * 1000));
    
    return dailyReward * sizeInGB * daysRemaining;
  }

  /**
   * Start the replication worker
   */
  startReplicationWorker() {
    setInterval(async () => {
      if (this.isReplicating || this.replicationQueue.length === 0) {
        return;
      }
      
      this.isReplicating = true;
      const contract = this.replicationQueue.shift();
      
      try {
        await this.replicateFile(contract);
      } catch (error) {
        console.error('Replication error:', error);
        this.emit('replication-error', { contract, error });
      }
      
      this.isReplicating = false;
    }, 10000); // Check every 10 seconds
  }

  /**
   * Replicate a file from another node
   */
  async replicateFile(contract) {
    console.log(`Replicating file ${contract.cid}...`);
    
    try {
      // Pin the file (IPFS will fetch it from the network)
      await this.ipfs.pinFile(contract.cid);
      
      // Register with our PoA node
      await this.poa.registerContract({
        ...contract,
        replicated: true,
        replicatedAt: Date.now()
      });
      
      // Store in our contracts map
      this.storageContracts.set(contract.cid, contract);
      
      // Announce that we now have this file
      await this.announceFileAvailability([contract.cid]);
      
      this.emit('file-replicated', contract);
      console.log(`Successfully replicated ${contract.cid}`);
      
    } catch (error) {
      throw error;
    }
  }

  /**
   * Announce file availability to the network
   */
  async announceFileAvailability(cids) {
    if (!this.poa.wsClient || this.poa.wsClient.readyState !== 1) {
      console.warn('PoA WebSocket not connected, skipping announcement');
      return;
    }
    
    const message = {
      type: 'file-announcement',
      nodeId: this.ipfs.nodeInfo?.id,
      account: this.spk.getActiveAccount()?.username,
      cids: cids,
      timestamp: Date.now()
    };
    
    await this.poa.wsClient.send(JSON.stringify(message));
  }

  /**
   * Handle file added to IPFS
   */
  async handleFileAdded(result) {
    // Check if this file has a storage contract
    const contract = this.storageContracts.get(result.cid.toString());
    if (contract) {
      // Update contract with IPFS details
      contract.ipfsPath = result.path;
      contract.ipfsSize = result.size;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats() {
    const [ipfsStats, poaStats] = await Promise.all([
      this.ipfs.getRepoStats(),
      this.poa.getStorageStats()
    ]);
    
    const earnings = await this.poa.getEarnings();
    
    return {
      ipfs: {
        repoSize: ipfsStats.repoSize.toString(),
        numObjects: ipfsStats.numObjects,
        storageMax: ipfsStats.storageMax.toString()
      },
      poa: poaStats,
      earnings: earnings,
      contracts: {
        total: this.storageContracts.size,
        active: Array.from(this.storageContracts.values()).filter(c => 
          c.created + c.duration > Date.now()
        ).length
      }
    };
  }

  /**
   * Load existing storage contracts
   */
  async loadStorageContracts() {
    try {
      const contracts = await this.poa.getContracts();
      for (const contract of contracts) {
        this.storageContracts.set(contract.cid, contract);
      }
      console.log(`Loaded ${contracts.length} storage contracts`);
    } catch (error) {
      console.error('Failed to load contracts:', error);
    }
  }

  /**
   * Get reward history
   */
  async getRewardHistory(days = 30) {
    // This would query the SPK network for historical rewards
    // For now, return mock data
    const history = [];
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    for (let i = 0; i < days; i++) {
      history.push({
        date: new Date(now - (i * dayMs)).toISOString().split('T')[0],
        validations: Math.floor(Math.random() * 100),
        earnings: Math.random() * 10,
        filesStored: this.storageContracts.size
      });
    }
    
    return history;
  }

  /**
   * Optimize storage by removing unprofitable files
   */
  async optimizeStorage() {
    const contracts = Array.from(this.storageContracts.values());
    const unprofitable = [];
    
    for (const contract of contracts) {
      // Check if contract is expired
      if (contract.created + contract.duration < Date.now()) {
        unprofitable.push(contract);
        continue;
      }
      
      // Check if file is earning rewards
      const reward = this.estimateReplicationReward(contract);
      if (reward < 0.01) { // Minimum threshold
        unprofitable.push(contract);
      }
    }
    
    // Unpin unprofitable files
    for (const contract of unprofitable) {
      try {
        await this.ipfs.unpinFile(contract.cid);
        this.storageContracts.delete(contract.cid);
        console.log(`Removed unprofitable file: ${contract.cid}`);
      } catch (error) {
        console.error(`Failed to unpin ${contract.cid}:`, error);
      }
    }
    
    // Run garbage collection
    await this.ipfs.runGarbageCollection();
    
    this.emit('storage-optimized', { removed: unprofitable.length });
    return { removed: unprofitable.length };
  }

  /**
   * Monitor bandwidth usage
   */
  async getBandwidthStats() {
    const stats = await this.ipfs.getBandwidthStats();
    return {
      ...stats,
      estimatedCost: this.estimateBandwidthCost(stats)
    };
  }

  /**
   * Estimate bandwidth costs in BROCA
   */
  estimateBandwidthCost(stats) {
    // Simplified calculation
    const bytesPerBroca = 1024 * 1024 * 100; // 100MB per BROCA
    const totalBytes = BigInt(stats.totalIn) + BigInt(stats.totalOut);
    const brocaCost = Number(totalBytes) / bytesPerBroca;
    return Math.ceil(brocaCost);
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    // Clear replication queue
    this.replicationQueue = [];
    
    // Save current state
    await this.saveState();
    
    this.emit('shutdown');
  }

  /**
   * Save current state to disk
   */
  async saveState() {
    const state = {
      contracts: Array.from(this.storageContracts.entries()),
      stats: await this.getStorageStats()
    };
    
    const statePath = path.join(
      process.env.HOME || process.env.USERPROFILE,
      '.oratr',
      'storage-state.json'
    );
    
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  }
}

module.exports = IntegratedStorageService;