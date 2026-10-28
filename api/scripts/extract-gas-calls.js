const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const files = fs.readdirSync(root).filter(f => f.endsWith('.html'));

const calls = {}; // fnName -> Set(files)

for (const f of files) {
  const content = fs.readFileSync(path.join(root, f), 'utf8');
  let idx = 0;
  while (true) {
    const pos = content.indexOf('google.script.run', idx);
    if (pos === -1) break;
    // Scan forward: chain of .name(...) where with* handlers have parens we skip
    let i = pos + 'google.script.run'.length;
    let fnName = null;
    while (i < content.length) {
      // skip whitespace
      while (i < content.length && /\s/.test(content[i])) i++;
      if (content[i] !== '.') break;
      i++; // skip .
      // read identifier
      let start = i;
      while (i < content.length && /[a-zA-Z0-9_$]/.test(content[i])) i++;
      const ident = content.slice(start, i);
      // skip whitespace
      while (i < content.length && /\s/.test(content[i])) i++;
      if (content[i] === '(') {
        // found a call — if it's a with* handler, skip its parens and continue chain
        if (ident.startsWith('with')) {
          // skip balanced parens
          let depth = 0;
          while (i < content.length) {
            if (content[i] === '(') depth++;
            else if (content[i] === ')') { depth--; if (depth === 0) { i++; break; } }
            i++;
          }
          continue;
        } else {
          fnName = ident;
          break;
        }
      } else {
        // property access without call (unlikely) — treat as fn name if not with*
        if (!ident.startsWith('with')) { fnName = ident; }
        break;
      }
    }
    if (fnName) {
      if (!calls[fnName]) calls[fnName] = new Set();
      calls[fnName].add(f);
    }
    idx = pos + 17;
  }
}

const names = Object.keys(calls).sort();
console.log(`Total unique server functions: ${names.length}`);
for (const n of names) {
  console.log(`${n} [${[...calls[n]].join(', ')}]`);
}
