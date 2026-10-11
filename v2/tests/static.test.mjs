import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
test('all production modules parse and local HTML/import targets exist',()=>{
  const files=['app.mjs','modules/core.mjs','modules/analysis.mjs','modules/storage.mjs','modules/validation-worker.mjs'];
  for(const file of files){const absolute=path.join(root,file),code=fs.readFileSync(absolute,'utf8'),check=spawnSync(process.execPath,['--check',absolute],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);for(const match of code.matchAll(/(?:from\s+|new URL\()'([^']+)'/g)){if(match[1].startsWith('.'))assert.ok(fs.existsSync(path.resolve(path.dirname(absolute),match[1])),`${file}: missing ${match[1]}`);}}
  for(const file of ['index.html','docs/guide.html']){const absolute=path.join(root,file),html=fs.readFileSync(absolute,'utf8');for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){const target=match[1];if(target.startsWith('.')&&!target.includes('#'))assert.ok(fs.existsSync(path.resolve(path.dirname(absolute),target)),`${file}: missing ${target}`);}}
});
