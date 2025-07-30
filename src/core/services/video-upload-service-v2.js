const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const SPK = require('@spknetwork/spk-js');
const SPKKeychainAdapter = require('../spk/keychain-adapter');

/**
 * Video Upload Service V2
 * Uses spk-js library for uploads instead of custom implementation
 */
class VideoUploadServiceV2 extends EventEmitter {
  constructor({ transcoder, playlistProcessor, ipfsManager, accountManager, integratedStorage }) {
    super();
    this.transcoder = transcoder;
    this.playlistProcessor = playlistProcessor;
    this.ipfsManager = ipfsManager;
    this.accountManager = accountManager;
    this.integratedStorage = integratedStorage;
    
    this.uploadQueue = [];
    this.activeUpload = null;
    this.tempFiles = new Set();
    this.isPaused = false;
    this.savedState = null;
    
    // SPK instance will be created per upload with current account
    this.spk = null;
  }

  /**
   * Initialize SPK instance for current account
   */
  async initializeSPK() {
    const currentAccount = this.accountManager.getCurrentAccount();
    if (!currentAccount) {
      throw new Error('No active account');
    }

    // Create keychain adapter for spk-js
    const keychainAdapter = new SPKKeychainAdapter(this.accountManager);
    
    // Initialize SPK with our custom signer
    this.spk = new SPK(currentAccount, {
      keychain: keychainAdapter,
      apiUrl: process.env.SPK_API_URL || 'https://api.spknetwork.io'
    });

    // Ensure public key is registered
    await this.spk.account.registerPublicKey();
  }

