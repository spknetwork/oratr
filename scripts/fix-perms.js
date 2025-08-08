#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function chmodIfExists(p) {
  try {
    fs.chmodSync(p, 0o755);
    console.log(`[fix-perms] set +x on ${p}`);
  } catch (e) {
    // ignore if not found
  }
}

try {
  const root = process.cwd();
  const base = path.join(root, 'node_modules', '@disregardfiat', 'proofofaccess', 'bin');
  const candidates = [
    'proofofaccess-darwin-arm64',
    'proofofaccess-darwin-x64',
    'proofofaccess-linux-x64',
    'proofofaccess-linux-arm64'
  ].map(n => path.join(base, n));

  candidates.forEach(chmodIfExists);
} catch (e) {
  // non-fatal
}


