const fs = require('fs');
const path = require('path');
const dir = 'c:/Recon/ReconLatestPostgre/api/src/routes';
fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  console.log('== ' + f);
  const re = /router\.(get|post|put|patch|delete)\('([^']+)'/g;
  let m;
  while ((m = re.exec(t))) console.log('  ' + m[1].toUpperCase() + ' ' + m[2]);
});
