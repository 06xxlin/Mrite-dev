// Mrite — 启动引导（从 main.js 提取）
// 开源版：已移除 AES 解密链路、mrite-renderer 协议、require hook
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ★ 滚动条：已改为用 CSS 全局统一控制（width:2px + 灰色 thumb）。
//   不再启用 Chromium OverlayScrollbar——它会让不同窗口的滚动条粗细不一致（悬浮式、浏览器决定宽度）。
//   PDF iframe 等独立文档的滚动条后续可用注入 CSS 单独控制。
// app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar');

// ═══════════════════════════════════════
// 启动日志
// ═══════════════════════════════════════
const STARTUP_LOG = path.join(os.tmpdir(), 'mrite-startup.log');
function startupLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(STARTUP_LOG, line + '\n', 'utf-8'); } catch {}
  // ★ 同时写入持久化运行日志（userData/logs/mrite-YYYY-MM-DD-HH.log，按小时分文件）
  try { require('./logger').log(msg); } catch {}
}
function startupErr(msg, err) {
  startupLog(`ERROR: ${msg}` + (err ? ': ' + (err.stack || err.message || err) : ''));
  try { dialog.showErrorBox('Mrite 启动失败', msg + (err ? '\n\n' + (err.message || err) : '')); } catch {}
}

// ═══════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, item.name), d = path.join(dest, item.name);
    item.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
  }
}

// ★ 开发版安装包标记：app 目录下存在 dev-profile.flag（由安装包写入）时，
//   等同常开 --dev-profile —— 双击 Mrite.exe 即用独立的 -dev 数据目录。
function hasDevProfileFlag() {
  try { return fs.existsSync(path.join(__dirname, '..', '..', 'dev-profile.flag')); } catch (e) { return false; }
}

function getRootDir() {
  if (app.isPackaged) return app.getPath('userData');
  // ★ 开发版：加了 --dev-profile 时，用户数据（库/工作区/规则库）放到 userData，
  //   与打包版一致；否则以「源码目录」为根，会把 Workspace-*/data/ 写进源码树。
  if (process.argv.includes('--dev-profile') || hasDevProfileFlag()) return app.getPath('userData');
  return path.join(__dirname, '..', '..');
}

// ★ 开发版：--dev-profile 使用独立的 <名称>-dev 数据目录，并首次启动时从正式
//   数据目录复制一份用户数据（设置、模型/API Key、规则库、工作区），
//   这样开发版开箱即用，同时与正式版数据互不干扰（可同时运行）。
function seedDevProfile(appDataDir, devDirName, prodDirName) {
  try {
    const devDir = path.join(appDataDir, devDirName);
    if (fs.existsSync(devDir)) return; // 已存在 → 不重复播种
    const prodDir = path.join(appDataDir, prodDirName);
    if (!fs.existsSync(prodDir)) return; // 没有正式数据 → 全新使用
    const SKIP = /^(Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|Dictionaries|Shared Dictionary|blob_storage|Network|Session Storage|SharedStorage-wal)$/i;
    fs.mkdirSync(devDir, { recursive: true });
    let copied = 0;
    for (const item of fs.readdirSync(prodDir, { withFileTypes: true })) {
      if (SKIP.test(item.name) || item.name === 'DevToolsActivePort' || item.name === 'lockfile') continue;
      const s = path.join(prodDir, item.name), d = path.join(devDir, item.name);
      try {
        if (item.isDirectory()) copyDirSync(s, d);
        else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
        copied++;
      } catch {}
    }
    startupLog(`[开发版] 已从 ${prodDirName} 播种开发数据目录 ${devDirName}（${copied} 项）`);
  } catch (e) {
    startupLog('[开发版] WARN 播种开发数据失败: ' + (e && e.message ? e.message : e));
  }
}

