/**
 * Storage Node Features Usage Example
 * 
 * This example demonstrates how to use the new storage node features:
 * 1. File Sync Service - Automatically syncs files from contracts
 * 2. Storage Node Tab UI - Display available contracts to join
 * 3. Integration with existing POA Storage Node
 */

const POAStorageNode = require('../core/storage/poa-storage-node');
const IPFSManager = require('../core/ipfs/ipfs-manager');
const StorageNodeIntegration = require('../core/storage/storage-node-integration');

async function main() {
  // 1. Setup core components
  const ipfsManager = new IPFSManager({
    host: '127.0.0.1',
    port: 5001,
    maxStorage: 50 * 1024 * 1024 * 1024 // 50GB limit
  });

  const poaStorageNode = new POAStorageNode({
    account: 'your-username',
    spkApiUrl: 'https://spktest.dlux.io',
    nodeType: 2, // Storage node
    maxStorage: 50 * 1024 * 1024 * 1024
  });

  // 2. Create integrated storage node with file sync
  const storageIntegration = new StorageNodeIntegration({
    poaStorageNode,
    ipfsManager,
    spkApiUrl: 'https://spktest.dlux.io',
    autoStartSync: true // Automatically start file sync when POA starts
  });

  // 3. Setup event listeners for monitoring
  setupEventListeners(storageIntegration);

  try {
    // 4. Start all services
    console.log('Starting storage node integration...');
    await storageIntegration.start();
    
    console.log('Storage node is now running!');
    console.log('- POA Storage Node: Running');
    console.log('- IPFS Manager: Running');
    console.log('- File Sync Service: Running');
    
    // 5. Create UI (in renderer process)
    if (typeof document !== 'undefined') {
      const container = document.getElementById('storage-node-container');
      if (container) {
        const storageTab = storageIntegration.createStorageNodeTab(container);
        console.log('Storage Node Tab UI created');
      }
    }

    // 6. Display status
    setInterval(() => {
      displayStatus(storageIntegration);
    }, 30000); // Update every 30 seconds

    // 7. Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down storage node...');
      await storageIntegration.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start storage node:', error);
    process.exit(1);
  }
}

function setupEventListeners(storageIntegration) {
  const { fileSyncService, poaStorageNode } = storageIntegration;

  // POA Storage Node events
  poaStorageNode.on('started', () => {
    console.log('✅ POA Storage Node started');
  });

  poaStorageNode.on('stopped', () => {
    console.log('⏹️  POA Storage Node stopped');
  });

  poaStorageNode.on('validation', (event) => {
    console.log(`🔍 Validation: ${event.cid || 'Unknown CID'}`);
  });

  poaStorageNode.on('contract-registered', (event) => {
    console.log(`📝 Contract registered: ${event.cid}`);
  });

  // File Sync Service events
  fileSyncService.on('started', () => {
    console.log('🔄 File sync service started');
  });

  fileSyncService.on('sync-complete', (result) => {
    console.log(`📋 Sync complete: ${result.contracts} contracts, ${result.newPins} new pins`);
  });

  fileSyncService.on('file-pinned', (event) => {
    console.log(`📌 Pinned: ${event.cid} (contract: ${event.contractId})`);
  });

  fileSyncService.on('file-unpinned', (event) => {
    console.log(`📌 Unpinned: ${event.cid}`);
  });

  fileSyncService.on('error', (error) => {
    console.error('❌ File sync error:', error.message);
  });
}

function displayStatus(storageIntegration) {
  const status = storageIntegration.getStatus();
  const syncStats = storageIntegration.getSyncStats();

  console.log('\n=== Storage Node Status ===');
  console.log(`POA Node: ${status.poaStorageNode.running ? '🟢 Running' : '🔴 Stopped'}`);
  console.log(`IPFS: ${status.ipfsManager.running ? '🟢 Running' : '🔴 Stopped'}`);
  console.log(`File Sync: ${status.fileSyncService.running ? '🟢 Active' : '🔴 Inactive'}`);
  console.log(`Account: ${status.poaStorageNode.account}`);
  console.log(`Pinned Files: ${status.fileSyncService.totalPinned}`);
  console.log(`Contracts: ${syncStats.totalContracts}`);
  console.log(`Sync Count: ${syncStats.syncCount}`);
  console.log(`Last Sync: ${status.fileSyncService.lastSync || 'Never'}`);
  console.log('========================\n');
}

// Manual operations examples
async function manualOperations(storageIntegration) {
  try {
    // Force immediate sync
    console.log('Forcing sync...');
    await storageIntegration.forceSync();
    console.log('Sync completed');

    // Get detailed statistics
    const stats = storageIntegration.getSyncStats();
    console.log('Sync Statistics:', stats);

    // Update configuration
    storageIntegration.updateConfig({
      spkApiUrl: 'https://spk.dlux.io' // Switch to mainnet
    });

  } catch (error) {
    console.error('Manual operation failed:', error);
  }
}

// Export for use in other modules
module.exports = {
  StorageNodeIntegration,
  setupEventListeners,
  displayStatus,
  manualOperations
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}