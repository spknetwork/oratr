# IPFS Options in Oratr (Lay-User Guide)

Oratr needs an IPFS node to store and fetch files. You have two easy choices:

- Option A (recommended): Let Oratr run IPFS for you
- Option B (advanced): Use your own IPFS

Either way, the goal is to have an IPFS API available on 127.0.0.1:5001 with PubSub enabled. PubSub is required for the Proof of Access (POA) storage node to communicate.

## TL;DR
- Click "Have Oratr run IPFS" in the setup wizard. You’re done.
- If you use your own IPFS, you must enable PubSub and restart IPFS:
  - ipfs config --json Pubsub.Enabled true
  - ipfs config --json Pubsub.Router '"gossipsub"'
  - Restart IPFS (systemctl, Docker restart, or re-run the daemon)

---

## Option A: Let Oratr run IPFS (Recommended)
When you choose the Internal Node option, Oratr runs a bundled IPFS (Kubo) for you and keeps it running in the background.

- What it sets up
  - API at 127.0.0.1:5001
  - Data path: ~/.oratr/ipfs (default)
  - PubSub enabled automatically (gossipsub)
  - Garbage collection enabled
  - CORS headers set for the app
- Storage limit
  - You can set the maximum disk space Oratr should use for IPFS in Settings → Storage → "Max Storage for Node (GB)".
- Life cycle & reliability
  - Oratr is designed to run in the background with a system tray icon. You can close the main window; Oratr keeps services running unless you fully quit from the tray.
  - For most users, simply leaving Oratr running is enough to keep your node available.
  - Proofs (POA) are awarded by lottery. The more your node is online, the better your chances to earn. Keeping Oratr up improves reliability and earning potential.
  - For 24/7 operation across reboots, you can also run IPFS as a background service (optional, see below).

### Run internal IPFS as a background service (optional)
If you prefer IPFS to run even when Oratr is fully quit or your user logs out:

- PM2 example (Linux/macOS)
  - npm install -g pm2
  - pm2 start ./src/core/daemon/ipfs-daemon.js --name spk-ipfs
- Docker alternative
  - You can also run a standard ipfs/kubo container (see Option B: Docker notes).

---

## Option B: Use your own IPFS (Advanced)
You can point Oratr to an existing IPFS node. Requirements:

- The IPFS node must be local (127.0.0.1). POA requires a local IPFS.
- The API should be accessible (default: 127.0.0.1:5001).
- PubSub must be enabled (gossipsub).

### How to enable PubSub (your own IPFS)
Run these commands where your IPFS runs (Kubo 0.26+):

```
ipfs config --json Pubsub.Enabled true
ipfs config --json Pubsub.Router '"gossipsub"'
```

Then restart IPFS. Examples:

- Systemd service (Linux)
  - sudo systemctl restart ipfs
- Docker container
  - docker exec -it <container> sh -lc "ipfs config --json Pubsub.Enabled true && ipfs config --json Pubsub.Router '"gossipsub"' && ipfs shutdown || true"
  - docker restart <container>
- Windows/macOS (manual daemon)
  - Stop your running `ipfs daemon`, then start it again.

Tip (older Kubo versions): If your version predates PubSub defaults, you may also need the legacy flag when starting:

```
ipfs daemon --enable-pubsub-experiment
```

### Verify PubSub is enabled
- ipfs config show | grep -A5 Pubsub
- Oratr’s setup wizard will also check PubSub and prompt you to enable it if needed.

### Point Oratr at your node
In the setup wizard, choose “External Node” and enter:

- Host: 127.0.0.1
- Port: 5001 (or your configured API port)

Click Save Configuration and continue.

---

## Common gotchas
- PubSub disabled
  - Symptoms: POA won’t start; Oratr prompts that PubSub is required.
  - Fix: Enable PubSub as shown above, restart IPFS.
- Remote/non-local API
  - POA requires a local IPFS (127.0.0.1). Remote IPFS nodes are not supported for POA.
- API not listening on 5001
  - If you changed the API port, update the port in Oratr’s external IPFS settings.
- Old IPFS version
  - On older Kubo versions you may need --enable-pubsub-experiment when starting the daemon.

---

## Where files are stored
- Internal IPFS (managed by Oratr): ~/.oratr/ipfs by default.
- Your own IPFS: your node’s configured IPFS_PATH (e.g., ~/.ipfs).

## How to change the internal data path
- In the wizard, Internal Node > Data Path shows the location.

## 24/7 operation
For constant availability:
- Use PM2 to run ipfs-daemon.js (internal), or
- Run your own system-level IPFS (systemd, Docker, Windows service).

---

## Troubleshooting
- "POA only supports local IPFS nodes"
  - Switch to the internal node or run your own IPFS on 127.0.0.1.
- "IPFS not accessible"
  - Make sure the daemon is running and API is reachable at Host:Port.
- "PubSub not enabled"
  - Re-run the PubSub commands and restart IPFS.

---

## Related docs in this folder
- IPFS_PUBSUB_FIX.md – background notes and commands
- POA_INTEGRATION.md – additional POA/IPFS notes

This page is written for lay-users. We’ll improve formatting and in-app rendering later.
