/**
 * Settings Modal Component
 * Provides UI for configuring application settings
 */

class SettingsModal {
  constructor() {
    this.modal = null;
    this.currentSettings = {};
    // Primary sections in sidebar
    this.tabs = ['network', 'ipfs', 'storage', 'webdav', 'upload'];
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
            <aside class="settings-sidebar">
              <nav class="nav-list">
                ${this.tabs.map(tab => `
                  <button class="settings-tab ${tab === this.activeTab ? 'active' : ''}" onclick="settingsModal.switchTab('${tab}')">
                    <span class="icon">${this.getTabIcon(tab)}</span>
                    <span class="label">${this.getTabTitle(tab)}</span>
                  </button>
                `).join('')}
              </nav>
              <div class="sidebar-footer">
                <button class="sidebar-btn" onclick="window.authComponent && window.authComponent.showAccountManager()">
                  👤 Account
                </button>
                <button class="sidebar-btn" onclick="settingsModal.close()">
                  ✖ Close
                </button>
              </div>
            </aside>

              <div class="settings-content-area">
              <div id="settings-network" class="settings-panel active">
                <h3>🌐 Network Settings</h3>
                
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

                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="testnet-mode"> Use SPK Testnet
                    <small>Enable to use the test network (recommended for development)</small>
                  </label>
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
                  <label>Current Connection:</label>
                  <div class="info-grid">
                    <div><strong>Status:</strong> <span id="ipfs-status">Unknown</span></div>
                    <div><strong>Peer ID:</strong> <span id="ipfs-peerid">-</span></div>
                    <div><strong>API:</strong> <span id="ipfs-endpoint">-</span></div>
                    <div><strong>Repo Path:</strong> <span id="ipfs-repo-path">-</span></div>
                    <div><strong>Repo Size:</strong> <span id="ipfs-repo-size">-</span></div>
                    <div><strong>Storage Limit:</strong> <span id="ipfs-storage-limit">-</span></div>
                  </div>
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
                  <label class="setting-label">
                    <input type="checkbox" id="auto-start-storage"> Auto-start storage node on app launch
                  </label>
                </div>

                <div class="setting-group">
                  <label>Registered Account:</label>
                  <input type="text" id="storage-registered-account" readonly>
                </div>

                <div class="setting-group">
                  <label>Max Storage for Node (GB):</label>
                  <input type="number" id="node-max-storage" min="1" max="10000" step="1">
                  <small>Upper limit for local storage used by IPFS repo (app-enforced)</small>
                </div>
              </div>

              <div id="settings-webdav" class="settings-panel">
                <h3>🗂️ WebDAV</h3>
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="webdav-enabled"> Enable WebDAV server
                  </label>
                </div>
                <div class="setting-group">
                  <label>Port:</label>
                  <input type="number" id="webdav-port" min="1" max="65535" placeholder="4819">
                </div>
                <div class="setting-group">
                  <label class="setting-label">
                    <input type="checkbox" id="webdav-require-auth"> Require authentication
                  </label>
                </div>
                <div class="setting-group" id="webdav-auth-credentials" style="display:none;">
                  <label>Username:</label>
                  <input type="text" id="webdav-username" placeholder="">
                  <label>Password:</label>
                  <input type="password" id="webdav-password" placeholder="">
                </div>
                <div class="setting-group">
                  <label>Status:</label>
                  <div class="info-grid">
                    <div><strong>Running:</strong> <span id="webdav-running">No</span></div>
                    <div><strong>Listening on:</strong> <span id="webdav-listen">-</span></div>
                  </div>
                </div>
                <div class="setting-group">
                  <label>Mount URL:</label>
                  <div class="path-input">
                    <input type="text" id="webdav-mount-url" readonly>
                    <button id="copy-webdav-url">Copy</button>
                  </div>
                  <small>Use this URL in your OS WebDAV client (replace <username> if blank).</small>
                </div>
              </div>
              
              <!-- The UI and Advanced panels are still supported; they will render if switchTab is invoked via code -->
              <div id="settings-ui" class="settings-panel"></div>
              <div id="settings-advanced" class="settings-panel"></div>
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
        background: var(--panel-bg, #121418);
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.06);
      }
      
      .settings-modal .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        background: transparent;
        color: var(--text, #e6e8eb);
      }

      .settings-modal .modal-header .close-btn {
        border: none;
        background: transparent;
        font-size: 1.5rem;
        line-height: 1;
        cursor: pointer;
        color: #9aa3ad;
      }

      .settings-body {
        display: flex;
        flex: 1;
        overflow: hidden;
      }
      
