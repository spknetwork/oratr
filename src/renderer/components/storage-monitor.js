/**
 * Storage Monitor Component
 * UI for monitoring storage node performance and rewards
 */
class StorageMonitor {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.stats = null;
    this.earnings = null;
    this.updateInterval = null;
    
    // IPC renderer for communication with main process
    this.ipcRenderer = window.require ? window.require('electron').ipcRenderer : null;
    
    this.init();
  }

  /**
   * Initialize the component
   */
  async init() {
    this.render();
    this.setupEventListeners();
    await this.loadData();
    
    // Start auto-refresh
    this.startAutoRefresh();
  }

  /**
   * Render the UI
   */
  render() {
    this.container.innerHTML = `
      <div class="storage-monitor">
        <div class="storage-header">
          <h2>Storage Node Monitor</h2>
          <div class="storage-status">
            <span class="status-indicator" id="storage-status"></span>
            <span id="status-text">Checking...</span>
          </div>
        </div>

        <div class="storage-grid">
          <!-- Storage Stats -->
          <div class="storage-card">
            <h3>Storage Statistics</h3>
            <div class="stats-grid">
              <div class="stat">
                <span class="stat-label">Files Stored</span>
                <span class="stat-value" id="files-stored">-</span>
              </div>
              <div class="stat">
                <span class="stat-label">Space Used</span>
                <span class="stat-value" id="space-used">-</span>
              </div>
              <div class="stat">
                <span class="stat-label">Space Available</span>
                <span class="stat-value" id="space-available">-</span>
              </div>
              <div class="stat">
                <span class="stat-label">Active Contracts</span>
                <span class="stat-value" id="active-contracts">-</span>
              </div>
            </div>
          </div>

          <!-- Earnings -->
          <div class="storage-card">
            <h3>Earnings</h3>
            <div class="earnings-display">
              <div class="total-earnings">
                <span class="earnings-value" id="total-earned">0</span>
                <span class="earnings-unit">SPK</span>
              </div>
              <div class="earnings-stats">
                <div class="stat">
                  <span class="stat-label">Validations</span>
                  <span class="stat-value" id="total-validations">0</span>
                </div>
                <div class="stat">
                  <span class="stat-label">Daily Rate</span>
                  <span class="stat-value" id="daily-rate">0 SPK</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Network Info -->
          <div class="storage-card">
            <h3>Network Status</h3>
            <div class="network-info">
              <div class="stat">
                <span class="stat-label">IPFS Peers</span>
                <span class="stat-value" id="peer-count">0</span>
              </div>
              <div class="stat">
                <span class="stat-label">Bandwidth In</span>
                <span class="stat-value" id="bandwidth-in">0 MB</span>
              </div>
              <div class="stat">
                <span class="stat-label">Bandwidth Out</span>
                <span class="stat-value" id="bandwidth-out">0 MB</span>
              </div>
              <div class="stat">
                <span class="stat-label">BROCA Cost</span>
                <span class="stat-value" id="broca-cost">0</span>
              </div>
            </div>
          </div>

          <!-- Recent Activity -->
          <div class="storage-card wide">
            <h3>Recent Activity</h3>
            <div class="activity-log" id="activity-log">
              <div class="activity-empty">No recent activity</div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="storage-actions">
          <button class="btn btn-primary" onclick="storageMonitor.optimizeStorage()">
            Optimize Storage
          </button>
          <button class="btn btn-secondary" onclick="storageMonitor.showRewardHistory()">
            Reward History
          </button>
          <button class="btn btn-secondary" onclick="storageMonitor.refresh()">
            Refresh
          </button>
        </div>

        <!-- Reward History Modal -->
        <div class="modal" id="reward-history-modal" style="display: none;">
          <div class="modal-content">
            <div class="modal-header">
              <h3>Reward History (30 Days)</h3>
              <span class="close" onclick="storageMonitor.closeModal()">&times;</span>
            </div>
            <div class="modal-body">
              <canvas id="reward-chart"></canvas>
            </div>
          </div>
        </div>
      </div>

      <style>
        .storage-monitor {
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .storage-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
        }

        .storage-status {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .status-indicator {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background-color: #ccc;
        }

        .status-indicator.active {
          background-color: #4CAF50;
        }

        .storage-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }

        .storage-card {
          background: #f8f9fa;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .storage-card.wide {
          grid-column: 1 / -1;
        }

        .storage-card h3 {
          margin: 0 0 15px 0;
          font-size: 18px;
          color: #333;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }

        .stat {
          display: flex;
          flex-direction: column;
        }

        .stat-label {
          font-size: 12px;
          color: #666;
          margin-bottom: 5px;
        }

        .stat-value {
          font-size: 20px;
          font-weight: 600;
          color: #333;
        }

        .earnings-display {
          text-align: center;
        }

        .total-earnings {
          margin-bottom: 20px;
        }

        .earnings-value {
          font-size: 36px;
          font-weight: 700;
          color: #4CAF50;
        }

        .earnings-unit {
          font-size: 18px;
          color: #666;
          margin-left: 5px;
        }

        .earnings-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }

        .activity-log {
          max-height: 200px;
          overflow-y: auto;
        }

        .activity-item {
          padding: 8px;
          border-bottom: 1px solid #e0e0e0;
          font-size: 14px;
        }

        .activity-item:last-child {
          border-bottom: none;
        }

        .activity-time {
          color: #666;
          font-size: 12px;
        }

        .activity-empty {
          text-align: center;
          color: #999;
          padding: 20px;
        }

        .storage-actions {
          display: flex;
          gap: 10px;
          justify-content: center;
        }

        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .btn-primary {
          background-color: #007bff;
          color: white;
        }

        .btn-primary:hover {
          background-color: #0056b3;
        }

        .btn-secondary {
          background-color: #6c757d;
          color: white;
        }

        .btn-secondary:hover {
          background-color: #545b62;
        }

        .modal {
          position: fixed;
          z-index: 1000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0,0,0,0.4);
        }

        .modal-content {
          background-color: #fefefe;
          margin: 15% auto;
          padding: 0;
          border-radius: 8px;
          width: 80%;
          max-width: 600px;
        }

        .modal-header {
          padding: 20px;
          border-bottom: 1px solid #e0e0e0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .modal-body {
          padding: 20px;
        }

        .close {
          color: #aaa;
          font-size: 28px;
          font-weight: bold;
          cursor: pointer;
        }

        .close:hover {
          color: #000;
        }
      </style>
    `;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    if (!this.ipcRenderer) return;

    // Listen for real-time updates
    this.ipcRenderer.on('storage:peer-count', (event, count) => {
      this.updatePeerCount(count);
    });

    this.ipcRenderer.on('storage:validation', (event, data) => {
      this.addActivity('Validation completed', 'validation');
    });

    this.ipcRenderer.on('storage:earnings-update', (event, data) => {
      this.updateEarnings(data);
    });

    this.ipcRenderer.on('storage:file-replicated', (event, contract) => {
      this.addActivity(`Replicated file: ${contract.cid.substring(0, 8)}...`, 'replication');
    });

    this.ipcRenderer.on('storage:upload-complete', (event, result) => {
      this.addActivity(`Upload complete: ${result.files.length} files`, 'upload');
      this.refresh();
    });
  }

  /**
   * Load initial data
   */
  async loadData() {
    try {
      // Get storage stats
      this.stats = await this.ipcRenderer.invoke('storage:get-stats');
      this.updateStorageStats();

      // Get earnings
      this.earnings = await this.ipcRenderer.invoke('storage:get-earnings');
      this.updateEarnings(this.earnings);

      // Get bandwidth
      const bandwidth = await this.ipcRenderer.invoke('storage:get-bandwidth');
      this.updateBandwidth(bandwidth);

      // Get status
      const status = await this.ipcRenderer.invoke('storage:get-status');
      this.updateStatus(status);

    } catch (error) {
      console.error('Failed to load storage data:', error);
      this.showError('Failed to load storage data');
    }
  }

  /**
   * Update storage statistics
   */
  updateStorageStats() {
    if (!this.stats) return;

    document.getElementById('files-stored').textContent = 
      this.stats.poa.filesStored || '0';
    
    document.getElementById('space-used').textContent = 
      this.formatBytes(this.stats.poa.spaceUsed || 0);
    
    document.getElementById('space-available').textContent = 
      this.formatBytes(this.stats.poa.spaceAvailable || 0);
    
    document.getElementById('active-contracts').textContent = 
      this.stats.contracts.active || '0';
  }

  /**
   * Update earnings display
   */
  updateEarnings(earnings) {
    if (!earnings) return;

    document.getElementById('total-earned').textContent = 
      earnings.totalEarned.toFixed(3);
    
    document.getElementById('total-validations').textContent = 
      earnings.validations || '0';
    
    // Calculate daily rate (simplified)
    const dailyRate = earnings.totalEarned / 30; // Assume 30 days
    document.getElementById('daily-rate').textContent = 
      `${dailyRate.toFixed(3)} SPK`;
  }

  /**
   * Update bandwidth display
   */
  updateBandwidth(bandwidth) {
    if (!bandwidth) return;

    document.getElementById('bandwidth-in').textContent = 
      this.formatBytes(parseInt(bandwidth.totalIn));
    
    document.getElementById('bandwidth-out').textContent = 
      this.formatBytes(parseInt(bandwidth.totalOut));
    
    document.getElementById('broca-cost').textContent = 
      bandwidth.estimatedCost || '0';
  }

  /**
   * Update peer count
   */
  updatePeerCount(count) {
    document.getElementById('peer-count').textContent = count;
  }

  /**
   * Update status
   */
  updateStatus(status) {
    const indicator = document.getElementById('storage-status');
    const text = document.getElementById('status-text');

    if (status.ipfs.running && status.poa.running) {
      indicator.classList.add('active');
      text.textContent = 'Active';
    } else {
      indicator.classList.remove('active');
      text.textContent = 'Inactive';
    }
  }

  /**
   * Add activity to log
   */
  addActivity(message, type) {
    const log = document.getElementById('activity-log');
    const timestamp = new Date().toLocaleTimeString();
    
    // Remove empty message if present
    const empty = log.querySelector('.activity-empty');
    if (empty) empty.remove();

    // Add new activity
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <div>${message}</div>
      <div class="activity-time">${timestamp}</div>
    `;
    
    // Add to top of log
    log.insertBefore(item, log.firstChild);
    
    // Keep only last 50 items
    while (log.children.length > 50) {
      log.removeChild(log.lastChild);
    }
  }

  /**
   * Optimize storage
   */
  async optimizeStorage() {
    try {
      const result = await this.ipcRenderer.invoke('storage:optimize');
      this.addActivity(`Optimization complete: ${result.removed} files removed`, 'optimize');
      await this.refresh();
    } catch (error) {
      console.error('Optimization failed:', error);
      this.showError('Optimization failed');
    }
  }

  /**
   * Show reward history
   */
  async showRewardHistory() {
    try {
      const history = await this.ipcRenderer.invoke('storage:get-reward-history', 30);
      this.displayRewardChart(history);
      document.getElementById('reward-history-modal').style.display = 'block';
    } catch (error) {
      console.error('Failed to load reward history:', error);
      this.showError('Failed to load reward history');
    }
  }

  /**
   * Display reward chart
   */
  displayRewardChart(history) {
    const canvas = document.getElementById('reward-chart');
    const ctx = canvas.getContext('2d');
    
    // Simple line chart (in production, use Chart.js or similar)
    canvas.width = 560;
    canvas.height = 300;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw axes
    ctx.beginPath();
    ctx.moveTo(40, 260);
    ctx.lineTo(520, 260);
    ctx.moveTo(40, 20);
    ctx.lineTo(40, 260);
    ctx.stroke();
    
    // Plot earnings
    const maxEarnings = Math.max(...history.map(h => h.earnings));
    const xStep = 480 / history.length;
    const yScale = 220 / maxEarnings;
    
    ctx.beginPath();
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    
    history.forEach((day, index) => {
      const x = 40 + (index * xStep);
      const y = 260 - (day.earnings * yScale);
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();
    
    // Add labels
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.fillText('Earnings (SPK)', 10, 140);
    ctx.fillText('Days', 280, 280);
  }

  /**
   * Close modal
   */
  closeModal() {
    document.getElementById('reward-history-modal').style.display = 'none';
  }

  /**
   * Refresh data
   */
  async refresh() {
    await this.loadData();
  }

  /**
   * Start auto refresh
   */
  startAutoRefresh() {
    this.updateInterval = setInterval(() => {
      this.refresh();
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop auto refresh
   */
  stopAutoRefresh() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Show error message
   */
  showError(message) {
    this.addActivity(`Error: ${message}`, 'error');
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stopAutoRefresh();
    if (this.ipcRenderer) {
      this.ipcRenderer.removeAllListeners();
    }
  }
}

// Make it available globally
window.StorageMonitor = StorageMonitor;