// ★ v2.6.12 起：升级版本号后，把旧版 MriteUltra-<版本> 的用户数据一次性迁移到新版目录。
//   此前设计是「升级即换新目录、不继承旧版数据」，导致任务工作区主库 mrite.db、用户规则/模板、
//   绘图、设置与扩展状态随版本号切换而被弃用。现改为首次以新版启动时自动迁移旧版数据。
//   只迁移「用户数据」项；Electron 临时缓存（Cache/GPUCache 等）与运行时锁文件不迁移。
//   仅当前版本目录尚不存在时执行；--multi-instance 用独立目录，不迁移。
function migrateOldUserData(appDataDir, currentDirName) {
  try {
    const currentDir = path.join(appDataDir, currentDirName);
    if (fs.existsSync(currentDir)) return; // 当前目录已存在（非首次/已迁移）→ 不重复
    // ★ 解析版本号前必须先剥掉预发布后缀（-beta.1 / -rc.2 之类）再按点分段。
    //   否则 '2.6.14-beta.1'.split('.').map(Number) → [2, 6, NaN, 1]，而下面比较时
    //   用的是 `curVer[i] || 0` —— **`NaN || 0` 会得到 0**（NaN 是 falsy），当前版本
    //   于是被当成 [2,6,0,1]（比谁都旧）→ isOlder 对任何目录都返回 false →
    //   **一个旧版都找不到、全部不迁移**，用户的 workspace/history/规则库/设置全部不继承，
    //   表现为「升级后所有任务和记录都不见了」。实测 'MriteUltra-2.6.14-beta.1' 对
    //   'MriteUltra-2.6.13' 返回 false，正是这个坑。
    const parseVer = (n) => String(n).replace(/^MriteUltra-/, '').split('-')[0].split('.').map(Number);
    // ★ 预发布标记（MriteUltra-2.6.14-beta.1）：数字段剥离后与正式版 2.6.14 完全相同，
    //   所以「谁更新」不能只看数字段，要按 semver：同版本号时预发布 < 正式版。
    //   否则 beta 转正式版（2.6.14-beta.1 → 2.6.14）时当前目录 MriteUltra-2.6.14 找不到
    //   任何「旧版」（beta 目录被判为相等 → 不是旧版），却会顺手选中更老的 MriteUltra-2.6.13 做迁移源，
    //   结果 beta 期间的任务/设置全丢、还倒退回 2.6.13 的旧数据。
    const isPre = (n) => String(n).replace(/^MriteUltra-/, '').indexOf('-') !== -1;
    const curVer = parseVer(currentDirName);
    const isOlder = (name) => {
      const cand = parseVer(name);
      const n = Math.max(curVer.length, cand.length);
      for (let i = 0; i < n; i++) {
        const c = curVer[i] || 0, v = cand[i] || 0;
        if (v > c) return false; // 比当前新 → 不属于「旧版」
        if (v < c) return true;
      }
      // 数字段相等：候选是预发布、当前是正式版 → 候选更旧；反之/同为预发布 → 不迁移
      return isPre(name) && !isPre(currentDirName);
    };
    // 扫描 %APPDATA% 下版本化目录（排除 -collab 与当前名），选「比当前低且最高」的那个作为旧版来源
    const candidates = fs.readdirSync(appDataDir, { withFileTypes: true })
      // ★ 目录名正则要放行预发布后缀（MriteUltra-2.6.14-beta.1），否则新目录自己
      //   将来无法成为下一次升级的迁移来源。
      .filter(d => d.isDirectory() && /^MriteUltra-\d+(\.\d+)*(-[0-9A-Za-z.-]+)?$/.test(d.name) && d.name !== currentDirName)
      .map(d => ({ name: d.name, ver: parseVer(d.name) }))
      .filter(c => isOlder(c.name))
      // 数字段降序；数字段相同（2.6.14 与 2.6.14-beta.1 并存）时正式版优先，取更完整的用户数据
      .sort((a, b) => { const n = Math.max(a.ver.length, b.ver.length); for (let i = 0; i < n; i++) { const x = a.ver[i] || 0, y = b.ver[i] || 0; if (x !== y) return y - x; } return (isPre(a.name) ? 1 : 0) - (isPre(b.name) ? 1 : 0); });
    const old = candidates[0];
    if (!old) return; // 无旧版 → 全新安装，无需迁移
    const oldDir = path.join(appDataDir, old.name);
    if (!fs.existsSync(oldDir)) return;
    fs.mkdirSync(currentDir, { recursive: true });
    // 跳过 Electron 临时缓存与运行时锁文件（锁文件/开发端口文件会干扰新实例启动）
    // update 是旧安装基座专属的热更新负载；迁入新安装版本会让旧补丁反过来覆盖新基座。
    const SKIP = /^(Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|Dictionaries|Shared Dictionary|SharedStorage-wal|update)$/i;
    let copied = 0;
    for (const item of fs.readdirSync(oldDir, { withFileTypes: true })) {
      if (SKIP.test(item.name) || item.name === 'DevToolsActivePort' || item.name === 'lockfile') continue;
      const s = path.join(oldDir, item.name), d = path.join(currentDir, item.name);
      if (item.isDirectory()) copyDirSync(s, d);
      else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
      copied++;
    }
    startupLog(`[数据迁移] 已将旧版目录 ${old.name} 迁移到 ${currentDirName}（保留 ${copied} 项用户数据）`);
  } catch (e) {
    startupLog(`[数据迁移] WARN 迁移失败: ${e && e.message ? e.message : e}`);
  }
}

