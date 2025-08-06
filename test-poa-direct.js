#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function testPOADirect() {
  const dataPath = path.join(os.homedir(), '.oratr', 'poa-test-direct');
  
  console.log('Creating data directory:', dataPath);
  await fs.mkdir(dataPath, { recursive: true });
  
  const binaryPath = path.join(__dirname, 'node_modules/@disregardfiat/proofofaccess/bin/proofofaccess-linux-amd64');
  
  const args = [
    '-node', '2',
    '-username', 'testuser',
    '-IPFS_PORT=5001',
    '-useWS',
    '-url=https://spktest.dlux.io',
    '-WS_PORT=8002',
    '-validators=https://spktest.dlux.io/services/VAL',
    '-storageLimit=10'
  ];
  
  console.log('Binary path:', binaryPath);
  console.log('Working directory:', dataPath);
  console.log('Args:', args.join(' '));
  
  const proc = spawn(binaryPath, args, {
    cwd: dataPath,  // This should make POA create ./data relative to dataPath
    env: process.env
  });
  
  proc.stdout.on('data', (data) => {
    console.log('STDOUT:', data.toString());
  });
  
  proc.stderr.on('data', (data) => {
    console.log('STDERR:', data.toString());
  });
  
  proc.on('exit', async (code) => {
    console.log('Process exited with code:', code);
    
    // Check if data directory was created
    try {
      const dataDir = path.join(dataPath, 'data');
      const stats = await fs.stat(dataDir);
      if (stats.isDirectory()) {
        console.log('✅ Data directory created at:', dataDir);
        const files = await fs.readdir(dataDir);
        console.log('Files:', files);
      }
    } catch (e) {
      console.log('❌ Data directory not created');
    }
  });
  
  // Kill after 5 seconds
  setTimeout(() => {
    console.log('Stopping POA...');
    proc.kill();
  }, 5000);
}

testPOADirect().catch(console.error);