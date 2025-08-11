const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { execSync } = require('child_process');
const tar = require('tar');
const unzipper = require('unzipper');

/**
 * FFmpeg Binary Manager
 * Downloads and manages platform-specific FFmpeg binaries
 */
class FFmpegBinaryManager {
  constructor() {
    this.platform = os.platform();
    this.arch = os.arch();
    // Place binaries under user data dir to avoid modifying app bundle after signing
    this.binDir = (() => {
      try {
        const electron = require('electron');
        const app = electron?.app || electron?.remote?.app;
        if (app && typeof app.getPath === 'function') {
          return path.join(app.getPath('userData'), 'bin');
        }
      } catch (_) {}
      return path.join(os.homedir(), '.oratr', 'bin');
    })();
    this.ffmpegPath = path.join(this.binDir, this.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    this.ffprobePath = path.join(this.binDir, this.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  }

  /**
   * Get FFmpeg download URLs for current platform
   */
  getDownloadUrls() {
    const urls = {
      'darwin-x64': {
        ffmpeg: 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
        ffprobe: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip'
      },
      'darwin-arm64': {
        ffmpeg: 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
        ffprobe: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip'
      },
      'linux-x64': {
        bundle: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'
      },
      'linux-arm64': {
        bundle: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz'
      },
      'win32-x64': {
        bundle: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
      },
      'win32-arm64': {
        // Uses x64 binary with Windows 11 ARM64 emulation
        bundle: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
      }
    };

    const key = `${this.platform}-${this.arch === 'arm64' ? 'arm64' : 'x64'}`;
    return urls[key];
  }

  /**
   * Check if FFmpeg binaries are already installed
   */
  isInstalled() {
    try {
      return fs.existsSync(this.ffmpegPath) && fs.existsSync(this.ffprobePath);
    } catch {
      return false;
    }
  }

  /**
   * Download file from URL
   */
  async downloadFile(url, outputPath) {
    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        maxRedirects: 5,
        timeout: 300000, // 5 minutes
        onDownloadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
            process.stdout.write(`\rDownloading FFmpeg: ${percent}%`);
          }
        }
      });

      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log('\nDownload complete');
          resolve();
        });
        writer.on('error', (err) => {
          fs.unlinkSync(outputPath);
          reject(err);
        });
      });
    } catch (error) {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  /**
   * Extract FFmpeg binaries from archive
   */
  async extractBinaries(archivePath) {
    const extractDir = path.join(this.binDir, 'temp');
    
    // Create directories
    fs.mkdirSync(this.binDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });

    if (this.platform === 'win32' || archivePath.endsWith('.zip')) {
      // Extract ZIP
      await fs.createReadStream(archivePath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .promise();
    } else if (archivePath.endsWith('.tar.xz')) {
      // Extract tar.xz
      execSync(`tar -xf "${archivePath}" -C "${extractDir}"`, { stdio: 'inherit' });
    } else if (archivePath.endsWith('.tar.gz')) {
      // Extract tar.gz
      await tar.x({
        file: archivePath,
        cwd: extractDir
      });
    }

    // Find and move binaries
    const files = this.findBinaries(extractDir);
    
    if (files.ffmpeg) {
      fs.renameSync(files.ffmpeg, this.ffmpegPath);
      if (this.platform !== 'win32') {
        fs.chmodSync(this.ffmpegPath, '755');
      }
    }

    if (files.ffprobe) {
      fs.renameSync(files.ffprobe, this.ffprobePath);
      if (this.platform !== 'win32') {
        fs.chmodSync(this.ffprobePath, '755');
      }
    }

    // Clean up
    this.cleanupDirectory(extractDir);
    fs.unlinkSync(archivePath);
  }

  /**
   * Find FFmpeg binaries in extracted directory
   */
  findBinaries(dir) {
    const result = { ffmpeg: null, ffprobe: null };
    const walkDir = (currentPath) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          const name = entry.name.toLowerCase();
          if (name === 'ffmpeg' || name === 'ffmpeg.exe') {
            result.ffmpeg = fullPath;
          } else if (name === 'ffprobe' || name === 'ffprobe.exe') {
            result.ffprobe = fullPath;
          }
        }
      }
    };

    walkDir(dir);
    return result;
  }

  /**
   * Clean up directory recursively
   */
  cleanupDirectory(dir) {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((file) => {
        const curPath = path.join(dir, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          this.cleanupDirectory(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(dir);
    }
  }

  /**
   * Install FFmpeg binaries
   */
  async install(autoDownload = true) {
    if (this.isInstalled()) {
      console.log('FFmpeg binaries already installed');
      return { ffmpegPath: this.ffmpegPath, ffprobePath: this.ffprobePath };
    }
    if (!autoDownload) {
      throw new Error('FFmpeg not installed');
    }

    console.log(`Installing FFmpeg for ${this.platform}-${this.arch}...`);
    
    const urls = this.getDownloadUrls();
    if (!urls) {
      throw new Error(`Unsupported platform: ${this.platform}-${this.arch}`);
    }

    // Create bin directory
    fs.mkdirSync(this.binDir, { recursive: true });

    if (urls.bundle) {
      // Download single bundle (Linux/Windows)
      const ext = urls.bundle.includes('.zip') ? 'zip' : 'tar.xz';
      const archivePath = path.join(this.binDir, `ffmpeg-bundle.${ext}`);
      
      console.log(`Downloading from: ${urls.bundle}`);
      await this.downloadFile(urls.bundle, archivePath);

      console.log('Extracting binaries...');
      await this.extractBinaries(archivePath);
    } else if (urls.ffmpeg && urls.ffprobe) {
      // Download separate files (macOS)
      const ffmpegArchive = path.join(this.binDir, 'ffmpeg.zip');
      const ffprobeArchive = path.join(this.binDir, 'ffprobe.zip');
      
      console.log(`Downloading FFmpeg from: ${urls.ffmpeg}`);
      await this.downloadFile(urls.ffmpeg, ffmpegArchive);
      
      console.log(`Downloading FFprobe from: ${urls.ffprobe}`);
      await this.downloadFile(urls.ffprobe, ffprobeArchive);

      console.log('Extracting FFmpeg...');
      await this.extractBinaries(ffmpegArchive);
      
      console.log('Extracting FFprobe...');
      await this.extractBinaries(ffprobeArchive);
    }

    // Verify installation
    if (!this.isInstalled()) {
      throw new Error('Failed to install FFmpeg binaries');
    }

    console.log('FFmpeg installation complete!');
    return { ffmpegPath: this.ffmpegPath, ffprobePath: this.ffprobePath };
  }

  /**
   * Get binary paths
   */
  getBinaryPaths() {
    if (!this.isInstalled()) {
      throw new Error('FFmpeg not installed. Run npm install or npm run install-ffmpeg');
    }
    return {
      ffmpegPath: this.ffmpegPath,
      ffprobePath: this.ffprobePath
    };
  }

  /**
   * Verify FFmpeg functionality
   */
  async verify() {
    try {
      execSync(`"${this.ffmpegPath}" -version`, { stdio: 'pipe' });
      execSync(`"${this.ffprobePath}" -version`, { stdio: 'pipe' });
      return true;
    } catch (error) {
      console.error('FFmpeg verification failed:', error.message);
      return false;
    }
  }
}

module.exports = FFmpegBinaryManager;