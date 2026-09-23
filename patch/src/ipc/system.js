// Mrite v2.6 — 系统 IPC 路由
const { ipcMain, shell, Notification, app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const latexEnv = require('../env/latex');
const pythonEnv = require('../env/python');
const taskService = require('../services/task');
const wordExport = require('../services/word-export');

const MIN_FREE_WORKSPACE_BYTES = 512 * 1024 * 1024;

function findExistingDirectory(target) {
  let current = path.resolve(target || process.cwd());
  while (current) {
    try { if (fs.existsSync(current) && fs.statSync(current).isDirectory()) return current; } catch {}
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return '';
}

// 只读检查工作区的写权限与磁盘余量，不创建测试文件。
function getWorkspacePreflightStatus(ctx) {
  const requested = (() => {
    try { return (ctx.getWorkDir && ctx.getWorkDir()) || ctx.projectsDir || app.getPath('userData'); }
    catch { return process.cwd(); }
  })();
  const existingDir = findExistingDirectory(requested);
  if (!existingDir) return { ok: false, writable: false, path: requested || '', message: '无法找到可用的工作区目录' };

  let writable = false;
  try { fs.accessSync(existingDir, fs.constants.R_OK | fs.constants.W_OK); writable = true; } catch {}
  let freeBytes = null;
  try {
    if (typeof fs.statfsSync === 'function') {
      const stat = fs.statfsSync(existingDir);
      freeBytes = Number(stat.bavail) * Number(stat.bsize);
    }
  } catch {}
  const enoughSpace = freeBytes === null || freeBytes >= MIN_FREE_WORKSPACE_BYTES;
  const ok = writable && enoughSpace;
  let message = '';
  if (!writable) message = '工作区不可写，请更换目录或检查权限';
  else if (!enoughSpace) message = '磁盘可用空间不足 512 MB';
  return { ok, writable, enoughSpace, freeBytes, path: existingDir, message };
}

// 独立的快速网络预检：只请求公开端点，不刷新会话、不上报数据。
function checkBackendReachability(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      resolve(Object.assign({ latencyMs: Date.now() - startedAt }, result));
    };
    try {
      const backendUrl = require('../core/backend-url');
      const base = backendUrl.getBackendBase();
      // ★ 开发版：后端地址被改写成本机黑洞（http://127.0.0.1:1），而这项预检探的是
      //   官方软件服务，在开发版里必然 ECONNREFUSED → 「网络」卡片失败 → 八项检测
      //   不全过 → 「确认运行」按钮永久置灰（任务起不来）。这里探测到黑洞地址即判过，
      //   并带上 skipped 标记，由渲染层显示「已跳过」而不是假装「已连通」。
      if (backendUrl.BLACKHOLE_BASE && base === backendUrl.BLACKHOLE_BASE) {
        return finish({ ok: true, skipped: true, statusCode: 0, latencyMs: 0, message: '' });
      }
      const parsed = new URL('/api/v1/avatars', base.endsWith('/') ? base : base + '/');
      const transport = parsed.protocol === 'https:' ? require('https') : require('http');
      const req = transport.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mrite-Preflight/' + (() => { try { return app.getVersion(); } catch { return 'unknown'; } })() },
        timeout: timeoutMs
      }, (res) => {
        res.resume();
        finish({ ok: true, statusCode: res.statusCode || 0, message: '' });
      });
      req.on('timeout', () => { req.destroy(); finish({ ok: false, reason: 'timeout', message: '网络连接超时' }); });
      req.on('error', (err) => finish({ ok: false, reason: err && err.code ? err.code : 'network_error', message: '无法连接软件服务' }));
      req.end();
    } catch (err) {
      finish({ ok: false, reason: 'invalid_backend', message: '网络检测组件异常' });
    }
  });
}

