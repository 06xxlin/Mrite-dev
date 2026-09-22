// ★ 获取供应商图标路径
Mrite._getProviderIcon = function(baseURL) {
  if (!baseURL) return '../assets/icons/providers/custom.svg';
  var u = baseURL.toLowerCase();
  if (u.includes('deepseek')) return '../assets/icons/providers/deepseek.ico';
  if (u.includes('xiaomi') || u.includes('mimo')) return '../assets/icons/providers/xiaomi.png';
  if (u.includes('moonshot') || u.includes('kimi')) return '../assets/icons/providers/moonshot.ico';
  if (u.includes('bigmodel') || u.includes('glm') || u.includes('zhipu')) return '../assets/icons/providers/glm.png';
  if (u.includes('openai')) return '../assets/icons/providers/openai.ico';
  if (u.includes('anthropic') || u.includes('claude')) return '../assets/icons/providers/anthropic.png';
  if (u.includes('google') || u.includes('gemini') || u.includes('generativelanguage')) return '../assets/icons/providers/gemini.png';
  if (u.includes('x.ai') || u.includes('grok')) return '../assets/icons/providers/xai.ico';
  if (u.includes('baichuan')) return '../assets/icons/providers/baichuan.png';
  if (u.includes('qwen') || u.includes('dashscope')) return '../assets/icons/providers/qwen.png';
  if (u.includes('doubao') || u.includes('volc')) return '../assets/icons/providers/doubao.png';
  if (u.includes('yi.') || u.includes('01.ai')) return '../assets/icons/providers/yi.png';
  if (u.includes('stepfun') || u.includes('step')) return '../assets/icons/providers/stepfun.png';
  if (u.includes('minimax')) return '../assets/icons/providers/minimax.ico';
  if (u.includes('spark') || u.includes('xfyun')) return '../assets/icons/providers/spark.ico';
  if (u.includes('cohere')) return '../assets/icons/providers/cohere.png';
  if (u.includes('mistral')) return '../assets/icons/providers/mistral.ico';
  return '../assets/icons/providers/custom.svg';
};

// ★ 获取供应商简称
Mrite._getProviderLabel = function(baseURL) {
  if (!baseURL) return '自定义';
  var u = baseURL.toLowerCase();
  if (u.includes('deepseek')) return 'DeepSeek';
  if (u.includes('xiaomi') || u.includes('mimo')) return '小米 MiMo';
  if (u.includes('moonshot') || u.includes('kimi')) return 'Kimi';
  if (u.includes('bigmodel') || u.includes('glm')) return '智谱 GLM';
  if (u.includes('qwen') || u.includes('dashscope')) return '阿里 千问';
  if (u.includes('openai')) return 'OpenAI';
  if (u.includes('anthropic')) return 'Claude';
  if (u.includes('google') || u.includes('gemini') || u.includes('generativelanguage')) return 'Gemini';
  if (u.includes('x.ai')) return 'Grok';
  return '自定义';
};

Mrite._normalizeApiFormat = function(value, baseURL) {
  var raw = String(value || 'auto').toLowerCase();
  if (raw === 'anthropic' || raw === 'messages') return 'anthropic';
  if (raw === 'responses' || raw === 'response') return 'responses';
  if (raw === 'chat' || raw === 'openai' || raw === 'chat_completions' || raw === 'chat-completions') return 'chat';
  var url = String(baseURL || '').toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '');
  if (/(?:^|\/)responses$/.test(url)) return 'responses';
  if (/(?:^|\/)chat\/completions$/.test(url)) return 'chat';
  if (url.includes('api.anthropic.com') || url.includes('/anthropic')) return 'anthropic';
  return 'chat';
};

Mrite._apiFormatLabel = function(value, baseURL) {
  var format = Mrite._normalizeApiFormat(value, baseURL);
  return format === 'responses' ? 'Responses' : (format === 'anthropic' ? 'Messages' : 'Chat');
};

