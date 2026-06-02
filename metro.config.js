const { getDefaultConfig } = require('expo/metro-config');
const { FileStore } = require('metro-cache');
const os = require('os');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('cjs');

// User-owned cache dir avoids /tmp/metro-cache permission issues on shared machines
config.cacheStores = [
  new FileStore({ root: path.join(os.homedir(), '.cache', 'metro-scarnergy') }),
];
config.cacheVersion = '1';

module.exports = config;
