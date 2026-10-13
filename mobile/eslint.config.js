const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
module.exports = defineConfig([
  expo, // This app uses ordinary hooks; compiler-only checks flag deferred API callbacks.
  { rules: { 'react-hooks/set-state-in-effect': 'off', 'react-hooks/refs': 'off' } },
  { ignores: ['dist/**', 'android/**', 'ios/**', '.expo/**'] },
]);
