const { EventEmitter } = require('events');
const SPK = require('@disregardfiat/spk-js').default;
const IPFSManager = require('../ipfs/ipfs-manager');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);

/**
 * Storage Node Manager - Wraps spk-js storage node operations with IPFS integration
 */
class StorageNodeManager extends EventEmitter {
    constructor(accountManager, config = {}) {
        super();
        this.accountManager = accountManager;
        this.config = {
            node: config.node || 'https://spktest.dlux.io',
            honeygraphUrl: config.honeygraphUrl || 'https://honeygraph.dlux.io',
            maxStorage: config.maxStorage || 100 * 1024 * 1024 * 1024, // 100GB default
            ...config
        };
        
        this.spkInstance = null;
        this.nodeStatus = null;
        this.storedContracts = [];
        this.isRegistered = false;
        this.lastRegistrationCheck = 0;
        this.cachedRegistrationStatus = null;
        this.running = false;
        this.stateFile = path.join(os.homedir(), '.oratr', 'storage-node-state.json');
        
        // Initialize IPFS Manager
        this.ipfsManager = new IPFSManager({
            host: this.config.ipfsHost || '127.0.0.1',
            port: this.config.ipfsPort || 5001,
            externalNode: this.config.externalIPFS || false,
            dataPath: this.config.ipfsDataPath
        });
        
        // Forward IPFS events
        this.ipfsManager.on('started', (info) => this.emit('ipfs-started', info));
        this.ipfsManager.on('stopped', () => this.emit('ipfs-stopped'));
        this.ipfsManager.on('error', (error) => this.emit('ipfs-error', error));
        this.ipfsManager.on('peer-count', (count) => this.emit('ipfs-peer-count', count));
    }
    
