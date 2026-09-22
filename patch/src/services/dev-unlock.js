// Mrite — 开发版解锁模块（主进程侧）
// ═══════════════════════════════════════════════════════════════════════════
// 作用：把「登录账号 / 激活码 / 会员时长」这套授权链路整体置为放行，
//       开发版无需联网登录、无需激活码即可直接使用全部功能。
//
// 调用时机：core/bootstrap.js 中，在 authService.register() / updaterService.register()
//   之后 install()。（register() 会注册这些授权 IPC，必须先让它跑完再覆写。）
//
// 适配版本：Mrite 2.6.15（源码目录形态运行）
//
// 关键点：权限判定走的是 authService 的「运行时属性查找」
//   · services/task/index.js  → authService.verifySessionForOperation()（2.6.15 唯一的任务门槛）
//   · IPC: verify-before-task / check-activation / start-task-verify / check-connection …
// 因此覆写这些导出成员即可全局放行，业务代码本身无需改动。
//   （2.6.15 的 auth.js 内部判定用的是模块内词法函数，不受导出覆写影响，
//     所以下面同时覆写了全部授权相关 IPC 通道。）
//
// ★ 2.6.15 还新增了独立的「账号登录」层（src/services/user.js）：
//   渲染层运行按钮会 await Mrite._ensureAccountLogin()，失败就弹「需要登录账号」并中止。
//   本模块同时把账号相关 IPC（user-login-status / user-me / restore-user-session /
//   oauth-login-start / user-logout）改成常驻已登录，配合渲染层的伪造会话。
//
// 另外必须收口 auth.js 的 notifyAuthState()：register() 会在启动 2s/3s 联网
// 校验收费并广播「未激活」，不收口就会把解锁状态顶掉；渲染层也做了同样的收口。
//
// 保留：机器码生成（DB 字段加解密依赖它）、本地用量统计、模型/API Key 配置。
//       任务走「自有 API Key 直连」路径（task/index.js 的 userKey/userBase 分支），
//       因为无会话 token 时云端代理不可用，自带 Key 才是可用的调用方式。
//
// 还原授权：删除本文件，并移除 core/bootstrap.js 中的 install() 调用。
// ═══════════════════════════════════════════════════════════════════════════
const { ipcMain, BrowserWindow, app } = require('electron');

const TAG = '[dev-unlock]';

// 开发版常驻账号（渲染层 dev-unlock.js 用同一个 token）
const DEV_TOKEN = 'mrite-dev-unlock-token';
const DEV_USER = { username: 'developer', nickname: '开发版', avatar: '', vip: 1 };

function note(msg) {
  console.log(TAG + ' ' + msg);
  try { require('../core/logger').log(TAG + ' ' + msg); } catch {}
}

// 幂等覆写 ipcMain handler：同一 channel 重复注册会抛错，先移除再挂
function override(channel, handler) {
  try { ipcMain.removeHandler(channel); } catch {}
  ipcMain.handle(channel, handler);
}

function broadcastAuthorized(reason) {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('auth-state-changed', {
        state: 'authorized', reason: reason || 'dev-unlock', expiresAt: '', permanent: true,
      });
    }
  } catch {}
}

let _installed = false;

// ═══════════════════════════════════════════════════════════════════════════
// 网络出口封锁：开发版绝不联系官方后台
// 官方域名从 core/backend-url 的黑名单取（该模块本身已把 base 换成黑洞地址），
// 这里再堵三层，确保任何代码路径都出不去：
//   1) DNS：命中黑名单的域名一律解析为 127.0.0.1（http/fetch/ws 全都连不出去，也不产生真实 DNS 查询）
//   2) http/https.request：目标主机命中黑名单时改写为黑洞地址（兜底硬编码直连）
//   3) Electron 渲染层 webRequest：命中黑名单的页面请求直接 cancel（图片/链接/前端 fetch）
// 每次拦截都写一行 [net-block] 日志，方便审计（userData/logs 与控制台都能看到）。
// ═══════════════════════════════════════════════════════════════════════════
const _netBlockStats = { dns: 0, http: 0, web: 0 };

