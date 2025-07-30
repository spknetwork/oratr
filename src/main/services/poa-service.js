const { ipcMain } = require('electron');
const POAProcessManager = require('../../core/storage/poa-process-manager');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

/**
 * POA Service for Electron Main Process
 * Manages the POA storage node process lifecycle
 */
class POAService {
  constructor() {
    this.manager = null;
    this.isInitialized = false;
    this.status = {
      running: false,
      enabled: false,
      configured: false
    };
    
    this.setupIPC();
  }
  
  /**
   * Setup IPC handlers for renderer communication
   */
  setupIPC() {
    // Get POA status
    ipcMain.handle('poa:get-status', async () => {
      return this.getStatus();
    });
    
    // Start POA
    ipcMain.handle('poa:start', async (event, config) => {
      return this.start(config);
    });
    
    // Stop POA
    ipcMain.handle('poa:stop', async (event, force) => {
      return this.stop(force);
    });
    
    // Restart POA
    ipcMain.handle('poa:restart', async () => {
      return this.restart();
    });
    
    // Update configuration
    ipcMain.handle('poa:update-config', async (event, config) => {
      return this.updateConfig(config);
    });
    
    // Get logs
    ipcMain.handle('poa:get-logs', async (event, limit) => {
      return this.getLogs(limit);
    });
    
    // Check binary
    ipcMain.handle('poa:check-binary', async () => {
      return this.checkBinary();
    });
    
    // Download binary
    ipcMain.handle('poa:download-binary', async () => {
      return this.downloadBinary();
    });
    
    // Check IPFS
    ipcMain.handle('poa:check-ipfs', async () => {
      return this.checkIPFS();
    });
  }
  
  /**
   * Initialize POA service
   */
  async initialize(config = {}) {
    if (this.isInitialized) return;
    
    // Load saved configuration
    const savedConfig = await this.loadConfig();
    const mergedConfig = { ...savedConfig, ...config };
    
    // Create manager instance
    this.manager = new POAProcessManager(mergedConfig);
    
    // Setup event forwarding to renderer
    this.setupEventForwarding();
    
    this.isInitialized = true;
    
    // Auto-start if enabled
    if (mergedConfig.autoStart && mergedConfig.account) {
      try {
        await this.start();
      } catch (error) {
        console.error('Failed to auto-start POA:', error);
      }
    }
  }
  
  /**
   * Setup event forwarding from POA manager to renderer
   */
  setupEventForwarding() {
    if (!this.manager) return;
    
    const events = [
      'started', 'stopped', 'crashed', 'error', 'log',
      'validation', 'storage', 'connected', 'poa-error',
      'max-restarts-reached'
    ];
    
    events.forEach(event => {
      this.manager.on(event, (data) => {
        // Send to all renderer windows
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(window => {
          window.webContents.send(`poa:${event}`, data);
        });
      });
    });
  }
  
  /**
   * Start POA process
   */
  async start(config = {}) {
    if (!this.isInitialized) {
      await this.initialize(config);
    }
    
    // Update configuration if provided
    if (Object.keys(config).length > 0) {
      Object.assign(this.manager.config, config);
      await this.saveConfig(this.manager.config);
    }
    
    // Check requirements
    const ipfsCheck = await this.checkIPFS();
    if (!ipfsCheck.success) {
      throw new Error(`IPFS check failed: ${ipfsCheck.error}`);
    }
    
    const binaryCheck = await this.checkBinary();
    if (!binaryCheck.exists) {
      throw new Error('POA binary not found. Please download it first.');
    }
    
    // Start the process
    const pid = await this.manager.start();
    
    this.status.running = true;
    this.status.configured = true;
    
    return { success: true, pid };
  }
  
  /**
   * Stop POA process
   */
  async stop(force = false) {
    if (!this.manager || !this.manager.running) {
      throw new Error('POA is not running');
    }
    
    const result = await this.manager.stop(force);
    this.status.running = false;
    
    return { success: true, ...result };
  }
  
  /**
   * Restart POA process
   */
  async restart() {
    if (!this.manager) {
      throw new Error('POA is not initialized');
    }
    
    const result = await this.manager.restart();
    return { success: true, result };
  }
  
  /**
   * Update POA configuration
   */
  async updateConfig(config) {
    if (!this.manager) {
      throw new Error('POA is not initialized');
    }
    
    await this.manager.updateConfig(config);
    await this.saveConfig(this.manager.config);
    
    return { success: true };
  }
  
