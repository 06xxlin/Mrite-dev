// Mrite v1.8 — 设置面板
window.Mrite = window.Mrite || {};

// ═══════════════════════════════════════════════════
// 供应商配置数据
// ═══════════════════════════════════════════════════
Mrite._PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/anthropic',
    apiFormat: 'anthropic',
    // ★ 模型名（V4 Pro 不带 [1m] 上下文标记；V4 Flash；V4 Flash Vision Exp）
    defaultModel: 'deepseek-v4-pro',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'], // ★ V4 Pro / V4 Flash / V4 Flash Vision Exp 下拉切换
    modelSelect: true,
    fixed: true
  },
  xiaomi: {
    name: '小米 MiMo',
    baseURL: '',
    apiFormat: 'openai',
    models: ['mimo-v2.5-pro', 'mimo-v2.5']
  },
  kimi: {
    name: 'Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    apiFormat: 'openai',
    models: ['kimi-k2', 'moonshot-v1-128k', 'moonshot-v1-32k']
  },
  glm: {
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiFormat: 'openai',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long']
  },
  qwen: {
    name: '阿里 千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiFormat: 'openai',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo']
  },
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    apiFormat: 'responses',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'o3', 'o4-mini']
  },
  anthropic: {
    name: 'Claude',
    // ★ 不预填端点，避免小白误以为是已配置好的；需自己填入有效端点
    baseURL: '',
    apiFormat: 'anthropic',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514']
  },
  gemini: {
    name: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiFormat: 'openai',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro']
  },
  xai: {
    name: 'Grok',
    baseURL: 'https://api.x.ai/v1',
    apiFormat: 'openai',
    models: ['grok-3', 'grok-3-mini', 'grok-2']
  },
  custom: {
    name: '自定义',
    baseURL: '',
    apiFormat: 'auto',
    models: []
  }
};

// ★ 判断是否为固定配置（URL/模型不可修改）


// ★ 各供应商下拉里选的模型记忆（providerKey → 模型），切走再切回不丢失
Mrite._modelSelectValues = {};

// ★ 开发版：模型名一律「自由填写」
//   官方原版把 DeepSeek 这类 modelSelect 供应商的模型框锁成只读下拉（只能在预置模型里挑），
//   开发版统一改成「可编辑输入框 + <datalist> 预置建议」：想接哪个模型就填哪个，
//   服务商出新模型也不用等软件更新。
Mrite._ensureModelSelect = function(provider, providerKey) {
  var modelField = document.getElementById('inputApiModel');
  if (!modelField || !modelField.parentNode) return;
  var suggestions = (provider && Array.isArray(provider.models)) ? provider.models.slice() : [];
  var listId = 'apiModelSuggestions';
  var cur = modelField.value || Mrite._modelSelectValues[providerKey] || '';

  if (modelField.tagName !== 'INPUT' || modelField.getAttribute('list') !== listId) {
    var inp = document.createElement('input');
    inp.id = 'inputApiModel'; inp.type = 'text'; inp.className = 'set-input';
    inp.setAttribute('list', listId);
    inp.placeholder = suggestions.length ? '可自由填写，或从建议中选择' : '填写服务商官方模型 ID';
    inp.value = cur;
    inp.oninput = function() { Mrite._autoSaveSettings(); };
    modelField.parentNode.replaceChild(inp, modelField);
    modelField = inp;
  }

  // 建议列表 = 该供应商的预置模型（只是一份建议；输入框里已有的自定义模型名不会被清掉）
  var dl = document.getElementById(listId);
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = listId;
    modelField.parentNode.appendChild(dl);
  }
  dl.innerHTML = suggestions.map(function(m) {
    return '<option value="' + Mrite.escHtml(String(m)) + '"></option>';
  }).join('');
};

// ★ 选择供应商
Mrite._pendingProvider = null;
Mrite._selectProvider = function(providerKey) {
  var p = Mrite._PROVIDERS[providerKey];
  if (!p) return;

  // ★ 开发版：已移除「API 常识答题」门禁 —— 任何供应商都能直接选中并配置
  Mrite._pendingProvider = null;

  // ★ 切换前：记住上一个供应商（若是下拉）当前选的模型
  var prevField = document.getElementById('inputApiModel');
  if (prevField && Mrite._lastProviderKey) {
    // ★ 开发版：模型字段统一是自由输入框，直接记住当前值（原版只认 SELECT / 自定义下拉）
    Mrite._modelSelectValues[Mrite._lastProviderKey] = prevField.value || '';
  }
  Mrite._lastProviderKey = providerKey;

  // 高亮选中卡片
  document.querySelectorAll('.provider-card').forEach(function(c) {
    c.classList.toggle('active', c.dataset.provider === providerKey);
  });

  // 切换供应商时填充端点和模型名
  var s = Mrite.STATE.settings;
  var baseEl = document.getElementById('inputApiBase');
  var formatEl = document.getElementById('inputApiFormat');

  // ★ 模型字段：统一「自由填写」输入框（预置模型只作为输入建议）
  Mrite._ensureModelSelect(p, providerKey);
  var modelEl = document.getElementById('inputApiModel');

  // ★ 端点：有官方地址就预填，但一律可改（想接中转 / 自建网关都行）
  if (baseEl) {
    baseEl.readOnly = false;
    baseEl.classList.remove('input-locked');
    if (p.baseURL) {
      baseEl.value = p.baseURL;
      baseEl.placeholder = '可自由修改，例如 ' + p.baseURL;
    } else {
      // ★ 无官方端点的供应商（Claude / 小米 / 自定义）不预填，避免误以为已配置好
      baseEl.value = '';
      baseEl.placeholder = '粘贴你的 API 端点（Base URL），例如 https://api.xxx.com';
    }
  }

  // ★ 模型：记忆值 → 该供应商默认/第一个预置模型；都没有就留空让用户自己填
  if (modelEl) {
    var want = Mrite._modelSelectValues[providerKey] || p.defaultModel || (p.models && p.models[0]) || '';
    modelEl.value = want;
    modelEl.readOnly = false;
    modelEl.classList.remove('input-locked');
    Mrite._modelSelectValues[providerKey] = want;
  }

  // 更新 API Key 提示链接
  Mrite._updateApiKeyHint(providerKey);

  // 保存供应商选择
  s._selectedProvider = providerKey;
  // ★ 关键：把供应商的 apiFormat 一并写入 settings（openai 格式才会走代理转换，
  //   否则一直停留在默认 'auto' → 被当成 Anthropic 直连 → OpenAI 端点连不上）
  s.apiFormat = p.apiFormat || 'auto';
  if (formatEl) formatEl.value = s.apiFormat === 'openai' ? 'chat' : s.apiFormat;
  Mrite._autoSaveSettings();
};

