const { EventEmitter } = require('events');
const ffmpeg = require('fluent-ffmpeg');
const which = require('which');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const FFmpegBinaryManager = require('../binaries/ffmpeg-binary');

/**
 * Video Transcoder using native FFmpeg
 * Handles video analysis, transcoding, and thumbnail generation
 */
class Transcoder extends EventEmitter {
  constructor(config = {}) {
    super();
    // Use bundled FFmpeg binaries by default
    const binaryManager = new FFmpegBinaryManager();
    
    // Resolve ffmpeg/ffprobe paths in order: config → bundled binaries → packaged bin → system PATH
    this.ffmpegPath = config.ffmpegPath || this.resolveBinaryPath('ffmpeg', binaryManager);
    this.ffprobePath = config.ffprobePath || this.resolveBinaryPath('ffprobe', binaryManager);
    this.tempDir = config.tempDir || path.join(os.tmpdir(), 'spk-transcode');
    this.activeJobs = new Map();
    this.isAvailable = null;
    
    // Set FFmpeg paths
    ffmpeg.setFfmpegPath(this.ffmpegPath);
    ffmpeg.setFfprobePath(this.ffprobePath);
  }

  resolveBinaryPath(binaryName, binaryManager) {
    // First try to use bundled binaries
    try {
      const paths = binaryManager.getBinaryPaths();
      if (binaryName === 'ffmpeg' && require('fs').existsSync(paths.ffmpegPath)) {
        return paths.ffmpegPath;
      }
      if (binaryName === 'ffprobe' && require('fs').existsSync(paths.ffprobePath)) {
        return paths.ffprobePath;
      }
    } catch {}

    // Look in app resources/bin (for electron-builder packaging)
    const possible = [];
    const appRoot = path.resolve(__dirname, '../../../');
    possible.push(path.join(appRoot, 'resources', 'bin', binaryName));
    possible.push(path.join(appRoot, 'bin', binaryName));

    for (const p of possible) {
      try { require('fs').accessSync(p); return p; } catch {}
    }

    // Fall back to system PATH
    try {
      return which.sync(binaryName);
    } catch {
      throw new Error(`${binaryName} not found. Please run 'npm run install-ffmpeg' or install FFmpeg manually.`);
    }
  }