Mrite._apiEndpoint = function(baseURL, format) {
  var base = String(baseURL || '').replace(/\/+$/, '');
  var suffix = Mrite._normalizeApiFormat(format, baseURL);
  if (suffix === 'anthropic') {
    if (/\/(?:v1\/)?messages$/i.test(base)) return base;
    return base + (/\/v\d+(?:beta)?$/i.test(base) ? '/messages' : '/v1/messages');
  }
  if (suffix === 'responses') {
    if (/\/responses$/i.test(base)) return base;
    if (/\/chat\/completions$/i.test(base)) return base.replace(/\/chat\/completions$/i, '/responses');
    return base + (/\/v\d+(?:beta)?$/i.test(base) ? '/responses' : '/v1/responses');
  }
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/responses$/i.test(base)) return base.replace(/\/responses$/i, '/chat/completions');
  return base + (/\/v\d+(?:beta)?$/i.test(base) ? '/chat/completions' : '/v1/chat/completions');
};

// ★ 保存当前 API 配置到列表
Mrite._saveCurrentApiConfig = function() {
  var s = Mrite.STATE.settings;
  var base = (s.apiBase || '').trim();
  var key = (s.apiKey || '').trim();
  var model = (s.apiModel || '').trim();

  if (!base) {
    Mrite._showToast('请填写 API 端点');
    return;
  }
  if (!model) {
    Mrite._showToast('请填写模型名称');
    return;
  }
  if (!key) {
    Mrite._showToast('请填写 API Key');
    return;
  }

  // 确保数组存在
  if (!Array.isArray(s.apiModels)) s.apiModels = [];

  // 检查是否已存在相同配置（base + model 去重）
  var dupIdx = -1;
  for (var i = 0; i < s.apiModels.length; i++) {
    var m = s.apiModels[i];
    if (m && m.baseURL === base && m.name === model) { dupIdx = i; break; }
  }

  var entry = {
    name: model,
    baseURL: base,
    apiKey: key,
    provider: Mrite._getProviderLabel(base),
    // ★ 记录该配置的 apiFormat（openai/anthropic/auto），重启后仍能正确路由走代理
    apiFormat: Mrite.STATE.settings.apiFormat || 'auto',
    ts: Date.now()
  };

  if (dupIdx >= 0) {
    s.apiModels[dupIdx] = entry;
    s._activeModelIndex = dupIdx;
    Mrite._showToast('已更新配置: ' + model);
  } else {
    s.apiModels.push(entry);
    s._activeModelIndex = s.apiModels.length - 1;
    Mrite._showToast('已保存: ' + model);
  }

  // 同步扁平字段（确保任务执行时读到最新值）
  s.apiBase = base;
  s.apiKey = key;
  s.apiModel = model;

  Mrite.saveSettings();

  // ★ 保存后清空 API 配置表单（只清 Key，DeepSeek 预设的 URL/模型保持不变）
  var kEl3 = document.getElementById('inputApiKey');
  if (kEl3) kEl3.value = '';
  var hEl3 = document.getElementById('apiKeyHint');
  if (hEl3) hEl3.style.display = 'none';

  Mrite._renderSavedModels();
  Mrite._updateApiHero();
};