// ★ 根据供应商更新 API Key 获取提示（仅 DeepSeek / 小米）
Mrite._PROVIDER_DOCS = {
  deepseek: { doc: 'https://api-docs.deepseek.com/zh-cn/', login: 'https://platform.deepseek.com/' },
  xiaomi:   { doc: 'https://platform.xiaomimimo.com/docs', login: 'https://platform.xiaomimimo.com/' }
};
Mrite._updateApiKeyHint = function(providerKey) {
  var hint = document.getElementById('apiKeyHint');
  var docLink = document.getElementById('apiKeyDocLink');
  var loginLink = document.getElementById('apiKeyLoginLink');
  if (!hint || !docLink || !loginLink) return;
  var info = Mrite._PROVIDER_DOCS[providerKey];
  if (info) {
    hint.style.display = '';
    docLink.href = info.doc;
    loginLink.href = info.login;
  } else {
    hint.style.display = 'none';
  }
};

// ★ 恢复活动配置到表单和 STATE（强制执行）
Mrite._restoreActiveConfig = function() {
  var s = Mrite.STATE.settings;
  var models = Array.isArray(s.apiModels) ? s.apiModels : [];

  // ★ 以 localStorage 为准（唯一可靠持久化来源，不被 DB 异步覆盖）
  var idx;
  try {
    var saved = localStorage.getItem('mrite-active-model-index');
    idx = (saved !== null) ? parseInt(saved) : undefined;
  } catch(e) { idx = undefined; }

  // 从未设置过 → 有配置就自动选第一个
  if (idx === undefined && models.length > 0) {
    idx = 0;
  }

  // 同步到 STATE
  s._activeModelIndex = (idx !== undefined) ? idx : -1;

  // 同步扁平字段
  if (idx >= 0 && models[idx]) {
    var m = models[idx];
    s.apiBase = m.baseURL || '';
    s.apiKey = m.apiKey || s.apiKey || '';
    s.apiModel = m.name || '';
    s.apiFormat = m.apiFormat || 'auto';
  } else {
    s.apiBase = '';
    s.apiKey = '';
    s.apiModel = '';
    s.apiFormat = 'auto';
  }

  Mrite._updateApiHero();
};

// ★ 更新 API hero 卡片（读取 STATE.settings，直接更新 DOM）
Mrite._updateApiHero = function() {
  var s = Mrite.STATE.settings;
  var models = Array.isArray(s.apiModels) ? s.apiModels : [];
  var idx = s._activeModelIndex;

  var heroCard = document.getElementById('apiHeroCard');
  var heroIcon = document.getElementById('apiHeroIcon');
  var heroModel = document.getElementById('apiHeroModel');
  var heroMeta = document.getElementById('apiHeroMeta');
  var heroStatus = document.getElementById('apiHeroStatus');

  if (!heroCard) return;

  // 有活动配置
  if (idx >= 0 && models[idx]) {
    var m = models[idx];
    var provider = m.provider || Mrite._getProviderLabel(m.baseURL);
    var icon = Mrite._getProviderIcon(m.baseURL);
    var hasKey = !!(m.apiKey || s.apiKey);

    heroCard.classList.toggle('connected', hasKey);
    if (heroIcon) heroIcon.src = icon;
    if (heroModel) heroModel.textContent = m.name;
    if (heroMeta) heroMeta.textContent = provider + ' · '
      + (Mrite._apiFormatLabel ? Mrite._apiFormatLabel(m.apiFormat, m.baseURL) + ' · ' : '')
      + (m.baseURL || '').replace(/^https?:\/\//, '');
    if (heroStatus) heroStatus.textContent = hasKey ? '当前使用中' : '缺少 API Key';
  } else {
    heroCard.classList.remove('connected');
    if (heroIcon) heroIcon.src = '../assets/icons/providers/custom.svg';
    if (heroModel) heroModel.textContent = '未配置';
    if (heroMeta) heroMeta.textContent = '请在下方选择服务商并配置 API';
    if (heroStatus) heroStatus.textContent = '未连接';
  }
};

// ★ 初始化设置面板（不自动选中供应商卡片，等用户自己点）
Mrite._initProviderUI = function() {
  // 恢复活动配置（只同步扁平字段 + hero 卡片）
  Mrite._restoreActiveConfig();

  // ★ 不自动高亮任何供应商卡片 — 用户必须自己点击才选中
  // ★ 不自动显示 API Key 提示 — 等用户选供应商后再显示

  // 渲染已保存模型列表
  Mrite._renderSavedModels();

  // 更新 hero 卡片
  Mrite._updateApiHero();

};

// ═══════════════════════════════════════════════════
// 已保存模型配置管理
// ═══════════════════════════════════════════════════

