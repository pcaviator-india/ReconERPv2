const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/routes/legacy.js', 'utf-8');

const implBlock = src.slice(src.indexOf('const IMPLEMENTED'), src.indexOf('const KNOWN_UNIMPLEMENTED'));
const keys = [];
const re = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(async\s*)?\(/gm;
let m;
while ((m = re.exec(implBlock)) !== null) keys.push(m[1]);

const knownBlock = src.slice(src.indexOf('const KNOWN_UNIMPLEMENTED'));
const known = new Set();
// Read only the Set([ ... ]) constructor contents, so quoted words in the
// preceding comments are not mistaken for stub names.
const setStart = knownBlock.indexOf('new Set([');
const setEnd = knownBlock.indexOf('])', setStart);
const setBody = setStart >= 0 ? knownBlock.slice(setStart, setEnd) : '';
const re2 = /'([A-Za-z_][A-Za-z0-9_]*)'/g;
let m2;
while ((m2 = re2.exec(setBody)) !== null) known.add(m2[1]);

const counts = {};
keys.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
const dupes = Object.entries(counts).filter(([, c]) => c > 1);

const calls = JSON.parse(fs.readFileSync(__dirname + '/gas-calls.json', 'utf-8'));
const implSet = new Set(keys);

// Every GAS function must be either implemented or declared unimplemented.
const uncovered = calls.filter((f) => !implSet.has(f) && !known.has(f));
// Everything declared unimplemented must actually be a GAS function.
const stale = [...known].filter((f) => !calls.includes(f));
const extra = [...implSet].filter((f) => !calls.includes(f));

console.log(`GAS functions:              ${calls.length}`);
console.log(`Implemented:                ${implSet.size}`);
console.log(`Declared unimplemented:     ${known.size}`);
console.log(`Duplicate IMPLEMENTED keys: ${dupes.length ? dupes.map(([k, c]) => `${k}(${c})`).join(', ') : 'none'}`);
console.log(`Uncovered (404 risk):       ${uncovered.length ? uncovered.join(', ') : 'none'}`);
console.log(`Stale stubs:                ${stale.length ? stale.join(', ') : 'none'}`);
console.log(`Extra impls (not in GAS):   ${extra.length ? extra.join(', ') : 'none'}`);

const ok = dupes.length === 0 && uncovered.length === 0 && stale.length === 0 && extra.length === 0;
console.log(ok ? '\nCOVERAGE OK' : '\nCOVERAGE PROBLEMS FOUND');
process.exit(ok ? 0 : 1);