// ★ 渲染已保存模型列表（开关 + 测试 + 删除）
Mrite._renderSavedModels = function() {
  var listEl = document.getElementById('savedModelsList');
  if (!listEl) return;

  var models = (Mrite.STATE.settings && Array.isArray(Mrite.STATE.settings.apiModels))
    ? Mrite.STATE.settings.apiModels : [];

  if (models.length === 0) {
    listEl.innerHTML = '<div class="saved-models-empty">填写配置后点击「保存配置」添加</div>';
    return;
  }

  var activeIdx = Mrite.STATE.settings._activeModelIndex;
  var testResults = Mrite._testResults || {};

  var html = '';
  for (var i = 0; i < models.length; i++) {
    var m = models[i];
    if (!m || !m.name) continue;
    var icon = Mrite._getProviderIcon(m.baseURL);
    var isActive = (activeIdx === i);
    var provider = m.provider || Mrite._getProviderLabel(m.baseURL);
    var meta = provider + ' · ' + Mrite._apiFormatLabel(m.apiFormat, m.baseURL)
      + (m.baseURL ? ' · ' + m.baseURL.replace(/^https?:\/\//, '').slice(0, 35) : '');

    // 测试结果
    var test = testResults[i];
    var latencyHtml = '';
    if (test) {
      if (test.ok) {
        latencyHtml = '<span class="saved-model-latency latency-ok">' + test.ms + 'ms</span>';
      } else {
        latencyHtml = '<span class="saved-model-latency latency-fail">' + (test.msg || '失败') + '</span>';
      }
    }

    html += '<div class="saved-model-item' + (isActive ? ' active' : '') + '">';
    html += '<img src="' + icon + '" class="saved-model-icon" onerror="this.src=\'../assets/icons/providers/custom.svg\'">';
    html += '<div class="saved-model-info">';
    html += '<div class="saved-model-name">';
    html += Mrite._escHtml(m.name);
    if (latencyHtml) html += latencyHtml;
    html += '</div>';
    html += '<div class="saved-model-meta">' + Mrite._escHtml(meta) + '</div>';
    html += '</div>';
    html += '<div class="saved-model-actions">';
    // 开关按钮
    html += '<label class="model-toggle-switch" onclick="event.stopPropagation()">';
    html += '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="Mrite._toggleModelActive(' + i + ', this.checked)">';
    html += '<span class="model-toggle-slider"></span>';
    html += '</label>';
    // 测试按钮
    html += '<button class="saved-model-btn btn-test" onclick="event.stopPropagation();Mrite._testApiConnectivity(' + i + ')" title="测试连通性">';
    html += '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    html += '测试</button>';
    // 删除按钮
    html += '<button class="saved-model-btn btn-delete" onclick="event.stopPropagation();Mrite._deleteSavedModel(' + i + ')" title="删除">';
    html += '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    html += '</button>';
    html += '</div>';
    html += '</div>';
  }

  listEl.innerHTML = html;
};

// ★ 测试结果缓存
Mrite._testResults = {};

// ★ 测试 API 连通性（结果只在按钮上显示）
Mrite._testApiConnectivity = async function(index) {
  var models = (Mrite.STATE.settings && Array.isArray(Mrite.STATE.settings.apiModels))
    ? Mrite.STATE.settings.apiModels : [];
  var m = models[index];
  if (!m) return;

  var items = document.querySelectorAll('.saved-model-item');
  var card = items[index];
  if (!card) return;
  var btn = card.querySelector('.btn-test');

  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    var baseURL = m.baseURL || '';
    var apiKey = m.apiKey || '';
    var model = m.name || '';

    var format = Mrite._normalizeApiFormat(m.apiFormat, baseURL);
    var testUrl, testHeaders, testBody;

    if (format === 'anthropic') {
      testUrl = Mrite._apiEndpoint(baseURL, format);
      testHeaders = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
      testBody = JSON.stringify({ model: model, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] });
    } else if (format === 'responses') {
      testUrl = Mrite._apiEndpoint(baseURL, format);
      testHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
      testBody = JSON.stringify({ model: model, max_output_tokens: 16, input: 'hi', store: false });
    } else {
      testUrl = Mrite._apiEndpoint(baseURL, format);
      testHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
      testBody = JSON.stringify({ model: model, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] });
    }

    var startTime = Date.now();
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 15000);

    var resp = await fetch(testUrl, { method: 'POST', headers: testHeaders, body: testBody, signal: controller.signal });
    clearTimeout(timeoutId);
    var latency = Date.now() - startTime;

    if (resp.ok) {
      Mrite._testResults[index] = { ok: true, ms: latency };
      if (btn) { btn.textContent = latency + 'ms'; btn.classList.add('btn-ok'); btn.classList.remove('btn-fail'); }
    } else {
      var errText = '';
      try { var ej = await resp.json(); errText = ej.error?.message || ej.message || ''; } catch { errText = ''; }
      Mrite._testResults[index] = { ok: false, msg: '✗ ' + resp.status };
      if (btn) { btn.textContent = '✗ ' + resp.status; btn.classList.add('btn-fail'); btn.classList.remove('btn-ok'); }
    }
  } catch (e) {
    var msg = e.name === 'AbortError' ? '超时' : '网络错误';
    Mrite._testResults[index] = { ok: false, msg: '✗ ' + msg };
    if (btn) { btn.textContent = '✗ ' + msg; btn.classList.add('btn-fail'); btn.classList.remove('btn-ok'); }
  }

  // 重新渲染（保留测试结果）
  setTimeout(function() { Mrite._renderSavedModels(); }, 100);
};

// ★ HTML 转义
Mrite._escHtml = function(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};

