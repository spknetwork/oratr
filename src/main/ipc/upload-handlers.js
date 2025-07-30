/**
 * IPC handlers for video upload operations
 */

const { ipcMain } = require('electron');
const { getServices } = require('../services/init-services');
const path = require('path');

/**
 * Setup upload-related IPC handlers
 */
function setupUploadHandlers() {
  const { videoUploadService } = getServices();

  // Upload video
  ipcMain.handle('upload:video', async (event, { filePath, options }) => {
    try {
      // Ensure user is authenticated
      const { accountManager } = getServices();
      const currentAccount = accountManager.getCurrentAccount();
      
      if (!currentAccount) {
        throw new Error('No active account. Please login first.');
      }

      // Start upload
      const result = await videoUploadService.uploadVideo(filePath, options);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Queue video upload
  ipcMain.handle('upload:queue', async (event, { filePath, options }) => {
    try {
      const queueId = await videoUploadService.queueUpload(filePath, options);
      return { success: true, data: { queueId } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Get upload status
  ipcMain.handle('upload:status', async () => {
    try {
      const status = videoUploadService.getStatus();
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Pause upload
  ipcMain.handle('upload:pause', async () => {
    try {
      videoUploadService.pauseUpload();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Resume upload
  ipcMain.handle('upload:resume', async () => {
    try {
      videoUploadService.resumeUpload();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cancel upload
  ipcMain.handle('upload:cancel', async () => {
    try {
      await videoUploadService.cancelUpload();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Forward progress events to renderer
  videoUploadService.on('progress', (data) => {
    event.sender.send('upload:progress', data);
  });

  // Forward other events
  ['queued', 'completed', 'failed', 'paused', 'resumed', 'cancelled', 'error'].forEach(eventName => {
    videoUploadService.on(eventName, (data) => {
      event.sender.send(`upload:${eventName}`, data);
    });
  });

  // Analyze video before upload
  ipcMain.handle('upload:analyze', async (event, filePath) => {
    try {
      const { transcoder } = getServices();
      const metadata = await transcoder.analyzeVideo(filePath);
      const availableResolutions = transcoder.determineOutputResolutions(metadata);
      
      return {
        success: true,
        data: {
          metadata,
          availableResolutions,
          fileSize: metadata.size,
          duration: metadata.duration,
          codec: metadata.streams?.[0]?.codec_name,
          resolution: `${metadata.width}x${metadata.height}`
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Calculate upload cost
  ipcMain.handle('upload:calculate-cost', async (event, { fileSize, duration }) => {
    try {
      // Use spk-js BROCA calculator
      const SPK = require('@spknetwork/spk-js');
      const brocaCost = SPK.BROCACalculator.calculateStorageCost(fileSize, duration);
      
      return {
        success: true,
        data: {
          brocaCost,
          fileSize,
          duration,
          dailyCost: brocaCost / duration
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Simple batch upload
  ipcMain.handle('upload:batch', async (event, { files, options }) => {
    console.log('=== BATCH UPLOAD HANDLER CALLED ===');
    console.log('[Upload] Starting batch upload with', files.length, 'files');
    console.log('[Upload] Options:', options);
    try {
      const { accountManager, directUploadService } = getServices();
      const currentAccount = accountManager.getCurrentAccount();
      console.log('[Upload] Current account:', currentAccount);
      
      if (!currentAccount) {
        throw new Error('No active account. Please login first.');
      }

      // Convert file data to Node.js compatible format for spk-js
      console.log('[Upload] Converting files to Node.js format...');
      const fileObjects = files.map((f, index) => {
        console.log(`[Upload] Processing file ${index + 1}/${files.length}: ${f.name} (${f.size} bytes, type: ${f.type})`);
        const buffer = Buffer.from(f.buffer);
        return {
          name: f.name,
          size: f.size || buffer.length,
          type: f.type || 'application/octet-stream',
          buffer: buffer
        };
      });
      console.log('[Upload] File conversion complete');

      // Create SPK instance with our keychain adapter
      console.log('[Upload] Creating SPK instance...');
      const SPK = require('@spknetwork/spk-js');
      const SPKKeychainAdapter = require('../../core/spk/keychain-adapter');
      const keychainAdapter = new SPKKeychainAdapter(accountManager);
      
      const spk = new SPK(currentAccount, {
        keychain: keychainAdapter
      });
      console.log('[Upload] SPK instance created');

      // Initialize SPK instance
      console.log('[Upload] Initializing SPK instance...');
      await spk.init();
      console.log('[Upload] SPK instance initialized');

      // Update direct upload service with SPK client
      if (directUploadService) {
        directUploadService.spkClient = spk;
      }

      let uploadResult;
      
      // Check if direct upload is requested
      if (options.uploadMethod === 'direct' && directUploadService) {
        console.log('[Upload] Using direct upload method...');
        
        // Listen for progress events
        directUploadService.on('progress', (data) => {
          event.sender.send('upload:progress', data);
        });
        
        uploadResult = await directUploadService.directUpload(fileObjects, {
          metadata: options.metadata
        });
        
        console.log('[Upload] Direct upload result:', uploadResult);
      } else {
        // Use standard public node upload
        console.log('[Upload] Starting nodeUpload with options:', JSON.stringify(options));
        console.log('[Upload] File objects to upload:', fileObjects.map(f => ({
          name: f.name,
          size: f.size,
          type: f.type,
          hasBuffer: !!f.buffer,
          bufferLength: f.buffer?.length
        })));
        
        uploadResult = await spk.fileUpload.nodeUpload(fileObjects, {
          duration: options.duration || 30,
          metadata: options.metadata
        });
        console.log('[Upload] Upload result:', uploadResult);
      }

      // Find master playlist CID
      const masterFile = files.find(f => f.name === 'master.m3u8');
      const masterCid = uploadResult.files?.find(f => f.name === 'master.m3u8')?.cid;

      return {
        success: true,
        data: {
          contractId: uploadResult.contract?.id,
          masterUrl: masterCid ? `https://ipfs.dlux.io/ipfs/${masterCid}` : null,
          ...uploadResult
        }
      };
    } catch (error) {
      console.error('[Upload] Error:', error);
      console.error('[Upload] Error stack:', error.stack);
      return { success: false, error: error.message };
    }
  });

  // Direct file upload handler for My Files tab
  ipcMain.handle('upload:direct-files', async (event, { filePaths, options }) => {
    console.log('[DirectUpload] Starting direct file upload with', filePaths.length, 'files');
    try {
      const { accountManager, directUploadService } = getServices();
      const currentAccount = accountManager.getCurrentAccount();
      
      if (!currentAccount) {
        throw new Error('No active account. Please login first.');
      }

      // Create SPK instance
      const SPK = require('@spknetwork/spk-js');
      const SPKKeychainAdapter = require('../../core/spk/keychain-adapter');
      const keychainAdapter = new SPKKeychainAdapter(accountManager);
      
      const spk = new SPK(currentAccount, {
        keychain: keychainAdapter
      });
      
      await spk.init();
      directUploadService.spkClient = spk;

      // Listen for progress events
      const progressHandler = (data) => {
        event.sender.send('upload:direct-progress', data);
      };
      directUploadService.on('progress', progressHandler);

      try {
        const uploadResult = await directUploadService.directUploadFromPaths(filePaths, options);
        
        // Clean up event listener
        directUploadService.removeListener('progress', progressHandler);
        
        return {
          success: true,
          data: uploadResult
        };
      } catch (error) {
        // Clean up event listener
        directUploadService.removeListener('progress', progressHandler);
        throw error;
      }
    } catch (error) {
      console.error('[DirectUpload] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Check direct upload availability
  ipcMain.handle('upload:check-direct-availability', async () => {
    try {
      const { directUploadService, accountManager } = getServices();
      
      // Create SPK instance if we have an account
      const currentAccount = accountManager.getCurrentAccount();
      if (currentAccount) {
        const SPK = require('@spknetwork/spk-js');
        const SPKKeychainAdapter = require('../../core/spk/keychain-adapter');
        const keychainAdapter = new SPKKeychainAdapter(accountManager);
        
        const spk = new SPK(currentAccount, {
          keychain: keychainAdapter
        });
        
        await spk.init();
        directUploadService.spkClient = spk;
      }
      
      const availability = await directUploadService.isAvailable();
      return { success: true, data: availability };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Calculate direct upload cost
  ipcMain.handle('upload:calculate-direct-cost', async (event, { files }) => {
    try {
      const { directUploadService } = getServices();
      const cost = directUploadService.calculateCost(files);
      return { success: true, data: { cost } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { setupUploadHandlers };