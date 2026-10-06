const path = require('node:path');
const manifest = require('./manifest.json');

// Same independent IIFE / host React pattern as TGOS Lesson Assistant.
module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: manifest.javascriptEntrypointUrl,
    iife: true,
    clean: true,
  },
  target: ['web', 'es2020'],
  externals: { react: 'React' },
  performance: {
    hints: 'error',
    maxAssetSize: 1024 * 1024,
    maxEntrypointSize: 1024 * 1024,
  },
};