const { EventEmitter } = require('events');

/**
 * ContractCoordinator
 * Coordinates storage contracts across multiple Oratr nodes owned by the same user
 * using IPFS PubSub. Nodes gossip their active contract set so only one node in
 * the user cluster stores a given contract at a time. If a node goes offline,
 * others may pick up profitable missing contracts.
 */
class ContractCoordinator extends EventEmitter {
  constructor({ ipfsManager, username, servicesApiBase }) {
    super();
    this.ipfsManager = ipfsManager;
    this.username = username;
    this.servicesApiBase = servicesApiBase || 'https://spktest.dlux.io';

    this.topic = `oratr.cluster.${this.username}`;

    // Local state
    this.knownPeers = new Map(); // peerId -> lastSeenTs
    this.peerClaims = new Map(); // contractId -> { peerId, timestamp }
    this.localContracts = new Set(); // contractIds this node is storing
    this.pendingDecisions = new Map(); // contractId -> timeout

    // Self identity
    this.peerId = null;
    this.subHandler = null;
  }

  async start() {
    if (!this.ipfsManager || !this.ipfsManager.client) {
      throw new Error('IPFS manager must be started before coordinator');
    }

    // Resolve peer id
    const info = await this.ipfsManager.getNodeInfo();
    this.peerId = typeof info.id === 'object' ? info.id.toString() : info.id;

    // Subscribe to topic
    this.subHandler = await this.ipfsManager.subscribe(this.topic, (msg) => this.onMessage(msg));

    // Send presence
    await this.publish({ type: 'HELLO', peerId: this.peerId, ts: Date.now() });

    // Periodic presence beacons
    this.beacon = setInterval(() => {
      this.publish({ type: 'BEACON', peerId: this.peerId, ts: Date.now(), contracts: Array.from(this.localContracts) });
      this.gcPeers();
    }, 15000);

    this.emit('started', { topic: this.topic, peerId: this.peerId });
  }

  async stop() {
    if (this.beacon) clearInterval(this.beacon);
    if (this.subHandler) await this.ipfsManager.unsubscribe(this.topic, this.subHandler);
    this.emit('stopped');
  }

  async publish(payload) {
    const message = { v: 1, ...payload };
    return this.ipfsManager.publish(this.topic, message);
  }

  // Called by app when we start/stop storing a contract
  async claimContract(contractId) {
    this.localContracts.add(contractId);
    await this.publish({ type: 'CLAIM', peerId: this.peerId, contractId, ts: Date.now() });
  }

  async releaseContract(contractId) {
    this.localContracts.delete(contractId);
    await this.publish({ type: 'RELEASE', peerId: this.peerId, contractId, ts: Date.now() });
  }

  // Handle inbound messages
  async onMessage(msg) {
    const { type } = msg || {};
    if (!type) return;

    // Record presence
    if (msg.peerId && msg.peerId !== this.peerId) {
      this.knownPeers.set(msg.peerId, Date.now());
    }

    switch (type) {
      case 'HELLO':
      case 'BEACON':
        // Merge advertised contracts as claims with a fresh timestamp
        if (Array.isArray(msg.contracts)) {
          for (const c of msg.contracts) {
            this.updateClaim(c, msg.peerId, msg.ts || Date.now());
          }
        }
        break;
      case 'CLAIM':
        this.updateClaim(msg.contractId, msg.peerId, msg.ts || Date.now());
        break;
      case 'RELEASE':
        if (this.peerClaims.get(msg.contractId)?.peerId === msg.peerId) {
          this.peerClaims.delete(msg.contractId);
        }
        break;
      case 'WHO_HAS':
        // Respond with claim if we store it
        if (this.localContracts.has(msg.contractId)) {
          await this.publish({ type: 'CLAIM', peerId: this.peerId, contractId: msg.contractId, ts: Date.now() });
        }
        break;
      default:
        break;
    }

    this.emit('state', this.getState());
  }

  updateClaim(contractId, peerId, ts) {
    if (!contractId || !peerId) return;
    const existing = this.peerClaims.get(contractId);
    if (!existing || existing.ts < ts) {
      this.peerClaims.set(contractId, { peerId, ts });
    }
  }

  // Decide whether we should pick up a contract not currently claimed
  async considerContract(contract) {
    const id = contract.id || contract.contractId;
    if (!id) return false;

    const claim = this.peerClaims.get(id);
    const hasActiveClaim = claim && (Date.now() - claim.ts) < 60000; // 60s freshness
    if (hasActiveClaim) return false;

    // Avoid thrashing: stagger with small random backoff
    if (this.pendingDecisions.has(id)) return false;
    const timeout = setTimeout(async () => {
      this.pendingDecisions.delete(id);
      // Re-check claim after backoff
      const c = this.peerClaims.get(id);
      const stillUnclaimed = !c || (Date.now() - c.ts) >= 60000;
      if (stillUnclaimed) {
        this.emit('should-store', contract);
      }
    }, 3000 + Math.floor(Math.random() * 4000));
    this.pendingDecisions.set(id, timeout);
    return true;
  }

  // Garbage-collect stale peers/claims
  gcPeers() {
    const now = Date.now();
    for (const [peerId, ts] of this.knownPeers.entries()) {
      if (now - ts > 5 * 60 * 1000) this.knownPeers.delete(peerId);
    }
    for (const [cid, claim] of this.peerClaims.entries()) {
      if (now - claim.ts > 2 * 60 * 1000) this.peerClaims.delete(cid);
    }
  }

  getState() {
    return {
      topic: this.topic,
      peerId: this.peerId,
      peers: Array.from(this.knownPeers.keys()),
      claims: Array.from(this.peerClaims.entries()).map(([k, v]) => ({ contractId: k, ...v })),
      localContracts: Array.from(this.localContracts)
    };
  }
}

module.exports = ContractCoordinator;


