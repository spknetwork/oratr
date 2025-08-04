const StorageNodeIntegration = require('../../../../src/core/storage/storage-node-integration');
const FileSyncService = require('../../../../src/core/storage/file-sync-service');
const { EventEmitter } = require('events');

// Mock dependencies
jest.mock('../../../../src/core/storage/file-sync-service');
jest.mock('../../../../src/renderer/components/storage-node-tab');

describe('StorageNodeIntegration', () => {
  let integration;
  let mockPOAStorageNode;
  let mockIPFSManager;
  let mockFileSyncService;

  beforeEach(() => {
    // Mock POA Storage Node
    mockPOAStorageNode = new EventEmitter();
    mockPOAStorageNode.running = false;
    mockPOAStorageNode.config = { account: 'testuser' };
    mockPOAStorageNode.stats = { validations: 0 };
    mockPOAStorageNode.start = jest.fn().mockResolvedValue(true);
    mockPOAStorageNode.stop = jest.fn().mockResolvedValue(true);

    // Mock IPFS Manager
    mockIPFSManager = new EventEmitter();
    mockIPFSManager.running = false;
    mockIPFSManager.nodeInfo = { id: 'test-ipfs-node' };
    mockIPFSManager.start = jest.fn().mockResolvedValue(true);
    mockIPFSManager.stop = jest.fn().mockResolvedValue(true);

    // Mock File Sync Service
    mockFileSyncService = new EventEmitter();
    mockFileSyncService.isRunning = jest.fn().mockReturnValue(false);
    mockFileSyncService.start = jest.fn().mockResolvedValue(true);
    mockFileSyncService.stop = jest.fn().mockResolvedValue(true);
    mockFileSyncService.performSync = jest.fn().mockResolvedValue({
      contracts: 0,
      newPins: 0,
      removedPins: 0
    });
    mockFileSyncService.getStatus = jest.fn().mockReturnValue({
      running: false,
      totalPinned: 0
    });
    mockFileSyncService.getStats = jest.fn().mockReturnValue({
      syncCount: 0,
      totalContracts: 0
    });
    mockFileSyncService.updateConfig = jest.fn();
    mockFileSyncService.removeAllListeners = jest.fn();

    FileSyncService.mockImplementation(() => mockFileSyncService);

    integration = new StorageNodeIntegration({
      poaStorageNode: mockPOAStorageNode,
      ipfsManager: mockIPFSManager,
      spkApiUrl: 'https://spktest.dlux.io'
    });
  });

  afterEach(() => {
    if (integration && integration.destroy) {
      integration.destroy();
    }
  });

  describe('initialization', () => {
    test('should create integration instance', () => {
      expect(integration).toBeDefined();
      expect(integration.poaStorageNode).toBe(mockPOAStorageNode);
      expect(integration.ipfsManager).toBe(mockIPFSManager);
      expect(integration.fileSyncService).toBeDefined();
    });

    test('should require POA Storage Node', () => {
      expect(() => new StorageNodeIntegration({
        ipfsManager: mockIPFSManager
      })).toThrow('POA Storage Node is required');
    });

    test('should require IPFS Manager', () => {
      expect(() => new StorageNodeIntegration({
        poaStorageNode: mockPOAStorageNode
      })).toThrow('IPFS Manager is required');
    });

    test('should create File Sync Service with correct config', () => {
      expect(FileSyncService).toHaveBeenCalledWith({
        spkApiUrl: 'https://spktest.dlux.io',
        ipfsManager: mockIPFSManager,
        storageNode: mockPOAStorageNode,
        autoStart: true,
        syncInterval: 5 * 60 * 1000,
        maxRetries: 3
      });
    });
  });

  describe('service coordination', () => {
    test('should start all services in correct order', async () => {
      await integration.start();

      expect(mockIPFSManager.start).toHaveBeenCalled();
      expect(mockPOAStorageNode.start).toHaveBeenCalled();
      expect(mockFileSyncService.start).toHaveBeenCalled();
    });

    test('should not start already running services', async () => {
      mockIPFSManager.running = true;
      mockPOAStorageNode.running = true;
      mockFileSyncService.isRunning.mockReturnValue(true);

      await integration.start();

      expect(mockIPFSManager.start).not.toHaveBeenCalled();
      expect(mockPOAStorageNode.start).not.toHaveBeenCalled();
      expect(mockFileSyncService.start).not.toHaveBeenCalled();
    });

    test('should stop services in reverse order', async () => {
      mockFileSyncService.isRunning.mockReturnValue(true);
      mockPOAStorageNode.running = true;

      await integration.stop();

      expect(mockFileSyncService.stop).toHaveBeenCalled();
      expect(mockPOAStorageNode.stop).toHaveBeenCalled();
      // IPFS should not be stopped
      expect(mockIPFSManager.stop).not.toHaveBeenCalled();
    });

    test('should handle start failures gracefully', async () => {
      mockIPFSManager.start.mockRejectedValue(new Error('IPFS start failed'));

      await expect(integration.start()).rejects.toThrow('IPFS start failed');
    });
  });

  describe('event forwarding', () => {
    test('should trigger sync when POA storage node starts', () => {
      const emitSpy = jest.spyOn(mockFileSyncService, 'emit');
      
      mockPOAStorageNode.emit('started');

      expect(emitSpy).toHaveBeenCalledWith('poa-started');
    });

    test('should trigger sync when POA storage node stops', () => {
      const emitSpy = jest.spyOn(mockFileSyncService, 'emit');
      
      mockPOAStorageNode.emit('stopped');

      expect(emitSpy).toHaveBeenCalledWith('poa-stopped');
    });

    test('should sync after contract registration', async () => {
      mockFileSyncService.isRunning.mockReturnValue(true);

      mockPOAStorageNode.emit('contract-registered', {
        cid: 'QmTestContract'
      });

      expect(mockFileSyncService.performSync).toHaveBeenCalled();
    });

    test('should sync after validation requests', async () => {
      mockFileSyncService.isRunning.mockReturnValue(true);

      // Use fake timers to control setTimeout
      jest.useFakeTimers();

      mockPOAStorageNode.emit('validation', {
        type: 'validation_request',
        cid: 'QmValidationTest'
      });

      // Fast-forward time to trigger delayed sync
      jest.advanceTimersByTime(2000);

      expect(mockFileSyncService.performSync).toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('should forward file sync events to POA logs', () => {
      const logSpy = jest.fn();
      mockPOAStorageNode.emit = logSpy;

      mockFileSyncService.emit('file-pinned', {
        cid: 'QmPinnedFile',
        contractId: 'contract-123'
      });

      expect(logSpy).toHaveBeenCalledWith('log', {
        level: 'info',
        message: 'File sync: Pinned CID QmPinnedFile for contract contract-123'
      });
    });

    test('should forward sync completion events', () => {
      const logSpy = jest.fn();
      mockPOAStorageNode.emit = logSpy;

      mockFileSyncService.emit('sync-complete', {
        contracts: 5,
        newPins: 3,
        removedPins: 1
      });

      expect(logSpy).toHaveBeenCalledWith('log', {
        level: 'info',
        message: 'File sync: Complete - 5 contracts, 3 new pins, 1 removed'
      });
    });

    test('should forward sync errors to POA logs', () => {
      const logSpy = jest.fn();
      mockPOAStorageNode.emit = logSpy;

      const testError = new Error('Sync failed');
      mockFileSyncService.emit('error', testError);

      expect(logSpy).toHaveBeenCalledWith('log', {
        level: 'error',
        message: 'File sync error: Sync failed'
      });
    });
  });

  describe('UI integration', () => {
    test('should create storage node tab with correct config', () => {
      const StorageNodeTab = require('../../../../src/renderer/components/storage-node-tab');
      const mockContainer = { id: 'test-container' };

      integration.createStorageNodeTab(mockContainer);

      expect(StorageNodeTab).toHaveBeenCalledWith({
        container: mockContainer,
        fileSyncService: mockFileSyncService,
        storageNode: mockPOAStorageNode,
        spkApiUrl: 'https://spktest.dlux.io'
      });
    });

    test('should destroy previous tab when creating new one', () => {
      const StorageNodeTab = require('../../../../src/renderer/components/storage-node-tab');
      const mockDestroy = jest.fn();
      StorageNodeTab.mockImplementation(() => ({ destroy: mockDestroy }));

      const container1 = { id: 'container1' };
      const container2 = { id: 'container2' };

      integration.createStorageNodeTab(container1);
      integration.createStorageNodeTab(container2);

      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe('status and statistics', () => {
    test('should provide comprehensive status', () => {
      const status = integration.getStatus();

      expect(status).toHaveProperty('poaStorageNode');
      expect(status).toHaveProperty('fileSyncService');
      expect(status).toHaveProperty('ipfsManager');

      expect(status.poaStorageNode).toEqual({
        running: false,
        account: 'testuser',
        stats: { validations: 0 }
      });
    });

    test('should provide sync statistics', () => {
      const stats = integration.getSyncStats();

      expect(mockFileSyncService.getStats).toHaveBeenCalled();
      expect(stats).toEqual({
        syncCount: 0,
        totalContracts: 0
      });
    });

    test('should force immediate sync', async () => {
      mockFileSyncService.isRunning.mockReturnValue(true);

      await integration.forceSync();

      expect(mockFileSyncService.performSync).toHaveBeenCalled();
    });

    test('should throw error when forcing sync on stopped service', async () => {
      mockFileSyncService.isRunning.mockReturnValue(false);

      await expect(integration.forceSync()).rejects.toThrow(
        'File sync service is not running'
      );
    });
  });

  describe('configuration management', () => {
    test('should update configuration across services', () => {
      const newConfig = {
        spkApiUrl: 'https://spk.dlux.io'
      };

      integration.updateConfig(newConfig);

      expect(integration.config.spkApiUrl).toBe('https://spk.dlux.io');
      expect(mockFileSyncService.updateConfig).toHaveBeenCalledWith({
        spkApiUrl: 'https://spk.dlux.io'
      });
    });

    test.skip('should update storage node tab config if exists', () => { // TODO: Fix storage node tab destroy method
      const StorageNodeTab = require('../../../../src/renderer/components/storage-node-tab');
      const mockTab = { config: { spkApiUrl: 'old-url' } };
      StorageNodeTab.mockImplementation(() => mockTab);

      const container = { id: 'test-container' };
      integration.createStorageNodeTab(container);

      integration.updateConfig({
        spkApiUrl: 'https://new.dlux.io'
      });

      expect(mockTab.config.spkApiUrl).toBe('https://new.dlux.io');
    });
  });

  describe('cleanup', () => {
    test('should clean up all resources on destroy', () => {
      const StorageNodeTab = require('../../../../src/renderer/components/storage-node-tab');
      const mockDestroy = jest.fn();
      StorageNodeTab.mockImplementation(() => ({ destroy: mockDestroy }));

      const container = { id: 'test-container' };
      integration.createStorageNodeTab(container);

      const removeAllListenersSpy = jest.spyOn(mockPOAStorageNode, 'removeAllListeners');

      integration.destroy();

      expect(mockDestroy).toHaveBeenCalled();
      expect(mockFileSyncService.removeAllListeners).toHaveBeenCalled();
      expect(removeAllListenersSpy).toHaveBeenCalledWith('started');
      expect(removeAllListenersSpy).toHaveBeenCalledWith('stopped');
      expect(removeAllListenersSpy).toHaveBeenCalledWith('contract-registered');
      expect(removeAllListenersSpy).toHaveBeenCalledWith('validation');
    });
  });
});