// ★ 开关切换：激活/取消已保存的模型配置
Mrite._toggleModelActive = function(index, checked) {
  var s = Mrite.STATE.settings;
  if (!Array.isArray(s.apiModels) || !s.apiModels[index]) return;
  var m = s.apiModels[index];

  if (checked) {
    // 激活该配置（只同步扁平字段给后端，不填充表单）
    s._activeModelIndex = index;
    s.apiBase = m.baseURL || '';
    s.apiKey = m.apiKey || '';
    s.apiModel = m.name || '';
    s.apiFormat = m.apiFormat || 'auto';
    // 取消其他开关
    var checkboxes = document.querySelectorAll('.model-toggle-switch input[type="checkbox"]');
    for (var ci = 0; ci < checkboxes.length; ci++) {
      if (ci !== index) checkboxes[ci].checked = false;
    }
  } else {
    s._activeModelIndex = -1;
    s.apiBase = '';
    s.apiKey = '';
    s.apiModel = '';
    s.apiFormat = 'auto';
    // 关闭开关时清空 hero
  }

  Mrite.saveSettings();
  // ★ 唯一持久化来源：直接写 localStorage
  try { localStorage.setItem('mrite-active-model-index', String(s._activeModelIndex)); } catch(e) {}
  Mrite._renderSavedModels();
  Mrite._updateApiHero();
  if (checked) {
    Mrite._showToast('已切换至: ' + m.name);
  }
};

// ★ 删除已保存的模型配置
Mrite._deleteSavedModel = function(index) {
  var s = Mrite.STATE.settings;
  if (!Array.isArray(s.apiModels) || !s.apiModels[index]) return;
  var name = s.apiModels[index].name;
  s.apiModels.splice(index, 1);
  // 清理活动索引
  if (s._activeModelIndex === index) s._activeModelIndex = -1;
  else if (s._activeModelIndex > index) s._activeModelIndex--;
  // 清理测试结果
  if (Mrite._testResults) {
    delete Mrite._testResults[index];
    var newResults = {};
    for (var k in Mrite._testResults) {
      var ki = parseInt(k);
      newResults[ki > index ? ki - 1 : ki] = Mrite._testResults[k];
    }
    Mrite._testResults = newResults;
  }
  // 同步扁平字段（删除后指向新活动项或清空）
  if (s._activeModelIndex >= 0 && s.apiModels[s._activeModelIndex]) {
    var newActive = s.apiModels[s._activeModelIndex];
    s.apiBase = newActive.baseURL || '';
    s.apiKey = newActive.apiKey || '';
    s.apiModel = newActive.name || '';
    s.apiFormat = newActive.apiFormat || 'auto';
  } else {
    s.apiBase = '';
    s.apiKey = '';
    s.apiModel = '';
    s.apiFormat = 'auto';
  }

  Mrite.saveSettings();
  try { localStorage.setItem('mrite-active-model-index', String(s._activeModelIndex)); } catch(e) {}
  Mrite._renderSavedModels();
  Mrite._updateApiHero();
  Mrite._showToast('已删除: ' + name);
};

// ★ 导航切换 — 公共函数，供 HTML 内联 onclick 调用
Mrite._navToSection = function(el, section) {
  // 更新导航 active
  var nav = el.parentElement;
  if (nav) {
    nav.querySelectorAll('.set-nav-item').forEach(function(i) { i.classList.remove('active'); });
  }
  el.classList.add('active');
  // ★ 开发版：进入模型配置不再有任何答题 / 解锁门禁（原「API 常识答题」已整体移除）
  // 更新内容区 active
  var content = document.getElementById('settingsContent');
  if (content) {
    content.querySelectorAll('.set-section-panel').forEach(function(p) { p.classList.remove('active'); });
    var target = content.querySelector('[data-section="' + section + '"]');
    if (target) target.classList.add('active');
  }
};

// ★ 所有按钮事件均使用 HTML 内联 onclick

// ═══════════ API 答题门禁：开发版已移除 ═══════════
//  官方原版在这里有一整套「API 报错诊断答题」：15 道固定报错题 + 5 道随机常识题，
//  每题限时 20 秒、报错题两问全对才算对，20/20 才允许连接 DeepSeek 以外的模型；
//  未通过时供应商卡片置灰、端点 / 模型 / Key / 接口形式四个输入框被 disabled，
//  按钮文案是「答题解锁配置权限 / 解锁其他模型」。
//  开发版把这套门禁整体删掉，模型随便接：
//    · 供应商卡片全部可选，端点 / 模型名 / Key / 接口形式随便填，没有任何答题
//    · 下面保留同名空实现，避免任何遗漏的调用点报错
//    · 顺手清掉历史遗留的 localStorage 标记
try {
  localStorage.removeItem('mrite-api-quiz-passed');
  localStorage.removeItem('mrite-api-quiz-attempted');
} catch (_) {}

