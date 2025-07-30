/**
 * File Upload Modal Component
 * Handles drag-and-drop and file selection for direct uploads
 */

class FileUploadModal {
  constructor() {
    this.modal = null;
    this.dropZone = null;
    this.fileList = null;
    this.files = [];
    this.uploadMethod = 'direct'; // default to direct upload
  }

  init() {
    this.createModal();
    this.setupEventListeners();
  }

  createModal() {
    const modalHTML = `
      <div id="file-upload-modal" class="modal" style="display: none;">
        <div class="modal-content file-upload-modal">
          <div class="modal-header">
            <h2>Upload Files</h2>
            <button class="close-btn" onclick="fileUploadModal.close()">&times;</button>
          </div>
          
          <div class="modal-body">
            <!-- Upload Method Selection -->
            <div class="upload-method-section">
              <h3>Upload Method</h3>
              <div class="upload-method-options">
                <label class="upload-method-option">
                  <input type="radio" name="file-upload-method" value="direct" checked>
                  <div class="option-content">
                    <span class="option-title">Direct Upload</span>
                    <span class="option-desc">Pin to your local IPFS node and broadcast to network</span>
                  </div>
                </label>
                <label class="upload-method-option">
                  <input type="radio" name="file-upload-method" value="gateway">
                  <div class="option-content">
                    <span class="option-title">Public Gateway</span>
                    <span class="option-desc">Upload through SPK public nodes</span>
                  </div>
                </label>
              </div>
            </div>

            <!-- Drop Zone -->
            <div id="file-drop-zone" class="file-drop-zone">
              <div class="drop-zone-content">
                <div class="drop-icon">📁</div>
                <h3>Drop files here or click to browse</h3>
                <p>Supported: Images, Videos, Documents, Audio</p>
                <input type="file" id="file-input" multiple style="display: none;">
              </div>
            </div>

            <!-- File List -->
            <div id="selected-files" class="selected-files" style="display: none;">
              <h3>Selected Files</h3>
              <div id="file-list" class="file-list"></div>
              <div class="file-summary">
                <span>Total: <span id="total-files">0</span> files</span>
                <span>Size: <span id="total-size">0 MB</span></span>
                <span>BROCA Cost: <span id="broca-cost">0</span></span>
              </div>
            </div>

            <!-- Upload Progress -->
            <div id="upload-progress-section" class="upload-progress-section" style="display: none;">
              <h3>Upload Progress</h3>
              <div class="progress-bar">
                <div id="upload-progress-bar" class="progress-fill"></div>
              </div>
              <p id="upload-status">Preparing upload...</p>
              <div id="upload-logs" class="upload-logs"></div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="fileUploadModal.close()">Cancel</button>
            <button id="upload-btn" class="btn btn-primary" onclick="fileUploadModal.startUpload()" disabled>
              Upload Files
            </button>
          </div>
        </div>
      </div>
    `;

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Get references
    this.modal = document.getElementById('file-upload-modal');
    this.dropZone = document.getElementById('file-drop-zone');
    this.fileList = document.getElementById('file-list');
  }

