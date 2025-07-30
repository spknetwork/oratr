const IPFSManager = require('../core/ipfs/ipfs-manager');
const POAStorageNode = require('../core/storage/poa-storage-node');
const IntegratedStorageService = require('../core/services/integrated-storage-service');
const VideoUploadService = require('../core/services/video-upload-service');
const { ipcMain } = require('electron');

/**
 * Setup integrated storage system for SPK Desktop
 * This enables users to earn rewards by running IPFS + PoA nodes
 */
class StorageSetup {
  constructor(spkClient) {
    this.spkClient = spkClient;
    this.ipfsManager = null;
    this.poaNode = null;
    this.integratedStorage = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the storage system
   */
  async initialize(config = {}) {
    console.log('Initializing SPK Storage System...');
    
    try {
      // 1. Initialize IPFS Manager
      this.ipfsManager = new IPFSManager({
        dataPath: config.ipfsDataPath,
        port: config.ipfsPort || 5001,
        externalNode: config.useExternalIpfs || false
      });
      
      // Start IPFS
      await this.ipfsManager.start();
      console.log('IPFS started:', this.ipfsManager.nodeInfo.id);
      
      // 2. Initialize PoA Storage Node
      const activeAccount = this.spkClient.getActiveAccount();
      if (!activeAccount) {
        throw new Error('No active SPK account');
      }
      
      this.poaNode = new POAStorageNode({
        account: activeAccount.username,
        dataPath: config.poaDataPath,
        binaryPath: config.poaBinaryPath,
        nodeType: 2, // Storage node
        ipfsPort: this.ipfsManager.config.port,
        ipfsHost: this.ipfsManager.config.host,
        maxStorage: config.maxStorage || 100 * 1024 * 1024 * 1024 // 100GB
      });
      
      // Check if PoA binary exists
      const binaryExists = await this.poaNode.checkBinary();
      if (!binaryExists) {
        console.log('PoA binary not found, installing...');
        await this.poaNode.installPOA();
      }
      
      // Start PoA node
      await this.poaNode.start();
      console.log('PoA node started');
      
      // 3. Initialize Integrated Storage Service
      this.integratedStorage = new IntegratedStorageService({
        ipfsManager: this.ipfsManager,
        poaStorageNode: this.poaNode,
        spkClient: this.spkClient,
        videoUploadService: null // Will be set later
      });
      
      await this.integratedStorage.init();
      console.log('Integrated storage service initialized');
      
      // 4. Setup IPC handlers for renderer process
      this.setupIPCHandlers();
      
      // 5. Setup event monitoring
      this.setupEventMonitoring();
      
      this.isInitialized = true;
      console.log('Storage system fully initialized');
      
      return {
        ipfsId: this.ipfsManager.nodeInfo.id,
        poaStatus: this.poaNode.getStatus(),
        storageStats: await this.integratedStorage.getStorageStats()
      };
      
    } catch (error) {
      console.error('Failed to initialize storage system:', error);
      throw error;
    }
  }

  /**
   * Setup IPC handlers for communication with renderer
   */
  setupIPCHandlers() {
    // Storage stats
    ipcMain.handle('storage:get-stats', async () => {
      return await this.integratedStorage.getStorageStats();
    });
    
    // Earnings info
    ipcMain.handle('storage:get-earnings', async () => {
      return await this.poaNode.getEarnings();
    });
    
    // Reward history
    ipcMain.handle('storage:get-reward-history', async (event, days) => {
      return await this.integratedStorage.getRewardHistory(days);
    });
    
    // Direct upload
    ipcMain.handle('storage:direct-upload', async (event, files, options) => {
      return await this.integratedStorage.directUploadWithStorage(files, options);
    });
    
    // Optimize storage
    ipcMain.handle('storage:optimize', async () => {
      return await this.integratedStorage.optimizeStorage();
    });
    
    // Get bandwidth stats
    ipcMain.handle('storage:get-bandwidth', async () => {
      return await this.integratedStorage.getBandwidthStats();
    });
    
    // Update configuration
    ipcMain.handle('storage:update-config', async (event, config) => {
      return await this.updateConfiguration(config);
    });
    
    // Get status
    ipcMain.handle('storage:get-status', async () => {
      return this.getStatus();
    });
  }

  /**
   * Setup event monitoring and forwarding
   */
  setupEventMonitoring() {
    // Forward IPFS events
    this.ipfsManager.on('peer-count', (count) => {
      this.sendToRenderer('storage:peer-count', count);
    });
    
    // Forward PoA events
    this.poaNode.on('validation', (data) => {
      this.sendToRenderer('storage:validation', data);
    });
    
    this.poaNode.on('earnings-update', (data) => {
      this.sendToRenderer('storage:earnings-update', data);
    });
    
    // Forward integrated storage events
    this.integratedStorage.on('file-replicated', (contract) => {
      this.sendToRenderer('storage:file-replicated', contract);
    });
    
    this.integratedStorage.on('direct-upload-complete', (result) => {
      this.sendToRenderer('storage:upload-complete', result);
    });
    
    this.integratedStorage.on('storage-optimized', (result) => {
      this.sendToRenderer('storage:optimized', result);
    });
  }

  /**
   * Send event to renderer process
   */
  sendToRenderer(channel, data) {
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      window.webContents.send(channel, data);
    });
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      ipfs: {
        running: this.ipfsManager?.running || false,
        nodeId: this.ipfsManager?.nodeInfo?.id || null
      },
      poa: this.poaNode?.getStatus() || { running: false },
      account: this.spkClient.getActiveAccount()?.username || null
    };
  }

  /**
   * Update configuration
   */
  async updateConfiguration(newConfig) {
    if (newConfig.ipfs) {
      await this.ipfsManager.updateConfig(newConfig.ipfs);
    }
    
    if (newConfig.poa) {
      await this.poaNode.updateConfig(newConfig.poa);
    }
    
    return this.getStatus();
  }

  /**
   * Create video upload service with integrated storage
   */
  createVideoUploadService(transcoder, playlistProcessor) {
    const videoUploadService = new VideoUploadService({
      transcoder,
      playlistProcessor,
      ipfsManager: this.ipfsManager,
      spkClient: this.spkClient,
      integratedStorage: this.integratedStorage
    });
    
    // Update integrated storage with video upload service
    this.integratedStorage.videoUpload = videoUploadService;
    
    return videoUploadService;
  }

  /**
   * Register as SPK storage provider
   */
  async registerAsStorageProvider(price = 2000) {
    if (!this.isInitialized) {
      throw new Error('Storage system not initialized');
    }
    
    const ipfsId = this.ipfsManager.nodeInfo.id;
    const domain = require('os').hostname();
    
    return await this.spkClient.registerStorageNode(ipfsId, domain, price);
  }

  /**
   * Start earning rewards
   */
  async startEarning() {
    // Ensure we're registered as a storage provider
    const registration = await this.registerAsStorageProvider();
    
    // Start accepting storage contracts
    this.integratedStorage.on('replication-queued', (contract) => {
      console.log(`New replication opportunity: ${contract.cid}`);
    });
    
    return {
      registration,
      status: 'earning',
      nodeId: this.ipfsManager.nodeInfo.id
    };
  }

  /**
   * Shutdown storage system
   */
  async shutdown() {
    console.log('Shutting down storage system...');
    
    if (this.integratedStorage) {
      await this.integratedStorage.shutdown();
    }
    
    if (this.poaNode && this.poaNode.running) {
      await this.poaNode.stop();
    }
    
    if (this.ipfsManager && this.ipfsManager.running) {
      await this.ipfsManager.stop();
    }
    
    this.isInitialized = false;
    console.log('Storage system shutdown complete');
  }
}

module.exports = StorageSetup;