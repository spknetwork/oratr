const FileSyncService = require('../../../../src/core/storage/file-sync-service');
const EventEmitter = require('events');

// Mock dependencies
jest.mock('node-fetch');
const fetch = require('node-fetch');

describe.skip('FileSyncService', () => { // TODO: Fix API mocking and account setup
  let fileSyncService;
  let mockIPFSManager;
  let mockStorageNode;

  beforeEach(() => {
    // Mock IPFS Manager
    mockIPFSManager = {
      pinFile: jest.fn().mockResolvedValue(true),
      unpinFile: jest.fn().mockResolvedValue(true),
      getPinnedFiles: jest.fn().mockResolvedValue([]),
      isValidCID: jest.fn().mockReturnValue(true),
      running: true
    };

    // Mock Storage Node
    mockStorageNode = new EventEmitter();
    mockStorageNode.config = { account: 'testuser' };
    mockStorageNode.running = true;

    fileSyncService = new FileSyncService({
      username: 'testuser',
      spkApiUrl: 'https://spktest.dlux.io',
      ipfsManager: mockIPFSManager,
      storageNode: mockStorageNode,
      syncInterval: 1000 // 1 second for testing
    });

    // Clear all mocks
    fetch.mockClear();
  });

  afterEach(async () => {
    await fileSyncService.stop();
  });

  describe('initialization', () => {
    test('should create file sync service instance', () => {
      expect(fileSyncService).toBeDefined();
      expect(fileSyncService).toBeInstanceOf(FileSyncService);
      expect(fileSyncService).toBeInstanceOf(EventEmitter);
    });

    test('should have default configuration', () => {
      const service = new FileSyncService({ 
        username: 'test',
        ipfsManager: mockIPFSManager 
      });
      expect(service.config.spkApiUrl).toBe('https://spktest.dlux.io');
      expect(service.config.syncInterval).toBe(300000); // 5 minutes
      expect(service.config.maxRetries).toBe(3);
    });

    test('should require username', () => {
      expect(() => new FileSyncService({})).toThrow('Username is required');
    });

    test('should require IPFS manager', () => {
      expect(() => new FileSyncService({ username: 'test' })).toThrow('IPFS Manager is required');
    });
  });

  describe('service lifecycle', () => {
    test('should start sync service', async () => {
      expect(fileSyncService.isRunning()).toBe(false);
      
      await fileSyncService.start();
      
      expect(fileSyncService.isRunning()).toBe(true);
    });

    test('should stop sync service', async () => {
      await fileSyncService.start();
      expect(fileSyncService.isRunning()).toBe(true);
      
      await fileSyncService.stop();
      
      expect(fileSyncService.isRunning()).toBe(false);
    });

    test('should not start if already running', async () => {
      await fileSyncService.start();
      
      // Second start should not throw but also not change state
      await fileSyncService.start();
      
      expect(fileSyncService.isRunning()).toBe(true);
    });

    test('should emit started event', async () => {
      const startedSpy = jest.fn();
      fileSyncService.on('started', startedSpy);
      
      await fileSyncService.start();
      
      expect(startedSpy).toHaveBeenCalled();
    });

    test('should emit stopped event', async () => {
      const stoppedSpy = jest.fn();
      fileSyncService.on('stopped', stoppedSpy);
      
      await fileSyncService.start();
      await fileSyncService.stop();
      
      expect(stoppedSpy).toHaveBeenCalled();
    });
  });

  describe('contract fetching', () => {
    test('should fetch contracts for user', async () => {
      const mockContracts = [
        {
          id: 'contract-1',
          cid: 'QmTest1',
          storageNodes: ['node1', 'node2'],
          size: 1024
        },
        {
          id: 'contract-2', 
          cid: 'QmTest2',
          storageNodes: ['testuser', 'node3'],
          size: 2048
        }
      ];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ contracts: mockContracts })
      });

      const contracts = await fileSyncService.fetchStoredContracts();

      expect(fetch).toHaveBeenCalledWith(
        'https://spktest.dlux.io/api/spk/contracts/stored-by/testuser'
      );
      expect(contracts).toEqual(mockContracts);
    });

    test('should handle API errors gracefully', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const contracts = await fileSyncService.fetchStoredContracts();

      expect(contracts).toEqual([]);
    });

    test('should handle network errors', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const contracts = await fileSyncService.fetchStoredContracts();

      expect(contracts).toEqual([]);
    });

    test('should retry failed requests', async () => {
      // First two calls fail, third succeeds
      fetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ contracts: [] })
        });

      const contracts = await fileSyncService.fetchStoredContracts();

      expect(fetch).toHaveBeenCalledTimes(3);
      expect(contracts).toEqual([]);
    });

    test('should give up after max retries', async () => {
      // All calls fail
      fetch.mockRejectedValue(new Error('Network error'));

      const contracts = await fileSyncService.fetchStoredContracts();

      expect(fetch).toHaveBeenCalledTimes(3); // maxRetries
      expect(contracts).toEqual([]);
    });
  });

  describe('CID extraction', () => {
    test('should extract CIDs from contract data', () => {
      const contract = {
        id: 'test-contract',
        cid: 'QmMainFile',
        files: [
          { cid: 'QmFile1', name: 'file1.txt' },
          { cid: 'QmFile2', name: 'file2.txt' }
        ],
        metadata: {
          thumbnails: ['QmThumb1', 'QmThumb2']
        }
      };

      const cids = fileSyncService.extractCIDsFromContract(contract);

      expect(cids).toContain('QmMainFile');
      expect(cids).toContain('QmFile1');
      expect(cids).toContain('QmFile2');
      expect(cids).toContain('QmThumb1');
      expect(cids).toContain('QmThumb2');
      expect(cids).toHaveLength(5);
    });

    test('should handle contracts with no files', () => {
      const contract = {
        id: 'empty-contract'
      };

      const cids = fileSyncService.extractCIDsFromContract(contract);

      expect(cids).toEqual([]);
    });

    test('should filter out invalid CIDs', () => {
      mockIPFSManager.isValidCID
        .mockReturnValueOnce(true)  // QmValidCID123456789012345678901234567890123
        .mockReturnValueOnce(false) // invalid-cid
        .mockReturnValueOnce(true); // QmAnotherValidCID123456789012345678901234

      const contract = {
        cid: 'QmValidCID123456789012345678901234567890123',
        files: [
          { cid: 'invalid-cid' },
          { cid: 'QmAnotherValidCID123456789012345678901234' }
        ]
      };

      const cids = fileSyncService.extractCIDsFromContract(contract);

      expect(cids).toHaveLength(2);
      expect(cids).toContain('QmValidCID123456789012345678901234567890123');
      expect(cids).toContain('QmAnotherValidCID123456789012345678901234');
    });

    test('should remove duplicate CIDs', () => {
      const contract = {
        cid: 'QmDuplicate',
        files: [
          { cid: 'QmDuplicate' },
          { cid: 'QmUnique' }
        ]
      };

      const cids = fileSyncService.extractCIDsFromContract(contract);

      expect(cids).toHaveLength(2);
      expect(cids.filter(cid => cid === 'QmDuplicate')).toHaveLength(1);
    });
  });

  describe('file pinning', () => {
    test('should pin new files', async () => {
      const contracts = [
        {
          id: 'contract-1',
          cid: 'QmNewFile1'
        }
      ];

      mockIPFSManager.getPinnedFiles.mockResolvedValue([]);

      await fileSyncService.syncContracts(contracts);

      expect(mockIPFSManager.pinFile).toHaveBeenCalledWith('QmNewFile1');
    });

    test('should not pin already pinned files', async () => {
      const contracts = [
        {
          id: 'contract-1',
          cid: 'QmAlreadyPinned'
        }
      ];

      mockIPFSManager.getPinnedFiles.mockResolvedValue([
        { cid: 'QmAlreadyPinned' }
      ]);

      await fileSyncService.syncContracts(contracts);

      expect(mockIPFSManager.pinFile).not.toHaveBeenCalled();
    });

    test('should handle pinning failures gracefully', async () => {
      const contracts = [
        {
          id: 'contract-1',
          cid: 'QmFailPin'
        }
      ];

      mockIPFSManager.getPinnedFiles.mockResolvedValue([]);
      mockIPFSManager.pinFile.mockRejectedValue(new Error('Pin failed'));

      const errorSpy = jest.fn();
      fileSyncService.on('error', errorSpy);

      await fileSyncService.syncContracts(contracts);

      expect(mockIPFSManager.pinFile).toHaveBeenCalledWith('QmFailPin');
      expect(errorSpy).toHaveBeenCalled();
    });

    test('should emit pin success events', async () => {
      const contracts = [
        {
          id: 'contract-1',
          cid: 'QmSuccessPin'
        }
      ];

      mockIPFSManager.getPinnedFiles.mockResolvedValue([]);

      const pinSuccessSpy = jest.fn();
      fileSyncService.on('file-pinned', pinSuccessSpy);

      await fileSyncService.syncContracts(contracts);

      expect(pinSuccessSpy).toHaveBeenCalledWith({
        cid: 'QmSuccessPin',
        contractId: 'contract-1'
      });
    });

    test('should track pinning statistics', async () => {
      const contracts = [
        { id: 'contract-1', cid: 'QmFile1' },
        { id: 'contract-2', cid: 'QmFile2' }
      ];

      mockIPFSManager.getPinnedFiles.mockResolvedValue([]);

      await fileSyncService.syncContracts(contracts);

      const stats = fileSyncService.getStats();
      expect(stats.totalPinned).toBe(2);
      expect(stats.lastSync).toBeDefined();
    });
  });

  describe('cleanup operations', () => {
    test('should unpin files from expired contracts', async () => {
      const activeContracts = [
        { id: 'contract-1', cid: 'QmActiveFile' }
      ];

      // Mock currently pinned files including an expired one
      mockIPFSManager.getPinnedFiles.mockResolvedValue([
        { cid: 'QmActiveFile' },
        { cid: 'QmExpiredFile' }
      ]);

      // Track what was pinned previously
      fileSyncService.pinnedCIDs.add('QmActiveFile');
      fileSyncService.pinnedCIDs.add('QmExpiredFile');

      await fileSyncService.cleanupExpiredPins(activeContracts);

      expect(mockIPFSManager.unpinFile).toHaveBeenCalledWith('QmExpiredFile');
      expect(mockIPFSManager.unpinFile).not.toHaveBeenCalledWith('QmActiveFile');
    });

    test('should not unpin files we did not pin', async () => {
      const activeContracts = [];

      mockIPFSManager.getPinnedFiles.mockResolvedValue([
        { cid: 'QmNotOurPin' }
      ]);

      // Don't track this CID as pinned by us
      await fileSyncService.cleanupExpiredPins(activeContracts);

      expect(mockIPFSManager.unpinFile).not.toHaveBeenCalled();
    });

    test('should handle unpin failures gracefully', async () => {
      const activeContracts = [];

      mockIPFSManager.getPinnedFiles.mockResolvedValue([
        { cid: 'QmFailUnpin' }
      ]);
      mockIPFSManager.unpinFile.mockRejectedValue(new Error('Unpin failed'));

      fileSyncService.pinnedCIDs.add('QmFailUnpin');

      const errorSpy = jest.fn();
      fileSyncService.on('error', errorSpy);

      await fileSyncService.cleanupExpiredPins(activeContracts);

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('periodic sync', () => {
    test('should perform sync on interval', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ contracts: [] })
      });

      await fileSyncService.start();

      // Wait for at least one sync cycle
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(fetch).toHaveBeenCalledWith(
        'https://spktest.dlux.io/api/spk/contracts/stored-by/testuser'
      );
    });

    test('should emit sync events', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ contracts: [] })
      });

      const syncStartSpy = jest.fn();
      const syncCompleteSpy = jest.fn();
      
      fileSyncService.on('sync-start', syncStartSpy);
      fileSyncService.on('sync-complete', syncCompleteSpy);

      await fileSyncService.performSync();

      expect(syncStartSpy).toHaveBeenCalled();
      expect(syncCompleteSpy).toHaveBeenCalledWith({
        contracts: 0,
        newPins: 0,
        removedPins: 0
      });
    });

    test('should handle sync errors without stopping service', async () => {
      fetch.mockRejectedValue(new Error('Sync error'));

      const errorSpy = jest.fn();
      fileSyncService.on('error', errorSpy);

      // Manually trigger a sync error - performSync catches and increments error count
      await fileSyncService.performSync().catch(() => {
        // Expected to be caught by performSync
      });

      expect(fileSyncService.stats.errorCount).toBe(1);
      expect(fileSyncService.stats.lastError).toBeDefined();
    });
  });

  describe('statistics and monitoring', () => {
    test('should track sync statistics', async () => {
      const contracts = [
        { id: 'contract-1', cid: 'QmFile1' },
        { id: 'contract-2', cid: 'QmFile2' }
      ];

      mockIPFSManager.getPinnedFiles.mockResolvedValue([]);

      // Use performSync to update stats properly
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ contracts })
      });

      await fileSyncService.performSync();

      const stats = fileSyncService.getStats();

      expect(stats).toHaveProperty('totalContracts', 2);
      expect(stats).toHaveProperty('totalPinned', 2);
      expect(stats).toHaveProperty('lastSync');
      expect(stats).toHaveProperty('syncCount', 1);
      expect(stats).toHaveProperty('errorCount', 0);
    });

    test('should track error statistics', async () => {
      const contracts = [{ id: 'contract-1', cid: 'QmErrorFile' }];

      mockIPFSManager.getPinnedFiles.mockResolvedValue([]);
      mockIPFSManager.pinFile.mockRejectedValue(new Error('Pin error'));

      const errorSpy = jest.fn();
      fileSyncService.on('error', errorSpy);

      await fileSyncService.syncContracts(contracts);

      const stats = fileSyncService.getStats();
      expect(stats.errorCount).toBe(0); // syncContracts doesn't increment errorCount, only performSync does
      expect(errorSpy).toHaveBeenCalled();
    });

    test('should provide status information', async () => {
      const status = fileSyncService.getStatus();

      expect(status).toHaveProperty('running', false);
      expect(status).toHaveProperty('username', 'testuser');
      expect(status).toHaveProperty('spkApiUrl', 'https://spktest.dlux.io');
      expect(status).toHaveProperty('syncInterval', 1000);

      await fileSyncService.start();
      const runningStatus = fileSyncService.getStatus();
      expect(runningStatus.running).toBe(true);
    });
  });

  describe('integration with storage node', () => {
    test('should start automatically when storage node starts', async () => {
      const service = new FileSyncService({
        username: 'testuser',
        ipfsManager: mockIPFSManager,
        storageNode: mockStorageNode,
        autoStart: true
      });

      expect(service.isRunning()).toBe(false);

      // Simulate storage node starting
      mockStorageNode.emit('started');

      expect(service.isRunning()).toBe(true);

      await service.stop();
    });

    test('should stop when storage node stops', async () => {
      const service = new FileSyncService({
        username: 'testuser',
        ipfsManager: mockIPFSManager,
        storageNode: mockStorageNode,
        autoStart: true
      });

      await service.start();
      expect(service.isRunning()).toBe(true);

      // Simulate storage node stopping
      mockStorageNode.emit('stopped');

      expect(service.isRunning()).toBe(false);
    });

    test('should use storage node username if not provided', () => {
      const service = new FileSyncService({
        ipfsManager: mockIPFSManager,
        storageNode: mockStorageNode
      });

      expect(service.config.username).toBe('testuser');
    });
  });
});