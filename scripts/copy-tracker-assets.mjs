import fs from 'node:fs';
fs.cpSync(new URL('../src/tracker/public/', import.meta.url), new URL('../dist/tracker/public/', import.meta.url), { recursive: true });
