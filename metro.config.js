const { getDefaultConfig } = require('expo/metro-config');
const os = require('os');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('cjs');

// Use a user-owned cache dir to avoid permission issues with shared /tmp/metro-cache
config.cacheStores = [];
config.cacheVersion = '1';

module.exports = config;
