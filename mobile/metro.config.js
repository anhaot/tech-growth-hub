const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Keep development, standalone exports and Gradle's embedded bundle serial.
config.maxWorkers = 1;

module.exports = config;
