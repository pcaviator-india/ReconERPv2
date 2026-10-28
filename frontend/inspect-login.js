const fs = require('fs');
const idx = fs.readFileSync('api.js', 'utf8');
const lines = idx.split('\n');
console.log('=== api.js: auth/token markers (first 200) ===');
let n = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/auth_token|authLimiter|recon_auth|login\(|clearToken|auth_token|localStorage.setItem\('recon_auth/.test(l)) {
    console.log((i + 1) + ' | ' + JSON.stringify(l));
    n++;
    if (n >= 60) break;
  }
}