    /**
     * Start IPFS node
     */
    async startIPFS() {
        try {
            await this.ipfsManager.start();
            return await this.ipfsManager.getNodeInfo();
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    
    /**
     * Stop IPFS node
     */
    async stopIPFS() {
        await this.ipfsManager.stop();
    }
    
    /**
     * Get IPFS node status
     */
    async getIPFSStatus() {
        return {
            running: this.ipfsManager.running,
            nodeInfo: this.ipfsManager.nodeInfo,
            config: await this.ipfsManager.getConfig()
        };
    }
    
    /**
     * Update IPFS configuration
     */
    async updateIPFSConfig(newConfig) {
        await this.ipfsManager.updateConfig(newConfig);
        // Update our own config as well
        Object.assign(this.config, {
            ipfsHost: newConfig.host,
            ipfsPort: newConfig.port,
            externalIPFS: newConfig.externalNode,
            ipfsDataPath: newConfig.dataPath
        });
    }
    
    /**
     * Get available disk space for storage
     */
    async getAvailableDiskSpace() {
        try {
            const dataPath = this.ipfsManager.config.dataPath;
            
            // Use platform-appropriate command to get disk space
            let command;
            if (process.platform === 'win32') {
                command = `dir "${dataPath}" /-c | find "bytes free"`;
            } else {
                command = `df -h "${dataPath}" | tail -1 | awk '{print $4}'`;
            }
            
            const { stdout } = await execAsync(command);
            
            if (process.platform === 'win32') {
                // Parse Windows output
                const match = stdout.match(/(\d+) bytes free/);
                if (match) {
                    return parseInt(match[1]);
                }
            } else {
                // Parse Unix output (convert from human readable)
                const size = stdout.trim();
                return this.parseStorageSize(size);
            }
            
            return null;
        } catch (error) {
            console.warn('Failed to get disk space:', error);
            return null;
        }
    }
    
    /**
     * Parse storage size string to bytes
     */
    parseStorageSize(sizeStr) {
        const units = { K: 1024, M: 1024**2, G: 1024**3, T: 1024**4 };
        const match = sizeStr.match(/^(\d+(?:\.\d+)?)([KMGT]?)$/i);
        if (match) {
            const value = parseFloat(match[1]);
            const unit = match[2].toUpperCase();
            return Math.floor(value * (units[unit] || 1));
        }
        return 0;
    }
    
    /**
     * Get storage usage stats
     */
    async getStorageStats() {
        try {
            const repoStats = await this.ipfsManager.getRepoStats();
            const pinnedFiles = await this.ipfsManager.getPinnedFiles();
            const availableSpace = await this.getAvailableDiskSpace();
            
            return {
                used: repoStats.repoSize,
                available: availableSpace,
                maxStorage: this.config.maxStorage,
                filesStored: pinnedFiles.length,
                repoStats,
                pinnedCount: pinnedFiles.length
            };
        } catch (error) {
            return {
                used: 0,
                available: null,
                maxStorage: this.config.maxStorage,
                filesStored: 0,
                pinnedCount: 0
            };
        }
    }
    
    /**
     * Update storage limit
     */
    updateStorageLimit(limitGB) {
        this.config.maxStorage = limitGB * 1024 * 1024 * 1024; // Convert GB to bytes
        this.emit('storage-limit-updated', this.config.maxStorage);
    }
    
    /**
     * Check if storage limit would be exceeded
     */
    async checkStorageLimit(additionalSize = 0) {
        const stats = await this.getStorageStats();
        const projectedUsage = stats.used + additionalSize;
        
        return {
            withinLimit: projectedUsage <= this.config.maxStorage,
            currentUsage: stats.used,
            projectedUsage,
            limit: this.config.maxStorage,
            availableSpace: this.config.maxStorage - stats.used
        };
    }
    
    /**
     * Initialize SPK instance with current account
     */
    async init() {
        const activeAccount = await this.accountManager.getActive();
        if (!activeAccount) {
            throw new Error('No active account');
        }
        
        this.spkInstance = new SPK(activeAccount.username, {
            node: this.config.node,
            honeygraphUrl: this.config.honeygraphUrl,
            keychain: this.accountManager.signer
        });
        
        await this.spkInstance.init();
        await this.checkNodeStatus();
        
        // Initialize IPFS if not already running
        if (!this.ipfsManager.running) {
            try {
                const isDaemonRunning = await this.ipfsManager.isDaemonRunning();
                if (isDaemonRunning) {
                    // Connect to existing daemon
                    await this.ipfsManager.start();
                }
            } catch (error) {
                console.log('IPFS not running, will need to start manually');
            }
        }
    }
    
    /**
     * Load persisted state from disk
     */
    async loadState() {
        try {
            const stateData = await fs.readFile(this.stateFile, 'utf8');
            const state = JSON.parse(stateData);
            
            // Only use state if it's less than 1 hour old
            const now = Date.now();
            if (state.timestamp && (now - state.timestamp) < 60 * 60 * 1000) {
                this.cachedRegistrationStatus = state.registrationStatus;
                this.lastRegistrationCheck = state.timestamp;
                this.isRegistered = state.isRegistered;
                return state;
            }
        } catch (error) {
            // State file doesn't exist or is corrupted, that's fine
        }
        return null;
    }

    /**
     * Save state to disk
     */
    async saveState() {
        try {
            const dir = path.dirname(this.stateFile);
            await fs.mkdir(dir, { recursive: true });
            
            const state = {
                timestamp: Date.now(),
                isRegistered: this.isRegistered,
                registrationStatus: this.cachedRegistrationStatus,
                running: this.running
            };
            
            await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2));
        } catch (error) {
            console.error('Failed to save storage node state:', error);
        }
    }