      .settings-sidebar {
        min-width: 240px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        background: rgba(255,255,255,0.03);
        border-right: 1px solid rgba(255,255,255,0.08);
      }

      .settings-sidebar .nav-list {
        display: flex;
        flex-direction: column;
        padding: 0.5rem;
        gap: 0.25rem;
        overflow-y: auto;
      }
      
      .settings-tab {
        display: block;
        width: 100%;
        padding: 0.65rem 0.9rem;
        border: none;
        background: transparent;
        text-align: left;
        cursor: pointer;
        transition: background-color 0.2s;
        font-size: 0.9rem;
        color: #c8d0d8;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      
      .settings-tab:hover {
        background: rgba(255,255,255,0.06);
      }
      
      .settings-tab.active {
        background: linear-gradient(90deg, rgba(0,123,255,0.25), rgba(0,123,255,0.05));
        color: #fff;
        box-shadow: inset 0 0 0 1px rgba(0,123,255,0.35);
      }
      
      .settings-content-area {
        flex: 1;
        overflow-y: auto;
        padding: 1.5rem;
        background: transparent;
        color: var(--text, #e6e8eb);
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
        border: 1px solid rgba(255,255,255,0.15);
        background: rgba(255,255,255,0.06);
        color: #e6e8eb;
        border-radius: 6px;
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

      .info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.5rem 1rem;
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
        background: rgba(0,123,255,0.18);
        color: #e6e8eb;
        border: none;
        border-radius: 6px;
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
        border: 1px solid rgba(255,255,255,0.15);
        background: rgba(255,255,255,0.06);
        color: #e6e8eb;
        border-radius: 6px;
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
        border-top: 1px solid rgba(255,255,255,0.08);
        background: transparent;
        color: #9aa3ad;
      }

      .sidebar-footer {
        padding: 0.5rem;
        border-top: 1px solid rgba(255,255,255,0.08);
        display: grid;
        gap: 0.4rem;
      }
      .sidebar-btn {
        padding: 0.55rem 0.75rem;
        background: rgba(255,255,255,0.06);
        color: #e6e8eb;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px;
        text-align: left;
        cursor: pointer;
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
        .settings-sidebar {
          min-width: unset;
          border-right: none;
          border-bottom: 1px solid rgba(255,255,255,0.08);
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
      webdav: '🗂️',
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
      webdav: 'WebDAV',
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

    // WebDAV auth toggle
    this.modal.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'webdav-require-auth') {
        const creds = document.getElementById('webdav-auth-credentials');
        creds.style.display = e.target.checked ? 'block' : 'none';
      }
      if (e.target && e.target.id === 'testnet-mode') {
        // Auto-switch endpoints on toggle
        const checked = e.target.checked;
        const spkNode = document.getElementById('spk-node');
        const honey = document.getElementById('honeygraph-url');
        if (checked) {
          spkNode.value = 'https://spktest.dlux.io';
          honey.value = 'https://honeygraph.dlux.io';
        } else {
          // Placeholder mainnet defaults; adjust when production endpoints exist
          spkNode.value = 'https://spk.dlux.io';
          honey.value = 'https://honeygraph.dlux.io';
        }
        // Persist both values immediately
        this.saveSetting(spkNode);
        this.saveSetting(honey);
      }
    });

    // Copy WebDAV mount URL
    this.modal.addEventListener('click', async (e) => {
      const target = e.target;
      if (target && target.id === 'copy-webdav-url') {
        const input = document.getElementById('webdav-mount-url');
        if (!input || !input.value) return;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(input.value);
          } else {
            input.select();
            document.execCommand('copy');
          }
          const original = target.textContent;
          target.textContent = 'Copied!';
          setTimeout(() => { target.textContent = original; }, 1200);
        } catch (_) {}
      }
    });

    // Update mount URL when active account changes
    window.addEventListener('active-account-changed', () => {
      this.refreshWebDavMountUrl().catch(()=>{});
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

    // IPFS live info
    this.refreshIPFSInfo();

    // Upload settings
    document.querySelector(`input[name="upload-method"][value="${settings.defaultUploadMethod}"]`).checked = true;
    document.getElementById('auto-select-direct').checked = settings.autoSelectDirect;
    document.getElementById('video-quality').value = settings.videoQuality;
    document.getElementById('transcode-parallel').checked = settings.transcodeParallel;

    // Storage settings
    document.getElementById('enable-storage-node').checked = settings.enableStorageNode;
    document.getElementById('auto-start-storage').checked = settings.autoStartStorage;

    // Storage extras
    this.populateStorageExtras();

    // WebDAV settings
    const webdavEnabledEl = document.getElementById('webdav-enabled');
    const webdavPortEl = document.getElementById('webdav-port');
    const webdavRequireAuthEl = document.getElementById('webdav-require-auth');
    const webdavUserEl = document.getElementById('webdav-username');
    const webdavPassEl = document.getElementById('webdav-password');
    webdavEnabledEl.checked = !!settings.webdavEnabled;
    webdavPortEl.value = settings.webdavPort || 4819;
    webdavRequireAuthEl.checked = !!settings.webdavRequireAuth;
    webdavUserEl.value = settings.webdavUsername || '';
    webdavPassEl.value = settings.webdavPassword || '';
    document.getElementById('webdav-auth-credentials').style.display = webdavRequireAuthEl.checked ? 'block' : 'none';
    this.refreshWebDavStatus();
    this.refreshWebDavMountUrl();

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
      'auto-start-storage': 'autoStartStorage',
      'theme': 'theme',
      'refresh-interval': 'autoRefreshInterval',
      'show-advanced': 'showAdvancedOptions',
      'confirm-dangerous': 'confirmDangerousActions',
      'debug-mode': 'debugMode',
      'log-level': 'logLevel',
      'share-usage-stats': 'shareUsageStats',
      // WebDAV
      'webdav-enabled': 'webdavEnabled',
      'webdav-port': 'webdavPort',
      'webdav-require-auth': 'webdavRequireAuth',
      'webdav-username': 'webdavUsername',
      'webdav-password': 'webdavPassword',
      // Storage extras
      'node-max-storage': 'maxStorageGB'
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
      if (key.startsWith('webdav')) {
        // Apply immediately via service
        await window.api.invoke('webdav:configure', {
          port: Number(document.getElementById('webdav-port').value) || 4819,
          requireAuth: document.getElementById('webdav-require-auth').checked,
          username: document.getElementById('webdav-username').value,
          password: document.getElementById('webdav-password').value
        });
        // Start/stop based on enabled
        if (document.getElementById('webdav-enabled').checked) {
          await window.api.invoke('webdav:start');
        } else {
          await window.api.invoke('webdav:stop');
        }
        this.refreshWebDavStatus();
        this.refreshWebDavMountUrl();
      }
    } catch (error) {
      console.error('Failed to save setting:', error);
    }
  }

  async refreshIPFSInfo() {
    try {
      const [config, status, stats] = await Promise.all([
        window.api.ipfs.getConfig(),
        window.api.ipfs.getNodeInfo().catch(() => null),
        window.api.ipfs.getRepoStats().catch(() => null)
      ]);
      document.getElementById('ipfs-status').textContent = status && status.id ? 'Connected' : 'Not Connected';
      document.getElementById('ipfs-peerid').textContent = status && status.id ? String(status.id) : '-';
      document.getElementById('ipfs-endpoint').textContent = `${config.host}:${config.port}`;
      document.getElementById('ipfs-repo-path').textContent = stats?.repoPath || (config?.dataPath || '-');
      const repoSize = stats?.repoSize || 0;
      document.getElementById('ipfs-repo-size').textContent = this.formatGB(repoSize);
      const limitBytes = (this.currentSettings.maxStorageGB || 0) * 1024 * 1024 * 1024;
      document.getElementById('ipfs-storage-limit').textContent = limitBytes ? this.formatGB(limitBytes) : '-';
    } catch (_) {}
  }

  formatGB(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  }

  async populateStorageExtras() {
    try {
      const poaCfg = await window.api.poa.getConfig();
      const acct = poaCfg?.account || '';
      const input = document.getElementById('storage-registered-account');
      if (input) input.value = acct || 'Not registered';
      const maxEl = document.getElementById('node-max-storage');
      if (maxEl) maxEl.value = this.currentSettings.maxStorageGB || 100;
    } catch (_) {}
  }

  async refreshWebDavStatus() {
    try {
      const status = await window.api.invoke('webdav:status');
      document.getElementById('webdav-running').textContent = status.running ? 'Yes' : 'No';
      document.getElementById('webdav-listen').textContent = status.running ? `http://127.0.0.1:${status.port}` : '-';
    } catch (_) {}
  }

  async refreshWebDavMountUrl() {
    try {
      const status = await window.api.invoke('webdav:status');
      const port = Number(status?.port || this.currentSettings.webdavPort || 4819);
      let username = '';
      try {
        const active = await window.api.account.getActive();
        username = active?.username || '';
      } catch (_) {}
      const userSegment = username || '<username>';
      const url = `http://127.0.0.1:${port}/${encodeURIComponent(userSegment)}`;
      const input = document.getElementById('webdav-mount-url');
      if (input) input.value = url;
    } catch (_) {}
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