  /**
   * Upload video with complete workflow using spk-js
   */
  async uploadVideo(videoPath, options = {}) {
    const uploadId = uuidv4();
    this.activeUpload = uploadId;
    
    const defaultOptions = {
      resolutions: ['1080p', '720p', '480p'],
      generateThumbnail: true,
      contract: {
        duration: 30, // days
        autoRenew: false
      },
      metadata: {
        path: 'Videos',
        tags: [],
        labels: '',
        license: 'CC0'
      }
    };
    
    const uploadOptions = { ...defaultOptions, ...options };
    
    try {
      // Initialize SPK for current account
      await this.initializeSPK();
      
      // Stage 1: Analyze video
      this.emit('progress', { 
        uploadId, 
        stage: 'analyzing', 
        progress: 0, 
        message: 'Analyzing video...' 
      });
      
      const videoMetadata = await this.transcoder.analyzeVideo(videoPath);
      
      // Determine optimal resolutions
      const availableResolutions = this.transcoder.determineOutputResolutions(videoMetadata);
      uploadOptions.resolutions = uploadOptions.resolutions.filter(res => 
        availableResolutions.includes(res)
      );
      
      this.emit('progress', { 
        uploadId, 
        stage: 'analyzing', 
        progress: 100, 
        message: 'Analysis complete' 
      });
      
      // Stage 2: Generate thumbnail
      let thumbnailCid = null;
      if (uploadOptions.generateThumbnail) {
        this.emit('progress', { 
          uploadId, 
          stage: 'thumbnail', 
          progress: 0, 
          message: 'Generating thumbnail...' 
        });
        
        const thumbnail = await this.transcoder.generateThumbnail(videoPath);
        
        // Create Node.js compatible file object from thumbnail buffer
        const thumbnailFile = {
          name: 'thumbnail.jpg',
          size: thumbnail.buffer.length,
          type: 'image/jpeg',
          buffer: thumbnail.buffer
        };
        
        // Upload thumbnail using spk-js nodeUpload
        const thumbResult = await this.spk.fileUpload.nodeUpload(thumbnailFile, {
          duration: uploadOptions.contract.duration,
          metadata: {
            path: 'Thumbnails',
            name: `thumb_${path.basename(videoPath)}.jpg`
          }
        });
        
        thumbnailCid = thumbResult.cid;
        
        this.emit('progress', { 
          uploadId, 
          stage: 'thumbnail', 
          progress: 100, 
          message: 'Thumbnail uploaded' 
        });
      }
      
      // Stage 3: Transcode video
      this.emit('progress', { 
        uploadId, 
        stage: 'transcoding', 
        progress: 0, 
        message: 'Transcoding video...' 
      });
      
      const tempDir = await this.transcoder.createTempDirectory();
      this.tempFiles.add(tempDir);
      
      // Set up progress tracking for transcoding
      this.transcoder.on('progress', (data) => {
        if (!this.isPaused && this.activeUpload === uploadId) {
          this.emit('progress', {
            uploadId,
            stage: 'transcoding',
            progress: data.percent || 0,
            message: `Transcoding ${data.resolution || ''}...`,
            details: data
          });
        }
      });
      
      // Transcode to HLS
      const hlsOutput = await this.transcoder.transcodeToHLS(
        videoPath,
        tempDir,
        uploadOptions.resolutions
      );
      
      this.emit('progress', { 
        uploadId, 
        stage: 'transcoding', 
        progress: 100, 
        message: 'Transcoding complete' 
      });
      
      // Stage 4: Calculate IPFS hashes for all files
      this.emit('progress', { 
        uploadId, 
        stage: 'hashing', 
        progress: 0, 
        message: 'Calculating IPFS hashes...' 
      });
      
      const allFiles = [];
      const fileMap = new Map();
      
      // Collect all files and calculate hashes
      for (const resolution of hlsOutput.resolutions) {
        // Process playlist
        const playlistContent = await fs.readFile(resolution.playlistPath);
        const playlistCid = await this.ipfsManager.hashOnly(playlistContent);
        
        const playlistFile = {
          name: path.basename(resolution.playlistPath),
          size: playlistContent.length,
          type: 'application/x-mpegURL',
          buffer: playlistContent
        };
        
        fileMap.set(path.basename(resolution.playlistPath), {
          file: playlistFile,
          cid: playlistCid,
          type: 'playlist'
        });
        
        // Process segments
        for (const segment of resolution.segments) {
          const segmentContent = await fs.readFile(segment.path);
          const segmentCid = await this.ipfsManager.hashOnly(segmentContent);
          
          const segmentFile = {
            name: segment.filename,
            size: segmentContent.length,
            type: 'video/mp2t',
            buffer: segmentContent
          };
          
          fileMap.set(segment.filename, {
            file: segmentFile,
            cid: segmentCid,
            type: 'segment'
          });
        }
      }
      
      // Process master playlist
      const masterContent = await fs.readFile(hlsOutput.masterPlaylistPath);
      const masterCid = await this.ipfsManager.hashOnly(masterContent);
      
      const masterFile = {
        name: 'master.m3u8',
        size: masterContent.length,
        type: 'application/x-mpegURL',
        buffer: masterContent
      };
      
      fileMap.set('master.m3u8', {
        file: masterFile,
        cid: masterCid,
        type: 'master'
      });
      
      this.emit('progress', { 
        uploadId, 
        stage: 'hashing', 
        progress: 100, 
        message: 'Hashing complete' 
      });
      
      // Stage 5: Process playlists with CID replacement
      this.emit('progress', { 
        uploadId, 
        stage: 'processing', 
        progress: 0, 
        message: 'Processing playlists...' 
      });
      
      // Create CID mapping for playlist processor
      const cidMapping = {};
      for (const [filename, data] of fileMap) {
        cidMapping[filename] = data.cid;
      }
      
      // Process playlists to replace filenames with CIDs
      for (const [filename, data] of fileMap) {
        if (data.type === 'playlist' || data.type === 'master') {
          const originalContent = await data.file.text();
          const processedContent = await this.playlistProcessor.processPlaylist(
            originalContent,
            cidMapping
          );
          
          // Update file with processed content
          data.file = {
            name: filename,
            size: Buffer.byteLength(processedContent),
            type: 'application/x-mpegURL',
            buffer: Buffer.from(processedContent)
          };
          
          // Recalculate CID for processed playlist
          data.cid = await this.ipfsManager.hashOnly(Buffer.from(processedContent));
          cidMapping[filename] = data.cid;
        }
      }
      
      this.emit('progress', { 
        uploadId, 
        stage: 'processing', 
        progress: 100, 
        message: 'Processing complete' 
      });
      
      // Stage 6: Upload all files using spk-js batch upload
      this.emit('progress', { 
        uploadId, 
        stage: 'uploading', 
        progress: 0, 
        message: 'Uploading to SPK Network...' 
      });
      
      // Prepare files array for batch upload
      const filesToUpload = Array.from(fileMap.values()).map(data => data.file);
      
      // Prepare metadata for each file
      const videoName = path.basename(videoPath, path.extname(videoPath));
      const metaData = [];
      let fileIndex = 0;
      
      // Create metadata for each file with proper flags and folders
      for (const [filename, data] of fileMap) {
        const metadata = {
          FileIndex: fileIndex++,
          path: 'Videos', // All video files go to Videos folder (folder 4)
          name: '',
          ext: '',
          thumb: '',
          tags: 0,
          labels: uploadOptions.metadata.labels || '',
          license: uploadOptions.metadata.license || ''
        };
        
        if (data.type === 'master') {
          // Master playlist - use original video name, visible
          metadata.name = videoName;
          metadata.ext = 'm3u8';
          metadata.thumb = thumbnailCid || '';
        } else if (data.type === 'playlist') {
          // Resolution playlists - visible with resolution in name
          const resolution = filename.replace('.m3u8', '');
          metadata.name = `${resolution}_index`;
          metadata.ext = 'm3u8';
          metadata.tags = 2; // Hidden flag
        } else if (data.type === 'segment') {
          // Segments - hidden
          const segmentName = filename.replace('.ts', '');
          metadata.name = segmentName;
          metadata.ext = 'ts';
          metadata.tags = 2; // Hidden flag
        }
        
        metaData.push(metadata);
      }
      
      // Use spk-js batch nodeUpload with progress tracking
      const uploadResult = await this.spk.fileUpload.nodeUpload(filesToUpload, {
        duration: uploadOptions.contract.duration,
        autoRenew: uploadOptions.contract.autoRenew,
        metaData: metaData, // Use metaData (capital D) as per spk-js interface
        onProgress: (progress) => {
          if (!this.isPaused && this.activeUpload === uploadId) {
            this.emit('progress', {
              uploadId,
              stage: 'uploading',
              progress: progress.percent || 0,
              message: `Uploading ${progress.currentFile || 'files'}...`,
              details: progress
            });
          }
        }
      });
      
      this.emit('progress', { 
        uploadId, 
        stage: 'uploading', 
        progress: 100, 
        message: 'Upload complete!' 
      });
      
      // Clean up temp files
      await this.cleanup(tempDir);
      
      // Return result with all necessary information
      return {
        uploadId,
        success: true,
        contract: uploadResult.contract,
        master: {
          cid: cidMapping['master.m3u8'],
          url: `https://ipfs.dlux.io/ipfs/${cidMapping['master.m3u8']}`
        },
        thumbnail: thumbnailCid ? {
          cid: thumbnailCid,
          url: `https://ipfs.dlux.io/ipfs/${thumbnailCid}`
        } : null,
        resolutions: hlsOutput.resolutions.map(r => ({
          resolution: r.resolution,
          playlist: cidMapping[path.basename(r.playlistPath)],
          segments: r.segments.map(s => ({
            filename: s.filename,
            cid: cidMapping[s.filename]
          }))
        })),
        metadata: uploadMetadata
      };
      
    } catch (error) {
      this.emit('error', {
        uploadId,
        error: error.message,
        stack: error.stack
      });
      
      // Clean up on error
      if (this.tempFiles.size > 0) {
        for (const tempDir of this.tempFiles) {
          await this.cleanup(tempDir);
        }
      }
      
      throw error;
    } finally {
      if (this.activeUpload === uploadId) {
        this.activeUpload = null;
      }
    }
  }

