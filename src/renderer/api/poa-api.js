/**
 * POA API for Renderer Process
 * Provides interface to control POA storage node
 */

const { ipcRenderer } = window.require ? window.require('electron') : { ipcRenderer: null };

class POAApi {
  constructor() {
    this.listeners = new Map();
    this.setupEventListeners();
  }
  
  /**
   * Setup IPC event listeners
   */
  setupEventListeners() {
    if (!ipcRenderer) return;
    
    const events = [
      'started', 'stopped', 'crashed', 'error', 'log',
      'validation', 'storage', 'connected', 'poa-error',
      'max-restarts-reached'
    ];
    
    events.forEach(event => {
      ipcRenderer.on(`poa:${event}`, (_, data) => {
        this.emit(event, data);
      });
    });
  }
  
  /**
   * Get POA status
   */
  async getStatus() {
    if (!ipcRenderer) {
      return { error: 'IPC not available' };
    }
    
    try {
      return await ipcRenderer.invoke('poa:get-status');
    } catch (error) {
      console.error('Failed to get POA status:', error);
      throw error;
    }
  }
  
  /**
   * Start POA node
   */
  async start(config = {}) {
    if (!ipcRenderer) {
      throw new Error('IPC not available');
    }
    
    try {
      const result = await ipcRenderer.invoke('poa:start', config);
      return result;
    } catch (error) {
      console.error('Failed to start POA:', error);
      throw error;
    }
  }
  
  /**
   * Stop POA node
   */
  async stop(force = false) {
    if (!ipcRenderer) {
      throw new Error('IPC not available');
    }
    
    try {
      const result = await ipcRenderer.invoke('poa:stop', force);
      return result;
    } catch (error) {
      console.error('Failed to stop POA:', error);
      throw error;
    }
  }
  
  /**
   * Restart POA node
   */
  async restart() {
    if (!ipcRenderer) {
      throw new Error('IPC not available');
    }
    
    try {
      const result = await ipcRenderer.invoke('poa:restart');
      return result;
    } catch (error) {
      console.error('Failed to restart POA:', error);
      throw error;
    }
  }
  
  /**
   * Update POA configuration
   */
  async updateConfig(config) {
    if (!ipcRenderer) {
      throw new Error('IPC not available');
    }
    
    try {
      const result = await ipcRenderer.invoke('poa:update-config', config);
      return result;
    } catch (error) {
      console.error('Failed to update POA config:', error);
      throw error;
    }
  }

  async getConfig() {
    if (!ipcRenderer) {
        return { error: 'IPC not available' };
    }
    try {
        return await ipcRenderer.invoke('poa:get-config');
    } catch (error) {
        console.error('Failed to get POA config:', error);
        throw error;
    }
  }
  
  /**
   * Get POA logs
   */
  async getLogs(limit = 100) {
    if (!ipcRenderer) {
      return [];
    }
    
    try {
      return await ipcRenderer.invoke('poa:get-logs', limit);
    } catch (error) {
      console.error('Failed to get POA logs:', error);
      return [];
    }
  }
  
  /**
   * Check if POA binary exists
   */
  async checkBinary() {
    if (!ipcRenderer) {
      return { exists: false };
    }
    
    try {
      return await ipcRenderer.invoke('poa:check-binary');
    } catch (error) {
      console.error('Failed to check POA binary:', error);
      return { exists: false, error: error.message };
    }
  }
  
  /**
   * Download POA binary
   */
  async downloadBinary() {
    if (!ipcRenderer) {
      throw new Error('IPC not available');
    }
    
    try {
      return await ipcRenderer.invoke('poa:download-binary');
    } catch (error) {
      console.error('Failed to download POA binary:', error);
      throw error;
    }
  }
  
  /**
   * Check IPFS configuration
   */
  async checkIPFS() {
    if (!ipcRenderer) {
      return { success: false, error: 'IPC not available' };
    }
    
    try {
      return await ipcRenderer.invoke('poa:check-ipfs');
    } catch (error) {
      console.error('Failed to check IPFS:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Event emitter functionality
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }
  
  off(event, callback) {
    if (!this.listeners.has(event)) return;
    
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }
  
  emit(event, data) {
    if (!this.listeners.has(event)) return;
    
    this.listeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in POA event listener for ${event}:`, error);
      }
    });
  }
}

// Export singleton instance
const poaApi = new POAApi();

// Add to window.api if it exists
if (window.api) {
  window.api.poa = poaApi;
}

export default poaApi;
