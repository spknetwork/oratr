const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * IPFS Manager
 * Handles IPFS node operations, daemon management, and file storage
 */
class IPFSManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      host: config.host || '127.0.0.1',
      port: config.port || 5001,
      protocol: config.protocol || 'http',
      dataPath: config.dataPath || path.join(os.homedir(), '.ipfs'),
      externalNode: config.externalNode || false,
      daemon: config.daemon || false,
      maxStorage: config.maxStorage || 100 * 1024 * 1024 * 1024, // 100GB default
      ...config
    };
    
    this.client = null;
    this.nodeInfo = null;
    this.running = false;
    this.daemonProcess = null;
    this.isExternalNode = this.config.externalNode;
    this.ipfsBinaryPath = null;
    
    // Storage monitoring
    this.storageMonitorInterval = null;
    this.lastStorageCheck = null;
    
    // Lazy load ES modules
    this.kuboModule = null;
    this.hashModule = null;
  }

  /**
   * Resolve the IPFS (Kubo) binary path bundled with the app or fallback to system binary
   */
  resolveIpfsBinary() {
    if (this.ipfsBinaryPath) return this.ipfsBinaryPath;

    // 1) Environment override
    if (process.env.ORATR_IPFS_PATH) {
      this.ipfsBinaryPath = process.env.ORATR_IPFS_PATH;
      return this.ipfsBinaryPath;
    }

    // 2) Packaged app resources (electron asar unpacked extraResources)
    try {
      const fsSync = require('fs');
      const path = require('path');
      const resourcesPath = process.resourcesPath || path.join(__dirname, '../../../');
      const binDir = path.join(resourcesPath, 'bin');

      const platform = process.platform; // 'win32' | 'darwin' | 'linux'
      const arch = process.arch; // 'x64', 'arm64', etc

      const candidates = [];
      // Common names we might ship
      if (platform === 'win32') {
        candidates.push('ipfs.exe', 'kubo.exe', 'ipfs-windows-amd64.exe');
      } else if (platform === 'darwin') {
        candidates.push('ipfs', 'kubo', 'ipfs-darwin-amd64', 'ipfs-darwin-arm64');
      } else {
        // linux
        candidates.push('ipfs', 'kubo', 'ipfs-linux-amd64', 'ipfs-linux-arm64');
      }

      for (const name of candidates) {
        const full = path.join(binDir, name);
        if (fsSync.existsSync(full)) {
          this.ipfsBinaryPath = full;
          return this.ipfsBinaryPath;
        }
      }
    } catch (_) {
      // ignore
    }

    // 3) Fallback to system 'ipfs'
    this.ipfsBinaryPath = 'ipfs';
    return this.ipfsBinaryPath;
  }

  /**
   * Load ES modules dynamically
   */
  async loadModules() {
    if (!this.kuboModule) {
      this.kuboModule = await import('kubo-rpc-client');
    }
    if (!this.hashModule) {
      this.hashModule = await import('ipfs-only-hash');
    }
  }

  /**
   * Check if IPFS daemon is running (fast check)
   */
  async isDaemonRunning() {
    try {
      // If we already have a running client, use it
      if (this.client && this.running) {
        try {
          await this.client.id();
          return true;
        } catch (error) {
          // Client failed, mark as not running
          this.running = false;
        }
      }
      
      // Try to connect to daemon quickly
      await this.loadModules();
      const { create } = this.kuboModule;
      const testClient = create({
        host: this.config.host,
        port: this.config.port,
        protocol: this.config.protocol,
        timeout: 1000 // Fast 1 second timeout
      });
      
      // Quick ID check with timeout
      await Promise.race([
        testClient.id(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Initialize IPFS repository if needed
   */
  async initRepo() {
    try {
      // Check if repo exists
      const configPath = path.join(this.config.dataPath, 'config');
      await fs.access(configPath);
      return true; // Repo already exists
    } catch (error) {
      // Initialize new repo
      return new Promise((resolve, reject) => {
        const init = spawn(this.resolveIpfsBinary(), ['init', '--profile', 'server'], {
          env: { ...process.env, IPFS_PATH: this.config.dataPath }
        });

        init.on('close', (code) => {
          if (code === 0) {
            this.configureCORS().then(() => resolve(true)).catch(reject);
          } else {
            reject(new Error(`IPFS init failed with code ${code}`));
          }
        });

        init.on('error', reject);
      });
    }
  }

  /**
   * Configure IPFS CORS settings and bootstrap peers
   */
  async configureCORS() {
    const commands = [
      ['config', '--json', 'API.HTTPHeaders.Access-Control-Allow-Origin', '["*"]'],
      ['config', '--json', 'API.HTTPHeaders.Access-Control-Allow-Methods', '["GET", "POST"]'],
      ['config', '--json', 'API.HTTPHeaders.Access-Control-Allow-Headers', '["Authorization"]'],
      ['config', '--json', 'API.HTTPHeaders.Access-Control-Expose-Headers', '["Location"]'],
      ['config', '--json', 'API.HTTPHeaders.Access-Control-Allow-Credentials', '["true"]'],
      // Ensure PubSub is enabled for POA (internal node)
      ['config', '--json', 'Pubsub.Enabled', 'true'],
      ['config', '--json', 'Pubsub.Router', '"gossipsub"'],
      // Add default IPFS bootstrap peers for peer connectivity
      ['bootstrap', 'add', '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'],
      ['bootstrap', 'add', '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa'],
      ['bootstrap', 'add', '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zp5gZkpfsT9i2jGGzCJYGRNL3Bv2aD'],
      ['bootstrap', 'add', '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ']
    ];

    for (const cmd of commands) {
      await new Promise((resolve, reject) => {
        const proc = spawn(this.resolveIpfsBinary(), cmd, {
          env: { ...process.env, IPFS_PATH: this.config.dataPath }
        });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else {
            // Bootstrap commands may fail if peer already exists - that's OK
            if (cmd[0] === 'bootstrap') {
              resolve(); // Ignore bootstrap failures
            } else {
              reject(new Error(`IPFS config failed: ${cmd.join(' ')}`));
            }
          }
        });
      });
    }
  }

  /**
   * Start IPFS daemon
   */
  async startDaemon() {
    if (this.daemonProcess) {
      throw new Error('IPFS daemon already running');
    }

    // Initialize repo if needed
    await this.initRepo();

    return new Promise((resolve, reject) => {
      this.daemonProcess = spawn(this.resolveIpfsBinary(), ['daemon', '--enable-gc'], {
        env: { ...process.env, IPFS_PATH: this.config.dataPath },
        detached: this.config.daemon // Allow daemon to run independently
      });

      this.daemonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('IPFS:', output);
        
        if (output.includes('Daemon is ready')) {
          this.emit('daemon-ready');
          resolve();
        }
      });

      this.daemonProcess.stderr.on('data', (data) => {
        console.error('IPFS Error:', data.toString());
      });

      this.daemonProcess.on('error', (error) => {
        this.daemonProcess = null;
        reject(error);
      });

      this.daemonProcess.on('exit', (code) => {
        this.daemonProcess = null;
        this.emit('daemon-stopped', code);
      });

      // Give daemon time to start
      setTimeout(() => {
        if (this.daemonProcess) {
          resolve();
        }
      }, 5000);
    });
  }

  /**
   * Stop IPFS daemon
   */
  async stopDaemon() {
    if (!this.daemonProcess) {
      return;
    }

    return new Promise((resolve) => {
      this.daemonProcess.once('exit', () => {
        this.daemonProcess = null;
        resolve();
      });

      this.daemonProcess.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (this.daemonProcess) {
          this.daemonProcess.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  /**
   * Start IPFS node
   */
  async start() {
    try {
      // Load modules
      await this.loadModules();
      const { create } = this.kuboModule;

      // Check if connecting to external node
      if (!this.isExternalNode) {
        // Check if daemon is already running
        const isRunning = await this.isDaemonRunning();
        
        if (!isRunning) {
          // Start our own daemon
          await this.startDaemon();
          // Wait a bit for daemon to be ready
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Initialize IPFS client
      this.client = create({
        host: this.config.host,
        port: this.config.port,
        protocol: this.config.protocol
      });

      // Test connection and get node info
      this.nodeInfo = await this.client.id();
      this.running = true;
      
      // Start monitoring peers and storage
      this.startPeerMonitoring();
      this.startStorageMonitoring();
      
      this.emit('started', this.nodeInfo);
      return this.nodeInfo;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop IPFS node
   */
  async stop() {
    this.stopPeerMonitoring();
    this.stopStorageMonitoring();
    
    if (!this.isExternalNode && this.daemonProcess) {
      await this.stopDaemon();
    }
    
    this.running = false;
    this.client = null;
    this.nodeInfo = null;
    this.emit('stopped');
  }

  /**
   * Start monitoring peers
   */
  startPeerMonitoring() {
    this.peerMonitorInterval = setInterval(async () => {
      if (!this.running || !this.client) return;
      
      try {
        const peers = await this.client.swarm.peers();
        this.emit('peer-count', peers.length);
      } catch (error) {
        // Ignore errors in monitoring
      }
    }, 5000);
  }

  /**
   * Stop monitoring peers
   */
  stopPeerMonitoring() {
    if (this.peerMonitorInterval) {
      clearInterval(this.peerMonitorInterval);
      this.peerMonitorInterval = null;
    }
  }

  /**
   * Start monitoring storage usage
   */
  startStorageMonitoring() {
    this.storageMonitorInterval = setInterval(async () => {
      if (!this.running || !this.client) return;
      
      try {
        const stats = await this.getRepoStats();
        this.lastStorageCheck = {
          timestamp: Date.now(),
          ...stats
        };
        
        // Check if approaching storage limit
        const usagePercent = (stats.repoSize / this.config.maxStorage) * 100;
        
        if (usagePercent > 90) {
          this.emit('storage-warning', {
            level: 'critical',
            usagePercent,
            used: stats.repoSize,
            limit: this.config.maxStorage
          });
        } else if (usagePercent > 75) {
          this.emit('storage-warning', {
            level: 'warning', 
            usagePercent,
            used: stats.repoSize,
            limit: this.config.maxStorage
          });
        }
        
        this.emit('storage-stats', this.lastStorageCheck);
      } catch (error) {
        // Ignore errors in monitoring
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop monitoring storage
   */
  stopStorageMonitoring() {
    if (this.storageMonitorInterval) {
      clearInterval(this.storageMonitorInterval);
      this.storageMonitorInterval = null;
    }
  }

  /**
   * Update storage limit
   */
  updateStorageLimit(limitBytes) {
    this.config.maxStorage = limitBytes;
    this.emit('storage-limit-updated', limitBytes);
  }

  /**
   * Get storage usage percentage
   */
  async getStorageUsagePercent() {
    try {
      const stats = await this.getRepoStats();
      return (stats.repoSize / this.config.maxStorage) * 100;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Check if storage limit would be exceeded by adding more data
   */
  async checkStorageCapacity(additionalSize = 0) {
    try {
      const stats = await this.getRepoStats();
      const projectedSize = stats.repoSize + additionalSize;
      
      return {
        withinLimit: projectedSize <= this.config.maxStorage,
        currentSize: stats.repoSize,
        projectedSize,
        limit: this.config.maxStorage,
        availableSpace: this.config.maxStorage - stats.repoSize,
        usagePercent: (stats.repoSize / this.config.maxStorage) * 100
      };
    } catch (error) {
      return {
        withinLimit: false,
        error: error.message
      };
    }
  }

  /**
   * Get node information
   */
  async getNodeInfo() {
    if (!this.client) {
      throw new Error('IPFS not started');
    }

    try {
      const info = await this.client.id();
      // Convert multiaddr objects to strings
      const addresses = info.addresses ? info.addresses.map(addr => 
        typeof addr === 'string' ? addr : addr.toString()
      ) : [];
      
      // Convert PeerId object to string
      const id = typeof info.id === 'object' ? info.id.toString() : info.id;
      
      this.nodeInfo = {
        ...info,
        id,
        addresses
      };
      return this.nodeInfo;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Publish a message to an IPFS PubSub topic
   */
  async publish(topic, messageObject) {
    if (!this.client) {
      throw new Error('IPFS not started');
    }
    const data = Buffer.from(JSON.stringify(messageObject));
    return this.client.pubsub.publish(topic, data);
  }

  /**
   * Subscribe to an IPFS PubSub topic
   * handler receives: (msgObject, rawMsg)
   */
  async subscribe(topic, handler) {
    if (!this.client) {
      throw new Error('IPFS not started');
    }
    const wrapped = async (msg) => {
      try {
        const dataStr = Buffer.from(msg.data).toString('utf8');
        const obj = JSON.parse(dataStr);
        await handler(obj, msg);
      } catch (_) {
        // ignore malformed
      }
    };
    await this.client.pubsub.subscribe(topic, wrapped);
    return wrapped; // return internal handler for potential unsubscribe
  }

  /**
   * Unsubscribe from a topic
   */
  async unsubscribe(topic, handler) {
    if (!this.client) return;
    try {
      await this.client.pubsub.unsubscribe(topic, handler);
    } catch (_) {
      // ignore
    }
  }

  /**
   * Get connected peers
   */
  async getConnectedPeers() {
    if (!this.client) {
      throw new Error('IPFS not started');
    }

    try {
      const peers = await this.client.swarm.peers();
      return peers;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Test connection to an IPFS node
   */
  async testConnection(host = '127.0.0.1', port = 5001) {
    try {
      // Load modules if not already loaded
      if (!this.kuboModule) {
        await this.loadModules();
      }
      
      const { create } = this.kuboModule;
      
      // Create temporary client to test connection
      const testClient = create({
        host: host,
        port: port,
        protocol: 'http',
        timeout: 5000
      });
      
      // Try to get node ID
      const info = await testClient.id();
      
      // If we get here, connection is successful
      return !!info;
    } catch (error) {
      console.log('IPFS connection test failed:', error.message);
      return false;
    }
  }

  /**
   * Add file to IPFS
   */
  async addFile(file, options = {}) {
    if (!this.client) {
      throw new Error('IPFS not started');
    }

    try {
      const result = await this.client.add(file, {
        pin: options.pin !== false,
        wrapWithDirectory: options.wrapWithDirectory || false,
        chunker: options.chunker || 'size-262144',
        rawLeaves: true,
        cidVersion: 0,
        ...options
      });
      
      this.emit('file-added', result);
      return result;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get file from IPFS
   */
  async getFile(cid) {
    if (!this.client) {
      throw new Error('IPFS not started');
    }

    try {
      const chunks = [];
      for await (const chunk of this.client.cat(cid)) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Pin file
   */
  async pinFile(cid) {
    if (!this.client) {
      throw new Error('IPFS not started');
    }

    try {
      await this.client.pin.add(cid);
      this.emit('file-pinned', cid);
      return true;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Unpin file
   */
  async unpinFile(cid) {
    if (!this.client) {
      throw new Error('IPFS not started');
    }

    try {
      await this.client.pin.rm(cid);
      this.emit('file-unpinned', cid);
      return true;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get pinned files
   */
  async getPinnedFiles() {
    if (!this.client) {
      throw new Error('IPFS not started');
    }

    try {
      const pins = [];
      for await (const pin of this.client.pin.ls()) {
        pins.push(pin);
      }
      return pins;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get repository stats
   */
  async getRepoStats() {
    if (!this.client) {
      throw new Error('IPFS not started');
    }

    try {
      const stats = await this.client.repo.stat();
      // Handle BigInt values from kubo client
      return {
        repoSize: Number(stats.repoSize || 0),
        storageMax: Number(stats.storageMax || 0),
        numObjects: Number(stats.numObjects || 0),
        repoPath: stats.repoPath || '',
        version: stats.version || ''
      };
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get storage configuration
   */
  async getConfig() {
    return {
      dataPath: this.config.dataPath,
      host: this.config.host,
      port: this.config.port,
      externalNode: this.isExternalNode,
      daemon: this.config.daemon,
      nodeId: this.nodeInfo?.id || null
    };
  }

  /**
   * Update configuration
   */
  async updateConfig(newConfig) {
    // Stop if running
    const wasRunning = this.running;
    if (wasRunning) {
      await this.stop();
    }

    // Update config
    Object.assign(this.config, newConfig);
    this.isExternalNode = this.config.externalNode;

    // Restart if was running
    if (wasRunning) {
      await this.start();
    }
  }

  /**
   * Generate IPFS hash without adding to node
   */
  async hashOnly(content, options = {}) {
    await this.loadModules();
    const Hash = this.hashModule.default || this.hashModule;
    
    const hashOptions = {
      chunker: options.chunker || 'size-262144',
      rawLeaves: true,
      cidVersion: 0
    };

    try {
      const hash = await Hash.of(content, hashOptions);
      return hash;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Check if CID is valid
   */
  isValidCID(cid) {
    try {
      // Basic validation - starts with Qm and has correct length
      return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) ||
             /^bafy[a-z0-9]{50,}$/.test(cid); // CIDv1
    } catch {
      return false;
    }
  }

  /**
   * Run garbage collection
   */
  async runGarbageCollection() {
    if (!this.client) {
      throw new Error('IPFS not started');
    }

    try {
      const removed = [];
      for await (const result of this.client.repo.gc()) {
        removed.push(result);
      }
      
      this.emit('garbage-collected', { removed });
      return { removed };
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get bandwidth stats
   */
  async getBandwidthStats() {
    if (!this.client) {
      throw new Error('IPFS not started');
    }

    try {
      // The bandwidth stats method returns an async generator
      // We need to iterate once to get the current stats
      const statsGen = await this.client.stats.bw();
      const stats = await statsGen.next();
      
      if (stats.value) {
        // Handle BigInt values
        return {
          totalIn: Number(stats.value.totalIn || 0),
          totalOut: Number(stats.value.totalOut || 0),
          rateIn: Number(stats.value.rateIn || 0),
          rateOut: Number(stats.value.rateOut || 0)
        };
      }
      
      // Fallback if no stats available
      return {
        totalIn: 0,
        totalOut: 0,
        rateIn: 0,
        rateOut: 0
      };
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Enable PubSub in IPFS config
   */
  async enablePubSub() {
    try {
      // For external nodes, try API config
      if (this.isExternalNode && this.client) {
        // Try to enable PubSub via API
        const url = `http://${this.config.host}:${this.config.port}/api/v0/config`;
        const response = await fetch(url, {
          method: 'POST',
          body: new URLSearchParams({
            arg: 'Pubsub.Enabled',
            arg: 'true',
            bool: 'true'
          })
        });
        
        if (response.ok) {
          // Also set router
          await fetch(`http://${this.config.host}:${this.config.port}/api/v0/config`, {
            method: 'POST',
            body: new URLSearchParams({
              arg: 'Pubsub.Router',
              arg: 'gossipsub'
            })
          }).catch(() => {});
          this.emit('log', 'PubSub enabled successfully');
          return { success: true };
        } else {
          return { 
            success: false, 
            error: 'Failed to enable PubSub. You may need to manually run: ipfs config --json Pubsub.Enabled true' 
          };
        }
      }
      
      // For internal nodes, write config via CLI
      if (!this.isExternalNode) {
        const run = (args) => new Promise((resolve, reject) => {
          const p = spawn(this.resolveIpfsBinary(), args, { env: { ...process.env, IPFS_PATH: this.config.dataPath } });
          p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ipfs ${args.join(' ')} failed`)));
          p.on('error', reject);
        });
        try {
          await run(['config', '--json', 'Pubsub.Enabled', 'true']);
          await run(['config', '--json', 'Pubsub.Router', '"gossipsub"']);
          this.emit('log', 'PubSub enabled in local config');
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
      
      return { success: false, error: 'No IPFS node configured' };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to enable PubSub: ${error.message}` 
      };
    }
  }

  /**
   * Check if PubSub is enabled
   */
  async checkPubSubEnabled() {
    try {
      if (!this.client) return false;
      
      // Try to get config
      const url = `http://${this.config.host}:${this.config.port}/api/v0/config/show`;
      const response = await fetch(url, { method: 'POST' });
      
      if (response.ok) {
        const config = await response.json();
        const enabled = config.Pubsub?.Enabled === true;
        const router = config.Pubsub?.Router || config.Pubsub?.RouterName;
        return enabled && (!!router ? String(router).toLowerCase().includes('gossip') : true);
      }
      
      return false;
    } catch (error) {
      console.error('Failed to check PubSub status:', error);
      return false;
    }
  }
}

module.exports = IPFSManager;