const VideoUploadService = require('../../src/core/services/video-upload-service');
const Transcoder = require('../../src/core/ffmpeg/transcoder');
const PlaylistProcessor = require('../../src/core/ffmpeg/playlist-processor');
const IPFSManager = require('../../src/core/ipfs/ipfs-manager');
const SPKClient = require('../../src/core/spk/spk-client');
const path = require('path');
const fs = require('fs').promises;

describe.skip('Video Upload Flow Integration', () => { // TODO: Fix account management and electron mocking
  let videoUploadService;
  let transcoder;
  let playlistProcessor;
  let ipfsManager;
  let spkClient;

  beforeAll(async () => {
    // Initialize services
    transcoder = new Transcoder();
    playlistProcessor = new PlaylistProcessor();
    ipfsManager = new IPFSManager();
    spkClient = new SPKClient({
      apiUrl: 'https://spktest.dlux.io',
      account: 'test-account'
    });

    videoUploadService = new VideoUploadService({
      transcoder,
      playlistProcessor,
      ipfsManager,
      spkClient
    });

    // Start IPFS node
    await ipfsManager.start();
  });

  afterAll(async () => {
    await ipfsManager.stop();
    await transcoder.cleanup();
  });

  describe('complete upload workflow', () => {
    test('should process video from file to SPK Network', async () => {
      const videoPath = path.join(__dirname, '../fixtures/sample-video.mp4');
      const uploadOptions = {
        resolutions: ['720p', '480p'],
        generateThumbnail: true,
        contract: {
          duration: 30 * 24 * 60 * 60, // 30 days
          autoRenew: true
        }
      };

      // Start upload process
      const uploadResult = await videoUploadService.uploadVideo(videoPath, uploadOptions);

      // Verify result structure
      expect(uploadResult).toHaveProperty('masterPlaylistCID');
      expect(uploadResult).toHaveProperty('thumbnail');
      expect(uploadResult).toHaveProperty('resolutions');
      expect(uploadResult).toHaveProperty('contract');
      expect(uploadResult).toHaveProperty('uploadStats');

      // Verify resolutions
      expect(Object.keys(uploadResult.resolutions)).toEqual(['720p', '480p']);
      
      // Verify each resolution has required properties
      Object.values(uploadResult.resolutions).forEach(resolution => {
        expect(resolution).toHaveProperty('playlistCID');
        expect(resolution).toHaveProperty('segments');
        expect(resolution).toHaveProperty('bandwidth');
        expect(resolution.segments).toBeInstanceOf(Array);
        expect(resolution.segments.length).toBeGreaterThan(0);
      });

      // Verify thumbnail
      expect(uploadResult.thumbnail).toHaveProperty('cid');
      expect(uploadResult.thumbnail).toHaveProperty('mimeType', 'image/jpeg');

      // Verify contract
      expect(uploadResult.contract).toHaveProperty('id');
      expect(uploadResult.contract).toHaveProperty('status', 'active');
    });

    test('should handle progress events during upload', async () => {
      const videoPath = path.join(__dirname, '../fixtures/sample-video.mp4');
      const progressEvents = [];

      videoUploadService.on('progress', (event) => {
        progressEvents.push(event);
      });

      await videoUploadService.uploadVideo(videoPath, {
        resolutions: ['480p']
      });

      // Verify progress events
      expect(progressEvents.length).toBeGreaterThan(0);
      
      // Check for different stages
      const stages = progressEvents.map(e => e.stage);
      expect(stages).toContain('analyzing');
      expect(stages).toContain('transcoding');
      expect(stages).toContain('hashing');
      expect(stages).toContain('uploading');
      expect(stages).toContain('finalizing');

      // Verify progress values
      progressEvents.forEach(event => {
        expect(event).toHaveProperty('progress');
        expect(event.progress).toBeGreaterThanOrEqual(0);
        expect(event.progress).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('transcoding and hashing', () => {
    test('should transcode video and generate correct hashes', async () => {
      const videoPath = path.join(__dirname, '../fixtures/sample-video.mp4');
      
      // Step 1: Analyze video
      const metadata = await transcoder.analyzeVideo(videoPath);
      expect(metadata).toHaveProperty('duration');
      expect(metadata).toHaveProperty('width');
      expect(metadata).toHaveProperty('height');

      // Step 2: Transcode to HLS
      const outputDir = await transcoder.createTempDirectory();
      const transcodeResult = await transcoder.transcodeToHLS(videoPath, outputDir, '480p');
      
      expect(transcodeResult).toHaveProperty('playlistPath');
      expect(transcodeResult).toHaveProperty('segments');

      // Step 3: Generate hashes for segments
      const segmentHashes = {};
      for (const segment of transcodeResult.segments) {
        const content = await fs.readFile(segment.path);
        const hash = await ipfsManager.hashOnly(content);
        segmentHashes[segment.filename] = hash;
      }

      // Step 4: Process playlist
      const playlistContent = await fs.readFile(transcodeResult.playlistPath, 'utf-8');
      const rewrittenPlaylist = playlistProcessor.rewritePlaylistWithIPFS(
        playlistContent,
        segmentHashes
      );

      // Verify playlist was rewritten
      expect(rewrittenPlaylist).toContain('https://ipfs.dlux.io/ipfs/');
      expect(rewrittenPlaylist).not.toContain('.ts\n');

      // Step 5: Hash the rewritten playlist
      const playlistHash = await ipfsManager.hashOnly(Buffer.from(rewrittenPlaylist));
      expect(playlistHash).toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
    });

    test('should create master playlist with multiple resolutions', async () => {
      const resolutions = {
        '720p': {
          playlistCID: 'QmPlaylist720p',
          bandwidth: 2500000,
          width: 1280,
          height: 720
        },
        '480p': {
          playlistCID: 'QmPlaylist480p',
          bandwidth: 1000000,
          width: 854,
          height: 480
        }
      };

      const masterPlaylist = playlistProcessor.createMasterPlaylist(
        Object.entries(resolutions).map(([res, data]) => ({
          resolution: res,
          filename: `${res}.m3u8`,
          hash: data.playlistCID,
          ...data
        }))
      );

      // Verify master playlist format
      expect(masterPlaylist).toContain('#EXTM3U');
      expect(masterPlaylist).toContain('BANDWIDTH=2500000,RESOLUTION=1280x720');
      expect(masterPlaylist).toContain('BANDWIDTH=1000000,RESOLUTION=854x480');
      expect(masterPlaylist).toContain('https://ipfs.dlux.io/ipfs/QmPlaylist720p');
      expect(masterPlaylist).toContain('https://ipfs.dlux.io/ipfs/QmPlaylist480p');
    });
  });

  describe('IPFS upload', () => {
    test('should upload all video files to IPFS', async () => {
      const files = [
        { name: 'segment_000.ts', content: Buffer.from('segment 0 content') },
        { name: 'segment_001.ts', content: Buffer.from('segment 1 content') },
        { name: '480p.m3u8', content: Buffer.from('#EXTM3U\n...') },
        { name: 'master.m3u8', content: Buffer.from('#EXTM3U\n...') }
      ];

      // Upload files
      const uploadResults = await ipfsManager.addFiles(files);

      // Verify uploads
      expect(uploadResults).toHaveLength(4);
      uploadResults.forEach((result, index) => {
        expect(result).toHaveProperty('cid');
        expect(result).toHaveProperty('name', files[index].name);
        expect(result).toHaveProperty('size', files[index].content.length);
      });

      // Verify files are retrievable
      for (const result of uploadResults) {
        const retrieved = await ipfsManager.getFile(result.cid);
        expect(retrieved).toBeDefined();
      }
    });

    test('should pin important files', async () => {
      const masterPlaylist = Buffer.from('#EXTM3U\nmaster playlist content');
      const { cid } = await ipfsManager.addFile(masterPlaylist, 'master.m3u8', { pin: true });

      const isPinned = await ipfsManager.isPinned(cid);
      expect(isPinned).toBe(true);

      // Verify pin persists after garbage collection
      await ipfsManager.runGarbageCollection();
      
      const stillPinned = await ipfsManager.isPinned(cid);
      expect(stillPinned).toBe(true);
    });
  });

  describe('SPK Network integration', () => {
    test('should create storage contract', async () => {
      const videoData = {
        masterCID: 'QmMasterPlaylist',
        size: 1024 * 1024 * 100, // 100MB
        duration: 300 // 5 minutes
      };

      const contract = await spkClient.createStorageContract({
        cid: videoData.masterCID,
        size: videoData.size,
        duration: 30 * 24 * 60 * 60, // 30 days
        redundancy: 3
      });

      expect(contract).toHaveProperty('id');
      expect(contract).toHaveProperty('status', 'pending');
      expect(contract).toHaveProperty('cost');
      expect(contract).toHaveProperty('storageNodes');
    });

    test('should calculate BROCA cost', async () => {
      const fileSize = 1024 * 1024 * 50; // 50MB
      const duration = 30; // days
      
      const cost = await spkClient.calculateStorageCost(fileSize, duration);

      expect(cost).toHaveProperty('broca');
      expect(cost).toHaveProperty('usd');
      expect(cost.broca).toBeGreaterThan(0);
    });

    test('should check account balance', async () => {
      const balance = await spkClient.getAccountBalance();

      expect(balance).toHaveProperty('broca');
      expect(balance).toHaveProperty('spk');
      expect(balance).toHaveProperty('larynx');
    });
  });

  describe('error handling and recovery', () => {
    test('should handle transcoding failure', async () => {
      const invalidVideoPath = '/path/to/invalid/video.mp4';

      await expect(videoUploadService.uploadVideo(invalidVideoPath))
        .rejects.toThrow('Video file not found');
    });

    test('should handle IPFS upload failure', async () => {
      // Mock IPFS failure
      jest.spyOn(ipfsManager, 'addFile').mockRejectedValueOnce(new Error('IPFS node offline'));

      const videoPath = path.join(__dirname, '../fixtures/sample-video.mp4');

      await expect(videoUploadService.uploadVideo(videoPath))
        .rejects.toThrow('IPFS node offline');
    });

    test('should handle insufficient BROCA balance', async () => {
      // Mock insufficient balance
      jest.spyOn(spkClient, 'getAccountBalance').mockResolvedValueOnce({
        broca: 10,
        spk: 1000,
        larynx: 5000
      });

      jest.spyOn(spkClient, 'calculateStorageCost').mockResolvedValueOnce({
        broca: 1000,
        usd: 5
      });

      const videoPath = path.join(__dirname, '../fixtures/sample-video.mp4');

      await expect(videoUploadService.uploadVideo(videoPath))
        .rejects.toThrow('Insufficient BROCA balance');
    });

    test('should cleanup on cancellation', async () => {
      const videoPath = path.join(__dirname, '../fixtures/sample-video.mp4');
      
      const uploadPromise = videoUploadService.uploadVideo(videoPath);
      
      // Cancel after 100ms
      setTimeout(() => videoUploadService.cancel(), 100);

      await expect(uploadPromise).rejects.toThrow('Upload cancelled');

      // Verify cleanup
      const tempFiles = await videoUploadService.getTempFiles();
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe('resume capability', () => {
    test('should save upload state for resume', async () => {
      const videoPath = path.join(__dirname, '../fixtures/sample-video.mp4');
      
      // Mock interruption
      let interrupted = false;
      videoUploadService.on('progress', (event) => {
        if (event.stage === 'uploading' && event.progress > 50 && !interrupted) {
          interrupted = true;
          videoUploadService.pause();
        }
      });

      await videoUploadService.uploadVideo(videoPath);

      // Get saved state
      const savedState = await videoUploadService.getSavedState();
      
      expect(savedState).toHaveProperty('videoPath', videoPath);
      expect(savedState).toHaveProperty('progress');
      expect(savedState).toHaveProperty('completedSegments');
      expect(savedState.progress).toBeGreaterThan(50);
    });

    test('should resume from saved state', async () => {
      const savedState = {
        videoPath: path.join(__dirname, '../fixtures/sample-video.mp4'),
        progress: 60,
        completedSegments: ['segment_000.ts', 'segment_001.ts'],
        resolutions: ['480p'],
        stage: 'uploading'
      };

      await videoUploadService.loadState(savedState);
      
      const result = await videoUploadService.resume();

      expect(result).toHaveProperty('masterPlaylistCID');
      expect(result).toHaveProperty('resumed', true);
    });
  });
});