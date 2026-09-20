// Mrite — 开发版解锁模块（渲染层）
// ═══════════════════════════════════════════════════════════════════════════
// 作用：让界面永远处于「已激活」状态，不弹登录遮罩、不弹会员过期窗，
//       面板切换与任务运行不再被登录/激活拦截。
//
// 加载位置：renderer/index.html 中，排在 license-timer.js / state.js / toolbar.js
//           之后，extensions/*、panels/*、core/shell.js、index.js 之前 ——
//           保证既覆盖这些文件里已有的实现（_isActivated / _isExpired /
//           _onAuthStateChanged / _licenseTimer），又赶在业务代码调用之前生效。
//
// 适配版本：Mrite 2.6.14
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  window.Mrite = window.Mrite || {};
  var M = window.Mrite;
  var TAG = '[dev-unlock]';

  M.__devUnlock = true;

  // ── 1. 激活判定：永远 true ──
  M._isActivated = function () { return true; };
  M._isExpired = function () { return false; };

  // ── 2. 许可证计时器：不启动倒计时、永不过期 ──
  //    （2.6.14 里 _licenseTimer 由 license-timer.js 定义，_startLicenseTimer 供 state.js 调用）
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

  // 清除历史到期时间缓存（否则启动时计时器会按旧时间触发过期回调）
  try {
    localStorage.removeItem('mrite-license-expiry');
    // ★ 2.6.14 的 core/shell.js 自带这个开关：DevTools 里设过它就能跳过授权拦截，
    //   这里直接置位，让面板切换/子面板渲染也不被拦。
    localStorage.setItem('mrite_dev_bypass_auth', '1');
  } catch (e) {}

  // ── 3. 登录遮罩：改为空操作，并移除可能已存在的遮罩 ──
  function stripOverlays() {
    try {
      document.querySelectorAll('.activation-overlay, .expired-popup-overlay').forEach(function (n) {
        n.remove();
      });
    } catch (e) {}
  }
  M.showLogin = function () { stripOverlays(); };

  // ── 4. 授权状态回调：锁定为 authorized，忽略任何“未激活/过期/锁定”通知 ──
  M._onAuthStateChanged = function (state, reason, data) {
    // 任务运行状态照常记录，仅授权相关字段固定为已授权
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

  // ── 5. 兜底：任何时刻出现登录/过期遮罩都立即移除 ──
  function startOverlayGuard() {
    try {
      var obs = new MutationObserver(function () { stripOverlays(); });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    setInterval(stripOverlays, 2000);
  }
  if (document.body) startOverlayGuard();
  else document.addEventListener('DOMContentLoaded', startOverlayGuard);

  // ── 6. 首帧后清掉持久化的非永久授权字段，避免再次触发过期逻辑 ──
  setTimeout(function () {
    try {
      if (M.STATE && M.STATE.settings) {
        M.STATE.settings.licensePermanent = true;
        M.STATE.settings.inviteExpiresAt = '';
        if (M.STATE.settings.apiKey) M.STATE.sessionAuthorized = true;
      }
      M.STATE.sessionAuthorized = true;
      M.STATE.authState = 'authorized';
      if (M._renderAccount) M._renderAccount();
      if (M._syncHomeStatus) M._syncHomeStatus();
      if (M.updateStatusIndicator) M.updateStatusIndicator();
      if (M.updateButtonStates) M.updateButtonStates();
    } catch (e) {}
    stripOverlays();
  }, 1200);

  console.log(TAG + ' 渲染层解锁已生效：登录 / 激活遮挡全部关闭（Mrite 2.6.14）');
})();
