const { ipcMain } = require('electron');
const StorageNodeManager = require('../../core/storage/storage-node-manager');

let storageNodeManager = null;

/**
 * Initialize storage node service IPC handlers
 */
function initStorageNodeService(accountManager) {
    // Create storage node manager
    storageNodeManager = new StorageNodeManager(accountManager, {
        node: process.env.SPK_NODE || 'https://spktest.dlux.io',
        honeygraphUrl: process.env.HONEYGRAPH_URL || 'https://honeygraph.dlux.io'
    });
    
    // Register IPC handlers
    
    // Node management - FAST startup check
    ipcMain.handle('storage:check-status', async () => {
        try {
            // First do a fast local check
            const fastStatus = await storageNodeManager.getFastStatus();
            
            // If we have a local process running, return immediately
            if (fastStatus.quickCheck) {
                // Do the full check in background
                setImmediate(async () => {
                    try {
                        await storageNodeManager.checkNodeStatus();
                    } catch (error) {
                        console.error('Background registration check failed:', error);
                    }
                });
                
                return fastStatus;
            }
            
            // Otherwise do full check
            return await storageNodeManager.checkNodeStatus();
        } catch (error) {
            console.error('Failed to check node status:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:register-node', async (event, { ipfsId, domain, bidRate }) => {
        try {
            return await storageNodeManager.registerNode(ipfsId, domain, bidRate);
        } catch (error) {
            console.error('Failed to register node:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:register-authority', async (event, pubKey) => {
        try {
            return await storageNodeManager.registerAuthority(pubKey);
        } catch (error) {
            console.error('Failed to register authority:', error);
            throw error;
        }
    });
    
    // Contract management
    ipcMain.handle('storage:get-available-contracts', async (event, limit) => {
        try {
            return await storageNodeManager.getAvailableContracts(limit);
        } catch (error) {
            console.error('Failed to get available contracts:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:get-stored-contracts', async () => {
        try {
            return await storageNodeManager.getStoredContracts();
        } catch (error) {
            console.error('Failed to get stored contracts:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:store-files', async (event, contractIds) => {
        try {
            return await storageNodeManager.storeFiles(contractIds);
        } catch (error) {
            console.error('Failed to store files:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:remove-files', async (event, contractIds) => {
        try {
            return await storageNodeManager.removeFiles(contractIds);
        } catch (error) {
            console.error('Failed to remove files:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:batch-store', async (event, { contractIds, chunkSize }) => {
        try {
            return await storageNodeManager.batchStore(contractIds, chunkSize);
        } catch (error) {
            console.error('Failed to batch store:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:extend-contract', async (event, { contractId, fileOwner, brocaAmount, power }) => {
        try {
            return await storageNodeManager.extendContract(contractId, fileOwner, brocaAmount, power);
        } catch (error) {
            console.error('Failed to extend contract:', error);
            throw error;
        }
    });
    
    // Search and discovery
    ipcMain.handle('storage:search-files', async (event, options) => {
        try {
            return await storageNodeManager.searchFiles(options);
        } catch (error) {
            console.error('Failed to search files:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:get-files-by-tags', async (event, { tags, logic }) => {
        try {
            return await storageNodeManager.getFilesByTags(tags, logic);
        } catch (error) {
            console.error('Failed to get files by tags:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:get-recent-files', async (event, limit) => {
        try {
            return await storageNodeManager.getRecentFiles(limit);
        } catch (error) {
            console.error('Failed to get recent files:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:find-opportunities', async (event, filters) => {
        try {
            return await storageNodeManager.findStorageOpportunities(filters);
        } catch (error) {
            console.error('Failed to find opportunities:', error);
            throw error;
        }
    });
    
    // Statistics and monitoring
    ipcMain.handle('storage:get-node-stats', async () => {
        try {
            return await storageNodeManager.getNodeStats();
        } catch (error) {
            console.error('Failed to get node stats:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:get-expiring-contracts', async (event, days) => {
        try {
            return await storageNodeManager.getExpiringContracts(days);
        } catch (error) {
            console.error('Failed to get expiring contracts:', error);
            throw error;
        }
    });
    
    ipcMain.handle('storage:calculate-roi', async (event, { storageCapacity, bidRate }) => {
        try {
            return await storageNodeManager.calculateStorageROI(storageCapacity, bidRate);
        } catch (error) {
            console.error('Failed to calculate ROI:', error);
            throw error;
        }
    });
    
    // Forward events to renderer
    storageNodeManager.on('status-updated', (status) => {
        global.mainWindow?.webContents.send('storage:status-updated', status);
    });
    
    storageNodeManager.on('contracts-updated', (contracts) => {
        global.mainWindow?.webContents.send('storage:contracts-updated', contracts);
    });
    
    storageNodeManager.on('files-stored', (result) => {
        global.mainWindow?.webContents.send('storage:files-stored', result);
    });
    
    storageNodeManager.on('files-removed', (result) => {
        global.mainWindow?.webContents.send('storage:files-removed', result);
    });
    
    return storageNodeManager;
}

/**
 * Get the storage node manager instance
 */
function getStorageNodeManager() {
    return storageNodeManager;
}

module.exports = {
    initStorageNodeService,
    getStorageNodeManager
};