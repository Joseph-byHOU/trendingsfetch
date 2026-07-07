const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const APP_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(APP_DIR, '..');
const SKILL_DIR = path.join(ROOT_DIR, 'trendfetch');
const RUNNER_DIR = path.join(SKILL_DIR, 'scripts');
const RUNNER_FILE = path.join(RUNNER_DIR, 'trendfetch-runner.js');
const CONFIG_DIR = path.join(APP_DIR, 'data');
const APP_CONFIG_FILE = path.join(CONFIG_DIR, 'app-config.json');
const TEMP_RUN_CONFIG = path.join(CONFIG_DIR, 'runtime-config.json');
const PLAYWRIGHT_BROWSERS_PATH = path.join(ROOT_DIR, '.playwright-browsers');
const NPM_CACHE_PATH = path.join(ROOT_DIR, '.npm-cache');

let mainWindow = null;
let activeRun = null;

const DEFAULT_CONFIG = {
  queries: '成人用品',
  auto_translate_queries: true,
  search_languages: ['en', 'ja', 'zh', 'es', 'pt', 'fr', 'de', 'it'],
  max_pages_per_query: 2,
  top_results_limit_per_query: 30,
  max_results_per_site: 6,
  page_open_timeout_ms: 10000,
  page_load_timeout_ms: 10000,
  max_site_failures_before_skip: 2,
  output_dir: path.join(ROOT_DIR, 'desktop-output'),
  country_hint: 'US',
  language_hint: 'en',
  headless: false,
  manual_google_auth: true,
  stop_on_google_block: true,
  user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  viewport_width: 1440,
  viewport_height: 960,
  delay_min_ms: 800,
  delay_max_ms: 1800,
  base_url: '',
  api_key: '',
  model_name: '',
  enable_llm_review: false,
  llm_timeout_ms: 20000
};

function ensureDataDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readConfig() {
  ensureDataDir();
  const config = readJson(APP_CONFIG_FILE, DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...config };
}

