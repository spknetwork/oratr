# IPFS PubSub Configuration Fix

## Issue

Your IPFS node has PubSub enabled via the command line flag `--enable-pubsub-experiment`, but the configuration is missing the PubSub router setting.

## Solution

Add the PubSub router configuration to your IPFS config:

```bash
# Set the PubSub router (gossipsub is recommended)
ipfs config --json Pubsub.Router '"gossipsub"'

# Enable PubSub in the config (in addition to the command line flag)
ipfs config --json Pubsub.Enabled true

# Optional: Configure PubSub parameters for better performance
ipfs config --json Pubsub.StrictSignatureVerification false
ipfs config --json Pubsub.DisableSigning false

# Restart IPFS
sudo systemctl restart ipfs
```

## Verify Configuration

After making changes, verify:

```bash
# Check the config
ipfs config show | grep -A5 Pubsub

# Test PubSub functionality
ipfs pubsub ls
```

The output should show:
```json
"Pubsub": {
  "Router": "gossipsub",
  "DisableSigning": false,
  "Enabled": true
}
```

## Router Options

- **gossipsub** (recommended): More efficient, better for larger networks
- **floodsub**: Simple flooding approach, works but less efficient

## For SPK Desktop Integration

The POA storage node requires PubSub to communicate with validators. Without a properly configured router, the node won't be able to participate in the proof-of-access protocol.