/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const root = path.resolve(__dirname, '..');
const scenario = process.argv[2];
assert.ok(['fresh', 'existing'].includes(scenario));
const outputRoot = path.join(root, 'out');
fs.mkdirSync(outputRoot, { recursive: true });
const profile = fs.mkdtempSync(path.join(outputRoot, `setup-${scenario}-`));
app.setAppPath(root);
app.setPath('userData', profile);
app.disableHardwareAcceleration();
process.env.FPNF_RESOURCE_CATALOG_URL = '';
process.env.FPNF_SPEECH_ASSET_MANIFEST_URL = '';
delete process.env.VITE_DEV_SERVER_URL;
if (scenario === 'existing') {
  fs.writeFileSync(
    path.join(profile, 'model-providers.v1.json'),
    JSON.stringify({
      version: 2,
      openAICompatibleBaseUrl: 'https://example.invalid/v1',
      allowRemoteComplexTasks: false,
    }),
  );
}
let sawSetup = false;
let passed = false;
const timeout = setTimeout(() => {
  console.error('Startup smoke timed out');
  app.exit(1);
}, 30000);

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    void (async () => {
      const url = window.webContents.getURL();
      if (url.endsWith('/setup/index.html')) {
        assert.equal(scenario, 'fresh');
        sawSetup = true;
        assert.equal(
          JSON.parse(fs.readFileSync(path.join(profile, 'setup.v1.json'), 'utf8')).completed,
          false,
        );
        const state = await window.webContents.executeJavaScript(
          'window.deskpetSetup.getSetupState()',
        );
        assert.equal(state.stepId, 'welcome');
        const providers = await window.webContents.executeJavaScript(
          'window.deskpetSetup.getSetupProviderStatus()',
        );
        assert.equal(providers.hasSecret, false);
        assert.equal('apiKey' in providers, false);
        const navigation = await window.webContents.executeJavaScript(`(async () => {
          let state = await window.deskpetSetup.getSetupState();
          const selections = { ...state.selections, mode: 'custom' };
          const visited = [state.stepId];
          for (let i = 0; i < 10 && !state.isFinalStep; i++) {
            state = await window.deskpetSetup.advanceSetup({ selections });
            visited.push(state.stepId);
          }
          return { visited, final: state.isFinalStep };
        })()`);
        assert.equal(navigation.final, true);
        // The custom path keeps voice and speech input at their defaults here, so the
        // resource install page stays skipped.
        assert.deepEqual(navigation.visited, [
          'welcome',
          'mode',
          'provider',
          'character',
          'voice',
          'speechInput',
          'review',
          'finish',
        ]);
        // Completion destroys its own renderer; main-window appearance and the persisted marker
        // below are the authoritative assertions even if the reply cannot reach that renderer.
        void window.webContents
          .executeJavaScript(
            `window.deskpetSetup.completeSetup({
          selections: { mode: 'custom', characterSource: 'placeholder', launchAfterFinish: true }
        })`,
          )
          .catch(() => {});
      } else if (url.endsWith('/resource-center.html')) {
        const result = await window.webContents.executeJavaScript(`(async () => ({
          status: await window.resourceCenterApi.getResourceCenterStatus(),
          setupBridge: typeof window.deskpetSetup,
          mainBridge: typeof window.deskpet
        }))()`);
        assert.equal(result.status.catalog.resources.length, 7);
        assert.equal(result.status.downloads.sourceConfigured, false);
        assert.equal(result.setupBridge, 'undefined');
        assert.equal(result.mainBridge, 'undefined');
        passed = true;
        clearTimeout(timeout);
        console.log(JSON.stringify({ scenario, sawSetup, resourceCount: 7, passed }));
        app.quit();
      } else if (url.endsWith('/index.html')) {
        assert.equal(sawSetup, scenario === 'fresh');
        const marker = JSON.parse(fs.readFileSync(path.join(profile, 'setup.v1.json'), 'utf8'));
        assert.equal(marker.completed, true);
        assert.equal(marker.completedBy, scenario === 'fresh' ? 'wizard' : 'existing-installation');
        await window.webContents.executeJavaScript('window.deskpet.openResourceCenter()');
      } else {
        throw new Error('Unexpected window during startup smoke');
      }
    })().catch((error) => {
      console.error(error);
      clearTimeout(timeout);
      app.exit(1);
    });
  });
});
require(path.join(root, 'dist-electron/main/index.js'));