function saveConfig(config) {
  ensureDataDir();
  const merged = { ...DEFAULT_CONFIG, ...config };
  writeJson(APP_CONFIG_FILE, merged);
  return merged;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0b1017',
    title: 'TrendFetch',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function sendLog(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function resolveOutputDir(outputDir) {
  if (!outputDir) {
    return DEFAULT_CONFIG.output_dir;
  }
  return path.isAbsolute(outputDir) ? outputDir : path.resolve(APP_DIR, outputDir);
}

function normalizeQueries(input) {
  return String(input || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLanguages(input) {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(input || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildRunnerConfig(uiConfig) {
  return {
    queries: normalizeQueries(uiConfig.queries),
    auto_translate_queries: Boolean(uiConfig.auto_translate_queries),
    search_languages: normalizeLanguages(uiConfig.search_languages),
    max_pages_per_query: Number(uiConfig.max_pages_per_query),
    top_results_limit_per_query: Number(uiConfig.top_results_limit_per_query),
    max_results_per_site: Number(uiConfig.max_results_per_site),
    page_open_timeout_ms: Number(uiConfig.page_open_timeout_ms),
    page_load_timeout_ms: Number(uiConfig.page_load_timeout_ms),
    max_site_failures_before_skip: Number(uiConfig.max_site_failures_before_skip),
    output_dir: resolveOutputDir(String(uiConfig.output_dir || '')),
    country_hint: String(uiConfig.country_hint || ''),
    language_hint: String(uiConfig.language_hint || ''),
    headless: Boolean(uiConfig.headless),
    manual_google_auth: Boolean(uiConfig.manual_google_auth),
    stop_on_google_block: Boolean(uiConfig.stop_on_google_block),
    enable_llm_review: Boolean(uiConfig.enable_llm_review),
    base_url: String(uiConfig.base_url || ''),
    api_key: String(uiConfig.api_key || ''),
    model_name: String(uiConfig.model_name || ''),
    llm_timeout_ms: Number(uiConfig.llm_timeout_ms || 20000),
    user_agent: String(uiConfig.user_agent || DEFAULT_CONFIG.user_agent),
    viewport: {
      width: Number(uiConfig.viewport_width),
      height: Number(uiConfig.viewport_height)
    },
    delay_range_ms: {
      min: Number(uiConfig.delay_min_ms),
      max: Number(uiConfig.delay_max_ms)
    }
  };
}

function parseManualAuthState(text) {
  if (text.includes('Press Enter here after Google is ready to continue searching')) {
    return { required: true, ready: false };
  }
  if (text.includes('Manual Google auth mode is enabled')) {
    return { required: true, ready: false };
  }
  return null;
}

async function startRun(uiConfig) {
  if (activeRun && activeRun.child && !activeRun.child.killed) {
    return { ok: false, error: 'A run is already in progress.' };
  }

  ensureDataDir();
  const savedConfig = saveConfig(uiConfig);
  const runnerConfig = buildRunnerConfig(savedConfig);
  writeJson(TEMP_RUN_CONFIG, runnerConfig);
  fs.mkdirSync(runnerConfig.output_dir, { recursive: true });

  const child = spawn(process.execPath, [RUNNER_FILE, '--config', TEMP_RUN_CONFIG], {
    cwd: RUNNER_DIR,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH,
      npm_config_cache: NPM_CACHE_PATH
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  activeRun = {
    child,
    manualAuthPending: false,
    outputDir: runnerConfig.output_dir
  };

  sendLog('run:state', { running: true, manualAuthPending: false, outputDir: runnerConfig.output_dir });

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    sendLog('run:log', text);
    const manualAuthState = parseManualAuthState(text);
    if (manualAuthState) {
      activeRun.manualAuthPending = manualAuthState.required;
      sendLog('run:state', {
        running: true,
        manualAuthPending: manualAuthState.required,
        outputDir: runnerConfig.output_dir
      });
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    sendLog('run:log', text);
  });

  child.on('close', (code) => {
    const outputDir = activeRun ? activeRun.outputDir : runnerConfig.output_dir;
    activeRun = null;
    sendLog('run:state', {
      running: false,
      manualAuthPending: false,
      outputDir,
      exitCode: code
    });
  });

  child.on('error', (error) => {
    sendLog('run:log', `[trendfetch-app] ${error.message}\n`);
    activeRun = null;
    sendLog('run:state', { running: false, manualAuthPending: false, outputDir: runnerConfig.output_dir, exitCode: -1 });
  });

  return { ok: true, outputDir: runnerConfig.output_dir };
}

function continueManualAuth() {
  if (!activeRun || !activeRun.child || !activeRun.manualAuthPending) {
    return { ok: false, error: 'Manual auth is not waiting.' };
  }
  activeRun.child.stdin.write('\n');
  activeRun.manualAuthPending = false;
  sendLog('run:state', { running: true, manualAuthPending: false, outputDir: activeRun.outputDir });
  return { ok: true };
}

function stopRun() {
  if (!activeRun || !activeRun.child) {
    return { ok: false, error: 'No active run.' };
  }
  activeRun.child.kill('SIGTERM');
  return { ok: true };
}

function readResults(outputDir) {
  const targetDir = resolveOutputDir(outputDir || readConfig().output_dir);
  const files = {
    results: path.join(targetDir, 'results.csv'),
    summary: path.join(targetDir, 'run-summary.json'),
    failures: path.join(targetDir, 'failures.json'),
    filtered: path.join(targetDir, 'filtered.json'),
    expansions: path.join(targetDir, 'query-expansions.json')
  };

  return {
    ok: true,
    outputDir: targetDir,
    resultsCsv: fs.existsSync(files.results) ? fs.readFileSync(files.results, 'utf8') : '',
    summary: readJson(files.summary, {}),
    failures: readJson(files.failures, []),
    filtered: readJson(files.filtered, []),
    expansions: readJson(files.expansions, [])
  };
}

function exportCsv(payload) {
  const outputDir = resolveOutputDir(payload.outputDir || readConfig().output_dir);
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, payload.fileName || 'filtered-results.csv');
  fs.writeFileSync(filePath, payload.csvText || '', 'utf8');
  return { ok: true, filePath };
}

function setupIpc() {
  ipcMain.handle('app:get-config', async () => readConfig());
  ipcMain.handle('app:save-config', async (_event, config) => ({ ok: true, config: saveConfig(config) }));
  ipcMain.handle('app:pick-output-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false };
    }
    return { ok: true, path: result.filePaths[0] };
  });
  ipcMain.handle('app:open-folder', async (_event, folderPath) => {
    if (!folderPath) {
      return { ok: false };
    }
    await shell.openPath(resolveOutputDir(folderPath));
    return { ok: true };
  });
  ipcMain.handle('app:load-results', async (_event, outputDir) => readResults(outputDir));
  ipcMain.handle('app:export-csv', async (_event, payload) => exportCsv(payload));
  ipcMain.handle('run:start', async (_event, config) => startRun(config));
  ipcMain.handle('run:continue-manual-auth', async () => continueManualAuth());
  ipcMain.handle('run:stop', async () => stopRun());
  ipcMain.handle('run:get-state', async () => {
    if (!activeRun) {
      return { running: false, manualAuthPending: false };
    }
    return {
      running: true,
      manualAuthPending: activeRun.manualAuthPending,
      outputDir: activeRun.outputDir
    };
  });
}

app.whenReady().then(() => {
  ensureDataDir();
  createWindow();
  setupIpc();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