  /**
   * Check if FFmpeg is available
   */
  async checkFFmpegAvailable() {
    if (this.isAvailable !== null) return this.isAvailable;
    
    try {
      await this.getFFmpegVersion();
      this.isAvailable = true;
      return true;
    } catch (error) {
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Get FFmpeg version
   */
  async getFFmpegVersion() {
    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      // Use the bundled ffmpeg path
      exec(`"${this.ffmpegPath}" -version`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        
        // Extract version from output
        const versionMatch = stdout.match(/ffmpeg version ([\d\.\-\w]+)/);
        if (versionMatch) {
          resolve(versionMatch[0]);
        } else {
          resolve('FFmpeg installed (version unknown)');
        }
      });
    });
  }

  /**
   * Analyze video metadata
   */
  async analyzeVideo(videoPath) {
    // Check if file exists
    try {
      await fs.access(videoPath);
    } catch {
      throw new Error('Video file not found');
    }

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          if (err.message.includes('Invalid data')) {
            reject(new Error('Invalid video file'));
          } else {
            reject(err);
          }
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        resolve({
          duration: metadata.format.duration,
          size: metadata.format.size,
          bitrate: metadata.format.bit_rate,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          codec: videoStream?.codec_name || 'unknown',
          fps: eval(videoStream?.r_frame_rate) || 0,
          hasAudio: !!audioStream,
          audioCodec: audioStream?.codec_name || null,
          format: metadata.format.format_name
        });
      });
    });
  }

  /**
   * Determine optimal output resolutions based on input
   */
  determineOutputResolutions(metadata) {
    const resolutions = [];
    const { width, height } = metadata;

    // Define standard resolutions
    const standards = [
      { name: '1080p', width: 1920, height: 1080 },
      { name: '720p', width: 1280, height: 720 },
      { name: '480p', width: 854, height: 480 },
      { name: '360p', width: 640, height: 360 }
    ];

    // Only include resolutions that don't upscale
    for (const standard of standards) {
      if (width >= standard.width && height >= standard.height) {
        resolutions.push(standard.name);
      }
    }

    // If video is smaller than 360p, include original resolution
    if (resolutions.length === 0) {
      resolutions.push('original');
    }

    return resolutions;
  }

  /**
   * Generate thumbnail from video
   */
  async generateThumbnail(videoPath, timestamp = 1) {
    const thumbnailPath = path.join(await this.createTempDirectory(), `thumb_${uuidv4()}.jpg`);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [timestamp],
          filename: path.basename(thumbnailPath),
          folder: path.dirname(thumbnailPath),
          size: '640x360'
        })
        .on('error', reject)
        .on('end', async () => {
          try {
            const buffer = await fs.readFile(thumbnailPath);
            await fs.unlink(thumbnailPath);
            resolve({
              buffer,
              mimeType: 'image/jpeg'
            });
          } catch (error) {
            reject(error);
          }
        });
    });
  }

  /**
   * Transcode video to HLS format
   */
  async transcodeToHLS(videoPath, outputDir, resolution) {
    const jobId = uuidv4();
    const playlistName = `${resolution}.m3u8`;
    const playlistPath = path.join(outputDir, playlistName);
    const segmentPattern = path.join(outputDir, `${resolution}_segment_%03d.ts`);

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Get encoding settings
    const settings = this.getEncodingSettings(resolution);

    return new Promise((resolve, reject) => {
      const command = ffmpeg(videoPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          `-preset ${settings.preset}`,
          `-crf ${settings.crf}`,
          `-b:v ${settings.videoBitrate}`,
          `-maxrate ${settings.videoBitrate}`,
          `-bufsize ${parseInt(settings.videoBitrate) * 2}k`,
          `-b:a ${settings.audioBitrate}`,
          `-hls_time 10`,
          `-hls_list_size 0`,
          `-hls_segment_filename ${segmentPattern}`,
          '-f hls'
        ]);

      // Apply resolution scaling if not original
      if (resolution !== 'original') {
        command.size(`${settings.maxWidth}x${settings.maxHeight}`);
      }

      // Track progress
      let duration = 0;
      command.on('codecData', (data) => {
        const match = /Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/.exec(data.duration);
        if (match) {
          duration = parseFloat(match[1]) * 3600 + parseFloat(match[2]) * 60 + parseFloat(match[3]);
        }
      });

      command.on('progress', (progress) => {
        if (duration > 0) {
          const percent = (progress.timemark.replace(/:/g, '') / duration) * 100;
          this.emit('progress', {
            jobId,
            percent: Math.min(percent, 100),
            currentTime: progress.timemark,
            speed: progress.currentFps
          });
        }
      });

      command.on('error', (err) => {
        this.activeJobs.delete(jobId);
        if (err.message.includes('SIGKILL')) {
          reject(new Error('Transcoding cancelled'));
        } else {
          reject(err);
        }
      });

      command.on('end', async () => {
        this.activeJobs.delete(jobId);
        
        // Get list of generated segments
        const files = await fs.readdir(outputDir);
        const segments = files
          .filter(f => f.startsWith(`${resolution}_segment_`) && f.endsWith('.ts'))
          .map(filename => ({
            filename,
            path: path.join(outputDir, filename)
          }));

        resolve({
          playlistPath,
          segments,
          resolution
        });
      });

      // Store command for cancellation
      this.activeJobs.set(jobId, command);
      
      // Run the command
      command.save(playlistPath);
    });
  }

  /**
   * Get encoding settings for resolution
   */
  getEncodingSettings(resolution) {
    const settings = {
      '1080p': {
        videoBitrate: '5000k',
        audioBitrate: '128k',
        maxWidth: 1920,
        maxHeight: 1080,
        preset: 'fast',
        crf: 23
      },
      '720p': {
        videoBitrate: '2500k',
        audioBitrate: '128k',
        maxWidth: 1280,
        maxHeight: 720,
        preset: 'fast',
        crf: 23
      },
      '480p': {
        videoBitrate: '1000k',
        audioBitrate: '128k',
        maxWidth: 854,
        maxHeight: 480,
        preset: 'fast',
        crf: 23
      },
      '360p': {
        videoBitrate: '500k',
        audioBitrate: '96k',
        maxWidth: 640,
        maxHeight: 360,
        preset: 'fast',
        crf: 23
      },
      '240p': {
        videoBitrate: '250k',
        audioBitrate: '64k',
        maxWidth: 426,
        maxHeight: 240,
        preset: 'fast',
        crf: 28
      },
      'original': {
        videoBitrate: '5000k',
        audioBitrate: '128k',
        preset: 'fast',
        crf: 23
      }
    };

    return settings[resolution] || settings['720p'];
  }

  /**
   * Transcode to multiple resolutions
   */
  async transcodeToMultipleResolutions(videoPath, outputDir, resolutions) {
    const results = {};

    for (const resolution of resolutions) {
      const resolutionDir = path.join(outputDir, resolution);
      results[resolution] = await this.transcodeToHLS(videoPath, resolutionDir, resolution);
    }

    return results;
  }

  /**
   * Create master playlist
   */
  async createMasterPlaylist(resolutionResults) {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];

    // Sort by bandwidth (highest first)
    const sorted = Object.entries(resolutionResults)
      .sort((a, b) => (b[1].bandwidth || 0) - (a[1].bandwidth || 0));

    for (const [resolution, data] of sorted) {
      const settings = this.getEncodingSettings(resolution);
      const bandwidth = parseInt(settings.videoBitrate) * 1000;
      
      let resolutionTag = '';
      if (resolution !== 'original') {
        resolutionTag = `,RESOLUTION=${settings.maxWidth}x${settings.maxHeight}`;
      }

      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}${resolutionTag}`);
      lines.push(data.playlistPath);
    }

    return lines.join('\n');
  }

  /**
   * Cancel transcoding job
   */
  cancel(jobId) {
    const command = this.activeJobs.get(jobId);
    if (command) {
      command.kill('SIGKILL');
      this.activeJobs.delete(jobId);
    }
  }

  /**
   * Cancel all active jobs
   */
  cancelAll() {
    for (const [jobId, command] of this.activeJobs) {
      command.kill('SIGKILL');
    }
    this.activeJobs.clear();
  }

  /**
   * Check disk space
   */
  async checkDiskSpace(path, requiredBytes) {
    // This is a simplified check - in production you'd use a proper disk space library
    try {
      const stats = await fs.statfs(path);
      return stats.bavail * stats.bsize > requiredBytes;
    } catch {
      // Fallback for compatibility
      return true;
    }
  }

  /**
   * Create temporary directory
   */
  async createTempDirectory() {
    const tempPath = path.join(this.tempDir, uuidv4());
    await fs.mkdir(tempPath, { recursive: true });
    return tempPath;
  }

  /**
   * Clean up temporary files
   */
  async cleanup() {
    // Cancel all active jobs
    this.cancelAll();

    // Clean up temp directory
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Batch transcode with queue management
   */
  async batchTranscode(jobs, concurrency = 2) {
    const results = [];
    const queue = [...jobs];
    const active = new Set();

    const processNext = async () => {
      if (queue.length === 0 || active.size >= concurrency) return;

      const job = queue.shift();
      active.add(job.id);

      try {
        const result = await this.transcodeToHLS(
          job.input,
          job.output,
          job.resolution
        );
        results.push({ ...job, result, status: 'success' });
      } catch (error) {
        results.push({ ...job, error: error.message, status: 'failed' });
      }

      active.delete(job.id);
      processNext();
    };

    // Start initial batch
    for (let i = 0; i < concurrency; i++) {
      processNext();
    }

    // Wait for all jobs to complete
    while (active.size > 0 || queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }
}

module.exports = Transcoder;