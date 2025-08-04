const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Core modules
const Transcoder = require('../core/ffmpeg/transcoder');
const PlaylistProcessor = require('../core/ffmpeg/playlist-processor');
const IPFSManager = require('../core/ipfs/ipfs-manager');
const POAStorageNode = require('../core/storage/poa-storage-node');
const StorageNodeManager = require('../core/storage/storage-node-manager');
const ContractMonitor = require('../core/storage/contract-monitor');
const VideoUploadService = require('../core/services/video-upload-service');
const DirectUploadService = require('../core/services/direct-upload-service');
const IntegratedStorageService = require('../core/services/integrated-storage-service');
const SettingsManager = require('../core/settings/settings-manager');
const PendingUploadsManager = require('../core/services/pending-uploads-manager');

// SPK modules
const SPKClientWrapper = require('../core/spk/spk-client-wrapper');

let mainWindow;
let services = {};

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
      // Enable remote debugging for MCP access
    },
    icon: path.join(__dirname, '../renderer/assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Initialize services
 */
async function initializeServices() {
  // Initialize settings manager first
  services.settingsManager = new SettingsManager();
  await services.settingsManager.init();

  // Initialize SPK client wrapper with settings
  services.spkClient = new SPKClientWrapper();
  services.spkClient.mainWindow = mainWindow; // Set reference for IPC
  
  // Configure SPK client with settings
  const networkSettings = services.settingsManager.getNetworkSettings();
  services.spkClient.config = {
    spkNode: networkSettings.spkNode,
    isTestnet: networkSettings.isTestnet
  };
  
  await services.spkClient.initialize();

  // Initialize core services
  services.transcoder = new Transcoder();
  services.playlistProcessor = new PlaylistProcessor();
  services.ipfsManager = new IPFSManager();
  services.storageNode = new POAStorageNode();
  services.storageNodeManager = new StorageNodeManager(services.spkClient, {
    node: networkSettings.spkNode,
    honeygraphUrl: networkSettings.honeygraphUrl
  });
  services.contractMonitor = new ContractMonitor({
    ipfsManager: services.ipfsManager,
    storageNode: services.storageNode
  });
  
  // Initialize pending uploads manager
  services.pendingUploadsManager = new PendingUploadsManager();
  await services.pendingUploadsManager.init();
  
  // Initialize direct upload service
  services.directUploadService = new DirectUploadService({
    ipfsManager: services.ipfsManager,
    spkClient: services.spkClient,
    pendingUploadsManager: services.pendingUploadsManager
  });
  
  // Initialize integrated storage service
  services.integratedStorage = new IntegratedStorageService({
    ipfsManager: services.ipfsManager,
    poaStorageNode: services.storageNode,
    spkClient: services.spkClient,
    videoUploadService: null // Will be set later
  });
  
  // Initialize upload service with all dependencies
  services.videoUploadService = new VideoUploadService({
    transcoder: services.transcoder,
    playlistProcessor: services.playlistProcessor,
    ipfsManager: services.ipfsManager,
    spkClient: services.spkClient,
    integratedStorage: services.integratedStorage,
    directUploadService: services.directUploadService
  });
  
  // Set circular reference
  services.integratedStorage.videoUploadService = services.videoUploadService;

  // Setup service event handlers
  setupServiceHandlers();
  
  // Check for pending uploads on startup (after a delay for full initialization)
  setTimeout(async () => {
    await checkPendingUploadsOnStartup();
  }, 5000);
}

/**
 * Check pending uploads on startup and verify CIDs exist in IPFS
 */
async function checkPendingUploadsOnStartup() {
  try {
    console.log('🔍 [Startup] Checking for pending uploads...');
    
    const pendingUploads = await services.pendingUploadsManager.getPendingUploads();
    const uploadingUploads = pendingUploads.filter(upload => upload.status === 'uploading');
    
    if (uploadingUploads.length === 0) {
      console.log('✅ [Startup] No pending uploads found');
      return;
    }
    
    console.log(`📋 [Startup] Found ${uploadingUploads.length} pending uploads to verify`);
    
    for (const upload of uploadingUploads) {
      try {
        console.log(`🔍 [Startup] Checking upload: ${upload.id}`);
        
        if (!upload.cids || upload.cids.length === 0) {
          console.log(`⚠️ [Startup] Upload ${upload.id} has no CIDs, marking as failed`);
          await services.pendingUploadsManager.updateUploadStatus(upload.id, 'failed', {
            error: 'No CIDs found for upload',
            failedAt: new Date().toISOString()
          });
          continue;
        }
        
        // Check if all CIDs exist in our IPFS node
        let missingCIDs = 0;
        let existingCIDs = 0;
        
        for (const cid of upload.cids) {
          try {
            // Check if CID exists in our IPFS node by trying to get it
            await services.ipfsManager.getFile(cid);
            existingCIDs++;
            console.log(`✅ [Startup] Found CID in IPFS: ${cid}`);
          } catch (error) {
            missingCIDs++;
            console.log(`❌ [Startup] Missing CID in IPFS: ${cid} - ${error.message}`);
          }
        }
        
        console.log(`📊 [Startup] Upload ${upload.id}: ${existingCIDs} existing, ${missingCIDs} missing CIDs`);
        
        if (missingCIDs > 0) {
          // Some files are missing from IPFS - mark as failed
          await services.pendingUploadsManager.updateUploadStatus(upload.id, 'failed', {
            error: `Missing ${missingCIDs} files from IPFS node`,
            failedAt: new Date().toISOString()
          });
          console.log(`❌ [Startup] Upload ${upload.id} marked as failed - missing files`);
        } else {
          // All files exist in IPFS - we can continue the upload
          console.log(`✅ [Startup] Upload ${upload.id} has all files in IPFS - can be resumed`);
          console.log(`💡 [Startup] User can retry upload ${upload.id} from pending uploads UI`);
          
          // Update with note that files are ready
          await services.pendingUploadsManager.updateUploadStatus(upload.id, 'ready_to_retry', {
            note: 'All files exist in IPFS, ready to retry broadcast',
            checkedAt: new Date().toISOString()
          });
        }
        
      } catch (error) {
        console.error(`❌ [Startup] Error checking upload ${upload.id}:`, error);
        await services.pendingUploadsManager.updateUploadStatus(upload.id, 'failed', {
          error: `Startup check failed: ${error.message}`,
          failedAt: new Date().toISOString()
        });
      }
    }
    
    console.log('✅ [Startup] Pending uploads check completed');
    
  } catch (error) {
    console.error('❌ [Startup] Failed to check pending uploads:', error);
  }
}

/**
 * Setup service event handlers
 */
function setupServiceHandlers() {
  // POA Storage Node events
  services.storageNode.on('log', (log) => {
    if (mainWindow) {
      mainWindow.webContents.send('storage:log', log);
    }
  });

  services.storageNode.on('validation', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('storage:validation', data);
    }
  });

  services.storageNode.on('contract-registered', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('storage:contract', data);
    }
  });

  services.storageNode.on('update-available', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('storage:update-available', data);
    }
  });

  // Contract monitor events
  services.contractMonitor.on('log', (log) => {
    if (mainWindow) {
      mainWindow.webContents.send('contracts:log', log);
    }
  });

  services.contractMonitor.on('cid-pinned', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('contracts:cid-pinned', data);
    }
  });

  services.contractMonitor.on('cid-unpinned', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('contracts:cid-unpinned', data);
    }
  });

  services.contractMonitor.on('check-complete', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('contracts:check-complete', data);
    }
  });

  // Video upload progress
  services.videoUploadService.on('progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('upload:progress', progress);
    }
  });
}

