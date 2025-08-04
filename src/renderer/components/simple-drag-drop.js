/**
 * Simplified Drag & Drop Upload Component
 * ONE-CLICK upload using streamlined DirectUploadService
 */

class SimpleDragDropUpload {
  constructor() {
    this.dragOverlay = null;
    this.uploadInProgress = false;
  }

  init() {
    this.createDragOverlay();
    this.setupGlobalDragAndDrop();
  }

  createDragOverlay() {
    const overlayHTML = `
      <div id="drag-upload-overlay" class="drag-upload-overlay" style="display: none;">
        <div class="drag-upload-content">
          <div class="drag-upload-icon">📁</div>
          <h2>Drop files to upload to SPK Network</h2>
          <p>Files will be uploaded directly using your local IPFS node</p>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', overlayHTML);
    this.dragOverlay = document.getElementById('drag-upload-overlay');

    // Add CSS
    const style = document.createElement('style');
    style.textContent = `
      .drag-upload-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 123, 255, 0.9);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(5px);
      }
      
      .drag-upload-content {
        text-align: center;
        color: white;
        max-width: 400px;
        padding: 2rem;
        border: 2px dashed white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
      }
      
      .drag-upload-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
      }
      
      .upload-progress-toast {
        position: fixed;
        top: 20px;
        right: 20px;
        background: #007bff;
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10001;
        min-width: 300px;
      }
      
      .upload-progress-bar {
        width: 100%;
        height: 4px;
        background: rgba(255,255,255,0.3);
        border-radius: 2px;
        margin-top: 0.5rem;
        overflow: hidden;
      }
      
      .upload-progress-fill {
        height: 100%;
        background: white;
        transition: width 0.3s ease;
      }
    `;
    document.head.appendChild(style);
  }

  setupGlobalDragAndDrop() {
    let dragCounter = 0;

    // Prevent default drag behaviors on the entire document
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());

    // Show overlay when dragging starts
    document.addEventListener('dragenter', (e) => {
      if (this.uploadInProgress) return;
      
      dragCounter++;
      if (e.dataTransfer.types.includes('Files')) {
        this.dragOverlay.style.display = 'flex';
      }
    });

    // Hide overlay when dragging leaves
    document.addEventListener('dragleave', () => {
      if (this.uploadInProgress) return;
      
      dragCounter--;
      if (dragCounter === 0) {
        this.dragOverlay.style.display = 'none';
      }
    });

    // Handle the drop
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (this.uploadInProgress) return;
      
      dragCounter = 0;
      this.dragOverlay.style.display = 'none';

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        await this.uploadFiles(files);
      }
    });
  }

  async uploadFiles(files) {
    if (this.uploadInProgress) return;
    
    this.uploadInProgress = true;
    
    // Show progress toast
    const toast = this.createProgressToast();
    
    try {
      // Convert File objects to the format expected by our service
      const fileData = files.map(file => ({
        name: file.name,
        size: file.size,
        arrayBuffer: () => file.arrayBuffer()
      }));
      
      // Set up progress listener
      const progressHandler = (data) => {
        this.updateProgress(toast, data);
      };
      
      // Call our streamlined upload service
      const result = await window.api.invoke('upload:direct-simple', {
        files: fileData,
        options: {}
      }, progressHandler);
      
      if (result.success) {
        this.showSuccess(toast, result.data);
      } else {
        this.showError(toast, result.error);
      }
      
    } catch (error) {
      this.showError(toast, error.message);
    } finally {
      this.uploadInProgress = false;
      // Auto-hide toast after 5 seconds
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 5000);
    }
  }

  createProgressToast() {
    const toast = document.createElement('div');
    toast.className = 'upload-progress-toast';
    toast.innerHTML = `
      <div class="upload-status">Preparing upload...</div>
      <div class="upload-progress-bar">
        <div class="upload-progress-fill" style="width: 0%"></div>
      </div>
    `;
    
    document.body.appendChild(toast);
    return toast;
  }

  updateProgress(toast, data) {
    const statusDiv = toast.querySelector('.upload-status');
    const progressFill = toast.querySelector('.upload-progress-fill');
    
    statusDiv.textContent = data.message || `${data.stage}: ${data.progress}%`;
    progressFill.style.width = `${data.progress}%`;
  }

  showSuccess(toast, data) {
    toast.style.background = '#28a745';
    toast.innerHTML = `
      <div class="upload-status">✅ Upload Complete!</div>
      <div style="font-size: 0.9em; margin-top: 0.5rem; opacity: 0.9;">
        ${data.files.length} files uploaded<br>
        Transaction: ${data.transactionId ? data.transactionId.substring(0, 12) + '...' : 'Processing'}
      </div>
    `;
  }

  showError(toast, error) {
    toast.style.background = '#dc3545';
    toast.innerHTML = `
      <div class="upload-status">❌ Upload Failed</div>
      <div style="font-size: 0.9em; margin-top: 0.5rem; opacity: 0.9;">
        ${error}
      </div>
    `;
  }
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.simpleDragDrop = new SimpleDragDropUpload();
  window.simpleDragDrop.init();
});

// For manual initialization
window.SimpleDragDropUpload = SimpleDragDropUpload;