    /**
     * Fast status check - prioritizes local process status
     */
    async getFastStatus() {
        try {
            // 0. Load persisted state first
            const persistedState = await this.loadState();
            
            // 1. Check if IPFS is running locally (fastest check)
            const ipfsRunning = this.ipfsManager.running || await this.ipfsManager.isDaemonRunning();
            
            // 2. Check if we have cached registration status (< 5 minutes old)
            const now = Date.now();
            const cacheValid = this.cachedRegistrationStatus && 
                              (now - this.lastRegistrationCheck) < 5 * 60 * 1000;
            
            if (ipfsRunning && (cacheValid || persistedState)) {
                return {
                    quickCheck: true,
                    registered: this.cachedRegistrationStatus?.registered || persistedState?.isRegistered || false,
                    ipfsRunning: true,
                    cached: true,
                    persisted: !!persistedState,
                    lastCheck: this.lastRegistrationCheck,
                    message: 'Storage node appears to be running'
                };
            }
            
            // 3. If IPFS is running but no cache, give optimistic response
            if (ipfsRunning) {
                // Also check if we've previously initialized successfully
                const wasRunning = this.running && this.spkInstance;
                const wasRegistered = persistedState?.isRegistered || false;
                
                // If we have persisted state showing registration, mark as ready immediately
                if (wasRegistered) {
                    this.isRegistered = true;
                    this.running = true;
                }
                
                return {
                    quickCheck: true,
                    registered: wasRunning || wasRegistered, // Optimistic based on previous state
                    ipfsRunning: true,
                    cached: false,
                    wasRunning,
                    persisted: !!persistedState,
                    running: this.running,
                    message: (wasRunning || wasRegistered) ? 
                        'Storage node ready (restored from previous session)' : 
                        'IPFS running, checking registration in background...'
                };
            }
            
            return {
                quickCheck: false,
                registered: false,
                ipfsRunning: false,
                message: 'IPFS not running, full check required'
            };
            
        } catch (error) {
            return {
                quickCheck: false,
                registered: false,
                ipfsRunning: false,
                error: error.message
            };
        }
    }

    /**
     * Check if node is registered (full network check)
     */
    async checkNodeStatus() {
        try {
            if (!this.spkInstance) {
                await this.init();
            }
            
            this.nodeStatus = await this.spkInstance.getNodeStatus();
            this.isRegistered = this.nodeStatus.registered;
            
            // If registered and IPFS is running, mark as fully operational
            if (this.isRegistered && this.ipfsManager.running) {
                this.running = true;
            }
            
            // Cache the result
            this.cachedRegistrationStatus = this.nodeStatus;
            this.lastRegistrationCheck = Date.now();
            
            // Save state to disk for persistence
            await this.saveState();
            
            this.emit('status-updated', this.nodeStatus);
            return this.nodeStatus;
        } catch (error) {
            console.error('Failed to check node status:', error);
            this.isRegistered = false;
            
            // Cache the failure
            this.cachedRegistrationStatus = { registered: false, error: error.message };
            this.lastRegistrationCheck = Date.now();
            
            return { registered: false, error: error.message };
        }
    }
    
    /**
     * Register as a storage node
     */
    async registerNode(domain = null, bidRate = 500) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        // Ensure IPFS is running to get node ID
        if (!this.ipfsManager.running) {
            throw new Error('IPFS node must be running to register as storage node');
        }
        
