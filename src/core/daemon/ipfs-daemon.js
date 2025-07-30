#!/usr/bin/env node

/**
 * IPFS Daemon Runner
 * This script runs IPFS as a standalone process
 * Can be used with system service managers or PM2
 */

const IPFSManager = require('../ipfs/ipfs-manager');
const path = require('path');
const os = require('os');

// Parse command line arguments
const args = process.argv.slice(2);
const configPath = args[0] || path.join(os.homedir(), '.spk-desktop', 'ipfs-config.json');

async function startDaemon() {
  console.log('Starting IPFS daemon...');
  
  let config = {};
  
  // Load configuration if exists
  try {
    config = require(configPath);
  } catch (error) {
    console.log('No config file found, using defaults');
  }

  // Create IPFS manager
  const ipfsManager = new IPFSManager(config);

  // Handle shutdown gracefully
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await ipfsManager.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await ipfsManager.stop();
    process.exit(0);
  });

  // Start IPFS
  try {
    await ipfsManager.start();
    console.log('IPFS daemon started successfully');
    
    // Log node info
    const info = await ipfsManager.getNodeInfo();
    console.log('Node ID:', info.id);
    console.log('Addresses:', info.addresses);

    // Keep the process running
    setInterval(async () => {
      const peers = await ipfsManager.getConnectedPeers();
      console.log(`Connected peers: ${peers.length}`);
    }, 60000); // Log peer count every minute

  } catch (error) {
    console.error('Failed to start IPFS daemon:', error);
    process.exit(1);
  }
}

// Start the daemon
startDaemon();