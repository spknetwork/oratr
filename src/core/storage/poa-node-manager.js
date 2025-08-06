const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Simplified POA Node Manager
 * Manages ProofOfAccess as a child process like ffmpeg
 */
class POANodeManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Data storage paths
      dataPath: config.dataPath || path.join(os.homedir(), '.oratr', 'poa'),
      
      // POA binary path - will be determined at runtime
      binaryPath: config.binaryPath || null,
      
      // Node configuration
      account: config.account || null,
      nodeType: config.nodeType || 2, // 1 = validator, 2 = storage
      
      // IPFS configuration
      ipfsHost: config.ipfsHost || '127.0.0.1',
      ipfsPort: config.ipfsPort || 5001,
      
      // SPK Network configuration
      spkApiUrl: config.spkApiUrl || 'https://spktest.dlux.io',
      validatorsUrl: config.validatorsUrl || null,
      
      // Storage configuration
      maxStorage: config.maxStorage || 100 * 1024 * 1024 * 1024, // 100GB default
      
      // Process management
      autoRestart: config.autoRestart !== false,
      maxRestarts: config.maxRestarts || 5,
      restartDelay: config.restartDelay || 5000,
      
      ...config
    };
    
    this.process = null;
    this.running = false;
    this.restartCount = 0;
    this.restartTimer = null;
    
    // Stats tracking
    this.stats = {
      filesStored: 0,
      validations: 0,
      earnings: 0,
      lastValidation: null,
      startTime: null,
      uptime: 0
    };
    
    // Log buffer for UI display
    this.logs = [];
    this.maxLogs = 1000;
  }
  
  /**
   * Locate the POA binary
   * Tries multiple strategies in order:
   * 1. Check if @disregardfiat/proofofaccess npm package provides it
   * 2. Check bundled binary in electron resources
   * 3. Check system PATH
   * 4. Check common installation locations
   */
  async locateBinary() {
    const candidates = [];
    
    // 1. Try npm package first (if installed)
    try {
      // Check if the npm package has a binary
      const poaPackagePath = require.resolve('@disregardfiat/proofofaccess/package.json');
      const poaDir = path.dirname(poaPackagePath);
      
      // Check for platform-specific binary
      const platform = os.platform();
      const arch = os.arch();
      let binaryName = 'proofofaccess';
      
      if (platform === 'win32') {
        binaryName = 'proofofaccess.exe';
      }
      
      candidates.push(
        path.join(poaDir, 'bin', binaryName),
        path.join(poaDir, binaryName),
        path.join(poaDir, 'build', binaryName)
      );
    } catch (error) {
      // Package not installed or not found
    }
    
    // 2. Check electron app resources (for production)
    if (process.resourcesPath) {
      const platform = os.platform();
      const arch = os.arch();
      let binaryName = 'proofofaccess';
      
      if (platform === 'darwin') {
        binaryName = `proofofaccess-darwin-${arch === 'arm64' ? 'arm64' : 'amd64'}`;
      } else if (platform === 'linux') {
        binaryName = `proofofaccess-linux-${arch === 'arm64' ? 'arm64' : 'amd64'}`;
      } else if (platform === 'win32') {
        binaryName = `proofofaccess-windows-amd64.exe`;
      }
      
      candidates.push(
        path.join(process.resourcesPath, 'bin', binaryName),
        path.join(process.resourcesPath, 'app', 'bin', binaryName)
      );
    }
    
    // 3. Check development locations
    const devBinPath = path.join(__dirname, '..', '..', '..', 'bin');
    const platform = os.platform();
    const arch = os.arch();
    let devBinaryName = 'proofofaccess';
    
    if (platform === 'darwin') {
      devBinaryName = `proofofaccess-darwin-${arch === 'arm64' ? 'arm64' : 'amd64'}`;
    } else if (platform === 'linux') {
      devBinaryName = `proofofaccess-linux-${arch === 'arm64' ? 'arm64' : 'amd64'}`;
    } else if (platform === 'win32') {
      devBinaryName = `proofofaccess-windows-amd64.exe`;
    }
    
    candidates.push(path.join(devBinPath, devBinaryName));
    
    // 4. Check system locations
    candidates.push(
      '/usr/local/bin/proofofaccess',
      '/usr/bin/proofofaccess',
      path.join(os.homedir(), '.oratr', 'bin', 'proofofaccess'),
      path.join(os.homedir(), '.local', 'bin', 'proofofaccess')
    );
    
    if (platform === 'win32') {
      candidates.push(
        'C:\\Program Files\\Oratr\\bin\\proofofaccess.exe',
        'C:\\Program Files (x86)\\Oratr\\bin\\proofofaccess.exe'
      );
    }
    
    // Test each candidate
    for (const candidate of candidates) {
      try {
        await fs.access(candidate, fs.constants.X_OK);
        this.emit('log', { 
          level: 'info', 
          message: `Found POA binary at: ${candidate}` 
        });
        return candidate;
      } catch (error) {
        // Not found or not executable, try next
      }
    }
    
    // If configured binary path is provided, check it
    if (this.config.binaryPath) {
      try {
        await fs.access(this.config.binaryPath, fs.constants.X_OK);
        return this.config.binaryPath;
      } catch (error) {
        this.emit('log', { 
          level: 'warn', 
          message: `Configured binary path not accessible: ${this.config.binaryPath}` 
        });
      }
    }
    
    throw new Error('POA binary not found. Please install ProofOfAccess or specify the binary path.');
  }
  
  /**
   * Download POA binary from GitHub releases
   */
  async downloadBinary(targetPath) {
    const https = require('https');
    const platform = os.platform();
    const arch = os.arch();
    
    // Determine the correct binary name for the platform
    let assetName;
    if (platform === 'darwin' && arch === 'x64') {
      assetName = 'proofofaccess-darwin-amd64';
    } else if (platform === 'darwin' && arch === 'arm64') {
      assetName = 'proofofaccess-darwin-arm64';
    } else if (platform === 'linux' && arch === 'x64') {
      assetName = 'proofofaccess-linux-amd64';
    } else if (platform === 'linux' && arch === 'arm64') {
      assetName = 'proofofaccess-linux-arm64';
    } else if (platform === 'win32') {
      assetName = 'proofofaccess-windows-amd64.exe';
    } else {
      throw new Error(`Unsupported platform: ${platform} ${arch}`);
    }
    
    this.emit('log', { 
      level: 'info', 
      message: `Downloading POA binary for ${platform} ${arch}...` 
    });
    
    // Get latest release info
    const releaseInfo = await this.getLatestRelease();
    const asset = releaseInfo.assets.find(a => a.name === assetName);
    
    if (!asset) {
      throw new Error(`No binary found for ${platform} ${arch}`);
    }
    
    // Ensure target directory exists
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });
    
    // Download the binary
    return new Promise((resolve, reject) => {
      const file = require('fs').createWriteStream(targetPath);
      
      https.get(asset.browser_download_url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          https.get(response.headers.location, (redirectResponse) => {
            redirectResponse.pipe(file);
          });
        } else {
          response.pipe(file);
        }
        
        file.on('finish', async () => {
          file.close();
          // Make executable on Unix-like systems
          if (platform !== 'win32') {
            await fs.chmod(targetPath, 0o755);
          }
          this.emit('log', { 
            level: 'success', 
            message: `POA binary downloaded to ${targetPath}` 
          });
          resolve(targetPath);
        });
        
        file.on('error', (err) => {
          fs.unlink(targetPath, () => {}); // Delete incomplete file
          reject(err);
        });
      }).on('error', reject);
    });
  }
  
  /**
   * Get latest release info from GitHub
   */
  async getLatestRelease() {
    const https = require('https');
    const options = {
      hostname: 'api.github.com',
      path: '/repos/spknetwork/proofofaccess/releases/latest',
      headers: {
        'User-Agent': 'spk-desktop'
      }
    };
    
    return new Promise((resolve, reject) => {
      https.get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', reject);
    });
  }
  
  /**
   * Initialize and prepare the POA node
   */
  async initialize() {
    // Ensure data directory exists
    await fs.mkdir(this.config.dataPath, { recursive: true });
    
    // Try to locate the binary
    try {
      this.config.binaryPath = await this.locateBinary();
    } catch (error) {
      // Binary not found, try to download it
      this.emit('log', { 
        level: 'warn', 
        message: 'POA binary not found, attempting to download...' 
      });
      
      const targetPath = path.join(
        __dirname, '..', '..', '..', 'bin',
        `proofofaccess-${os.platform()}-${os.arch()}${os.platform() === 'win32' ? '.exe' : ''}`
      );
      
      try {
        this.config.binaryPath = await this.downloadBinary(targetPath);
      } catch (downloadError) {
        throw new Error(`Failed to download POA binary: ${downloadError.message}`);
      }
    }
    
    // Verify IPFS connectivity
    await this.verifyIPFS();
    
    return true;
  }
  
  /**
   * Verify IPFS is running and properly configured
   */
  async verifyIPFS() {
    try {
      const response = await fetch(
        `http://${this.config.ipfsHost}:${this.config.ipfsPort}/api/v0/config/show`,
        { method: 'POST' }
      );
      
      if (!response.ok) {
        throw new Error('IPFS node is not accessible');
      }
      
      const config = await response.json();
      
      // Check for required features
      if (!config.Pubsub?.Enabled) {
        throw new Error('IPFS PubSub is not enabled. Enable with: ipfs config --json Pubsub.Enabled true');
      }
      
      this.emit('log', { 
        level: 'info', 
        message: 'IPFS node verified and properly configured' 
      });
      
      return true;
    } catch (error) {
      throw new Error(`IPFS verification failed: ${error.message}`);
    }
  }
  
  /**
   * Start the POA node
   */
  async start() {
    if (this.running) {
      this.emit('log', { 
        level: 'warn', 
        message: 'POA node is already running' 
      });
      return;
    }
    
    if (!this.config.account) {
      throw new Error('No account configured for POA node');
    }
    
    // Initialize if not already done
    if (!this.config.binaryPath) {
      await this.initialize();
    }
    
    return new Promise((resolve, reject) => {
      // Build command arguments
      const args = [
        '-node', this.config.nodeType.toString(),
        '-username', this.config.account,
        '-IPFS_PORT=' + this.config.ipfsPort,
        '-url=' + this.config.spkApiUrl,
        '-useWS'
      ];
      
      // Add WebSocket port (required by POA binary)
      const wsPort = this.config.wsPort || (this.config.nodeType === 1 ? 8000 : 8001);
      args.push('-WS_PORT=' + wsPort);
      
      // Add validators URL if specified
      if (this.config.validatorsUrl) {
        args.push('-validators=' + this.config.validatorsUrl);
      }
      
      // Add storage limit for storage nodes
      if (this.config.nodeType === 2 && this.config.maxStorage) {
        const storageGB = Math.ceil(this.config.maxStorage / (1024 * 1024 * 1024));
        args.push('-storageLimit=' + storageGB);
      }
      
      this.emit('log', { 
        level: 'info', 
        message: `Starting POA node: ${this.config.binaryPath} ${args.join(' ')}` 
      });
      
      // Spawn the process
      this.process = spawn(this.config.binaryPath, args, {
        cwd: this.config.dataPath,
        env: {
          ...process.env,
          POA_DATA_PATH: this.config.dataPath
        }
      });
      
      // Set up event handlers
      this.process.stdout.on('data', (data) => {
        const output = data.toString();
        this.handleOutput(output);
        
        // Check for successful startup
        if (!this.running && (
          output.includes('Starting proofofaccess') ||
          output.includes('Connected to') ||
          output.includes('IPFS node ID:')
        )) {
          this.running = true;
          this.stats.startTime = Date.now();
          this.emit('started');
          resolve();
        }
      });
      
      this.process.stderr.on('data', (data) => {
        const error = data.toString();
        this.addLog('error', error);
        this.emit('log', { level: 'error', message: error });
      });
      
      this.process.on('error', (error) => {
        this.running = false;
        this.process = null;
        this.emit('error', error);
        reject(error);
      });
      
      this.process.on('exit', (code, signal) => {
        this.running = false;
        this.process = null;
        
        this.emit('log', { 
          level: 'info', 
          message: `POA process exited with code ${code} (signal: ${signal})` 
        });
        
        // Handle auto-restart
        if (this.config.autoRestart && code !== 0 && this.restartCount < this.config.maxRestarts) {
          this.scheduleRestart();
        } else {
          this.emit('stopped', { code, signal });
        }
      });
      
      // Set timeout for startup
      setTimeout(() => {
        if (!this.running) {
          this.stop();
          reject(new Error('POA node failed to start within timeout'));
        }
      }, 30000); // 30 second timeout
    });
  }
  
  /**
   * Stop the POA node
   */
  async stop() {
    if (!this.process) {
      return;
    }
    
    // Cancel any pending restart
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    
    return new Promise((resolve) => {
      this.process.once('exit', () => {
        this.running = false;
        this.process = null;
        resolve();
      });
      
      // Try graceful shutdown first
      this.process.kill('SIGTERM');
      
      // Force kill after timeout
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    });
  }
  
  /**
   * Schedule automatic restart
   */
  scheduleRestart() {
    this.restartCount++;
    
    this.emit('log', { 
      level: 'warn', 
      message: `Scheduling restart ${this.restartCount}/${this.config.maxRestarts} in ${this.config.restartDelay}ms` 
    });
    
    this.restartTimer = setTimeout(() => {
      this.start().catch(error => {
        this.emit('error', error);
      });
    }, this.config.restartDelay);
  }
  
  /**
   * Handle process output
   */
  handleOutput(output) {
    // Add to log buffer
    this.addLog('info', output);
    
    // Emit log event
    this.emit('log', { level: 'info', message: output.trim() });
    
    // Parse for specific events
    this.parseOutput(output);
  }
  
  /**
   * Parse output for specific events and stats
   */
  parseOutput(output) {
    // Parse validation events
    if (output.includes('Validation') || output.includes('Proof generated')) {
      this.stats.validations++;
      this.stats.lastValidation = new Date();
      this.emit('validation', { 
        count: this.stats.validations,
        timestamp: this.stats.lastValidation 
      });
    }
    
    // Parse storage events
    if (output.includes('Contract stored') || output.includes('File pinned')) {
      this.stats.filesStored++;
      this.emit('file-stored', { 
        count: this.stats.filesStored 
      });
    }
    
    // Parse earnings
    const earningsMatch = output.match(/Earned:\s*([\d.]+)\s*(\w+)/);
    if (earningsMatch) {
      const amount = parseFloat(earningsMatch[1]);
      const token = earningsMatch[2];
      this.stats.earnings += amount;
      this.emit('earnings', { amount, token, total: this.stats.earnings });
    }
    
    // Parse errors
    if (output.includes('ERROR') || output.includes('Failed')) {
      this.emit('error', new Error(output));
    }
  }
  
  /**
   * Add log entry to buffer
   */
  addLog(level, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: message.trim()
    };
    
    this.logs.push(entry);
    
    // Maintain max log size
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }
  
  /**
   * Get recent logs
   */
  getRecentLogs(count = 100) {
    return this.logs.slice(-count);
  }
  
  /**
   * Get current status
   */
  getStatus() {
    const uptime = this.running && this.stats.startTime 
      ? Date.now() - this.stats.startTime 
      : 0;
    
    return {
      running: this.running,
      account: this.config.account,
      nodeType: this.config.nodeType === 1 ? 'Validator' : 'Storage',
      binaryPath: this.config.binaryPath,
      stats: {
        ...this.stats,
        uptime
      },
      restartCount: this.restartCount,
      logs: this.getRecentLogs(10)
    };
  }
  
  /**
   * Update configuration
   */
  async updateConfig(newConfig) {
    const wasRunning = this.running;
    
    if (wasRunning) {
      await this.stop();
    }
    
    Object.assign(this.config, newConfig);
    
    if (wasRunning) {
      await this.start();
    }
  }
}

module.exports = POANodeManager;