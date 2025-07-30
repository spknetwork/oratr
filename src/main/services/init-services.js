/**
 * Initialize core services for the main process
 */

// Polyfill File API for Node.js
require('../../core/utils/file-polyfill');

const AccountManager = require('../../core/spk/account-manager');
const Transcoder = require('../../core/ffmpeg/transcoder');
const PlaylistProcessor = require('../../core/ffmpeg/playlist-processor');
const IPFSManager = require('../../core/ipfs/ipfs-manager');
const VideoUploadServiceV2 = require('../../core/services/video-upload-service-v2');
const IntegratedStorage = require('../../core/services/integrated-storage-service');
const DirectUploadService = require('../../core/services/direct-upload-service');
const { app } = require('electron');
const path = require('path');
const poaService = require('./poa-service');
const { initStorageNodeService } = require('./storage-node-service');

let services = null;

/**
 * Initialize all services
 */
async function initializeServices() {
  if (services) {
    return services;
  }

  // Get app data directory
  const appDataPath = app.getPath('userData');

  // Initialize account manager
  const accountManager = new AccountManager({
    storagePath: path.join(appDataPath, 'accounts'),
    appName: 'SPK Desktop'
  });

  // Initialize IPFS manager
  const ipfsManager = new IPFSManager({
    repoPath: path.join(appDataPath, 'ipfs'),
    config: {
      Bootstrap: [],
      Addresses: {
        Swarm: [
          '/ip4/0.0.0.0/tcp/0',
          '/ip6/::/tcp/0'
        ],
        API: '/ip4/127.0.0.1/tcp/0',
        Gateway: '/ip4/127.0.0.1/tcp/0'
      }
    }
  });

  // Initialize transcoder
  const transcoder = new Transcoder({
    ffmpegPath: 'ffmpeg', // Will use system ffmpeg or bundled one
    tempDir: path.join(appDataPath, 'temp')
  });

  // Initialize playlist processor
  const playlistProcessor = new PlaylistProcessor();

  // Note: POA Storage Node is initialized separately via IPC handlers
  // For now, create a stub integrated storage that doesn't depend on POA
  const integratedStorage = new IntegratedStorage({
    ipfsManager,
    poaStorageNode: null, // Will be set later when POA is initialized
    spkClient: null, // Will be set later
    videoUploadService: null // Will be set later
  });

  // Initialize video upload service with spk-js integration
  const videoUploadService = new VideoUploadServiceV2({
    transcoder,
    playlistProcessor,
    ipfsManager,
    accountManager,
    integratedStorage
  });

  // Start IPFS if needed
  try {
    await ipfsManager.start();
  } catch (error) {
    console.error('Failed to start IPFS:', error);
    // IPFS is optional, continue without it
  }
  
  // Initialize POA service (but don't start it automatically)
  try {
    await poaService.initialize({
      ipfsHost: '127.0.0.1',
      ipfsPort: 5001,
      dataPath: path.join(appDataPath, 'poa-data'),
      spkApiUrl: 'https://spktest.dlux.io'
    });
  } catch (error) {
    console.error('Failed to initialize POA service:', error);
    // POA is optional, continue without it
  }

  // Initialize storage node service
  const storageNodeService = initStorageNodeService(accountManager);

  // Initialize direct upload service
  const directUploadService = new DirectUploadService({
    ipfsManager,
    spkClient: null // Will be set when account is active
  });

  services = {
    accountManager,
    ipfsManager,
    transcoder,
    playlistProcessor,
    integratedStorage,
    videoUploadService,
    poaService,
    storageNodeService,
    directUploadService
  };

  return services;
}

/**
 * Get initialized services
 */
function getServices() {
  if (!services) {
    throw new Error('Services not initialized');
  }
  return services;
}

/**
 * Shutdown all services
 */
async function shutdownServices() {
  if (!services) {
    return;
  }

  try {
    // Stop IPFS
    if (services.ipfsManager) {
      await services.ipfsManager.stop();
    }

    // Stop integrated storage
    if (services.integratedStorage) {
      await services.integratedStorage.stop();
    }

    // Clear session for account manager
    if (services.accountManager) {
      services.accountManager.clearSession();
    }
    
    // Stop POA if running
    if (services.poaService) {
      await poaService.cleanup();
    }

    services = null;
  } catch (error) {
    console.error('Error shutting down services:', error);
  }
}

module.exports = {
  initializeServices,
  getServices,
  shutdownServices
};