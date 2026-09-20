// Mrite — 开发版解锁模块（主进程侧）
// ═══════════════════════════════════════════════════════════════════════════
// 作用：把「登录账号 / 激活码 / 会员时长」这套授权链路整体置为放行，
//       开发版无需联网登录、无需激活码即可直接使用全部功能。
//
// 调用时机：core/bootstrap.js 中，在 authService.register() / updaterService.register()
//   之后 install()。（register() 会注册这些授权 IPC，必须先让它跑完再覆写。）
//
// 适配版本：Mrite 2.6.14（源码目录形态运行）
//
// 关键点：权限判定走的是 authService 的「运行时属性查找」
//   · services/task/index.js  → authService.verifySessionForOperation()（2.6.14 唯一的任务门槛）
//   · IPC: verify-before-task / check-activation / start-task-verify / check-connection …
// 因此覆写这些导出成员即可全局放行，业务代码本身无需改动。
//   （2.6.14 的 auth.js 内部判定用的是模块内词法函数，不受导出覆写影响，
//     所以下面同时覆写了全部授权相关 IPC 通道。）
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

  // ── 3. 覆写授权相关 IPC（通道名与 2.6.14 auth.js register() 一一对应）──
  override('verify-before-task', async () => ({ allowed: true, reason: '', serverExpiresAt: '' }));
  override('request-session', async () => ({ authorized: true, expiresAt: '', data: {}, tokenVersion: 0 }));
  override('start-task-verify', async () => ({ success: true, serverExpiresAt: '' }));
  override('stop-task-verify', async () => ({ success: true }));
  override('check-activation', async () => ({ valid: true, expiresAt: '' }));
  override('refresh-license', async () => ({ success: true, expiresAt: '', permanent: true, activated: true }));
  override('get-license-status', async () => ({ success: true, activated: true, permanent: true, expiresAt: '' }));
  override('check-connection', async () => ({ connected: true, region: '', lastCheck: Date.now(), ip: '' }));
  override('redeem-code', async () => ({ success: false, error: '开发版无需兑换码' }));
  override('report-usage', async () => ({ success: true, queued: true, dev: true }));
  override('report-task-log', async () => ({ success: true, queued: true, dev: true }));
  override('report-event', async () => ({ success: true, dev: true }));

  // ── 4. 关掉热更新（2.6.14 新增）：开发版源码在 resources\app 目录里，
  //    一旦官方热更包落到 userData\update\app.asar，下次启动就会被它顶掉，
  //    开发版解锁随之失效。这里把更新相关 IPC 全部改成「无更新 / 拒绝安装」。
  override('check-for-update', async () => ({ success: true, updateAvailable: false, reason: 'dev-unlock' }));
  override('apply-update', async () => ({ success: false, error: '开发版已禁用热更新（避免覆盖开发源码）' }));
  override('apply-local-patch', async () => ({ success: false, error: '开发版已禁用补丁安装（避免覆盖开发源码）' }));
  override('get-update-state', async () => ({
    recordedVersion: (() => { try { return app.getVersion(); } catch { return ''; } })(),
    state: 'none', updateAvailable: false, manifest: null, dev: true,
  }));

  // ── 5. 主动广播，压制 register() 内部 2s/3s 的联网校验结果 ──
  [2500, 5000, 8000, 15000].forEach((t) => setTimeout(broadcastAuthorized, t));

  note('开发版解锁已生效：登录 / 激活码 / 会员时长校验全部放行（Mrite 2.6.14）');
  note('任务使用「设置 → 模型配置」中的自有 API Key 直连（不走云端代理）');
  note('热更新已关闭：官方热更包不会覆盖本开发版源码');
}

module.exports = { install, broadcastAuthorized, TAG };
