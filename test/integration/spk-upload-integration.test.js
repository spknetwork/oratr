/**
 * Integration tests for SPK upload with spk-js
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;

// Import with File polyfill
require('../../src/core/utils/file-polyfill');

const VideoUploadServiceV2 = require('../../src/core/services/video-upload-service-v2');
const SPKKeychainAdapter = require('../../src/core/spk/keychain-adapter');
const AccountManager = require('../../src/core/spk/account-manager');

describe('SPK Upload Integration', () => {
  let videoUploadService;
  let accountManager;
  let mockTranscoder;
  let mockPlaylistProcessor;
  let mockIpfsManager;
  let mockIntegratedStorage;

  beforeEach(async () => {
    // Create temp directory for account storage
    const tempDir = path.join(__dirname, '../temp-test-accounts');
    await fs.mkdir(tempDir, { recursive: true });

    // Initialize real account manager
    accountManager = new AccountManager({
      storagePath: tempDir,
      appName: 'SPK Desktop Test'
    });

    // Create mock dependencies
    mockTranscoder = {
      analyzeVideo: sinon.stub(),
      determineOutputResolutions: sinon.stub(),
      generateThumbnail: sinon.stub(),
      createTempDirectory: sinon.stub(),
      transcodeToHLS: sinon.stub(),
      on: sinon.stub(),
      pause: sinon.stub(),
      resume: sinon.stub(),
      cancel: sinon.stub()
    };

    mockPlaylistProcessor = {
      processPlaylist: sinon.stub()
    };

    mockIpfsManager = {
      hashOnly: sinon.stub()
    };

    mockIntegratedStorage = {};

    // Initialize service
    videoUploadService = new VideoUploadServiceV2({
      transcoder: mockTranscoder,
      playlistProcessor: mockPlaylistProcessor,
      ipfsManager: mockIpfsManager,
      accountManager,
      integratedStorage: mockIntegratedStorage
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    const tempDir = path.join(__dirname, '../temp-test-accounts');
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Keychain Adapter', () => {
    it('should create keychain adapter that works with spk-js', async () => {
      const adapter = new SPKKeychainAdapter(accountManager);
      
      expect(adapter).to.have.property('requestSignature');
      expect(adapter).to.have.property('requestBroadcast');
      expect(adapter).to.have.property('requestSignatureSynchronous');
      expect(adapter).to.have.property('requestBroadcastSynchronous');
      expect(adapter.isAvailable()).to.be.true;
      expect(adapter.getType()).to.equal('spk-desktop');
    });

    it('should handle signature requests', async () => {
      // Create test account
      const testAccount = {
        username: 'testuser',
        keys: {
          posting: 'test-posting-key'
        }
      };
      
      await accountManager.importAccount(
        testAccount.username,
        testAccount.keys,
        'test-pin-123'
      );
      
      await accountManager.unlock('test-pin-123');
      
      const adapter = new SPKKeychainAdapter(accountManager);
      
      // Test signature request
      const signaturePromise = new Promise((resolve) => {
        adapter.requestSignature(
          'testuser',
          'test-message',
          'posting',
          (response) => {
            resolve(response);
          }
        );
      });

      const response = await signaturePromise;
      
      expect(response.success).to.be.true;
      expect(response.result).to.have.property('signature');
      expect(response.result).to.have.property('publicKey');
    });
  });

  describe('Video Upload with SPK-JS', () => {
    beforeEach(async () => {
      // Set up test account
      await accountManager.importAccount(
        'testuser',
        { posting: 'test-posting-key' },
        'test-pin-123'
      );
      await accountManager.unlock('test-pin-123');

      // Mock video analysis
      mockTranscoder.analyzeVideo.resolves({
        width: 1920,
        height: 1080,
        duration: 120,
        size: 50 * 1024 * 1024, // 50MB
        codec: 'h264'
      });

      mockTranscoder.determineOutputResolutions.returns(['1080p', '720p', '480p']);

      // Mock thumbnail generation
      mockTranscoder.generateThumbnail.resolves({
        buffer: Buffer.from('fake-thumbnail-data'),
        width: 1920,
        height: 1080
      });

      // Mock temp directory
      mockTranscoder.createTempDirectory.resolves('/tmp/test-transcode');

      // Mock HLS output
      mockTranscoder.transcodeToHLS.resolves({
        masterPlaylistPath: '/tmp/test-transcode/master.m3u8',
        resolutions: [
          {
            resolution: '1080p',
            playlistPath: '/tmp/test-transcode/1080p/playlist.m3u8',
            segments: [
              { filename: 'segment0.ts', path: '/tmp/test-transcode/1080p/segment0.ts' },
              { filename: 'segment1.ts', path: '/tmp/test-transcode/1080p/segment1.ts' }
            ]
          },
          {
            resolution: '720p',
            playlistPath: '/tmp/test-transcode/720p/playlist.m3u8',
            segments: [
              { filename: 'segment0.ts', path: '/tmp/test-transcode/720p/segment0.ts' },
              { filename: 'segment1.ts', path: '/tmp/test-transcode/720p/segment1.ts' }
            ]
          }
        ]
      });

      // Mock IPFS hashing
      mockIpfsManager.hashOnly.callsFake(async (content) => {
        // Generate fake CID based on content
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        return `Qm${hash.substring(0, 44)}`;
      });

      // Mock playlist processing
      mockPlaylistProcessor.processPlaylist.callsFake(async (content, cidMapping) => {
        // Simple replacement of filenames with CIDs
        let processed = content;
        for (const [filename, cid] of Object.entries(cidMapping)) {
          processed = processed.replace(filename, `/ipfs/${cid}`);
        }
        return processed;
      });

      // Mock file reading for the upload process
      const mockFileContent = {
        '/tmp/test-transcode/master.m3u8': '#EXTM3U\n#EXT-X-VERSION:3\n1080p/playlist.m3u8\n720p/playlist.m3u8',
        '/tmp/test-transcode/1080p/playlist.m3u8': '#EXTM3U\n#EXTINF:10.0,\nsegment0.ts\n#EXTINF:10.0,\nsegment1.ts',
        '/tmp/test-transcode/720p/playlist.m3u8': '#EXTM3U\n#EXTINF:10.0,\nsegment0.ts\n#EXTINF:10.0,\nsegment1.ts',
        '/tmp/test-transcode/1080p/segment0.ts': Buffer.from('fake-video-segment-1080p-0'),
        '/tmp/test-transcode/1080p/segment1.ts': Buffer.from('fake-video-segment-1080p-1'),
        '/tmp/test-transcode/720p/segment0.ts': Buffer.from('fake-video-segment-720p-0'),
        '/tmp/test-transcode/720p/segment1.ts': Buffer.from('fake-video-segment-720p-1')
      };

      // Override fs.readFile in the service
      const originalReadFile = fs.readFile;
      sinon.stub(fs, 'readFile').callsFake(async (filePath) => {
        const content = mockFileContent[filePath];
        if (content) {
          return content;
        }
        return originalReadFile(filePath);
      });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should process video through complete upload workflow', async () => {
      // Mock SPK initialization and upload
      const mockSPK = {
        account: {
          registerPublicKey: sinon.stub().resolves()
        },
        file: {
          upload: sinon.stub().resolves({
            cid: 'QmThumbnailCID123',
            contract: 'thumbnail-contract'
          })
        },
        fileUpload: {
          upload: sinon.stub().resolves({
            contract: {
              id: 'video-contract-123',
              cid: 'QmMasterCID123',
              size: 52428800,
              duration: 30
            }
          })
        }
      };

      // Mock SPK constructor
      const SPK = require('@spknetwork/spk-js');
      sinon.stub(SPK.prototype, 'constructor').returns(mockSPK);

      // Override the SPK property access
      Object.defineProperty(videoUploadService, 'spk', {
        get: () => mockSPK,
        set: () => {},
        configurable: true
      });

      // Track progress events
      const progressEvents = [];
      videoUploadService.on('progress', (data) => {
        progressEvents.push(data);
      });

      // Perform upload
      const result = await videoUploadService.uploadVideo('/test/video.mp4', {
        resolutions: ['1080p', '720p'],
        generateThumbnail: true,
        contract: {
          duration: 30,
          autoRenew: false
        },
        metadata: {
          path: 'Videos',
          tags: ['test', 'demo'],
          labels: 'test-video',
          license: 'CC0'
        }
      });

      // Verify stages were executed
      const stages = progressEvents.map(e => e.stage);
      expect(stages).to.include('analyzing');
      expect(stages).to.include('thumbnail');
      expect(stages).to.include('transcoding');
      expect(stages).to.include('hashing');
      expect(stages).to.include('processing');
      expect(stages).to.include('uploading');

      // Verify result structure
      expect(result).to.have.property('success', true);
      expect(result).to.have.property('uploadId');
      expect(result).to.have.property('contract');
      expect(result).to.have.property('master');
      expect(result).to.have.property('thumbnail');
      expect(result).to.have.property('resolutions');
      expect(result).to.have.property('metadata');

      // Verify thumbnail was uploaded separately
      expect(mockSPK.file.upload).to.have.been.calledOnce;
      
      // Verify batch upload was called with all video files
      expect(mockSPK.fileUpload.upload).to.have.been.calledOnce;
      const uploadCall = mockSPK.fileUpload.upload.getCall(0);
      const uploadedFiles = uploadCall.args[0];
      
      // Should have master + 2 playlists + 4 segments = 7 files
      expect(uploadedFiles).to.have.length(7);
      
      // Verify files are File objects
      uploadedFiles.forEach(file => {
        expect(file).to.be.instanceOf(File);
        expect(file).to.have.property('name');
        expect(file).to.have.property('size');
      });
    });

    it('should handle upload errors gracefully', async () => {
      // Make transcoding fail
      mockTranscoder.transcodeToHLS.rejects(new Error('Transcoding failed'));

      // Track error events
      let errorEvent = null;
      videoUploadService.on('error', (data) => {
        errorEvent = data;
      });

      // Attempt upload
      await expect(
        videoUploadService.uploadVideo('/test/video.mp4')
      ).to.be.rejectedWith('Transcoding failed');

      // Verify error event was emitted
      expect(errorEvent).to.not.be.null;
      expect(errorEvent.error).to.equal('Transcoding failed');
      
      // Verify cleanup was attempted
      expect(videoUploadService.tempFiles.size).to.equal(0);
    });

    it('should support pause and resume', async () => {
      // Start upload in background
      const uploadPromise = videoUploadService.uploadVideo('/test/video.mp4');

      // Wait a bit then pause
      await new Promise(resolve => setTimeout(resolve, 10));
      videoUploadService.pauseUpload();

      expect(videoUploadService.isPaused).to.be.true;
      expect(mockTranscoder.pause).to.have.been.called;

      // Resume
      videoUploadService.resumeUpload();
      expect(videoUploadService.isPaused).to.be.false;
      expect(mockTranscoder.resume).to.have.been.called;

      // Let upload complete
      await uploadPromise;
    });
  });

  describe('Upload Queue', () => {
    it('should queue multiple uploads', async () => {
      const queueId1 = await videoUploadService.queueUpload('/test/video1.mp4', {});
      const queueId2 = await videoUploadService.queueUpload('/test/video2.mp4', {});

      expect(queueId1).to.be.a('string');
      expect(queueId2).to.be.a('string');
      expect(queueId1).to.not.equal(queueId2);

      const status = videoUploadService.getStatus();
      expect(status.queueLength).to.be.at.least(1);
    });
  });
});

describe('File Polyfill', () => {
  it('should provide File and Blob classes', () => {
    expect(File).to.be.a('function');
    expect(Blob).to.be.a('function');

    const file = new File(['hello world'], 'test.txt', { type: 'text/plain' });
    expect(file.name).to.equal('test.txt');
    expect(file.size).to.equal(11);
    expect(file.type).to.equal('text/plain');
  });
});