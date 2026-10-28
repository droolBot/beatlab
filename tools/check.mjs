// node tools/check.mjs -- every script in the app parses as the ES module the browser loads
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['beatlab', 'tools', 'tests'].flatMap(d => readdirSync(join(root, d)).filter(f => /\.m?js$/.test(f)).map(f => join(root, d, f)));
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error(String(e.stderr).split('\n').slice(0, 5).join('\n')); }
}
if (bad) { console.error(`${bad} of ${files.length} files don't parse`); process.exit(1); }
console.log(`syntax ok: ${files.length} files`);
