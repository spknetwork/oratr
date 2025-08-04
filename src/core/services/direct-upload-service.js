/**
 * Streamlined Direct Upload Service
 * Simplified one-click upload using spk-js directUpload method
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class DirectUploadService extends EventEmitter {
  constructor({ ipfsManager, spkClient, pendingUploadsManager }) {
    super();
    this.ipfsManager = ipfsManager;
    this.spkClient = spkClient;
    this.pendingUploadsManager = pendingUploadsManager;
    this.activeUploads = new Map();
  }

  /**
   * ONE-CLICK Direct Upload - streamlined process
   * @param {Array} files - Array of file objects (File, Buffer, or { name, content/buffer/arrayBuffer })
   * @param {Object} options - Upload options
   * @returns {Promise} Upload result
   */
  async directUpload(files, options = {}) {
    const uploadId = uuidv4();
    const uploadInfo = {
      id: uploadId,
      files: files.length,
      status: 'uploading',
      progress: 0
    };
    
    this.activeUploads.set(uploadId, uploadInfo);
    
    try {
      this.emit('progress', {
        uploadId,
        stage: 'preparing',
        progress: 0,
        message: 'Preparing files for direct upload...'
      });
      
      // Ensure IPFS is running if we have one
      if (this.ipfsManager && !(await this.ipfsManager.isDaemonRunning())) {
        await this.ipfsManager.start();
      }
      
      // Convert files to the format expected by spk-js
      const processedFiles = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let processedFile;
        
        if (file instanceof File) {
          // Browser File object - use directly
          processedFile = file;
        } else if (file.buffer || file.content) {
          // Node.js buffer/content
          const content = file.buffer || file.content;
          processedFile = {
            name: file.name || `file_${i}`,
            size: content.length,
            arrayBuffer: async () => content instanceof Buffer ? content : Buffer.from(content)
          };
        } else if (file.arrayBuffer) {
          // File-like object with arrayBuffer method
          processedFile = file;
        } else {
          throw new Error(`Invalid file format for file ${i}: ${file.name || 'unnamed'}`);
        }
        
        processedFiles.push(processedFile);
        
        this.emit('progress', {
          uploadId,
          stage: 'preparing',
          progress: ((i + 1) / files.length) * 30,
          message: `Prepared ${i + 1}/${files.length} files`
        });
      }
      
      // Create metadata for the upload - keep it minimal
      const metadata = options.metadata || {};
      
      this.emit('progress', {
        uploadId,
        stage: 'broadcasting',
        progress: 40,
        message: 'Broadcasting transaction and uploading files...'
      });
      
      // Add files to OUR IPFS node and get real CIDs
      console.log(`[DirectUpload] Adding ${processedFiles.length} files to local IPFS node...`);
      
      const cids = [];
      const sizes = [];
      const fileDetails = [];
      
      for (let i = 0; i < processedFiles.length; i++) {
        const file = processedFiles[i];
        
        // Get file content as buffer
        let content;
        if (file.arrayBuffer) {
          content = Buffer.from(await file.arrayBuffer());
        } else if (file.content) {
          content = file.content;
        } else if (file.buffer) {
          content = file.buffer;
        } else {
          throw new Error(`Cannot get content for file: ${file.name}`);
        }
        
        console.log(`[DirectUpload] Adding file ${i + 1}/${processedFiles.length}: ${file.name} (${content.length} bytes)`);
        
        // Actually add to IPFS (not just compute hash) - this stores the file
        const result = await this.ipfsManager.addFile(content, file.name);
        const cid = result.cid ? result.cid.toString() : result.toString();
        cids.push(cid);
        sizes.push(content.length);
        
        // Store file details for pending uploads
        fileDetails.push({
          name: file.name,
          cid: cid,
          size: content.length,
          type: file.type || 'application/octet-stream'
        });
        
        console.log(`[DirectUpload] File added to IPFS: ${file.name} -> ${cid}`);
        
        this.emit('progress', {
          uploadId,
          stage: 'storing',
          progress: 40 + ((i + 1) / processedFiles.length) * 30,
          message: `Stored file ${i + 1}/${processedFiles.length} in IPFS`
        });
      }
      
      console.log('[DirectUpload] All files stored in local IPFS successfully');
      
      // Create metadata array - one metadata object per file
      const uploadMetadata = [];
      
      // Get video name from options or use default
      const videoName = options.videoName || options.originalVideoName || options.title || 'video';
      
      // Get folder path - default to Videos folder (preset 4)
      // Users can specify custom path like "Videos/Movies" or "MyVideos" 
      const folderPath = options.folderPath || 'Videos';
      
      for (let i = 0; i < processedFiles.length; i++) {
        const file = processedFiles[i];
        const parts = file.name.split('.');
        const ext = parts[parts.length - 1];
        
        if (file.name.includes('master.m3u8')) {
          // Main m3u8 file gets visible metadata with user-specified video name
          const videoParts = videoName.split('.');
          const videoBaseName = videoParts.length > 1 ? videoParts.slice(0, -1).join('.') : videoParts[0];
          
          // Construct full path with folder
          const fullPath = folderPath ? `${folderPath}/${videoBaseName}.${ext}` : `${videoBaseName}.${ext}`;
          
          uploadMetadata.push({
            name: videoBaseName,
            ext: ext,
            path: fullPath,
            description: options.description || '',
            thumbnail: options.thumbnailCid || '',
            flag: 1, // visible
            license: options.license || '',
            labels: options.labels || ''
          });
        } else {
          // Other files are hidden (segments, etc.)
          uploadMetadata.push({
            name: '',
            ext: '',
            path: '',
            description: '',
            thumbnail: '',
            flag: 2, // hidden
            license: '',
            labels: ''
          });
        }
      }
      
      console.log('[DirectUpload] Created metadata:', uploadMetadata);
      
      // Create pending upload entry BEFORE broadcasting (for restart capability)
      const pendingUpload = {
        id: uploadId,
        type: options.type || 'files',
        status: 'uploading',
        files: fileDetails,
        cids: cids,
        sizes: sizes,
        totalSize: sizes.reduce((sum, size) => sum + size, 0),
        metadata: uploadMetadata,
        createdAt: new Date().toISOString(),
        options: options,
        originalVideoPath: options.originalVideoPath, // For video uploads
        transcodingSettings: options.transcodingSettings
      };
      
      console.log('[DirectUpload] Saving to pending uploads for restart capability...');
      if (this.pendingUploadsManager) {
        await this.pendingUploadsManager.addPendingUpload(pendingUpload);
      }
      
      this.emit('progress', {
        uploadId,
        stage: 'broadcasting',
        progress: 80,
        message: 'Broadcasting transaction to SPK Network...'
      });
      
      // Use spk-js directUploadFiles method with CIDs and sizes
      const directUploadOptions = {
        cids,
        sizes,
        id: uploadId,
        metadata: uploadMetadata
      };
      
      console.log('[DirectUpload] Broadcasting direct upload transaction...');
      console.log('[DirectUpload] Upload options:', JSON.stringify(directUploadOptions, null, 2));
      
      let result;
      try {
        result = await this.spkClient.directUploadFiles(directUploadOptions);
      } catch (error) {
        console.error('[DirectUpload] spkClient.directUploadFiles failed:', error);
        throw new Error(`Direct upload broadcast failed: ${error.message}`);
      }
      
      // Check if upload was successful
      if (!result || !result.success) {
        const errorMsg = result?.error || 'Direct upload failed with no error message';
        console.error('[DirectUpload] Upload result indicates failure:', result);
        throw new Error(errorMsg);
      }
      
      this.emit('progress', {
        uploadId,
        stage: 'complete',
        progress: 100,
        message: 'Upload complete!'
      });
      
      // Build simplified response from DirectUploadResult
      const uploadResult = {
        success: result.success,
        uploadId,
        directUploadId: result.id,
        transactionId: result.transactionId,
        files: fileDetails.map(f => ({
          name: f.name,
          size: f.size,
          cid: f.cid,
          url: `https://ipfs.dlux.io/ipfs/${f.cid}`,
          type: f.type
        })),
        filesUploaded: result.filesUploaded,
        totalSize: result.totalSize,
        brocaCost: result.totalSize, // Direct upload uses 1:1 BROCA per byte
        metadata: uploadMetadata
      };
      
      // Update pending upload status to 'completed' after successful broadcast
      if (this.pendingUploadsManager) {
        await this.pendingUploadsManager.updateUploadStatus(uploadId, 'completed', {
          transactionId: result.transactionId,
          completedAt: new Date().toISOString()
        });
      }
      
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
   * Drag & Drop Upload - simplified interface for file paths
   * @param {Array<string>} filePaths - Array of file paths
   * @param {Object} options - Upload options
   */
  async uploadFromPaths(filePaths, options = {}) {
    const files = [];
    
    for (const filePath of filePaths) {
      const content = await fs.readFile(filePath);
      const name = path.basename(filePath);
      const stats = await fs.stat(filePath);
      
      files.push({
        name,
        content,
        size: stats.size
      });
    }
    
    return this.directUpload(files, options);
  }

  /**
   * Video Upload - streamlined for transcoded video files
   * @param {Array} videoFiles - Array of video files (segments, playlists, thumbnails)
   * @param {Object} options - Upload options with video metadata
   * @param {string} options.videoName - Name for the video (without extension)
   * @param {string} options.folderPath - Folder path (default: 'Videos'). Can be:
   *   - 'Videos' (default preset folder)
   *   - 'Videos/Movies' (subfolder under Videos)
   *   - 'MyCustomFolder' (custom top-level folder)
   *   - 'Documents/Work/Presentations' (nested custom folders)
   * @param {string} options.description - Video description
   * @param {string} options.thumbnailCid - CID of thumbnail image
   * @param {string} options.license - License information (e.g., 'CC-BY', 'All Rights Reserved')
   * @param {string} options.labels - Comma-separated tags/labels (e.g., 'tutorial,programming')
   */
  async uploadVideo(videoFiles, options = {}) {
    // Check if this video already has a pending upload
    if (options.originalVideoPath && this.pendingUploadsManager) {
      const existingUpload = await this.pendingUploadsManager.hasPendingVideoUpload(options.originalVideoPath);
      if (existingUpload) {
        // Return the existing upload instead of uploading again
        return {
          success: true,
          uploadId: existingUpload.id,
          contractId: existingUpload.contractId,
          transactionId: existingUpload.transactionId,
          files: existingUpload.files,
          totalSize: existingUpload.totalSize,
          brocaCost: existingUpload.brocaCost,
          metadata: existingUpload.metadata,
          fromCache: true,
          status: existingUpload.status
        };
      }
    }
    
    // Add video type marker for pending uploads
    const videoOptions = {
      ...options,
      type: 'video'
    };
    
    return this.directUpload(videoFiles, videoOptions);
  }

  /**
   * Check if direct upload is available
   */
  async isAvailable() {
    try {
      // Simple check - just verify SPK client is ready
      if (!this.spkClient?.file?.directUpload) {
        return {
          available: false,
          error: 'SPK client not initialized'
        };
      }
      
      return {
        available: true,
        message: 'Ready for direct upload'
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
    // BROCA cost is typically 1:1 with file size for direct uploads
    return totalSize;
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