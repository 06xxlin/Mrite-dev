// Mrite — 稳定热更新加载器
// 此文件随基础安装包启动：先固定兼容的 userData，再决定加载基础 app.asar
// 还是 userData/update/app.asar。热更新包必须继续保留 src/core/bootstrap.js 的导出约定。
const fs = require('fs');
const path = require('path');

// 从 2.6.13 起固定复用同一个数据目录。以后升级应用版本时不再创建
// MriteUltra-<新版本>，而是直接打开这套数据库、历史记录和工作区。
const SHARED_USER_DATA_DIR = 'MriteUltra-2.6.13';

function removeIfExists(filePath) {
  try { if (fs.existsSync(filePath)) fs.rmSync(filePath, { recursive: true, force: true }); } catch (_) {}
}

function replaceFromBackup(target, backup) {
  removeIfExists(target);
  if (fs.existsSync(backup)) fs.renameSync(backup, target);
}

function cleanupTransaction(updateDir) {
  for (const name of ['.pending-update', '.update-checking', '.update-ok', '.installing-update', 'app.asar.tmp', '.mrite-update-version.tmp']) {
    removeIfExists(path.join(updateDir, name));
  }
  removeIfExists(path.join(updateDir, 'app.asar.bak'));
  removeIfExists(path.join(updateDir, '.mrite-update-version.bak'));
}

function rollbackUpdate(updateDir) {
  const appAsar = path.join(updateDir, 'app.asar');
  const appBackup = appAsar + '.bak';
  const version = path.join(updateDir, '.mrite-update-version');
  const versionBackup = version + '.bak';
  try {
    if (fs.existsSync(appBackup)) replaceFromBackup(appAsar, appBackup);
    else removeIfExists(appAsar);
    if (fs.existsSync(versionBackup)) replaceFromBackup(version, versionBackup);
    else removeIfExists(version);
  } finally {
    cleanupTransaction(updateDir);
  }
}

// ★ 开发版：源码目录里存在 src/services/dev-unlock.js 即视为开发版。
//   开发版必须始终加载「基础版本」（resources\app 目录），绝不加载 userData\update\app.asar
//   里的官方热更新负载 —— 否则官方热更包一旦落地，下次启动就会把开发版解锁整个顶掉。
function isDevBuild() {
  if (process.argv.includes('--dev-profile')) return true;
  try { return fs.existsSync(path.join(__dirname, '..', 'services', 'dev-unlock.js')); } catch (_) { return false; }
}

function prepareUserData(app, baseVersion) {
  const multiInstance = process.argv.includes('--multi-instance');
  const devProfile = process.argv.includes('--dev-profile');
  const smokeRoot = process.env.MRITE_UPDATE_SMOKE_TEST === '1'
    ? String(process.env.MRITE_UPDATE_SMOKE_ROOT || '').trim()
    : '';
  const appDataDir = smokeRoot && path.isAbsolute(smokeRoot) ? path.resolve(smokeRoot) : app.getPath('appData');
  // ★ 开发版：--dev-profile 用独立的 <正式目录>-dev 数据目录（bootstrap 里首次启动会播种）
  const dirName = multiInstance
    ? 'MriteUltra-collab'
    : (devProfile ? SHARED_USER_DATA_DIR + '-dev' : SHARED_USER_DATA_DIR);
  const userDataDir = path.join(appDataDir, dirName);
  app.setPath('userData', userDataDir);
  process.env.MRITE_BOOTSTRAP_USER_DATA = userDataDir;
  process.env.MRITE_REAL_RESOURCES = process.resourcesPath || '';
  return { multiInstance, userDataDir };
}