function getIconPath() {
  // ★ Windows 用 .ico 格式更可靠（任务栏/窗口图标）
  const icoPath = path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.ico');
  if (require('fs').existsSync(icoPath)) return icoPath;
  return path.join(__dirname, '..', '..', 'assets', 'icons', 'icon_256.png');
}

// ═══════════════════════════════════════
// PATH 清理（移除外部 TeX 路径）
// ═══════════════════════════════════════
function cleanTexFromPath() {
  const sep = path.delimiter;
  const isExternalTex = (dir) => {
    if (!dir || typeof dir !== 'string') return false;
    const n = dir.replace(/\\/g, '/').toLowerCase();
    if (n.includes('/assets/tinytex/')) return false;
    return n.includes('/texlive/') || n.endsWith('/texbin')
      || n.includes('/tinytex/bin/') || n.includes('/miktex/') || n.includes('/texmf/');
  };
  const cleaned = (process.env.PATH || '').split(sep).filter(d => !isExternalTex(d)).join(sep);
  process.env.PATH = cleaned;
  process.env.Path = cleaned;
}

// ═══════════════════════════════════════
// 工作区清理
// ═══════════════════════════════════════
function cleanupUncommitted(rootDir, db) {
  try {
    const wsDir = path.join(rootDir, 'workspace');
    if (!fs.existsSync(wsDir)) return;
    const committed = new Set();
    try {
      const entries = db.prepare('SELECT workspace_name FROM history').all();
      for (const e of entries) { if (e.workspace_name) committed.add(e.workspace_name); }
    } catch {}
    try {
      const overrides = db.prepare('SELECT workspace_name FROM name_overrides').all();
      for (const o of overrides) committed.add(o.workspace_name);
    } catch {}
    const dirs = fs.readdirSync(wsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'));
    // ★ P0-3: 24 小时冷静期。刚创建、AI 还没写出文件的进行中工作区（如任务跑到一半被杀）
    //   不应被当作"未提交垃圾"误删——创建 24 小时内的目录一律保留。
    const graceMs = require('./config').workspaceGraceMs;
    const nowMs = Date.now();
    for (const d of dirs) {
      try {
        // ★ v2.6 记忆独立：优先读 solve 版状态文件，老文件兜底
        let sf = '';
        for (const _f of require('./config').wsStateScanFiles) {
          const _p = path.join(wsDir, d.name, _f);
          if (fs.existsSync(_p)) { sf = _p; break; }
        }
        if (sf) {
          // ★ 单独 try：状态文件损坏/半截时不能让整个外层 try 抛出 —— 否则下面的
          //   「求解/论文 有内容」兜底检查会被一并跳过，一个已有产出的工作区会被当垃圾删掉。
          //   （原子写 + .bak 已大幅降低该概率，这里再兜一层，与 history._getCommittedNames 对齐。）
          try {
            const ws = JSON.parse(fs.readFileSync(sf, 'utf-8'));
            if (ws.inputLoaded) { committed.add(d.name); continue; }
          } catch {}
        }
        const dPath = path.join(wsDir, d.name);
        for (const sub of ['求解', '论文']) {
          const subDir = path.join(dPath, sub);
          if (fs.existsSync(subDir)) {
            const files = fs.readdirSync(subDir).filter(f => !f.startsWith('.'));
            if (files.length > 0) { committed.add(d.name); break; }
          }
        }
      } catch {}
      try {
        const st = fs.statSync(path.join(wsDir, d.name));
        const ageMs = nowMs - (st.birthtimeMs || st.mtimeMs || 0);
        if (!isNaN(ageMs) && ageMs < graceMs) committed.add(d.name);
      } catch {}
    }
    for (const d of dirs) {
      if (!committed.has(d.name)) {
        fs.rmSync(path.join(wsDir, d.name), { recursive: true, force: true });
      }
    }
  } catch {}
}

// ═══════════════════════════════════════
// 安全加固
// ═══════════════════════════════════════
function applySecurity(win, isDev) {
  if (isDev) return;
  const argv = process.argv.join(' ');
  if (argv.includes('--inspect') || argv.includes('--remote-debugging-port')) {
    console.error('[security] Remote debugging detected, exiting');
    app.quit();
    process.exit(1);
  }
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') { event.preventDefault(); return; }
    if ((input.control || input.meta) && input.shift && (input.key.toLowerCase() === 'i' || input.key.toLowerCase() === 'j')) {
      event.preventDefault(); return;
    }
    if ((input.control || input.meta) && input.key.toLowerCase() === 'u') {
      event.preventDefault(); return;
    }
  });
  // ★ v2.6 开源化：移除所有反调试/保护机制（devtools 限制、eval/Function 禁用、
  //   contextmenu/dragstart 阻止、devtools 尺寸检测）。这些机制会阻止 HTML5 拖拽 API，
  //   影响扩展中心拖动排序与工坊按钮拖动。开发者可自由使用 DevTools 调试。
}

