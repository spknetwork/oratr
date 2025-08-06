const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

/**
 * POA Process Manager
 * Manages the POA (Proof of Access) process as a spawned child process
 */
class POAProcessManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // POA binary location
      binaryPath: config.binaryPath || path.join(os.homedir(), '.oratr', 'poa', 'proofofaccess'),
      
      // POA configuration
      dataPath: config.dataPath || path.join(os.homedir(), '.oratr', 'poa-data'),
      configPath: config.configPath || path.join(os.homedir(), '.oratr', 'poa-config.json'),
      
      // Process options
      detached: config.detached !== false, // Spawn detached by default
      stdio: config.stdio || ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
      
      // Runtime configuration
      account: config.account || null,
      privateKey: config.privateKey || null,
      nodeType: config.nodeType || 2, // 1 = validator, 2 = storage
      ipfsHost: config.ipfsHost || '127.0.0.1',
      ipfsPort: config.ipfsPort || 5001,
      spkApiUrl: config.spkApiUrl || 'https://spktest.dlux.io',
      maxStorage: config.maxStorage || 100 * 1024 * 1024 * 1024, // 100GB default
      
      // Auto-restart on crash
      autoRestart: config.autoRestart !== false,
      maxRestarts: config.maxRestarts || 5,
      restartDelay: config.restartDelay || 5000, // 5 seconds
      
      ...config
    };
    
    this.process = null;
    this.running = false;
    this.restarting = false;
    this.restartCount = 0;
    this.logs = [];
    this.maxLogs = 1000;
  }
  
  /**
   * Initialize POA directories and configuration
   */
  async initialize() {
    try {
      // Create directories
      await fs.mkdir(this.config.dataPath, { recursive: true });
      await fs.mkdir(path.dirname(this.config.configPath), { recursive: true });
      await fs.mkdir(path.dirname(this.config.binaryPath), { recursive: true });
      
      // Check if binary exists
      const binaryExists = await this.checkBinary();
      if (!binaryExists) {
        throw new Error(`POA binary not found at ${this.config.binaryPath}. Please download or build the POA binary.`);
      }
      
      // Create/update configuration file
      await this.writeConfig();
      
      return true;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Check if POA binary exists and is executable
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
   * Write POA configuration file
   */
  async writeConfig() {
    const poaConfig = {
      account: this.config.account,
      privateKey: this.config.privateKey,
      nodeType: this.config.nodeType,
      ipfs: {
        host: this.config.ipfsHost,
        port: this.config.ipfsPort
      },
      spkApi: this.config.spkApiUrl,
      storage: {
        maxSize: this.config.maxStorage,
        dataPath: this.config.dataPath
      },
      network: {
        validatorsUrl: `${this.config.spkApiUrl}/services/VAL`
      }
    };
    
    await fs.writeFile(
      this.config.configPath,
      JSON.stringify(poaConfig, null, 2)
    );
  }
  
  /**
   * Start the POA process
   */
  async start() {
    if (this.running) {
      throw new Error('POA process is already running');
    }
    
    try {
      // Initialize before starting
      await this.initialize();
      
      // Prepare command arguments
      const args = [
        '--config', this.config.configPath,
        '--data', this.config.dataPath
      ];
      
      // Add optional arguments
      if (this.config.debug) {
        args.push('--debug');
      }
      
      // Spawn the process
      this.process = spawn(this.config.binaryPath, args, {
        detached: this.config.detached,
        stdio: this.config.stdio,
        env: {
          ...process.env,
          IPFS_PATH: process.env.IPFS_PATH || path.join(os.homedir(), '.ipfs')
        }
      });
      
      this.running = true;
      this.restartCount = 0;
      
      // Handle process events
      this.setupProcessHandlers();
      
      // If detached, unref to allow parent to exit
      if (this.config.detached) {
        this.process.unref();
      }
      
      this.emit('started', { pid: this.process.pid });
      this.log('info', `POA process started with PID ${this.process.pid}`);
      
      return this.process.pid;
    } catch (error) {
      this.running = false;
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Setup process event handlers
   */
  setupProcessHandlers() {
    if (!this.process) return;
    
    // Handle stdout
    if (this.process.stdout) {
      this.process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach(line => {
          this.log('info', line);
          this.parseLogLine(line);
        });
      });
    }
    
    // Handle stderr
    if (this.process.stderr) {
      this.process.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach(line => {
          this.log('error', line);
        });
      });
    }
    
    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.running = false;
      this.process = null;
      
      if (code === 0) {
        this.log('info', 'POA process exited cleanly');
        this.emit('stopped', { code, signal });
      } else {
        this.log('error', `POA process exited with code ${code}, signal ${signal}`);
        this.emit('crashed', { code, signal });
        
        // Auto-restart if enabled
        if (this.config.autoRestart && !this.restarting) {
          this.handleAutoRestart();
        }
      }
    });
    
    // Handle process errors
    this.process.on('error', (error) => {
      this.log('error', `Process error: ${error.message}`);
      this.emit('error', error);
    });
  }
  
  /**
   * Parse log lines for important events
   */
  parseLogLine(line) {
    // Parse JSON logs if POA outputs structured logs
    try {
      const data = JSON.parse(line);
      if (data.type) {
        this.emit(data.type, data);
      }
    } catch {
      // Not JSON, try to parse common patterns
      
      // Validation events
      if (line.includes('Validation request')) {
        this.emit('validation', { message: line });
      }
      
      // Storage events
      else if (line.includes('Storing file') || line.includes('File stored')) {
        this.emit('storage', { message: line });
      }
      
      // Connection events
      else if (line.includes('Connected to') || line.includes('WebSocket connected')) {
        this.emit('connected', { message: line });
      }
      
      // Error patterns
      else if (line.includes('ERROR') || line.includes('Failed')) {
        this.emit('poa-error', { message: line });
      }
    }
  }
  
  /**
   * Handle auto-restart logic
   */
  async handleAutoRestart() {
    if (this.restartCount >= this.config.maxRestarts) {
      this.log('error', `Max restarts (${this.config.maxRestarts}) reached. Not restarting.`);
      this.emit('max-restarts-reached');
      return;
    }
    
    this.restarting = true;
    this.restartCount++;
    
    this.log('info', `Auto-restarting POA process (attempt ${this.restartCount}/${this.config.maxRestarts})...`);
    
    // Wait before restarting
    await new Promise(resolve => setTimeout(resolve, this.config.restartDelay));
    
    try {
      await this.start();
      this.restarting = false;
    } catch (error) {
      this.restarting = false;
      this.log('error', `Failed to restart: ${error.message}`);
    }
  }
  
  /**
   * Stop the POA process
   */
  async stop(force = false) {
    if (!this.running || !this.process) {
      throw new Error('POA process is not running');
    }
    
    // Disable auto-restart when manually stopping
    const autoRestart = this.config.autoRestart;
    this.config.autoRestart = false;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          this.log('warn', 'Process did not exit gracefully, forcing kill');
          this.process.kill('SIGKILL');
        }
      }, 10000); // 10 second timeout
      
      this.process.once('exit', (code, signal) => {
        clearTimeout(timeout);
        this.config.autoRestart = autoRestart;
        resolve({ code, signal });
      });
      
      // Send termination signal
      if (force) {
        this.process.kill('SIGKILL');
      } else {
        this.process.kill('SIGTERM');
      }
      
      this.log('info', `Sent ${force ? 'SIGKILL' : 'SIGTERM'} to POA process`);
    });
  }
  
  /**
   * Restart the POA process
   */
  async restart() {
    if (this.running) {
      await this.stop();
      // Wait a bit before starting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return this.start();
  }
  
  /**
   * Update configuration and restart if running
   */
  async updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    await this.writeConfig();
    
    if (this.running) {
      this.log('info', 'Configuration updated, restarting POA process...');
      await this.restart();
    }
  }
  
  /**
   * Get process status
   */
  getStatus() {
    return {
      running: this.running,
      pid: this.process?.pid || null,
      restartCount: this.restartCount,
      uptime: this.getUptime(),
      config: {
        account: this.config.account,
        nodeType: this.config.nodeType,
        maxStorage: this.config.maxStorage,
        spkApiUrl: this.config.spkApiUrl
      }
    };
  }
  
  /**
   * Get process uptime
   */
  getUptime() {
    if (!this.running || !this.startTime) return 0;
    return Date.now() - this.startTime;
  }
  
  /**
   * Add log entry
   */
  log(level, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message
    };
    
    this.logs.push(entry);
    
    // Keep logs under limit
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    
    this.emit('log', entry);
  }
  
  /**
   * Get recent logs
   */
  getLogs(limit = 100) {
    return this.logs.slice(-limit);
  }
  
  /**
   * Clear logs
   */
  clearLogs() {
    this.logs = [];
  }
  
  /**
   * Check if process is running (by PID)
   */
  isRunning() {
    if (!this.process || !this.process.pid) return false;
    
    try {
      // Check if process exists
      process.kill(this.process.pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = POAProcessManager;