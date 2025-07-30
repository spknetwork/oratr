# SPK Desktop Development Guide

## Test-Driven Development Workflow

This project follows strict TDD principles. Here's the development workflow:

### 1. Write Tests First

Before implementing any feature:
```bash
# Run tests in watch mode
npm run dev

# In another terminal, write your test
# Example: test/unit/core/feature/my-feature.test.js
```

### 2. Red Phase - Write Failing Tests
```javascript
describe('MyFeature', () => {
  test('should do something specific', () => {
    const feature = new MyFeature();
    expect(feature.doSomething()).toBe('expected result');
  });
});
```

### 3. Green Phase - Implement Minimal Code
```javascript
// src/core/feature/my-feature.js
class MyFeature {
  doSomething() {
    return 'expected result';
  }
}
```

### 4. Refactor Phase
- Improve code quality
- Extract common patterns
- Ensure all tests still pass

## Architecture Overview

### Core Modules

#### FFmpeg Module (`src/core/ffmpeg/`)
- **Transcoder**: Handles video transcoding using native FFmpeg
- **PlaylistProcessor**: Processes and rewrites M3U8 playlists
- **EncodingPresets**: Defines quality settings for each resolution

#### IPFS Module (`src/core/ipfs/`)
- **IPFSManager**: Manages local IPFS node lifecycle
- **HashGenerator**: Creates IPFS hashes without uploading
- **PinManager**: Handles file pinning strategies

#### Storage Module (`src/core/storage/`)
- **POAStorageNode**: ProofOfAccess storage node implementation
- **ProofGenerator**: Creates cryptographic proofs for stored files
- **ContractManager**: Handles storage contracts

#### SPK Module (`src/core/spk/`)
- **SPKClient**: Interfaces with SPK Network APIs
- **BrocaCalculator**: Calculates storage costs
- **AuthManager**: Handles Hive authentication

### Service Layer (`src/core/services/`)
Orchestrates core modules:
- **VideoUploadService**: Complete video upload workflow
- **StorageNodeService**: Storage node operations
- **SyncService**: Syncs with SPK Network

## Implementation Patterns

### Event-Driven Architecture
```javascript
class VideoUploadService extends EventEmitter {
  async uploadVideo(path, options) {
    this.emit('progress', { stage: 'analyzing', progress: 0 });
    // ... implementation
  }
}
```

### Error Handling
```javascript
try {
  await riskyOperation();
} catch (error) {
  if (error.code === 'ENOENT') {
    throw new FileNotFoundError(`File not found: ${path}`);
  }
  throw error;
}
```

### Async/Await Pattern
```javascript
async processVideo(path) {
  const metadata = await this.analyzeVideo(path);
  const transcoded = await this.transcode(path, metadata);
  const hashed = await this.hashFiles(transcoded);
  return hashed;
}
```

## Testing Strategy

### Unit Tests
- Test individual methods
- Mock external dependencies
- Focus on edge cases
- Achieve 100% coverage

### Integration Tests
- Test module interactions
- Use real IPFS node (in test mode)
- Verify complete workflows
- Test error recovery

### E2E Tests
- Test from user perspective
- Include Electron app lifecycle
- Verify UI interactions
- Test cross-platform behavior

## Development Commands

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:e2e

# Generate coverage report
npm run test:coverage

# Lint code
npm run lint
npm run lint:fix

# Start development
npm run dev

# Start Electron app
npm start
```

## Debugging

### Main Process
```javascript
// In main process files
const { app } = require('electron');
console.log('Debug:', app.getPath('userData'));
```

### Renderer Process
Use Chrome DevTools in Electron window

### Node Integration
```javascript
// Enable in BrowserWindow
new BrowserWindow({
  webPreferences: {
    nodeIntegration: true,
    contextIsolation: false
  }
});
```

## Performance Considerations

### Video Processing
- Use worker threads for CPU-intensive tasks
- Stream large files instead of loading into memory
- Implement progress callbacks for long operations

### IPFS Operations
- Batch small files together
- Use hash-only for verification
- Implement connection pooling
- Cache frequently accessed data

### Storage Management
- Monitor disk space before operations
- Implement cleanup strategies
- Use efficient data structures
- Compress metadata

## Security Best Practices

### Authentication
- Never store private keys in code
- Use secure storage for credentials
- Implement proper session management
- Validate all inputs

### File Handling
- Sanitize file paths
- Validate file types
- Set size limits
- Scan for malicious content

### Network Communication
- Use HTTPS/WSS only
- Verify SSL certificates
- Implement request timeouts
- Rate limit API calls

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Implement the feature
5. Ensure all tests pass
6. Update documentation
7. Submit a pull request

## Common Issues

### FFmpeg Not Found
```bash
# Install FFmpeg
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

### IPFS Connection Issues
```javascript
// Check if IPFS daemon is running
ipfs daemon

// Or use embedded node
const ipfs = await IPFS.create();
```

### Test Failures
```bash
# Clear test cache
npm test -- --clearCache

# Run with verbose output
npm test -- --verbose
```

## Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [IPFS Documentation](https://docs.ipfs.io/)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [SPK Network Docs](https://spk.network/docs)