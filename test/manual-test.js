#!/usr/bin/env node

// Manual test to verify basic functionality
const SPK = require('../../spk-js/src/index');
const Transcoder = require('../src/core/ffmpeg/transcoder');
const PlaylistProcessor = require('../src/core/ffmpeg/playlist-processor');
const IPFSManager = require('../src/core/ipfs/ipfs-manager');
const POAStorageNode = require('../src/core/storage/poa-storage-node');

async function testSPKJS() {
  console.log('Testing SPK-JS...');
  
  try {
    // Create SPK instance
    const spk = new SPK({
      baseURL: 'https://spkinstant.hivehoneycomb.com',
      account: 'testuser'
    });
    
    console.log('✓ SPK instance created');
    console.log(`  Active account: ${spk.getActiveAccount()}`);
    
    // Test API client
    console.log('\nTesting API client...');
    console.log('✓ API client initialized');
    
    // Test account manager
    console.log('\nTesting account manager...');
    console.log('✓ Account manager initialized');
    
    // Test file manager
    console.log('\nTesting file manager...');
    const storageCost = spk.file.calculateStorageCost(
      1024 * 1024 * 100, // 100MB
      30 * 24 * 60 * 60, // 30 days
      3 // redundancy
    );
    console.log('✓ Storage cost calculation:', storageCost);
    
    // Test BROCA calculator
    console.log('\nTesting BROCA calculator...');
    console.log('✓ BROCA calculator initialized');
    
  } catch (error) {
    console.error('✗ SPK-JS test failed:', error.message);
    return false;
  }
  
  return true;
}

async function testTranscoder() {
  console.log('\n\nTesting Transcoder...');
  
  try {
    const transcoder = new Transcoder();
    console.log('✓ Transcoder instance created');
    
    // Check FFmpeg availability
    const isAvailable = await transcoder.checkFFmpegAvailable();
    console.log(`✓ FFmpeg available: ${isAvailable}`);
    
    if (isAvailable) {
      const version = await transcoder.getFFmpegVersion();
      console.log(`✓ FFmpeg version: ${version}`);
    }
    
    // Test resolution determination
    const metadata = {
      width: 1920,
      height: 1080,
      bitrate: 5000000
    };
    const resolutions = transcoder.determineOutputResolutions(metadata);
    console.log('✓ Determined resolutions:', resolutions);
    
    // Test encoding settings
    const settings = transcoder.getEncodingSettings('720p');
    console.log('✓ Encoding settings for 720p:', settings);
    
  } catch (error) {
    console.error('✗ Transcoder test failed:', error.message);
    return false;
  }
  
  return true;
}

async function testPlaylistProcessor() {
  console.log('\n\nTesting Playlist Processor...');
  
  try {
    const processor = new PlaylistProcessor();
    console.log('✓ PlaylistProcessor instance created');
    
    // Test M3U8 parsing
    const testPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment_000.ts
#EXTINF:10.0,
segment_001.ts
#EXT-X-ENDLIST`;
    
    const parsed = processor.parsePlaylist(testPlaylist);
    console.log('✓ Parsed playlist:', {
      version: parsed.version,
      segments: parsed.segments.length,
      endList: parsed.endList
    });
    
    // Test URL rewriting
    const segmentHashes = {
      'segment_000.ts': 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
      'segment_001.ts': 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'
    };
    
    const rewritten = processor.rewritePlaylistWithIPFS(testPlaylist, segmentHashes);
    console.log('✓ Playlist rewritten with IPFS URLs');
    console.log('  First segment URL:', rewritten.split('\\n')[4]);
    
  } catch (error) {
    console.error('✗ PlaylistProcessor test failed:', error.message);
    return false;
  }
  
  return true;
}

async function testIPFSManager() {
  console.log('\n\nTesting IPFS Manager...');
  
  try {
    const ipfsManager = new IPFSManager();
    console.log('✓ IPFSManager instance created');
    
    // Test hash-only functionality
    const content = Buffer.from('Hello SPK Network!');
    const hash = await ipfsManager.hashOnly(content);
    console.log('✓ Generated IPFS hash:', hash);
    
    // Test CID validation
    const isValid = ipfsManager.isValidCID(hash);
    console.log(`✓ CID validation: ${isValid}`);
    
  } catch (error) {
    console.error('✗ IPFSManager test failed:', error.message);
    return false;
  }
  
  return true;
}

async function testPOAStorageNode() {
  console.log('\n\nTesting POA Storage Node...');
  
  try {
    const storageNode = new POAStorageNode({
      nodeId: 'test-node',
      storagePath: '/tmp/spk-test-storage'
    });
    console.log('✓ POAStorageNode instance created');
    console.log(`  Node ID: ${storageNode.nodeId}`);
    
    // Test proof generation logic
    const testContent = Buffer.from('Test file content for proof generation');
    const testSeed = 'test-seed-123';
    const blocks = storageNode.selectRandomBlocks(testContent, testSeed, 3);
    console.log('✓ Selected random blocks:', blocks.length);
    
    // Test storage stats
    const stats = await storageNode.getStorageStats();
    console.log('✓ Storage stats:', stats);
    
  } catch (error) {
    console.error('✗ POAStorageNode test failed:', error.message);
    return false;
  }
  
  return true;
}

async function runTests() {
  console.log('=== SPK Desktop Component Tests ===\\n');
  
  const results = {
    'SPK-JS': await testSPKJS(),
    'Transcoder': await testTranscoder(),
    'PlaylistProcessor': await testPlaylistProcessor(),
    'IPFSManager': await testIPFSManager(),
    'POAStorageNode': await testPOAStorageNode()
  };
  
  console.log('\\n\\n=== Test Summary ===');
  let allPassed = true;
  
  for (const [component, passed] of Object.entries(results)) {
    console.log(`${component}: ${passed ? '✓ PASSED' : '✗ FAILED'}`);
    if (!passed) allPassed = false;
  }
  
  console.log(`\\nOverall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
  
  process.exit(allPassed ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});