# SPK-JS Integration Fixes

## Issues Fixed

1. **Import Path**: Changed from local file path to npm package
   - Old: `require('../../../../spk-js/src/index.js')`
   - New: `require('@disregardfiat/spk-js')`

2. **SPK Constructor**: Updated to match new API
   - Old: `new SPK({ account: username, baseURL: node })`
   - New: `new SPK(username, { node: node })`

3. **Init Method**: Added initialization call after creating SPK instance
   - Now calls `await spkInstance.init()` to properly initialize the account

4. **Method Updates**:
   - `spkInstance.file.listFiles()` → `spkInstance.listFiles()`
   - `spkInstance.file.listContracts()` → `spkInstance.listContracts()`
   - `spkInstance.file.renewContract()` → `spkInstance.renewContract()`

5. **BROCA Calculation**: Updated to use BrocaCalculator from spk-js
   - Import: `const { BrocaCalculator } = require('@disregardfiat/spk-js')`
   - Calculate available: `BrocaCalculator.available(account)`

6. **Electron Sandbox**: Added `--no-sandbox` flag to start script
   - Fixes the chrome-sandbox permission error on Linux

## Remaining Features

The desktop app maintains its own implementations for:
- `calculateBrocaCost()` - Uses network stats for accurate calculation
- Provider selection is now handled internally by spk-js
- `getNetworkStats()` - Fetches from SPK node API
- `createStorageContract()` - Custom implementation with signing
- `uploadToPublicNode()` - Handles file upload with progress

These are appropriate as they're desktop-specific features that integrate with the account manager and IPC system.

## Testing

To test the integration:
1. Run `npm start` in the spk-desktop directory
2. Add an account
3. Try uploading a video file
4. Check that BROCA calculation works
5. Verify storage provider selection works