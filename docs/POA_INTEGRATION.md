# POA (Proof of Access) Integration Guide

## Overview

SPK Desktop now includes integrated support for running a POA (Proof of Access) storage node. This allows users to:

- **Earn rewards** by providing storage to the SPK Network
- **Validate** storage proofs (advanced users)
- **Participate** in the decentralized storage network
- **Monitor** earnings and performance

## Architecture

The POA integration consists of:

1. **POA Process Manager** - Spawns and manages the POA binary as a child process
2. **POA Service** - Main process service handling IPC and configuration
3. **POA API** - Renderer process API for UI communication
4. **POA Control Panel** - User interface for configuration and monitoring

## Setup Requirements

### 1. Fix IPFS PubSub Configuration

POA requires IPFS with PubSub properly configured:

```bash
# Set the PubSub router
ipfs config --json Pubsub.Router '"gossipsub"'

# Enable PubSub
ipfs config --json Pubsub.Enabled true

# Restart IPFS
sudo systemctl restart ipfs
```

### 2. Download POA Binary

The POA binary needs to be downloaded and placed in:
- **Linux/Mac**: `~/.spk-desktop/poa/proofofaccess`
- **Windows**: `%APPDATA%/spk-desktop/poa/proofofaccess.exe`

Download from: https://github.com/spknetwork/proofofaccess/releases

### 3. Configure SPK Account

You'll need:
- SPK account name
- Private posting key (for signing proofs)

## Usage

### Starting POA Node

1. Open SPK Desktop
2. Navigate to the POA Control Panel
3. Click "Configure" and enter:
   - Account name
   - Private key
   - Node type (Storage or Validator)
   - Maximum storage allocation
4. Click "Save Configuration"
5. Click "Start Node"

### Node Types

- **Storage Node (Type 2)**: Stores files and earns rewards
- **Validator Node (Type 1)**: Validates storage proofs (requires more resources)

### Monitoring

The control panel shows:
- Node status (running/stopped)
- Process ID
- Configuration details
- Activity logs
- Validation events
- Storage operations

## Technical Details

### Process Management

POA runs as a spawned child process with:
- Automatic restart on crash (configurable)
- Detached mode (survives parent exit)
- Log capture and parsing
- Graceful shutdown handling

### Configuration

POA configuration is stored in:
```
~/.spk-desktop/poa-config.json
```

Contains:
- Account credentials
- Node type
- Storage limits
- Network endpoints

### IPC Communication

The renderer communicates with POA via:
```javascript
// Start POA
await window.api.poa.start({
  account: 'myaccount',
  privateKey: 'myprivatekey',
  nodeType: 2,
  maxStorage: 100 * 1024 * 1024 * 1024 // 100GB
});

// Monitor events
window.api.poa.on('validation', (data) => {
  console.log('Validation event:', data);
});

// Get status
const status = await window.api.poa.getStatus();
```

### Event Types

POA emits these events:
- `started` - Process started
- `stopped` - Process stopped
- `crashed` - Process crashed
- `validation` - Validation request/response
- `storage` - File storage event
- `connected` - Connected to network
- `error` - Error occurred
- `log` - Log message

## Troubleshooting

### POA Won't Start

1. Check IPFS is running: `ipfs id`
2. Verify PubSub config: `ipfs config show | grep Pubsub`
3. Ensure binary is executable: `chmod +x ~/.spk-desktop/poa/proofofaccess`
4. Check logs in the control panel

### IPFS PubSub Error

If you see "Router is missing":
```bash
ipfs config --json Pubsub.Router '"gossipsub"'
ipfs daemon --enable-pubsub-experiment
```

### Permission Denied

On Linux/Mac:
```bash
chmod +x ~/.spk-desktop/poa/proofofaccess
```

### High CPU Usage

- Validator nodes use more CPU
- Consider switching to storage node
- Adjust max storage allocation

## Security

- Private keys are stored locally
- Never share your private key
- Keys are not saved in config files
- Use posting key, not active key

## Rewards

Storage nodes earn rewards based on:
- Storage provided
- Uptime
- Successful validations
- Network demand

Check earnings in your SPK wallet.

## Storage Dashboard Notes

### Storage Used

- Source of truth: Honeygraph `stored-by` API at `https://honeygraph.dlux.io/api/spk/contracts/stored-by/:account`.
- Computation: UI displays the sum of `totalSize` (bytes) across all returned contracts, pretty-printed using powers of 1024 (KB/MB/GB).
- Rationale: `totalSize` reflects on-chain contract sizes and avoids confusion with IPFS repo metrics or per-node utilization.

Note: IPFS repo size and free space are still queried for diagnostics, but they do not drive the “Storage Used” card.

### Multi-node Coordination (Gossip)

When multiple Oratr instances run under the same account, they coordinate via IPFS PubSub to avoid duplicating storage for the same contract.

- Topic: `oratr.cluster.<username>`
- Transport: IPFS PubSub (gossipsub). Ensure PubSub is enabled; see IPFS options.
- Presence: Nodes publish `HELLO` on start and periodic `BEACON` messages containing their current contract claims.
- Contract ownership: A node that takes responsibility for a contract publishes `CLAIM { contractId }`; on release it sends `RELEASE`.
- Discovery: Nodes may ask `WHO_HAS { contractId }` and any holder responds with `CLAIM`.
- Staleness: Claims expire if not refreshed for 60s; peers expire after 5m.
- Backoff: When a contract appears unclaimed, nodes use a randomized 3–7s backoff before attempting to pick it up, then verify it’s still unclaimed.

This protocol is implemented by the app’s coordinator and is designed to map directly to CLI nodes.

Example services registry endpoint used to find sibling nodes for an account: [`https://spktest.dlux.io/user_services/<username>`](https://spktest.dlux.io/user_services/dlux-io).

## Advanced Configuration

### Custom Binary Location

```javascript
await window.api.poa.updateConfig({
  binaryPath: '/custom/path/to/proofofaccess'
});
```

### Debug Mode

```javascript
await window.api.poa.start({
  debug: true
});
```

### Manual Process Management

```javascript
// Force stop
await window.api.poa.stop(true);

// Disable auto-restart
await window.api.poa.updateConfig({
  autoRestart: false
});
```

## Future Enhancements

- Automatic binary download
- Earnings dashboard
- Performance metrics
- Network visualization
- Multi-node support

## Support

For POA issues:
- Check logs in control panel
- Verify IPFS configuration
- Ensure account has LARYNX tokens
- Join SPK Network Discord