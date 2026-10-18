import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(new URL('./bootstrap/install.ps1', import.meta.url));
const output = '# PaperBridge Windows installer. Readable UTF-8 source: scripts/bootstrap/install.ps1\n'
  + '# https://github.com/shanyuzhang/xjtlu-paperbridge\n'
  + `& ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source.toString('base64')}'))))\n`;
fs.writeFileSync(fileURLToPath(new URL('../install.ps1', import.meta.url)), output);
