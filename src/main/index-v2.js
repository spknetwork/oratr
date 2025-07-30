const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Load File polyfill
require('../core/utils/file-polyfill');

// Import service initialization
const { initializeServices, getServices, shutdownServices } = require('./services/init-services');
const { setupUploadHandlers } = require('./ipc/upload-handlers');

let mainWindow;

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
    },
    icon: path.join(__dirname, '../renderer/assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Setup IPC handlers for SPK operations
 */
function setupSPKHandlers() {
  const services = getServices();

  // Provider selection is now handled internally by spk-js

  // Get network stats
  ipcMain.handle('spk:getNetworkStats', async () => {
    try {
      // Return mock stats for now
      const stats = {
        result: {
          channel_min: 100,
          broca_per_byte: 0.001
        }
      };
      
      return { success: true, stats };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Calculate BROCA cost
  ipcMain.handle('spk:calculateBrocaCost', async (event, size, options) => {
    try {
      const SPK = require('@spknetwork/spk-js');
      const cost = SPK.BROCACalculator.calculateStorageCost(size, options.duration || 30);
      
      return { 
        success: true, 
        data: { 
          cost,
          size,
          duration: options.duration || 30
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Get storage providers
  ipcMain.handle('spk:getStorageProviders', async () => {
    try {
      // Return mock provider list
      const providers = {
        services: [
          {
            account: 'spknetwork',
            api: 'https://trole.spknetwork.io',
            enabled: true
          }
        ]
      };
      
      return { success: true, data: providers };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

/**
 * Setup authentication handlers
 */
function setupAuthHandlers() {
  const services = getServices();
  
  // PIN management
  ipcMain.handle('auth:hasPinSetup', async () => {
    return services.accountManager.hasPinSetup();
  });

  ipcMain.handle('auth:setupPin', async (event, pin) => {
    try {
      // For initial setup, we'll use the PIN as both the unlock PIN and encryption PIN
      // In a real app, you might want these to be different
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auth:unlock', async (event, pin) => {
    try {
      await services.accountManager.unlock(pin);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auth:lock', async () => {
    services.accountManager.clearSession();
    return { success: true };
  });

  ipcMain.handle('auth:resetAll', async () => {
    try {
      await services.accountManager.deleteAllAccounts();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

/**
 * Setup account management handlers
 */
function setupAccountHandlers() {
  const services = getServices();

  ipcMain.handle('account:add', async (event, username, keys) => {
    try {
      // Check if accounts are unlocked first
      if (!services.accountManager.isUnlocked) {
        throw new Error('Please unlock your wallet first');
      }
      
      await services.accountManager.addAccount(username, keys);
      return { success: true, account: { username } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:importFromMaster', async (event, username, masterPassword) => {
    try {
      // Derive keys from master password using hive-js
      const hive = require('@hiveio/hive-js');
      const keys = {
        posting: hive.auth.toWif(username, masterPassword, 'posting'),
        active: hive.auth.toWif(username, masterPassword, 'active'),
        memo: hive.auth.toWif(username, masterPassword, 'memo')
      };
      
      await services.accountManager.importAccount(username, keys, 'default-pin');
      return { success: true, account: { username } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:remove', async (event, username) => {
    try {
      await services.accountManager.removeAccount(username);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:list', async () => {
    try {
      const accounts = await services.accountManager.listAccounts();
      return { success: true, accounts };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:setActive', async (event, username) => {
    try {
      await services.accountManager.switchAccount(username);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:getActive', async () => {
    try {
      const username = services.accountManager.getCurrentAccount();
      return { success: true, username };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

/**
 * Setup all IPC handlers
 */
async function setupIPCHandlers() {
  // Initialize services first
  await initializeServices();
  
  // Setup handlers
  setupAuthHandlers();
  setupAccountHandlers();
  setupSPKHandlers();
  setupUploadHandlers();
  
  // Add IPFS handlers
  ipcMain.handle('ipfs:testConnection', async () => {
    try {
      const ipfs = services.ipfsManager;
      const isConnected = await ipfs.checkConnection();
      return { success: true, connected: isConnected };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // Add FFmpeg handlers
  ipcMain.handle('ffmpeg:getVersion', async () => {
    try {
      const transcoder = services.transcoder;
      const version = await transcoder.getFFmpegVersion();
      return { success: true, version };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  const services = getServices();
  
  // IPFS handlers
  ipcMain.handle('ipfs:addFile', async (event, { name, data }) => {
    try {
      const buffer = Buffer.from(data);
      const result = await services.ipfsManager.add({ content: buffer });
      return { success: true, cid: result.cid.toString() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('ipfs:status', async () => {
    try {
      const isOnline = await services.ipfsManager.isOnline();
      return { success: true, isOnline };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // Storage node handlers
  ipcMain.handle('storage:enable', async () => {
    try {
      await services.integratedStorage.enable();
      return { success: true, available: true };
    } catch (error) {
      return { success: false, error: error.message, available: false };
    }
  });
  
  ipcMain.handle('storage:disable', async () => {
    try {
      await services.integratedStorage.disable();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('storage:status', async () => {
    try {
      const status = await services.integratedStorage.getStatus();
      return { success: true, ...status };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

/**
 * App event handlers
 */
app.whenReady().then(async () => {
  // Set up IPC handlers BEFORE creating the window
  await setupIPCHandlers();
  createWindow();
});

app.on('window-all-closed', async () => {
  await shutdownServices();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle app shutdown
app.on('before-quit', async (event) => {
  event.preventDefault();
  await shutdownServices();
  app.exit();
});