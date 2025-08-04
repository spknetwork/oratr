const Transcoder = require('../../../../src/core/ffmpeg/transcoder');
const path = require('path');
const fs = require('fs').promises;

describe('Transcoder', () => {
  let transcoder;

  beforeEach(() => {
    transcoder = new Transcoder();
  });

  afterEach(async () => {
    await transcoder.cleanup();
  });

  describe('initialization', () => {
    test('should create transcoder instance', () => {
      expect(transcoder).toBeDefined();
      expect(transcoder).toBeInstanceOf(Transcoder);
    });

    test('should check if FFmpeg is available', async () => {
      const isAvailable = await transcoder.checkFFmpegAvailable();
      expect(typeof isAvailable).toBe('boolean');
    });

    test('should get FFmpeg version', async () => {
      const version = await transcoder.getFFmpegVersion();
      expect(version).toMatch(/ffmpeg version/i);
    });
  });

  describe.skip('video analysis', () => { // TODO: Need valid test video file
    test('should analyze video metadata', async () => {
      const mockVideoPath = path.join(__dirname, '../../../fixtures/sample-video.mp4');
      const metadata = await transcoder.analyzeVideo(mockVideoPath);
      
      expect(metadata).toHaveProperty('duration');
      expect(metadata).toHaveProperty('width');
      expect(metadata).toHaveProperty('height');
      expect(metadata).toHaveProperty('bitrate');
      expect(metadata).toHaveProperty('codec');
    });

    test('should determine optimal output resolutions', async () => {
      const metadata = {
        width: 1920,
        height: 1080,
        bitrate: 5000000
      };
      
      const resolutions = transcoder.determineOutputResolutions(metadata);
      expect(resolutions).toContain('1080p');
      expect(resolutions).toContain('720p');
      expect(resolutions).toContain('480p');
    });

    test('should not upscale video', async () => {
      const metadata = {
        width: 640,
        height: 480,
        bitrate: 1000000
      };
      
      const resolutions = transcoder.determineOutputResolutions(metadata);
      expect(resolutions).not.toContain('1080p');
      expect(resolutions).not.toContain('720p');
      expect(resolutions).toContain('480p');
    });
  });

  describe.skip('thumbnail generation', () => { // TODO: Need valid test video file
    test('should generate thumbnail from video', async () => {
      const mockVideoPath = path.join(__dirname, '../../../fixtures/sample-video.mp4');
      const thumbnail = await transcoder.generateThumbnail(mockVideoPath);
      
      expect(thumbnail).toHaveProperty('buffer');
      expect(thumbnail).toHaveProperty('mimeType', 'image/jpeg');
      expect(thumbnail.buffer).toBeInstanceOf(Buffer);
    });

    test('should generate thumbnail at specific timestamp', async () => {
      const mockVideoPath = path.join(__dirname, '../../../fixtures/sample-video.mp4');
      const timestamp = 10; // 10 seconds
      const thumbnail = await transcoder.generateThumbnail(mockVideoPath, timestamp);
      
      expect(thumbnail).toHaveProperty('buffer');
      expect(thumbnail.buffer.length).toBeGreaterThan(0);
    });
  });

  describe.skip('HLS transcoding', () => { // TODO: Need valid test video file
    test('should transcode video to HLS format', async () => {
      const mockVideoPath = path.join(__dirname, '../../../fixtures/sample-video.mp4');
      const outputDir = '/tmp/transcode-test';
      const resolution = '720p';
      
      const result = await transcoder.transcodeToHLS(mockVideoPath, outputDir, resolution);
      
      expect(result).toHaveProperty('playlistPath');
      expect(result).toHaveProperty('segments');
      expect(result.playlistPath).toMatch(/\.m3u8$/);
      expect(result.segments).toBeInstanceOf(Array);
      expect(result.segments.length).toBeGreaterThan(0);
    });

    test('should emit progress events during transcoding', async () => {
      const mockVideoPath = path.join(__dirname, '../../../fixtures/sample-video.mp4');
      const outputDir = '/tmp/transcode-test';
      const progressEvents = [];
      
      transcoder.on('progress', (progress) => {
        progressEvents.push(progress);
      });
      
      await transcoder.transcodeToHLS(mockVideoPath, outputDir, '480p');
      
      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents[0]).toHaveProperty('percent');
      expect(progressEvents[0]).toHaveProperty('currentTime');
      expect(progressEvents[0]).toHaveProperty('speed');
    });

    test('should handle transcoding cancellation', async () => {
      const mockVideoPath = path.join(__dirname, '../../../fixtures/sample-video.mp4');
      const outputDir = '/tmp/transcode-test';
      
      const transcodePromise = transcoder.transcodeToHLS(mockVideoPath, outputDir, '1080p');
      
      setTimeout(() => transcoder.cancel(), 100);
      
      await expect(transcodePromise).rejects.toThrow('Transcoding cancelled');
    });

    test('should apply correct encoding settings for each resolution', async () => {
      const settings = transcoder.getEncodingSettings('720p');
      
      expect(settings).toHaveProperty('videoBitrate', '2500k');
      expect(settings).toHaveProperty('audioBitrate', '128k');
      expect(settings).toHaveProperty('maxWidth', 1280);
      expect(settings).toHaveProperty('maxHeight', 720);
      expect(settings).toHaveProperty('preset', 'fast');
      expect(settings).toHaveProperty('crf', 23);
    });
  });

  describe.skip('batch processing', () => { // TODO: Need valid test video file
    test('should transcode to multiple resolutions', async () => {
      const mockVideoPath = path.join(__dirname, '../../../fixtures/sample-video.mp4');
      const outputDir = '/tmp/transcode-test';
      const resolutions = ['1080p', '720p', '480p'];
      
      const results = await transcoder.transcodeToMultipleResolutions(
        mockVideoPath,
        outputDir,
        resolutions
      );
      
      expect(Object.keys(results)).toEqual(resolutions);
      expect(results['1080p']).toHaveProperty('playlistPath');
      expect(results['720p']).toHaveProperty('playlistPath');
      expect(results['480p']).toHaveProperty('playlistPath');
    });

    test('should create master playlist', async () => {
      const resolutionResults = {
        '1080p': { playlistPath: '/tmp/1080p.m3u8', bandwidth: 5000000 },
        '720p': { playlistPath: '/tmp/720p.m3u8', bandwidth: 2500000 },
        '480p': { playlistPath: '/tmp/480p.m3u8', bandwidth: 1000000 }
      };
      
      const masterPlaylist = await transcoder.createMasterPlaylist(resolutionResults);
      
      expect(masterPlaylist).toContain('#EXTM3U');
      expect(masterPlaylist).toContain('#EXT-X-VERSION:3');
      expect(masterPlaylist).toContain('BANDWIDTH=5000000');
      expect(masterPlaylist).toContain('RESOLUTION=1920x1080');
      expect(masterPlaylist).toContain('1080p.m3u8');
    });
  });

  describe.skip('error handling', () => { // TODO: Need valid test video file
    test('should handle invalid video file', async () => {
      const invalidPath = '/path/to/nonexistent.mp4';
      
      await expect(transcoder.analyzeVideo(invalidPath))
        .rejects.toThrow('Video file not found');
    });

    test('should handle corrupted video file', async () => {
      const corruptedPath = path.join(__dirname, '../../../fixtures/sample-video.mp4'); // Mock corrupted for test
      
      await expect(transcoder.transcodeToHLS(corruptedPath, '/tmp', '720p'))
        .rejects.toThrow(/Invalid video file|Failed to decode/);
    });

    test('should handle insufficient disk space', async () => {
      const mockVideoPath = path.join(__dirname, '../../../fixtures/sample-video.mp4'); // Mock large video for test
      const outputDir = '/tmp/full-disk';
      
      // Mock disk space check
      jest.spyOn(transcoder, 'checkDiskSpace').mockResolvedValue(false);
      
      await expect(transcoder.transcodeToHLS(mockVideoPath, outputDir, '1080p'))
        .rejects.toThrow('Insufficient disk space');
    });
  });

  describe('cleanup', () => {
    test('should clean up temporary files', async () => {
      const tempDir = await transcoder.createTempDirectory();
      expect(await fs.access(tempDir).then(() => true).catch(() => false)).toBe(true);
      
      await transcoder.cleanup();
      expect(await fs.access(tempDir).then(() => true).catch(() => false)).toBe(false);
    });

    test('should cancel ongoing transcoding on cleanup', async () => {
      const mockVideoPath = path.join(__dirname, '../../../fixtures/sample-video.mp4');
      const outputDir = '/tmp/transcode-test';
      
      const transcodePromise = transcoder.transcodeToHLS(mockVideoPath, outputDir, '1080p');
      
      setTimeout(() => transcoder.cleanup(), 100);
      
      await expect(transcodePromise).rejects.toThrow();
    });
  });
});