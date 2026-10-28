var fs = require('fs'), path = require('path');
var root = 'c:/Recon/ReconLatestPostgre';
var locs = fs.readFileSync(root + '/api/scripts/fn-locations.txt', 'utf8').split(/\r?\n/).filter(Boolean);
var cache = {};
function body(file, pos) {
  var t = cache[file] || (cache[file] = fs.readFileSync(path.join(root, file), 'utf8'));
  var i = t.indexOf('{', pos);
  var d = 0, instr = false, q = '', esc = false;
  for (var j = i; j < t.length; j++) {
    var c = t[j];
    if (instr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === q) instr = false;
    } else {
      if (c === '"' || c === "'" || c === '`') { instr = true; q = c; }
      else if (c === '{') d++;
      else if (c === '}') { d--; if (d === 0) return t.slice(pos, j + 1); }
    }
  }
  return t.slice(pos, pos + 2000);
}
var out = locs.map(function (L) {
  var m = /^(\S+) @ ([^:]+):(\d+)/.exec(L);
  var b = body(m[2], +m[3]);
  return '===== ' + m[1] + ' (' + m[2] + ') =====\n' + b;
}).join('\n\n');
fs.writeFileSync(root + '/api/scripts/gas-dump2.txt', out);
console.log('bytes:' + out.length);