  /**
   * Get POA status
   */
  getStatus() {
    if (!this.manager) {
      return {
        ...this.status,
        initialized: false
      };
    }
    
    const managerStatus = this.manager.getStatus();
    
    return {
      ...this.status,
      ...managerStatus,
      initialized: true
    };
  }
  
  /**
   * Get POA logs
   */
  getLogs(limit = 100) {
    if (!this.manager) {
      return [];
    }
    
    return this.manager.getLogs(limit);
  }
  
  /**
   * Check if POA binary exists
   */
  async checkBinary() {
    const binaryPath = path.join(os.homedir(), '.spk-desktop', 'poa', 'proofofaccess');
    
    try {
      await fs.access(binaryPath, fs.constants.X_OK);
      return { exists: true, path: binaryPath };
    } catch (error) {
      return { exists: false, path: binaryPath };
    }
  }
  
  /**
   * Download POA binary
   */
  async downloadBinary() {
    // This would download the appropriate binary for the platform
    // For now, return instructions
    const platform = process.platform;
    const arch = process.arch;
    
    const downloadUrls = {
      'darwin-x64': 'https://github.com/spknetwork/proofofaccess/releases/download/latest/poa-macos-x64',
      'darwin-arm64': 'https://github.com/spknetwork/proofofaccess/releases/download/latest/poa-macos-arm64',
      'linux-x64': 'https://github.com/spknetwork/proofofaccess/releases/download/latest/poa-linux-x64',
      'win32-x64': 'https://github.com/spknetwork/proofofaccess/releases/download/latest/poa-windows-x64.exe'
    };
    
    const downloadUrl = downloadUrls[`${platform}-${arch}`];
    
    if (!downloadUrl) {
      throw new Error(`No POA binary available for ${platform}-${arch}`);
    }
    
    // TODO: Implement actual download
    return {
      success: false,
      message: 'Automatic download not yet implemented',
      manualDownloadUrl: downloadUrl,
      installPath: path.join(os.homedir(), '.spk-desktop', 'poa', 'proofofaccess')
    };
  }
  
  /**
   * Check IPFS configuration
   */
  async checkIPFS() {
    try {
      // Check if IPFS is running
      const response = await fetch('http://127.0.0.1:5001/api/v0/config/show', {
        method: 'POST'
      });
      
      if (!response.ok) {
        return { 
          success: false, 
          error: 'IPFS is not running or API is not accessible' 
        };
      }
      
      const config = await response.json();
      
      // Check PubSub configuration
      if (!config.Pubsub || !config.Pubsub.Router) {
        return {
          success: false,
          error: 'IPFS PubSub is not properly configured. Router is missing.',
          fix: 'Run: ipfs config --json Pubsub.Router \'"gossipsub"\''
        };
      }
      
      if (!config.Pubsub.Enabled && !config.Discovery?.MDNS?.Enabled) {
        return {
          success: false,
          error: 'IPFS PubSub may not be enabled.',
          fix: 'Run: ipfs config --json Pubsub.Enabled true'
        };
      }
      
      return { success: true, config: config.Pubsub };
    } catch (error) {
      return {
        success: false,
        error: `Failed to check IPFS: ${error.message}`
      };
    }
  }
  
  /**
   * Load saved configuration
   */
  async loadConfig() {
    const configPath = path.join(os.homedir(), '.spk-desktop', 'poa-service.json');
    
    try {
      const data = await fs.readFile(configPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      // Return default config if file doesn't exist
      return {
        autoStart: false,
        nodeType: 2,
        maxStorage: 100 * 1024 * 1024 * 1024 // 100GB
      };
    }
  }
  
  /**
   * Save configuration
   */
  async saveConfig(config) {
    const configPath = path.join(os.homedir(), '.spk-desktop', 'poa-service.json');
    const dir = path.dirname(configPath);
    
    await fs.mkdir(dir, { recursive: true });
    
    // Don't save sensitive data
    const { privateKey, ...safeConfig } = config;
    
    await fs.writeFile(
      configPath,
      JSON.stringify(safeConfig, null, 2)
    );
  }
  
  /**
   * Cleanup on app quit
   */
  async cleanup() {
    if (this.manager && this.manager.running) {
      console.log('Stopping POA process...');
      try {
        await this.manager.stop();
      } catch (error) {
        console.error('Error stopping POA:', error);
        // Force kill if graceful stop fails
        try {
          await this.manager.stop(true);
        } catch (forceError) {
          console.error('Force stop also failed:', forceError);
        }
      }
    }
  }
}

// Export singleton instance
module.exports = new POAService();