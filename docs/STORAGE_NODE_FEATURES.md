# Storage Node Features

## Overview

SPK Desktop now includes comprehensive storage node management features powered by the new spk-js storage operations. This allows desktop users to:

- **Register as a storage provider** on the SPK Network
- **Browse network files** to find storage opportunities
- **Store files** to earn rewards
- **Manage contracts** and monitor earnings
- **Search and filter** files on the network

## Key Features

### 1. Storage Node Management

The Storage Node Manager (`src/core/storage/storage-node-manager.js`) wraps all spk-js storage operations:

- Node registration and status checking
- Contract storage and removal
- Batch operations for efficiency
- Real-time earnings calculation
- Expiring contract monitoring

### 2. Network File Browser

The Network Browser component (`src/renderer/components/network-browser.js`) provides a visual interface for:

- **Storage Opportunities**: Find under-replicated files that need storage
- **Search Files**: Search by name, tag, or owner
- **Recent Uploads**: Browse recently uploaded files
- **Bulk Operations**: Select and store multiple files at once

### 3. Integration with Honeygraph API

Uses the Honeygraph API for enhanced features:

- Fast file searching and filtering
- Real-time storage statistics
- Network topology visualization
- Market data for earnings optimization

## Usage

### Getting Started

1. **Register Your Node**:
   - Go to the Storage Node tab
   - Click "Register Storage Node"
   - Enter your IPFS ID and optional domain
   - Pay the registration fee (2000 BROCA)

2. **Browse Storage Opportunities**:
   - The Network Browser shows files needing storage
   - Filter by size, earnings potential, or expiry time
   - Select files to store

3. **Store Files**:
   - Click "Store" on individual files
   - Or select multiple files and click "Store Selected"
   - Monitor your earnings in the storage statistics

### API Usage

The storage API is accessible via `window.storageAPI`:

```javascript
// Check node status
const status = await window.storageAPI.checkNodeStatus();

// Get available contracts
const contracts = await window.storageAPI.getAvailableContracts(100);

// Store files
const result = await window.storageAPI.storeFiles(['contract1', 'contract2']);

// Get your stored contracts
const stored = await window.storageAPI.getStoredContracts();

// Calculate ROI
const roi = await window.storageAPI.calculateROI(
    100 * 1024 * 1024 * 1024, // 100GB capacity
    500 // bid rate
);
```

## Architecture

### Main Process Services

- **StorageNodeService**: IPC handlers for all storage operations
- **StorageNodeManager**: Core business logic using spk-js

### Renderer Process

- **StorageAPI**: Client-side API wrapper
- **NetworkBrowser**: React-like component for file browsing
- **Integration**: Seamless integration with existing POA storage node

### Data Flow

```
User Action → Renderer API → IPC → Main Process Service → spk-js → SPK Network
                ↓                          ↓
            UI Update ← Event ← Storage Node Manager
```

## Benefits

1. **Earn Rewards**: Store files to earn BROCA tokens
2. **Help the Network**: Provide redundancy for important files
3. **Easy Management**: Visual interface for all operations
4. **Efficient Operations**: Batch processing for multiple files
5. **Real-time Monitoring**: Track earnings and contract status

## Future Enhancements

- Automatic file selection based on profitability
- Storage space management and limits
- Advanced filtering and sorting options
- Integration with POA for automatic validation
- Earnings history and analytics