  setupEventListeners() {
    const fileInput = document.getElementById('file-input');
    
    // Drop zone click
    this.dropZone.addEventListener('click', () => {
      fileInput.click();
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
      this.handleFiles(e.target.files);
    });

    // Drag and drop
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-over');
    });

    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drag-over');
    });

    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      this.handleFiles(e.dataTransfer.files);
    });

    // Upload method change
    document.querySelectorAll('input[name="file-upload-method"]').forEach(input => {
      input.addEventListener('change', (e) => {
        this.uploadMethod = e.target.value;
        this.updateCostEstimate();
      });
    });
  }

  handleFiles(fileList) {
    this.files = Array.from(fileList);
    this.displayFiles();
    this.updateCostEstimate();
  }

  displayFiles() {
    if (this.files.length === 0) {
      document.getElementById('selected-files').style.display = 'none';
      document.getElementById('upload-btn').disabled = true;
      return;
    }

    document.getElementById('selected-files').style.display = 'block';
    document.getElementById('upload-btn').disabled = false;

    // Clear existing list
    this.fileList.innerHTML = '';

    // Add files to list
    this.files.forEach((file, index) => {
      const fileItem = document.createElement('div');
      fileItem.className = 'file-item';
      fileItem.innerHTML = `
        <div class="file-info">
          <span class="file-icon">${this.getFileIcon(file.type)}</span>
          <div class="file-details">
            <div class="file-name">${file.name}</div>
            <div class="file-size">${this.formatSize(file.size)}</div>
          </div>
        </div>
        <button class="remove-file" onclick="fileUploadModal.removeFile(${index})">×</button>
      `;
      this.fileList.appendChild(fileItem);
    });

    // Update totals
    document.getElementById('total-files').textContent = this.files.length;
    const totalSize = this.files.reduce((sum, file) => sum + file.size, 0);
    document.getElementById('total-size').textContent = this.formatSize(totalSize);
  }

  async updateCostEstimate() {
    if (this.files.length === 0) return;

    try {
      const fileData = this.files.map(f => ({ size: f.size }));
      const result = await window.api.invoke('upload:calculate-direct-cost', { files: fileData });
      
      if (result.success) {
        document.getElementById('broca-cost').textContent = result.data.cost;
      }
    } catch (error) {
      console.error('Failed to calculate cost:', error);
    }
  }

  removeFile(index) {
    this.files.splice(index, 1);
    this.displayFiles();
    this.updateCostEstimate();
  }

  async startUpload() {
    if (this.files.length === 0) return;

    // Show progress section
    document.getElementById('upload-progress-section').style.display = 'block';
    document.getElementById('upload-btn').disabled = true;
    
    const progressBar = document.getElementById('upload-progress-bar');
    const statusText = document.getElementById('upload-status');
    const logsContainer = document.getElementById('upload-logs');
    
    // Clear logs
    logsContainer.innerHTML = '';
    
    function addLog(message, type = 'info') {
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry log-${type}`;
      logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      logsContainer.appendChild(logEntry);
      logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    try {
      // Check availability
      addLog('Checking upload availability...');
      const availability = await window.api.invoke('upload:check-direct-availability');
      
      if (!availability.success || !availability.data.available) {
        throw new Error(availability.data.error || 'Direct upload not available');
      }

      // For direct upload, we need to save files temporarily
      if (this.uploadMethod === 'direct') {
        addLog('Preparing files for direct upload...');
        
        // Create file data array
        const fileData = [];
        for (const file of this.files) {
          const buffer = await file.arrayBuffer();
          fileData.push({
            name: file.name,
            size: file.size,
            type: file.type,
            buffer: buffer
          });
        }

        // Listen for progress events
        window.api.on('upload:direct-progress', (data) => {
          progressBar.style.width = `${data.progress}%`;
          statusText.textContent = data.message;
          addLog(data.message, 'info');
        });

        addLog(`Starting direct upload of ${this.files.length} files...`);
        const result = await window.api.invoke('upload:batch', {
          files: fileData,
          options: {
            uploadMethod: 'direct',
            metadata: {
              source: 'file-browser'
            }
          }
        });

        if (result.success) {
          addLog('Upload completed successfully!', 'success');
          progressBar.style.width = '100%';
          statusText.textContent = 'Upload complete!';
          
          // Show success and close after delay
          setTimeout(() => {
            this.close();
            window.showNotification('Files uploaded successfully!', 'success');
            // Refresh drive if it's open
            if (window.refreshDrive) {
              window.refreshDrive();
            }
          }, 2000);
        } else {
          throw new Error(result.error);
        }
      } else {
        // Public gateway upload
        // TODO: Implement public gateway upload
        throw new Error('Public gateway upload not yet implemented');
      }
    } catch (error) {
      addLog(`Upload failed: ${error.message}`, 'error');
      statusText.textContent = 'Upload failed';
      window.showNotification(`Upload failed: ${error.message}`, 'error');
      document.getElementById('upload-btn').disabled = false;
    }
  }

  getFileIcon(mimeType) {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('document') || mimeType.includes('text')) return '📝';
    if (mimeType.includes('zip') || mimeType.includes('rar')) return '📦';
    return '📎';
  }

  formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  open() {
    this.modal.style.display = 'flex';
    this.files = [];
    this.displayFiles();
    document.getElementById('file-input').value = '';
    document.getElementById('upload-progress-section').style.display = 'none';
  }

  close() {
    this.modal.style.display = 'none';
    // Clean up event listeners
    window.api.removeAllListeners('upload:direct-progress');
  }
}

// Initialize and expose globally
const fileUploadModal = new FileUploadModal();
window.fileUploadModal = fileUploadModal;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => fileUploadModal.init());
} else {
  fileUploadModal.init();
}