  /**
   * Pause current upload
   */
  pauseUpload() {
    this.isPaused = true;
    this.transcoder.pause();
    this.emit('paused', { uploadId: this.activeUpload });
  }

  /**
   * Resume current upload
   */
  resumeUpload() {
    this.isPaused = false;
    this.transcoder.resume();
    this.emit('resumed', { uploadId: this.activeUpload });
  }

  /**
   * Cancel current upload
   */
  async cancelUpload() {
    if (this.activeUpload) {
      this.transcoder.cancel();
      
      // Clean up temp files
      for (const tempDir of this.tempFiles) {
        await this.cleanup(tempDir);
      }
      
      const uploadId = this.activeUpload;
      this.activeUpload = null;
      
      this.emit('cancelled', { uploadId });
    }
  }

  /**
   * Get upload status
   */
  getStatus() {
    return {
      hasActiveUpload: !!this.activeUpload,
      activeUploadId: this.activeUpload,
      isPaused: this.isPaused,
      queueLength: this.uploadQueue.length
    };
  }

  /**
   * Clean up temporary files
   */
  async cleanup(tempDir) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      this.tempFiles.delete(tempDir);
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }

  /**
   * Add upload to queue
   */
  async queueUpload(videoPath, options) {
    const queueItem = {
      id: uuidv4(),
      videoPath,
      options,
      status: 'queued',
      addedAt: Date.now()
    };
    
    this.uploadQueue.push(queueItem);
    this.emit('queued', queueItem);
    
    // Process queue if not busy
    if (!this.activeUpload) {
      await this.processQueue();
    }
    
    return queueItem.id;
  }

  /**
   * Process upload queue
   */
  async processQueue() {
    if (this.activeUpload || this.uploadQueue.length === 0) {
      return;
    }
    
    const nextItem = this.uploadQueue.shift();
    nextItem.status = 'processing';
    
    try {
      const result = await this.uploadVideo(nextItem.videoPath, nextItem.options);
      nextItem.status = 'completed';
      nextItem.result = result;
      this.emit('completed', nextItem);
    } catch (error) {
      nextItem.status = 'failed';
      nextItem.error = error;
      this.emit('failed', nextItem);
    }
    
    // Process next item
    await this.processQueue();
  }
}

module.exports = VideoUploadServiceV2;