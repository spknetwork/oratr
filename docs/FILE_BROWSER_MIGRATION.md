# File Browser Migration Guide

## Overview

The SPK Desktop file browser has been enhanced to use the new spk-js filesystem wrapper with Honeygraph integration. This provides:

- **Enhanced Search**: Full-text search with tag and metadata support
- **Better Performance**: Caching and optimized queries via Honeygraph
- **Richer Metadata**: Tags, file providers, detailed statistics
- **Automatic Fallback**: Seamless fallback to SPK API when Honeygraph is unavailable
- **New Features**: Advanced filtering, file details panel, provider information

## Migration Steps

### 1. Update Your Renderer

Replace the old file browser import with the new enhanced version:

```javascript
// Old
import './components/spk-drive-integration.js';

// New
import './components/spk-drive-integration-v2.js';
```

### 2. Update HTML Structure

If you have custom HTML, ensure the drive tab has the correct ID:

```html
<div id="drive-tab" class="tab-content">
  <!-- Drive content will be rendered here -->
</div>
```

### 3. Initialize with SPK Instance

The new file browser requires a proper SPK instance with Honeygraph configuration:

```javascript
// The enhanced drive will automatically initialize SPK with:
const spk = new SPK(username, {
    node: 'https://spkinstant.hivehoneycomb.com',
    honeygraphUrl: 'https://honeygraph.dlux.io',
    enableHoneygraphCache: true,
    honeygraphCacheTTL: 300000 // 5 minutes
});
```

### 4. New Features Available

#### API Status Indicator
Shows whether Honeygraph is connected or using fallback:
- 🟢 Honeygraph Connected - Full features available
- 🟠 SPK API (Fallback) - Basic features only

#### Enhanced Search
- Search by file name, tags, or content type
- Advanced filters for size, type, and recent uploads
- Search results grouped by folder

#### File Details Panel
Right-click → Details to see:
- Full metadata
- Storage providers and their status
- Tags and labels
- Contract information

#### Tag Management
- Add tags to files for better organization
- Search by tags using the enhanced search
- Tags are stored in file metadata

#### Better Upload Experience
- Uses spk-js upload with progress tracking
- Automatic BROCA calculation
- Support for batch uploads with metadata

## Backward Compatibility

The enhanced file browser maintains backward compatibility:

1. **Fallback Mode**: When Honeygraph is unavailable, it automatically falls back to the original SPK API
2. **Data Format**: All existing file data is preserved and compatible
3. **UI Compatibility**: The UI maintains the same structure and styling

## Configuration Options

### Enable/Disable Caching

```javascript
// Disable cache for real-time updates
driveInstance.cacheEnabled = false;

// Set custom cache expiry (ms)
driveInstance.cacheExpiry = 600000; // 10 minutes
```

### Check Honeygraph Availability

```javascript
const isAvailable = await driveInstance.checkHoneygraphAvailability();
console.log('Honeygraph available:', isAvailable);
```

### Force Refresh

```javascript
// Clear cache and reload
driveInstance.cacheEnabled = false;
await driveInstance.loadDrive();
driveInstance.cacheEnabled = true;
```

## API Differences

### Search

**Old API** (local search only):
```javascript
const results = driveInstance.searchFiles(query, { folder: currentPath });
```

**New API** (Honeygraph + local):
```javascript
const results = await driveInstance.searchFiles(query, {
    folder: currentPath,
    type: 'video',
    tags: ['tutorial', 'spk'],
    filters: {
        minSize: 1024 * 1024, // 1MB
        maxSize: 1024 * 1024 * 100 // 100MB
    }
});
```

### File Metadata

**Old API**:
```javascript
const file = driveInstance.files.get(cid);
// Basic metadata only
```

**New API**:
```javascript
const metadata = await driveInstance.getFileMetadata(cid);
// Enhanced metadata including:
// - Storage providers
// - View counts
// - Related files
// - Full tag list
```

### Storage Statistics

**Old API**:
```javascript
const stats = driveInstance.getStorageStats();
// Basic size calculations
```

**New API**:
```javascript
const stats = await driveInstance.getStorageStats();
// Includes:
// - Accurate BROCA balance
// - Real storage capacity
// - Network-based calculations
// - API source indicator
```

## Troubleshooting

### Honeygraph Connection Issues

If you see "SPK API (Fallback)" status:

1. Check if Honeygraph is accessible:
   ```javascript
   fetch('https://honeygraph.dlux.io/health')
     .then(res => res.json())
     .then(console.log);
   ```

2. The system will automatically retry every minute

3. All features still work in fallback mode, just without enhanced search and metadata

### Upload Failures

If uploads fail:

1. Check BROCA balance:
   ```javascript
   const balances = await spkInstance.getBalances();
   console.log('BROCA:', balances.broca);
   ```

2. Verify storage providers are available:
   ```javascript
   const providers = await spkInstance.getHealthyStorageProviders(fileSize);
   console.log('Available providers:', providers.length);
   ```

### Performance Issues

If the file browser is slow:

1. Enable caching (default):
   ```javascript
   driveInstance.cacheEnabled = true;
   ```

2. Increase cache TTL:
   ```javascript
   driveInstance.cacheExpiry = 600000; // 10 minutes
   ```

3. Limit search results:
   ```javascript
   const results = await driveInstance.searchFiles(query, { limit: 50 });
   ```

## Migration Checklist

- [ ] Update imports to use `spk-drive-integration-v2.js`
- [ ] Verify HTML structure has correct IDs
- [ ] Test file upload functionality
- [ ] Verify search works correctly
- [ ] Check that existing files are displayed
- [ ] Test drag-and-drop functionality
- [ ] Verify context menu actions work
- [ ] Check API status indicator shows correct state
- [ ] Test fallback mode by blocking Honeygraph URL
- [ ] Verify all file operations work in both modes

## Future Enhancements

The following features are planned:

1. **On-chain Metadata Updates**: Currently, metadata changes are local only
2. **Contract Management**: Renew/cancel contracts from the UI
3. **Sharing & Permissions**: Advanced file sharing capabilities
4. **Folder Sync**: Sync local folders with SPK Drive
5. **Offline Mode**: Work with cached data when offline

## Support

If you encounter issues:

1. Check the browser console for errors
2. Verify SPK node connectivity
3. Ensure you have sufficient BROCA for operations
4. Try refreshing the drive (refresh button)
5. Clear cache and reload if necessary

For more help, see the SPK Desktop documentation or file an issue on GitHub.