Mrite._quiz = null;
// 永远「已通过」：任何依赖它的判断都会放行
Mrite._apiQuizPassed = function() { return true; };
// 不再锁定任何供应商卡片与表单
Mrite._applyApiQuizLock = function() {};
Mrite._onEnterApiConfig = function() {};
// 兜底：万一还有入口触发答题，直接按「已通过」回调，不弹任何题目
Mrite._showApiQuiz = function(finished) {
  if (typeof finished === 'function') finished(true);
};

// ★ 自动保存：仅读取 DOM 中存在的字段，避免面板关闭时误清空
Mrite._autoSaveSettings = async function(scope) {
  var st = Mrite.STATE.settings;
  var el;
  el = document.querySelector('#inputTeamCode'); if (el) st.teamCode = el.value.trim();
  el = document.querySelector('#inputGroup'); if (el) st.group = el.value.trim();
  el = document.querySelector('#inputProblemNumber'); if (el) st.problemNumber = el.value.trim();
  el = document.querySelector('#inputSchool'); if (el) st.school = el.value.trim();
  // 队员三格（#inputMembers 已下线：队员拆成 member1/2/3，见 upload.js 的 _memberKeys）
  ['member1', 'member2', 'member3'].forEach(function(key, i) {
    var box = document.querySelector('#inputMember' + (i + 1));
    if (box) st[key] = box.value.trim();
  });
  if (window.Mrite && Mrite._composeMembers) st.members = Mrite._composeMembers(st);
  el = document.querySelector('#inputAdvisor'); if (el) st.advisor = el.value.trim();
  el = document.querySelector('#inputStylePrompt'); if (el) st.stylePrompt = el.value.trim().slice(0, 100);
  var quantFields = {
    inputQuantPagesMin: 'quantPagesMin', inputQuantPagesMax: 'quantPagesMax',
    inputQuantImagesMin: 'quantImagesMin', inputQuantImagesMax: 'quantImagesMax',
    inputQuantFormulasMin: 'quantFormulasMin', inputQuantFormulasMax: 'quantFormulasMax',
    inputQuantTablesMin: 'quantTablesMin', inputQuantTablesMax: 'quantTablesMax'
  };
  Object.keys(quantFields).forEach(function(id) {
    var input = document.getElementById(id);
    if (!input) return;
    st[quantFields[id]] = input.value === '' ? '' : Math.max(0, Number(input.value));
  });
  el = document.querySelector('#inputApiBase'); if (el) st.apiBase = el.value.trim();
  el = document.querySelector('#inputApiKey'); if (el) st.apiKey = el.value.trim();
  el = document.querySelector('#inputApiModel'); if (el) st.apiModel = el.value.trim() || '';
  el = document.querySelector('#inputApiFormat'); if (el) st.apiFormat = el.value || 'auto';
  // 环境配置
  el = document.querySelector('#envLatexSelect'); if (el) st.latexEnvMode = el.value || 'builtin';
  el = document.querySelector('#envLatexPath'); if (el) st.latexEnvPath = (el.value.trim() === '内置 TinyTeX') ? '' : el.value.trim();
  el = document.querySelector('#envPythonSelect'); if (el) st.pythonEnvMode = el.value || 'builtin';
  el = document.querySelector('#envPythonPath'); if (el) st.pythonEnvPath = (el.value.trim() === '内置 Python') ? '' : el.value.trim();
  if (scope === 'solve' && Mrite._markTaskSolveCustom) Mrite._markTaskSolveCustom();
  Mrite.saveSettings();
  if (Mrite._renderTaskSolveConfig) Mrite._renderTaskSolveConfig();
};

// ★ 激活码验证已移除，改为账号登录制（激活在个人中心网页完成）

