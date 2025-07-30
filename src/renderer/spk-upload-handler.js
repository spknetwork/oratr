/**
 * SPK Upload Handler for the renderer process
 * Uses the new spk-js based upload service
 */

class SPKUploadHandler {
  constructor() {
    this.uploadInProgress = false;
    this.currentUploadId = null;
  }

  /**
   * Start upload process with spk-js integration
   */
  async startUpload(files, options = {}) {
    if (this.uploadInProgress) {
      throw new Error('Upload already in progress');
    }

    this.uploadInProgress = true;
    const uploadLogs = [];
    
    const addLog = (message, type = 'info') => {
      const logEntry = {
        time: new Date().toLocaleTimeString(),
        message,
        type
      };
      uploadLogs.push(logEntry);
      
      // Emit log event for UI
      if (options.onLog) {
        options.onLog(logEntry);
      }
    };

    try {
      // Step 1: Prepare files for upload
      addLog('Preparing files for upload...', 'info');
      
      // Convert Map to array of file objects with metadata
      const fileList = [];
      for (const [filename, file] of files) {
        fileList.push({
          name: filename,
          file: file,
          size: file.size,
          type: file.type
        });
      }
      
      // Calculate total size
      const totalSize = fileList.reduce((sum, f) => sum + f.size, 0);
      addLog(`Total size to upload: ${this.formatBytes(totalSize)}`, 'info');
      
      // Step 2: Check if we have an active account
      const activeAccountResult = await window.api.invoke('account:getActive');
      if (!activeAccountResult.success || !activeAccountResult.username) {
        throw new Error('No active account. Please login first.');
      }
      
      addLog(`Using account: @${activeAccountResult.username}`, 'info');
      
      // Step 3: Create a temporary directory for files
      const tempFiles = [];
      const videoFile = fileList.find(f => f.name === 'original.mp4' || f.type.startsWith('video/'));
      
      if (!videoFile) {
        // This is a prepared upload with IPFS-ready files
        // We'll upload directly using the new service
        
        // Extract metadata from the files
        const masterPlaylist = fileList.find(f => f.name === 'master.m3u8');
        const thumbnail = fileList.find(f => f.name === 'poster.jpg');
        
        // Prepare upload options
        const uploadOptions = {
          resolutions: options.resolutions || ['1080p', '720p', '480p'],
          generateThumbnail: false, // Already have thumbnail
          contract: {
            duration: options.duration || 30,
            autoRenew: options.autoRenew || false
          },
          metadata: {
            path: 'Videos',
            tags: options.tags || [],
            labels: options.labels || '',
            license: options.license || 'CC0',
            title: options.title || 'Untitled Video'
          }
        };
        
        // Since we have pre-processed files, we need to handle this differently
        // For now, we'll use the direct IPFS upload approach
        return await this.directIPFSUpload(fileList, uploadOptions, addLog);
      }
      
      // Step 4: Use the video upload service for raw video files
      addLog('Starting video processing and upload...', 'info');
      
      // Create a proper file path for the video
      // In Electron, we can get the path from the File object if it's a local file
      let videoPath = videoFile.file.path;
      
      if (!videoPath) {
        // If no path available, we need to save the file temporarily
        const tempPath = await this.saveTempFile(videoFile.file);
        videoPath = tempPath;
        tempFiles.push(tempPath);
      }
      
      // Prepare upload options
      const uploadOptions = {
        resolutions: options.resolutions || ['1080p', '720p', '480p'],
        generateThumbnail: !fileList.find(f => f.name === 'poster.jpg'),
        contract: {
          duration: options.duration || 30,
          autoRenew: options.autoRenew || false
        },
        metadata: {
          path: 'Videos',
          tags: options.tags || [],
          labels: options.labels || '',
          license: options.license || 'CC0',
          title: options.title || path.basename(videoPath, path.extname(videoPath))
        }
      };
      
      // If we have a custom thumbnail, we need to handle it
      const customThumbnail = fileList.find(f => f.name === 'poster.jpg');
      if (customThumbnail) {
        uploadOptions.customThumbnail = await customThumbnail.file.arrayBuffer();
      }
      
      // Start the upload
      const uploadResult = await window.api.invoke('upload:video', {
        filePath: videoPath,
        options: uploadOptions
      });
      
      if (!uploadResult.success) {
        throw new Error(uploadResult.error);
      }
      
      // Clean up temp files
      for (const tempFile of tempFiles) {
        await this.deleteTempFile(tempFile);
      }
      
      addLog('Upload completed successfully!', 'success');
      addLog(`Master playlist CID: ${uploadResult.data.master.cid}`, 'success');
      addLog(`View at: ${uploadResult.data.master.url}`, 'success');
      
      return {
        success: true,
        data: uploadResult.data,
        logs: uploadLogs
      };
      
    } catch (error) {
      addLog(`Upload failed: ${error.message}`, 'error');
      return {
        success: false,
        error: error.message,
        logs: uploadLogs
      };
    } finally {
      this.uploadInProgress = false;
    }
  }

