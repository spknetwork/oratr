const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

/**
 * Enhanced POA (Proof of Access) Storage Node with logging and validation
 */
class POAStorageNode extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      dataPath: config.dataPath || path.join(os.homedir(), '.spk-desktop', 'poa'),
      binaryPath: config.binaryPath || path.join(os.homedir(), '.spk-desktop', 'poa', 'proofofaccess'),
      // Storage nodes don't need a WebSocket listening port - they only connect to validators
      ipfsPort: config.ipfsPort || 5001,
      ipfsHost: config.ipfsHost || '127.0.0.1',
      account: config.account || null,
      nodeType: config.nodeType || 2, // 1 = validator, 2 = storage
      validatorsUrl: config.validatorsUrl || (config.spkApiUrl || 'https://spktest.dlux.io') + '/services/VAL',
      honeycomb: config.honeycomb !== false,
      maxStorage: config.maxStorage || 100 * 1024 * 1024 * 1024, // 100GB default
      spkApiUrl: config.spkApiUrl || 'https://spktest.dlux.io', // SPK API endpoint
      daemon: config.daemon !== false, // Run as daemon by default
      ...config
    };
    
    this.process = null;
    this.running = false;
    // Storage nodes don't have WebSocket servers
    this.logStream = null;
    this.logs = [];
    this.stats = {
      filesStored: 0,
      spaceUsed: 0,
      spaceAvailable: this.config.maxStorage,
      validations: 0,
      earnings: 0,
      lastValidation: null
    };
  }

  /**
   * Check if POA binary exists
   */
  async checkBinary() {
    try {
      await fs.access(this.config.binaryPath, fs.constants.X_OK);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Removed findAvailablePort - storage nodes don't listen on WebSocket ports

  /**
   * Check IPFS requirements for POA
   */
  async checkIPFSRequirements() {
    try {
      // Check if IPFS is accessible
      const response = await fetch(`http://${this.config.ipfsHost}:${this.config.ipfsPort}/api/v0/config/show`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        return { 
          success: false, 
          error: 'IPFS node is not accessible. Make sure IPFS is running.' 
        };
      }
      
      const config = await response.json();
      
      // Check for required experimental features
      const pubsub = config.Pubsub?.Enabled;
      const experimentalFeatures = config.Experimental || {};
      
      if (!pubsub) {
        return {
          success: false,
          error: 'IPFS PubSub is not enabled. Please enable it with: ipfs config --json Pubsub.Enabled true'
        };
      }
      
      // Log current IPFS configuration
      this.emit('log', {
        level: 'info',
        message: `IPFS Config - PubSub: ${pubsub}, Experimental features: ${JSON.stringify(experimentalFeatures)}`
      });
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to check IPFS configuration: ${error.message}`
      };
    }
  }

  /**
   * Get POA version
   */
  async getVersion() {
    try {
      const hasBinary = await this.checkBinary();
      if (!hasBinary) return null;
      
      return new Promise((resolve, reject) => {
        const proc = spawn(this.config.binaryPath, ['-version'], {
          timeout: 5000
        });
        
        let version = '';
        proc.stdout.on('data', (data) => {
          version += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
          // Some apps output version to stderr
          version += data.toString();
        });
        
        proc.on('close', (code) => {
          const versionMatch = version.match(/v?(\d+\.\d+\.\d+)/);
          if (versionMatch) {
            resolve(versionMatch[0]);
          } else {
            resolve(version.trim() || 'Unknown');
          }
        });
        
        proc.on('error', () => {
          resolve('Unknown');
        });
      });
    } catch (error) {
      return 'Unknown';
    }
  }

  /**
   * Compare version strings
   */
  compareVersions(v1, v2) {
    // Remove 'v' prefix if present
    const clean1 = v1.replace(/^v/, '');
    const clean2 = v2.replace(/^v/, '');
    
    const parts1 = clean1.split('.').map(n => parseInt(n, 10));
    const parts2 = clean2.split('.').map(n => parseInt(n, 10));
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  /**
   * Check for updates
   */
  async checkForUpdates() {
    try {
      const currentVersion = await this.getVersion();
      if (!currentVersion || currentVersion === 'Unknown') return null;
      
      const release = await this.getLatestRelease();
      if (!release) return null;
      
      const latestVersion = release.tag_name || release.name || '';
      const updateAvailable = this.compareVersions(latestVersion, currentVersion) > 0;
      
      return {
        current: currentVersion,
        latest: latestVersion,
        updateAvailable,
        downloadUrl: release.html_url,
        assets: release.assets
      };
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return null;
    }
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
            const release = JSON.parse(data);
            resolve(release);
          } catch (error) {
            reject(new Error('Failed to parse release data'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Download POA binary from GitHub releases
   */
  async downloadBinary(downloadUrl, targetPath) {
    const https = require('https');
    const fs = require('fs');
    const path = require('path');
    
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(targetPath);
      
      https.get(downloadUrl, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          file.close();
          fs.unlinkSync(targetPath);
          return this.downloadBinary(response.headers.location, targetPath)
            .then(resolve)
            .catch(reject);
        }
        
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(targetPath);
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          // Make executable
          fs.chmodSync(targetPath, '755');
          resolve();
        });
        
        file.on('error', (err) => {
          fs.unlinkSync(targetPath);
          reject(err);
        });
      }).on('error', reject);
    });
  }

  /**
   * Install POA from GitHub releases
   */
  async installPOA() {
    this.emit('log', { level: 'info', message: 'Checking for latest POA release...' });
    
    try {
      const release = await this.getLatestRelease();
      
      // Determine platform
      const platform = process.platform;
      const arch = process.arch;
      let assetName;
      
      // Map platform/arch to asset name
      if (platform === 'linux' && arch === 'x64') {
        assetName = 'proofofaccess-linux-amd64';
      } else if (platform === 'darwin' && arch === 'x64') {
        assetName = 'proofofaccess-darwin-amd64';
      } else if (platform === 'darwin' && arch === 'arm64') {
        assetName = 'proofofaccess-darwin-arm64';
      } else if (platform === 'win32' && arch === 'x64') {
        assetName = 'proofofaccess-windows-amd64.exe';
      } else {
        throw new Error(`Unsupported platform: ${platform} ${arch}`);
      }
      
      // Find the asset
      const asset = release.assets.find(a => a.name === assetName);
      if (!asset) {
        throw new Error(`No binary found for ${platform} ${arch}. You may need to build from source.`);
      }
      
      this.emit('log', { 
        level: 'info', 
        message: `Downloading POA ${release.tag_name} for ${platform} ${arch}...` 
      });
      
      // Download the binary
      await this.downloadBinary(asset.browser_download_url, this.config.binaryPath);
      
      this.emit('log', { 
        level: 'success', 
        message: `POA ${release.tag_name} installed successfully!` 
      });
      
      return true;
    } catch (error) {
      // Fallback to building from source
      this.emit('log', { 
        level: 'warn', 
        message: `Failed to download binary: ${error.message}. Attempting to build from source...` 
      });
      
      return await this.buildFromSource();
    }
  }

  /**
   * Build POA from source (fallback)
   */
  async buildFromSource() {
    const poaDir = path.dirname(this.config.binaryPath);
    
    // Check if Go is installed
    try {
      await new Promise((resolve, reject) => {
        const goCheck = spawn('go', ['version']);
        goCheck.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error('Go is not installed'));
        });
        goCheck.on('error', () => reject(new Error('Go is not installed')));
      });
    } catch (error) {
      throw new Error('Go is required to build POA from source. Please install Go from https://golang.org');
    }
    
    // Ensure parent directory exists
    const parentDir = path.dirname(poaDir);
    await fs.mkdir(parentDir, { recursive: true });
    
    // Clone repository
    try {
      await fs.access(poaDir);
      // Directory exists, pull latest
      this.emit('log', { level: 'info', message: 'Updating POA source code...' });
      await new Promise((resolve, reject) => {
        const pull = spawn('git', ['pull'], { cwd: poaDir });
        pull.stdout.on('data', (data) => {
          this.emit('log', { level: 'info', message: data.toString().trim() });
        });
        pull.stderr.on('data', (data) => {
          this.emit('log', { level: 'warn', message: data.toString().trim() });
        });
        pull.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error('Git pull failed'));
        });
        pull.on('error', err => reject(err));
      });
    } catch {
      // Clone repository
      this.emit('log', { level: 'info', message: 'Cloning POA repository...' });
      
      // If directory exists but is not a git repo, remove it
      try {
        await fs.access(poaDir);
        await fs.rmdir(poaDir, { recursive: true });
      } catch {
        // Directory doesn't exist, that's fine
      }
      
      await new Promise((resolve, reject) => {
        const clone = spawn('git', ['clone', 'https://github.com/spknetwork/proofofaccess.git', poaDir]);
        clone.stdout.on('data', (data) => {
          this.emit('log', { level: 'info', message: data.toString().trim() });
        });
        clone.stderr.on('data', (data) => {
          this.emit('log', { level: 'info', message: data.toString().trim() });
        });
        clone.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`Git clone failed with code ${code}`));
        });
        clone.on('error', err => reject(new Error(`Git clone error: ${err.message}`)));
      });
    }
    
    // Build binary
    this.emit('log', { level: 'info', message: 'Building POA binary...' });
    await new Promise((resolve, reject) => {
      const build = spawn('go', ['build', '-o', 'proofofaccess', '.'], { cwd: poaDir });
      build.stdout.on('data', (data) => {
        this.emit('log', { level: 'info', message: data.toString().trim() });
      });
      build.stderr.on('data', (data) => {
        this.emit('log', { level: 'warn', message: data.toString().trim() });
      });
      build.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Build failed with code ${code}`));
      });
      build.on('error', err => reject(new Error(`Build error: ${err.message}`)));
    });
    
    // Move binary to expected location
    const builtBinary = path.join(poaDir, 'proofofaccess');
    if (builtBinary !== this.config.binaryPath) {
      await fs.rename(builtBinary, this.config.binaryPath);
    }
    
    // Make executable
    await fs.chmod(this.config.binaryPath, '755');
    
    this.emit('log', { level: 'success', message: 'POA built from source successfully!' });
    return true;
  }

  /**
   * Check if POA is already running
   */
  async checkRunning() {
    // Check if we have a PID file
    const pid = await this.readPidFile();
    if (pid && this.isProcessRunning(pid)) {
      this.running = true;
      this.pid = pid;
      this.emit('log', { 
        level: 'info', 
        message: `POA already running with PID ${pid}` 
      });
      return true;
    }
    return false;
  }

  /**
   * Start POA node
   */
  async start() {
    // Check if already running
    if (await this.checkRunning()) {
      this.emit('log', { 
        level: 'warn', 
        message: 'POA node already running' 
      });
      return;
    }

    if (!this.config.account) {
      throw new Error('No account configured');
    }

    // Check if binary exists
    const binaryExists = await this.checkBinary();
    if (!binaryExists) {
      throw new Error('POA binary not found. Please install POA first.');
    }

    // Log version info
    const version = await this.getVersion();
    console.log('POA Version:', version);
    this.emit('log', { level: 'info', message: `POA Version: ${version}` });
    
    // Check for updates
    const updateInfo = await this.checkForUpdates();
    if (updateInfo && updateInfo.updateAvailable) {
      this.emit('update-available', updateInfo);
      this.emit('log', { 
        level: 'warn', 
        message: `Update available: ${updateInfo.latest} (current: ${updateInfo.current})`
      });
    }

    // Ensure data directory exists
    await fs.mkdir(this.config.dataPath, { recursive: true });
    
    // Create log file
    const logFile = path.join(this.config.dataPath, `poa-${Date.now()}.log`);
    this.logStream = await fs.open(logFile, 'a');

    // First check IPFS configuration
    const ipfsCheck = await this.checkIPFSRequirements();
    if (!ipfsCheck.success) {
      throw new Error(ipfsCheck.error);
    }

    // Storage nodes don't need a WebSocket port - they connect to validators

    return new Promise((resolve, reject) => {
      const args = [
        '-node', this.config.nodeType.toString(),
        '-username', this.config.account,
        '-IPFS_PORT=' + this.config.ipfsPort,
        '-useWS',  // Use WebSocket to connect to validators
        '-url=' + this.config.spkApiUrl  // Honeycomb API URL (required)
      ];
      
      // Add validators URL if different from default
      if (this.config.validatorsUrl) {
        args.push('-validators=' + this.config.validatorsUrl);
      }
      
      // Add storage limit for storage nodes
      if (this.config.nodeType === 2 && this.config.maxStorage) {
        // Convert bytes to GB
        const storageGB = Math.ceil(this.config.maxStorage / (1024 * 1024 * 1024));
        args.push('-storageLimit=' + storageGB);
      }
      
      console.log('Starting POA with args:', args);
      this.emit('log', { 
        level: 'info', 
        message: `Starting POA with command: ${this.config.binaryPath} ${args.join(' ')}`
      });

      // Determine if we should daemonize
      const spawnOptions = {
        cwd: path.dirname(this.config.binaryPath),
        env: {
          ...process.env,
          POA_DATA_PATH: this.config.dataPath
        }
      };
      
      if (this.config.daemon !== false) {
        // Spawn as detached process (daemon)
        spawnOptions.detached = true;
        spawnOptions.stdio = ['ignore', 'pipe', 'pipe']; // Keep stdout/stderr for logging
      }

      this.process = spawn(this.config.binaryPath, args, spawnOptions);
      
      // If running as daemon, store the PID
      if (this.config.daemon !== false) {
        this.pid = this.process.pid;
        this.savePidFile().catch(err => {
          console.error('Failed to save PID file:', err);
        });
        
        // Allow parent to exit
        this.process.unref();
      }

      let startupTimeout = setTimeout(() => {
        // Don't reject if the process is still running - POA might just be slow to output
        if (!this.running && (!this.process || this.process.exitCode !== null)) {
          this.emit('log', { 
            level: 'error', 
            message: 'POA failed to start within 15 seconds' 
          });
          if (this.process) {
            this.process.kill();
          }
          reject(new Error('POA startup timeout'));
        } else if (!this.running) {
          // Process is still running, just hasn't output expected messages yet
          this.emit('log', { 
            level: 'warn', 
            message: 'POA is taking longer than expected to start, but process is still running' 
          });
          // Consider it started anyway
          clearTimeout(startupTimeout);
          this.running = true;
          resolve();
        }
      }, 15000);  // Increased timeout to 15 seconds

      this.process.stdout.on('data', async (data) => {
        const output = data.toString();
        console.log('POA:', output);
        
        // Store in memory log buffer
        const logEntry = `[${new Date().toISOString()}] ${output.trim()}`;
        this.logs.push(logEntry);
        if (this.logs.length > 1000) this.logs.shift(); // Keep last 1000 lines
        
        this.emit('log', { level: 'info', message: output.trim() });
        
        if (this.logStream) {
          await this.logStream.write(logEntry + '\n');
        }
        
        this.parseOutput(output);
        
        // Check for startup success - based on actual POA logs
        if (!this.running && (
            output.includes('Starting proofofaccess node') ||
            output.includes('Node type: 2') || 
            output.includes('Connected to websocket') ||  // Storage nodes connect TO validators
            output.includes('IPFS node ID:') ||
            output.includes('Connected to IPFS') ||
            output.includes('bind: address already in use'))) {  // This error doesn't stop POA
          clearTimeout(startupTimeout);
          this.running = true;
          this.emit('log', { 
            level: 'info', 
            message: 'POA storage node started successfully' 
          });
          // Storage nodes don't need to connect to their own WebSocket
          resolve();
        }
        
        // Check for common startup errors
        if (output.includes('Failed to connect to IPFS') || 
            output.includes('error getting IPFS node ID')) {
          clearTimeout(startupTimeout);
          this.emit('log', { 
            level: 'error', 
            message: 'Failed to connect to IPFS. Check if IPFS is running and PubSub is enabled.' 
          });
          reject(new Error('IPFS connection failed'));
        }
      });

      this.process.stderr.on('data', async (data) => {
        const error = data.toString();
        console.error('POA Error:', error);
        
        const logEntry = `[${new Date().toISOString()}] ERROR: ${error.trim()}`;
        this.logs.push(logEntry);
        
        this.emit('log', { level: 'error', message: error.trim() });
        
        if (this.logStream) {
          await this.logStream.write(logEntry + '\n');
        }
      });

      this.process.on('error', (error) => {
        clearTimeout(startupTimeout);
        this.process = null;
        this.running = false;
        this.emit('log', { level: 'error', message: `Process error: ${error.message}` });
        if (this.logStream) {
          this.logStream.close();
          this.logStream = null;
        }
        reject(error);
      });

      this.process.on('exit', (code, signal) => {
        clearTimeout(startupTimeout);
        this.process = null;
        this.running = false;
        this.emit('stopped', code);
        this.emit('log', { 
          level: 'info', 
          message: `POA stopped with code ${code} (signal: ${signal})` 
        });
        if (this.logStream) {
          this.logStream.close();
          this.logStream = null;
        }
      });
    });
  }

  /**
   * Save PID file for daemon process
   */
  async savePidFile() {
    const pidFile = path.join(this.config.dataPath, 'poa.pid');
    await fs.writeFile(pidFile, this.pid.toString());
  }

  /**
   * Read PID from file
   */
  async readPidFile() {
    try {
      const pidFile = path.join(this.config.dataPath, 'poa.pid');
      const pid = await fs.readFile(pidFile, 'utf8');
      return parseInt(pid, 10);
    } catch (error) {
      return null;
    }
  }

  /**
   * Remove PID file
   */
  async removePidFile() {
    try {
      const pidFile = path.join(this.config.dataPath, 'poa.pid');
      await fs.unlink(pidFile);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Check if process is running
   */
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Stop POA node
   */
  async stop() {

    // If we have a running process handle
    if (this.process) {
      return new Promise((resolve) => {
        this.process.once('exit', () => {
          this.process = null;
          this.running = false;
          this.removePidFile();
          resolve();
        });

        this.process.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (this.process) {
            this.process.kill('SIGKILL');
          }
        }, 5000);
      });
    }
    
    // If running as daemon, try to stop via PID
    const pid = await this.readPidFile();
    if (pid && this.isProcessRunning(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
        
        // Wait for process to exit
        let attempts = 0;
        while (attempts < 50 && this.isProcessRunning(pid)) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
        
        // Force kill if still running
        if (this.isProcessRunning(pid)) {
          process.kill(pid, 'SIGKILL');
        }
      } catch (error) {
        console.error('Failed to stop POA process:', error);
      }
    }
    
    await this.removePidFile();
    this.running = false;
    this.process = null;
  }

  // Storage nodes don't host WebSocket servers - they connect to validators
  // Removed connectWebSocket method

  // Removed disconnectWebSocket - storage nodes are WebSocket clients, not servers

  // Removed handleMessage - storage nodes parse console output instead of WebSocket messages

  /**
   * Parse console output
   */
  parseOutput(output) {
    // Parse validation messages - based on actual POA logs
    if (output.includes('Handling validation request') || 
        output.includes('Proof generated') ||
        output.includes('ValidationResult')) {
      this.stats.validations++;
      this.stats.lastValidation = new Date();
      this.emit('validation', { output });
      
      // Extract CID if available
      const cidMatch = output.match(/CID[:\s]+([A-Za-z0-9]+)/);
      if (cidMatch) {
        this.emit('log', {
          level: 'success',
          message: `Validated CID: ${cidMatch[1]}`
        });
      }
    }
    
    // Parse IPFS connection info
    if (output.includes('IPFS node ID:')) {
      const idMatch = output.match(/IPFS node ID:\s*([A-Za-z0-9]+)/);
      if (idMatch) {
        this.ipfsNodeId = idMatch[1];
        this.emit('ipfs-connected', { nodeId: idMatch[1] });
      }
    }
    
    // Parse storage contract messages
    if (output.includes('Storage contract') || output.includes('Contract stored')) {
      const cidMatch = output.match(/CID[:\s]+([A-Za-z0-9]+)/);
      if (cidMatch) {
        this.stats.filesStored++;
        this.emit('contract-registered', { 
          cid: cidMatch[1],
          timestamp: new Date()
        });
      }
    }
    
    // Parse WebSocket connection status for storage nodes
    if (output.includes('Connected to websocket') || 
        output.includes('WebSocket connection established') ||
        output.includes('Connected to SPK network')) {
      this.emit('spk-connected');
    }
    
    // Parse error messages
    if (output.includes('ERROR') || output.includes('Error:')) {
      this.emit('log', {
        level: 'error',
        message: output.trim()
      });
    }
    
    // Parse earnings/rewards (if POA includes this)
    if (output.includes('Reward earned') || output.includes('Payment received')) {
      const match = output.match(/(\d+\.?\d*)\s*(BROCA|SPK|LARYNX)/i);
      if (match) {
        const amount = parseFloat(match[1]);
        this.stats.earnings += amount;
        this.emit('earnings-update', { amount, token: match[2] });
      }
    }
  }

  /**
   * Get recent logs from memory
   */
  getRecentLogs(lines = 100) {
    return this.logs.slice(-lines);
  }

  /**
   * Get log files
   */
  async getLogFiles() {
    try {
      const files = await fs.readdir(this.config.dataPath);
      const logFiles = files.filter(f => f.startsWith('poa-') && f.endsWith('.log'));
      return logFiles.map(f => path.join(this.config.dataPath, f)).sort();
    } catch (error) {
      return [];
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats() {
    return {
      spaceUsed: this.stats.spaceUsed,
      spaceAvailable: this.config.maxStorage - this.stats.spaceUsed,
      filesStored: this.stats.filesStored,
      maxStorage: this.config.maxStorage
    };
  }

  /**
   * Get earnings information
   */
  async getEarnings() {
    return {
      totalEarned: this.stats.earnings,
      validations: this.stats.validations,
      lastValidation: this.stats.lastValidation
    };
  }

  /**
   * Get current status
   */
  async getStatus() {
    const version = await this.getVersion();
    const updateInfo = await this.checkForUpdates();
    
    return {
      running: this.running,
      connected: this.running,  // Storage nodes are connected if they're running
      version,
      updateAvailable: updateInfo?.updateAvailable || false,
      account: this.config.account,
      nodeType: this.config.nodeType === 1 ? 'Validator' : 'Storage',
      stats: this.stats,
      logs: this.getRecentLogs(10)
    };
  }

  /**
   * Validate registration
   */
  async validateRegistration(ipfsId, registrationInfo) {
    if (!ipfsId || !registrationInfo) {
      return {
        valid: false,
        error: 'Missing information for validation'
      };
    }
    
    const registeredId = registrationInfo.ipfsId || registrationInfo.peerId;
    const match = ipfsId === registeredId;
    
    return {
      valid: match,
      ipfsId,
      registeredId,
      account: registrationInfo.account || this.config.account,
      domain: registrationInfo.domain,
      error: match ? null : 'IPFS ID does not match registered ID'
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

  /**
   * Register storage contract
   * Note: Storage nodes don't register contracts directly through WebSocket.
   * They receive contract information from the SPK network.
   */
  async registerContract(contractData) {
    // Storage nodes handle contracts through the SPK network API
    // This method is kept for API compatibility but doesn't apply to storage nodes
    this.emit('log', {
      level: 'info',
      message: 'Storage nodes receive contracts from the SPK network automatically'
    });
    return Promise.resolve();
  }
}

module.exports = POAStorageNode;