function ensureUnpackedBridge(updateDir) {
  const target = path.join(process.resourcesPath || '', 'app.asar.unpacked');
  const link = path.join(updateDir, 'app.asar.unpacked');
  if (!target || !fs.existsSync(target)) return;
  if (fs.existsSync(link)) {
    try {
      const stat = fs.lstatSync(link);
      if (!stat.isSymbolicLink()) return; // 未来若补丁自带真实 unpacked 目录，优先使用它。
      if (path.resolve(fs.realpathSync(link)) === path.resolve(target)) return;
      fs.rmSync(link, { recursive: true, force: true });
    } catch (_) { fs.rmSync(link, { recursive: true, force: true }); }
  }
  // app.asar 内标记为 unpacked 的原生依赖会自动映射到同级 app.asar.unpacked。
  // 热更只下发 asar，因此用目录链接复用基础安装包中 ABI 已校验的原生文件。
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

// electron.exe 受外部环境变量影响时会退化为纯 Node 进程，此时 require('electron')
// 只返回可执行文件路径，取不到 app，后续 app.getPath 会抛出难以定位的 TypeError。
// 这里提前把成因和解法说清楚，避免被误导成代码 bug。
function resolveElectronApp() {
  let electron = null;
  try { electron = require('electron'); } catch (_) {}
  const app = electron && electron.app;
  if (app && typeof app.getPath === 'function') return app;

  const hints = [];
  if (process.env.ELECTRON_RUN_AS_NODE) {
    hints.push(`检测到环境变量 ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE}，`
      + 'electron.exe 会退化为纯 Node 运行；清除该变量后重试'
      + '（cmd: set ELECTRON_RUN_AS_NODE= ；PowerShell: Remove-Item Env:ELECTRON_RUN_AS_NODE）。');
  }
  if (typeof electron === 'string') {
    hints.push('require("electron") 返回的是可执行文件路径而非模块，说明当前并非 Electron 主进程。');
  }
  if (!hints.length) hints.push('当前进程不是 Electron 主进程，或 electron 模块未能加载。');
  throw new Error(`[update-loader] 无法获取 Electron app 对象（这不是代码问题，通常是启动环境导致）。${hints.join(' ')}`);
}

function loadBootstrap() {
  const app = resolveElectronApp();
  const baseVersion = String(require('../../package.json').version || 'x');
  const { multiInstance, userDataDir } = prepareUserData(app, baseVersion);
  const baseBootstrap = () => require('./bootstrap');

  // 联调双开使用隔离数据目录，不加载正式实例的热更新负载。
  // ★ 开发版（源码目录）同理：永远走基础版本，保证解锁代码不被热更包覆盖。
  if (!app.isPackaged || multiInstance || isDevBuild()) return baseBootstrap();

  const updateDir = path.join(userDataDir, 'update');
  const appAsar = path.join(updateDir, 'app.asar');
  const pending = path.join(updateDir, '.pending-update');
  const checking = path.join(updateDir, '.update-checking');
  const installing = path.join(updateDir, '.installing-update');

  try {
    fs.mkdirSync(updateDir, { recursive: true });
    // 上次在换包途中退出，或新包启动后一直没有被确认：先回滚。
    if (fs.existsSync(installing) || (fs.existsSync(pending) && fs.existsSync(checking))) {
      rollbackUpdate(updateDir);
    }
    if (!fs.existsSync(appAsar)) return baseBootstrap();
    if (fs.existsSync(pending)) {
      fs.writeFileSync(checking, JSON.stringify({ startedAt: new Date().toISOString() }), 'utf8');
    }
    ensureUnpackedBridge(updateDir);
    return require(path.join(appAsar, 'src', 'core', 'bootstrap.js'));
  } catch (e) {
    // 包本身不能载入时本次直接退回基础版本，下次启动也不会再次尝试坏包。
    try { rollbackUpdate(updateDir); } catch (_) {}
    console.error('[update-loader] 热更新负载加载失败，已回退基础版本:', e && e.message);
    return baseBootstrap();
  }
}

module.exports = { loadBootstrap, prepareUserData, rollbackUpdate, cleanupTransaction, ensureUnpackedBridge, SHARED_USER_DATA_DIR };
