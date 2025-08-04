# Storage Node Features

## Overview

SPK Desktop now includes comprehensive storage node management features that integrate with the existing POA (Proof of Access) Storage Node. The new features provide automated file synchronization and a user interface for managing storage contracts:

- **Automated File Sync** - Automatically sync files from SPK contracts
- **Storage Contract Management** - View and join available storage contracts
- **IPFS Integration** - Automatic pinning and unpinning of contract files
- **Real-time Monitoring** - Live status updates and notifications
- **POA Integration** - Seamless integration with existing storage infrastructure

## Key Features

### 1. File Sync Service (`src/core/storage/file-sync-service.js`)

The File Sync Service automatically polls the SPK network for contracts that the storage node should be storing and ensures IPFS pins are synchronized:

- Polls `/api/spk/contracts/stored-by/{username}` endpoint
- Automatically pins files for contracts the node should store
- Unpins files for expired contracts
- Retries failed operations with exponential backoff
- Integrates with storage node lifecycle events

### 2. Storage Node Tab UI (`src/renderer/components/storage-node-tab.js`)

A web-based UI component that displays available storage contracts for the node to join:

- Fetches understored contracts from `/api/spk/contracts/understored`
- Filters out contracts already stored by the current node
- Displays contract details (size, reward, duration, CID)
- Allows joining contracts with confirmation
- Real-time updates from storage node and sync service
- Search and filtering capabilities

### 3. Storage Node Integration (`src/core/storage/storage-node-integration.js`)

Coordinates between the POA Storage Node, File Sync Service, and UI components:

- Manages service lifecycle coordination
- Event forwarding between components
- Centralized configuration management
- Status aggregation
- Resource cleanup

## Usage

### Getting Started

1. **Start the Integrated Storage Node**:
   ```javascript
   const storageIntegration = new StorageNodeIntegration({
     poaStorageNode: poaStorageNode,
     ipfsManager: ipfsManager,
     spkApiUrl: 'https://spktest.dlux.io',
     autoStartSync: true
   });
   
   await storageIntegration.start();
   ```

2. **Create the Storage Node Tab UI**:
   ```javascript
   const container = document.getElementById('storage-node-container');
   const storageTab = storageIntegration.createStorageNodeTab(container);
   storageTab.render();
   ```

3. **Monitor and Join Contracts**:
   - View available contracts in the Storage Node tab
   - Filter contracts by size, reward, or urgency
   - Click "Join Contract" to start storing files
   - Monitor sync status and pinned files

### API Usage

The core services can be used programmatically:

```javascript
// File Sync Service
const fileSyncService = new FileSyncService({
  username: 'your-username',
  spkApiUrl: 'https://spktest.dlux.io',
  ipfsManager: ipfsManager,
  syncInterval: 5 * 60 * 1000 // 5 minutes
});

await fileSyncService.start();

// Force immediate sync
await fileSyncService.forceSync();

// Get statistics
const stats = fileSyncService.getStats();
console.log(`Pinned ${stats.totalPinned} files from ${stats.totalContracts} contracts`);
```

## Architecture

### Component Integration

```
POA Storage Node ←→ Storage Node Integration ←→ File Sync Service
                            ↓                        ↓
                    Storage Node Tab UI          IPFS Manager
                            ↓                        ↓
                      User Interface           File Pinning
```

### Event Flow

1. **POA Storage Node** emits lifecycle events (`started`, `stopped`, `validation`)
2. **Storage Node Integration** forwards events to File Sync Service
3. **File Sync Service** polls contracts and manages IPFS pins
4. **Storage Node Tab UI** displays real-time status and available contracts
5. **User interactions** trigger contract joining and immediate syncing

### API Endpoints

- **Get Stored Contracts**: `/api/spk/contracts/stored-by/{username}`
- **Get Understored Contracts**: `/api/spk/contracts/understored`
- **Join Contract**: `/api/spk/contracts/join`

## Benefits

1. **Automated Management**: Files are automatically synced without manual intervention
2. **Real-time Updates**: Live status updates and notifications
3. **Efficient Storage**: Only pins files from active contracts
4. **Easy Discovery**: UI shows available contracts with filtering
5. **POA Integration**: Works seamlessly with existing storage infrastructure
6. **Error Recovery**: Automatic retries and graceful error handling

## Testing

Comprehensive test suite following TDD approach:

```bash
# Run all storage node feature tests
npm test -- --testPathPattern="file-sync-service|storage-node-tab|storage-node-integration"

# Run specific component tests
npm test -- test/unit/core/storage/file-sync-service.test.js
npm test -- test/unit/renderer/components/storage-node-tab.test.js
npm test -- test/unit/core/storage/storage-node-integration.test.js
```

## Example Usage

See `/src/examples/storage-node-usage.js` for a complete working example that demonstrates:

- Setting up the integrated storage node
- Event handling and monitoring
- UI component creation
- Manual operations and troubleshooting

## Future Enhancements

- **Advanced Contract Selection**: AI-powered contract recommendation
- **Storage Optimization**: Intelligent space management and cleanup
- **Performance Analytics**: Detailed metrics and reporting
- **Batch Operations**: Join multiple contracts simultaneously
- **Mobile Support**: Mobile-friendly UI components
- **Backup Integration**: Integration with backup and recovery systems