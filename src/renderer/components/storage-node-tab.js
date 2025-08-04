const { EventEmitter } = require('events');

/**
 * Storage Node Tab UI Component
 * Displays available contracts for the storage node to join
 */
class StorageNodeTab extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      container: config.container,
      fileSyncService: config.fileSyncService,
      storageNode: config.storageNode,
      spkApiUrl: config.spkApiUrl || 'https://spktest.dlux.io',
      refreshInterval: config.refreshInterval || 2 * 60 * 1000, // 2 minutes
      ...config
    };
    
    if (!this.config.container) {
      throw new Error('Container element is required');
    }
    
    this.container = this.config.container;
    this.contracts = [];
    this.filteredContracts = [];
    this.refreshTimer = null;
    this.isLoading = false;
    
    // Bind methods
    this.handleRefresh = this.handleRefresh.bind(this);
    this.handleJoinContract = this.handleJoinContract.bind(this);
    this.handleSearch = this.handleSearch.bind(this);
    this.handleFilterChange = this.handleFilterChange.bind(this);
    this.handleSortChange = this.handleSortChange.bind(this);
    
    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for real-time updates
   */
  setupEventListeners() {
    // Storage node events
    if (this.config.storageNode) {
      this.config.storageNode.on('started', () => {
        this.updateStorageNodeStatus();
        this.refreshContracts();
      });
      
      this.config.storageNode.on('stopped', () => {
        this.updateStorageNodeStatus();
      });
    }
    
    // File sync service events
    if (this.config.fileSyncService) {
      this.config.fileSyncService.on('started', () => {
        this.updateSyncStatus();
      });
      
      this.config.fileSyncService.on('stopped', () => {
        this.updateSyncStatus();
      });
      
      this.config.fileSyncService.on('sync-complete', (result) => {
        this.updateSyncStatus();
        this.showNotification(`Sync complete: ${result.newPins} new files pinned`);
        this.refreshContracts();
      });
      
      this.config.fileSyncService.on('file-pinned', (event) => {
        this.showPinNotification(event.cid, event.contractId);
      });
    }
  }

  /**
   * Render the storage node tab UI
   */
  render() {
    this.container.innerHTML = `
      <div class="storage-node-tab">
        <header class="tab-header">
          <h2>Storage Node</h2>
          <div class="status-indicators">
            <div class="storage-node-status">
              <span class="status-dot"></span>
              <span class="status-text">Stopped</span>
            </div>
            <div class="sync-status">
              <span class="sync-indicator"></span>
              <span class="sync-text">Not syncing</span>
            </div>
          </div>
        </header>

        <div class="controls-section">
          <button class="refresh-contracts btn-primary" ${this.isLoading ? 'disabled' : ''}>
            <span class="icon">🔄</span>
            Refresh Contracts
          </button>
          <div class="auto-refresh">
            <label>
              <input type="checkbox" class="auto-refresh-toggle" checked>
              Auto-refresh every 2 minutes
            </label>
          </div>
        </div>

        <div class="filters-section">
          <div class="search-container">
            <input type="text" class="search-contracts" placeholder="Search by CID or contract ID...">
          </div>
          <div class="filter-controls">
            <select class="size-filter">
              <option value="all">All sizes</option>
              <option value="small">Small (&lt; 1MB)</option>
              <option value="medium">Medium (1MB - 100MB)</option>
              <option value="large">Large (&gt; 100MB)</option>
            </select>
            <select class="sort-contracts">
              <option value="reward-desc">Highest reward first</option>
              <option value="reward-asc">Lowest reward first</option>
              <option value="size-desc">Largest files first</option>
              <option value="size-asc">Smallest files first</option>
              <option value="urgent">Most urgent first</option>
            </select>
          </div>
        </div>

        <div class="contracts-section">
          <div class="loading" style="display: none;">
            <div class="spinner"></div>
            Loading contracts...
          </div>
          
          <div class="contracts-stats">
            <span class="contracts-count">0 contracts available</span>
            <span class="storage-capacity">Capacity: 0% used</span>
          </div>

          <div class="available-contracts">
            <div class="empty-state" style="display: none;">
              <div class="empty-icon">📦</div>
              <h3>No contracts available</h3>
              <p>There are currently no understored contracts that need additional storage nodes.</p>
            </div>
          </div>
        </div>

        <div class="notifications"></div>
      </div>
    `;

    // Add CSS styles
    this.addStyles();
    
    // Setup event handlers
    this.setupEventHandlers();
    
    // Initial status update
    this.updateStorageNodeStatus();
    this.updateSyncStatus();
    
    // Load contracts
    this.refreshContracts();
    
    // Start auto-refresh if enabled
    this.startAutoRefresh();
  }

  /**
   * Add CSS styles to the component
   */
  addStyles() {
    if (document.getElementById('storage-node-tab-styles')) {
      return; // Styles already added
    }

    const styles = document.createElement('style');
    styles.id = 'storage-node-tab-styles';
    styles.textContent = `
      .storage-node-tab {
        padding: 20px;
        background: #f8f9fa;
        min-height: 100vh;
      }

      .tab-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 15px;
        border-bottom: 2px solid #e9ecef;
      }

      .status-indicators {
        display: flex;
        gap: 20px;
        align-items: center;
      }

      .storage-node-status, .sync-status {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 6px;
        background: white;
        border: 1px solid #dee2e6;
      }

      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #dc3545;
      }

      .status-dot.running {
        background: #28a745;
        animation: pulse 2s infinite;
      }

      .sync-indicator {
        width: 12px;
        height: 12px;
        border: 2px solid #6c757d;
        border-top: 2px solid #007bff;
        border-radius: 50%;
      }

      .sync-indicator.active {
        animation: spin 1s linear infinite;
      }

      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      .controls-section {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding: 15px;
        background: white;
        border-radius: 8px;
        border: 1px solid #dee2e6;
      }

      .refresh-contracts {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border: none;
        border-radius: 6px;
        background: #007bff;
        color: white;
        cursor: pointer;
        font-size: 14px;
      }

      .refresh-contracts:hover:not(:disabled) {
        background: #0056b3;
      }

      .refresh-contracts:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .filters-section {
        display: flex;
        gap: 15px;
        margin-bottom: 20px;
        padding: 15px;
        background: white;
        border-radius: 8px;
        border: 1px solid #dee2e6;
      }

      .search-container {
        flex: 1;
      }

      .search-contracts {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #ced4da;
        border-radius: 4px;
        font-size: 14px;
      }

      .filter-controls {
        display: flex;
        gap: 10px;
      }

      .filter-controls select {
        padding: 8px 12px;
        border: 1px solid #ced4da;
        border-radius: 4px;
        font-size: 14px;
        background: white;
      }

      .contracts-section {
        background: white;
        border-radius: 8px;
        border: 1px solid #dee2e6;
        overflow: hidden;
      }

      .contracts-stats {
        display: flex;
        justify-content: space-between;
        padding: 15px;
        background: #f8f9fa;
        border-bottom: 1px solid #dee2e6;
        font-size: 14px;
        color: #6c757d;
      }

      .loading {
        text-align: center;
        padding: 40px;
        color: #6c757d;
      }

      .spinner {
        display: inline-block;
        width: 20px;
        height: 20px;
        border: 3px solid #f3f3f3;
        border-top: 3px solid #007bff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-right: 10px;
      }

      .empty-state {
        text-align: center;
        padding: 60px 20px;
        color: #6c757d;
      }

      .empty-icon {
        font-size: 48px;
        margin-bottom: 15px;
      }

      .contract-item {
        padding: 20px;
        border-bottom: 1px solid #e9ecef;
        transition: background-color 0.2s;
      }

      .contract-item:hover {
        background: #f8f9fa;
      }

      .contract-item.urgent {
        border-left: 4px solid #dc3545;
      }

      .contract-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 10px;
      }

      .contract-id {
        font-weight: 600;
        color: #495057;
        font-size: 16px;
      }

      .contract-cid {
        font-family: monospace;
        color: #6c757d;
        font-size: 12px;
        margin-top: 4px;
      }

      .contract-actions {
        display: flex;
        gap: 10px;
        align-items: center;
      }

      .join-contract {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        background: #28a745;
        color: white;
        cursor: pointer;
        font-size: 13px;
      }

      .join-contract:hover:not(:disabled) {
        background: #218838;
      }

      .join-contract:disabled {
        background: #6c757d;
        cursor: not-allowed;
      }

      .expand-contract {
        padding: 4px 8px;
        border: 1px solid #ced4da;
        border-radius: 4px;
        background: white;
        cursor: pointer;
        font-size: 12px;
      }

      .contract-info {
        display: flex;
        gap: 20px;
        margin-bottom: 10px;
        font-size: 14px;
        color: #6c757d;
      }

      .contract-details {
        margin-top: 15px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 4px;
        border: 1px solid #e9ecef;
        display: none;
      }

      .contract-details.expanded {
        display: block;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 13px;
      }

      .detail-label {
        font-weight: 500;
        color: #495057;
      }

      .detail-value {
        color: #6c757d;
      }

      .notifications {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1000;
      }

      .notification {
        padding: 12px 16px;
        margin-bottom: 10px;
        border-radius: 6px;
        color: white;
        font-size: 14px;
        min-width: 300px;
        animation: slideIn 0.3s ease-out;
      }

      .notification.success {
        background: #28a745;
      }

      .notification.error {
        background: #dc3545;
      }

      .notification.info {
        background: #17a2b8;
      }

      .pin-notification {
        background: #007bff;
      }

      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      .btn-primary {
        background: #007bff;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      }

      .btn-primary:hover:not(:disabled) {
        background: #0056b3;
      }
    `;

    document.head.appendChild(styles);
  }

  /**
   * Setup event handlers for UI interactions
   */
  setupEventHandlers() {
    // Refresh button
    const refreshBtn = this.container.querySelector('.refresh-contracts');
    refreshBtn.addEventListener('click', this.handleRefresh);
    
    // Auto-refresh toggle
    const autoRefreshToggle = this.container.querySelector('.auto-refresh-toggle');
    autoRefreshToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.startAutoRefresh();
      } else {
        this.stopAutoRefresh();
      }
    });
    
    // Search input
    const searchInput = this.container.querySelector('.search-contracts');
    searchInput.addEventListener('input', this.handleSearch);
    
    // Filter controls
    const sizeFilter = this.container.querySelector('.size-filter');
    sizeFilter.addEventListener('change', this.handleFilterChange);
    
    const sortSelect = this.container.querySelector('.sort-contracts');
    sortSelect.addEventListener('change', this.handleSortChange);
  }

  /**
   * Handle refresh button click
   */
  async handleRefresh() {
    await this.refreshContracts();
  }

  /**
   * Handle search input
   */
  handleSearch(event) {
    const query = event.target.value.toLowerCase();
    this.filterAndDisplayContracts(query);
  }

  /**
   * Handle filter changes
   */
  handleFilterChange() {
    this.filterAndDisplayContracts();
  }

  /**
   * Handle sort changes
   */
  handleSortChange() {
    this.sortAndDisplayContracts();
  }

  /**
   * Start auto-refresh timer
   */
  startAutoRefresh() {
    this.stopAutoRefresh(); // Clear existing timer
    this.refreshTimer = setInterval(() => {
      this.refreshContracts();
    }, this.config.refreshInterval);
  }

  /**
   * Stop auto-refresh timer
   */
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Fetch understored contracts from API
   */
  async fetchUnderstoredContracts() {
    const url = `${this.config.spkApiUrl}/api/spk/contracts/understored`;
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.contracts || [];
    } catch (error) {
      console.error('Failed to fetch understored contracts:', error);
      this.showNotification(`Failed to fetch contracts: ${error.message}`, 'error');
      return [];
    }
  }

  /**
   * Filter out contracts already stored by current node
   */
  filterAvailableContracts(contracts) {
    if (!this.config.storageNode || !this.config.storageNode.config) {
      return contracts;
    }
    
    const currentUsername = this.config.storageNode.config.account;
    
    return contracts.filter(contract => {
      // Check if current node is already in storageNodes array
      const storageNodes = contract.storageNodes || [];
      return !storageNodes.includes(currentUsername);
    });
  }

  /**
   * Refresh contracts from API
   */
  async refreshContracts() {
    if (this.isLoading) {
      return;
    }
    
    this.isLoading = true;
    this.showLoading(true);
    
    try {
      const allContracts = await this.fetchUnderstoredContracts();
      this.contracts = this.filterAvailableContracts(allContracts);
      this.filterAndDisplayContracts();
      
      this.updateContractsStats();
    } catch (error) {
      console.error('Failed to refresh contracts:', error);
      this.showNotification('Failed to refresh contracts', 'error');
    } finally {
      this.isLoading = false;
      this.showLoading(false);
    }
  }

  /**
   * Filter and display contracts based on current filters
   */
  filterAndDisplayContracts(searchQuery = null) {
    let filtered = [...this.contracts];
    
    // Apply search filter
    const search = searchQuery !== null 
      ? searchQuery 
      : this.container.querySelector('.search-contracts').value.toLowerCase();
    
    if (search) {
      filtered = filtered.filter(contract => 
        contract.id.toLowerCase().includes(search) ||
        contract.cid.toLowerCase().includes(search)
      );
    }
    
    // Apply size filter
    const sizeFilter = this.container.querySelector('.size-filter').value;
    if (sizeFilter !== 'all') {
      filtered = filtered.filter(contract => {
        const size = contract.size || 0;
        switch (sizeFilter) {
          case 'small': return size < 1024 * 1024; // < 1MB
          case 'medium': return size >= 1024 * 1024 && size <= 100 * 1024 * 1024; // 1MB-100MB
          case 'large': return size > 100 * 1024 * 1024; // > 100MB
          default: return true;
        }
      });
    }
    
    this.filteredContracts = filtered;
    this.sortAndDisplayContracts();
  }

  /**
   * Sort and display contracts
   */
  sortAndDisplayContracts() {
    const sortBy = this.container.querySelector('.sort-contracts').value;
    
    const sorted = [...this.filteredContracts].sort((a, b) => {
      switch (sortBy) {
        case 'reward-desc':
          return (b.reward || 0) - (a.reward || 0);
        case 'reward-asc':
          return (a.reward || 0) - (b.reward || 0);
        case 'size-desc':
          return (b.size || 0) - (a.size || 0);
        case 'size-asc':
          return (a.size || 0) - (b.size || 0);
        case 'urgent':
          // Most urgent = fewest current nodes relative to required
          const urgencyA = (a.requiredNodes || 3) - (a.currentNodes || 0);
          const urgencyB = (b.requiredNodes || 3) - (b.currentNodes || 0);
          return urgencyB - urgencyA;
        default:
          return 0;
      }
    });
    
    this.displayContracts(sorted);
  }

  /**
   * Display contracts in the UI
   */
  displayContracts(contracts) {
    const container = this.container.querySelector('.available-contracts');
    const emptyState = container.querySelector('.empty-state');
    
    if (contracts.length === 0) {
      emptyState.style.display = 'block';
      // Hide existing contract items
      const existingItems = container.querySelectorAll('.contract-item');
      existingItems.forEach(item => item.remove());
      return;
    }
    
    emptyState.style.display = 'none';
    
    // Clear existing items
    const existingItems = container.querySelectorAll('.contract-item');
    existingItems.forEach(item => item.remove());
    
    // Add contract items
    contracts.forEach(contract => {
      const contractElement = this.createContractElement(contract);
      container.appendChild(contractElement);
    });
  }

  /**
   * Create contract element
   */
  createContractElement(contract) {
    const element = document.createElement('div');
    element.className = 'contract-item';
    
    // Add urgent class if needs many more nodes
    const needed = (contract.requiredNodes || 3) - (contract.currentNodes || 0);
    if (needed >= 2) {
      element.classList.add('urgent');
    }
    
    const storageNodeRunning = this.config.storageNode && this.config.storageNode.running;
    
    element.innerHTML = `
      <div class="contract-header">
        <div class="contract-info-primary">
          <div class="contract-id">${contract.id}</div>
          <div class="contract-cid">${contract.cid}</div>
        </div>
        <div class="contract-actions">
          <button class="expand-contract">Details</button>
          <button class="join-contract" ${!storageNodeRunning ? 'disabled' : ''}>
            Join Contract
          </button>
        </div>
      </div>
      
      <div class="contract-info">
        <span>Size: ${this.formatFileSize(contract.size || 0)}</span>
        <span>Nodes: ${contract.currentNodes || 0}/${contract.requiredNodes || 3}</span>
        <span>Reward: ${contract.reward || 0} BROCA</span>
        <span>Duration: ${contract.duration || 30} days</span>
      </div>
      
      <div class="contract-details">
        <div class="detail-row">
          <span class="detail-label">Contract ID:</span>
          <span class="detail-value">${contract.id}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">CID:</span>
          <span class="detail-value">${contract.cid}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">File Size:</span>
          <span class="detail-value">${this.formatFileSize(contract.size || 0)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Storage Nodes:</span>
          <span class="detail-value">${contract.currentNodes || 0}/${contract.requiredNodes || 3} nodes</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Reward:</span>
          <span class="detail-value">${contract.reward || 0} BROCA</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duration:</span>
          <span class="detail-value">${contract.duration || 30} days</span>
        </div>
        ${contract.metadata && contract.metadata.filename ? `
        <div class="detail-row">
          <span class="detail-label">Filename:</span>
          <span class="detail-value">${contract.metadata.filename}</span>
        </div>
        ` : ''}
        ${contract.metadata && contract.metadata.contentType ? `
        <div class="detail-row">
          <span class="detail-label">Content Type:</span>
          <span class="detail-value">${contract.metadata.contentType}</span>
        </div>
        ` : ''}
      </div>
    `;
    
    // Setup event handlers for this contract
    const expandBtn = element.querySelector('.expand-contract');
    const joinBtn = element.querySelector('.join-contract');
    const details = element.querySelector('.contract-details');
    
    expandBtn.addEventListener('click', () => {
      const isExpanded = details.classList.contains('expanded');
      details.classList.toggle('expanded');
      expandBtn.textContent = isExpanded ? 'Details' : 'Hide';
    });
    
    joinBtn.addEventListener('click', () => {
      this.handleJoinContract(contract);
    });
    
    return element;
  }

  /**
   * Handle joining a contract
   */
  async handleJoinContract(contract) {
    if (!this.config.storageNode || !this.config.storageNode.running) {
      this.showNotification('Storage node must be running to join contracts', 'error');
      return;
    }
    
    // Show confirmation dialog
    const confirmed = window.confirm(
      `Join storage contract?\n\n` +
      `Contract: ${contract.id}\n` +
      `File: ${contract.cid}\n` +
      `Size: ${this.formatFileSize(contract.size || 0)}\n` +
      `Reward: ${contract.reward || 0} BROCA\n` +
      `Duration: ${contract.duration || 30} days\n\n` +
      `This will start pinning the file to your IPFS node.`
    );
    
    if (!confirmed) {
      return;
    }
    
    try {
      // Call API to join contract
      const response = await fetch(`${this.config.spkApiUrl}/api/spk/contracts/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contractId: contract.id,
          storageNode: this.config.storageNode.config.account
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to join contract: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        this.showNotification(`Successfully joined contract ${contract.id}`, 'success');
        
        // Trigger file sync to start pinning
        if (this.config.fileSyncService && this.config.fileSyncService.isRunning()) {
          this.config.fileSyncService.performSync();
        }
        
        // Refresh contracts to update display
        setTimeout(() => {
          this.refreshContracts();
        }, 1000);
      } else {
        throw new Error(result.error || 'Unknown error occurred');
      }
    } catch (error) {
      console.error('Failed to join contract:', error);
      this.showNotification(`Failed to join contract: ${error.message}`, 'error');
    }
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
  }

  /**
   * Update storage node status display
   */
  updateStorageNodeStatus() {
    const statusElement = this.container.querySelector('.storage-node-status');
    const statusDot = statusElement.querySelector('.status-dot');
    const statusText = statusElement.querySelector('.status-text');
    
    if (this.config.storageNode && this.config.storageNode.running) {
      statusDot.classList.add('running');
      statusText.textContent = 'Running';
    } else {
      statusDot.classList.remove('running');
      statusText.textContent = 'Stopped';
    }
  }

  /**
   * Update sync status display
   */
  updateSyncStatus() {
    const syncElement = this.container.querySelector('.sync-status');
    const syncIndicator = syncElement.querySelector('.sync-indicator');
    const syncText = syncElement.querySelector('.sync-text');
    
    if (this.config.fileSyncService) {
      const status = this.config.fileSyncService.getStatus();
      
      if (status.running) {
        syncIndicator.classList.add('active');
        syncText.textContent = `Active (${status.totalPinned} files)`;
      } else {
        syncIndicator.classList.remove('active');
        syncText.textContent = 'Not syncing';
      }
    }
  }

  /**
   * Update contracts statistics display
   */
  updateContractsStats() {
    const statsElement = this.container.querySelector('.contracts-stats');
    const countElement = statsElement.querySelector('.contracts-count');
    
    countElement.textContent = `${this.contracts.length} contracts available`;
    
    // TODO: Add storage capacity display when IPFS manager provides stats
  }

  /**
   * Show/hide loading state
   */
  showLoading(show) {
    const loadingElement = this.container.querySelector('.loading');
    const refreshBtn = this.container.querySelector('.refresh-contracts');
    
    loadingElement.style.display = show ? 'block' : 'none';
    refreshBtn.disabled = show;
  }

  /**
   * Show notification
   */
  showNotification(message, type = 'info') {
    const notificationsContainer = this.container.querySelector('.notifications');
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    notificationsContainer.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);
  }

  /**
   * Show pin notification
   */
  showPinNotification(cid, contractId) {
    const notificationsContainer = this.container.querySelector('.notifications');
    
    const notification = document.createElement('div');
    notification.className = 'notification pin-notification';
    notification.textContent = `Pinned file ${cid.substring(0, 12)}... for contract ${contractId}`;
    
    notificationsContainer.appendChild(notification);
    
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  }

  /**
   * Destroy the component and clean up resources
   */
  destroy() {
    this.stopAutoRefresh();
    
    // Remove event listeners
    if (this.config.storageNode) {
      this.config.storageNode.removeAllListeners();
    }
    
    if (this.config.fileSyncService) {
      this.config.fileSyncService.removeAllListeners();
    }
    
    // Clear container
    this.container.innerHTML = '';
  }
}

module.exports = StorageNodeTab;