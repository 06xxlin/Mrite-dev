// Mrite — 开发版解锁模块（渲染层）
// ═══════════════════════════════════════════════════════════════════════════
// 作用：让界面永远处于「已激活 + 已登录」状态：
//   · 不弹登录遮罩、不弹会员过期窗，面板切换不被拦
//   · 运行任务前的「账号登录」门禁（2.6.14 新增）直接放行
//
// 加载位置：renderer/index.html 中排在**最后一个业务脚本 index.js 之前**。
//   ⚠ 2.6.14 把 showLogin 挪到了 core/shell.js、账号模块挪到了
//     features/settings/account-usage.js，它们都在 toolbar.js 之后加载。
//     若本文件仍在 toolbar.js 后就插入，这些定义会把覆盖顶掉（表现为「还是要登录」）。
//     因此改为靠后加载，并额外保留 re-assert 定时兜底。
//
// 适配版本：Mrite 2.6.14
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  window.Mrite = window.Mrite || {};
  var M = window.Mrite;
  var TAG = '[dev-unlock]';

  var DEV_TOKEN = 'mrite-dev-unlock-token';
  function devUser() {
    return { username: 'developer', nickname: '开发版', avatar: '', vip: 1 };
  }

  M.__devUnlock = true;

  // ── 1. 激活 / 许可证：永远有效 ──
  function applyLicense() {
    M._isActivated = function () { return true; };
    M._isExpired = function () { return false; };

    // 许可证计时器：不启动倒计时、永不过期
    if (M._licenseTimer) {
      M._licenseTimer.isExpired = function () { return false; };
      M._licenseTimer.getRemainingMs = function () { return 0; };
      M._licenseTimer.getRemainingText = function () { return '永久有效'; };
      M._licenseTimer.getExpiresAt = function () { return 0; };
      M._licenseTimer.init = function () {};
      M._licenseTimer.destroy = function () {};
    }
    M._startLicenseTimer = function () {};
    M._onLicenseExpired = function () { stripOverlays(); };
    M._showExpiredPopup = function () { stripOverlays(); };
    M._showLockedDialog = function () { stripOverlays(); };
    M._showTamperedDialog = function () { stripOverlays(); };

    // 登录遮罩：改为空操作（core/shell.js 会重新定义，靠每轮 applyAll 夺回）
    M.showLogin = function () { stripOverlays(); };

    // 授权状态回调：锁定为 authorized，忽略任何“未激活/过期/锁定/篡改”通知
    M._onAuthStateChanged = function () {
      M.STATE.sessionAuthorized = true;
      M.STATE.authState = 'authorized';
      M.STATE.sessionExpiresAt = null;
      if (M.STATE.settings) {
        M.STATE.settings.licensePermanent = true;
        M.STATE.settings.inviteExpiresAt = '';
      }
      stripOverlays();
      if (M.updateButtonStates) M.updateButtonStates();
      if (M.updateStatusIndicator) M.updateStatusIndicator();
      if (M._syncHomeStatus) M._syncHomeStatus();
    };
  }

  // ── 2. 账号层（2.6.14 新增）：常驻一个本地会话，运行任务不再要求登录 ──
  //    账号态来源：localStorage['mrite-user-session'] + Mrite._userToken/_userData；
  //    门禁入口：Mrite._ensureAccountLogin()（toolbar 运行按钮 / 运行检测 / 重载任务）
  function ensureSession() {
    try {
      var raw = localStorage.getItem('mrite-user-session');
      var ok = false;
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.token === DEV_TOKEN) ok = true;
      }
      if (!ok) localStorage.setItem('mrite-user-session', JSON.stringify({ token: DEV_TOKEN, user: devUser() }));
    } catch (e) {}
    M._userToken = DEV_TOKEN;
    if (!M._userData) M._userData = devUser();
  }

  function applyAccount() {
    ensureSession();
    // 真实 _loadUser() 会先清空再从 localStorage 读，这里直接钉死
    M._loadUser = function () { ensureSession(); };
    // 真实 _saveUser(null, null) 来自「退出登录」：开发版忽略清空调用
    M._saveUser = function (token, user) {
      if (!token) { ensureSession(); return; }
      M._userToken = token;
      M._userData = user || M._userData || devUser();
      try { localStorage.setItem('mrite-user-session', JSON.stringify({ token: token, user: M._userData })); } catch (e) {}
      try { if (M._renderWhAvatar) M._renderWhAvatar(); } catch (e) {}
    };
    M._ensureAccountLogin = function () { ensureSession(); return Promise.resolve(true); };
    M._accountRestore = function () {
      ensureSession();
      try { if (M._renderAccount) M._renderAccount(); } catch (e) {}
    };
    M._accountOAuthLogin = function () { ensureSession(); return Promise.resolve(true); };
    M._accountLogout = function () { if (M._showToast) M._showToast('开发版无需退出登录'); };
  }

  // ── 3. 登录/过期遮罩：任何时刻出现就移除 ──
  function stripOverlays() {
    try {
      document.querySelectorAll('.activation-overlay, .expired-popup-overlay').forEach(function (n) {
        n.remove();
      });
    } catch (e) {}
  }

  // ── 4. 统一施加（幂等；2.6.14 的模块加载顺序要求重复夺回被覆盖的定义）──
  function applyAll() {
    try { applyLicense(); } catch (e) {}
    try { applyAccount(); } catch (e) {}
    stripOverlays();
  }

  applyAll();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAll);
  }
  window.addEventListener('load', applyAll);
  // 兜底：后续脚本（core/shell.js 等已加载，但面板动态渲染可能再定义）若再次覆盖，1s 内夺回
  setInterval(applyAll, 1000);

  // 兜底：出现遮罩立即移除
  function startOverlayGuard() {
    try {
      var obs = new MutationObserver(function () { stripOverlays(); });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  if (document.body) startOverlayGuard();
  else document.addEventListener('DOMContentLoaded', startOverlayGuard);

  // ── 5. 清掉历史到期缓存，并写入 DevTools 绕过开关（core/shell.js 自带）──
  try {
    localStorage.removeItem('mrite-license-expiry');
    localStorage.setItem('mrite_dev_bypass_auth', '1');
  } catch (e) {}

  // ── 6. 首帧后再钉一次状态 ──
  setTimeout(function () {
    try {
      applyAll();
      if (M.STATE) {
        M.STATE.sessionAuthorized = true;
        M.STATE.authState = 'authorized';
        if (M.STATE.settings) {
          M.STATE.settings.licensePermanent = true;
          M.STATE.settings.inviteExpiresAt = '';
        }
      }
      if (M._renderAccount) M._renderAccount();
      if (M._syncHomeStatus) M._syncHomeStatus();
      if (M.updateStatusIndicator) M.updateStatusIndicator();
      if (M.updateButtonStates) M.updateButtonStates();
    } catch (e) {}
    stripOverlays();
  }, 1500);

  console.log(TAG + ' 渲染层解锁已生效：登录 / 激活遮挡全部关闭（Mrite 2.6.14）');
})();