// ★ 启动许可证计时器：基于服务器返回的到期时间，自然时间倒计时
Mrite._startLicenseTimer = function(data) {
  if (!data || !data.expiresAt) return;
  var expiresAt = new Date(data.expiresAt).getTime();
  if (expiresAt <= 0) return;
  Mrite.STATE.settings.licenseExpiresAt = expiresAt;
  if (Mrite._licenseTimer && typeof Mrite._licenseTimer.init === 'function') {
    Mrite._licenseTimer.init(expiresAt, Mrite._onLicenseExpired);
  }
};

// ★ 许可证过期处理（本地倒计时结束 / 服务器确认过期）
Mrite._onLicenseExpired = function() {
  // 如果任务正在运行，弹出过期弹窗
  if (Mrite.STATE && Mrite.STATE.runStatus === 'running') {
    Mrite._showExpiredPopup && Mrite._showExpiredPopup();
  }
  Mrite.updateButtonStates && Mrite.updateButtonStates();
  Mrite.updateStatusIndicator && Mrite.updateStatusIndicator();
};

// ★ 过期后引导去个人中心充值
Mrite._tryReVerifyOnExpire = function() {
  Mrite._accountOpenWeb && Mrite._accountOpenWeb();
};

Mrite._reloadAccountData = function() {
  try { if (Mrite.loadHistoryList) Mrite.loadHistoryList(); } catch(e) {}
  try { if (Mrite._refreshDash) Mrite._refreshDash(); } catch(e) {}
};

// ★ 手动刷新会员时长：从服务器（个人中心）同步最新时长
Mrite._refreshMembership = async function() {
  var btn = document.getElementById('refreshLicenseBtn');
  var txt = document.getElementById('refreshLicenseBtnText');
  if (btn) btn.disabled = true;
  if (txt) txt.textContent = '同步中';
  try {
    if (!window.electronAPI || !window.electronAPI.refreshLicense) {
      Mrite._showToast('当前环境不支持同步'); return;
    }
    var r = await window.electronAPI.refreshLicense();
    if (r && r.success) {
      if (r.permanent) {
        Mrite.STATE.settings.inviteExpiresAt = '';
        Mrite.STATE.settings.licensePermanent = true;
      } else {
        Mrite.STATE.settings.inviteExpiresAt = r.expiresAt || '';
        Mrite.STATE.settings.licensePermanent = false;
      }
      Mrite.STATE.sessionAuthorized = !!r.activated;
      Mrite.STATE.authState = r.activated ? 'authorized' : 'not_activated';
      Mrite.saveSettings();
      if (Mrite._startLicenseTimer) Mrite._startLicenseTimer({ expiresAt: r.expiresAt || '' });
      Mrite._renderAccount();
      if (Mrite.updateButtonStates) Mrite.updateButtonStates();
      if (Mrite.updateStatusIndicator) Mrite.updateStatusIndicator();
      if (Mrite._syncHomeStatus) Mrite._syncHomeStatus();
      Mrite._showToast('会员时长已同步');
    } else {
      Mrite._showToast((r && r.error) || '同步失败，请稍后再试');
    }
  } catch (e) {
    Mrite._showToast('网络错误，请重试');
  }
};

// ★ 兑换面板展开/收起
Mrite._toggleRedeem = function() {
  var dd = document.getElementById('redeemDropdown');
  if (!dd) return;
  var show = dd.style.display === 'none';
  dd.style.display = show ? 'block' : 'none';
  if (show) {
    var input = document.getElementById('redeemCodeInput');
    if (input) setTimeout(function() { input.focus(); }, 100);
  }
};

