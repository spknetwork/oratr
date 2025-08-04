const POAStorageNode = require('../../../../src/core/storage/poa-storage-node');
const EventEmitter = require('events');

describe.skip('POAStorageNode', () => { // TODO: Fix account configuration and mock external services
  let storageNode;

  beforeEach(() => {
    storageNode = new POAStorageNode({
      nodeId: 'test-node-123',
      storagePath: '/tmp/poa-storage-test'
    });
  });

  afterEach(async () => {
    await storageNode.stop();
  });

  describe('initialization', () => {
    test('should create storage node instance', () => {
      expect(storageNode).toBeDefined();
      expect(storageNode).toBeInstanceOf(POAStorageNode);
      expect(storageNode).toBeInstanceOf(EventEmitter);
    });

    test('should start storage node', async () => {
      await storageNode.start();
      expect(storageNode.isRunning()).toBe(true);
    });

    test('should stop storage node', async () => {
      await storageNode.start();
      await storageNode.stop();
      expect(storageNode.isRunning()).toBe(false);
    });

    test('should load configuration', async () => {
      const config = await storageNode.loadConfiguration();
      
      expect(config).toHaveProperty('nodeId');
      expect(config).toHaveProperty('storagePath');
      expect(config).toHaveProperty('maxStorage');
      expect(config).toHaveProperty('validatorEndpoints');
    });
  });

  describe('proof generation', () => {
    test('should generate proof for stored file', async () => {
      const cid = 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
      const seed = 'random-seed-123';
      
      // Mock file storage
      await storageNode.storeFile(cid, Buffer.from('test content'));
      
      const proof = await storageNode.generateProof(cid, seed);
      
      expect(proof).toHaveProperty('cid', cid);
      expect(proof).toHaveProperty('seed', seed);
      expect(proof).toHaveProperty('hash');
      expect(proof).toHaveProperty('blocks');
      expect(proof).toHaveProperty('timestamp');
    });

    test('should generate deterministic proofs', async () => {
      const cid = 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
      const seed = 'same-seed';
      const content = Buffer.from('deterministic content');
      
      await storageNode.storeFile(cid, content);
      
      const proof1 = await storageNode.generateProof(cid, seed);
      const proof2 = await storageNode.generateProof(cid, seed);
      
      expect(proof1.hash).toBe(proof2.hash);
      expect(proof1.blocks).toEqual(proof2.blocks);
    });

    test('should select random blocks based on seed', async () => {
      const cid = 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
      const content = Buffer.alloc(1024 * 1024); // 1MB file
      
      await storageNode.storeFile(cid, content);
      
      const proof1 = await storageNode.generateProof(cid, 'seed1');
      const proof2 = await storageNode.generateProof(cid, 'seed2');
      
      expect(proof1.blocks).not.toEqual(proof2.blocks);
    });

    test('should handle missing files', async () => {
      const cid = 'QmNonExistentFile';
      const seed = 'any-seed';
      
      await expect(storageNode.generateProof(cid, seed))
        .rejects.toThrow('File not found');
    });
  });

  describe('validation requests', () => {
    beforeEach(async () => {
      await storageNode.start();
    });

    test('should handle validation request', async () => {
      const request = {
        cid: 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
        seed: 'validator-seed',
        validator: 'validator-node-1',
        timestamp: Date.now()
      };
      
      // Store test file
      await storageNode.storeFile(request.cid, Buffer.from('validated content'));
      
      const response = await storageNode.handleValidationRequest(request);
      
      expect(response).toHaveProperty('proof');
      expect(response).toHaveProperty('nodeId', 'test-node-123');
      expect(response).toHaveProperty('timestamp');
      expect(response.proof).toHaveProperty('cid', request.cid);
      expect(response.proof).toHaveProperty('seed', request.seed);
    });

    test('should timeout validation requests', async () => {
      const request = {
        cid: 'QmTimeout',
        seed: 'timeout-seed',
        validator: 'validator-node-1',
        timestamp: Date.now() - 35000 // 35 seconds ago
      };
      
      await expect(storageNode.handleValidationRequest(request))
        .rejects.toThrow('Validation request timeout');
    });

    test('should emit validation events', async () => {
      const request = {
        cid: 'QmEventTest',
        seed: 'event-seed',
        validator: 'validator-node-1',
        timestamp: Date.now()
      };
      
      await storageNode.storeFile(request.cid, Buffer.from('event content'));
      
      const validationEvents = [];
      storageNode.on('validation', (event) => {
        validationEvents.push(event);
      });
      
      await storageNode.handleValidationRequest(request);
      
      expect(validationEvents).toHaveLength(1);
      expect(validationEvents[0]).toHaveProperty('type', 'proof_generated');
      expect(validationEvents[0]).toHaveProperty('cid', request.cid);
    });
  });

  describe('file storage', () => {
    test('should store file with metadata', async () => {
      const cid = 'QmStoreTest';
      const content = Buffer.from('stored content');
      const metadata = {
        size: content.length,
        storedAt: Date.now(),
        contract: 'contract-123'
      };
      
      const stored = await storageNode.storeFile(cid, content, metadata);
      
      expect(stored).toBe(true);
      
      const retrieved = await storageNode.getFile(cid);
      expect(retrieved.content).toEqual(content);
      expect(retrieved.metadata).toMatchObject(metadata);
    });

    test('should list stored files', async () => {
      const files = [
        { cid: 'QmFile1', content: Buffer.from('file 1') },
        { cid: 'QmFile2', content: Buffer.from('file 2') },
        { cid: 'QmFile3', content: Buffer.from('file 3') }
      ];
      
      for (const file of files) {
        await storageNode.storeFile(file.cid, file.content);
      }
      
      const storedFiles = await storageNode.listStoredFiles();
      
      expect(storedFiles).toHaveLength(3);
      expect(storedFiles.map(f => f.cid)).toEqual(['QmFile1', 'QmFile2', 'QmFile3']);
    });

    test('should remove file', async () => {
      const cid = 'QmRemoveTest';
      await storageNode.storeFile(cid, Buffer.from('remove me'));
      
      const removed = await storageNode.removeFile(cid);
      expect(removed).toBe(true);
      
      await expect(storageNode.getFile(cid))
        .rejects.toThrow('File not found');
    });

    test('should check storage space', async () => {
      const stats = await storageNode.getStorageStats();
      
      expect(stats).toHaveProperty('totalSpace');
      expect(stats).toHaveProperty('usedSpace');
      expect(stats).toHaveProperty('availableSpace');
      expect(stats).toHaveProperty('fileCount');
    });
  });

  describe('network communication', () => {
    beforeEach(async () => {
      await storageNode.start();
    });

    test('should connect to validator nodes', async () => {
      const validators = [
        'ws://validator1.spk.network:8080',
        'ws://validator2.spk.network:8080'
      ];
      
      await storageNode.connectToValidators(validators);
      
      const connections = storageNode.getActiveConnections();
      expect(connections).toHaveLength(2);
    });

    test('should handle WebSocket messages', async () => {
      const messageHandler = jest.fn();
      storageNode.on('message', messageHandler);
      
      // Simulate incoming message
      const message = {
        type: 'validation_request',
        data: {
          cid: 'QmWebSocketTest',
          seed: 'ws-seed'
        }
      };
      
      await storageNode.handleWebSocketMessage(message);
      
      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'validation_request' })
      );
    });

    test('should broadcast proof to validators', async () => {
      const proof = {
        cid: 'QmBroadcastTest',
        seed: 'broadcast-seed',
        hash: 'proof-hash',
        blocks: [1, 5, 10]
      };
      
      const broadcastResult = await storageNode.broadcastProof(proof);
      
      expect(broadcastResult).toHaveProperty('sent');
      expect(broadcastResult).toHaveProperty('acknowledged');
      expect(broadcastResult.sent).toBeGreaterThanOrEqual(0);
    });

    test('should handle connection failures', async () => {
      const invalidValidator = 'ws://invalid-validator:9999';
      
      await expect(storageNode.connectToValidators([invalidValidator]))
        .rejects.toThrow('Failed to connect to validators');
    });
  });

  describe('earnings and statistics', () => {
    test('should track validation rewards', async () => {
      // Simulate successful validations
      await storageNode.recordValidation({
        cid: 'QmReward1',
        success: true,
        reward: 100
      });
      
      await storageNode.recordValidation({
        cid: 'QmReward2',
        success: true,
        reward: 150
      });
      
      const earnings = await storageNode.getEarnings();
      
      expect(earnings).toHaveProperty('totalEarned', 250);
      expect(earnings).toHaveProperty('validationCount', 2);
      expect(earnings).toHaveProperty('successRate', 100);
    });

    test('should track validation failures', async () => {
      await storageNode.recordValidation({
        cid: 'QmFail1',
        success: false,
        reason: 'timeout'
      });
      
      const stats = await storageNode.getValidationStats();
      
      expect(stats).toHaveProperty('totalValidations', 1);
      expect(stats).toHaveProperty('successfulValidations', 0);
      expect(stats).toHaveProperty('failedValidations', 1);
      expect(stats).toHaveProperty('failureReasons');
      expect(stats.failureReasons).toHaveProperty('timeout', 1);
    });

    test('should generate performance report', async () => {
      // Add some test data
      for (let i = 0; i < 10; i++) {
        await storageNode.recordValidation({
          cid: `QmTest${i}`,
          success: i % 3 !== 0, // 70% success rate
          reward: i % 3 !== 0 ? 100 : 0,
          responseTime: 100 + i * 10
        });
      }
      
      const report = await storageNode.generatePerformanceReport();
      
      expect(report).toHaveProperty('period');
      expect(report).toHaveProperty('totalValidations', 10);
      expect(report).toHaveProperty('successRate');
      expect(report).toHaveProperty('averageResponseTime');
      expect(report).toHaveProperty('totalEarnings');
      expect(report.successRate).toBeCloseTo(0.7, 1);
    });
  });

  describe('contract management', () => {
    test('should register storage contract', async () => {
      const contract = {
        id: 'contract-123',
        cid: 'QmContractFile',
        duration: 30 * 24 * 60 * 60, // 30 days
        price: 1000,
        client: 'client-address'
      };
      
      const registered = await storageNode.registerContract(contract);
      
      expect(registered).toBe(true);
      
      const contracts = await storageNode.getActiveContracts();
      expect(contracts).toContainEqual(expect.objectContaining({ id: 'contract-123' }));
    });

    test('should check contract expiration', async () => {
      const expiredContract = {
        id: 'expired-123',
        cid: 'QmExpired',
        duration: -1, // Already expired
        startTime: Date.now() - 1000
      };
      
      await storageNode.registerContract(expiredContract);
      
      const expired = await storageNode.checkExpiredContracts();
      expect(expired).toContainEqual(expect.objectContaining({ id: 'expired-123' }));
    });

    test('should renew contract', async () => {
      const contract = {
        id: 'renew-123',
        cid: 'QmRenew',
        duration: 24 * 60 * 60 // 1 day
      };
      
      await storageNode.registerContract(contract);
      
      const renewed = await storageNode.renewContract('renew-123', 30 * 24 * 60 * 60);
      
      expect(renewed).toBe(true);
      
      const updatedContract = await storageNode.getContract('renew-123');
      expect(updatedContract.duration).toBe(30 * 24 * 60 * 60);
    });
  });

  describe('error handling', () => {
    test('should handle corrupted files gracefully', async () => {
      const cid = 'QmCorrupted';
      // Store corrupted data
      await storageNode.storeFile(cid, Buffer.from([0xFF, 0xFE, 0xFD]));
      
      // Mock corruption
      jest.spyOn(storageNode, 'getFile').mockRejectedValueOnce(new Error('File corrupted'));
      
      await expect(storageNode.generateProof(cid, 'seed'))
        .rejects.toThrow('File corrupted');
    });

    test('should recover from network errors', async () => {
      let attempts = 0;
      
      // Mock network error that succeeds on retry
      jest.spyOn(storageNode, 'broadcastProof').mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Network error');
        }
        return { sent: 1, acknowledged: 1 };
      });
      
      const proof = { cid: 'QmRetry', seed: 'retry-seed' };
      const result = await storageNode.broadcastProofWithRetry(proof);
      
      expect(result).toHaveProperty('sent', 1);
      expect(attempts).toBe(2);
    });

    test('should handle disk space errors', async () => {
      // Mock insufficient disk space
      jest.spyOn(storageNode, 'hasStorageSpace').mockResolvedValue(false);
      
      const largeCid = 'QmLargeFile';
      const largeContent = Buffer.alloc(1024 * 1024 * 100); // 100MB
      
      await expect(storageNode.storeFile(largeCid, largeContent))
        .rejects.toThrow('Insufficient storage space');
    });
  });
});