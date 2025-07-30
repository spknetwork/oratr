/**
 * POA Control Panel Component
 * UI for managing the Proof of Access storage node
 */

import poaApi from '../api/poa-api.js';

class POAControlPanel {
  constructor(container) {
    this.container = container;
    this.status = null;
    this.logs = [];
    this.updateInterval = null;
    
    this.render();
    this.setupEventListeners();
    this.initialize();
  }
  
  async initialize() {
    // Check initial status
    await this.updateStatus();
    
    // Start periodic status updates
    this.updateInterval = setInterval(() => {
      this.updateStatus();
    }, 5000);
    
    // Setup POA event listeners
    this.setupPOAListeners();
  }
  
  setupPOAListeners() {
    // Process lifecycle events
    poaApi.on('started', (data) => {
      this.addLog('success', `POA started with PID ${data.pid}`);
      this.updateStatus();
    });
    
    poaApi.on('stopped', (data) => {
      this.addLog('info', 'POA stopped');
      this.updateStatus();
    });
    
    poaApi.on('crashed', (data) => {
      this.addLog('error', `POA crashed with code ${data.code}`);
      this.updateStatus();
    });
    
    poaApi.on('error', (data) => {
      this.addLog('error', `POA error: ${data.message || data}`);
    });
    
    // Operational events
    poaApi.on('validation', (data) => {
      this.addLog('info', `Validation: ${data.message}`);
    });
    
    poaApi.on('storage', (data) => {
      this.addLog('info', `Storage: ${data.message}`);
    });
    
    poaApi.on('connected', (data) => {
      this.addLog('success', `Connected: ${data.message}`);
    });
    
    // Log events
    poaApi.on('log', (data) => {
      this.addLog(data.level, data.message);
    });
  }
  
  async updateStatus() {
    try {
      this.status = await poaApi.getStatus();
      this.updateUI();
    } catch (error) {
      console.error('Failed to update POA status:', error);
    }
  }
  
  render() {
    this.container.innerHTML = `
      <div class="poa-control-panel">
        <h3>Proof of Access Storage Node</h3>
        
        <!-- Status Section -->
        <div class="poa-status-section">
          <div class="status-indicator" id="poa-status-indicator">
            <span class="status-dot"></span>
            <span class="status-text">Checking...</span>
          </div>
          
          <div class="status-details" id="poa-status-details"></div>
        </div>
        
        <!-- Controls Section -->
        <div class="poa-controls">
          <button id="poa-start-btn" class="btn btn-success" disabled>
            <i class="fas fa-play"></i> Start Node
          </button>
          <button id="poa-stop-btn" class="btn btn-danger" disabled>
            <i class="fas fa-stop"></i> Stop Node
          </button>
          <button id="poa-restart-btn" class="btn btn-warning" disabled>
            <i class="fas fa-sync"></i> Restart
          </button>
          <button id="poa-config-btn" class="btn btn-secondary">
            <i class="fas fa-cog"></i> Configure
          </button>
        </div>
        
        <!-- Configuration Section (hidden by default) -->
        <div class="poa-config-section" id="poa-config-section" style="display: none;">
          <h4>Configuration</h4>
          
          <div class="config-group">
            <label>Account Name</label>
            <input type="text" id="poa-account" class="form-control" placeholder="Your SPK account">
          </div>
          
          <div class="config-group">
            <label>Private Key</label>
            <input type="password" id="poa-private-key" class="form-control" placeholder="Your posting key">
            <small class="text-muted">Used for signing validation proofs</small>
          </div>
          
          <div class="config-group">
            <label>Node Type</label>
            <select id="poa-node-type" class="form-control">
              <option value="2">Storage Node (earn rewards)</option>
              <option value="1">Validator Node (advanced)</option>
            </select>
          </div>
          
          <div class="config-group">
            <label>Max Storage (GB)</label>
            <input type="number" id="poa-max-storage" class="form-control" value="100" min="10" max="1000">
            <small class="text-muted">Maximum storage to allocate for POA</small>
          </div>
          
          <div class="config-group">
            <label>SPK API URL</label>
            <input type="text" id="poa-api-url" class="form-control" value="https://spktest.dlux.io">
          </div>
          
          <div class="config-group">
            <label>
              <input type="checkbox" id="poa-auto-start"> Auto-start on app launch
            </label>
          </div>
          
          <div class="config-actions">
            <button id="poa-save-config" class="btn btn-primary">Save Configuration</button>
            <button id="poa-cancel-config" class="btn btn-secondary">Cancel</button>
          </div>
        </div>
        
        <!-- Requirements Check -->
        <div class="poa-requirements" id="poa-requirements">
          <h4>Requirements</h4>
          <div class="requirement-item" id="req-binary">
            <span class="req-icon">⏳</span>
            <span class="req-text">POA Binary</span>
            <button class="btn btn-sm btn-link" id="download-binary-btn" style="display: none;">Download</button>
          </div>
          <div class="requirement-item" id="req-ipfs">
            <span class="req-icon">⏳</span>
            <span class="req-text">IPFS Node</span>
            <button class="btn btn-sm btn-link" id="fix-ipfs-btn" style="display: none;">Fix</button>
          </div>
          <div class="requirement-item" id="req-account">
            <span class="req-icon">⏳</span>
            <span class="req-text">SPK Account</span>
          </div>
        </div>
        
        <!-- Logs Section -->
        <div class="poa-logs-section">
          <div class="logs-header">
            <h4>Activity Log</h4>
            <button id="poa-clear-logs" class="btn btn-sm btn-link">Clear</button>
          </div>
          <div class="poa-logs" id="poa-logs"></div>
        </div>
      </div>
    `;
    
    this.addStyles();
  }
  
