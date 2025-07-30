/**
 * Direct Upload Service
 * Handles direct uploads to the SPK Network using local IPFS node
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class DirectUploadService extends EventEmitter {
  constructor({ ipfsManager, spkClient }) {
    super();
    this.ipfsManager = ipfsManager;
    this.spkClient = spkClient;
    this.activeUploads = new Map();
  }

  /**
   * Direct upload files using local IPFS node
   * @param {Array} files - Array of file objects with content, name, type
   * @param {Object} options - Upload options
   * @returns {Promise} Upload result
   */
  async directUpload(files, options = {}) {
    const uploadId = uuidv4();
    const uploadInfo = {
      id: uploadId,
      files: files.length,
      status: 'preparing',
      progress: 0
    };
    
    this.activeUploads.set(uploadId, uploadInfo);
    
    try {
      // Stage 1: Pin files to local IPFS
      this.emit('progress', {
        uploadId,
        stage: 'pinning',
        progress: 0,
        message: 'Pinning files to local IPFS node...'
      });
      
      // Ensure IPFS is running
      if (!this.ipfsManager.isRunning()) {
        await this.ipfsManager.start();
      }
      
      const pinnedFiles = [];
      const cids = [];
      const sizes = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Convert buffer if needed
        let content;
        if (file.buffer) {
          content = Buffer.from(file.buffer);
        } else if (file.content) {
          content = file.content;
        } else if (file.arrayBuffer) {
          content = Buffer.from(await file.arrayBuffer());
        } else {
          throw new Error(`Invalid file format for ${file.name}`);
        }
        
        // Add to IPFS
        const result = await this.ipfsManager.addFile(content, file.name);
        
        pinnedFiles.push({
          name: file.name,
          cid: result.cid.toString(),
          size: content.length
        });
        
        cids.push(result.cid.toString());
        sizes.push(content.length);
        
        const progress = ((i + 1) / files.length) * 50; // First 50% for pinning
        this.emit('progress', {
          uploadId,
          stage: 'pinning',
          progress,
          message: `Pinned ${i + 1}/${files.length} files`
        });
      }
      
      // Stage 2: Create metadata
      const metadata = options.metadata || {};
      metadata.files = pinnedFiles.map(f => ({
        name: f.name,
        cid: f.cid
      }));
      
      // Determine file tags based on extensions
      const tags = [];
      if (pinnedFiles.some(f => /\.(mp4|avi|mov|mkv|m3u8)$/i.test(f.name))) {
        tags.push(4); // Video tag
      }
      if (pinnedFiles.some(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name))) {
        tags.push(3); // Image tag
      }
      if (pinnedFiles.some(f => /\.(mp3|wav|flac|ogg)$/i.test(f.name))) {
        tags.push(5); // Audio tag
      }
      if (pinnedFiles.some(f => /\.(pdf|doc|docx|txt)$/i.test(f.name))) {
        tags.push(2); // Document tag
      }
      
      // Create metadata string for direct upload
      const metadataString = this.spkClient.constructor.createDirectUploadMetadata(
        cids.length,
        tags
      );
      
      // Stage 3: Broadcast direct upload transaction
      this.emit('progress', {
        uploadId,
        stage: 'broadcasting',
        progress: 60,
        message: 'Broadcasting to SPK Network...'
      });
      
      // Create unique upload ID
      const directUploadId = `upload_${Date.now()}_${uploadId.substring(0, 8)}`;
      
      // Use spk-js direct upload
      const result = await this.spkClient.directUploadFiles({
        cids,
        sizes,
        id: directUploadId,
        metadata: metadataString
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Direct upload failed');
      }
      
      this.emit('progress', {
        uploadId,
        stage: 'complete',
        progress: 100,
        message: 'Upload complete!'
      });
      
      // Build response
      const uploadResult = {
        success: true,
        uploadId,
        directUploadId,
        transactionId: result.transactionId,
        files: pinnedFiles,
        totalSize: sizes.reduce((sum, size) => sum + size, 0),
        metadata,
        ipfsGatewayUrls: pinnedFiles.map(f => ({
          name: f.name,
          cid: f.cid,
          url: `https://ipfs.io/ipfs/${f.cid}`
        }))
      };
      
      this.activeUploads.delete(uploadId);
      this.emit('completed', uploadResult);
      
      return uploadResult;
      
    } catch (error) {
      this.activeUploads.delete(uploadId);
      this.emit('error', {
        uploadId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Direct upload files from file paths
   * @param {Array<string>} filePaths - Array of file paths
   * @param {Object} options - Upload options
   */
  async directUploadFromPaths(filePaths, options = {}) {
    const files = [];
    
    for (const filePath of filePaths) {
      const content = await fs.readFile(filePath);
      const name = path.basename(filePath);
      const stats = await fs.stat(filePath);
      
      files.push({
        name,
        content,
        size: stats.size,
        type: this.getMimeType(name)
      });
    }
    
    return this.directUpload(files, options);
  }

  /**
   * Direct upload for video files with metadata
   * @param {Object} videoData - Video data including segments and playlists
   * @param {Object} options - Upload options
   */
  async directUploadVideo(videoData, options = {}) {
    const { files, masterPlaylistCID, thumbnail, resolutions } = videoData;
    
    // Add video-specific metadata
    const metadata = {
      ...options.metadata,
      type: 'video/hls',
      masterPlaylist: masterPlaylistCID,
      thumbnail: thumbnail?.cid,
      resolutions: Object.keys(resolutions)
    };
    
    return this.directUpload(files, { ...options, metadata });
  }

  /**
   * Check if direct upload is available
   */
  async isAvailable() {
    try {
      // Check if IPFS is available
      const ipfsAvailable = this.ipfsManager.isRunning() || await this.ipfsManager.checkHealth();
      
      // Check if we have an active SPK account
      const account = await this.spkClient.account.init();
      const hasAccount = !!account.username;
      
      // Check BROCA balance
      const balances = await this.spkClient.getBalances();
      const hasBroca = balances.broca > 0;
      
      return {
        available: ipfsAvailable && hasAccount && hasBroca,
        ipfsAvailable,
        hasAccount,
        hasBroca,
        brocaBalance: balances.broca
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate cost for direct upload
   * @param {Array} files - Array of files with size property
   */
  calculateCost(files) {
    const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
    return this.spkClient.calculateDirectUploadCost([totalSize]);
  }

  /**
   * Get MIME type from filename
   */
  getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
      '.m3u8': 'application/x-mpegURL',
      '.ts': 'video/MP2T',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Cancel active upload
   */
  cancelUpload(uploadId) {
    if (this.activeUploads.has(uploadId)) {
      this.activeUploads.delete(uploadId);
      this.emit('cancelled', { uploadId });
      return true;
    }
    return false;
  }

  /**
   * Get active uploads
   */
  getActiveUploads() {
    return Array.from(this.activeUploads.values());
  }
}

module.exports = DirectUploadService;