#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function testPOAWithData() {
  const dataPath = path.join(os.homedir(), '.oratr', 'poa-test-with-data');
  const poaDataDir = path.join(dataPath, 'data');
  
  console.log('Creating directories:');
  console.log('- Base:', dataPath);
  console.log('- Data:', poaDataDir);
  
  await fs.mkdir(dataPath, { recursive: true });
  await fs.mkdir(poaDataDir, { recursive: true });
  
  const binaryPath = path.join(__dirname, 'node_modules/@disregardfiat/proofofaccess/bin/proofofaccess-linux-amd64');
  
  const args = [
    '-node', '2',
    '-username', 'testuser',
    '-IPFS_PORT=5001',
    '-useWS',
    '-url=https://spktest.dlux.io',
    '-WS_PORT=8003',
    '-validators=https://spktest.dlux.io/services/VAL',
    '-storageLimit=10'
  ];
  
  console.log('\nStarting POA...');
  console.log('Binary:', binaryPath);
  console.log('CWD:', dataPath);
  
  const proc = spawn(binaryPath, args, {
    cwd: dataPath,
    env: process.env
  });
  
  proc.stdout.on('data', (data) => {
    console.log('OUT:', data.toString().trim());
  });
  
  proc.stderr.on('data', (data) => {
    console.log('ERR:', data.toString().trim());
  });
  
  proc.on('exit', async (code) => {
    console.log('\nProcess exited with code:', code);
    
    // Check what was created
    try {
      const files = await fs.readdir(poaDataDir);
      console.log('✅ Files in data directory:', files.length > 0 ? files : 'none');
      
      // Check subdirectories
      for (const file of files) {
        const filePath = path.join(poaDataDir, file);
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
          const subfiles = await fs.readdir(filePath);
          console.log(`  ${file}/: ${subfiles.length} files`);
        }
      }
    } catch (e) {
      console.log('❌ Error reading data directory:', e.message);
    }
  });
  
  // Kill after 10 seconds
  setTimeout(() => {
    console.log('\nStopping POA...');
    proc.kill('SIGTERM');
  }, 10000);
}

testPOAWithData().catch(console.error);