# Migration to SPK-JS Integration

## Overview
This document describes the migration from the custom SPK client implementation to using the official `@disregardfiat/spk-js` library.

## Changes Made

### 1. New Keychain Adapter
- **File**: `src/core/spk/keychain-adapter.js`
- Bridges spk-desktop's AccountManager with spk-js's custom signer interface
- Implements all required methods for authentication

### 2. Updated Video Upload Service
- **File**: `src/core/services/video-upload-service-v2.js`
- Complete rewrite using spk-js for uploads
- Maintains all existing features (transcoding, thumbnails, progress tracking)
- Uses spk-js batch upload for efficient multi-file uploads

### 3. File API Polyfill
- **File**: `src/core/utils/file-polyfill.js`
- Provides File and Blob classes in Node.js environment
- Required for spk-js which expects browser File API

### 4. New Service Initialization
- **File**: `src/main/services/init-services.js`
- Sets up all services with proper dependencies
- Loads File polyfill before initializing services

### 5. Updated IPC Handlers
- **File**: `src/main/ipc/upload-handlers.js`
- Connects renderer process to the new upload service
- Handles authentication checks
- Provides cost calculation using spk-js BROCA calculator

### 6. New Main Process
- **File**: `src/main/index-v2.js`
- Updated to use the new service initialization
- Implements mock SPK network queries (to be replaced with real API calls)

### 7. Renderer Upload Handler
- **File**: `src/renderer/spk-upload-handler.js`
- New upload handler for the renderer process
- Handles both raw video and pre-processed file uploads

## Migration Steps

1. **Update package.json**:
   ```json
   {
     "main": "src/main/index-v2.js"
   }
   ```

2. **Update renderer HTML** to include the new upload handler:
   ```html
   <script src="spk-upload-handler.js"></script>
   ```

3. **Update video processing script** to use the new handler:
   ```javascript
   // Replace old upload code with:
   const uploader = new SPKUploadHandler();
   const result = await uploader.startUpload(ipfsReadyFiles, {
     title: 'My Video',
     duration: 30,
     onLog: (log) => addUploadLog(log.message, log.type),
     onProgress: (progress) => updateProgress(progress.percent)
   });
   ```

## Key Differences

### Authentication
- Old: Custom SPKClientWrapper with built-in account management
- New: SPKKeychainAdapter that wraps AccountManager for spk-js

### Upload Flow
- Old: Direct API calls to storage providers
- New: spk-js handles all SPK network communication

### File Handling
- Old: Buffer-based file handling
- New: File API compatible with browser standards

## Benefits

1. **Standardization**: Uses official SPK network library
2. **Maintenance**: Updates come from spk-js upstream
3. **Compatibility**: Works with all SPK network features
4. **Security**: Battle-tested authentication flow

## Testing

Run the integration tests:
```bash
npm test test/integration/spk-upload-integration.test.js
```

## Rollback

If needed, revert to the old implementation:
1. Change package.json main back to `src/main/index.js`
2. Remove the new files listed above
3. Restart the application

## Next Steps

1. Implement real SPK network API calls in place of mocks
2. Add comprehensive error handling for network failures
3. Implement storage provider selection UI
4. Add upload resumption support
5. Integrate with SPK network governance features