function readLatestWorkspaceState(wsRoot, currentWorkDir) {
  const candidates = [];
  const pushStatePath = (statePath, source) => {
    if (!statePath || !fs.existsSync(statePath)) return;
    try {
      const stat = fs.statSync(statePath);
      if (!stat.isFile()) return;
      candidates.push({ statePath, source, mtimeMs: stat.mtimeMs });
    } catch {}
  };

  // ★ v2.6 记忆独立：扫描时优先 solve 版状态文件，老文件兜底
  const _scanFiles = require('../core/config').wsStateScanFiles;
  function _findState(dir) {
    for (const _f of _scanFiles) {
      const _p = path.join(dir, _f);
      try { if (fs.existsSync(_p)) return _p; } catch {}
    }
    return '';
  }
  pushStatePath(currentWorkDir ? _findState(currentWorkDir) : '', 'currentWorkDir');

  try {
    if (fs.existsSync(wsRoot)) {
      fs.readdirSync(wsRoot, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
        .forEach(d => pushStatePath(_findState(path.join(wsRoot, d.name)), 'workspaceRoot'));
    }
  } catch {}

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const selected = candidates[0];
  try {
    const raw = fs.readFileSync(selected.statePath, 'utf-8');
    return {
      path: selected.statePath,
      source: selected.source,
      mtime: new Date(selected.mtimeMs).toISOString(),
      raw,
      parsed: JSON.parse(raw)
    };
  } catch (err) {
    return {
      path: selected.statePath,
      source: selected.source,
      mtime: new Date(selected.mtimeMs).toISOString(),
      error: err.message
    };
  }
}

// ★ 中文/非英文路径检测：软件安装目录 + 集成环境目录，任一含非 ASCII（中文/空格类例外）都容易让
//   python/xelatex/claude 子进程路径解析失败、运行报错。用户多半不自知，必须显式提示。
//   判定：含任何 >0x7F 字符（中文/日文/韩文/带重音字母等）即视为危险。
//   抽成独立函数是为了让渲染层能用一个轻量 IPC 先拿到它——它只是两次正则，却原本要排在
//   python/latex/pandoc 版本探测之后才返回，导致检测面板里排在第一位的「路径」一直转圈。
function getChinesePathStatus(appEnvRoot) {
  const _hasNonAscii = (p) => { try { return p ? /[^\x00-\x7F]/.test(String(p)) : false; } catch { return false; } };
  const installDir = (() => {
    try { return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath) || app.getAppPath() || ''; }
    catch { try { return app.getAppPath() || ''; } catch { return ''; } }
  })();
  const envDir = appEnvRoot || '';
  const installBad = _hasNonAscii(installDir);
  const envBad = _hasNonAscii(envDir);
  return {
    ok: !installBad && !envBad,
    installDir,
    envDir,
    installBad,
    envBad,
    message: (installBad || envBad)
      ? '检测到路径含中文/非英文，可能导致环境无法运行：' +
        (installBad ? '软件安装目录「' + installDir + '」' : '环境目录「' + envDir + '」') +
        '。请把软件与 Mrite_env 移动到纯英文路径后重试。'
      : ''
  };
}

