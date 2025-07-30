#!/usr/bin/env node

/**
 * Storage Node Daemon Runner
 * This script runs the POA storage node as a standalone process
 * Can be used with system service managers or PM2
 */

const POAStorageNode = require('../storage/poa-storage-node');
const IPFSManager = require('../ipfs/ipfs-manager');
const path = require('path');
const os = require('os');

// Parse command line arguments
const args = process.argv.slice(2);
const configPath = args[0] || path.join(os.homedir(), '.spk-desktop', 'storage-config.json');

async function startDaemon() {
  console.log('Starting Storage Node daemon...');
  
  let config = {};
  
  // Load configuration if exists
  try {
    config = require(configPath);
  } catch (error) {
    console.log('No config file found, using defaults');
  }

  // Validate required config
  if (!config.account) {
    console.error('Error: account username is required in config');
    process.exit(1);
  }

  // Create managers
  const ipfsManager = new IPFSManager(config.ipfs || {});
  const storageNode = new POAStorageNode(config.storage || { account: config.account });

  // Handle shutdown gracefully
  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    await storageNode.stop();
    await ipfsManager.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    // Start IPFS first
    console.log('Starting IPFS...');
    await ipfsManager.start();
    const ipfsInfo = await ipfsManager.getNodeInfo();
    console.log('IPFS Node ID:', ipfsInfo.id);

    // Start storage node
    console.log('Starting POA storage node...');
    await storageNode.start();
    console.log('Storage node started successfully');

    // Monitor status
    storageNode.on('validation', (data) => {
      console.log('Validation:', data);
    });

    storageNode.on('contract-registered', (data) => {
      console.log('New contract:', data);
    });

    storageNode.on('earnings-update', (data) => {
      console.log('Earnings update:', data);
    });

    // Keep the process running
    setInterval(async () => {
      const ipfsPeers = await ipfsManager.getConnectedPeers();
      const storageStats = await storageNode.getStorageStats();
      console.log(`Status - IPFS peers: ${ipfsPeers.length}, Storage used: ${storageStats.spaceUsed}`);
    }, 60000); // Log status every minute

  } catch (error) {
    console.error('Failed to start storage daemon:', error);
    process.exit(1);
  }
}

// Start the daemon
startDaemon();