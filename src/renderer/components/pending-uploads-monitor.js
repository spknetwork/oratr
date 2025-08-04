/**
 * Pending Uploads Monitor Component
 * Shows uploads waiting for confirmation and prevents retranscoding
 */

class PendingUploadsMonitor {
  constructor() {
    this.uploads = [];
    this.container = null;
    this.refreshInterval = null;
  }

  async init() {
    this.createUI();
    await this.loadPendingUploads();
    this.startAutoRefresh();
  }

  createUI() {
    // Add pending uploads section to the main UI
    const existingContainer = document.getElementById('pending-uploads-container');
    if (existingContainer) {
      this.container = existingContainer;
      return;
    }

    const containerHTML = `
      <div id="pending-uploads-container" class="pending-uploads-section" style="display: none;">
        <div class="section-header">
          <h3>📋 Pending Uploads</h3>
          <button id="pending-uploads-toggle" class="toggle-btn">Show</button>
        </div>
        <div id="pending-uploads-list" class="pending-uploads-list"></div>
      </div>
    `;

    // Insert after the main content
    const mainContent = document.querySelector('.main-content') || document.body;
    mainContent.insertAdjacentHTML('beforeend', containerHTML);

    this.container = document.getElementById('pending-uploads-container');
    
    // Setup toggle button
    document.getElementById('pending-uploads-toggle').addEventListener('click', () => {
      this.toggleVisibility();
    });

    // Add CSS
    this.addStyles();
  }

  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .pending-uploads-section {
        margin: 1rem 0;
        border: 1px solid #ddd;
        border-radius: 8px;
        background: #f8f9fa;
      }
      
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #ddd;
        background: #e9ecef;
        border-radius: 8px 8px 0 0;
      }
      
      .section-header h3 {
        margin: 0;
        font-size: 1rem;
      }
      
      .toggle-btn {
        background: #007bff;
        color: white;
        border: none;
        padding: 0.25rem 0.75rem;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.875rem;
      }
      
      .toggle-btn:hover {
        background: #0056b3;
      }
      
      .pending-uploads-list {
        padding: 1rem;
        max-height: 300px;
        overflow-y: auto;
      }
      
      .pending-upload-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem;
        margin-bottom: 0.5rem;
        background: white;
        border: 1px solid #dee2e6;
        border-radius: 6px;
      }
      
      .upload-info {
        flex: 1;
      }
      
      .upload-title {
        font-weight: 500;
        margin-bottom: 0.25rem;
      }
      
      .upload-details {
        font-size: 0.875rem;
        color: #666;
      }
      
      .upload-status {
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 500;
        text-transform: uppercase;
      }
      
      .status-waiting {
        background: #fff3cd;
        color: #856404;
      }
      
      .status-confirmed {
        background: #d4edda;
        color: #155724;
      }
      
      .status-failed {
        background: #f8d7da;
        color: #721c24;
      }
      
      .upload-actions {
        display: flex;
        gap: 0.5rem;
        margin-left: 1rem;
      }
      
      .action-btn {
        padding: 0.25rem 0.5rem;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.75rem;
      }
      
      .retry-btn {
        background: #ffc107;
        color: #212529;
      }
      
      .remove-btn {
        background: #dc3545;
        color: white;
      }
      
      .view-btn {
        background: #17a2b8;
        color: white;
      }
      
      .empty-state {
        text-align: center;
        color: #666;
        font-style: italic;
        padding: 2rem;
      }
    `;
    document.head.appendChild(style);
  }

  async loadPendingUploads() {
    try {
      const result = await window.api.invoke('pending-uploads:get-all');
      if (result.success) {
        this.uploads = result.data;
        this.updateUI();
        this.updateVisibility();
      }
    } catch (error) {
      console.error('Failed to load pending uploads:', error);
    }
  }

  updateUI() {
    const listContainer = document.getElementById('pending-uploads-list');
    if (!listContainer) return;

    if (this.uploads.length === 0) {
      listContainer.innerHTML = '<div class="empty-state">No pending uploads</div>';
      return;
    }

    listContainer.innerHTML = this.uploads.map(upload => this.createUploadItem(upload)).join('');
  }

  createUploadItem(upload) {
    const statusClass = `status-${upload.status.replace('_', '-')}`;
    const isVideo = upload.type === 'video';
    const fileText = upload.fileCount === 1 ? '1 file' : `${upload.fileCount} files`;
    
    return `
      <div class="pending-upload-item" data-upload-id="${upload.id}">
        <div class="upload-info">
          <div class="upload-title">
            ${isVideo ? '🎥' : '📁'} ${isVideo ? 'Video Upload' : 'File Upload'}
          </div>
          <div class="upload-details">
            ${fileText} • ${this.formatSize(upload.totalSize)} • ${this.formatTime(upload.timestamp)}
            ${upload.transactionId ? `• TX: ${upload.transactionId.substring(0, 12)}...` : ''}
          </div>
        </div>
        <div class="upload-status ${statusClass}">
          ${upload.status.replace('_', ' ')}
        </div>
        <div class="upload-actions">
          ${upload.masterUrl ? `<button class="action-btn view-btn" onclick="pendingUploadsMonitor.viewUpload('${upload.id}')">View</button>` : ''}
          ${upload.status === 'failed' ? `<button class="action-btn retry-btn" onclick="pendingUploadsMonitor.retryUpload('${upload.id}')">Retry</button>` : ''}
          <button class="action-btn remove-btn" onclick="pendingUploadsMonitor.removeUpload('${upload.id}')">Remove</button>
        </div>
      </div>
    `;
  }

  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  formatTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }

  updateVisibility() {
    if (this.uploads.length > 0) {
      this.container.style.display = 'block';
      document.getElementById('pending-uploads-toggle').textContent = 
        this.container.querySelector('.pending-uploads-list').style.display === 'none' ? 'Show' : 'Hide';
    } else {
      this.container.style.display = 'none';
    }
  }

  toggleVisibility() {
    const list = document.getElementById('pending-uploads-list');
    const toggle = document.getElementById('pending-uploads-toggle');
    
    if (list.style.display === 'none') {
      list.style.display = 'block';
      toggle.textContent = 'Hide';
    } else {
      list.style.display = 'none';
      toggle.textContent = 'Show';
    }
  }

  async viewUpload(uploadId) {
    const upload = this.uploads.find(u => u.id === uploadId);
    if (upload && upload.masterUrl) {
      window.open(upload.masterUrl, '_blank');
    }
  }

  async retryUpload(uploadId) {
    try {
      const result = await window.api.invoke('pending-uploads:retry', { uploadId });
      if (result.success) {
        await this.loadPendingUploads();
      }
    } catch (error) {
      console.error('Failed to retry upload:', error);
    }
  }

  async removeUpload(uploadId) {
    if (!confirm('Remove this upload from the pending list?')) return;
    
    try {
      const result = await window.api.invoke('pending-uploads:remove', { uploadId });
      if (result.success) {
        await this.loadPendingUploads();
      }
    } catch (error) {
      console.error('Failed to remove upload:', error);
    }
  }

  startAutoRefresh() {
    // Refresh every 30 seconds
    this.refreshInterval = setInterval(() => {
      this.loadPendingUploads();
    }, 30000);
  }

  destroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  /**
   * Check if a video file has a pending upload
   * This prevents retranscoding
   */
  async checkForPendingVideoUpload(videoPath) {
    try {
      const result = await window.api.invoke('pending-uploads:check-video', { videoPath });
      return result.success ? result.data : null;
    } catch (error) {
      console.error('Failed to check for pending video upload:', error);
      return null;
    }
  }
}

// Auto-initialize
document.addEventListener('DOMContentLoaded', () => {
  window.pendingUploadsMonitor = new PendingUploadsMonitor();
  window.pendingUploadsMonitor.init();
});

window.PendingUploadsMonitor = PendingUploadsMonitor;