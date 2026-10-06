const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const manifest = require('../manifest.json');
const dist = path.join(__dirname, '../dist');
const bundle = fs.readFileSync(path.join(dist, manifest.javascriptEntrypointUrl));
const output = {
  ...manifest,
  javascriptEntrypointIntegrity: `sha384-${createHash('sha384').update(bundle).digest('base64')}`,
};
fs.writeFileSync(path.join(dist, 'manifest.json'), `${JSON.stringify(output, null, 2)}\n`);