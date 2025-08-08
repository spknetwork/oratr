const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * ProofOfAccess binary wrapper
 * Provides platform-specific binary path resolution
 * Similar to ffmpeg-static-electron pattern
 */
class ProofOfAccessBinary {
  /**
   * Get the platform-specific binary name
   */
  static getBinaryName() {
    const platform = os.platform();
    const arch = os.arch();
    
    let platformName;
    switch (platform) {
      case 'darwin':
        platformName = 'darwin';
        break;
      case 'win32':
        platformName = 'windows';
        break;
      case 'linux':
        platformName = 'linux';
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
    
    let archName;
    switch (arch) {
      case 'x64':
        archName = 'amd64';
        break;
      case 'arm64':
        archName = 'arm64';
        break;
      default:
        throw new Error(`Unsupported architecture: ${arch}`);
    }
    
    const ext = platform === 'win32' ? '.exe' : '';
    return `proofofaccess-${platformName}-${archName}${ext}`;
  }
  
  /**
   * Get the path to the ProofOfAccess binary
   * First checks for npm-installed package, then falls back to local binary
   */
  static getBinaryPath() {
    // Try to use @disregardfiat/proofofaccess if installed
    try {
      const poaPackage = require('@disregardfiat/proofofaccess');
      // Prefer official API
      if (typeof poaPackage.getBinaryPath === 'function') {
        const pkgPath = poaPackage.getBinaryPath();
        if (pkgPath && fs.existsSync(pkgPath)) {
          return pkgPath;
        }
      }
      // Fallback to .path if older shim is in use
      if (poaPackage.path && fs.existsSync(poaPackage.path)) {
        return poaPackage.path;
      }
    } catch (error) {
      // Package not installed, fall back to bundled binary
    }
    
    // Check for bundled binary in electron app
    const binaryName = this.getBinaryName();
    
    // In production, binaries are in resources/bin
    if (process.resourcesPath) {
      const prodPath = path.join(process.resourcesPath, 'bin', binaryName);
      if (fs.existsSync(prodPath)) {
        return prodPath;
      }
    }
    
    // In development, check various locations
    const possiblePaths = [
      // Development binary location
      path.join(__dirname, '..', '..', '..', 'bin', binaryName),
      // Alternative development location
      path.join(__dirname, '..', '..', '..', 'resources', 'bin', binaryName),
      // User-installed location
      path.join(os.homedir(), '.oratr', 'bin', binaryName),
      // System-wide location
      path.join('/usr', 'local', 'bin', 'proofofaccess'),
      // Windows system location
      path.join('C:', 'Program Files', 'Oratr', 'bin', binaryName)
    ];
    
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }
    
    // If no binary found, return expected development path for error messages
    return path.join(__dirname, '..', '..', '..', 'bin', binaryName);
  }
  
  /**
   * Check if the ProofOfAccess binary is available
   */
  static async isAvailable() {
    try {
      const binaryPath = this.getBinaryPath();
      await fs.promises.access(binaryPath, fs.constants.X_OK);
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Download and install the ProofOfAccess binary
   * This is called during development or if binary is missing
   */
  static async downloadBinary() {
    const axios = require('axios');
    const binaryName = this.getBinaryName();
    const binDir = path.join(__dirname, '..', '..', '..', 'bin');
    const binaryPath = path.join(binDir, binaryName);
    
    // Create bin directory if it doesn't exist
    await fs.promises.mkdir(binDir, { recursive: true });
    
    // Determine download URL based on platform
    const version = 'v0.2.0'; // This should be updated or made configurable
    const baseUrl = 'https://github.com/spknetwork/proofofaccess/releases/download';
    const downloadUrl = `${baseUrl}/${version}/${binaryName}`;
    
    console.log(`Downloading ProofOfAccess binary from ${downloadUrl}...`);
    
    try {
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream'
      });
      
      const writer = fs.createWriteStream(binaryPath);
      response.data.pipe(writer);
      
      return new Promise((resolve, reject) => {
        writer.on('finish', async () => {
          // Make binary executable on Unix-like systems
          if (process.platform !== 'win32') {
            await fs.promises.chmod(binaryPath, 0o755);
          }
          console.log(`ProofOfAccess binary downloaded to ${binaryPath}`);
          resolve(binaryPath);
        });
        writer.on('error', reject);
      });
    } catch (error) {
      throw new Error(`Failed to download ProofOfAccess binary: ${error.message}`);
    }
  }
  
  /**
   * Get the binary path, downloading if necessary
   */
  static async ensureBinary() {
    const isAvailable = await this.isAvailable();
    if (!isAvailable) {
      console.log('ProofOfAccess binary not found, downloading...');
      await this.downloadBinary();
    }
    return this.getBinaryPath();
  }
}

// Export similar to ffmpeg-static-electron pattern
module.exports = {
  path: ProofOfAccessBinary.getBinaryPath(),
  getBinaryPath: ProofOfAccessBinary.getBinaryPath.bind(ProofOfAccessBinary),
  getBinaryName: ProofOfAccessBinary.getBinaryName.bind(ProofOfAccessBinary),
  isAvailable: ProofOfAccessBinary.isAvailable.bind(ProofOfAccessBinary),
  downloadBinary: ProofOfAccessBinary.downloadBinary.bind(ProofOfAccessBinary),
  ensureBinary: ProofOfAccessBinary.ensureBinary.bind(ProofOfAccessBinary)
};