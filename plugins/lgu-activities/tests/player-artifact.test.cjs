const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { LGU_PLAYER_COMMIT } = require('../src/player-stage');
const artifact = path.join(__dirname, '../assets/player', LGU_PLAYER_COMMIT);
const script = path.join(__dirname, '../scripts/stage-player-artifact.cjs');

test('official canonical artifact has the pinned COMMIT and13valid checksums including manifest sizes', () => {
  assert.equal(fs.readFileSync(path.join(artifact, 'COMMIT'), 'utf8').trim(), LGU_PLAYER_COMMIT);
  const entries = fs.readFileSync(path.join(artifact, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/);
  assert.equal(entries.length, 13);
  for (const line of entries) {
    const [, digest, name] = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(artifact, name))).digest('hex'), digest);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(artifact, 'manifest.json')));
  for (const [name, size] of Object.entries(manifest.files)) assert.equal(fs.statSync(path.join(artifact, name)).size, size);
});

test('stager is idempotent for verified immutable bytes and rejects wrong pin, COMMIT or corrupted bytes', () => {
  const run = source => spawnSync(process.execPath, [script, '--source', source, '--commit', LGU_PLAYER_COMMIT], { encoding:'utf8' });
  assert.equal(run(artifact).status, 0);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lgu-artifact-contract-'));
  try {
    fs.cpSync(artifact, directory, { recursive:true });
    fs.appendFileSync(path.join(directory, 'lgu-live-player.js'), '\ncorrupted\n');
    assert.notEqual(run(directory).status, 0);
    fs.copyFileSync(path.join(artifact, 'lgu-live-player.js'), path.join(directory, 'lgu-live-player.js'));
    fs.writeFileSync(path.join(directory, 'COMMIT'), 'wrong\n');
    assert.notEqual(run(directory).status, 0);
    const wrong = spawnSync(process.execPath, [script, '--source', artifact, '--commit', 'refs/pull/53/head']);
    assert.equal(wrong.status, 2);
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});
