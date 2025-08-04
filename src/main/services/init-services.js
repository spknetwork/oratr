/**
 * Initialize core services for the main process
 */

// Polyfill File API for Node.js
require('../../core/utils/file-polyfill');

const AccountManager = require('../../core/spk/account-manager');
const Transcoder = require('../../core/ffmpeg/transcoder');
const PlaylistProcessor = require('../../core/ffmpeg/playlist-processor');
const IPFSManager = require('../../core/ipfs/ipfs-manager');
const VideoUploadService = require('../../core/services/video-upload-service');
const IntegratedStorage = require('../../core/services/integrated-storage-service');
const DirectUploadService = require('../../core/services/direct-upload-service');
const PendingUploadsManager = require('../../core/services/pending-uploads-manager');
const { app } = require('electron');
const path = require('path');
const poaService = require('./poa-service');
const { initStorageNodeService } = require('./storage-node-service');

let services = null;

/**
 * Check pending uploads on startup and verify CIDs exist in IPFS
 */
async function checkPendingUploadsOnStartup(pendingUploadsManager, ipfsManager, directUploadService) {
  try {
    console.log('🔍 [Startup] Checking for pending uploads...');
    
    const pendingUploads = await pendingUploadsManager.getPendingUploads();
    const uploadingUploads = pendingUploads.filter(upload => upload.status === 'uploading');
    
    if (uploadingUploads.length === 0) {
      console.log('✅ [Startup] No pending uploads found');
      return;
    }
    
    console.log(`📋 [Startup] Found ${uploadingUploads.length} pending uploads to verify`);
    
    for (const upload of uploadingUploads) {
      try {
        console.log(`🔍 [Startup] Checking upload: ${upload.id}`);
        
        if (!upload.cids || upload.cids.length === 0) {
          console.log(`⚠️ [Startup] Upload ${upload.id} has no CIDs, marking as failed`);
          await pendingUploadsManager.updateUploadStatus(upload.id, 'failed', {
            error: 'No CIDs found for upload',
            failedAt: new Date().toISOString()
          });
          continue;
        }
        
        // Check if all CIDs exist in our IPFS node
        let missingCIDs = 0;
        let existingCIDs = 0;
        
        for (const cid of upload.cids) {
          try {
            // Check if CID exists in our IPFS node by trying to get it
            await ipfsManager.getFile(cid);
            existingCIDs++;
            console.log(`✅ [Startup] Found CID in IPFS: ${cid}`);
          } catch (error) {
            missingCIDs++;
            console.log(`❌ [Startup] Missing CID in IPFS: ${cid} - ${error.message}`);
          }
        }
        
        console.log(`📊 [Startup] Upload ${upload.id}: ${existingCIDs} existing, ${missingCIDs} missing CIDs`);
        
        if (missingCIDs > 0) {
          // Some files are missing from IPFS - mark as failed
          await pendingUploadsManager.updateUploadStatus(upload.id, 'failed', {
            error: `Missing ${missingCIDs} files from IPFS node`,
            failedAt: new Date().toISOString()
          });
          console.log(`❌ [Startup] Upload ${upload.id} marked as failed - missing files`);
        } else {
          // All files exist in IPFS - we can continue the upload
          console.log(`✅ [Startup] Upload ${upload.id} has all files in IPFS - can be resumed`);
          console.log(`💡 [Startup] User can retry upload ${upload.id} from pending uploads UI`);
          
          // Update with note that files are ready
          await pendingUploadsManager.updateUploadStatus(upload.id, 'ready_to_retry', {
            note: 'All files exist in IPFS, ready to retry broadcast',
            checkedAt: new Date().toISOString()
          });
        }
        
      } catch (error) {
        console.error(`❌ [Startup] Error checking upload ${upload.id}:`, error);
        await pendingUploadsManager.updateUploadStatus(upload.id, 'failed', {
          error: `Startup check failed: ${error.message}`,
          failedAt: new Date().toISOString()
        });
      }
    }
    
    console.log('✅ [Startup] Pending uploads check completed');
    
  } catch (error) {
    console.error('❌ [Startup] Failed to check pending uploads:', error);
  }
}

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

  // Initialize direct upload service first
  const directUploadService = new DirectUploadService({
    ipfsManager,
    spkClient: null, // Will be set when account is active
    pendingUploadsManager: null // Will be set later
  });

  // Initialize video upload service with direct upload support
  const videoUploadService = new VideoUploadService({
    transcoder,
    playlistProcessor,
    ipfsManager,
    spkClient: null, // Will be set when account is active
    integratedStorage,
    directUploadService
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

  // Initialize pending uploads manager
  const pendingUploadsManager = new PendingUploadsManager();
  await pendingUploadsManager.init();

  // Set pending uploads manager in the first direct upload service
  directUploadService.pendingUploadsManager = pendingUploadsManager;

  // Check for pending uploads on startup and verify CIDs exist in IPFS
  setTimeout(async () => {
    await checkPendingUploadsOnStartup(pendingUploadsManager, ipfsManager, directUploadService);
  }, 5000); // Wait 5 seconds for full initialization

  services = {
    accountManager,
    ipfsManager,
    transcoder,
    playlistProcessor,
    integratedStorage,
    videoUploadService,
    pendingUploadsManager,
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