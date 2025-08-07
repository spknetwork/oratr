const FileSyncService = require('./file-sync-service');
const StorageNodeTab = require('../../renderer/components/storage-node-tab');

/**
 * Storage Node Integration
 * Coordinates between POA Storage Node, File Sync Service, and UI components
 */
class StorageNodeIntegration {
  constructor(config = {}) {
    this.config = {
      spkApiUrl: config.spkApiUrl || 'https://spktest.dlux.io',
      autoStartSync: config.autoStartSync !== false,
      ...config
    };
    
    this.poaStorageNode = config.poaStorageNode;
    this.ipfsManager = config.ipfsManager;
    this.fileSyncService = null;
    this.storageNodeTab = null;
    
    if (!this.poaStorageNode) {
      throw new Error('POA Storage Node is required');
    }
    
    if (!this.ipfsManager) {
      throw new Error('IPFS Manager is required');
    }
    
    this.setupIntegration();
  }

  /**
   * Setup integration between components
   */
  setupIntegration() {
    // Create File Sync Service
    this.fileSyncService = new FileSyncService({
      spkApiUrl: this.config.spkApiUrl,
      ipfsManager: this.ipfsManager,
      storageNode: this.poaStorageNode,
      autoStart: this.config.autoStartSync,
      syncInterval: 60 * 1000, // 1 minute (reduced from 5 minutes to avoid connection overload)
      maxRetries: 3
    });
    
    // Setup event forwarding from POA Storage Node
    this.setupPOAEventForwarding();
    
    // Setup File Sync Service event handling
    this.setupFileSyncEventHandling();
  }

  /**
   * Setup event forwarding from POA Storage Node
   */
  setupPOAEventForwarding() {
    // Forward important POA events to file sync service
    this.poaStorageNode.on('started', () => {
      this.fileSyncService.emit('poa-started');
    });
    
    this.poaStorageNode.on('stopped', () => {
      this.fileSyncService.emit('poa-stopped');
    });
    
    // Handle contract events from POA
    this.poaStorageNode.on('contract-registered', (event) => {
      // When POA registers a contract, trigger sync
      if (this.fileSyncService.isRunning()) {
        this.fileSyncService.performSync().catch(err => {
          console.error('Failed to sync after contract registration:', err);
        });
      }
    });
    
    // Handle validation events
    this.poaStorageNode.on('validation', (event) => {
      // Validation events might indicate new files to store
      if (event.type === 'validation_request' && this.fileSyncService.isRunning()) {
        // Delay sync a bit to let validation complete
        setTimeout(() => {
          this.fileSyncService.performSync().catch(err => {
            console.error('Failed to sync after validation:', err);
          });
        }, 2000);
      }
    });
  }

  /**
   * Setup File Sync Service event handling
   */
  setupFileSyncEventHandling() {
    // Log file sync events to POA logs
    this.fileSyncService.on('file-pinned', (event) => {
      this.poaStorageNode.emit('log', {
        level: 'info',
        message: `File sync: Pinned CID ${event.cid} for contract ${event.contractId}`
      });
    });
    
    this.fileSyncService.on('file-unpinned', (event) => {
      this.poaStorageNode.emit('log', {
        level: 'info',
        message: `File sync: Unpinned expired CID ${event.cid}`
      });
    });
    
    this.fileSyncService.on('sync-complete', (result) => {
      this.poaStorageNode.emit('log', {
        level: 'info',
        message: `File sync: Complete - ${result.contracts} contracts, ${result.newPins} new pins, ${result.removedPins} removed`
      });
    });
    
    this.fileSyncService.on('error', (error) => {
      this.poaStorageNode.emit('log', {
        level: 'error',
        message: `File sync error: ${error.message}`
      });
    });
  }

  /**
   * Create Storage Node Tab UI
   */
  createStorageNodeTab(container) {
    if (this.storageNodeTab) {
      this.storageNodeTab.destroy();
    }
    
    this.storageNodeTab = new StorageNodeTab({
      container,
      fileSyncService: this.fileSyncService,
      storageNode: this.poaStorageNode,
      spkApiUrl: this.config.spkApiUrl
    });
    
    return this.storageNodeTab;
  }

  /**
   * Start all services
   */
  async start() {
    try {
      // Start IPFS if not running
      if (!this.ipfsManager.running) {
        await this.ipfsManager.start();
      }
      
      // Start POA Storage Node if not running
      if (!this.poaStorageNode.running) {
        await this.poaStorageNode.start();
      }
      
      // File sync service will auto-start if configured
      if (!this.fileSyncService.isRunning() && this.config.autoStartSync) {
        await this.fileSyncService.start();
      }
      
      return true;
    } catch (error) {
      console.error('Failed to start storage node integration:', error);
      throw error;
    }
  }

  /**
   * Stop all services
   */
  async stop() {
    try {
      // Stop file sync service first
      if (this.fileSyncService.isRunning()) {
        await this.fileSyncService.stop();
      }
      
      // Stop POA Storage Node
      if (this.poaStorageNode.running) {
        await this.poaStorageNode.stop();
      }
      
      // Note: We don't stop IPFS as it might be used by other services
      
      return true;
    } catch (error) {
      console.error('Failed to stop storage node integration:', error);
      throw error;
    }
  }

  /**
   * Get overall status
   */
  getStatus() {
    return {
      poaStorageNode: {
        running: this.poaStorageNode.running,
        account: this.poaStorageNode.config.account,
        stats: this.poaStorageNode.stats
      },
      fileSyncService: this.fileSyncService.getStatus(),
      ipfsManager: {
        running: this.ipfsManager.running,
        nodeId: this.ipfsManager.nodeInfo?.id || null
      }
    };
  }

  /**
   * Get file sync statistics
   */
  getSyncStats() {
    return this.fileSyncService.getStats();
  }

  /**
   * Force immediate sync
   */
  async forceSync() {
    if (!this.fileSyncService.isRunning()) {
      throw new Error('File sync service is not running');
    }
    
    return this.fileSyncService.performSync();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    
    // Update file sync service config
    if (this.fileSyncService) {
      this.fileSyncService.updateConfig({
        spkApiUrl: this.config.spkApiUrl
      });
    }
    
    // Update storage node tab config
    if (this.storageNodeTab) {
      this.storageNodeTab.config.spkApiUrl = this.config.spkApiUrl;
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    if (this.storageNodeTab) {
      this.storageNodeTab.destroy();
    }
    
    if (this.fileSyncService) {
      this.fileSyncService.removeAllListeners();
    }
    
    // Remove POA event listeners we added
    this.poaStorageNode.removeAllListeners('started');
    this.poaStorageNode.removeAllListeners('stopped');
    this.poaStorageNode.removeAllListeners('contract-registered');
    this.poaStorageNode.removeAllListeners('validation');
  }
}

module.exports = StorageNodeIntegration;