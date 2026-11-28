const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Browser files use ES modules; the static server and Node tests use CommonJS.
const root = path.resolve(__dirname, '..');
const modules = fs.readdirSync(path.join(root, 'modules')).filter(file => file.endsWith('.js'));
for (const file of ['server.js', 'app.js', ...modules.map(name => 'modules/' + name)]) {
  const mode = file === 'server.js' ? 'commonjs' : 'module';
  const result = spawnSync(process.execPath, ['--check', '--input-type=' + mode], {
    input: fs.readFileSync(path.join(root, file)), encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(file, result.stderr);
    process.exit(1);
  }
}
