const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function moduleSource(name) {
  return fs.readFileSync(path.join(root, 'modules', name + '.js'), 'utf8');
}

// VM fixtures exercise individual dashboard functions with controlled DOM and API inputs.
const source = fs.readdirSync(path.join(root, 'modules'))
  .filter(name => name.endsWith('.js'))
  .map(name => moduleSource(path.basename(name, '.js')))
  .concat(fs.readFileSync(path.join(root, 'app.js'), 'utf8')).join('\n');

function functionSource(text, name) {
  const start = text.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0, `Dashboard function ${name} is missing`);
  const end = text.indexOf('\n}', start);
  assert.ok(end > start, `Missing end of dashboard function ${name}`);
  return text.slice(start, end + 2);
}

module.exports = { source, moduleSource, functionSource };
