/**
 * Pending Uploads Manager
 * Tracks uploads waiting for network confirmation and prevents retranscoding
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class PendingUploadsManager extends EventEmitter {
  constructor() {
    super();
    this.pendingUploads = new Map();
    this.storageFile = path.join(os.homedir(), '.spk-desktop', 'pending-uploads.json');
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    
    // Ensure directory exists
    const dir = path.dirname(this.storageFile);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
    
    // Load existing pending uploads
    await this.loadPendingUploads();
    this.initialized = true;
    
    // Clean up old entries on startup
    await this.cleanupOldEntries();
  }

  /**
   * Add a pending upload after direct upload completes
   * @param {Object} uploadData - Data from completed direct upload
   */
  async addPendingUpload(uploadData) {
    await this.init();
    
    const pendingUpload = {
      id: uploadData.uploadId || uploadData.contractId,
      contractId: uploadData.contractId,
      transactionId: uploadData.transactionId,
      files: uploadData.files,
      totalSize: uploadData.totalSize,
      brocaCost: uploadData.brocaCost,
      timestamp: Date.now(),
      status: 'waiting_confirmation',
      type: uploadData.type || 'files',
      metadata: uploadData.metadata,
      // For video uploads
      masterPlaylistCID: uploadData.masterPlaylistCID,
      thumbnail: uploadData.thumbnail,
      originalVideoPath: uploadData.originalVideoPath,
      transcodingSettings: uploadData.transcodingSettings
    };
    
    this.pendingUploads.set(pendingUpload.id, pendingUpload);
    await this.savePendingUploads();
    
    this.emit('uploadAdded', pendingUpload);
    
    return pendingUpload.id;
  }

  /**
   * Check if a video file already has a pending upload
   * @param {string} videoPath - Path to the video file
   */
  async hasPendingVideoUpload(videoPath) {
    await this.init();
    
    for (const [id, upload] of this.pendingUploads) {
      if (upload.originalVideoPath === videoPath && upload.status === 'waiting_confirmation') {
        return upload;
      }
    }
    
    return null;
  }

  /**
   * Get all pending uploads
   */
  async getPendingUploads() {
    await this.init();
    return Array.from(this.pendingUploads.values());
  }

  /**
   * Mark upload as confirmed
   * @param {string} uploadId - Upload ID to confirm
   */
  async confirmUpload(uploadId) {
    await this.init();
    
    if (this.pendingUploads.has(uploadId)) {
      const upload = this.pendingUploads.get(uploadId);
      upload.status = 'confirmed';
      upload.confirmedAt = Date.now();
      
      await this.savePendingUploads();
      this.emit('uploadConfirmed', upload);
      
      return upload;
    }
    
    return null;
  }

  /**
   * Mark upload as failed
   * @param {string} uploadId - Upload ID that failed
   * @param {string} error - Error message
   */
  async failUpload(uploadId, error) {
    await this.init();
    
    if (this.pendingUploads.has(uploadId)) {
      const upload = this.pendingUploads.get(uploadId);
      upload.status = 'failed';
      upload.error = error;
      upload.failedAt = Date.now();
      
      await this.savePendingUploads();
      this.emit('uploadFailed', upload);
      
      return upload;
    }
    
    return null;
  }

  /**
   * Remove upload from pending list
   * @param {string} uploadId - Upload ID to remove
   */
  async removeUpload(uploadId) {
    await this.init();
    
    if (this.pendingUploads.has(uploadId)) {
      const upload = this.pendingUploads.get(uploadId);
      this.pendingUploads.delete(uploadId);
      
      await this.savePendingUploads();
      this.emit('uploadRemoved', upload);
      
      return upload;
    }
    
    return null;
  }

  /**
   * Retry a failed upload
   * @param {string} uploadId - Upload ID to retry
   */
  async retryUpload(uploadId) {
    await this.init();
    
    if (this.pendingUploads.has(uploadId)) {
      const upload = this.pendingUploads.get(uploadId);
      upload.status = 'waiting_confirmation';
      delete upload.error;
      delete upload.failedAt;
      upload.retryCount = (upload.retryCount || 0) + 1;
      upload.lastRetry = Date.now();
      
      await this.savePendingUploads();
      this.emit('uploadRetried', upload);
      
      return upload;
    }
    
    return null;
  }

  /**
   * Check upload status on blockchain
   * @param {string} transactionId - Transaction ID to check
   */
  async checkUploadStatus(transactionId) {
    // This would check the blockchain/network for transaction confirmation
    // For now, we'll implement a simple check
    try {
      // TODO: Implement actual blockchain check
      // For now, assume uploads older than 5 minutes are confirmed
      const upload = Array.from(this.pendingUploads.values())
        .find(u => u.transactionId === transactionId);
      
      if (upload && Date.now() - upload.timestamp > 5 * 60 * 1000) {
        await this.confirmUpload(upload.id);
        return 'confirmed';
      }
      
      return 'pending';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Clean up old entries (confirmed uploads older than 7 days, failed older than 1 day)
   */
  async cleanupOldEntries() {
    await this.init();
    
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const oneDay = 24 * 60 * 60 * 1000;
    
    let cleaned = 0;
    
    for (const [id, upload] of this.pendingUploads) {
      const shouldRemove = 
        (upload.status === 'confirmed' && (now - upload.confirmedAt) > sevenDays) ||
        (upload.status === 'failed' && (now - upload.failedAt) > oneDay);
      
      if (shouldRemove) {
        this.pendingUploads.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      await this.savePendingUploads();
      this.emit('cleanup', { removed: cleaned });
    }
  }

  /**
   * Load pending uploads from disk
   */
  async loadPendingUploads() {
    try {
      const data = await fs.readFile(this.storageFile, 'utf8');
      const uploads = JSON.parse(data);
      
      this.pendingUploads.clear();
      for (const upload of uploads) {
        this.pendingUploads.set(upload.id, upload);
      }
    } catch (error) {
      // File doesn't exist or is corrupted, start fresh
      this.pendingUploads.clear();
    }
  }

  /**
   * Save pending uploads to disk
   */
  async savePendingUploads() {
    try {
      const uploads = Array.from(this.pendingUploads.values());
      await fs.writeFile(this.storageFile, JSON.stringify(uploads, null, 2));
    } catch (error) {
      console.error('Failed to save pending uploads:', error);
    }
  }

  /**
   * Get upload statistics
   */
  async getStats() {
    await this.init();
    
    const uploads = Array.from(this.pendingUploads.values());
    const stats = {
      total: uploads.length,
      waiting: uploads.filter(u => u.status === 'waiting_confirmation').length,
      confirmed: uploads.filter(u => u.status === 'confirmed').length,
      failed: uploads.filter(u => u.status === 'failed').length,
      totalSize: uploads.reduce((sum, u) => sum + (u.totalSize || 0), 0),
      totalCost: uploads.reduce((sum, u) => sum + (u.brocaCost || 0), 0)
    };
    
    return stats;
  }

  /**
   * Get pending uploads for UI display
   */
  async getUploadsForDisplay() {
    await this.init();
    
    const uploads = Array.from(this.pendingUploads.values())
      .sort((a, b) => b.timestamp - a.timestamp);
    
    return uploads.map(upload => ({
      id: upload.id,
      type: upload.type,
      status: upload.status,
      timestamp: upload.timestamp,
      transactionId: upload.transactionId,
      contractId: upload.contractId,
      totalSize: upload.totalSize,
      brocaCost: upload.brocaCost,
      fileCount: upload.files?.length || 0,
      masterUrl: upload.masterPlaylistCID ? 
        `https://ipfs.dlux.io/ipfs/${upload.masterPlaylistCID}` : null,
      thumbnailUrl: upload.thumbnail?.cid ? 
        `https://ipfs.dlux.io/ipfs/${upload.thumbnail.cid}` : null,
      error: upload.error,
      retryCount: upload.retryCount || 0
    }));
  }

  /**
   * Update upload status
   * @param {string} uploadId - Upload ID
   * @param {string} status - New status (uploading, completed, failed)
   * @param {Object} updates - Additional fields to update
   */
  async updateUploadStatus(uploadId, status, updates = {}) {
    await this.init();
    
    const upload = this.pendingUploads.get(uploadId);
    if (!upload) {
      console.warn(`[PendingUploads] Upload ${uploadId} not found for status update`);
      return false;
    }
    
    // Update status and any additional fields
    upload.status = status;
    Object.assign(upload, updates);
    
    // Update timestamp for tracking
    upload.lastUpdated = Date.now();
    
    console.log(`[PendingUploads] Updated upload ${uploadId} status to ${status}`);
    
    // Save changes
    await this.savePendingUploads();
    
    // Emit event for UI updates
    this.emit('upload-updated', { uploadId, status, upload });
    
    return true;
  }
}

module.exports = PendingUploadsManager;