function installNetworkBlock() {
  let blocked = [];
  let blackhole = 'http://127.0.0.1:1';
  try {
    const bu = require('../core/backend-url');
    blocked = (bu.getBlockedHosts() || []).map((h) => String(h).toLowerCase());
    blackhole = bu.BLACKHOLE_BASE || blackhole;
  } catch (e) {}
  if (!blocked.length) { note('WARN: 未取得后端黑名单，跳过网络封锁'); return; }

  const hit = (host) => {
    if (!host) return false;
    const h = String(host).toLowerCase().replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
    return blocked.some((b) => h === b || h.endsWith('.' + b));
  };
  const logBlock = (kind, detail) => {
    _netBlockStats[kind] = (_netBlockStats[kind] || 0) + 1;
    note('[net-block] 已拦截(' + kind + ') ' + detail);
  };
  // 之所以要单独记：core/backend-url 已把后端 base 换成黑洞地址，
  // 于是这些请求的目标看起来是 127.0.0.1:1（不是黑名单域名），
  // 但它们其实是「原本要发给官方后端的请求」，记下来才好审计。
  const isBlackholeTarget = (host, port) => {
    const h = String(host || '').toLowerCase();
    const p = String(port || '');
    return (h === '127.0.0.1' || h === 'localhost' || h === '::1') && (p === '1' || p === '');
  };
  const logBlackhole = (path) => {
    _netBlockStats.http = (_netBlockStats.http || 0) + 1;
    note('[net-block] 后端请求已改道本地黑洞（未离开本机）: ' + (path || '/'));
  };

  // 1) DNS
  try {
    const dns = require('dns');
    const origLookup = dns.lookup;
    dns.lookup = function (hostname, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      if (hit(hostname)) {
        logBlock('dns', String(hostname));
        if (typeof callback === 'function') {
          const all = options && options.all;
          process.nextTick(() => {
            try {
              if (all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
              else callback(null, '127.0.0.1', 4);
            } catch (e) {}
          });
        }
        return;
      }
      return origLookup.apply(dns, arguments);
    };
    if (dns.promises && typeof dns.promises.lookup === 'function') {
      const origP = dns.promises.lookup;
      dns.promises.lookup = function (hostname, options) {
        if (hit(hostname)) {
          logBlock('dns', String(hostname));
          return Promise.resolve(options && options.all ? [{ address: '127.0.0.1', family: 4 }] : { address: '127.0.0.1', family: 4 });
        }
        return origP.apply(dns.promises, arguments);
      };
    }
  } catch (e) { note('WARN: DNS 拦截安装失败 - ' + (e && e.message)); }

  // 2) http / https 请求改写（不改其它主机的请求）
  try {
    for (const name of ['http', 'https']) {
      const mod = require(name);
      for (const fn of ['request', 'get']) {
        const orig = mod[fn];
        if (typeof orig !== 'function') continue;
        mod[fn] = function (...args) {
          try {
            const first = args[0];
            if (typeof first === 'string' || first instanceof URL) {
              const u = new URL(String(first));
              if (hit(u.hostname)) {
                logBlock('http', u.hostname + u.pathname);
                // 只把目标换成黑洞地址，保留协议（https.request 不接受 http: URL）
                u.hostname = '127.0.0.1';
                u.port = '1';
                args[0] = u.toString();
              } else if (isBlackholeTarget(u.hostname, u.port)) {
                logBlackhole(u.pathname + (u.search || ''));
              }
            } else if (first && typeof first === 'object') {
              const host = first.hostname || first.host || '';
              if (hit(host)) {
                logBlock('http', String(host) + (first.path || ''));
                const o = Object.assign({}, first);
                delete o.host;
                o.hostname = '127.0.0.1';
                o.port = 1;
                o.path = first.path || '/';
                args[0] = o;
              } else if (isBlackholeTarget(host, first.port)) {
                logBlackhole(first.path || '/');
              }
            }
          } catch (e) {}
          return orig.apply(mod, args);
        };
      }
    }
  } catch (e) { note('WARN: http 拦截安装失败 - ' + (e && e.message)); }

  // 3) 渲染层（Chromium 网络栈）
  // ★ 必须等 app ready 之后才能取 defaultSession —— install() 是在
  //   bootstrap 里、app.whenReady() 之前调用的，直接取会抛
  //   「Session can only be received when app is ready」，拦截器装不上。
  const installRendererBlock = () => {
    try {
      const { session } = require('electron');
      const patterns = [];
      for (const h of blocked) {
        patterns.push(`*://${h}/*`, `*://*.${h}/*`, `ws://${h}/*`, `wss://${h}/*`);
      }
      session.defaultSession.webRequest.onBeforeRequest({ urls: patterns }, (details, cb) => {
        logBlock('web', String(details.url).slice(0, 120));
        cb({ cancel: true });
      });
      note('渲染层拦截已启用（app ready 后）');
    } catch (e) { note('WARN: 渲染层拦截安装失败 - ' + (e && e.message)); }
  };
  try {
    if (app.isReady()) installRendererBlock();
    else app.whenReady().then(installRendererBlock).catch(function () {});
  } catch (e) { note('WARN: 渲染层拦截安装失败 - ' + (e && e.message)); }

  note('网络封锁已启用：官方后端 ' + blocked.join(', ') + ' 已在 DNS / HTTP / 渲染层三处拦截；'
    + '应用内后端地址一律返回黑洞 ' + blackhole);
}

function getNetBlockStats() { return Object.assign({}, _netBlockStats); }

function install() {
  if (_installed) return;
  _installed = true;

  const auth = require('./auth');

  // ── 1. 授权判定：永远有效 ──
  auth.isLicenseValid = () => true;
  auth.isSessionValid = () => true;
  auth.verifySessionForOperation = () => true;
  auth.verifyOperation = async () => ({ allowed: true, reason: '' });

  // ── 2. 收口授权通知：忽略一切「未激活/过期/锁定」，只放行 authorized ──
  //    注意：auth.register() 内部是通过模块内词法作用域调用 notifyAuthState 的，
  //    覆写导出字段不影响那次调用；因此启动 2s/3s 的那两条通知由渲染层
  //    （renderer/dev-unlock.js 的 _onAuthStateChanged）忽略，
  //    并由第 5 步的主动广播把状态钉在 authorized。
  auth.notifyAuthState = function (state, reason) {
    if (state !== 'authorized') return;
    broadcastAuthorized(reason);
  };

// ── 3. 覆写授权相关 IPC（通道名与 2.6.15 auth.js register() 一一对应）──
  override('verify-before-task', async () => ({ allowed: true, reason: '', serverExpiresAt: '' }));
  override('request-session', async () => ({ authorized: true, expiresAt: '', data: {}, tokenVersion: 0 }));
  override('start-task-verify', async () => ({ success: true, serverExpiresAt: '' }));
  override('stop-task-verify', async () => ({ success: true }));
  override('check-activation', async () => ({ valid: true, expiresAt: '' }));
  override('refresh-license', async () => ({ success: true, expiresAt: '', permanent: true, activated: true }));
  override('get-license-status', async () => ({ success: true, valid: true, activated: true, permanent: true, expiresAt: '' }));
  override('check-connection', async () => ({ connected: true, region: '', lastCheck: Date.now(), ip: '' }));
  override('redeem-code', async () => ({ success: false, error: '开发版无需兑换码' }));
  override('report-usage', async () => ({ success: true, queued: true, dev: true }));
  override('report-task-log', async () => ({ success: true, queued: true, dev: true }));
  override('report-event', async () => ({ success: true, dev: true }));

  // ── 3.5 与官方服务器相关的其它通道：一律本地应答，不发请求 ──
  override('fetch-announcements', async () => ({ success: false, error: '开发版已断开与官方服务器的连接', dev: true }));
  override('fetch-avatars', async () => ({ success: false, error: 'dev-unlock', dev: true }));
  override('mark-announcement-read', async () => ({ success: true, dev: true }));
  override('mark-announcement-dismissed', async () => ({ success: true, dev: true }));
  override('get-backend-url', async () => ({ success: false, url: '', error: '开发版已断开与官方服务器的连接' }));

  // ── 3.6 网络出口封锁：开发版绝不再联系官方后台 ──
  installNetworkBlock();

  // ── 4. 账号登录层（2.6.15 新增）：常驻「已登录」，运行任务不再要求登录 ──
  //    2.6.15 的运行按钮会 await Mrite._ensureAccountLogin()，失败就弹
  //    「需要登录账号」并中止；渲染层已伪造会话，这里再把主进程侧的
  //    账号 IPC 一并放行（跨数据目录恢复会话、退出登录等路径也走同一套）。
  const loginStatus = () => ({ loggedIn: true, user: DEV_USER, token: DEV_TOKEN, dev: true });
  const user = require('./user');
  // 模块级也覆盖一份：主进程内部（如 ipc/task.js 的诊断日志）会直接调 userService.getLoginStatus()
  user.getLoginStatus = loginStatus;
  user.getUserProfile = async () => ({ success: true, user: DEV_USER, dev: true });
  user.restoreUserSession = async () => ({ valid: true, user: DEV_USER, token: DEV_TOKEN, dev: true });
  user.logoutUser = async () => ({ success: true, dev: true });
  override('user-login-status', async () => loginStatus());
  override('user-me', async () => ({ success: true, user: DEV_USER, dev: true }));
  override('restore-user-session', async () => ({ valid: true, user: DEV_USER, token: DEV_TOKEN, dev: true }));
  override('user-logout', async () => ({ success: true, dev: true }));
  override('oauth-login-start', async () => ({ success: true, sessionToken: DEV_TOKEN, user: DEV_USER, dev: true }));

  // ── 5. 关掉热更新（2.6.15 新增）：开发版源码在 resources\app 目录里，
  //    一旦官方热更包落到 userData\update\app.asar，下次启动就会被它顶掉，
  //    开发版解锁随之失效。这里把更新相关 IPC 全部改成「无更新 / 拒绝安装」。
  override('check-for-update', async () => ({ success: true, updateAvailable: false, reason: 'dev-unlock' }));
  override('apply-update', async () => ({ success: false, error: '开发版已禁用热更新（避免覆盖开发源码）' }));
  override('apply-local-patch', async () => ({ success: false, error: '开发版已禁用补丁安装（避免覆盖开发源码）' }));
  override('get-update-state', async () => ({
    recordedVersion: (() => { try { return app.getVersion(); } catch { return ''; } })(),
    state: 'none', updateAvailable: false, manifest: null, dev: true,
  }));

  // ── 6. 主动广播，压制 register() 内部 2s/3s 的联网校验结果 ──
  [2500, 5000, 8000, 15000].forEach((t) => setTimeout(broadcastAuthorized, t));

  note('开发版解锁已生效：登录 / 激活码 / 会员时长校验全部放行（Mrite 2.6.15）');
  note('账号层已放行：界面常驻「已登录」，运行任务不再要求登录账号');
  note('任务使用「设置 → 模型配置」中的自有 API Key 直连（不走云端代理）');
  note('热更新已关闭：官方热更包不会覆盖本开发版源码');
}

module.exports = { install, broadcastAuthorized, installNetworkBlock, getNetBlockStats, TAG };
