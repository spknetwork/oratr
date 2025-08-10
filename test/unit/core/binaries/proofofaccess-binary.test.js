const path = require('path');
const fs = require('fs');
const os = require('os');

// Mock modules before requiring the module under test
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    existsSync: jest.fn(),
    promises: {
      access: jest.fn(),
      mkdir: jest.fn(),
      chmod: jest.fn()
    },
    createWriteStream: jest.fn()
  };
});
jest.mock('axios');

describe.skip('ProofOfAccess Binary Wrapper', () => {
  let poaBinary;
  let originalPlatform;
  let originalArch;
  let originalResourcesPath;
  
  beforeEach(() => {
    // Clear module cache
    jest.resetModules();
    jest.clearAllMocks();
    
    // Store original values
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    originalArch = Object.getOwnPropertyDescriptor(process, 'arch');
    originalResourcesPath = process.resourcesPath;
    
    // Re-mock fs module for each test
    const fs = require('fs');
    fs.existsSync.mockReturnValue(false);
    fs.createWriteStream.mockReturnValue({
      on: jest.fn((event, callback) => {
        if (event === 'finish') {
          setTimeout(callback, 0);
        }
      })
    });
  });
  
  afterEach(() => {
    // Restore original values
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    if (originalArch) {
      Object.defineProperty(process, 'arch', originalArch);
    }
    process.resourcesPath = originalResourcesPath;
  });
  
  describe('getBinaryName', () => {
    it('should return correct binary name for Linux x64', () => {
      setPlatform('linux', 'x64');
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      
      const name = poaBinary.getBinaryName();
      expect(name).toBe('proofofaccess-linux-amd64');
    });
    
    it('should return correct binary name for Windows x64', () => {
      setPlatform('win32', 'x64');
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      
      const name = poaBinary.getBinaryName();
      expect(name).toBe('proofofaccess-windows-amd64.exe');
    });
    
    it('should return correct binary name for macOS ARM64', () => {
      setPlatform('darwin', 'arm64');
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      
      const name = poaBinary.getBinaryName();
      expect(name).toBe('proofofaccess-darwin-arm64');
    });
    
    it('should throw error for unsupported platform', () => {
      setPlatform('freebsd', 'x64');
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      
      expect(() => poaBinary.getBinaryName()).toThrow('Unsupported platform: freebsd');
    });
    
    it('should throw error for unsupported architecture', () => {
      setPlatform('linux', 'mips');
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      
      expect(() => poaBinary.getBinaryName()).toThrow('Unsupported architecture: mips');
    });
  });
  
  describe('getBinaryPath', () => {
    it('should use npm package if available', () => {
      setPlatform('linux', 'x64');
      
      // Mock @disregardfiat/proofofaccess package
      jest.doMock('@disregardfiat/proofofaccess', () => ({
        path: '/node_modules/@disregardfiat/proofofaccess/bin/proofofaccess'
      }), { virtual: true });
      
      fs.existsSync.mockReturnValue(true);
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      const binaryPath = poaBinary.getBinaryPath();
      
      expect(binaryPath).toBe('/node_modules/@disregardfiat/proofofaccess/bin/proofofaccess');
    });
    
    it('should use production path in Electron app', () => {
      setPlatform('linux', 'x64');
      process.resourcesPath = '/app/resources';
      
      fs.existsSync.mockImplementation(path => {
        return path === '/app/resources/bin/proofofaccess-linux-amd64';
      });
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      const binaryPath = poaBinary.getBinaryPath();
      
      expect(binaryPath).toBe('/app/resources/bin/proofofaccess-linux-amd64');
    });
    
    it('should check multiple development paths', () => {
      setPlatform('linux', 'x64');
      delete process.resourcesPath;
      
      const expectedPaths = [];
      fs.existsSync.mockImplementation(path => {
        expectedPaths.push(path);
        return false;
      });
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      poaBinary.getBinaryPath();
      
      // Should check development paths
      expect(expectedPaths).toContain(
        expect.stringContaining('bin/proofofaccess-linux-amd64')
      );
      expect(expectedPaths).toContain(
        path.join(os.homedir(), '.spk-desktop', 'bin', 'proofofaccess-linux-amd64')
      );
    });
    
    it('should return expected path even if binary not found', () => {
      setPlatform('linux', 'x64');
      fs.existsSync.mockReturnValue(false);
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      const binaryPath = poaBinary.getBinaryPath();
      
      expect(binaryPath).toContain('bin/proofofaccess-linux-amd64');
    });
  });
  
  describe('isAvailable', () => {
    it('should return true if binary is executable', async () => {
      setPlatform('linux', 'x64');
      fs.existsSync.mockReturnValue(true);
      fs.promises.access.mockResolvedValue(undefined);
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      const available = await poaBinary.isAvailable();
      
      expect(available).toBe(true);
      expect(fs.promises.access).toHaveBeenCalledWith(
        expect.any(String),
        fs.constants.X_OK
      );
    });
    
    it('should return false if binary is not executable', async () => {
      setPlatform('linux', 'x64');
      fs.existsSync.mockReturnValue(true);
      fs.promises.access.mockRejectedValue(new Error('Permission denied'));
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      const available = await poaBinary.isAvailable();
      
      expect(available).toBe(false);
    });
    
    it('should return false if binary does not exist', async () => {
      setPlatform('linux', 'x64');
      fs.existsSync.mockReturnValue(false);
      fs.promises.access.mockRejectedValue(new Error('File not found'));
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      const available = await poaBinary.isAvailable();
      
      expect(available).toBe(false);
    });
  });
  
  describe('downloadBinary', () => {
    let axios;
    
    beforeEach(() => {
      axios = require('axios');
      axios.mockResolvedValue({
        data: {
          pipe: jest.fn()
        }
      });
    });
    
    it('should download binary for current platform', async () => {
      setPlatform('linux', 'x64');
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      const result = await poaBinary.downloadBinary();
      
      expect(axios).toHaveBeenCalledWith({
        method: 'GET',
        url: expect.stringContaining('proofofaccess-linux-amd64'),
        responseType: 'stream'
      });
      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('bin'),
        { recursive: true }
      );
      expect(result).toContain('proofofaccess-linux-amd64');
    });
    
    it('should make binary executable on Unix systems', async () => {
      setPlatform('linux', 'x64');
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      await poaBinary.downloadBinary();
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(fs.promises.chmod).toHaveBeenCalledWith(
        expect.stringContaining('proofofaccess-linux-amd64'),
        0o755
      );
    });
    
    it('should not chmod on Windows', async () => {
      setPlatform('win32', 'x64');
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      await poaBinary.downloadBinary();
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(fs.promises.chmod).not.toHaveBeenCalled();
    });
    
    it('should throw error if download fails', async () => {
      setPlatform('linux', 'x64');
      axios.mockRejectedValue(new Error('Network error'));
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      
      await expect(poaBinary.downloadBinary()).rejects.toThrow(
        'Failed to download ProofOfAccess binary: Network error'
      );
    });
  });
  
  describe('ensureBinary', () => {
    it('should return existing binary path if available', async () => {
      setPlatform('linux', 'x64');
      fs.existsSync.mockReturnValue(true);
      fs.promises.access.mockResolvedValue(undefined);
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      const binaryPath = await poaBinary.ensureBinary();
      
      expect(binaryPath).toContain('proofofaccess-linux-amd64');
      expect(require('axios')).not.toHaveBeenCalled();
    });
    
    it('should download binary if not available', async () => {
      setPlatform('linux', 'x64');
      fs.existsSync.mockReturnValue(false);
      fs.promises.access.mockRejectedValue(new Error('Not found'));
      
      const axios = require('axios');
      axios.mockResolvedValue({
        data: {
          pipe: jest.fn()
        }
      });
      
      poaBinary = require('../../../../src/core/binaries/proofofaccess-binary');
      const binaryPath = await poaBinary.ensureBinary();
      
      expect(axios).toHaveBeenCalled();
      expect(binaryPath).toContain('proofofaccess-linux-amd64');
    });
  });
  
  // Helper function to set platform and architecture
  function setPlatform(platform, arch) {
    Object.defineProperty(process, 'platform', {
      value: platform,
      writable: false,
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(process, 'arch', {
      value: arch,
      writable: false,
      enumerable: true,
      configurable: true
    });
  }
});