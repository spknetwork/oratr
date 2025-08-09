/**
 * Settings Manager
 * Handles user preferences and configuration persistence
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class SettingsManager extends EventEmitter {
  constructor() {
    super();
    this.settingsFile = path.join(os.homedir(), '.oratr', 'settings.json');
    this.settings = this.getDefaultSettings();
    this.initialized = false;
  }

  getDefaultSettings() {
    return {
      // Network Settings
      spkNode: 'https://spktest.dlux.io',
      honeygraphUrl: 'https://honeygraph.dlux.io',
      isTestnet: true,
      
      // IPFS Settings
      ipfsMode: 'internal', // 'internal' or 'external'
      ipfsHost: '127.0.0.1',
      ipfsPort: 5001,
      ipfsDataPath: path.join(os.homedir(), '.oratr', 'ipfs'),
      maxStorageGB: 100,
      
      // POA Settings
      poaDataPath: path.join(os.homedir(), '.oratr', 'poa'),
      
      // Upload Settings
      defaultUploadMethod: 'direct', // 'direct' or 'standard'
      autoSelectDirect: true,
      videoQuality: 'auto', // 'auto', 'high', 'medium', 'low'
      transcodeParallel: true,
      
      // UI Settings
      theme: 'auto', // 'light', 'dark', 'auto'
      autoRefreshInterval: 30, // seconds
      showAdvancedOptions: false,
      confirmDangerousActions: true,
      
      // Storage Node Settings
      enableStorageNode: true,
      autoStartStorage: true,
      storageNodeWasRunning: false, // Track if storage node was running before shutdown
      
      // Privacy Settings
      shareUsageStats: false,
      enableTelemetry: false,
      
      // Development Settings
      debugMode: false,
      enableConsoleLogging: true,
      logLevel: 'info', // 'debug', 'info', 'warn', 'error'

      // WebDAV Settings
      webdavEnabled: false,
      webdavPort: 4819,
      webdavRequireAuth: false,
      webdavUsername: '',
      webdavPassword: ''
    };
  }

  async init() {
    if (this.initialized) return;
    
    // Ensure directory exists
    const dir = path.dirname(this.settingsFile);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
    
    // Load existing settings
    await this.loadSettings();
    this.initialized = true;
    
    this.emit('initialized', this.settings);
  }

  async loadSettings() {
    try {
      const data = await fs.readFile(this.settingsFile, 'utf8');
      const savedSettings = JSON.parse(data);
      
      // Merge with defaults to handle new settings
      this.settings = { ...this.getDefaultSettings(), ...savedSettings };
      
      this.emit('loaded', this.settings);
    } catch (error) {
      // File doesn't exist or is corrupted, use defaults
      console.log('Using default settings');
      await this.saveSettings();
    }
  }

  async saveSettings() {
    try {
      await fs.writeFile(this.settingsFile, JSON.stringify(this.settings, null, 2));
      this.emit('saved', this.settings);
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.emit('error', error);
    }
  }

  /**
   * Get all settings
   * @returns {Object} All settings
   */
  getSettings() {
    return { ...this.settings };
  }
  
  /**
   * Update multiple settings at once
   * @param {Object} updates - Object with settings to update
   */
  async updateSettings(updates) {
    Object.assign(this.settings, updates);
    await this.saveSettings();
    return this.settings;
  }
  
  /**
   * Get a setting value
   * @param {string} key - Setting key (supports dot notation like 'network.spkNode')
   * @param {*} defaultValue - Default value if setting doesn't exist
   */
  get(key, defaultValue = null) {
    const keys = key.split('.');
    let value = this.settings;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }
    
    return value;
  }

  /**
   * Set a setting value
   * @param {string} key - Setting key (supports dot notation)
   * @param {*} value - Setting value
   */
  async set(key, value) {
    const keys = key.split('.');
    const lastKey = keys.pop();
    let target = this.settings;
    
    // Navigate to the parent object
    for (const k of keys) {
      if (!target[k] || typeof target[k] !== 'object') {
        target[k] = {};
      }
      target = target[k];
    }
    
    // Set the value
    const oldValue = target[lastKey];
    target[lastKey] = value;
    
    // Save to disk
    await this.saveSettings();
    
    this.emit('changed', { key, value, oldValue });
  }

  /**
   * Update multiple settings at once
   * @param {object} updates - Object with setting updates
   */
  async update(updates) {
    const changes = [];
    
    for (const [key, value] of Object.entries(updates)) {
      const oldValue = this.get(key);
      await this.set(key, value);
      changes.push({ key, value, oldValue });
    }
    
    this.emit('bulkChanged', changes);
  }

  /**
   * Reset settings to defaults
   */
  async reset() {
    const oldSettings = { ...this.settings };
    this.settings = this.getDefaultSettings();
    await this.saveSettings();
    
    this.emit('reset', { oldSettings, newSettings: this.settings });
  }

  /**
   * Get all settings
   */
  getAll() {
    return { ...this.settings };
  }

  /**
   * Export settings to a file
   * @param {string} filePath - Export file path
   */
  async exportSettings(filePath) {
    try {
      const exportData = {
        exportedAt: new Date().toISOString(),
        version: '1.0.0',
        settings: this.settings
      };
      
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Import settings from a file
   * @param {string} filePath - Import file path
   */
  async importSettings(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const importData = JSON.parse(data);
      
      if (importData.settings) {
        // Merge with current settings
        this.settings = { ...this.settings, ...importData.settings };
        await this.saveSettings();
        
        this.emit('imported', importData);
        return { success: true, imported: importData };
      } else {
        throw new Error('Invalid settings file format');
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Validate settings
   */
  validate() {
    const errors = [];
    
    // Validate URLs
    try {
      new URL(this.settings.spkNode);
    } catch (error) {
      errors.push('Invalid SPK Node URL');
    }
    
    try {
      new URL(this.settings.honeygraphUrl);
    } catch (error) {
      errors.push('Invalid Honeygraph URL');
    }
    
    // Validate IPFS settings
    if (this.settings.ipfsPort < 1 || this.settings.ipfsPort > 65535) {
      errors.push('IPFS port must be between 1 and 65535');
    }
    
    // Validate storage settings
    if (this.settings.maxStorageGB < 1) {
      errors.push('Max storage must be at least 1 GB');
    }
    
    if (this.settings.storageBidRate < 0) {
      errors.push('Storage bid rate cannot be negative');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get network-specific settings
   */
  getNetworkSettings() {
    return {
      spkNode: this.settings.spkNode,
      honeygraphUrl: this.settings.honeygraphUrl,
      isTestnet: this.settings.isTestnet
    };
  }

  /**
   * Get IPFS-specific settings
   */
  getIPFSSettings() {
    return {
      mode: this.settings.ipfsMode,
      host: this.settings.ipfsHost,
      port: this.settings.ipfsPort,
      dataPath: this.settings.ipfsDataPath,
      maxStorageGB: this.settings.maxStorageGB
    };
  }

  /**
   * Get storage node settings
   */
  getStorageNodeSettings() {
    return {
      enabled: this.settings.enableStorageNode,
      domain: this.settings.storageNodeDomain,
      bidRate: this.settings.storageBidRate,
      autoStart: this.settings.autoStartStorage
    };
  }
}

module.exports = SettingsManager;