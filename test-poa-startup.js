#!/usr/bin/env node

const POAStorageNode = require('./src/core/storage/poa-storage-node');
const path = require('path');
const os = require('os');

async function testPOA() {
  console.log('Testing POA startup with correct data directory...\n');
  
  const poaNode = new POAStorageNode({
    account: 'testuser',
    dataPath: path.join(os.homedir(), '.oratr', 'poa-test'),
    nodeType: 2,
    ipfsPort: 5001,
    ipfsHost: '127.0.0.1',
    maxStorage: 10 * 1024 * 1024 * 1024 // 10GB
  });
  
  console.log('POA Configuration:');
  console.log('- Data Path:', poaNode.config.dataPath);
  console.log('- Account:', poaNode.config.account);
  console.log('- Node Type:', poaNode.config.nodeType === 2 ? 'Storage' : 'Validator');
  console.log('- IPFS Port:', poaNode.config.ipfsPort);
  console.log('\nStarting POA...\n');
  
  // Listen for logs
  poaNode.on('log', (log) => {
    console.log(`[${log.level.toUpperCase()}] ${log.message}`);
  });
  
  poaNode.on('error', (error) => {
    console.error('POA Error:', error);
  });
  
  try {
    await poaNode.start();
    console.log('\n✅ POA started successfully!');
    console.log('Running for 10 seconds to check for data directory errors...\n');
    
    // Run for 10 seconds to see if data directory is created properly
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log('\nStopping POA...');
    await poaNode.stop();
    console.log('✅ POA stopped successfully!');
    
    // Check if data directory was created
    const fs = require('fs').promises;
    const dataDir = path.join(poaNode.config.dataPath, 'data');
    try {
      const stats = await fs.stat(dataDir);
      if (stats.isDirectory()) {
        console.log(`✅ Data directory created at: ${dataDir}`);
        const files = await fs.readdir(dataDir);
        console.log('  Files created:', files.join(', ') || 'none');
      }
    } catch (e) {
      console.log(`ℹ️  Data directory not found at: ${dataDir}`);
    }
    
  } catch (error) {
    console.error('\n❌ Failed to start POA:', error.message);
    process.exit(1);
  }
}

testPOA().catch(console.error);