        try {
            // Get IPFS node ID automatically
            const nodeInfo = await this.ipfsManager.getNodeInfo();
            const ipfsId = nodeInfo.id;
            
            console.log(`Registering storage node with IPFS ID: ${ipfsId}`);
            
            const result = await this.spkInstance.registerNode(ipfsId, domain, bidRate);
            await this.checkNodeStatus();
            this.emit('node-registered', result);
            return result;
        } catch (error) {
            console.error('Failed to register node:', error);
            throw error;
        }
    }
    
    /**
     * Register public key authority
     */
    async registerAuthority(pubKey) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        return this.spkInstance.registerAuthority(pubKey);
    }
    
    /**
     * Get contracts available for storage
     */
    async getAvailableContracts(limit = 100) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            const contracts = await this.spkInstance.getAvailableContracts(limit);
            
            // Enhance with additional info
            const enhanced = await Promise.all(contracts.map(async (contract) => {
                const earnings = this.spkInstance.calculateStorageEarnings({
                    size: contract.size,
                    providers: contract.providers,
                    duration: 28800 * 30 // 30 days
                });
                
                return {
                    ...contract,
                    earnings,
                    sizeFormatted: this.formatBytes(contract.size),
                    needed: contract.needed || 0,
                    expiresIn: this.calculateTimeUntil(contract.expiryBlock)
                };
            }));
            
            return enhanced;
        } catch (error) {
            console.error('Failed to get available contracts:', error);
            return [];
        }
    }
    
    /**
     * Get contracts currently being stored
     */
    async getStoredContracts() {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            this.storedContracts = await this.spkInstance.getStoredContracts();
            this.emit('contracts-updated', this.storedContracts);
            return this.storedContracts;
        } catch (error) {
            console.error('Failed to get stored contracts:', error);
            return [];
        }
    }
    
    /**
     * Store files (become a storage provider)
     */
    async storeFiles(contractIds) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        if (!this.isRegistered) {
            throw new Error('Node not registered. Please register first.');
        }
        
        try {
            // Pass false as second parameter to skip contract verification
            const result = await this.spkInstance.storeFiles(contractIds, false);
            await this.getStoredContracts(); // Refresh list
            this.emit('files-stored', result);
            return result;
        } catch (error) {
            console.error('Failed to store files:', error);
            throw error;
        }
    }
    
    /**
     * Remove files from storage
     */
    async removeFiles(contractIds) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            const result = await this.spkInstance.removeFiles(contractIds);
            await this.getStoredContracts(); // Refresh list
            this.emit('files-removed', result);
            return result;
        } catch (error) {
            console.error('Failed to remove files:', error);
            throw error;
        }
    }
    
    /**
     * Batch store multiple contracts
     */
    async batchStore(contractIds, chunkSize = 10) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            // Pass false as third parameter to skip contract verification
            const result = await this.spkInstance.batchStore(contractIds, chunkSize, false);
            await this.getStoredContracts(); // Refresh list
            this.emit('batch-stored', result);
            return result;
        } catch (error) {
            console.error('Failed to batch store:', error);
            throw error;
        }
    }
    
    /**
     * Extend a storage contract
     */
    async extendContract(contractId, fileOwner, brocaAmount, power = 0) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            const result = await this.spkInstance.extendContract(
                contractId,
                fileOwner,
                brocaAmount,
                power
            );
            this.emit('contract-extended', result);
            return result;
        } catch (error) {
            console.error('Failed to extend contract:', error);
            throw error;
        }
    }
    
    /**
     * Search files on the network using Honeygraph
     */
    async searchFiles(options = {}) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            const results = await this.spkInstance.searchFiles(options);
            
            // Enhance results with storage opportunities
            const enhanced = await Promise.all(results.map(async (file) => {
                const providers = await this.spkInstance.getFileStorageProviders(file.cid);
                const isUnderReplicated = providers.count < providers.target;
                
                return {
                    ...file,
                    providers: providers.count,
                    targetProviders: providers.target,
                    isUnderReplicated,
                    sizeFormatted: this.formatBytes(file.size),
                    uploadedFormatted: this.formatDate(file.uploaded)
                };
            }));
            
            return enhanced;
        } catch (error) {
            console.error('Failed to search files:', error);
            return [];
        }
    }
    
    /**
     * Get files by tags
     */
    async getFilesByTags(tags, logic = 'OR') {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            return await this.spkInstance.getFilesByTags(tags, logic);
        } catch (error) {
            console.error('Failed to get files by tags:', error);
            return [];
        }
    }
    
    /**
     * Get recently uploaded files
     */
    async getRecentFiles(limit = 50) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            return await this.spkInstance.getRecentFiles(limit);
        } catch (error) {
            console.error('Failed to get recent files:', error);
            return [];
        }
    }
    
    /**
     * Get storage opportunities (under-replicated contracts)
     */
    async findStorageOpportunities(filters = {}) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            return await this.spkInstance.findStorageOpportunities(filters);
        } catch (error) {
            console.error('Failed to find storage opportunities:', error);
            return [];
        }
    }
    
    /**
     * Get storage node statistics
     */
    async getNodeStats() {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            const [status, stored, stats] = await Promise.all([
                this.checkNodeStatus(),
                this.getStoredContracts(),
                this.spkInstance.getStorageNodeStats()
            ]);
            
            // Calculate total earnings
            let totalEarnings = 0;
            let totalSize = 0;
            
            stored.forEach(contract => {
                totalSize += contract.size;
                const earnings = this.spkInstance.calculateStorageEarnings({
                    size: contract.size,
                    providers: contract.providers,
                    duration: 28800 * 30
                });
                totalEarnings += earnings.monthlyBroca;
            });
            
            return {
                ...status,
                ...stats,
                contractsStored: stored.length,
                totalSize,
                totalSizeFormatted: this.formatBytes(totalSize),
                estimatedMonthlyEarnings: totalEarnings,
                storedContracts: stored
            };
        } catch (error) {
            console.error('Failed to get node stats:', error);
            return null;
        }
    }
    
    /**
     * Get expiring contracts
     */
    async getExpiringContracts(days = 7) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            return await this.spkInstance.getExpiringContracts(days);
        } catch (error) {
            console.error('Failed to get expiring contracts:', error);
            return [];
        }
    }
    
    /**
     * Calculate storage ROI
     */
    async calculateStorageROI(storageCapacity, bidRate = 500) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
            return await this.spkInstance.calculateStorageROI(storageCapacity, bidRate);
        } catch (error) {
            console.error('Failed to calculate ROI:', error);
            return null;
        }
    }
    
    // Utility methods
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    formatDate(timestamp) {
        return new Date(timestamp).toLocaleString();
    }
    
    calculateTimeUntil(blockNumber) {
        // Assuming 3 second blocks
        const currentBlock = this.spkInstance?.account?.head_block || 0;
        const blocksRemaining = blockNumber - currentBlock;
        const secondsRemaining = blocksRemaining * 3;
        
        if (secondsRemaining <= 0) return 'Expired';
        
        const days = Math.floor(secondsRemaining / 86400);
        const hours = Math.floor((secondsRemaining % 86400) / 3600);
        
        if (days > 0) {
            return `${days}d ${hours}h`;
        }
        return `${hours}h`;
    }
    
    /**
     * Get comprehensive storage node status
     */
    async getComprehensiveStatus() {
        try {
            const [ipfsStatus, storageStats, nodeStats, spkStatus] = await Promise.all([
                this.getIPFSStatus(),
                this.getStorageStats(),
                this.getNodeStats(),
                this.checkNodeStatus()
            ]);
            
            return {
                ipfs: ipfsStatus,
                storage: storageStats,
                node: nodeStats,
                spk: spkStatus,
                isFullyOperational: ipfsStatus.running && spkStatus.registered && this.running
            };
        } catch (error) {
            console.error('Failed to get comprehensive status:', error);
            return {
                ipfs: { running: false },
                storage: { used: 0, available: null },
                node: null,
                spk: { registered: false },
                isFullyOperational: false,
                error: error.message
            };
        }
    }
    
    /**
     * Start complete storage node (IPFS + SPK registration check)
     */
    async startComplete() {
        try {
            // 1. Start IPFS if not running
            if (!this.ipfsManager.running) {
                await this.startIPFS();
            }
            
            // 2. Initialize SPK
            if (!this.spkInstance) {
                await this.init();
            }
            
            // 3. Check registration status
            await this.checkNodeStatus();
            
            if (!this.isRegistered) {
                throw new Error('Node is not registered. Please complete registration first.');
            }
            
            // 4. Start storage node services
            this.running = true;
            this.emit('storage-node-started');
            
            return await this.getComprehensiveStatus();
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    
    /**
     * Stop complete storage node
     */
    async stopComplete() {
        this.running = false;
        
        // Stop IPFS if we're managing it
        if (!this.config.externalIPFS) {
            await this.stopIPFS();
        }
        
        this.emit('storage-node-stopped');
    }
}

module.exports = StorageNodeManager;