// ═══════════════════════════════════════
// 当前模板解析（无 projects/ 目录；模板名=比赛名，由 rules-library/templates.json 提供）
// ═══════════════════════════════════════
function resolveCurrentTemplate(rulesLib, db) {
  try {
    const saved = db.prepare('SELECT value FROM app_state WHERE key = ?').get('current_project');
    // ★ P2-2: 校验上次选的模板/规则是否仍存在；被删/被换时回退到第一个可用模板并同步 DB，
    //   否则重开后按旧名建空工作区、任务空转。
    if (saved && saved.value && rulesLib) {
      const tpls = rulesLib.listTemplates();
      if (tpls.some(t => t.name === saved.value) && !tpls.find(t => t.name === saved.value).solveMissing && !tpls.find(t => t.name === saved.value).paperMissing) {
        return saved.value;
      }
      if (tpls.length) {
        const fallback = tpls[0].name;
        try { db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run('current_project', fallback); } catch {}
        return fallback;
      }
    }
    if (saved && saved.value) return saved.value;
  } catch {}
  try {
    if (rulesLib) {
      const tpls = rulesLib.listTemplates();
      if (tpls.length) return tpls[0].name;
    }
  } catch {}
  return '默认';
}

// ═══════════════════════════════════════
// 主启动流程
// ═══════════════════════════════════════
async function bootstrap() {
  let mainWindow = null;
  const isDev = process.argv.includes('--dev');

  // ★ 正式入口由 update-loader 把 userData 固定为 MriteUltra-2.6.13；后续版本直接复用，
  //   不再按 package.json 版本号创建新数据空间。下面的动态分支仅是绕过稳定加载器时的兜底。
  // ★ 单机双开联调：--multi-instance 时用独立 userData（不碰主实例的库/项目），并跳过单实例锁
  const multiInstance = process.argv.includes('--multi-instance');
  const updateSmokeTest = process.env.MRITE_UPDATE_SMOKE_TEST === '1';
  // ★ 开发版：--dev-profile 使用独立数据目录 MriteUltra-2.6.13-dev，
  //   首次启动时从正式目录播种一份用户数据（设置/API Key/规则库/工作区），
  //   与正式版互不干扰、可同时运行。
  //   app 目录里存在 dev-profile.flag（开发版安装包会带）时等同常开。
  const devProfile = process.argv.includes('--dev-profile') || hasDevProfileFlag();
  const SHARED_PROD_DIR = 'MriteUltra-2.6.13';
  let forcedUserData = String(process.env.MRITE_BOOTSTRAP_USER_DATA || '').trim();
  if (devProfile) {
    // update-loader 已把 userData 固定为正式共享目录；若它已经切到 -dev（新版加载器行为），
    // 这里要避免再次追加，得到 -dev-dev 这种目录名。
    const baseDir = forcedUserData ? path.dirname(forcedUserData) : app.getPath('appData');
    const configured = forcedUserData ? path.basename(forcedUserData) : SHARED_PROD_DIR;
    const prodDir = configured.endsWith('-dev') ? configured.slice(0, -'-dev'.length) : configured;
    seedDevProfile(baseDir, prodDir + '-dev', prodDir);
    forcedUserData = path.join(baseDir, prodDir + '-dev');
    process.env.MRITE_BOOTSTRAP_USER_DATA = forcedUserData;
  }
  const appDataDir = forcedUserData ? path.dirname(forcedUserData) : app.getPath('appData');
  const dataDirName = forcedUserData
    ? path.basename(forcedUserData)
    : (devProfile ? SHARED_PROD_DIR + '-dev' : (multiInstance ? 'MriteUltra-collab' : SHARED_PROD_DIR));
  // 兼容更早安装：固定目录尚不存在时，才从 2.6.12 等更老目录整体复制一次。
  if (!multiInstance && !devProfile) migrateOldUserData(appDataDir, dataDirName);
  try { app.setPath('userData', forcedUserData || path.join(appDataDir, dataDirName)); } catch (e) {}

  // ★ 版本号从 package.json 读取（单一来源），不再硬编码
  startupLog('Mrite v' + (require('../../package.json').version || 'unknown') + ' 启动中...');
  startupLog(`Node: ${process.version} | Platform: ${os.platform()} | CWD: ${process.cwd()}`);

  // 1. 错误处理
  // ★ P0-6: 区分"致命错误"（原生模块 ABI 缺失等，可安全退出并提示重装）与"可恢复错误"
  //   （业务逻辑/网络等，记录日志后继续运行），避免任何异常都 3 秒强杀进程导致任务数据丢失。
  process.on('uncaughtException', (err) => {
    startupErr('未捕获的异常', err);
    const msg = String(err?.message || err?.stack || err || '');
    // 原生模块/ABI 错误：better-sqlite3、sharp、mrite-core 等在用户机缺失或版本不匹配时会抛这类错。
    // 这类错误无法恢复，弹友好提示后退出；其余错误尽量让应用继续运行。
    const fatalPattern = /better-sqlite3|NODE_MODULE_VERSION|was compiled against|module version mismatch|mrite-core|sharp|\.node:|libvips|invalid ELF/i;
    if (fatalPattern.test(msg)) {
      startupLog('FATAL: 原生组件错误，3 秒后退出（提示用户修复）');
      setTimeout(() => {
        try {
          dialog.showErrorBox('运行环境异常', '检测到原生组件与当前运行环境不匹配（可能因杀软隔离/安装损坏）。\n请卸载后重新安装软件，或在「设置」中重新修复环境。');
        } catch {}
        process.exit(1);
      }, 3000);
    } else {
      startupLog('NON-FATAL: 已捕获可恢复异常，应用继续运行');
    }
  });
  process.on('unhandledRejection', (reason) => {
    startupLog('ERROR: 未处理的 Promise 拒绝: ' + (reason?.stack || reason?.message || reason));
  });

  // 2. 单实例锁（--multi-instance 时跳过，用于单机双开联调协作）
  if (!multiInstance && !updateSmokeTest) {
    startupLog('获取单实例锁...');
    if (!app.requestSingleInstanceLock()) {
      startupLog('已有实例在运行，退出');
      app.quit();
      process.exit(0);
    }
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }

  // 5. PATH 清理
  cleanTexFromPath();
  startupLog('PATH 清理完成');

  // 6. 加载核心模块
  startupLog('加载核心模块...');
  const config = require('./config');
  const { createWindow } = require('./window');
  const { create: createWorkspace } = require('./workspace');
  const dbModule = require('./database');
  const { registerAll } = require('../ipc/index');
  const authService = require('../services/auth');
  const userService = require('../services/user');
  const updaterService = require('../services/updater');
  const apiProxy = require('../services/proxy');
  const taskService = require('../services/task');
  const procMgr = require('./process-manager');
  const collabServer = require('../services/collab-server');
  const collabClient = require('../services/collab-client');
  startupLog('所有核心模块加载完成');

  // 7. 数据库 + 工作区
  const rootDir = getRootDir();
  startupLog('Root directory: ' + rootDir);
  const { db, dataDir } = dbModule.init(rootDir);
  dbModule.migrateIfNeeded(rootDir);

  // ★ 外部集成环境（Mrite_env）：启动时读取用户手动指定目录 + 分层自动检测，并记录对接信息
  //   必须在 dbModule.init 之后执行——否则 db 未初始化，无法用 dbModule.getSetting 读取手动指定路径
  try {
    const { getAppEnvDir, setConfiguredAppEnvPath } = require('../env/assets');
    try { setConfiguredAppEnvPath(String(dbModule.getSetting('appEnvPath', '') || '')); } catch {}
    const appEnvDir = getAppEnvDir();
    startupLog(appEnvDir ? '检测到集成环境: ' + appEnvDir : '未检测到集成环境（回退内置资源）');
    // Python 运行前检测已改成纯文件级快速检查，不在启动阶段 spawn 子进程。
    // 避免坏环境的 --version 超时拖慢整个主进程；详细版本仅在设置页按需探测。
    try { if (appEnvDir) setImmediate(function() { try { require('../env/latex').getStatus(); } catch {} }); } catch {}
  } catch (e) {}
  let rulesLib = null;
  try { rulesLib = require('../services/rules-library').createRulesLibrary(rootDir); } catch (e) { startupLog('WARN: 规则库模块加载失败 — ' + (e && e.message ? e.message : e)); }
  const workspace = createWorkspace(rootDir, config.projectsDirName, rulesLib);
  startupLog('工作区创建完成: ' + workspace.projectsDir);

  // 旧版全局协作目录一次性迁移：只把能匹配项目名的资源归入该项目/共享文件区；
  // 无法判断归属的旧临时资源直接清理，绝不复活 Workspace-Share 或「协作旧图片备份」。
  try {
    const uniqueTarget = (dst) => {
      if (!fs.existsSync(dst)) return dst;
      const ext = path.extname(dst), base = dst.slice(0, dst.length - ext.length);
      let n = 1, out = base + '_旧版' + ext;
      while (fs.existsSync(out)) out = base + '_旧版' + (++n) + ext;
      return out;
    };
    const mergeMove = (src, dst) => {
      if (!src || !fs.existsSync(src)) return;
      const st = fs.lstatSync(src);
      if (!st.isDirectory()) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(src, uniqueTarget(dst));
        return;
      }
      fs.mkdirSync(dst, { recursive: true });
      for (const name of fs.readdirSync(src)) mergeMove(path.join(src, name), path.join(dst, name));
      try { fs.rmdirSync(src); } catch {}
    };
    const ensureRealDir = (dir) => {
      let linked = '';
      try {
        if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) {
          try { linked = fs.realpathSync(dir); } catch {}
          fs.unlinkSync(dir);
        }
      } catch {}
      fs.mkdirSync(dir, { recursive: true });
      if (linked && fs.existsSync(linked) && path.resolve(linked) !== path.resolve(dir)) mergeMove(linked, dir);
    };
    const normalWorkspace = path.join(rootDir, 'workspace');
    const obsoleteBackup = path.join(normalWorkspace, '协作旧图片备份');
    if (fs.existsSync(obsoleteBackup)) fs.rmSync(obsoleteBackup, { recursive: true, force: true });
    for (const legacyName of ['Workspace-Share', 'Workspace-Shell']) {
      const legacyRoot = path.join(rootDir, legacyName);
      if (!fs.existsSync(legacyRoot)) continue;
      for (const entry of fs.readdirSync(legacyRoot, { withFileTypes: true })) {
        const src = path.join(legacyRoot, entry.name);
        const candidates = [path.join(normalWorkspace, entry.name), path.join(rootDir, config.projectsDirName, entry.name)];
        const projectDir = entry.name === '_shared' ? '' : candidates.find(p => {
          try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; }
        });
        if (!projectDir) {
          fs.rmSync(src, { recursive: true, force: true });
          continue;
        }
        const dst = path.join(projectDir, '共享文件区');
        ensureRealDir(dst);
        mergeMove(src, dst);
      }
      try { fs.rmdirSync(legacyRoot); } catch {}
    }
    startupLog('协作资源目录规则: <项目>/共享文件区；成员缓存: workspace/_collab');
  } catch (e) { startupLog('WARN: 迁移旧协作共享目录失败: ' + e.message); }

  // 8.5 规则库就绪（打包态从内置 rules-library 种入 userData：目录模式取 resources\app\rules-library，
  //     asar 模式取 resources\app.asar\rules-library；dev 直接用项目根 rules-library/）
  //     必须在 resolveCurrentTemplate 之前执行：旧版规则库会被清空重种，避免据此解析出已失效的模板。
  try { if (rulesLib) rulesLib.ensureLibraries(); } catch (e) { startupLog('WARN: 规则库初始化失败 — ' + (e && e.message ? e.message : e)); }
  // 8. 初始化当前模板名（基于已就绪/已重置的规则库重新解析，回退到首个可用模板）
  let projectPath = resolveCurrentTemplate(rulesLib, db);
  let workspaceOverride = '';
  let taskIsRunning = false;
  let taskAbortController = null;

  // 9. 构建上下文
  const ctx = {
    config, db, dataDir, rulesLib,
    getMainWindow: () => mainWindow,
    getProjectPath: () => projectPath,
    setProjectPath: (p) => {
      projectPath = p;
      workspaceOverride = '';
      try { workspace.resetWorkspacePointer(); } catch {}
    },
    getWorkDir: () => workspaceOverride ? workspaceOverride : workspace.getWorkDir(projectPath),
    setWorkspaceOverride: (p) => {
      workspaceOverride = p || '';
      if (!workspaceOverride) { try { workspace.resetWorkspacePointer(); } catch {} }
    },
    getWorkspaceTimestamp: () => workspace.getWorkspaceTimestamp(),
    workspace, projectsDir: workspace.projectsDir,
    isRunning: () => taskIsRunning,
    getAbortController: () => taskAbortController,
    setTaskState: (running, controller) => { taskIsRunning = running; taskAbortController = controller; },
    // ★ v2.7 内容预览（模板&规范编辑）是否有未保存修改：供「直接退出主界面」时拦截提醒
    paperDirty: false,
    setPaperDirty: (v) => { ctx.paperDirty = !!v; },
    hasPaperDirty: () => !!ctx.paperDirty,
  };

  // 10. 注册 IPC + 服务
  startupLog('注册 IPC 模块...');
  registerAll(ctx);
  authService.register();
  userService.register();
  updaterService.register();
  // ★ 开发版解锁必须排在 authService.register() / userService.register() / updaterService.register() 之后：
  //   它们随后注册的同名 IPC（授权校验、账号登录、热更新）会覆盖前面挂的 handler。
  try { require('../services/dev-unlock').install(); } catch (e) { startupLog('WARN: 开发版解锁模块加载失败 — ' + (e && e.message ? e.message : e)); }
  // 热更新负载的选择/失败回滚必须早于 bootstrap，由 main.js 的稳定加载器完成。

  // 11. 退出清理
  function cleanupOnExit() {
    try { taskService.abort(); } catch {}
    try { procMgr.killAll(); } catch {}
    try { apiProxy.stop(); } catch {}
    // 退出收尾：正式数据已在房主项目；成员丢弃临时副本并清理 _collab。
    try { collabServer.stopHost && collabServer.stopHost(); } catch {}
    try { collabClient.leave && collabClient.leave(); } catch {}
    try { if (collabClient.cleanupStaleCollabDirs) collabClient.cleanupStaleCollabDirs(); } catch {}
    try { dbModule.close(); } catch {}
  }
  app.on('before-quit', () => { cleanupOnExit(); });
  app.on('window-all-closed', () => {
    try { authService.recordAppClose?.(); } catch {}
    cleanupOnExit();
    app.quit();
  });
  process.on('SIGTERM', () => { cleanupOnExit(); process.exit(0); });
  process.on('SIGINT', () => { cleanupOnExit(); process.exit(0); });
  if (process.platform === 'win32') {
    try {
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      rl.on('SIGINT', () => { cleanupOnExit(); process.exit(0); });
    } catch {}
  }

  // 12. 创建窗口
  startupLog('等待 app.whenReady()...');

  app.whenReady().then(() => {
    startupLog('app.whenReady() 触发，创建窗口...');
    // ★ 初始化持久化日志：删除超过 1 天的旧日志
    try { require('./logger').rotate(); } catch {}
    // ★ 先补登记存量记录，再清理空工作区。
    //   补登记只认「有产出（inputLoaded 或 求解/论文 非空）且 history 无任何行」的目录，
    //   清理只删空目录，两者互不影响；先补齐更符合直觉，将来清理逻辑收紧也不会误删未登记的。
    //   historyService.init(ctx) 在 ipc/project.js 的 register(ctx) 里执行，早于 app.whenReady()。
    setImmediate(() => {
      try {
        const r = require('../services/history').backfillHistoryRows();
        if (r && r.added) startupLog('历史记录补登记：新增 ' + r.added + ' 条');
      } catch (e) { startupLog('历史记录补登记失败: ' + ((e && e.message) || e)); }
      try { cleanupUncommitted(rootDir, db); } catch {}
    });
    mainWindow = createWindow(config, getIconPath);

    // ★ 预加载求解 SDK（后台预热 import 缓存）：
    //   首次任务启动延迟主要来自冷加载 @anthropic-ai/claude-agent-sdk（约 1~2s），
    //   启动阶段提前后台 import，任务开始时直接命中缓存 → 启动任务明显变快。
    setImmediate(async () => {
      try {
        await import('@anthropic-ai/claude-agent-sdk');
        try { require('./logger').log('[Warm] claude-agent-sdk 预加载完成'); } catch {}
      } catch {}
    });

    applySecurity(mainWindow, isDev);

    // ★ 捕获渲染层 console（含渲染进程报错）到运行日志，便于事后排查 UI 问题
    try {
      mainWindow.webContents.on('console-message', (event, ...args) => {
        let lvl = 1, message = '';
        if (args.length >= 2 && args[1] && typeof args[1] === 'object') {
          // 新签名: (event, { level, message, lineNumber, sourceId, frame })
          const d = args[1];
          lvl = d.level !== undefined ? d.level : 1;
          message = String(d.message || '');
        } else {
          // 旧签名: (event, level, message, line, sourceId)
          lvl = args[0] !== undefined ? args[0] : 1;
          message = String(args[1] !== undefined ? args[1] : '');
        }
        if (!message) return;
        const tag = lvl >= 3 ? 'renderer-ERR' : (lvl === 2 ? 'renderer-WARN' : 'renderer');
        require('./logger').log('[' + tag + '] ' + message.slice(0, 400));
      });
    } catch (e) {}

    // 热更新：页面完整加载且渲染进程保持存活后才确认。若在此之前崩溃，下一次启动自动回滚。
    let rendererHealthy = true;
    mainWindow.webContents.once('render-process-gone', () => { rendererHealthy = false; });
    mainWindow.webContents.once('did-fail-load', () => { rendererHealthy = false; });
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (rendererHealthy && mainWindow && !mainWindow.isDestroyed()) {
          try { updaterService.confirmUpdate(); } catch {}
        }
      }, 3000);
    });

    mainWindow.on('page-title-updated', (event) => { event.preventDefault(); });
    mainWindow.on('close', (event) => {
      if (ctx.isRunning()) {
        event.preventDefault();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app-close-blocked', { reason: 'running' });
        }
        return;
      }
      // ★ v2.7 内容预览有未保存修改：阻止关闭，交由渲染进程确认是否保存
      if (ctx.hasPaperDirty()) {
        event.preventDefault();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app-close-request', {});
        }
        return;
      }
      cleanupUncommitted(rootDir, db);
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    startupLog('启动完成');
  }).catch((err) => {
    startupErr('app.whenReady() 失败', err);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(config, getIconPath);
    }
  });
}

module.exports = { bootstrap };
