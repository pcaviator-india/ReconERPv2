// Extract actual GAS server fn names invoked via google.script.run chains,
// with paren-aware skipping of withSuccessHandler(...) callbacks.
const fs = require('fs');
const path = require('path');

function collectFiles(dirs) {
  const out = [];
function walk(d) {
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules/i.test(p)) walk(p); }
      else if (/\.(js|html)$/.test(p)) out.push(p);
    });
  }
  dirs.forEach(walk);
  return out;
}

// given text and index of '.', parse .identifier( handling whitespace
function parseCall(t, i) {
  let j = i + 1;
  while (j < t.length && /\s/.test(t[j])) j++;
  const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(t.slice(j));
  if (!m) return null;
  let k = j + m[0].length;
  while (k < t.length && /\s/.test(t[k])) k++;
  if (t[k] !== '(') return null;
  return { name: m[0], parenIdx: k };
}

// find matching close paren index for '(' at idx
function matchParen(t, idx) {
  let depth = 0, inS = null, esc = false;
  for (let i = idx; i < t.length; i++) {
    const c = t[i];
    if (inS) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inS) inS = null;
    } else {
      if (c === '"' || c === "'" || c === '`') inS = c;
      else if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; }
      else if (c === '/' && t[i + 1] === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++; i++; }
      else if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return i; }
    }
  }
  return -1;
}

const files = collectFiles(['c:/Recon/ReconLatestPostgre/frontend/js', 'c:/Recon/ReconLatestPostgre/frontend/modules', 'c:/Recon/ReconLatestPostgre/frontend']);
const calls = Object.create(null);
for (const f of files) {
  if (/gas-shim|api\.js|extract-gas/.test(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  let idx = 0, guard = 0;
  while (guard++ < 50000) {
    idx = t.indexOf('google.script.run', idx);
    if (idx < 0) break;
    let pos = idx + 'google.script.run'.length;
    let fn = null, steps = 0;
    while (steps++ < 12 && pos < t.length) {
      while (pos < t.length && /[\s;]/.test(t[pos])) pos++;
      if (t[pos] !== '.') break;
      const c = parseCall(t, pos);
      if (!c) break;
      pos = matchParen(t, c.parenIdx) + 1;
      if (pos === 0) break;
      if (['withSuccessHandler', 'withFailureHandler', 'withUserObject'].includes(c.name)) continue;
      fn = c.name;
      break;
    }
    if (fn) {
      if (!calls[fn]) calls[fn] = { count: 0, files: [] };
      calls[fn].count++;
      const b = path.basename(f);
      if (!calls[fn].files.includes(b) && calls[fn].files.length < 6) calls[fn].files.push(b);
    }
    idx += 10;
  }
}
const ks = Object.keys(calls).sort();
ks.forEach((k) => console.log(k + ' x' + calls[k].count + ' [' + calls[k].files.join(',') + ']'));
console.log('TOTAL:' + ks.length);
fs.writeFileSync('c:/Recon/ReconLatestPostgre/api/scripts/gas-calls.json', JSON.stringify(ks, null, 1));
