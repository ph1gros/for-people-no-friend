/* eslint-disable @typescript-eslint/no-require-imports */
/* global process, require */

const { app } = require('electron');
const sqlite = require('node:sqlite');

void app.whenReady().then(() => {
  const result = {
    electron: process.versions.electron,
    node: process.versions.node,
    sqliteBackup: typeof sqlite.backup,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  app.exit(result.sqliteBackup === 'function' ? 0 : 1);
});
