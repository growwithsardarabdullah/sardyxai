#!/usr/bin/env node
// Copy client/dist into server/dist/public so the Vercel Express function
// (which auto-detects server/index.js and ignores includeFiles in vercel.json)
// has the static files available in its bundle.
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', 'client', 'dist');
const dest = path.resolve(__dirname, '..', 'server', 'dist', 'public');

if (!fs.existsSync(src)) {
  console.error(`[copy-client-dist] Source not found: ${src}`);
  process.exit(1);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

fs.rmSync(dest, { recursive: true, force: true });
copyDir(src, dest);
console.log(`[copy-client-dist] Copied ${src} -> ${dest}`);
