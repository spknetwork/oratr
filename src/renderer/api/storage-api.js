/**
 * Storage Node API - Renderer process interface
 */

class StorageAPI {
    constructor() {
        this.eventHandlers = new Map();
        this.setupEventListeners();
    }
    
    // Node management
    async checkNodeStatus() {
        return window.ipcRenderer.invoke('storage:check-status');
    }
    
    async registerNode(ipfsId, domain, bidRate = 500) {
        return window.ipcRenderer.invoke('storage:register-node', { ipfsId, domain, bidRate });
    }
    
    async registerAuthority(pubKey) {
        return window.ipcRenderer.invoke('storage:register-authority', pubKey);
    }
    
    // Contract management
    async getAvailableContracts(limit = 100) {
        return window.ipcRenderer.invoke('storage:get-available-contracts', limit);
    }
    
    async getStoredContracts() {
        return window.ipcRenderer.invoke('storage:get-stored-contracts');
    }
    
    async storeFiles(contractIds) {
        return window.ipcRenderer.invoke('storage:store-files', contractIds);
    }
    
    async removeFiles(contractIds) {
        return window.ipcRenderer.invoke('storage:remove-files', contractIds);
    }
    
    async batchStore(contractIds, chunkSize = 10) {
        return window.ipcRenderer.invoke('storage:batch-store', { contractIds, chunkSize });
    }
    
    async extendContract(contractId, fileOwner, brocaAmount, power = 0) {
        return window.ipcRenderer.invoke('storage:extend-contract', { 
            contractId, 
            fileOwner, 
            brocaAmount, 
            power 
        });
    }
    
    // Search and discovery
    async searchFiles(options = {}) {
        return window.ipcRenderer.invoke('storage:search-files', options);
    }
    
    async getFilesByTags(tags, logic = 'OR') {
        return window.ipcRenderer.invoke('storage:get-files-by-tags', { tags, logic });
    }
    
    async getRecentFiles(limit = 50) {
        return window.ipcRenderer.invoke('storage:get-recent-files', limit);
    }
    
    async findStorageOpportunities(filters = {}) {
        return window.ipcRenderer.invoke('storage:find-opportunities', filters);
    }
    
    // Statistics and monitoring
    async getNodeStats() {
        return window.ipcRenderer.invoke('storage:get-node-stats');
    }
    
    async getExpiringContracts(days = 7) {
        return window.ipcRenderer.invoke('storage:get-expiring-contracts', days);
    }
    
    async calculateROI(storageCapacity, bidRate = 500) {
        return window.ipcRenderer.invoke('storage:calculate-roi', { storageCapacity, bidRate });
    }
    
    // Event handling
    setupEventListeners() {
        const events = [
            'storage:status-updated',
            'storage:contracts-updated',
            'storage:files-stored',
            'storage:files-removed'
        ];
        
        events.forEach(event => {
            window.window.ipcRenderer.on(event, (event, data) => {
                this.emit(event.replace('storage:', ''), data);
            });
        });
    }
    
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event).add(handler);
    }
    
    off(event, handler) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.delete(handler);
        }
    }
    
    emit(event, data) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => handler(data));
        }
    }
}

// Create singleton instance
const storageAPI = new StorageAPI();

// Expose to window
window.storageAPI = storageAPI;

module.exports = storageAPI;