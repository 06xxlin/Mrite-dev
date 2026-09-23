// 运行前环境检测面板：单栏宽屏 + 三项环境卡片 + 打字机式日志
// 依次检测「账号 → 路径 → Python → LaTeX → 求解引擎 → 存储 → 网络 → API」；
// 日志在卡片下方以打字机形式逐行展示；全部通过且红色警示结束后，「确认运行」才可点击。
// 文案采用防呆设计：检测通过/失败都写清楚，失败时直接告诉用户去哪里配置。

// ── 放行规则（单独抽出，便于单测与复用）──
// 八项检测全过
Mrite._runEnvChecksPassed = function(seqDone, state) {
  state = state || {};
  return !!seqDone
    && state.account === true && state.python === true && state.latex === true
    && state.api === true && state.path === true && state.engine === true
    && state.workspace === true && state.network === true;
};
// 放行「确认运行」：检测全过 **且** 用户勾选了「同意上述运行守则」——缺一则按钮保持灰色。
// 任一项没跑完时 state 里是 null，用 === true 判断可避免「null 被当成通过」。
Mrite._runEnvCanRun = function(seqDone, state, agreed) {
  return !!agreed && Mrite._runEnvChecksPassed(seqDone, state);
};

Mrite._showRunEnvConfirm = function(options) {
  // Environment detection is a user-initiated run step, never a startup step.
  // Requiring this marker also prevents restore/init code from accidentally
  // opening the modal if it calls this helper without going through onTaskRun.
  if (!options || options.userInitiated !== true) return Promise.resolve(false);
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-box modal-box-lg modal-box-run">' +
        '<div class="modal-title">运行环境检测</div>' +
        '<div class="run-env-steps" id="runEnvSteps">' +
          '<div class="run-step" id="cardAccount"><span class="run-step-dot"></span><span class="run-step-label">账号</span><span class="run-step-desc">等待检测</span></div>' +
          '<span class="run-step-line"></span>' +
          '<div class="run-step" id="cardPath"><span class="run-step-dot"></span><span class="run-step-label">路径</span><span class="run-step-desc">等待检测</span></div>' +
          '<span class="run-step-line"></span>' +
          '<div class="run-step" id="cardPython"><span class="run-step-dot"></span><span class="run-step-label">Python</span><span class="run-step-desc">等待检测</span></div>' +
          '<span class="run-step-line"></span>' +
          '<div class="run-step" id="cardLatex"><span class="run-step-dot"></span><span class="run-step-label">LaTeX</span><span class="run-step-desc">等待检测</span></div>' +
          '<span class="run-step-line"></span>' +
          '<div class="run-step" id="cardEngine"><span class="run-step-dot"></span><span class="run-step-label">求解引擎</span><span class="run-step-desc">等待检测</span></div>' +
          '<span class="run-step-line"></span>' +
          '<div class="run-step" id="cardWorkspace"><span class="run-step-dot"></span><span class="run-step-label">存储</span><span class="run-step-desc">等待检测</span></div>' +
          '<span class="run-step-line"></span>' +
          '<div class="run-step" id="cardNetwork"><span class="run-step-dot"></span><span class="run-step-label">网络</span><span class="run-step-desc">等待检测</span></div>' +
          '<span class="run-step-line"></span>' +
          '<div class="run-step" id="cardApi"><span class="run-step-dot"></span><span class="run-step-label">API</span><span class="run-step-desc">等待检测</span></div>' +
        '</div>' +
        '<div class="run-body">' +
          '<div class="run-log" id="runLog"></div>' +
        '</div>' +
        '<div class="modal-btns">' +
          '<button class="modal-btn modal-btn-cancel" id="modalCancel">取消任务</button>' +
          '<button class="modal-btn modal-btn-confirm" id="modalConfirm" disabled>确认运行</button>' +
        '</div>' +
        // ★ 勾选同意才放行：上面那段「内容质量提示」+ 末尾的红字免责声明要用户明确确认过。
        //   与检测结果一起 gate「确认运行」（见 refreshConfirm）——两者**同时**满足才可点。
        '<label class="run-agree" id="runAgreeWrap">' +
          '<input type="checkbox" id="runAgree">' +
          '<span>同意上述运行守则</span>' +
        '</label>' +
      '</div>';

    document.body.appendChild(overlay);

    var cancelBtn = overlay.querySelector('#modalCancel');
    var confirmBtn = overlay.querySelector('#modalConfirm');
    var agreeBox = overlay.querySelector('#runAgree');
    var agreeWrap = overlay.querySelector('#runAgreeWrap');
    var runLog = overlay.querySelector('#runLog');
    var state = { account: null, python: null, latex: null, api: null, path: null, engine: null, workspace: null, network: null };
    var seqDone = false;
    var agreed = false;
    var closed = false;

    function close(result) {
      if (closed) return;
      closed = true;
      overlay.style.opacity = '0';
      setTimeout(function() { overlay.remove(); }, 200);
      resolve(result);
    }

    cancelBtn.onclick = function() { close(false); };
    confirmBtn.onclick = function() {
      if (!confirmBtn.disabled) close(true);
    };
    overlay.onclick = function(e) {
      if (e.target === overlay) close(false);
    };

    // ★ 两个条件都必须满足：① 八项检测全过 ② 用户勾选了「同意上述运行守则」
    function checksPassed() {
      return Mrite._runEnvChecksPassed(seqDone, state);
    }
    function refreshConfirm() {
      var passed = checksPassed();
      confirmBtn.disabled = !Mrite._runEnvCanRun(seqDone, state, agreed);
      // ★ 检测全过、只差勾选时把「同意」那行点亮 —— 否则按钮是灰的，用户看不出还差什么
      if (agreeWrap) agreeWrap.classList.toggle('is-pending', passed && !agreed);
    }

    if (agreeBox) {
      agreeBox.onchange = function() { agreed = !!agreeBox.checked; refreshConfirm(); };
    }
    refreshConfirm();   // 初始态：检测未完成 + 未勾选 → 按钮保持灰

    // ★ 步进顺序：账号必须先于中文路径检测，左→右逐个点亮
    var STEP_ORDER = ['cardAccount', 'cardPath', 'cardPython', 'cardLatex', 'cardEngine', 'cardWorkspace', 'cardNetwork', 'cardApi'];
    var STEP_KEY = { cardAccount: 'account', cardPath: 'path', cardPython: 'python', cardLatex: 'latex', cardEngine: 'engine', cardWorkspace: 'workspace', cardNetwork: 'network', cardApi: 'api' };

    function setCard(id, cardState, desc, tag) {
      var node = overlay.querySelector('#' + id);
      if (!node) return;
      var dot = node.querySelector('.run-step-dot');
      var descEl = node.querySelector('.run-step-desc');
      if (dot) {
        dot.className = 'run-step-dot is-' + cardState;
        dot.textContent = cardState === 'ok' ? '✓' : (cardState === 'fail' ? '✕' : (cardState === 'running' ? '…' : '·'));
      }
      if (descEl) descEl.textContent = desc || tag || '';
      // 连线随通过的节点填充：第 j 条线位于第 j 步之后，第 j 步通过即填充（左→右变绿）
      var lines = overlay.querySelectorAll('.run-step-line');
      for (var j = 0; j < lines.length; j++) {
        lines[j].classList.toggle('is-fill', state[STEP_KEY[STEP_ORDER[j]]] === true);
      }
    }

    // 全部日志的动画总预算为 56 帧：按 60Hz 约 0.93 秒。
    // 每行最多占 2 帧，既能看出快速打字和逐行下刷，又不会被大量提示文字拖慢。
    var TYPEWRITER_MAX_FRAMES = 56;
    var typewriterFramesUsed = 0;

    function typeLine(text, cls) {
      return new Promise(function(resolveLine) {
        if (closed) { resolveLine(); return; }
        text = String(text || '');
        var line = document.createElement('div');
        line.className = 'run-log-line' + (cls ? ' ' + cls : '');
        var span = document.createElement('span');
        span.className = 'run-log-text';
        var cursor = document.createElement('span');
        cursor.className = 'run-log-cursor';
        line.appendChild(span);
        line.appendChild(cursor);
        runLog.appendChild(line);
        runLog.scrollTop = runLog.scrollHeight;

        var framesLeft = TYPEWRITER_MAX_FRAMES - typewriterFramesUsed;
        var framesForLine = Math.min(2, framesLeft, text.length || 1);
        if (framesForLine <= 0) {
          span.textContent = text;
          cursor.remove();
          resolveLine();
          return;
        }

        typewriterFramesUsed += framesForLine;
        var frame = 0;
        var nextFrame = (window.requestAnimationFrame || function(cb) { return setTimeout(cb, 16); }).bind(window);
        function paintNextChunk() {
          if (closed) { span.textContent = text; cursor.remove(); resolveLine(); return; }
          frame++;
          var end = Math.ceil(text.length * frame / framesForLine);
          span.textContent = text.slice(0, end);
          runLog.scrollTop = runLog.scrollHeight;
          if (frame >= framesForLine) {
            span.textContent = text;
            cursor.remove();
            resolveLine();
            return;
          }
          nextFrame(paintNextChunk);
        }
        nextFrame(paintNextChunk);
      });
    }

    async function failCheck() {
      state.python = false;
      setCard('cardPython', 'fail', '无法调用检测组件', '未通过');
      await typeLine('Python 环境', 'run-log-step');
      await typeLine('检测失败：无法调用本机检测组件。', 'run-log-red');
      await typeLine('请重启软件后再检测。', 'run-log-info');

      state.latex = false;
      setCard('cardLatex', 'fail', '无法调用检测组件', '未通过');
      await typeLine('LaTeX 环境', 'run-log-step');
      await typeLine('检测失败：无法调用本机检测组件。', 'run-log-red');
      await typeLine('请重启软件后再检测。', 'run-log-info');

      state.engine = false;
      setCard('cardEngine', 'fail', '无法调用检测组件', '未通过');
      await typeLine('求解引擎', 'run-log-step');
      await typeLine('检测失败：无法调用本机检测组件。', 'run-log-red');
      await typeLine('请重启软件后再检测。', 'run-log-info');
      return false;
    }

    // 账号检查只读取本地/主进程持久化会话，不访问网络，必须先于中文路径检测完成。
    async function detectAccount() {
      setCard('cardAccount', 'running', '正在检测…', '检测中');
      await typeLine('账号登录', 'run-log-step');
      var loggedIn = false;
      try {
        loggedIn = Mrite._ensureAccountLogin
          ? await Mrite._ensureAccountLogin()
          : !!Mrite._userToken;
      } catch (_) {}
      if (closed) return false;
      if (!loggedIn) {
        state.account = false;
        setCard('cardAccount', 'fail', '请登录账号', '未通过');
        await typeLine('检测失败：尚未登录账号。', 'run-log-red');
        await typeLine('请先登录账号，再重新运行。', 'run-log-info');
        return false;
      }
      state.account = true;
      var user = Mrite._userData || {};
      var accountName = user.nickname || user.username || '已登录';
      setCard('cardAccount', 'ok', accountName, '通过');
      await typeLine('检测通过：账号已登录。', 'run-log-ok');
      return true;
    }

    // ★ 路径检测（中文/非英文）：先于 Python/LaTeX——路径不对，后面检测结果毫无意义。
    //   软件安装目录 + Mrite_env 目录，任一含中文/非英文都会让子进程路径解析失败 → 运行报错。
    //   返回：true=通过 / false=不通过（已打印原因）/ null=拿不到结果（本机无 checkPath，调用方兜底）
    async function applyPathResult(cp) {
      cp = cp || {};
      if (cp.ok === false) {
        state.path = false;
        setCard('cardPath', 'fail', '含中文/非英文', '未通过');
        await typeLine('检测失败：' + (cp.message || '路径含中文/非英文，可能导致环境无法运行。'), 'run-log-red');
        await typeLine('请把软件与 Mrite_env 移动到纯英文路径后，重新检测。', 'run-log-info');
        return false;
      }
      if (cp.ok === true) {
        state.path = true;
        setCard('cardPath', 'ok', '纯英文路径', '通过');
        await typeLine('检测通过：软件与 Mrite_env 均位于纯英文路径，可正常解析。', 'run-log-ok');
        return true;
      }
      return null;
    }

    async function detectEnv() {
      var hasCheck = window.electronAPI && window.electronAPI.checkEnvironment;

      if (!hasCheck) {
        await failCheck();
        return false;
      }

      // ★ 「路径」紧跟账号检查，而它只是对两个路径做一次
      //   正则；原本要等 check-environment 整个返回（内含 python/xelatex/pandoc 三个子进程探测）
      //   才显示，于是用户看到的第一步就是"路径一直转圈"。这里改走轻量 IPC 先出结果。
      var pathState = null;
      setCard('cardPath', 'running', '正在检测…', '检测中');
      await typeLine('路径检测（中文/非英文）', 'run-log-step');
      if (window.electronAPI.checkPath) {
        var cpRes = null;
        try { cpRes = await window.electronAPI.checkPath(); } catch (_) {}
        if (closed) return false;
        pathState = await applyPathResult(cpRes && cpRes.chinesePath);
        if (pathState === false) return false;   // 不通过：原因已打印，不再往下检测
      }
      if (closed) return false;

      // 先发起纯文件快检，再播放 Python 这一行的动画；两者并行，结果基本在动画结束前已返回。
      var envCheckPromise = null;
      try { envCheckPromise = window.electronAPI.checkEnvironment({ fast: true }); } catch (_) {}
      setCard('cardPython', 'running', '正在检测…', '检测中');
      await typeLine('Python 环境', 'run-log-step');
      var res;
      try {
        res = await envCheckPromise;
      } catch (e) {
        await failCheck();
        return false;
      }
      if (closed) return false;

      var r = (res && res.results) ? res.results : (res || {});
      // 没走成轻量检测（老 preload / IPC 异常）→ 用本次环境检测结果里的同一项兜底
      if (pathState === null) {
        if (await applyPathResult(res && res.chinesePath) === false) return false;
      }

      var p = r.python || { ok: false, version: '' };
      var l = r.latex || { ok: false, version: '' };
      var appEnv = res.appEnv || {};
      var pyEnv = appEnv.python || {};
      var lxEnv = appEnv.latex || {};
      var pyPath = pyEnv.pythonPath || pyEnv.dir || '';
      var texPath = lxEnv.xelatexPath || lxEnv.binDir || '';

      state.python = !!p.ok;
      if (p.ok) {
        setCard('cardPython', 'ok', p.version || '已就绪', '已就绪');
        await typeLine('检测通过：Python ' + (p.version || '已就绪') + (pyPath ? '（' + pyPath + '）' : ''), 'run-log-ok');
        await typeLine('已具备求解环境，正在继续检查其余运行条件。');
      } else {
        setCard('cardPython', 'fail', p.version || '请检查本机环境', '未通过');
        await typeLine('检测失败：未识别到 Python 环境。', 'run-log-red');
        await typeLine('请到「设置 → 环境配置」安装 Python，装好后重新检测。', 'run-log-info');
        return false;
      }

      state.latex = !!l.ok;
      setCard('cardLatex', 'running', '正在检测…', '检测中');
      await typeLine('LaTeX 环境', 'run-log-step');
      if (l.ok) {
        setCard('cardLatex', 'ok', l.version || '已就绪', '已就绪');
        await typeLine('检测通过：' + (l.version || '已就绪') + (texPath ? '（' + texPath + '）' : ''), 'run-log-ok');
        await typeLine('已具备写论文条件，可正常编译。');
      } else {
        setCard('cardLatex', 'fail', l.version || '请先安装 LaTeX', '未通过');
        await typeLine('检测失败：未安装 LaTeX 编译环境。', 'run-log-red');
        await typeLine('请到「设置 → 环境配置」安装 LaTeX，装好后重新检测。', 'run-log-info');
        return false;
      }

      // ★ 求解引擎（claude.exe）+ shell（bash 或 PowerShell 7）：claude.exe 需要「bash 或 pwsh」其一执行命令，
      //   缺任一都会「点了没反应→弹模型无响应/卡住」。claude.exe 缺失多半是安全软件隔离；
      //   shell 缺失多半是没装 Git for Windows，或 PowerShell 只有 5.1 而非 7。
      setCard('cardEngine', 'running', '正在检测…', '检测中');
      await typeLine('求解引擎（claude.exe / 运行 shell）', 'run-log-step');
      var probe = (res && res.solverExecutableProbe) ? res.solverExecutableProbe : null;
      var engineExe = probe ? probe.resolvedExecutable : '';
      // hasShell=bash 或 pwsh 任一存在；探测不到 shell 信息时按通过处理，避免误拦
      var bashFound = !!(probe && probe.bash ? probe.bash.found : true);
      var pwshFound = !!(probe && probe.pwsh ? probe.pwsh.found : (probe && probe.hasShell));
      var pwshSource = (probe && probe.pwsh && probe.pwsh.source) ? probe.pwsh.source : '';
      var shellOk = bashFound || pwshFound;
      if (probe && engineExe && shellOk) {
        state.engine = true;
        var preferredShell = probe.preferredShell || null;
        var useBundledPwsh = !!(preferredShell && preferredShell.type === 'pwsh' && preferredShell.source === 'bundled');
        var shellDesc = preferredShell
          ? (preferredShell.type === 'pwsh' ? ('PowerShell 7' + (preferredShell.source === 'bundled' ? '（内置）' : '')) : 'bash')
          : (pwshFound && pwshSource === 'bundled' ? 'PowerShell 7（内置）' : (bashFound ? 'bash' : 'PowerShell 7'));
        var engineBundled = probe.executableSource === 'bundled';
        setCard('cardEngine', 'ok', (engineBundled || useBundledPwsh) ? '内置优先' : '已就绪', '通过');
        await typeLine('检测通过：' + (engineBundled ? '内置' : '') + '求解引擎 claude.exe 与运行 shell（' + shellDesc + '）均已就绪。', 'run-log-ok');
      } else {
        state.engine = false;
        if (!engineExe) {
          setCard('cardEngine', 'fail', '求解引擎缺失', '未通过');
          await typeLine('检测失败：求解引擎 claude.exe 缺失（很可能被安全软件/杀毒软件拦截或隔离）。', 'run-log-red');
          await typeLine('请打开安全软件（Windows 安全中心 / 360 / 火绒 / 腾讯管家）→ 隔离区 → 恢复 claude.exe，并把 Mrite 所在文件夹加入「信任 / 白名单」。', 'run-log-info');
        } else {
          setCard('cardEngine', 'fail', '缺少运行 shell', '未通过');
          await typeLine('检测失败：缺少运行 shell（bash 或 PowerShell 7）。', 'run-log-red');
          await typeLine('新版求解引擎 claude.exe 需要 bash（Git for Windows）或 PowerShell 7（pwsh）**之一**来执行命令，两个都没有时会启动即报错，但被显示成「模型无响应/卡住」。', 'run-log-info');
          await typeLine('请安装 Git for Windows（https://git-scm.com/download/win）或 PowerShell 7（https://aka.ms/powershell），装完重启软件再检测。', 'run-log-info');
        }
        await typeLine('恢复后重新解压安装（若因杀毒），再重新检测。', 'run-log-info');
        return false;
      }
      return true;
    }

    function formatFreeSpace(bytes) {
      if (typeof bytes !== 'number' || !isFinite(bytes)) return '';
      if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
      return Math.max(0, Math.round(bytes / (1024 * 1024))) + ' MB';
    }

    async function detectPreflight(preflightPromise) {
      if (closed) return false;
      setCard('cardWorkspace', 'running', '正在检测…', '检测中');
      setCard('cardNetwork', 'running', '正在检测…', '检测中');
      await typeLine('工作区与网络', 'run-log-step');
      var result = null;
      try { result = await preflightPromise; } catch (_) {}
      if (closed) return false;

      var workspace = result && result.workspace;
      if (workspace && workspace.ok) {
        state.workspace = true;
        var freeText = formatFreeSpace(workspace.freeBytes);
        setCard('cardWorkspace', 'ok', freeText ? '剩余 ' + freeText : '可写', '通过');
        await typeLine('检测通过：工作区可正常读写' + (freeText ? '，磁盘剩余 ' + freeText : '') + '。', 'run-log-ok');
      } else {
        state.workspace = false;
        setCard('cardWorkspace', 'fail', (workspace && workspace.message) || '不可写', '未通过');
        await typeLine('检测失败：' + ((workspace && workspace.message) || '无法检查工作区读写权限。'), 'run-log-red');
        await typeLine('请检查磁盘空间、文件夹权限，并确认工作区没有被安全软件阻止。', 'run-log-info');
      }

      var network = result && result.network;
      if (network && network.ok) {
        state.network = true;
        // ★ 开发版：官方软件服务已被切断（后端指向本机黑洞），主进程会给这项打 skipped，
        //   这里如实显示「已跳过」，而不是假装「已连通 xx ms」。
        if (network.skipped) {
          setCard('cardNetwork', 'ok', '已跳过', '通过');
          await typeLine('检测通过：开发版不连接官方软件服务（后端指向本机黑洞），此项预检跳过。', 'run-log-ok');
          await typeLine('任务不经过软件服务，直接用你在「设置 → 模型配置」里填的 API 直连。', 'run-log-info');
        } else {
          setCard('cardNetwork', 'ok', network.latencyMs + 'ms', '已连通');
          await typeLine('检测通过：软件服务网络已连通（' + network.latencyMs + 'ms）。', 'run-log-ok');
        }
      } else {
        state.network = false;
        var networkMessage = (network && network.message) || '无法调用网络检测组件';
        setCard('cardNetwork', 'fail', networkMessage, '未通过');
        await typeLine('检测失败：' + networkMessage + '。', 'run-log-red');
        await typeLine('请检查电脑网络、防火墙、代理/VPN 或 DNS，恢复后重新检测。', 'run-log-info');
      }
      return state.workspace === true && state.network === true;
    }

    async function detectApi() {
      if (closed) return false;
      setCard('cardApi', 'running', '正在检测…', '检测中');
      await typeLine('API 接口', 'run-log-step');

      var cfg = Mrite._getActiveApiConfig ? Mrite._getActiveApiConfig() : null;
      if (!cfg || !cfg.apiKey || !cfg.apiModel || !cfg.apiBase) {
        state.api = false;
        setCard('cardApi', 'fail', '请先配置 API', '未通过');
        await typeLine('检测失败：未配置 API 接口。', 'run-log-red');
        await typeLine('请到「设置 → 模型配置」填写 API Key 并选择模型，保存后重新检测。', 'run-log-info');
        return false;
      }
      try { Mrite._loadUser && Mrite._loadUser(); } catch(e) {}
      // 账号是独立的运行门禁；设备激活不能替代账号登录。
      if (!Mrite._userToken) {
        state.api = false;
        setCard('cardApi', 'fail', '需先登录', '未通过');
        await typeLine('检测失败：尚未登录账号。', 'run-log-red');
        await typeLine('请先登录账号，再重新检测。', 'run-log-info');
        return false;
      }

      var isAnthropic = cfg.apiBase.indexOf('/anthropic') !== -1 || cfg.apiBase.indexOf('api.anthropic.com') !== -1;
      var testUrl, testHeaders, testBody;
      if (isAnthropic) {
        testUrl = cfg.apiBase.replace(/\/+$/, '') + '/v1/messages';
        testHeaders = { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
        testBody = JSON.stringify({ model: cfg.apiModel, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
      } else {
        var path = cfg.apiBase.replace(/\/+$/, '');
        if (!/\/v\d+$/.test(path)) path += '/v1';
        testUrl = path + '/chat/completions';
        testHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey };
        testBody = JSON.stringify({ model: cfg.apiModel, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
      }

      var startTime = Date.now();
      var controller = new AbortController();
      var timeoutId = setTimeout(function() { controller.abort(); }, 15000);
      try {
        var resp = await fetch(testUrl, { method: 'POST', headers: testHeaders, body: testBody, signal: controller.signal });
        clearTimeout(timeoutId);
        if (closed) return false;
        var latency = Date.now() - startTime;
        if (resp.ok) {
          state.api = true;
          setCard('cardApi', 'ok', latency + 'ms', '已连通');
          await typeLine('接口：' + cfg.apiBase + '（模型：' + cfg.apiModel + '）', 'run-log-info');
          await typeLine('检测通过：接口已连通（' + latency + 'ms），可开始求解。', 'run-log-ok');
          return true;
        } else {
          state.api = false;
          var st = resp.status;
          setCard('cardApi', 'fail', 'HTTP ' + st, '未通过');
          if (st === 402) {
                    await typeLine('检测失败：账户余额不足（HTTP 402）。', 'run-log-red');
                    await typeLine('请先充值，再重新检测。', 'run-log-info');
                    return false;
          } else if (st === 401 || st === 403) {
                    await typeLine('检测失败：鉴权失败（HTTP ' + st + '）。', 'run-log-red');
                    await typeLine('请检查 API Key 是否正确，到「设置 → 模型配置」核对后重新检测。', 'run-log-info');
                    return false;
          } else if (st === 429) {
                    await typeLine('检测失败：请求过于频繁（HTTP ' + st + '）。', 'run-log-red');
                    await typeLine('请稍后再试，或到「设置 → 模型配置」检查模型配置。', 'run-log-info');
                    return false;
          } else {
                    await typeLine('检测失败：接口返回错误（HTTP ' + st + '）。', 'run-log-red');
                    await typeLine('请检查 API 地址与 Key，到「设置 → 模型配置」核对后重新检测。', 'run-log-info');
                    return false;
          }
        }
      } catch (e) {
        clearTimeout(timeoutId);
        if (closed) return false;
        var msg = e.name === 'AbortError' ? '超时' : '网络错误';
        state.api = false;
        setCard('cardApi', 'fail', msg, '未通过');
        await typeLine('检测失败：' + msg + '。', 'run-log-red');
        await typeLine('请检查网络或 API 地址，到「设置 → 模型配置」核对后重新检测。', 'run-log-info');
        return false;
      }
    }

    (async function() {
      var accountOk = await detectAccount();
      if (closed || !accountOk) return;
      // 网络与存储检查在后台并行开始，同时继续做本地环境检查，避免增加等待时间。
      var preflightPromise = (window.electronAPI && window.electronAPI.checkRuntimePreflight)
        ? window.electronAPI.checkRuntimePreflight().catch(function() { return null; })
        : Promise.resolve(null);
      var envOk = await detectEnv();
      if (closed || !envOk) return;
      var preflightOk = await detectPreflight(preflightPromise);
      if (closed || !preflightOk) return;
      var apiOk = await detectApi();
      if (closed || !apiOk) return;
      await typeLine('内容质量提示', 'run-log-step');
      await typeLine('1、生成内容的质量，与你所接入的 AI 模型有直接关系。图表错位、流程图乱序、段落排版不整齐等情况，通常不是软件本身造成的，而是模型理解与生成能力的体现。', 'run-log-info');
      await typeLine('2、若遇到任务启动失败或长时间无响应，请先检查模型服务是否可用、接口是否正常；服务不可用或接口异常时，任务往往无法开始，或被中断在半途。长时间没反应不一定是在认真思考，很多时候只是单纯卡住了，请及时检查网络状况、接口地址或直接重试。', 'run-log-info');
      await typeLine('3、接入延迟较大的中转站时，生成速度会明显变慢、等待更久；严重时任务还会一直卡住，甚至直接失败。请别误以为「等了这么久，质量应该很好」，很多时候只是延迟太大卡住了，并不是你用的时间越长产出就越优秀——过大的延迟往往还伴随内容质量明显下降，容易跑偏或出错。', 'run-log-info');
      await typeLine('4、部分中转站会对接入内容做「掺水」处理，比如压缩篇幅、省略步骤、返回残缺的代码或文本，让你误以为成功，实际拿到的却是不完整、不可用的结果。', 'run-log-info');
      await typeLine('为了获得更稳定、更优质的产出，请优先接入质量较好的 AI 模型。', 'run-log-info');
      if (closed) return;
      await typeLine('✦ ✦  软件生成内容仅供参考，请务必充分修改、逐项核对无误后再正式提交。  ✦ ✦', 'run-log-red run-log-center run-log-final');
      seqDone = true;
      refreshConfirm();
    })();
  });
};
