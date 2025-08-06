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
      dataPath: config.dataPath || path.join(os.homedir(), '.oratr', 'poa'),
      binaryPath: config.binaryPath || null, // Will be resolved from NPM package
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
      // Log rotation settings
      maxLogSize: config.maxLogSize || 50 * 1024 * 1024, // 50MB per log file
      maxLogFiles: config.maxLogFiles || 10, // Keep 10 log files max
      logRotationInterval: config.logRotationInterval || 24 * 60 * 60 * 1000, // Rotate daily
      ...config
    };
    
    this.process = null;
    this.running = false;
    // Storage nodes don't have WebSocket servers
    this.logStream = null;
    this.logs = [];
    this.currentLogFile = null;
    this.logRotationTimer = null;
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
   * Get POA binary path from NPM package
   */
  getBinaryPath() {
    if (this.config.binaryPath) {
      return this.config.binaryPath;
    }
    
    try {
      // Use the NPM package binary
      const poa = require('@disregardfiat/proofofaccess');
      this.config.binaryPath = poa.path;
      return poa.path;
    } catch (error) {
      throw new Error('ProofOfAccess package not installed. Run: npm install @disregardfiat/proofofaccess');
    }
  }
  
  /**
   * Check if POA binary exists
   */
  async checkBinary() {
    try {
      const binaryPath = this.getBinaryPath();
      await fs.access(binaryPath, fs.constants.X_OK);
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Ensure POA binary is available from NPM package
   */
  async ensureBinary() {
    const binaryPath = this.getBinaryPath();
    const exists = await this.checkBinary();
    if (!exists) {
      throw new Error(`ProofOfAccess binary not found at ${binaryPath}. Please reinstall the package.`);
    }
    return true;
  }

  /**
   * Find an available port starting from the given port number
   */
  async findAvailablePort(startPort = 8000) {
    const net = require('net');
    
    for (let port = startPort; port < startPort + 100; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    
    // If no port found in range, use a random high port
    return Math.floor(Math.random() * (65535 - 49152) + 49152);
  }
  
  /**
   * Check if a port is available
   */
  async isPortAvailable(port) {
    const net = require('net');
    
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.close(() => {
          resolve(true);
        });
      });
      
      server.on('error', () => {
        resolve(false);
      });
    });
  }

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
      
      const binaryPath = this.getBinaryPath();
      return new Promise((resolve, reject) => {
        const proc = spawn(binaryPath, ['-version'], {
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
   * Install POA (deprecated - now using NPM package)
   */
  async installPOA() {
    // This method is no longer needed as POA is installed via NPM
    this.emit('log', { 
      level: 'info', 
      message: 'ProofOfAccess is now installed via NPM package @disregardfiat/proofofaccess' 
    });
    return true;
  }
  
  /**
   * Install POA from GitHub releases (deprecated)
   */
  async installPOALegacy() {
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
        level: 'error', 
        message: `Failed to download binary: ${error.message}. Please install via NPM: npm install @disregardfiat/proofofaccess` 
      });
      
      throw error;
    }
  }

  /**
   * Build POA from source (deprecated)
   */
  async buildFromSource() {
    // This method is no longer needed as POA is installed via NPM
    throw new Error('Building from source is deprecated. Please install via NPM: npm install @disregardfiat/proofofaccess');
  }
  
  /**
   * Build POA from source (legacy)
   */
  async buildFromSourceLegacy() {
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
        level: 'info', 
        message: 'POA node already running' 
      });
      return { success: true, alreadyRunning: true };
    }

    if (!this.config.account) {
      throw new Error('No account configured');
    }

    // Ensure binary is available, downloading if necessary
    const binaryAvailable = await this.ensureBinary();
    if (!binaryAvailable) {
      throw new Error('POA binary not available and could not be downloaded');
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

    // Ensure data directory exists for logs
    await fs.mkdir(this.config.dataPath, { recursive: true });
    
    // Clean up old logs on startup
    await this.pruneOldLogs();
    
    // Create new log file with rotation system
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentLogFile = path.join(this.config.dataPath, `poa-${timestamp}.log`);
    this.logStream = await fs.open(this.currentLogFile, 'a');
    
    // Start log rotation timer
    this.startLogRotationTimer();

    // First check IPFS configuration
    const ipfsCheck = await this.checkIPFSRequirements();
    if (!ipfsCheck.success) {
      throw new Error(ipfsCheck.error);
    }

    // Storage nodes don't need a WebSocket port - they connect to validators

    const startPromise = new Promise(async (resolve, reject) => {
      const args = [
        '-node', this.config.nodeType.toString(),
        '-username', this.config.account,
        '-IPFS_PORT=' + this.config.ipfsPort,
        '-useWS',  // Use WebSocket to connect to validators
        '-url=' + this.config.spkApiUrl  // Honeycomb API URL (required)
      ];
      
      // Storage nodes shouldn't listen on ports, but POA requires WS_PORT parameter
      if (this.config.nodeType === 2) {
        try {
          const availablePort = await this.findAvailablePort(8000);
          args.push('-WS_PORT=' + availablePort);
          this.emit('log', { 
            level: 'info', 
            message: `Storage node will use WebSocket port ${availablePort} (for POA binary requirement)`
          });
        } catch (error) {
          this.emit('log', { 
            level: 'warn', 
            message: `Could not find available port, using default: ${error.message}`
          });
          args.push('-WS_PORT=8001'); // Use a different default to avoid conflicts
        }
      }
      
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
      console.log('POA account configured:', this.config.account);
      this.emit('log', { 
        level: 'info', 
        message: `Starting POA storage node for account: ${this.config.account}`
      });
      this.emit('log', { 
        level: 'info', 
        message: `Starting POA with command: ${this.config.binaryPath} ${args.join(' ')}`
      });

      // Ensure POA data directory and subdirectories exist
      await fs.mkdir(this.config.dataPath, { recursive: true });
      await fs.mkdir(path.join(this.config.dataPath, 'data'), { recursive: true });
      
      // Set working directory to POA data path so POA creates its data files there
      const spawnOptions = {
        cwd: this.config.dataPath, // POA will create ./data relative to this
        env: {
          ...process.env,
          POA_DATA_PATH: this.config.dataPath
        }
      };
      
      // Always keep stdio attached for real-time logging and status updates
      spawnOptions.stdio = ['ignore', 'pipe', 'pipe'];

      const binaryPath = this.getBinaryPath();
      this.process = spawn(binaryPath, args, spawnOptions);
      
      // Store the PID for monitoring
      this.pid = this.process.pid;
      this.savePidFile().catch(err => {
        console.error('Failed to save PID file:', err);
      });
      
      // Don't unref() - keep the parent connected for real-time communication

      let startupTimeout = setTimeout(() => {
        // Don't reject if the process is still running - POA might just be slow to output
        if (!this.running && (!this.process || this.process.exitCode !== null)) {
          this.emit('log', { 
            level: 'error', 
            message: 'POA failed to start within 10 seconds' 
          });
          if (this.process) {
            this.process.kill();
          }
          reject(new Error('POA startup timeout'));
        } else if (!this.running && this.process) {
          // Process is still running, just hasn't output expected messages yet
          // This is actually normal for PoA - it starts connecting to peers immediately
          this.emit('log', { 
            level: 'info', 
            message: 'POA storage node started (process running, connecting to peers)' 
          });
          // Consider it started anyway - the process is running
          clearTimeout(startupTimeout);
          this.running = true;
          resolve({ success: true });
        }
      }, 10000);  // 10 seconds should be enough to know if process started

      this.process.stdout.on('data', async (data) => {
        const output = data.toString();
        console.log('POA:', output);
        
        // Store in memory log buffer
        const logEntry = `[${new Date().toISOString()}] ${output.trim()}`;
        this.logs.push(logEntry);
        if (this.logs.length > 1000) this.logs.shift(); // Keep last 1000 lines
        
        this.emit('log', { level: 'info', message: output.trim() });
        
        // Check for log rotation before writing
        await this.rotateLogIfNeeded();
        
        if (this.logStream) {
          await this.logStream.write(logEntry + '\n');
        }
        
        this.parseOutput(output);
        
        // Check for startup success - based on actual POA logs
        // Be more lenient - any of these indicates the node is running
        if (!this.running && (
            output.includes('Starting proofofaccess node') ||
            output.includes('Node type: 2') || 
            output.includes('Node type: Storage') ||
            output.includes('Connected to websocket') ||  // Storage nodes connect TO validators
            output.includes('IPFS node ID:') ||
            output.includes('Connected to IPFS') ||
            output.includes('bind: address already in use') ||  // This error doesn't stop POA
            output.includes('Connecting to') ||  // Node is attempting connections
            output.includes('WebSocket') ||  // Any WebSocket activity means it's running
            output.includes('Starting') ||
            output.includes('Initialized'))) {
          clearTimeout(startupTimeout);
          this.running = true;
          this.emit('log', { 
            level: 'success', 
            message: 'POA storage node started successfully' 
          });
          // Storage nodes don't need to connect to their own WebSocket
          resolve({ success: true });
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
        
        // Parse the error to determine if it's actually fatal or just P2P connection noise
        const errorLower = error.toLowerCase();
        const isFatalError = 
          errorLower.includes('panic:') ||
          errorLower.includes('fatal:') ||
          errorLower.includes('failed to connect to ipfs') ||
          errorLower.includes('cannot start') ||
          errorLower.includes('permission denied') ||
          errorLower.includes('out of memory');
        
        // WebSocket errors to specific peers are normal in P2P - not fatal
        const isP2PConnectionError = 
          errorLower.includes('websocket error:') ||
          errorLower.includes('dial:') ||
          errorLower.includes('tls:') ||
          errorLower.includes('certificate') ||
          errorLower.includes('no such host') ||
          errorLower.includes('connection refused') ||
          errorLower.includes('server misbehaving') ||
          errorLower.includes('connecting to wss://');
        
        // Determine log level based on error type
        let logLevel = 'error';
        if (isP2PConnectionError && !isFatalError) {
          logLevel = 'info'; // P2P connection attempts are just info
          // Also, for the startup check, these are not failures
          if (!this.running && errorLower.includes('connecting to wss://')) {
            // If we see connection attempts, the node IS running
            clearTimeout(startupTimeout);
            this.running = true;
            this.emit('log', { 
              level: 'success', 
              message: 'POA storage node started (attempting peer connections)' 
            });
            resolve({ success: true });
          }
        }
        
        const logEntry = `[${new Date().toISOString()}] ${logLevel === 'error' ? 'ERROR' : 'INFO'}: ${error.trim()}`;
        this.logs.push(logEntry);
        
        this.emit('log', { level: logLevel, message: error.trim() });
        
        // Check for log rotation before writing
        await this.rotateLogIfNeeded();
        
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
        this.stopLogRotationTimer();
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
    
    return startPromise;
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
    // Stop log rotation timer
    this.stopLogRotationTimer();

    // If we have a running process handle
    if (this.process) {
      return new Promise((resolve) => {
        this.process.once('exit', () => {
          this.process = null;
          this.running = false;
          this.removePidFile();
          if (this.logStream) {
            this.logStream.close();
            this.logStream = null;
          }
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
    
    // Close log stream
    if (this.logStream) {
      this.logStream.close();
      this.logStream = null;
    }
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
   * Rotate current log file if it's too large
   */
  async rotateLogIfNeeded() {
    if (!this.currentLogFile) return;

    try {
      const stats = await fs.stat(this.currentLogFile);
      if (stats.size >= this.config.maxLogSize) {
        await this.rotateCurrentLog();
      }
    } catch (error) {
      // Log file doesn't exist or other error, ignore
    }
  }

  /**
   * Force rotate the current log file
   */
  async rotateCurrentLog() {
    if (this.logStream) {
      await this.logStream.close();
      this.logStream = null;
    }

    // Create new log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentLogFile = path.join(this.config.dataPath, `poa-${timestamp}.log`);
    this.logStream = await fs.open(this.currentLogFile, 'a');

    this.emit('log', {
      level: 'info',
      message: `Log rotated to: ${path.basename(this.currentLogFile)}`
    });

    // Clean up old log files
    await this.pruneOldLogs();
  }

  /**
   * Remove old log files keeping only the most recent ones
   */
  async pruneOldLogs() {
    try {
      const logFiles = await this.getLogFiles();
      const filesToDelete = logFiles.slice(0, -this.config.maxLogFiles);

      for (const file of filesToDelete) {
        try {
          await fs.unlink(file);
          this.emit('log', {
            level: 'info',
            message: `Deleted old log file: ${path.basename(file)}`
          });
        } catch (error) {
          console.error(`Failed to delete log file ${file}:`, error);
        }
      }

      // Also check for oversized log files and compress/delete them
      await this.handleOversizedLogs();
    } catch (error) {
      console.error('Failed to prune old logs:', error);
    }
  }

  /**
   * Handle oversized log files during network stress
   */
  async handleOversizedLogs() {
    try {
      const logFiles = await this.getLogFiles();
      
      for (const file of logFiles) {
        if (file === this.currentLogFile) continue; // Don't touch current log
        
        try {
          const stats = await fs.stat(file);
          
          // If file is very large (> 100MB), compress or delete it
          if (stats.size > 100 * 1024 * 1024) {
            // Try to compress first, then delete if compression fails
            const compressed = await this.compressLogFile(file);
            if (!compressed) {
              await fs.unlink(file);
              this.emit('log', {
                level: 'warn',
                message: `Deleted oversized log file: ${path.basename(file)} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`
              });
            }
          }
        } catch (error) {
          // File might be deleted already, ignore
        }
      }
    } catch (error) {
      console.error('Failed to handle oversized logs:', error);
    }
  }

  /**
   * Compress a log file using gzip
   */
  async compressLogFile(filePath) {
    try {
      const zlib = require('zlib');
      const pipeline = require('util').promisify(require('stream').pipeline);
      
      const gzipPath = filePath + '.gz';
      const readStream = require('fs').createReadStream(filePath);
      const writeStream = require('fs').createWriteStream(gzipPath);
      const gzip = zlib.createGzip();

      await pipeline(readStream, gzip, writeStream);
      
      // Delete original file after successful compression
      await fs.unlink(filePath);
      
      this.emit('log', {
        level: 'info',
        message: `Compressed log file: ${path.basename(filePath)} -> ${path.basename(gzipPath)}`
      });
      
      return true;
    } catch (error) {
      console.error(`Failed to compress log file ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Start automatic log rotation timer
   */
  startLogRotationTimer() {
    if (this.logRotationTimer) {
      clearInterval(this.logRotationTimer);
    }

    // Rotate logs at configured interval (default: daily)
    this.logRotationTimer = setInterval(async () => {
      try {
        await this.rotateCurrentLog();
      } catch (error) {
        console.error('Failed to rotate logs:', error);
      }
    }, this.config.logRotationInterval);
  }

  /**
   * Stop automatic log rotation timer
   */
  stopLogRotationTimer() {
    if (this.logRotationTimer) {
      clearInterval(this.logRotationTimer);
      this.logRotationTimer = null;
    }
  }

  /**
   * Emergency log cleanup during network stress
   */
  async emergencyLogCleanup() {
    this.emit('log', {
      level: 'warn',
      message: 'Performing emergency log cleanup due to disk space or network stress'
    });

    try {
      // Reduce memory log buffer significantly during stress
      if (this.logs.length > 100) {
        this.logs = this.logs.slice(-100);
      }

      // Force rotate current log if it's large
      if (this.currentLogFile) {
        try {
          const stats = await fs.stat(this.currentLogFile);
          if (stats.size > 10 * 1024 * 1024) { // If > 10MB, rotate immediately
            await this.rotateCurrentLog();
          }
        } catch (error) {
          // Ignore stat errors
        }
      }

      // Aggressively prune logs, keeping only the most recent 3
      const logFiles = await this.getLogFiles();
      const filesToDelete = logFiles.slice(0, -3);

      for (const file of filesToDelete) {
        try {
          await fs.unlink(file);
        } catch (error) {
          // Ignore delete errors
        }
      }

      this.emit('log', {
        level: 'info',
        message: `Emergency cleanup completed. Removed ${filesToDelete.length} log files.`
      });
    } catch (error) {
      console.error('Emergency log cleanup failed:', error);
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
    
    // Check if process is actually running
    const actuallyRunning = await this.checkRunning();
    
    console.log('[DEBUG POA] getStatus - actuallyRunning:', actuallyRunning, 'this.running:', this.running, 'PID:', this.pid);
    
    // If we have a this.running flag set, trust it over checkRunning
    // (checkRunning only checks PID file, but this.running is set when we start the process)
    const isRunning = this.running || actuallyRunning;
    
    return {
      running: isRunning,
      connected: isRunning,  // Storage nodes are connected if they're running
      version,
      updateAvailable: updateInfo?.updateAvailable || false,
      account: this.config.account,
      nodeType: this.config.nodeType === 1 ? 'Validator' : 'Storage',
      stats: this.stats,
      logs: this.getRecentLogs(10),
      processInfo: {
        pid: this.pid,
        internalRunning: this.running,
        actuallyRunning: actuallyRunning
      }
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