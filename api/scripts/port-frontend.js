// port-frontend.js — one-shot converter from GAS HTML files to standalone frontend
// Usage: node api/scripts/port-frontend.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const fe = path.join(root, 'frontend');
const jsDir = path.join(fe, 'js');
const cssDir = path.join(fe, 'css');
const modDir = path.join(fe, 'modules');

fs.mkdirSync(jsDir, { recursive: true });
fs.mkdirSync(cssDir, { recursive: true });
fs.mkdirSync(modDir, { recursive: true });

function stripWrapper(content, tagName) {
  // Remove leading <tag ...> and trailing </tag>
  let c = content;
  const openRe = new RegExp('^\\s*<' + tagName + '[^>]*>', 'i');
  const closeRe = new RegExp('</' + tagName + '>\\s*$', 'i');
  c = c.replace(openRe, '');
  c = c.replace(closeRe, '');
  return c.trim() + '\n';
}

const htmlFiles = fs.readdirSync(root).filter(f => f.endsWith('.html'));
let jsCount = 0;
let modCount = 0;

for (const f of htmlFiles) {
  const base = f.replace(/\.html$/, '');
  const content = fs.readFileSync(path.join(root, f), 'utf8');

  if (f === 'Index.html') continue; // handled separately

  if (base.endsWith('JS')) {
    // Client JS module: <script>...</script> → js/X.js
    fs.writeFileSync(path.join(jsDir, base + '.js'), stripWrapper(content, 'script'));
    jsCount++;
  } else if (f === 'ChoicesCSS.html') {
    // CSS: <style>...</style> → css/choices.css
    fs.writeFileSync(path.join(cssDir, 'choices.css'), stripWrapper(content, 'style'));
  } else if (f === 'i18n.html') {
    fs.writeFileSync(path.join(jsDir, 'i18n.js'), stripWrapper(content, 'script'));
    jsCount++;
  } else if (f === 'MovScanner.html') {
    // Legacy standalone scanner page (keep as module)
    fs.writeFileSync(path.join(modDir, f), content);
    modCount++;
  } else {
    // Email/PDF templates stay server-side only
    if (base.endsWith('_Template')) continue;
    // Module HTML (Dashboard.html etc.) → modules/X.html — strip any GAS scriptlets
    const cleaned = content.replace(/<\?[\s\S]*?\?>/g, '');
    fs.writeFileSync(path.join(modDir, f), cleaned);
    modCount++;
  }
}

// ---- Transform Index.html → frontend/index.html ----
let idx = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');

// <?!= include('X'); ?> → <script src="js/X.js"></script> (ChoicesCSS → link)
idx = idx.replace(/<\?!=\s*include\('([A-Za-z0-9_]+)'\);\s*\?>/g, (m, name) => {
  if (name === 'ChoicesCSS') return '<link rel="stylesheet" href="css/choices.css" />';
  return `<script src="js/${name}.js"></script>`;
});
// <?!= getModuleHtml('X'); ?> → <script src="js/X.js"></script>
idx = idx.replace(/<\?!=\s*getModuleHtml\('([A-Za-z0-9_]+)'\);\s*\?>/g, (m, name) => `<script src="js/${name}.js"></script>`);
// Remove any remaining GAS scriptlets (safety net)
idx = idx.replace(/<\?[\s\S]*?\?>/g, '');

// Inject api.js + gas-shim.js before </head> (must load BEFORE module scripts)
idx = idx.replace('</head>', '    <script src="api.js"></script>\n    <script src="js/gas-shim.js"></script>\n  </head>');

fs.writeFileSync(path.join(fe, 'index.html'), idx);

console.log(`Done: ${jsCount} JS files → frontend/js/`);
console.log(`Done: ${modCount} module HTML files → frontend/modules/`);
console.log('Done: frontend/index.html transformed');