  addStyles() {
    if (document.getElementById('poa-control-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'poa-control-styles';
    style.textContent = `
      .poa-control-panel {
        padding: 20px;
        background: #f5f5f5;
        border-radius: 8px;
      }
      
      .poa-control-panel h3 {
        margin-top: 0;
        margin-bottom: 20px;
      }
      
      .poa-status-section {
        background: white;
        padding: 15px;
        border-radius: 6px;
        margin-bottom: 20px;
      }
      
      .status-indicator {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }
      
      .status-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #999;
      }
      
      .status-indicator.running .status-dot {
        background: #4CAF50;
        animation: pulse 2s infinite;
      }
      
      .status-indicator.stopped .status-dot {
        background: #f44336;
      }
      
      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }
      
      .status-details {
        font-size: 0.9em;
        color: #666;
      }
      
      .poa-controls {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
      }
      
      .poa-config-section {
        background: white;
        padding: 20px;
        border-radius: 6px;
        margin-bottom: 20px;
      }
      
      .config-group {
        margin-bottom: 15px;
      }
      
      .config-group label {
        display: block;
        margin-bottom: 5px;
        font-weight: 500;
      }
      
      .config-group .form-control {
        width: 100%;
      }
      
      .config-actions {
        display: flex;
        gap: 10px;
        margin-top: 20px;
      }
      
      .poa-requirements {
        background: white;
        padding: 15px;
        border-radius: 6px;
        margin-bottom: 20px;
      }
      
      .requirement-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 0;
      }
      
      .req-icon {
        font-size: 1.2em;
      }
      
      .requirement-item.success .req-icon {
        color: #4CAF50;
      }
      
      .requirement-item.error .req-icon {
        color: #f44336;
      }
      
      .poa-logs-section {
        background: white;
        padding: 15px;
        border-radius: 6px;
      }
      
      .logs-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      
      .logs-header h4 {
        margin: 0;
      }
      
      .poa-logs {
        max-height: 300px;
        overflow-y: auto;
        font-family: monospace;
        font-size: 0.85em;
        background: #f5f5f5;
        padding: 10px;
        border-radius: 4px;
      }
      
      .log-entry {
        padding: 2px 0;
      }
      
      .log-entry.error {
        color: #f44336;
      }
      
      .log-entry.success {
        color: #4CAF50;
      }
      
      .log-entry.warning {
        color: #FF9800;
      }
      
      .log-entry .timestamp {
        color: #999;
        margin-right: 10px;
      }
    `;
    
    document.head.appendChild(style);
  }
  
  setupEventListeners() {
    // Control buttons
    document.getElementById('poa-start-btn').addEventListener('click', () => this.start());
    document.getElementById('poa-stop-btn').addEventListener('click', () => this.stop());
    document.getElementById('poa-restart-btn').addEventListener('click', () => this.restart());
    document.getElementById('poa-config-btn').addEventListener('click', () => this.toggleConfig());
    
    // Config buttons
    document.getElementById('poa-save-config').addEventListener('click', () => this.saveConfig());
    document.getElementById('poa-cancel-config').addEventListener('click', () => this.hideConfig());
    
    // Requirements buttons
    document.getElementById('download-binary-btn').addEventListener('click', () => this.downloadBinary());
    document.getElementById('fix-ipfs-btn').addEventListener('click', () => this.showIPFSFix());
    
    // Logs
    document.getElementById('poa-clear-logs').addEventListener('click', () => this.clearLogs());
  }
  
  updateUI() {
    if (!this.status) return;
    
    // Update status indicator
    const indicator = document.getElementById('poa-status-indicator');
    const statusText = indicator.querySelector('.status-text');
    
    if (this.status.running) {
      indicator.className = 'status-indicator running';
      statusText.textContent = `Running (PID: ${this.status.pid})`;
    } else {
      indicator.className = 'status-indicator stopped';
      statusText.textContent = 'Stopped';
    }
    
    // Update status details
    const details = document.getElementById('poa-status-details');
    if (this.status.running && this.status.config) {
      details.innerHTML = `
        Account: ${this.status.config.account || 'Not configured'}<br>
        Type: ${this.status.config.nodeType === 1 ? 'Validator' : 'Storage'} Node<br>
        Max Storage: ${(this.status.config.maxStorage / 1024 / 1024 / 1024).toFixed(0)} GB<br>
        Restarts: ${this.status.restartCount || 0}
      `;
    } else {
      details.innerHTML = 'Node not configured';
    }
    
    // Update button states
    const startBtn = document.getElementById('poa-start-btn');
    const stopBtn = document.getElementById('poa-stop-btn');
    const restartBtn = document.getElementById('poa-restart-btn');
    
    startBtn.disabled = this.status.running;
    stopBtn.disabled = !this.status.running;
    restartBtn.disabled = !this.status.running;
    
    // Check requirements
    this.checkRequirements();
  }
  
  async checkRequirements() {
    // Check binary
    const binaryCheck = await poaApi.checkBinary();
    const binaryReq = document.getElementById('req-binary');
    const downloadBtn = document.getElementById('download-binary-btn');
    
    if (binaryCheck.exists) {
      binaryReq.className = 'requirement-item success';
      binaryReq.querySelector('.req-icon').textContent = '✓';
      downloadBtn.style.display = 'none';
    } else {
      binaryReq.className = 'requirement-item error';
      binaryReq.querySelector('.req-icon').textContent = '✗';
      downloadBtn.style.display = 'inline';
    }
    
    // Check IPFS
    const ipfsCheck = await poaApi.checkIPFS();
    const ipfsReq = document.getElementById('req-ipfs');
    const fixBtn = document.getElementById('fix-ipfs-btn');
    
    if (ipfsCheck.success) {
      ipfsReq.className = 'requirement-item success';
      ipfsReq.querySelector('.req-icon').textContent = '✓';
      fixBtn.style.display = 'none';
    } else {
      ipfsReq.className = 'requirement-item error';
      ipfsReq.querySelector('.req-icon').textContent = '✗';
      fixBtn.style.display = 'inline';
    }
    
    // Check account configuration
    const accountReq = document.getElementById('req-account');
    if (this.status?.config?.account) {
      accountReq.className = 'requirement-item success';
      accountReq.querySelector('.req-icon').textContent = '✓';
    } else {
      accountReq.className = 'requirement-item error';
      accountReq.querySelector('.req-icon').textContent = '✗';
    }
    
    // Enable start button only if all requirements are met
    const startBtn = document.getElementById('poa-start-btn');
    if (!this.status?.running) {
      startBtn.disabled = !(binaryCheck.exists && ipfsCheck.success && this.status?.config?.account);
    }
  }
  
  async start() {
    try {
      this.addLog('info', 'Starting POA node...');
      const result = await poaApi.start();
      if (result.success) {
        this.addLog('success', `POA started successfully (PID: ${result.pid})`);
      }
    } catch (error) {
      this.addLog('error', `Failed to start POA: ${error.message}`);
      alert(`Failed to start POA: ${error.message}`);
    }
  }
  
  async stop() {
    try {
      this.addLog('info', 'Stopping POA node...');
      const result = await poaApi.stop();
      if (result.success) {
        this.addLog('success', 'POA stopped successfully');
      }
    } catch (error) {
      this.addLog('error', `Failed to stop POA: ${error.message}`);
    }
  }
  
  async restart() {
    try {
      this.addLog('info', 'Restarting POA node...');
      const result = await poaApi.restart();
      if (result.success) {
        this.addLog('success', 'POA restarted successfully');
      }
    } catch (error) {
      this.addLog('error', `Failed to restart POA: ${error.message}`);
    }
  }
  
  toggleConfig() {
    const section = document.getElementById('poa-config-section');
    if (section.style.display === 'none') {
      this.showConfig();
    } else {
      this.hideConfig();
    }
  }
  
  showConfig() {
    const section = document.getElementById('poa-config-section');
    section.style.display = 'block';
    
    // Load current config
    if (this.status?.config) {
      document.getElementById('poa-account').value = this.status.config.account || '';
      document.getElementById('poa-node-type').value = this.status.config.nodeType || 2;
      document.getElementById('poa-max-storage').value = (this.status.config.maxStorage / 1024 / 1024 / 1024) || 100;
      document.getElementById('poa-api-url').value = this.status.config.spkApiUrl || 'https://spktest.dlux.io';
    }
  }
  
  hideConfig() {
    const section = document.getElementById('poa-config-section');
    section.style.display = 'none';
  }
  
  async saveConfig() {
    const config = {
      account: document.getElementById('poa-account').value,
      privateKey: document.getElementById('poa-private-key').value,
      nodeType: parseInt(document.getElementById('poa-node-type').value),
      maxStorage: parseInt(document.getElementById('poa-max-storage').value) * 1024 * 1024 * 1024,
      spkApiUrl: document.getElementById('poa-api-url').value,
      autoStart: document.getElementById('poa-auto-start').checked
    };
    
    if (!config.account) {
      alert('Please enter your SPK account name');
      return;
    }
    
    if (!config.privateKey) {
      alert('Please enter your private key');
      return;
    }
    
    try {
      await poaApi.updateConfig(config);
      this.addLog('success', 'Configuration saved');
      this.hideConfig();
      await this.updateStatus();
    } catch (error) {
      this.addLog('error', `Failed to save config: ${error.message}`);
      alert(`Failed to save configuration: ${error.message}`);
    }
  }
  
  async downloadBinary() {
    try {
      const result = await poaApi.downloadBinary();
      if (result.manualDownloadUrl) {
        alert(`Please download the POA binary manually from:\n${result.manualDownloadUrl}\n\nSave it to:\n${result.installPath}`);
        window.open(result.manualDownloadUrl, '_blank');
      }
    } catch (error) {
      alert(`Failed to download binary: ${error.message}`);
    }
  }
  
  showIPFSFix() {
    const ipfsCheck = this.status?.ipfsCheck;
    if (ipfsCheck?.fix) {
      alert(`To fix IPFS configuration:\n\n${ipfsCheck.fix}\n\nThen restart IPFS.`);
    } else {
      alert('Please ensure IPFS is running with PubSub enabled.\n\nRun: ipfs config --json Pubsub.Router \'"gossipsub"\'');
    }
  }
  
  addLog(level, message) {
    const timestamp = new Date().toLocaleTimeString();
    const entry = { timestamp, level, message };
    
    this.logs.unshift(entry);
    if (this.logs.length > 100) {
      this.logs = this.logs.slice(0, 100);
    }
    
    this.renderLogs();
  }
  
  renderLogs() {
    const container = document.getElementById('poa-logs');
    container.innerHTML = this.logs.map(log => `
      <div class="log-entry ${log.level}">
        <span class="timestamp">${log.timestamp}</span>
        ${log.message}
      </div>
    `).join('');
  }
  
  clearLogs() {
    this.logs = [];
    this.renderLogs();
  }
  
  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}

export default POAControlPanel;