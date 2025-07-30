# Migration to SPK-JS Library

## Overview

This document outlines the migration from the duplicate SPK client implementation in spk-desktop to using the centralized spk-js library.

## Changes Made

### 1. Added spk-js Dependency
- Updated `package.json` to include `spk-js` as a local dependency
- Points to `../spk-js` for development

### 2. Created SPKClientWrapper
- New file: `src/core/spk/spk-client-wrapper.js`
- Wraps spk-js functionality for desktop-specific needs
- Handles desktop account management integration
- Provides IPC handlers for renderer process

### 3. Updated Main Process
- Modified `src/main/index.js` to use SPKClientWrapper
- Removed reference to old SPKClient implementation

### 4. Updated Video Upload Service
- Modified to use wrapper methods instead of direct SPK client
- Simplified BROCA calculation calls
- Uses wrapper's directUpload method

## Migration Steps for Remaining Code

### 1. Remove Duplicate Implementation
```bash
# After testing, remove the old implementation
rm src/core/spk/spk-client.js
```

### 2. Update All References
Search and replace all instances of:
- `SPKClient` → `SPKClientWrapper`
- `this.spkClient.broca.*` → `this.spkClient.calculateBrocaCost()`
- `this.spkClient.spkInstance.file` → Use wrapper methods

### 3. Update IPC Handlers
All renderer process calls should use the new IPC channels:
- `spk:upload` - For file uploads
- `spk:direct-upload` - For direct uploads
- `spk:get-network-stats` - For network statistics
- `spk:calculate-broca` - For BROCA calculations

### 4. Test Upload Flow
The upload flow now uses the fixed spk-js implementation:
1. Authorization step with `/upload-authorize`
2. Proper FormData chunk uploads
3. Correct header handling

## Benefits

1. **Single Source of Truth**: All SPK network logic in spk-js
2. **Consistent Upload Handling**: Uses the working pattern from dlux-iov
3. **Easier Maintenance**: Updates to SPK logic only need to happen in spk-js
4. **Better Testing**: Can test SPK functionality independently

## Next Steps

1. Run `npm install` in spk-desktop to link spk-js
2. Test the upload functionality with the new implementation
3. Remove the old spk-client.js file after confirming everything works
4. Update any remaining code that references the old client

## Known Issues Fixed

- "Bad chunk provided" error - Fixed by using proper upload authorization flow
- Content-Range header issues - Fixed by using FormData for multipart uploads
- Missing contract data - Fixed by passing contract through upload chain