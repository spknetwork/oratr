const IPFSManager = require('../../../../src/core/ipfs/ipfs-manager');
const { Buffer } = require('buffer');

describe('IPFSManager', () => {
  let ipfsManager;

  beforeEach(() => {
    ipfsManager = new IPFSManager();
  });

  afterEach(async () => {
    await ipfsManager.stop();
  });

  describe('initialization', () => {
    test('should create IPFS manager instance', () => {
      expect(ipfsManager).toBeDefined();
      expect(ipfsManager).toBeInstanceOf(IPFSManager);
    });

    test('should start IPFS node', async () => {
      await ipfsManager.start();
      expect(ipfsManager.isRunning()).toBe(true);
    });

    test('should stop IPFS node', async () => {
      await ipfsManager.start();
      await ipfsManager.stop();
      expect(ipfsManager.isRunning()).toBe(false);
    });

    test('should get node info', async () => {
      await ipfsManager.start();
      const info = await ipfsManager.getNodeInfo();
      
      expect(info).toHaveProperty('id');
      expect(info).toHaveProperty('version');
      expect(info).toHaveProperty('addresses');
      expect(info.addresses).toBeInstanceOf(Array);
    });
  });

  describe('file operations', () => {
    beforeEach(async () => {
      await ipfsManager.start();
    });

    test('should add file to IPFS', async () => {
      const content = Buffer.from('Hello SPK Network!');
      const result = await ipfsManager.addFile(content, 'hello.txt');
      
      expect(result).toHaveProperty('cid');
      expect(result).toHaveProperty('size');
      expect(result.cid).toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
    });

    test('should add file with options', async () => {
      const content = Buffer.from('Test content');
      const options = {
        pin: true,
        wrapWithDirectory: false,
        chunker: 'size-262144'
      };
      
      const result = await ipfsManager.addFile(content, 'test.txt', options);
      
      expect(result).toHaveProperty('cid');
      expect(result).toHaveProperty('pinned', true);
    });

    test('should get file from IPFS', async () => {
      const originalContent = Buffer.from('Retrieved content');
      const { cid } = await ipfsManager.addFile(originalContent, 'retrieve.txt');
      
      const retrievedContent = await ipfsManager.getFile(cid);
      
      expect(retrievedContent).toEqual(originalContent);
    });

    test('should pin file', async () => {
      const content = Buffer.from('Pin this');
      const { cid } = await ipfsManager.addFile(content, 'pin.txt', { pin: false });
      
      const pinResult = await ipfsManager.pinFile(cid);
      
      expect(pinResult).toBe(true);
      
      const isPinned = await ipfsManager.isPinned(cid);
      expect(isPinned).toBe(true);
    });

    test('should unpin file', async () => {
      const content = Buffer.from('Unpin this');
      const { cid } = await ipfsManager.addFile(content, 'unpin.txt', { pin: true });
      
      const unpinResult = await ipfsManager.unpinFile(cid);
      
      expect(unpinResult).toBe(true);
      
      const isPinned = await ipfsManager.isPinned(cid);
      expect(isPinned).toBe(false);
    });

    test('should list pinned files', async () => {
      const content1 = Buffer.from('File 1');
      const content2 = Buffer.from('File 2');
      
      const { cid: cid1 } = await ipfsManager.addFile(content1, 'file1.txt');
      const { cid: cid2 } = await ipfsManager.addFile(content2, 'file2.txt');
      
      const pinnedFiles = await ipfsManager.listPinnedFiles();
      
      expect(pinnedFiles).toContainEqual(expect.objectContaining({ cid: cid1 }));
      expect(pinnedFiles).toContainEqual(expect.objectContaining({ cid: cid2 }));
    });
  });

  describe('hash-only operations', () => {
    test('should generate IPFS hash without adding to node', async () => {
      const content = Buffer.from('Hash only content');
      const hash = await ipfsManager.hashOnly(content);
      
      expect(hash).toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
      
      // Verify file is not actually stored
      await expect(ipfsManager.getFile(hash)).rejects.toThrow();
    });

    test('should generate same hash for same content', async () => {
      const content = Buffer.from('Identical content');
      
      const hash1 = await ipfsManager.hashOnly(content);
      const hash2 = await ipfsManager.hashOnly(content);
      
      expect(hash1).toBe(hash2);
    });

    test('should generate different hashes for different content', async () => {
      const content1 = Buffer.from('Content 1');
      const content2 = Buffer.from('Content 2');
      
      const hash1 = await ipfsManager.hashOnly(content1);
      const hash2 = await ipfsManager.hashOnly(content2);
      
      expect(hash1).not.toBe(hash2);
    });

    test('should support custom chunking for hash-only', async () => {
      const content = Buffer.from('Large content to be chunked');
      const options = { chunker: 'size-262144' };
      
      const hash = await ipfsManager.hashOnly(content, options);
      
      expect(hash).toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
    });
  });

  describe('storage management', () => {
    beforeEach(async () => {
      await ipfsManager.start();
    });

    test('should get storage stats', async () => {
      const stats = await ipfsManager.getStorageStats();
      
      expect(stats).toHaveProperty('repoSize');
      expect(stats).toHaveProperty('storageMax');
      expect(stats).toHaveProperty('numObjects');
      expect(typeof stats.repoSize).toBe('number');
    });

    test('should run garbage collection', async () => {
      // Add and unpin a file
      const content = Buffer.from('Garbage collect this');
      const { cid } = await ipfsManager.addFile(content, 'garbage.txt');
      await ipfsManager.unpinFile(cid);
      
      const gcResult = await ipfsManager.runGarbageCollection();
      
      expect(gcResult).toHaveProperty('removed');
      expect(gcResult.removed).toBeInstanceOf(Array);
    });

    test('should check available storage space', async () => {
      const hasSpace = await ipfsManager.hasStorageSpace(1024 * 1024); // 1MB
      
      expect(typeof hasSpace).toBe('boolean');
    });
  });

  describe('batch operations', () => {
    beforeEach(async () => {
      await ipfsManager.start();
    });

    test('should add multiple files in batch', async () => {
      const files = [
        { content: Buffer.from('File 1'), name: 'file1.txt' },
        { content: Buffer.from('File 2'), name: 'file2.txt' },
        { content: Buffer.from('File 3'), name: 'file3.txt' }
      ];
      
      const results = await ipfsManager.addFiles(files);
      
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toHaveProperty('cid');
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('size');
      });
    });

    test('should hash multiple files without adding', async () => {
      const files = [
        { content: Buffer.from('Hash 1'), name: 'hash1.txt' },
        { content: Buffer.from('Hash 2'), name: 'hash2.txt' }
      ];
      
      const hashes = await ipfsManager.hashFiles(files);
      
      expect(hashes).toHaveLength(2);
      hashes.forEach(hash => {
        expect(hash).toHaveProperty('name');
        expect(hash).toHaveProperty('hash');
        expect(hash.hash).toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
      });
    });
  });

  describe('network operations', () => {
    beforeEach(async () => {
      await ipfsManager.start();
    });

    test('should get connected peers', async () => {
      const peers = await ipfsManager.getConnectedPeers();
      
      expect(peers).toBeInstanceOf(Array);
      peers.forEach(peer => {
        expect(peer).toHaveProperty('addr');
        expect(peer).toHaveProperty('peer');
      });
    });

    test('should connect to peer', async () => {
      const peerAddress = '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ';
      
      await expect(ipfsManager.connectToPeer(peerAddress)).resolves.not.toThrow();
    });

    test('should get bandwidth stats', async () => {
      const stats = await ipfsManager.getBandwidthStats();
      
      expect(stats).toHaveProperty('totalIn');
      expect(stats).toHaveProperty('totalOut');
      expect(stats).toHaveProperty('rateIn');
      expect(stats).toHaveProperty('rateOut');
    });
  });

  describe('error handling', () => {
    test('should handle node not started', async () => {
      await expect(ipfsManager.addFile(Buffer.from('test'), 'test.txt'))
        .rejects.toThrow('IPFS node is not running');
    });

    test('should handle invalid CID', async () => {
      await ipfsManager.start();
      
      await expect(ipfsManager.getFile('invalid-cid'))
        .rejects.toThrow('Invalid CID');
    });

    test('should handle file not found', async () => {
      await ipfsManager.start();
      const nonExistentCid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
      
      await expect(ipfsManager.getFile(nonExistentCid))
        .rejects.toThrow(/not found|timeout/i);
    });

    test('should handle network errors gracefully', async () => {
      await ipfsManager.start();
      const invalidPeer = '/ip4/999.999.999.999/tcp/4001/p2p/invalid';
      
      await expect(ipfsManager.connectToPeer(invalidPeer))
        .rejects.toThrow();
    });
  });

  describe('configuration', () => {
    test('should use custom IPFS configuration', async () => {
      const customConfig = {
        repo: '/custom/ipfs/repo',
        config: {
          Bootstrap: [],
          Addresses: {
            Swarm: ['/ip4/0.0.0.0/tcp/4002']
          }
        }
      };
      
      const customManager = new IPFSManager(customConfig);
      await customManager.start();
      
      const info = await customManager.getNodeInfo();
      expect(info.addresses).toContainEqual(expect.stringContaining('4002'));
      
      await customManager.stop();
    });

    test('should handle repo migration', async () => {
      const needsMigration = await ipfsManager.checkRepoMigration();
      
      if (needsMigration) {
        await expect(ipfsManager.migrateRepo()).resolves.not.toThrow();
      }
    });
  });
});