/**
 * Settings Modal Component
 * Provides UI for configuring application settings
 */

class SettingsModal {
  constructor() {
    this.modal = null;
    this.currentSettings = {};
    this.tabs = ['network', 'ipfs', 'upload', 'storage', 'ui', 'advanced'];
    this.activeTab = 'network';
  }

  init() {
    this.createModal();
    this.setupEventListeners();
  }

  createModal() {
    const modalHTML = `
      <div id="settings-modal" class="modal settings-modal" style="display: none;">
        <div class="modal-content settings-content">
          <div class="modal-header">
            <h2>⚙️ Settings</h2>
            <button class="close-btn" onclick="settingsModal.close()">&times;</button>
          </div>
          
          <div class="settings-body">
            <div class="settings-tabs">
              ${this.tabs.map(tab => `
                <button class="settings-tab ${tab === this.activeTab ? 'active' : ''}" 
                        onclick="settingsModal.switchTab('${tab}')">
                  ${this.getTabIcon(tab)} ${this.getTabTitle(tab)}
                </button>
              `).join('')}
            </div>
            
            <div class="settings-content-area">
              <div id="settings-network" class="settings-panel active">
                <h3>🌐 Network Settings</h3>
                
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="testnet-mode"> Use SPK Testnet
                    <small>Enable to use the test network (recommended for development)</small>
                  </label>
                </div>
                
                <div class="setting-group">
                  <label>SPK Node URL:</label>
                  <input type="url" id="spk-node" placeholder="https://spktest.dlux.io">
                  <small>The SPK network node to connect to</small>
                </div>
                
                <div class="setting-group">
                  <label>Honeygraph URL:</label>
                  <input type="url" id="honeygraph-url" placeholder="https://honeygraph.dlux.io">
                  <small>The Honeygraph database endpoint</small>
                </div>
              </div>
              
              <div id="settings-ipfs" class="settings-panel">
                <h3>📁 IPFS Settings</h3>
                
                <div class="setting-group">
                  <label>IPFS Mode:</label>
                  <div class="radio-group">
                    <label><input type="radio" name="ipfs-mode" value="internal"> Internal (Managed by app)</label>
                    <label><input type="radio" name="ipfs-mode" value="external"> External (Connect to existing)</label>
                  </div>
                </div>
                
                <div class="setting-group" id="external-ipfs-settings" style="display: none;">
                  <label>IPFS Host:</label>
                  <input type="text" id="ipfs-host" placeholder="127.0.0.1">
                  
                  <label>IPFS Port:</label>
                  <input type="number" id="ipfs-port" placeholder="5001" min="1" max="65535">
                </div>
                
                <div class="setting-group">
                  <label>Data Directory:</label>
                  <div class="path-input">
                    <input type="text" id="ipfs-data-path" readonly>
                    <button onclick="settingsModal.chooseDataPath()">Browse</button>
                  </div>
                </div>
                
                <div class="setting-group">
                  <label>Max Storage: <span id="storage-display">100 GB</span></label>
                  <input type="range" id="max-storage" min="1" max="1000" value="100" 
                         oninput="settingsModal.updateStorageDisplay(this.value)">
                  <small>Maximum storage space to use for IPFS</small>
                </div>
              </div>
              
              <div id="settings-upload" class="settings-panel">
                <h3>📤 Upload Settings</h3>
                
                <div class="setting-group">
                  <label>Default Upload Method:</label>
                  <div class="radio-group">
                    <label><input type="radio" name="upload-method" value="direct"> Direct Upload (to storage node)</label>
                    <label><input type="radio" name="upload-method" value="standard"> Standard Upload (to SPK network)</label>
                  </div>
                </div>
                
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="auto-select-direct"> Auto-select direct upload when available
                  </label>
                </div>
                
                <div class="setting-group">
                  <label>Video Quality:</label>
                  <select id="video-quality">
                    <option value="auto">Auto (based on source)</option>
                    <option value="high">High Quality</option>
                    <option value="medium">Medium Quality</option>
                    <option value="low">Low Quality (faster)</option>
                  </select>
                </div>
                
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="transcode-parallel"> Enable parallel transcoding
                    <small>Process multiple resolutions simultaneously (uses more CPU)</small>
                  </label>
                </div>
              </div>
              
              <div id="settings-storage" class="settings-panel">
                <h3>💾 Storage Node Settings</h3>
                
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="enable-storage-node"> Enable Storage Node
                  </label>
                </div>
                
                <div class="setting-group">
                  <label>Domain (Optional):</label>
                  <input type="text" id="storage-domain" placeholder="Leave empty for P2P only">
                  <small>Only needed if you have a static IP and want to provide gateway services</small>
                </div>
                
                <div class="setting-group">
                  <label>Bid Rate:</label>
                  <input type="number" id="storage-bid-rate" placeholder="500" min="0">
                  <small>Your bid rate for storage contracts (lower = more competitive)</small>
                </div>
                
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="auto-start-storage"> Auto-start storage node on app launch
                  </label>
                </div>
              </div>
              
              <div id="settings-ui" class="settings-panel">
                <h3>🎨 UI Settings</h3>
                
                <div class="setting-group">
                  <label>Theme:</label>
                  <select id="theme">
                    <option value="auto">Auto (system)</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
                
                <div class="setting-group">
                  <label>Auto-refresh Interval:</label>
                  <div class="input-with-unit">
                    <input type="number" id="refresh-interval" min="5" max="300" value="30">
                    <span>seconds</span>
                  </div>
                </div>
                
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="show-advanced"> Show advanced options
                  </label>
                </div>
                
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="confirm-dangerous"> Confirm dangerous actions
                  </label>
                </div>
              </div>
              
              <div id="settings-advanced" class="settings-panel">
                <h3>🔧 Advanced Settings</h3>
                
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="debug-mode"> Debug mode
                    <small>Enable detailed logging and debug features</small>
                  </label>
                </div>
                
                <div class="setting-group">
                  <label>Log Level:</label>
                  <select id="log-level">
                    <option value="debug">Debug (very verbose)</option>
                    <option value="info">Info (default)</option>
                    <option value="warn">Warnings only</option>
                    <option value="error">Errors only</option>
                  </select>
                </div>
                
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="share-usage-stats"> Share anonymous usage statistics
                    <small>Help improve Oratr by sharing anonymous usage data</small>
                  </label>
                </div>
                
                <div class="setting-group">
                  <h4>Backup & Restore</h4>
                  <div class="button-group">
                    <button onclick="settingsModal.exportSettings()" class="btn btn-secondary">Export Settings</button>
                    <button onclick="settingsModal.importSettings()" class="btn btn-secondary">Import Settings</button>
                    <button onclick="settingsModal.resetSettings()" class="btn btn-danger">Reset to Defaults</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <div class="settings-info">
              <small>Settings are automatically saved</small>
            </div>
            <div class="modal-actions">
              <button onclick="settingsModal.restartApp()" class="btn btn-warning">Restart App</button>
              <button onclick="settingsModal.close()" class="btn btn-primary">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('settings-modal');
    this.addStyles();
  }

  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Overlay container */
      .settings-modal {
        position: fixed;
        inset: 0;
        z-index: 9999;
        justify-content: center;
        align-items: center;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        padding: 2rem;
      }

      .settings-modal .modal-content {
        width: min(900px, 95vw);
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background: #fff;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        border: 1px solid rgba(0,0,0,0.08);
      }
      
      .settings-modal .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid #e9ecef;
        background: #fafafa;
      }

      .settings-modal .modal-header .close-btn {
        border: none;
        background: transparent;
        font-size: 1.5rem;
        line-height: 1;
        cursor: pointer;
        color: #666;
      }

      .settings-body {
        display: flex;
        flex: 1;
        overflow: hidden;
      }
      
      .settings-tabs {
        min-width: 200px;
        background: #f8f9fa;
        border-right: 1px solid #dee2e6;
        padding: 0.75rem 0;
        overflow-y: auto;
      }
      
      .settings-tab {
        display: block;
        width: 100%;
        padding: 0.75rem 1rem;
        border: none;
        background: transparent;
        text-align: left;
        cursor: pointer;
        transition: background-color 0.2s;
        font-size: 0.9rem;
      }
      
      .settings-tab:hover {
        background: #e9ecef;
      }
      
      .settings-tab.active {
        background: #007bff;
        color: white;
        box-shadow: inset 2px 0 0 rgba(0,0,0,0.05);
      }
      
      .settings-content-area {
        flex: 1;
        overflow-y: auto;
        padding: 1.5rem;
        background: #fff;
      }
      
      .settings-panel {
        display: none;
      }
      
      .settings-panel.active {
        display: block;
      }
      
      .setting-group {
        margin-bottom: 1.5rem;
      }
      
      .setting-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
      }
      
      .setting-label {
        display: flex;
        align-items: center;
        cursor: pointer;
      }
      
      .setting-label input[type="checkbox"] {
        margin-right: 0.5rem;
      }
      
      .setting-group input[type="text"],
      .setting-group input[type="url"],
      .setting-group input[type="number"],
      .setting-group select {
        width: 100%;
        padding: 0.5rem;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 0.9rem;
      }
      
      .setting-group small {
        display: block;
        color: #666;
        font-size: 0.8rem;
        margin-top: 0.25rem;
      }
      
      .radio-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      
      .radio-group label {
        display: flex;
        align-items: center;
        font-weight: normal;
        margin-bottom: 0;
      }
      
      .radio-group input[type="radio"] {
        margin-right: 0.5rem;
      }
      
      .path-input {
        display: flex;
        gap: 0.5rem;
      }
      
      .path-input input {
        flex: 1;
      }
      
      .path-input button {
        padding: 0.5rem 1rem;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      
      .input-with-unit {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      
      .input-with-unit input {
        width: 80px;
      }
      
      .button-group {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      
      .button-group button {
        padding: 0.5rem 1rem;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9rem;
      }
      
      .settings-info {
        color: #666;
        font-size: 0.8rem;
      }
      
      .modal-actions {
        display: flex;
        gap: 0.5rem;
      }

      .settings-modal .modal-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1.25rem;
        border-top: 1px solid #e9ecef;
        background: #fafafa;
      }

      /* Responsive tweaks */
      @media (max-width: 768px) {
        .settings-modal {
          padding: 0.5rem;
        }
        .settings-modal .modal-content {
          width: 100vw;
          max-height: 100vh;
          border-radius: 0;
        }
        .settings-body {
          flex-direction: column;
        }
        .settings-tabs {
          min-width: unset;
          display: flex;
          gap: 0.25rem;
          overflow-x: auto;
          border-right: none;
          border-bottom: 1px solid #dee2e6;
          padding: 0.5rem;
        }
        .settings-tab {
          width: auto;
          white-space: nowrap;
          border-radius: 6px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  getTabIcon(tab) {
    const icons = {
      network: '🌐',
      ipfs: '📁',
      upload: '📤',
      storage: '💾',
      ui: '🎨',
      advanced: '🔧'
    };
    return icons[tab] || '⚙️';
  }

  getTabTitle(tab) {
    const titles = {
      network: 'Network',
      ipfs: 'IPFS',
      upload: 'Upload',
      storage: 'Storage',
      ui: 'Interface',
      advanced: 'Advanced'
    };
    return titles[tab] || tab;
  }

  setupEventListeners() {
    // IPFS mode change
    document.querySelectorAll('input[name="ipfs-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const externalSettings = document.getElementById('external-ipfs-settings');
        externalSettings.style.display = radio.value === 'external' ? 'block' : 'none';
      });
    });

    // Auto-save on input changes
    this.modal.addEventListener('input', (e) => {
      if (e.target.matches('input, select')) {
        this.saveSetting(e.target);
      }
    });

    this.modal.addEventListener('change', (e) => {
      if (e.target.matches('input[type="checkbox"], input[type="radio"]')) {
        this.saveSetting(e.target);
      }
    });
  }

  async show() {
    await this.loadCurrentSettings();
    this.modal.style.display = 'flex';
  }

  close() {
    this.modal.style.display = 'none';
  }

  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.classList.toggle('active', tab.textContent.includes(this.getTabTitle(tabName)));
    });

    // Update panels
    document.querySelectorAll('.settings-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    document.getElementById(`settings-${tabName}`).classList.add('active');

    this.activeTab = tabName;
  }

  async loadCurrentSettings() {
    try {
      const settings = await window.api.invoke('settings:get-all');
      this.currentSettings = settings;
      this.populateForm(settings);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  populateForm(settings) {
    // Network settings
    document.getElementById('testnet-mode').checked = settings.isTestnet;
    document.getElementById('spk-node').value = settings.spkNode;
    document.getElementById('honeygraph-url').value = settings.honeygraphUrl;

    // IPFS settings
    document.querySelector(`input[name="ipfs-mode"][value="${settings.ipfsMode}"]`).checked = true;
    document.getElementById('ipfs-host').value = settings.ipfsHost;
    document.getElementById('ipfs-port').value = settings.ipfsPort;
    document.getElementById('ipfs-data-path').value = settings.ipfsDataPath;
    document.getElementById('max-storage').value = settings.maxStorageGB;
    this.updateStorageDisplay(settings.maxStorageGB);

    // Upload settings
    document.querySelector(`input[name="upload-method"][value="${settings.defaultUploadMethod}"]`).checked = true;
    document.getElementById('auto-select-direct').checked = settings.autoSelectDirect;
    document.getElementById('video-quality').value = settings.videoQuality;
    document.getElementById('transcode-parallel').checked = settings.transcodeParallel;

    // Storage settings
    document.getElementById('enable-storage-node').checked = settings.enableStorageNode;
    document.getElementById('storage-domain').value = settings.storageNodeDomain;
    document.getElementById('storage-bid-rate').value = settings.storageBidRate;
    document.getElementById('auto-start-storage').checked = settings.autoStartStorage;

    // UI settings
    document.getElementById('theme').value = settings.theme;
    document.getElementById('refresh-interval').value = settings.autoRefreshInterval;
    document.getElementById('show-advanced').checked = settings.showAdvancedOptions;
    document.getElementById('confirm-dangerous').checked = settings.confirmDangerousActions;

    // Advanced settings
    document.getElementById('debug-mode').checked = settings.debugMode;
    document.getElementById('log-level').value = settings.logLevel;
    document.getElementById('share-usage-stats').checked = settings.shareUsageStats;

    // Trigger IPFS mode display
    const ipfsModeEvent = new Event('change');
    document.querySelector(`input[name="ipfs-mode"][value="${settings.ipfsMode}"]`).dispatchEvent(ipfsModeEvent);
  }

  async saveSetting(element) {
    const settingMap = {
      'testnet-mode': 'isTestnet',
      'spk-node': 'spkNode',
      'honeygraph-url': 'honeygraphUrl',
      'ipfs-host': 'ipfsHost',
      'ipfs-port': 'ipfsPort',
      'ipfs-data-path': 'ipfsDataPath',
      'max-storage': 'maxStorageGB',
      'auto-select-direct': 'autoSelectDirect',
      'video-quality': 'videoQuality',
      'transcode-parallel': 'transcodeParallel',
      'enable-storage-node': 'enableStorageNode',
      'storage-domain': 'storageNodeDomain',
      'storage-bid-rate': 'storageBidRate',
      'auto-start-storage': 'autoStartStorage',
      'theme': 'theme',
      'refresh-interval': 'autoRefreshInterval',
      'show-advanced': 'showAdvancedOptions',
      'confirm-dangerous': 'confirmDangerousActions',
      'debug-mode': 'debugMode',
      'log-level': 'logLevel',
      'share-usage-stats': 'shareUsageStats'
    };

    let key, value;

    if (element.name === 'ipfs-mode') {
      key = 'ipfsMode';
      value = element.value;
    } else if (element.name === 'upload-method') {
      key = 'defaultUploadMethod';
      value = element.value;
    } else {
      key = settingMap[element.id];
      if (!key) return;

      if (element.type === 'checkbox') {
        value = element.checked;
      } else if (element.type === 'number') {
        value = parseInt(element.value) || 0;
      } else {
        value = element.value;
      }
    }

    try {
      await window.api.invoke('settings:set', { key, value });
      this.currentSettings[key] = value;
    } catch (error) {
      console.error('Failed to save setting:', error);
    }
  }

  updateStorageDisplay(value) {
    document.getElementById('storage-display').textContent = `${value} GB`;
  }

  async chooseDataPath() {
    try {
      const result = await window.api.invoke('dialog:choose-directory');
      if (result.success && result.path) {
        document.getElementById('ipfs-data-path').value = result.path;
        await this.saveSetting(document.getElementById('ipfs-data-path'));
      }
    } catch (error) {
      console.error('Failed to choose directory:', error);
    }
  }

  async exportSettings() {
    try {
      const result = await window.api.invoke('settings:export');
      if (result.success) {
        alert('Settings exported successfully!');
      } else {
        alert('Failed to export settings: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to export settings:', error);
    }
  }

  async importSettings() {
    try {
      const result = await window.api.invoke('settings:import');
      if (result.success) {
        alert('Settings imported successfully! Please restart the app.');
        await this.loadCurrentSettings();
      } else {
        alert('Failed to import settings: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to import settings:', error);
    }
  }

  async resetSettings() {
    if (!confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
      return;
    }

    try {
      await window.api.invoke('settings:reset');
      alert('Settings reset to defaults. Please restart the app.');
      await this.loadCurrentSettings();
    } catch (error) {
      console.error('Failed to reset settings:', error);
    }
  }

  async restartApp() {
    if (confirm('Restart the application to apply all settings changes?')) {
      await window.api.invoke('app:restart');
    }
  }
}

// Create global instance
window.settingsModal = new SettingsModal();

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.settingsModal.init();
});

module.exports = SettingsModal;