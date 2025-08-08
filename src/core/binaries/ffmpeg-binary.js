const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
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
    this.binDir = path.join(__dirname, '../../../bin');
    this.ffmpegPath = path.join(this.binDir, this.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    this.ffprobePath = path.join(this.binDir, this.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  }

  /**
   * Get FFmpeg download URL for current platform
   */
  getDownloadUrl() {
    const urls = {
      'darwin-x64': 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
      'darwin-arm64': 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
      'linux-x64': 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
      'linux-arm64': 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz',
      'win32-x64': 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
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
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(outputPath);
      
      const request = https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          file.close();
          fs.unlinkSync(outputPath);
          return this.downloadFile(response.headers.location, outputPath)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(outputPath);
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const percent = Math.round((downloadedSize / totalSize) * 100);
          process.stdout.write(`\rDownloading FFmpeg: ${percent}%`);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('\nDownload complete');
          resolve();
        });
      });

      request.on('error', (err) => {
        fs.unlinkSync(outputPath);
        reject(err);
      });
    });
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
  async install() {
    if (this.isInstalled()) {
      console.log('FFmpeg binaries already installed');
      return { ffmpegPath: this.ffmpegPath, ffprobePath: this.ffprobePath };
    }

    console.log(`Installing FFmpeg for ${this.platform}-${this.arch}...`);
    
    const url = this.getDownloadUrl();
    if (!url) {
      throw new Error(`Unsupported platform: ${this.platform}-${this.arch}`);
    }

    const archivePath = path.join(this.binDir, `ffmpeg-download.${url.includes('.zip') ? 'zip' : 'tar.xz'}`);
    
    // Create bin directory
    fs.mkdirSync(this.binDir, { recursive: true });

    // Download archive
    console.log(`Downloading from: ${url}`);
    await this.downloadFile(url, archivePath);

    // Extract binaries
    console.log('Extracting binaries...');
    await this.extractBinaries(archivePath);

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