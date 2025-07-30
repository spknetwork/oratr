const { EventEmitter } = require('events');
const SPK = require('@spknetwork/spk-js').default;

/**
 * Storage Node Manager - Wraps spk-js storage node operations
 */
class StorageNodeManager extends EventEmitter {
    constructor(accountManager, config = {}) {
        super();
        this.accountManager = accountManager;
        this.config = {
            node: config.node || 'https://spktest.dlux.io',
            honeygraphUrl: config.honeygraphUrl || 'https://honeygraph.dlux.io',
            ...config
        };
        
        this.spkInstance = null;
        this.nodeStatus = null;
        this.storedContracts = [];
        this.isRegistered = false;
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
    }
    
    /**
     * Check if node is registered
     */
    async checkNodeStatus() {
        try {
            this.nodeStatus = await this.spkInstance.getNodeStatus();
            this.isRegistered = this.nodeStatus.registered;
            this.emit('status-updated', this.nodeStatus);
            return this.nodeStatus;
        } catch (error) {
            console.error('Failed to check node status:', error);
            this.isRegistered = false;
            return { registered: false };
        }
    }
    
    /**
     * Register as a storage node
     */
    async registerNode(ipfsId, domain, bidRate = 500) {
        if (!this.spkInstance) {
            await this.init();
        }
        
        try {
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
            const result = await this.spkInstance.storeFiles(contractIds);
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
            const result = await this.spkInstance.batchStore(contractIds, chunkSize);
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
}

module.exports = StorageNodeManager;