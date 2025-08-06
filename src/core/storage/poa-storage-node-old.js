const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

/**
 * POA (Proof of Access) Storage Node
 * Manages the Proof of Access node for SPK Network storage
 */
class POAStorageNode extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      dataPath: config.dataPath || path.join(os.homedir(), '.oratr', 'poa'),
      binaryPath: config.binaryPath || path.join(os.homedir(), 'proofofaccess', 'main'),
      wsPort: config.wsPort || 8000,
      ipfsPort: config.ipfsPort || 5001,
      ipfsHost: config.ipfsHost || '127.0.0.1',
      account: config.account || null,
      nodeType: config.nodeType || 2, // 1 = validator, 2 = storage
      honeycomb: config.honeycomb !== false,
      maxStorage: config.maxStorage || 100 * 1024 * 1024 * 1024, // 100GB default
      ...config
    };
    
    this.process = null;
    this.running = false;
    this.wsClient = null;
    this.stats = {
      filesStored: 0,
      spaceUsed: 0,
      spaceAvailable: this.config.maxStorage,
      validations: 0,
      earnings: 0
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

  /**
   * Download and build POA from source
   */
  async installPOA() {
    const poaDir = path.dirname(this.config.binaryPath);
    
    // Check if directory exists
    try {
      await fs.access(poaDir);
    } catch {
      // Clone repository
      await this.cloneRepository(poaDir);
    }
    
    // Build the binary
    await this.buildBinary(poaDir);
  }

  /**
   * Clone POA repository
   */
  async cloneRepository(targetDir) {
    return new Promise((resolve, reject) => {
      const clone = spawn('git', [
        'clone',
        'https://github.com/spknetwork/proofofaccess.git',
        targetDir
      ]);

      clone.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Git clone failed with code ${code}`));
        }
      });

      clone.on('error', reject);
    });
  }

  /**
   * Build POA binary
   */
  async buildBinary(poaDir) {
    // Create data directory
    const dataDir = path.join(poaDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });

    return new Promise((resolve, reject) => {
      const build = spawn('go', ['build', '-o', 'main', 'main.go'], {
        cwd: poaDir
      });

      build.stdout.on('data', (data) => {
        console.log('POA Build:', data.toString());
      });

      build.stderr.on('data', (data) => {
        console.error('POA Build Error:', data.toString());
      });

      build.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Go build failed with code ${code}`));
        }
      });

      build.on('error', reject);
    });
  }

  /**
   * Start POA node
   */
  async start() {
    if (this.running) {
      throw new Error('POA node already running');
    }

    // Check if binary exists
    const binaryExists = await this.checkBinary();
    if (!binaryExists) {
      throw new Error('POA binary not found. Please install POA first.');
    }

    // Ensure data directory exists
    await fs.mkdir(this.config.dataPath, { recursive: true });

    return new Promise((resolve, reject) => {
      const args = [
        '-node', this.config.nodeType.toString(),
        '-username', this.config.account,
        '-WS_PORT=' + this.config.wsPort,
        '-useWS=true',
        '-honeycomb=' + this.config.honeycomb,
        '-IPFS_PORT=' + this.config.ipfsPort,
        '-IPFS_HOST=' + this.config.ipfsHost
      ];

      this.process = spawn(this.config.binaryPath, args, {
        cwd: path.dirname(this.config.binaryPath),
        env: {
          ...process.env,
          POA_DATA_PATH: this.config.dataPath
        }
      });

      this.process.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('POA:', output);
        this.parseOutput(output);
      });

      this.process.stderr.on('data', (data) => {
        console.error('POA Error:', data.toString());
      });

      this.process.on('error', (error) => {
        this.process = null;
        this.running = false;
        reject(error);
      });

      this.process.on('exit', (code) => {
        this.process = null;
        this.running = false;
        this.emit('stopped', code);
      });

      // Give process time to start
      setTimeout(() => {
        if (this.process) {
          this.running = true;
          this.connectWebSocket();
          resolve();
        }
      }, 3000);
    });
  }

  /**
   * Stop POA node
   */
  async stop() {
    if (!this.process) {
      return;
    }

    this.disconnectWebSocket();

    return new Promise((resolve) => {
      this.process.once('exit', () => {
        this.process = null;
        this.running = false;
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

  /**
   * Connect to POA WebSocket
   */
  connectWebSocket() {
    if (this.wsClient) {
      return;
    }

    const wsUrl = `ws://localhost:${this.config.wsPort}`;
    this.wsClient = new WebSocket(wsUrl);

    this.wsClient.on('open', () => {
      this.emit('connected');
      console.log('Connected to POA WebSocket');
    });

    this.wsClient.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse POA message:', error);
      }
    });

    this.wsClient.on('error', (error) => {
      console.error('POA WebSocket error:', error);
      this.emit('error', error);
    });

    this.wsClient.on('close', () => {
      this.wsClient = null;
      this.emit('disconnected');
    });
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket() {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
  }

  /**
   * Handle WebSocket messages
   */
  handleMessage(message) {
    switch (message.type) {
      case 'validation':
        this.stats.validations++;
        this.emit('validation', message);
        break;
        
      case 'storage-update':
        this.stats.filesStored = message.files || this.stats.filesStored;
        this.stats.spaceUsed = message.used || this.stats.spaceUsed;
        this.emit('storage-update', message);
        break;
        
      case 'earnings':
        this.stats.earnings = message.amount || this.stats.earnings;
        this.emit('earnings-update', message);
        break;
        
      case 'contract':
        this.emit('contract-registered', message);
        break;
        
      default:
        this.emit('message', message);
    }
  }

  /**
   * Parse console output
   */
  parseOutput(output) {
    // Parse validation messages
    if (output.includes('Validation')) {
      this.stats.validations++;
      this.emit('validation', { output });
    }
    
    // Parse storage updates
    if (output.includes('Storage')) {
      // Extract storage info if available
      const match = output.match(/Files: (\d+), Used: (\d+)/);
      if (match) {
        this.stats.filesStored = parseInt(match[1]);
        this.stats.spaceUsed = parseInt(match[2]);
      }
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats() {
    // In a real implementation, this would query the POA node
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
    // In a real implementation, this would query the POA node
    return {
      totalEarned: this.stats.earnings,
      validations: this.stats.validations,
      lastValidation: new Date()
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
   */
  async registerContract(contractData) {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to POA node');
    }

    return new Promise((resolve, reject) => {
      const message = {
        type: 'register-contract',
        data: contractData
      };

      this.wsClient.send(JSON.stringify(message), (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get active contracts
   */
  async getContracts() {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to POA node');
    }

    return new Promise((resolve, reject) => {
      const requestId = Date.now().toString();
      
      const handler = (data) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'contracts' && message.requestId === requestId) {
            this.wsClient.removeListener('message', handler);
            resolve(message.contracts || []);
          }
        } catch (error) {
          // Ignore parse errors
        }
      };

      this.wsClient.on('message', handler);

      const message = {
        type: 'get-contracts',
        requestId
      };

      this.wsClient.send(JSON.stringify(message), (error) => {
        if (error) {
          this.wsClient.removeListener('message', handler);
          reject(error);
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        this.wsClient.removeListener('message', handler);
        reject(new Error('Request timeout'));
      }, 10000);
    });
  }

  /**
   * Check if ready to serve files
   */
  isReady() {
    return this.running && this.wsClient && this.wsClient.readyState === WebSocket.OPEN;
  }

  /**
   * Get node status
   */
  getStatus() {
    return {
      running: this.running,
      connected: this.wsClient && this.wsClient.readyState === WebSocket.OPEN,
      nodeType: this.config.nodeType === 1 ? 'validator' : 'storage',
      account: this.config.account,
      wsPort: this.config.wsPort,
      stats: this.stats
    };
  }
}

module.exports = POAStorageNode;