/**
 * Setup IPC handlers
 */
function setupIPCHandlers() {
  // PIN management
  ipcMain.handle('auth:hasPinSetup', async () => {
    return services.spkClient.accountManager.hasPinSetup();
  });

  ipcMain.handle('auth:setupPin', async (event, pin) => {
    try {
      await services.spkClient.setupPin(pin);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auth:unlock', async (event, pin) => {
    try {
      await services.spkClient.unlock(pin);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auth:lock', async () => {
    services.spkClient.lock();
    return { success: true };
  });

  ipcMain.handle('auth:resetAll', async () => {
    try {
      // Clear all account data
      const Store = require('electron-store');
      const store = new Store({ name: 'spk-accounts-v2' });
      store.clear();
      
      // Reset the in-memory state
      services.spkClient.accountManager.lock();
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Account management
  ipcMain.handle('account:add', async (event, username, keys) => {
    try {
      const account = await services.spkClient.addAccount(username, keys);
      return { success: true, account };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:importFromMaster', async (event, username, masterPassword) => {
    try {
      const account = await services.spkClient.importAccountFromMaster(username, masterPassword);
      return { success: true, account };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:remove', async (event, username) => {
    try {
      await services.spkClient.removeAccount(username);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:setActive', async (event, username) => {
    try {
      const account = await services.spkClient.setActiveAccount(username);
      return { success: true, account };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:list', async () => {
    return services.spkClient.listAccounts();
  });

  ipcMain.handle('account:getActive', async () => {
    const activeAccount = services.spkClient.getActiveAccount();
    if (activeAccount) {
      return { success: true, username: activeAccount.username, ...activeAccount };
    }
    return null;
  });

  ipcMain.handle('account:export', async (event, username, exportPin) => {
    try {
      const exportData = await services.spkClient.exportAccount(username, exportPin);
      return { success: true, exportData };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:import', async (event, exportData, importPin) => {
    try {
      const usernames = await services.spkClient.importAccount(exportData, importPin);
      return { success: true, usernames };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Balance operations
  ipcMain.handle('balance:get', async (event, refresh = false) => {
    try {
      const balances = await services.spkClient.getBalances(refresh);
      return { success: true, balances };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Token operations
  ipcMain.handle('token:transfer', async (event, to, amount, token, memo, options) => {
    try {
      const result = await services.spkClient.transfer(to, amount, token, memo, options);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('token:powerUp', async (event, amount, options) => {
    try {
      const result = await services.spkClient.powerUp(amount, options);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('token:powerDown', async (event, amount, options) => {
    try {
      const result = await services.spkClient.powerDown(amount, options);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Video operations
  ipcMain.handle('video:analyze', async (event, videoPath) => {
    return services.transcoder.analyzeVideo(videoPath);
  });

  ipcMain.handle('video:upload', async (event, videoPath, options = {}) => {
    try {
      // Ensure direct upload is used by default
      const uploadOptions = {
        uploadMethod: 'direct',
        ...options
      };
      
      console.log(`🎬 [VideoUpload] Starting video upload: ${videoPath}`);
      console.log(`⚙️ [VideoUpload] Options:`, uploadOptions);
      
      const result = await services.videoUploadService.uploadVideo(videoPath, uploadOptions);
      return { success: true, result };
    } catch (error) {
      console.error(`❌ [VideoUpload] Upload failed:`, error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('video:cancelUpload', async () => {
    services.videoUploadService.cancel();
    return { success: true };
  });

  // Native FFmpeg operations
  ipcMain.handle('ffmpeg:getVersion', async () => {
    try {
      const version = await services.transcoder.getFFmpegVersion();
      return { success: true, version };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ffmpeg:createTempDir', async () => {
    try {
      const tempDir = await services.transcoder.createTempDirectory();
      return { success: true, tempDir };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ffmpeg:saveVideoFile', async (event, videoFile, tempDir) => {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      // Get file extension
      const ext = path.extname(videoFile.name) || '.mp4';
      const inputPath = path.join(tempDir, `input${ext}`);
      
      // Write file data to temporary location
      await fs.writeFile(inputPath, Buffer.from(videoFile.data));
      
      return { success: true, inputPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ffmpeg:generateThumbnail', async (event, inputPath, tempDir) => {
    try {
      const path = require('path');
      const thumbnailPath = path.join(tempDir, 'thumbnail.jpg');
      
      const result = await services.transcoder.generateThumbnail(inputPath);
      
      // Write thumbnail to temp directory
      const fs = require('fs').promises;
      await fs.writeFile(thumbnailPath, result.buffer);
      
      return { success: true, thumbnailPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ffmpeg:generateThumbnailFromSegment', async (event, segmentPath, tempDir, name) => {
    try {
      const path = require('path');
      const thumbnailPath = path.join(tempDir, `${name}.jpg`);
      
      // Generate thumbnail from first frame of segment
      const result = await services.transcoder.generateThumbnail(segmentPath, 0);
      
      // Write thumbnail to temp directory
      const fs = require('fs').promises;
      await fs.writeFile(thumbnailPath, result.buffer);
      
      return { success: true, thumbnailPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ffmpeg:transcodeToHLS', async (event, inputPath, tempDir, resolution, options = {}) => {
    try {
      const path = require('path');
      const outputDir = path.join(tempDir, `${resolution}p`);
      
      // Set up progress callback
      const progressHandler = (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('ffmpeg:progress', progress);
        }
      };
      
      services.transcoder.on('progress', progressHandler);
      
      try {
        const result = await services.transcoder.transcodeToHLS(inputPath, outputDir, `${resolution}p`);
        
        // Return segment paths
        const segments = result.segments.map(seg => seg.path);
        
        return { 
          success: true, 
          playlistPath: result.playlistPath,
          segments 
        };
      } finally {
        services.transcoder.off('progress', progressHandler);
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ffmpeg:readFile', async (event, filePath) => {
    try {
      const fs = require('fs').promises;
      const buffer = await fs.readFile(filePath);
      return { success: true, data: Array.from(buffer) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ffmpeg:saveFile', async (event, fileData) => {
    try {
      const fs = require('fs').promises;
      const { path, data } = fileData;
      const buffer = Buffer.from(data);
      await fs.writeFile(path, buffer);
      return { success: true, path };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ffmpeg:cleanupTempDir', async (event, tempDir) => {
    try {
      const fs = require('fs').promises;
      await fs.rmdir(tempDir, { recursive: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // IPFS operations
  ipcMain.handle('ipfs:start', async () => {
    await services.ipfsManager.start();
    return { success: true };
  });

  ipcMain.handle('ipfs:stop', async () => {
    await services.ipfsManager.stop();
    return { success: true };
  });

  ipcMain.handle('ipfs:getNodeInfo', async () => {
    return services.ipfsManager.getNodeInfo();
  });

  ipcMain.handle('ipfs:getPeers', async () => {
    return services.ipfsManager.getConnectedPeers();
  });

  ipcMain.handle('ipfs:getConfig', async () => {
    return services.ipfsManager.getConfig();
  });

  ipcMain.handle('ipfs:updateConfig', async (event, config) => {
    try {
      await services.ipfsManager.updateConfig(config);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ipfs:getRepoStats', async () => {
    return services.ipfsManager.getRepoStats();
  });

  ipcMain.handle('ipfs:runGC', async () => {
    return services.ipfsManager.runGarbageCollection();
  });

  ipcMain.handle('ipfs:getBandwidth', async () => {
    return services.ipfsManager.getBandwidthStats();
  });

  ipcMain.handle('ipfs:testConnection', async (event, host, port) => {
    try {
      const result = await services.ipfsManager.testConnection(host, port);
      return { success: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ipfs:checkPubSub', async () => {
    try {
      const enabled = await services.ipfsManager.checkPubSubEnabled();
      return { success: true, enabled };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ipfs:enablePubSub', async () => {
    try {
      const result = await services.ipfsManager.enablePubSub();
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ipfs:addFile', async (event, fileData) => {
    try {
      const buffer = Buffer.from(fileData.data);
      const result = await services.ipfsManager.addFile(buffer, {
        path: fileData.name
      });
      return { success: true, cid: result.cid.toString() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Calculate IPFS CID without adding to IPFS
  ipcMain.handle('ipfs:calculateCid', async (event, fileData) => {
    try {
      const ipfsOnlyHash = require('ipfs-only-hash');
      const buffer = Buffer.from(fileData.data);
      const cid = await ipfsOnlyHash.of(buffer);
      return { success: true, cid };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Storage node operations
  ipcMain.handle('storage:start', async () => {
    console.log('[DEBUG] storage:start called');
    try {
      // Get active account for POA
      const activeUsername = await services.spkClient.getActiveAccount();
      console.log('[DEBUG] Storage start - active account username:', activeUsername);
      if (!activeUsername) {
        return { success: false, error: 'No active account' };
      }
      
      const account = { username: activeUsername };
      console.log('Storage start - using account:', account);
      
      // NOTE: Storage node and contract monitor only need the username,
      // not wallet access. They will continue running even if wallet locks.
      
      // Get IPFS configuration
      const ipfsConfig = await services.ipfsManager.getConfig();
      
      // Check if IPFS is external and not localhost
      if (ipfsConfig.host && ipfsConfig.host !== '127.0.0.1' && ipfsConfig.host !== 'localhost') {
        return { 
          success: false, 
          error: 'POA only supports local IPFS nodes. Please switch to internal IPFS mode or connect to a local IPFS instance.' 
        };
      }
      
      // Configure POA with account and IPFS settings
      services.storageNode.config.account = account.username;
      services.storageNode.config.spkApiUrl = services.spkClient.config?.spkNode || 'https://spktest.dlux.io';
      services.storageNode.config.ipfsPort = ipfsConfig.port || 5001;
      services.storageNode.config.ipfsHost = ipfsConfig.host || '127.0.0.1';
      
      await services.storageNode.start();
      
      // Start contract monitoring when storage node starts
      try {
        services.contractMonitor.config.username = account.username;
        services.contractMonitor.config.spkApiUrl = services.spkClient.config?.spkNode || 'https://spktest.dlux.io';
        await services.contractMonitor.start();
      } catch (monitorError) {
        console.error('Failed to start contract monitor:', monitorError);
        // Don't fail storage start if monitor fails
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('storage:stop', async () => {
    // NOTE: This is user-initiated stop, not wallet timeout
    await services.storageNode.stop();
    
    // Stop contract monitoring when storage node stops
    services.contractMonitor.stop();
    
    return { success: true };
  });

  ipcMain.handle('storage:getStats', async () => {
    return services.storageNode.getStorageStats();
  });

  ipcMain.handle('storage:getEarnings', async () => {
    return services.storageNode.getEarnings();
  });

  ipcMain.handle('storage:checkBinary', async () => {
    return services.storageNode.checkBinary();
  });

  ipcMain.handle('storage:installPOA', async () => {
    try {
      await services.storageNode.installPOA();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('storage:updateConfig', async (event, config) => {
    try {
      await services.storageNode.updateConfig(config);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('storage:getStatus', async () => {
    console.log('[DEBUG] storage:getStatus called');
    // Always check the actual storage node status first
    const actualStatus = services.storageNode.getStatus();
    console.log('[DEBUG] Actual storage status:', actualStatus);
    
    // If actually running, return that
    if (actualStatus && actualStatus.running) {
      console.log('[DEBUG] Storage node is actually running, returning actual status');
      return actualStatus;
    }
    
    // If not running, but we have fast status indicating it should be, 
    // this means we need to actually start it
    console.log('[DEBUG] Checking if storage node manager exists and has getFastStatus');
    if (services.storageNodeManager && services.storageNodeManager.getFastStatus) {
      try {
        console.log('[DEBUG] Getting fast status...');
        const fastStatus = await services.storageNodeManager.getFastStatus();
        console.log('[DEBUG] Fast status result:', fastStatus);
        if (fastStatus.quickCheck && fastStatus.registered && fastStatus.ipfsRunning) {
          console.log('[DEBUG] Conditions met for shouldAutoStart - returning shouldAutoStart: true');
          // The node should be running but isn't - indicate it's available to start
          return { 
            running: false,
            registered: fastStatus.registered,
            ipfsRunning: fastStatus.ipfsRunning,
            shouldAutoStart: true, // NEW: Indicate this should auto-start
            message: fastStatus.message,
            cached: fastStatus.cached,
            persisted: fastStatus.persisted
          };
        } else {
          console.log('[DEBUG] Fast status conditions not met:', {
            quickCheck: fastStatus.quickCheck,
            registered: fastStatus.registered,
            ipfsRunning: fastStatus.ipfsRunning
          });
        }
      } catch (error) {
        console.error('Fast status check failed:', error);
      }
    } else {
      console.log('[DEBUG] Storage node manager not available or missing getFastStatus');
    }
    
    // Return actual status
    return actualStatus || { running: false, registered: false };
  });

  ipcMain.handle('storage:validateRegistration', async (event, ipfsId, registrationInfo) => {
    return services.storageNode.validateRegistration(ipfsId, registrationInfo);
  });

  ipcMain.handle('storage:getRecentLogs', async (event, lines) => {
    return services.storageNode.getRecentLogs(lines || 100);
  });

  ipcMain.handle('storage:emergencyLogCleanup', async () => {
    try {
      await services.storageNode.emergencyLogCleanup();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('storage:pruneOldLogs', async () => {
    try {
      await services.storageNode.pruneOldLogs();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cost calculations
  ipcMain.handle('broca:calculateStorageCost', async (event, size, days) => {
    // Simple BROCA calculation: 0.001 BROCA per KB per day
    const sizeInKB = size / 1024;
    const cost = sizeInKB * days * 0.001;
    return cost;
  });

  // File operations
  ipcMain.handle('file:list', async (event, filters) => {
    try {
      const files = await services.spkClient.listFiles(filters);
      return { success: true, files };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('contract:list', async () => {
    try {
      const contracts = await services.spkClient.listContracts();
      return { success: true, contracts };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('contract:renew', async (event, contractId, options) => {
    try {
      const result = await services.spkClient.renewContract(contractId, options);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // SPK Network registration
  ipcMain.handle('spk:registerStorage', async (event, ipfsId, domain, price, options) => {
    try {
      const result = await services.spkClient.registerStorageNode(ipfsId, domain, price, options);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:registerValidator', async (event, amount) => {
    try {
      const result = await services.spkClient.registerValidator(amount);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:registerAuthority', async (event, publicKey) => {
    try {
      const result = await services.spkClient.registerAuthority(publicKey);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:checkRegistration', async (event, username) => {
    try {
      // First check if user has an SPK account
      const accountResult = await services.spkClient.checkAccountRegistration(username);
      if (!accountResult.registered) {
        return { success: true, registered: false };
      }
      
      // Then check for registered services using spk-js
      const servicesResult = await services.spkClient.checkUserServices(username);
      if (!servicesResult.success) {
        return { success: false, error: servicesResult.error };
      }
      
      // Check if user has any IPFS service registered
      const ipfsServices = servicesResult.services.IPFS || {};
      const hasIPFSService = Object.keys(ipfsServices).length > 0;
      
      if (hasIPFSService) {
        // Get the first IPFS service registration details
        const ipfsId = Object.keys(ipfsServices)[0];
        const service = ipfsServices[ipfsId];
        
        return {
          success: true,
          registered: true,
          data: {
            ipfsId: service.i || ipfsId,
            api: service.a,
            account: service.b,
            price: service.c,
            domain: service.a ? new URL(service.a).hostname : null
          }
        };
      }
      
      return { success: true, registered: false };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:getNetworkStats', async () => {
    try {
      const stats = await services.spkClient.getNetworkStats();
      return { success: true, stats };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:getStorageProviders', async () => {
    try {
      const data = await services.spkClient.getStorageProviders();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Provider selection is now handled internally by spk-js

  ipcMain.handle('spk:getProviderStats', async (event, providerUrl) => {
    try {
      const stats = await services.spkClient.getProviderStats(providerUrl);
      return { success: true, stats };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:generateKeyPair', async () => {
    try {
      const keyPair = services.spkClient.constructor.generateKeyPair();
      return { success: true, ...keyPair };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:calculateBrocaCost', async (event, sizeInBytes, options) => {
    try {
      const data = await services.spkClient.calculateBrocaCost(sizeInBytes, options);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:getExistingContract', async (event, broker) => {
    try {
      const contract = await services.spkClient.getExistingContract(broker);
      return { success: true, contract };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:createStorageContract', async (event, contractData, options) => {
    try {
      const result = await services.spkClient.createStorageContract(contractData, options);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:upload', async (event, filesData, options) => {
    try {
      // Ensure SPK instance is active
      if (!services.spkClient.spkInstance) {
        throw new Error('No active SPK account. Please login first.');
      }

      // Convert file data back to File-like objects for spk-js
      const files = filesData.map(fileData => {
        const buffer = Buffer.from(fileData.data);
        
        // Create a File-like object with the properties spk-js expects
        const file = new Blob([buffer], { type: fileData.type });
        // Add File-specific properties
        file.name = fileData.name;
        file.lastModified = Date.now();
        file.lastModifiedDate = new Date(file.lastModified);
        
        // Add arrayBuffer method if it doesn't exist
        if (!file.arrayBuffer) {
          file.arrayBuffer = async function() {
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
          };
        }
        
        return file;
      });

      // Call spk-js upload method
      const result = await services.spkClient.spkInstance.upload(files, options);
      
      return { 
        success: true, 
        ...result 
      };
    } catch (error) {
      console.error('Upload error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:uploadFromPaths', async (event, uploadData) => {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      // Ensure we have an active user and SPK instance
      if (!services.spkClient.currentUser) {
        throw new Error('No active SPK account. Please login first.');
      }
      
      if (!services.spkClient.spkInstance) {
        throw new Error('SPK instance not initialized. Please login first.');
      }

      const { filePaths, metaData, duration, tempDir } = uploadData;

      // We need to use File polyfill for Node.js
      const { File } = require('buffer');
      
      // Read files from disk and create proper File objects
      const files = [];
      for (const fileInfo of filePaths) {
        try {
          const fileBuffer = await fs.readFile(fileInfo.path);
          
          // Log file info for debugging
          console.log(`Reading file: ${fileInfo.name} (${fileInfo.type}) from ${fileInfo.path}, size: ${fileBuffer.length}`);
          
          // Create a proper File object using the buffer polyfill
          const file = new File([fileBuffer], fileInfo.name, {
            type: fileInfo.type || 'application/octet-stream'
          });
          
          files.push(file);
        } catch (error) {
          console.error(`Failed to read file ${fileInfo.path}:`, error);
          throw new Error(`Failed to read file ${fileInfo.name}: ${error.message}`);
        }
      }

      console.log(`Prepared ${files.length} File objects for upload`);

      // Use the SPK instance's upload method directly
      const result = await services.spkClient.spkInstance.upload(files, {
        duration: duration || 30,
        metaData: metaData
      });
      
      console.log('Upload result:', result);
      
      return { 
        success: true, 
        ...result 
      };
    } catch (error) {
      console.error('Upload from paths error:', error);
      console.error('Stack trace:', error.stack);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('spk:uploadToPublicNode', async (event, files, contract, options) => {
    try {
      // Since we can't pass File objects through IPC, we'll handle the upload differently
      // We'll use the file data directly
      const result = await services.spkClient.uploadToPublicNodeFromData(files, contract, options);
      
      // Send progress updates to renderer
      if (result.onProgress) {
        result.onProgress((progress) => {
          if (mainWindow) {
            mainWindow.webContents.send('spk:upload-progress', progress);
          }
        });
      }
      
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Signing response handler
  ipcMain.handle('signing:respond', async (event, requestId, approved) => {
    // Call the stored handler
    if (global.signingHandlers && global.signingHandlers[requestId]) {
      const handler = global.signingHandlers[requestId];
      delete global.signingHandlers[requestId]; // Clean up
      handler(approved);
    }
    return { success: true };
  });

  // Contract monitoring handlers
  ipcMain.handle('contracts:start', async () => {
    try {
      const account = await services.spkClient.getActiveAccount();
      if (!account) {
        return { success: false, error: 'No active account' };
      }
      
      // Configure contract monitor
      services.contractMonitor.config.username = account.username;
      services.contractMonitor.config.spkApiUrl = services.spkClient.config.spkNode;
      
      await services.contractMonitor.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('contracts:stop', async () => {
    services.contractMonitor.stop();
    return { success: true };
  });

  ipcMain.handle('contracts:getStatus', async () => {
    return services.contractMonitor.getStatus();
  });

  ipcMain.handle('contracts:getContracts', async () => {
    return services.contractMonitor.getContracts();
  });

  ipcMain.handle('contracts:getPinnedCIDs', async () => {
    return services.contractMonitor.getPinnedCIDs();
  });

  ipcMain.handle('contracts:checkNow', async () => {
    try {
      await services.contractMonitor.checkContracts();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Direct upload handler using DirectUploadService
  ipcMain.handle('upload:batch', async (event, { files, options }) => {
    console.log('=== DIRECT UPLOAD HANDLER CALLED ===');
    console.log('[DirectUpload] Starting direct upload with', files.length, 'files');
    
    try {
      const currentAccount = services.spkClient.getActiveAccount();
      console.log('[DirectUpload] Current account:', currentAccount);
      
      if (!currentAccount) {
        throw new Error('No active account. Please login first.');
      }

      // Get SPK instance and set it in direct upload service
      const spkInstance = await services.spkClient.getSpkInstance(currentAccount);
      await spkInstance.init();
      services.directUploadService.spkClient = spkInstance;
      
      console.log('[DirectUpload] SPK instance set in DirectUploadService');

      // Convert file data to Node.js compatible format
      console.log('[DirectUpload] Converting files to Node.js format...');
      const fileObjects = files.map((f, index) => {
        console.log(`[DirectUpload] Processing file ${index + 1}/${files.length}: ${f.name} (${f.size} bytes, type: ${f.type})`);
        const buffer = Buffer.from(f.buffer);
        return {
          name: f.name,
          size: f.size || buffer.length,
          type: f.type || 'application/octet-stream',
          buffer: buffer
        };
      });
      console.log('[DirectUpload] File conversion complete');

      // Use DirectUploadService for direct upload
      console.log('[DirectUpload] Starting direct upload via DirectUploadService...');
      const uploadResult = await services.directUploadService.directUpload(fileObjects, {
        ...options, // Pass all options through
        duration: options.duration || 30
      });
      
      console.log('[DirectUpload] Upload result:', uploadResult);

      // Find master playlist CID if it exists
      const masterCid = uploadResult.files?.find(f => f.name === 'master.m3u8')?.cid;

      return {
        success: true,
        data: {
          uploadId: uploadResult.uploadId,
          cids: uploadResult.cids,
          files: uploadResult.files,
          masterUrl: masterCid ? `https://ipfs.dlux.io/ipfs/${masterCid}` : null,
          ...uploadResult
        }
      };
    } catch (error) {
      console.error('[DirectUpload] Error:', error);
      console.error('[DirectUpload] Error stack:', error.stack);
      return { success: false, error: error.message };
    }
  });
}

/**
 * Setup service event handlers
 */
function setupServiceHandlers() {
  // Forward SPK client events
  services.spkClient.on('accounts-unlocked', (accounts) => {
    if (mainWindow) {
      mainWindow.webContents.send('spk:accounts-unlocked', accounts);
    }
  });

  services.spkClient.on('accounts-locked', () => {
    if (mainWindow) {
      mainWindow.webContents.send('spk:accounts-locked');
    }
  });

  services.spkClient.on('session-expired', () => {
    if (mainWindow) {
      mainWindow.webContents.send('spk:session-expired');
    }
  });

  services.spkClient.on('active-account-changed', (username) => {
    if (mainWindow) {
      mainWindow.webContents.send('spk:active-account-changed', username);
    }
  });
  // Forward upload progress to renderer
  services.videoUploadService.on('progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('upload:progress', progress);
    }
  });

  services.videoUploadService.on('error', (error) => {
    if (mainWindow) {
      mainWindow.webContents.send('upload:error', error);
    }
  });

  // Forward IPFS events
  services.ipfsManager.on('peer:connect', (peer) => {
    if (mainWindow) {
      mainWindow.webContents.send('ipfs:peer:connect', peer);
    }
  });

  services.ipfsManager.on('peer:disconnect', (peer) => {
    if (mainWindow) {
      mainWindow.webContents.send('ipfs:peer:disconnect', peer);
    }
  });

  // Forward storage node events
  services.storageNode.on('validation', (validation) => {
    if (mainWindow) {
      mainWindow.webContents.send('storage:validation', validation);
    }
  });

  services.storageNode.on('contract-registered', (contract) => {
    if (mainWindow) {
      mainWindow.webContents.send('storage:contract', contract);
    }
  });

  // Settings management
  ipcMain.handle('settings:get-all', async () => {
    return services.settingsManager.getAll();
  });

  ipcMain.handle('settings:get', async (event, key) => {
    return services.settingsManager.get(key);
  });

  ipcMain.handle('settings:set', async (event, { key, value }) => {
    await services.settingsManager.set(key, value);
    return { success: true };
  });

  ipcMain.handle('settings:update', async (event, updates) => {
    await services.settingsManager.update(updates);
    return { success: true };
  });

  ipcMain.handle('settings:reset', async () => {
    await services.settingsManager.reset();
    return { success: true };
  });

  ipcMain.handle('settings:export', async () => {
    try {
      const { dialog } = require('electron');
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Settings',
        defaultPath: 'spk-desktop-settings.json',
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (filePath) {
        const result = await services.settingsManager.exportSettings(filePath);
        return result;
      }
      return { success: false, error: 'No file selected' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:import', async () => {
    try {
      const { dialog } = require('electron');
      const { filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Import Settings',
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (filePaths && filePaths.length > 0) {
        const result = await services.settingsManager.importSettings(filePaths[0]);
        return result;
      }
      return { success: false, error: 'No file selected' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dialog:choose-directory', async () => {
    try {
      const { dialog } = require('electron');
      const { filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose Directory',
        properties: ['openDirectory']
      });

      if (filePaths && filePaths.length > 0) {
        return { success: true, path: filePaths[0] };
      }
      return { success: false, error: 'No directory selected' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('app:restart', async () => {
    app.relaunch();
    app.quit();
  });

  // Pending uploads management
  ipcMain.handle('pending-uploads:get-all', async () => {
    try {
      return await services.pendingUploadsManager.getPendingUploads();
    } catch (error) {
      console.error('Failed to get pending uploads:', error);
      return [];
    }
  });

  ipcMain.handle('pending-uploads:add', async (event, uploadData) => {
    try {
      return await services.pendingUploadsManager.addPendingUpload(uploadData);
    } catch (error) {
      console.error('Failed to add pending upload:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pending-uploads:confirm', async (event, uploadId) => {
    try {
      return await services.pendingUploadsManager.confirmUpload(uploadId);
    } catch (error) {
      console.error('Failed to confirm upload:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pending-uploads:fail', async (event, uploadId, errorMessage) => {
    try {
      return await services.pendingUploadsManager.failUpload(uploadId, errorMessage);
    } catch (error) {
      console.error('Failed to mark upload as failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pending-uploads:remove', async (event, uploadId) => {
    try {
      return await services.pendingUploadsManager.removeUpload(uploadId);
    } catch (error) {
      console.error('Failed to remove upload:', error);
      return { success: false, error: error.message };
    }
  });
}

/**
 * App event handlers
 */
app.whenReady().then(async () => {
  try {
    await initializeServices();
    setupIPCHandlers();
    createWindow();
  } catch (error) {
    console.error('Failed to initialize app:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  // Lock accounts on quit
  services.spkClient.lock();
  
  // Cleanup services
  await services.ipfsManager.stop();
  await services.storageNode.stop();
  await services.transcoder.cleanup();
});

// Export for testing
module.exports = { services };