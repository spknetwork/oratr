const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const POANodeManager = require('../../../../src/core/storage/poa-node-manager');

// Mock child_process spawn
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

// Mock fs promises
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    mkdir: jest.fn(),
    chmod: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn()
  },
  existsSync: jest.fn(),
  createWriteStream: jest.fn()
}));

// Mock fetch for IPFS verification
global.fetch = jest.fn();

describe.skip('POANodeManager', () => {
  let manager;
  let mockProcess;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock process
    mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = jest.fn();
    mockProcess.pid = 12345;
    
    spawn.mockReturnValue(mockProcess);
    
    // Create manager instance
    manager = new POANodeManager({
      account: 'testuser',
      dataPath: '/test/data',
      binaryPath: '/test/bin/proofofaccess'
    });
  });
  
  afterEach(() => {
    if (manager.process) {
      manager.stop();
    }
  });
  
  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const m = new POANodeManager();
      expect(m.config.nodeType).toBe(2); // Storage node by default
      expect(m.config.ipfsPort).toBe(5001);
      expect(m.config.maxStorage).toBe(100 * 1024 * 1024 * 1024);
      expect(m.running).toBe(false);
    });
    
    it('should accept custom configuration', () => {
      const config = {
        account: 'customuser',
        nodeType: 1,
        ipfsPort: 5002,
        maxStorage: 50 * 1024 * 1024 * 1024
      };
      
      const m = new POANodeManager(config);
      expect(m.config.account).toBe('customuser');
      expect(m.config.nodeType).toBe(1);
      expect(m.config.ipfsPort).toBe(5002);
      expect(m.config.maxStorage).toBe(50 * 1024 * 1024 * 1024);
    });
  });
  
  describe('locateBinary', () => {
    it('should find binary from npm package if available', async () => {
      // Mock require.resolve to simulate npm package
      const originalResolve = require.resolve;
      require.resolve = jest.fn().mockReturnValue('/node_modules/@disregardfiat/proofofaccess/package.json');
      fs.promises.access.mockResolvedValue();
      
      const binaryPath = await manager.locateBinary();
      expect(binaryPath).toContain('proofofaccess');
      
      require.resolve = originalResolve;
    });
    
    it('should check multiple locations for binary', async () => {
      // All access checks fail except the last one
      fs.promises.access
        .mockRejectedValueOnce(new Error('Not found'))
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce(); // Third location succeeds
      
      const binaryPath = await manager.locateBinary();
      expect(fs.promises.access).toHaveBeenCalledTimes(3);
    });
    
    it('should throw error if binary not found anywhere', async () => {
      fs.promises.access.mockRejectedValue(new Error('Not found'));
      
      await expect(manager.locateBinary()).rejects.toThrow('POA binary not found');
    });
  });
  
  describe('verifyIPFS', () => {
    it('should verify IPFS is running and configured', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          Pubsub: { Enabled: true }
        })
      });
      
      const result = await manager.verifyIPFS();
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:5001/api/v0/config/show',
        { method: 'POST' }
      );
    });
    
    it('should throw error if IPFS is not accessible', async () => {
      global.fetch.mockResolvedValue({
        ok: false
      });
      
      await expect(manager.verifyIPFS()).rejects.toThrow('IPFS node is not accessible');
    });
    
    it('should throw error if PubSub is not enabled', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          Pubsub: { Enabled: false }
        })
      });
      
      await expect(manager.verifyIPFS()).rejects.toThrow('IPFS PubSub is not enabled');
    });
  });
  
  describe('start', () => {
    beforeEach(() => {
      // Mock successful initialization
      fs.promises.access.mockResolvedValue();
      fs.promises.mkdir.mockResolvedValue();
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          Pubsub: { Enabled: true }
        })
      });
      
      manager.config.binaryPath = '/test/bin/proofofaccess';
    });
    
    it('should start POA process with correct arguments', async () => {
      const startPromise = manager.start();
      
      // Simulate successful startup
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Starting proofofaccess node'));
      });
      
      await startPromise;
      
      expect(spawn).toHaveBeenCalledWith(
        '/test/bin/proofofaccess',
        expect.arrayContaining([
          '-node', '2',
          '-username', 'testuser',
          '-IPFS_PORT=5001',
          '-url=https://spktest.dlux.io',
          '-useWS'
        ]),
        expect.any(Object)
      );
      
      expect(manager.running).toBe(true);
    });
    
    it('should throw error if no account configured', async () => {
      manager.config.account = null;
      
      await expect(manager.start()).rejects.toThrow('No account configured');
    });
    
    it('should handle process errors', async () => {
      const startPromise = manager.start();
      
      // Simulate process error
      setImmediate(() => {
        mockProcess.emit('error', new Error('Process failed'));
      });
      
      await expect(startPromise).rejects.toThrow('Process failed');
      expect(manager.running).toBe(false);
    });
    
    it('should auto-restart on crash if configured', async () => {
      manager.config.autoRestart = true;
      manager.config.maxRestarts = 3;
      
      const startPromise = manager.start();
      
      // Simulate successful startup
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Starting proofofaccess'));
      });
      
      await startPromise;
      
      // Clear the mock to track restart
      spawn.mockClear();
      
      // Simulate crash
      mockProcess.emit('exit', 1, null);
      
      // Wait for restart delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(manager.restartCount).toBe(1);
    });
  });
  
  describe('stop', () => {
    it('should stop running process', async () => {
      // Start the process first
      manager.process = mockProcess;
      manager.running = true;
      
      const stopPromise = manager.stop();
      
      // Simulate process exit
      setImmediate(() => {
        mockProcess.emit('exit', 0, null);
      });
      
      await stopPromise;
      
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(manager.running).toBe(false);
      expect(manager.process).toBe(null);
    });
    
    it('should force kill if process does not exit', async () => {
      manager.process = mockProcess;
      manager.running = true;
      
      jest.useFakeTimers();
      
      const stopPromise = manager.stop();
      
      // Don't emit exit event, let timeout trigger
      jest.advanceTimersByTime(5001);
      
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
      
      // Now emit exit
      mockProcess.emit('exit', 0, null);
      
      await stopPromise;
      
      jest.useRealTimers();
    });
  });
  
  describe('parseOutput', () => {
    it('should parse validation events', () => {
      const validationSpy = jest.fn();
      manager.on('validation', validationSpy);
      
      manager.parseOutput('Validation complete. Proof generated for CID: QmTest123');
      
      expect(manager.stats.validations).toBe(1);
      expect(validationSpy).toHaveBeenCalled();
    });
    
    it('should parse storage events', () => {
      const storageSpy = jest.fn();
      manager.on('file-stored', storageSpy);
      
      manager.parseOutput('Contract stored. File pinned successfully.');
      
      expect(manager.stats.filesStored).toBe(1);
      expect(storageSpy).toHaveBeenCalled();
    });
    
    it('should parse earnings', () => {
      const earningsSpy = jest.fn();
      manager.on('earnings', earningsSpy);
      
      manager.parseOutput('Earned: 10.5 BROCA for validation');
      
      expect(manager.stats.earnings).toBe(10.5);
      expect(earningsSpy).toHaveBeenCalledWith({
        amount: 10.5,
        token: 'BROCA',
        total: 10.5
      });
    });
  });
  
  describe('getStatus', () => {
    it('should return current status', () => {
      manager.running = true;
      manager.stats.validations = 5;
      manager.stats.filesStored = 10;
      manager.config.account = 'testuser';
      
      const status = manager.getStatus();
      
      expect(status.running).toBe(true);
      expect(status.account).toBe('testuser');
      expect(status.nodeType).toBe('Storage');
      expect(status.stats.validations).toBe(5);
      expect(status.stats.filesStored).toBe(10);
    });
  });
  
  describe('updateConfig', () => {
    it('should restart with new configuration', async () => {
      // Mock the process as running
      manager.running = true;
      manager.process = mockProcess;
      
      // Mock stop and start methods
      manager.stop = jest.fn().mockResolvedValue();
      manager.start = jest.fn().mockResolvedValue();
      
      const newConfig = {
        account: 'newuser',
        maxStorage: 200 * 1024 * 1024 * 1024
      };
      
      await manager.updateConfig(newConfig);
      
      expect(manager.stop).toHaveBeenCalled();
      expect(manager.config.account).toBe('newuser');
      expect(manager.config.maxStorage).toBe(200 * 1024 * 1024 * 1024);
      expect(manager.start).toHaveBeenCalled();
    });
  });
  
  describe('log management', () => {
    it('should maintain log buffer', () => {
      for (let i = 0; i < 10; i++) {
        manager.addLog('info', `Log message ${i}`);
      }
      
      expect(manager.logs.length).toBe(10);
      expect(manager.logs[0].message).toBe('Log message 0');
      expect(manager.logs[9].message).toBe('Log message 9');
    });
    
    it('should limit log buffer size', () => {
      manager.maxLogs = 5;
      
      for (let i = 0; i < 10; i++) {
        manager.addLog('info', `Log message ${i}`);
      }
      
      expect(manager.logs.length).toBe(5);
      expect(manager.logs[0].message).toBe('Log message 5');
      expect(manager.logs[4].message).toBe('Log message 9');
    });
    
    it('should get recent logs', () => {
      for (let i = 0; i < 10; i++) {
        manager.addLog('info', `Log message ${i}`);
      }
      
      const recentLogs = manager.getRecentLogs(3);
      
      expect(recentLogs.length).toBe(3);
      expect(recentLogs[0].message).toBe('Log message 7');
      expect(recentLogs[2].message).toBe('Log message 9');
    });
  });
});