  /**
   * Direct IPFS upload for pre-processed files
   */
  async directIPFSUpload(fileList, options, addLog) {
    addLog('Using direct IPFS upload for pre-processed files...', 'info');
    
    const uploadedFiles = new Map();
    let uploadedCount = 0;
    
    // Upload each file to IPFS
    for (const fileInfo of fileList) {
      addLog(`Uploading ${fileInfo.name}...`, 'info');
      
      try {
        const buffer = await fileInfo.file.arrayBuffer();
        const result = await window.api.invoke('ipfs:addFile', {
          name: fileInfo.name,
          data: Array.from(new Uint8Array(buffer))
        });
        
        if (result.success) {
          uploadedFiles.set(fileInfo.name, result.cid);
          uploadedCount++;
          addLog(`✓ ${fileInfo.name} → IPFS CID: ${result.cid}`, 'success');
          
          // Update progress
          if (options.onProgress) {
            options.onProgress({
              percent: Math.round((uploadedCount / fileList.length) * 100),
              currentFile: fileInfo.name
            });
          }
        } else {
          addLog(`✗ Failed to upload ${fileInfo.name}: ${result.error}`, 'error');
        }
      } catch (error) {
        addLog(`✗ Error uploading ${fileInfo.name}: ${error.message}`, 'error');
      }
    }
    
    if (uploadedCount === fileList.length) {
      addLog('All files uploaded successfully!', 'success');
      
      // Construct result
      const masterCid = uploadedFiles.get('master.m3u8');
      const posterCid = uploadedFiles.get('poster.jpg');
      
      return {
        success: true,
        data: {
          master: {
            cid: masterCid,
            url: `https://ipfs.dlux.io/ipfs/${masterCid}`
          },
          thumbnail: posterCid ? {
            cid: posterCid,
            url: `https://ipfs.dlux.io/ipfs/${posterCid}`
          } : null,
          files: Object.fromEntries(uploadedFiles)
        }
      };
    } else {
      throw new Error(`Only ${uploadedCount}/${fileList.length} files uploaded successfully`);
    }
  }

  /**
   * Save file to temporary location
   */
  async saveTempFile(file) {
    const { remote } = require('electron');
    const fs = require('fs').promises;
    const path = require('path');
    
    const tempDir = remote.app.getPath('temp');
    const tempPath = path.join(tempDir, `spk-upload-${Date.now()}-${file.name}`);
    
    const buffer = await file.arrayBuffer();
    await fs.writeFile(tempPath, Buffer.from(buffer));
    
    return tempPath;
  }

  /**
   * Delete temporary file
   */
  async deleteTempFile(filePath) {
    const fs = require('fs').promises;
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error('Failed to delete temp file:', error);
    }
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Listen for upload progress events
   */
  onProgress(callback) {
    window.api.on('upload:progress', callback);
  }

  /**
   * Remove upload progress listener
   */
  offProgress(callback) {
    window.api.off('upload:progress', callback);
  }
}

// Export for use in renderer
window.SPKUploadHandler = SPKUploadHandler;