function register(ctx) {
  // ★ v2.7 内容预览（模板&规范编辑）未保存状态同步：供主进程在「直接退出主界面」时拦截提醒
  ipcMain.on('app-set-paper-dirty', (event, v) => {
    try { ctx.setPaperDirty(!!v); } catch {}
  });

  // ── 强制关闭应用（忽略任务状态）──
  ipcMain.handle('force-close-app', async () => {
    try {
      // 强制清除任务状态
      ctx.setTaskState(false, null);
      // 关闭主窗口
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
      // 退出应用
      app.quit();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('open-external', async (event, url) => {
    try { await shell.openExternal(url); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  
  ipcMain.handle('path-exists', async (event, p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });

  ipcMain.handle('send-notification', async (event, { title, body }) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
    return { success: true };
  });

  
  // ★ 主题切换时动态更新原生标题栏覆盖按钮（最小化/最大化/关闭）配色
  ipcMain.handle('set-titlebar-overlay', async (event, { color, symbolColor, height }) => {
    const win = ctx.getMainWindow();
    if (!win || win.isDestroyed()) return;
    try {
      win.setTitleBarOverlay({
        color: color || '#ffffff',
        symbolColor: symbolColor || '#18181b',
        height: height || 30
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('export-diagnostics-log', async () => {
    try {
      const userData = app.getPath('userData');
      const wsRoot = path.join(path.dirname(ctx.projectsDir), 'workspace');
      const pythonStatus = pythonEnv.getStatus();
      const latexStatus = latexEnv.getStatus();
      const db = ctx.db;
      let taskLogs = [];
      let appState = {};
      let settings = {};
      try {
        if (db) {
          taskLogs = db.prepare(`SELECT id, task_type, status, project_name, workspace_name, started_at, finished_at, duration_ms, input_tokens, output_tokens, error_msg
            FROM task_logs ORDER BY started_at DESC LIMIT 30`).all();
          const rows = db.prepare('SELECT key, value FROM app_state').all();
          rows.forEach(function(row) { appState[row.key] = row.value; });
          const setRows = db.prepare('SELECT key, value FROM settings').all();
          const dbCrypto = require('../core/crypto');
          setRows.forEach(function(row) {
            if (row.key === 'apiKey' || row.key === 'inviteCode') return;
            settings[row.key] = dbCrypto.decrypt(row.value);
          });
        }
      } catch (_) {}

      let workspaceStates = [];
      const currentWorkDir = ctx.getWorkDir ? ctx.getWorkDir() : '';
      const latestWorkspaceState = readLatestWorkspaceState(wsRoot, currentWorkDir);
      const solverExecutableProbe = taskService.getSolverExecutableProbeResult
        ? taskService.getSolverExecutableProbeResult()
        : null;
      try {
        if (fs.existsSync(wsRoot)) {
          workspaceStates = fs.readdirSync(wsRoot, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
            .slice(0, 50)
            .map(d => {
              const wsPath = path.join(wsRoot, d.name);
              // ★ v2.6 记忆独立：优先 solve 版，老文件兜底
              let statePath = '';
              for (const _f of require('../core/config').wsStateScanFiles) {
                const _p = path.join(wsPath, _f);
                try { if (fs.existsSync(_p)) { statePath = _p; break; } } catch {}
              }
              let state = null;
              try {
                if (statePath) {
                  state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
                }
              } catch (_) {}
              return {
                workspaceName: d.name,
                path: wsPath,
                status: state && state.status,
                progress: state && state.progress,
                runStartedAt: state && state.runStartedAt,
                runCompletedAt: state && state.runCompletedAt,
                updatedAt: state && state._updated
              };
            });
        }
      } catch (_) {}

      const payload = {
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        userData,
        resourcesPath: process.resourcesPath || '',
        currentProjectPath: ctx.getProjectPath ? ctx.getProjectPath() : '',
        currentWorkDir,
        pythonStatus,
        latexStatus,
        solverExecutableProbe,
        appState,
        settings,
        latestWorkspaceState,
        workspaceStates,
        taskLogs
      };

      const win = ctx.getMainWindow();
      const defaultName = 'mrite-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.txt';
      const saveResult = await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('desktop'), defaultName),
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
      }

      fs.writeFileSync(saveResult.filePath, JSON.stringify(payload, null, 2), 'utf-8');
      return { success: true, path: saveResult.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 环境检测 ──
  // ★ 轻量路径检测：只做中文/非英文判定（两次正则），不 spawn python/xelatex/pandoc。
  //   供运行前环境检测面板先出「路径」这一项——它在卡片行里排第一，原本只能等
  //   check-environment 整个返回（含三个子进程版本探测）才显示，看起来就是"第一步卡住不动"。
  ipcMain.handle('check-path', async () => {
    const { getAppEnvDir, setConfiguredAppEnvPath } = require('../env/assets');
    const dbModule = require('../core/database');
    try {
      setConfiguredAppEnvPath(String(dbModule.getSetting('appEnvPath', '') || ''));
    } catch {}
    try { return { success: true, chinesePath: getChinesePathStatus(getAppEnvDir() || '') }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('check-environment', async (event, options) => {
    const fast = !!(options && options.fast);
    const { getAppEnvDir, setConfiguredAppEnvPath } = require('../env/assets');
    const dbModule = require('../core/database'); // ★ ctx.db 是 better-sqlite3 实例（无 getSetting 方法），改用 dbModule.getSetting
    // ★ 每次检测都同步用户手动指定的集成环境目录（存数据库；重装/换位置后仍生效）
    let cfgPath = '';
    try {
      cfgPath = String(dbModule.getSetting('appEnvPath', '') || '');
      setConfiguredAppEnvPath(cfgPath);
    } catch {}
    const appEnvRoot = getAppEnvDir() || '';
    const results = {
      python: { ok: false, version: '' },
      latex: { ok: false, version: '', source: 'none' },
      pandoc: { ok: false, version: '', path: '', source: 'none' }
    };

    // 检测 Python（内置 / 外部集成环境 Mrite_env）
    // 运行前检测走纯文件级快速检查，不 spawn `python --version`。
    // 详细版本探测留给设置页，避免用户点运行后在 Python 这一步卡顿。
    const pythonStatus = pythonEnv.getFastStatus ? pythonEnv.getFastStatus() : pythonEnv.getStatus();
    if (pythonStatus.ready) {
      const srcLabel = pythonStatus.source === 'appenv' ? '集成环境 Python' : '内置 Python';
      results.python = { ok: true, version: pythonStatus.version ? (srcLabel + ' ' + pythonStatus.version) : (srcLabel + ' 已就绪') };
    } else {
      results.python = { ok: false, version: 'Python 环境未就绪' };
    }

    // 检测 LaTeX（内置 / 外部集成环境 Mrite_env）
    const latexStatus = fast && latexEnv.getFastStatus ? latexEnv.getFastStatus() : latexEnv.getStatus();
    if (latexStatus.installed) {
      const srcLabel = latexStatus.source === 'appenv' ? '集成环境 TinyTeX' : '内置 TinyTeX';
      results.latex = {
        ok: true,
        version: latexStatus.version ? (srcLabel + ' ' + latexStatus.version) : (srcLabel + ' 已就绪'),
        path: latexStatus.binDir || latexStatus.dir || '',
        packagesReady: latexStatus.packagesReady
      };
    } else {
      results.latex = { ok: false, version: '未安装' };
    }

    // 检测 pandoc（Word 导出必备工具，与 Python 必备库同级，依赖外部集成环境 Mrite_env）
    const pandocStatus = fast && wordExport.getFastPandocStatus
      ? wordExport.getFastPandocStatus()
      : wordExport.getPandocStatus();
    results.pandoc = {
      ok: pandocStatus.ok,
      version: pandocStatus.version || '',
      path: pandocStatus.path || '',
      source: pandocStatus.source
    };

    const chinesePath = getChinesePathStatus(appEnvRoot);

    // ★ 求解引擎（claude.exe）探测：供运行前检测判断求解核心是否就绪（常见缺失源于杀毒软件拦截/隔离）
    const solverExecutableProbe = taskService.getSolverExecutableProbeResult
      ? taskService.getSolverExecutableProbeResult()
      : null;

    return {
      success: true,
      results,
      latexStatus,
      pythonStatus,
      pandocStatus,
      chinesePath,
      solverExecutableProbe,
      appEnv: {
        root: appEnvRoot,
        found: !!appEnvRoot,
        configured: cfgPath,   // 用户手动指定的目录（''=未指定，走自动检测）
        python: {
          dir: pythonStatus.envDir,
          pythonPath: pythonStatus.pythonPath,
          ready: pythonStatus.ready,
          version: pythonStatus.version,
          source: pythonStatus.source
        },
        latex: {
          dir: latexStatus.dir,
          binDir: latexStatus.binDir,
          xelatexPath: latexStatus.path,
          installed: latexStatus.installed,
          version: latexStatus.version,
          source: latexStatus.source
        },
        pandoc: {
          path: pandocStatus.path,
          ok: pandocStatus.ok,
          version: pandocStatus.version,
          source: pandocStatus.source
        },
        detectedAt: new Date().toISOString()
      }
    };
  });

  // 运行前快速预检：存储为纯本地检查，网络最长 3 秒；两项并行返回。
  ipcMain.handle('check-runtime-preflight', async () => {
    const workspacePromise = Promise.resolve().then(() => getWorkspacePreflightStatus(ctx));
    const networkPromise = checkBackendReachability(3000);
    const [workspace, network] = await Promise.all([workspacePromise, networkPromise]);
    return { success: true, workspace, network };
  });

  // ── Python 环境管理 ──
  
  
  
  // 环境配置：检测系统 Python（库安装已迁移到 Mrite_env 面板）
  ipcMain.handle('python-detect-system', async () => {
    return pythonEnv.detectSystemPython();
  });

  // ── 测试 API 连通性 ──
  ipcMain.handle('test-api', async (event, { baseURL, apiKey }) => {
    try {
      const https = baseURL.startsWith('https') ? require('https') : require('http');
      const url = new URL(baseURL);
      const startTime = Date.now();
      return new Promise((resolve) => {
        const req = https.request({
          hostname: url.hostname,
          port: url.port || (baseURL.startsWith('https') ? 443 : 80),
          path: url.pathname,
          method: 'GET',
          timeout: 10000,
          headers: apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {},
        }, (res) => {
          const latency = Date.now() - startTime;
          resolve({ success: true, status: res.statusCode, latency });
        });
        req.on('error', (e) => resolve({ success: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false, error: '超时' }); });
        req.end();
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