// ★ 兑换激活码/兑换码
Mrite._doRedeemCode = async function() {
  var input = document.getElementById('redeemCodeInput');
  var btn = document.getElementById('redeemCodeBtn');
  var msg = document.getElementById('redeemCodeMsg');
  if (!input || !btn) return;
  var code = input.value.trim();
  if (!code) { if (msg) { msg.textContent = '请输入激活码或兑换码'; msg.style.color = '#a1a1aa'; } return; }
  btn.disabled = true; btn.textContent = '兑换中...';
  if (msg) { msg.textContent = ''; msg.style.color = ''; }
  try {
    var r = await window.electronAPI.redeemCode(code);
    if (r && r.success) {
      var dur = r.permanent ? '永久' : (r.durationDays ? r.durationDays + '天' : '');
      if (msg) { msg.textContent = '兑换成功！' + (dur ? '时长 +' + dur : '') + (r.activationCode ? ' | 激活码: ' + r.activationCode : ''); msg.style.color = '#059669'; }
      input.value = '';
      // 刷新本地许可证状态
      if (r.expiresAt) {
        Mrite.STATE.settings.inviteExpiresAt = r.expiresAt;
        Mrite.STATE.settings.licensePermanent = false;
      } else if (r.permanent) {
        Mrite.STATE.settings.inviteExpiresAt = '';
        Mrite.STATE.settings.licensePermanent = true;
      }
      Mrite.saveSettings();
      Mrite._startLicenseTimer({ expiresAt: r.expiresAt || '' });
      Mrite.STATE.sessionAuthorized = true;
      Mrite.STATE.authState = 'authorized';
      Mrite.updateButtonStates();
      Mrite.updateStatusIndicator();
      // ★ 从服务器刷新最新到期时间
      try { await window.electronAPI.refreshLicense(); } catch(e) {}
      setTimeout(function() { Mrite._renderAccount(); }, 500);
    } else {
      if (msg) { msg.textContent = (r && r.error) || '兑换失败'; msg.style.color = '#a1a1aa'; }
    }
  } catch (e) {
    if (msg) { msg.textContent = '网络错误，请重试'; msg.style.color = '#a1a1aa'; }
  }
  btn.disabled = false; btn.textContent = '兑 换';
};

Mrite._accountOAuthLogin = function() {
  if (!window.electronAPI || !window.electronAPI.openOAuthLogin) { Mrite._showToast('当前环境不支持登录'); return Promise.resolve(false); }
  Mrite._oauthLoggingIn = true;
  Mrite._showToast('请在浏览器中完成授权...');
  return window.electronAPI.openOAuthLogin()
    .then(async function(res) {
      Mrite._oauthLoggingIn = false;
      if (res && res.success && res.sessionToken && res.user) {
        Mrite._saveUser(res.sessionToken, res.user);
        Mrite._renderAccount();
        Mrite._showToast('登录成功');
        Mrite._reloadAccountData();
        // ★ 登录成功后，用 userToken 请求会话（检查激活状态）
        try {
          var sessionResult = await window.electronAPI.requestSession(res.sessionToken, true);
          if (sessionResult && sessionResult.authorized) {
            Mrite.STATE.sessionAuthorized = true;
            Mrite.STATE.authState = 'authorized';
            if (sessionResult.licenseExpiresAt) {
              Mrite.STATE.settings.inviteExpiresAt = sessionResult.licenseExpiresAt;
              Mrite.STATE.settings.licensePermanent = !sessionResult.licenseExpiresAt;
            }
            Mrite.saveSettings();
            if (Mrite._startLicenseTimer) Mrite._startLicenseTimer({ expiresAt: sessionResult.licenseExpiresAt });
            Mrite._renderAccount();
            Mrite.updateButtonStates();
            Mrite.updateStatusIndicator();
            if (Mrite._syncHomeStatus) Mrite._syncHomeStatus();
          } else {
            // ★ 未激活：清除所有本地许可证缓存
            Mrite.STATE.sessionAuthorized = false;
            Mrite.STATE.authState = 'not_activated';
            Mrite.STATE.settings.inviteExpiresAt = '';
            Mrite.STATE.settings.licensePermanent = false;
            Mrite.saveSettings();
            // 清除许可证计时器
            if (Mrite._licenseTimer && Mrite._licenseTimer.destroy) Mrite._licenseTimer.destroy();
            try { localStorage.removeItem('mrite-license-expiry'); } catch(e) {}
            Mrite._renderAccount();
            Mrite.updateButtonStates();
            Mrite.updateStatusIndicator();
            Mrite._showToast('账号未激活，请在个人中心充值时长');
          }
          // ★ 从服务器刷新最新到期时间
          try { await window.electronAPI.refreshLicense(); } catch(e) {}
        } catch(e) {}
        return true;
      } else if (res && res.restarted) {
        return false;
      } else {
        if (Mrite._userToken && res && res.error === '登录超时，请重试') return false;
        Mrite._showToast((res && res.error) || '登录失败');
        return false;
      }
    })
    .catch(function(e) {
      Mrite._oauthLoggingIn = false;
      Mrite._showToast('登录失败：' + (e && e.message ? e.message : e));
      return false;
    });
};

