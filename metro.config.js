const { getDefaultConfig } = require('expo/metro-config');
const { FileStore } = require('metro-cache');
const os = require('os');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('cjs');

// The repo contains a stale nested duplicate of the whole app at ./scarnergy-app
// (its own node_modules + an identical package name "scarnergy-app"). Because it
// lives inside the watched project root, Metro would otherwise crawl it and hit
// duplicate-module (haste) collisions — sometimes serving the OLD source (e.g.
// Dutch labels) instead of the root files. Block that directory entirely so only
// the canonical root tree is bundled.
const nestedDup = path
  .resolve(__dirname, 'scarnergy-app')
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = new RegExp(`^${nestedDup}[\\\\/].*$`);

// User-owned cache dir avoids /tmp/metro-cache permission issues on shared machines
config.cacheStores = [
  new FileStore({ root: path.join(os.homedir(), '.cache', 'metro-scarnergy') }),
];
config.cacheVersion = '1';

module.exports = config;
