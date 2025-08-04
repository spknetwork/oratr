// Jest setup file

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.SPK_API_URL = 'https://spktest.dlux.io';
process.env.IPFS_API_URL = 'http://localhost:5001';

// Mock dynamic imports for ES modules
jest.mock('kubo-rpc-client', () => ({
  create: jest.fn(() => Promise.resolve({
    add: jest.fn(),
    get: jest.fn(),
    pin: { add: jest.fn(), rm: jest.fn(), ls: jest.fn() },
    id: jest.fn(() => Promise.resolve({ id: 'test-peer-id' })),
    stop: jest.fn()
  }))
}));

jest.mock('ipfs-only-hash', () => ({
  of: jest.fn(() => Promise.resolve('QmTestHash123'))
}));

// Mock electron for tests
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((name) => `/tmp/test-${name}`),
    getVersion: jest.fn(() => '1.0.0'),
    getName: jest.fn(() => 'spk-desktop-test')
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeHandler: jest.fn()
  },
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
    sendSync: jest.fn(() => ({})) // Mock for electron-store
  },
  BrowserWindow: jest.fn(() => ({
    loadFile: jest.fn(),
    webContents: {
      send: jest.fn()
    }
  }))
}));

// Global test helpers
global.testHelpers = {
  // Create a mock video file buffer
  createMockVideoBuffer: (size = 1024 * 1024) => {
    return Buffer.alloc(size, 'video-data');
  },
  
  // Create a mock M3U8 playlist
  createMockPlaylist: (segments = 3) => {
    let playlist = '#EXTM3U\\n#EXT-X-VERSION:3\\n#EXT-X-TARGETDURATION:10\\n';
    for (let i = 0; i < segments; i++) {
      playlist += `#EXTINF:10.0,\\nsegment_${i.toString().padStart(3, '0')}.ts\\n`;
    }
    playlist += '#EXT-X-ENDLIST';
    return playlist;
  },
  
  // Create a mock IPFS CID
  createMockCID: (prefix = 'Qm') => {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let cid = prefix;
    for (let i = 0; i < 44; i++) {
      cid += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return cid;
  }
};

// Increase timeout for integration tests
if (process.env.TEST_TYPE === 'integration') {
  jest.setTimeout(60000);
}

// Clean up after tests
afterAll(async () => {
  // Clean up any test files
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    await fs.rmdir(path.join('/tmp', 'test-userData'), { recursive: true });
    await fs.rmdir(path.join('/tmp', 'test-temp'), { recursive: true });
  } catch (error) {
    // Ignore cleanup errors
  }
});