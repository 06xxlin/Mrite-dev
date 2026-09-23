# Mrite-dev 开发版：技术说明与构建文档（v2.6.15）

> 面向开发者 / 维护者。README 只写项目介绍；补丁改了哪些文件、安装包怎么构建、
> 数据目录与调试脚本等技术细节都在本文档。

一个**轻量补丁包**：把原版 Mrite 打包程序改造成**无登录 / 无激活码 / 无会员时长校验**的开发版。

- 只含 14 个文件（12 个修改 + 2 个新增 + `dev-profile.flag`），覆盖到原版解包后的源码目录即可
- 不改服务器、不提供任何 Key；只是把客户端侧的授权门槛放行
- 任务仍使用「设置 → 模型配置」里**你自己的 API Key** 直连，与服务器授权无关
- `rules-library.js` 那处补丁只修「目录模式下找不到内置模板库」，**与授权无关**，
  但目录模式安装包**必须打**，否则界面里没有任何模板
- `model-management.js` / `provider-form.js` / `settings.html` / `result-components.css`
  这 4 处是**移除「API 常识答题」门禁**（原来 20 题全对才让连 DeepSeek 以外的模型），
  与授权无关，纯 UX
- `src/ipc/system.js` / `renderer/shared/run-detect.js` 这 2 处让运行前预检的「网络」项
  在开发版里显示「已跳过」而不是失败 —— 否则「确认运行」按钮永久置灰，**任务根本起不来**

---

## 一、适用版本

| 版本 | 状态 | 补丁文件数 | 备注 |
| --- | --- | --- | --- |
| **Mrite 2.6.15** | ✅ 当前补丁 | 14 | + `rules-library.js`：修复目录模式「没有模板」（模板全部随包内置，从不联网获取）；+ 4 个渲染层文件：移除「API 常识答题」门禁，模型随便选、随便填；+ 2 处：运行前「网络」预检不再卡死「确认运行」 |
| Mrite 2.6.14 | 历史版本 | 7 | 见 git 提交 `24cb7f3`，含热更新防护与网络断联 |
| Mrite 2.6.13 | 历史版本 | 4 | 见 git 提交 `2705d52`，无热更新加载器 |

判断方法：安装目录里 `Mrite.exe` 的「属性 → 详细信息 → 产品版本」，或解包后看 `package.json` 的
`version`。本补丁按 **2.6.15** 的源码结构制作；其它版本请按同样思路手动改
`bootstrap.js` / `update-loader.js` / `index.html` / `executable.js` / `rules-library.js` /
`renderer/features/settings/model-management.js` / `renderer/features/settings/provider-form.js`。

---

## 二、补丁内容（14 个文件）

| 文件 | 类型 | 作用 |
| --- | --- | --- |
| `patch/src/services/dev-unlock.js` | 新增 | 主进程解锁：放行授权判定 + 覆盖授权 IPC + **放行账号登录 IPC** + 关闭热更新 + 广播「已授权」 |
| `patch/src/core/bootstrap.js` | 修改 | 在 `authService.register()` / `userService.register()` / `updaterService.register()` 之后调用 `dev-unlock.install()`；新增 `--dev-profile` 独立数据目录 |
| `patch/src/core/update-loader.js` | 修改 | 开发版**永不加载**官方热更新包，避免解锁代码被热更覆盖；`--dev-profile` 指向 `-dev` 数据目录 |
| `patch/src/core/backend-url.js` | 修改 | **切断与官方后台的联系**：后端地址一律返回黑洞 `http://127.0.0.1:1`；真实域名只作为拦截黑名单 |
| `patch/src/services/task/executable.js` | 修改 | 目录模式（`resources\app`，没有 `app.asar.unpacked`）下也能找到 `claude.exe`：增加对 `app\node_modules\@anthropic-ai\...\@anthropic-ai\` 的目录扫描 |
| `patch/src/services/rules-library.js` | 修改 | **目录模式下也能找到内置模板库**：`ensureLibraries()` 原来只探测 `app.asar\rules-library`，目录模式（开发版安装包）两个候选都不存在 → 模板列表为空。新增多候选探测 + 命中日志 + 缺失告警 |
| `patch/renderer/features/settings/model-management.js` | 修改 | **删除「API 报错诊断答题」整套门禁**（15 固定题 + 29 常识题库 + 答题弹窗 + 连接前确认框）；保留 `_apiQuizPassed`(恒 true) / `_applyApiQuizLock`(空) / `_showApiQuiz`(直接回调 passed) 空实现 |
| `patch/renderer/features/settings/provider-form.js` | 修改 | 供应商选择不再拦截；`_ensureModelSelect()` 由只读下拉/只读输入改为**可编辑输入框 + `<datalist>` 建议**；端点框不再 `readOnly`（预填但可改） |
| `patch/renderer/ui/settings.html` | 修改 | 删掉 `#btnApiQuiz`「答题解锁配置权限」按钮；模型名标签改为「模型名称（可自由填写）」；小白指引第 1 条改为「想接哪个模型都行」 |
| `patch/renderer/styles/result-components.css` | 修改 | 删掉答题相关死样式（`.api-quiz-*` / `.btn-quiz-unlock` / `.provider-card.locked`） |
| `patch/src/ipc/system.js` | 修改 | **运行前「网络」预检不再卡死「确认运行」**：该预检请求官方服务的 `/api/v1/avatars`，开发版后端是黑洞 → 必然 ECONNREFUSED → 八项检测不全过。现在检测到 `BLACKHOLE_BASE` 即直接返回 `{ok:true, skipped:true}`，不发请求 |
| `patch/renderer/shared/run-detect.js` | 修改 | 收到 `network.skipped` 时把「网络」卡片显示为 **通过 / 已跳过**，日志说明「开发版不连接官方软件服务」 |
| `patch/renderer/dev-unlock.js` | 新增 | 渲染层解锁：**伪造常驻登录会话** + 登录遮罩/过期弹窗置空 + `_isActivated` 恒为 true |
| `patch/renderer/index.html` | 修改 | 在**最后一个业务脚本 `index.js` 之前**引入 `dev-unlock.js` |

### 📦 模板从哪来（为什么「切后台」不会让模板消失）

模板**不是服务器下发的**：官方 15 个比赛模板一直随包内置在 `resources\app\rules-library\`
（82 个文件：各比赛主 `.tex`、12 章变体、`format.cls`、3 个中文字体、模板说明、两个求解方案）。
首次启动由 `rulesLibrary.ensureLibraries()` 种进 `%APPDATA%\MriteUltra-2.6.13-dev\rules-library`，
界面读其中的 `templates.json`。所以「没有模板」只可能是**种库这一步没跑成**，
和 `backend-url.js` 的黑洞改造无关（黑洞只影响登录 / 激活 / 会员 / 热更新 / 事件上报）。

目录模式下原版探测顺序里没有 `resources\app\rules-library` 这一条 —— 这就是根因。
修复后的探测顺序（权威优先）：

1. `resources\app.asar\rules-library`（官方原版）
2. `resources\app.asar.unpacked\rules-library`
3. **`resources\app\rules-library`**（开发版安装包 / 解包后的目录模式）
4. `%MRITE_REAL_RESOURCES%` 下的同三种
5. `app.getAppPath()\rules-library`、`__dirname\..\..\rules-library` 兜底

配套校验：`tools/verify-rules-seed.js`（34 项断言，两个场景）、
`tools/seed-rules-library.js`（就地补种，不重装也能让模板回来）。

### 🔒 网络断联（开发版不联系官方后台）

原版把官方后端域名**混淆**存在 `src/core/backend-url.js` 里，运行时解码后返回，
全应用（auth / user / updater / 任务云端代理 / system）都从这里取 base。
开发版做了三层封锁：

| 层 | 做法 | 效果 |
| --- | --- | --- |
| ① 地址层 | `getBackendBase()` 直接返回黑洞 `http://127.0.0.1:1` | 所有拼出来的后端 URL 都指向本机保留端口，请求立即 `ECONNREFUSED`；**没有任何数据包离开本机，也不产生 DNS 查询**。该模块在应用加载最早期生效 |
| ② Node 出口层 | `dns.lookup` / `dns.promises.lookup` 对黑名单域名返回 `127.0.0.1`；`http/https.request/get` 命中黑名单时把目标改写到黑洞（保留协议，避免 `ERR_INVALID_PROTOCOL`） | 兜底「硬编码真实域名直连」的代码路径 |
| ③ 渲染层 | `session.defaultSession.webRequest.onBeforeRequest` 取消 `*://mh.rzna.cloud/*`、`*://*.mh.rzna.cloud/*` 及 ws/wss 变体 | 前端 `<img>` / 链接 / fetch 也出不去 |

> ★ 2.6.15 修正：`install()` 是在 `bootstrap` 里、`app.whenReady()` **之前**调用的，
> 此时取 `session.defaultSession` 会抛 `Session can only be received when app is ready`，
> 渲染层拦截**静默装不上**（2.6.14 补丁同样存在这个隐患）。现在改成
> `app.isReady() ? install() : app.whenReady().then(install)`，并补一行
> `渲染层拦截已启用（app ready 后）` 日志便于确认。

被拦下的请求都会写一行 `[dev-unlock] [net-block] ...` 到运行日志（`userData/logs`）便于审计；
`get-backend-url` / `fetch-announcements` / `fetch-avatars` 等通道也改为本地应答，不再发请求。

**实测证据**（`tools/audit-network.ps1`、`tools/verify-netblock.js`）：

```
[net-block] 后端请求已改道本地黑洞（未离开本机）: /api/v1/events
[net-block] 后端请求已改道本地黑洞（未离开本机）: /api/v1/my-license
[net-block] 已拦截(dns) mh.rzna.cloud
[net-block] 已拦截(http) mh.rzna.cloud/api/v1/ping-netblock-test

观测期内对外连接：无          DNS 缓存中含 mh.rzna.cloud：无
主动 https.get(https://mh.rzna.cloud/...) → ECONNREFUSED
```

### ⚠ 为什么以前「去掉了遮罩却还是要登录」（2.6.14 新增账号层）

2.6.14 把授权拆成了两层：**设备授权（激活码 / 会员时长）** 与 **账号登录**。
运行按钮在 `renderer/toolbar.js` 的 `onRun()` 里会先 `await Mrite._ensureAccountLogin()`，
返回 false 就弹「需要登录账号」并直接 return；`shared/run-detect.js` 的运行检测、
`panels/upload.js` 的重新载入任务同样走这个门禁。

同时 2.6.14 把 `showLogin` 挪进了 `core/shell.js`、账号模块挪进了
`features/settings/account-usage.js`，两者都在 `toolbar.js` **之后**加载——
补丁脚本若还插在 `toolbar.js` 后面，覆盖会被它们顶掉，表现为「还是要登录」。因此：

- `index.html` 里的引入位置改到 **`index.js` 之前**（即所有定义模块之后）
- `renderer/dev-unlock.js` 额外做三件事：
  1. 写入常驻会话 `localStorage['mrite-user-session']`（token `mrite-dev-unlock-token`），
     并钉住 `Mrite._userToken / _userData` —— 真实 `_loadUser()` 也会读到它，不会被清空
  2. 覆写 `_ensureAccountLogin / _accountRestore / _accountOAuthLogin`（恒 true）、
     `_accountLogout`（忽略退出）、`_saveUser(null, null)`（忽略清空调用）
  3. `setInterval(applyAll, 1000)` 兜底夺回任何被后续脚本重新定义的实现
- 主进程 `src/services/dev-unlock.js` 同步把账号 IPC 改成常驻已登录：
  `user-login-status` / `user-me` / `restore-user-session` / `oauth-login-start` /
  `user-logout`，并覆盖模块级 `userService.getLoginStatus()`

---

## 三、覆盖步骤（手动）

前置：本机装有 [Node.js](https://nodejs.org/)（用于 `npx` 解包）。

假设原版安装目录为 `<ROOT>`（即包含 `Mrite.exe` 的目录）。

1. **解包 `app.asar`** 到源码目录：

   ```powershell
   npx --yes @electron/asar extract "<ROOT>\resources\app.asar" "<ROOT>\resources\app"
   ```

2. **覆盖补丁文件**（同名覆盖，把 `patch\` 里的文件复制进解包目录）：

   ```
   patch\src\services\dev-unlock.js  →  <ROOT>\resources\app\src\services\dev-unlock.js
   patch\src\core\bootstrap.js       →  <ROOT>\resources\app\src\core\bootstrap.js
   patch\src\core\update-loader.js   →  <ROOT>\resources\app\src\core\update-loader.js
   patch\src\core\backend-url.js     →  <ROOT>\resources\app\src\core\backend-url.js
   patch\src\services\task\executable.js → <ROOT>\resources\app\src\services\task\executable.js
   patch\src\services\rules-library.js   → <ROOT>\resources\app\src\services\rules-library.js
   patch\renderer\features\settings\model-management.js → <ROOT>\resources\app\renderer\features\settings\model-management.js
   patch\renderer\features\settings\provider-form.js    → <ROOT>\resources\app\renderer\features\settings\provider-form.js
   patch\renderer\styles\result-components.css          → <ROOT>\resources\app\renderer\styles\result-components.css
   patch\renderer\ui\settings.html       → <ROOT>\resources\app\renderer\ui\settings.html
   patch\src\ipc\system.js               → <ROOT>\resources\app\src\ipc\system.js
   patch\renderer\shared\run-detect.js   → <ROOT>\resources\app\renderer\shared\run-detect.js
   patch\renderer\dev-unlock.js      →  <ROOT>\resources\app\renderer\dev-unlock.js
   patch\renderer\index.html         →  <ROOT>\resources\app\renderer\index.html
   ```

   > `rules-library.js` 这一条不能省：解包成目录模式后，原版只会去 `app.asar\rules-library`
   > 找内置模板库，找不到就**界面里一个模板都没有**。打完补丁后首次启动会自动把
   > `<ROOT>\resources\app\rules-library`（15 个比赛模板）种进
   > `%APPDATA%\MriteUltra-2.6.13-dev\rules-library`。
   >
   > 4 个 `renderer\...` 文件是把「API 常识答题」门禁拆掉，与授权无关；漏打只会让
   > 用户仍然被 20 题测验拦住，不影响其它功能。

3. **补齐原生模块**（`better-sqlite3` / `sharp` / `mrite-core` / `claude.exe` 原本在
   `app.asar.unpacked` 里，目录模式运行必须让它们出现在 `app` 目录下）：

   ```powershell
   robocopy "<ROOT>\resources\app.asar.unpacked" "<ROOT>\resources\app" /E /NFL /NDL /NJH /NJS /NC /NS
   ```

   （若上一步解包工具已自动带出原生模块，此步重复执行也无害。）

4. **让 Electron 改读目录**：把原归档改名，不要再叫 `app.asar`：

   ```powershell
   Rename-Item "<ROOT>\resources\app.asar" "<ROOT>\resources\app.asar.original"
   ```

5. **启动 `Mrite.exe`** —— 已经是无登录 / 无激活码的开发版。

> 注意：`resources\app` 目录必须与 `app.asar.unpacked` 共存于 `resources\` 下，
> 且 `app` 目录内必须包含第 3 步补齐的原生模块，否则启动会报原生组件缺失。

---

## 四、一键脚本（可选）

仓库根目录的 `apply.ps1` 自动完成上面 2～4 步：

```powershell
powershell -ExecutionPolicy Bypass -File apply.ps1 -AppRoot "D:\你的Mrite安装目录"
```

`-AppRoot` 指向包含 `Mrite.exe` 的安装根目录。脚本会先校验解包出的 `package.json`
版本号是否为 2.6.15，不符时给出提醒。

---

## 五、回滚

```powershell
Remove-Item "<ROOT>\resources\app" -Recurse -Force
Rename-Item "<ROOT>\resources\app.asar.original" "<ROOT>\resources\app.asar"
```

改回后重新启动即恢复原版（含登录 / 激活）。

---

## 六、数据目录与启动方式

| 启动方式 | userData 目录 | 说明 |
| --- | --- | --- |
| 直接双击 `Mrite.exe` | `%APPDATA%\MriteUltra-2.6.13` | 与正式版共用数据：设置 / API Key / 规则库 / 工作区都在这里 |
| `electron.exe <ROOT>\resources\app --dev-profile --dev` | `%APPDATA%\MriteUltra-2.6.13-dev` | 源目录直接运行、带 DevTools；首次启动自动从正式目录播种一份用户数据，与正式版互不干扰 |
| 双击 `Mrite.exe`（app 目录里有 `dev-profile.flag`） | `%APPDATA%\MriteUltra-2.6.13-dev` | 等价于常开 `--dev-profile`：安装版开发包用这个标记，装完双击即用独立数据目录 |

> **`dev-profile.flag` 标记**：在 `resources\app\` 下放一个同名空文件即可，
> 补丁里的 `update-loader.js`（决定 userData）与 `bootstrap.js`（决定 rootDir/播种）
> 都会认它。删掉该文件就回到「与正式版共用 `MriteUltra-2.6.13`」。
> 生成一个带此标记的开发版安装包见第十一节。

2.6.14 起 userData 被加载器**固定**为 `MriteUltra-2.6.13`（不再随版本号新建目录），
补丁在此基础上加了 `--dev-profile` 分支指向 `-dev` 目录；2.6.15 沿用同一套目录。

---

## 七、模型配置

开发版**不走服务器代理**，任务直接调用「设置 → 模型配置」里填写的 API：

- Anthropic 格式接口：`baseURL` 填到 `/anthropic` 这类端点，`格式` 选 anthropic
- OpenAI 格式接口：`格式` 选 openai，程序会自动做 Anthropic ↔ OpenAI 转换
- 示例：`https://api.deepseek.com/anthropic` + 模型 `deepseek-v4-pro`（anthropic 格式）

> 注意：**必须填自己的 API Key**。清空 Key 时任务会退回「云端代理」分支，
> 而开发版没有会话 token，那条链路必然失败。

换模型、换 Key 都在 App 的「设置 → 模型配置」里完成，无需重新打补丁。

---

## 八、注意事项

- 本补丁只匹配 **2.6.15** 版本；其它版本请按同样思路手动改 `bootstrap.js` /
  `update-loader.js` / `index.html` / `executable.js` / `rules-library.js`。
  > `rules-library.js` 的改动很小且向后兼容：只是给 `ensureLibraries()` 多加了几个候选路径
  > 与日志，旧版本里这个函数结构相同，可照抄。
- **热更新已被关闭**（`check-for-update` / `apply-update` / `apply-local-patch` 三个
  IPC 均被覆盖，加载器也不再加载 `userData\update\app.asar`）。这是有意为之：
  否则官方热更包一旦落地，下次启动就会用正式版代码覆盖开发版。
- 原生模块（`app.asar.unpacked`）与 `app` 目录必须配套，缺一不可。
- 开发版不再向服务器上报运行记录（`report-usage` / `report-task-log` /
  `report-event` 均改为本地应答）；本地用量统计仍保留。
- 账号层是**本地伪造**的常驻会话（`设置 → 账号` 会显示「开发版」，会员时长显示
  「永久有效」）。点「退出登录」不会真的退出，这是预期行为。
- 删除两个 `dev-unlock.js` 并还原 `bootstrap.js` / `update-loader.js` /
  `backend-url.js` / `executable.js` / `rules-library.js` / `index.html` 的改动，
  即可恢复原授权逻辑。
- ⚠ **`--dev` 与远程调试的关系**：原版 `bootstrap.js` 的 `applySecurity()` 带一处
  反调试自毁 —— `if (isDev) return;` 之后的 `--inspect` / `--remote-debugging-port`
  检测会直接 `app.quit()`（日志：`[security] Remote debugging detected, exiting`）。
  所以**必须同时带 `--dev`** 才能用 CDP/Inspector 验证；只带
  `--dev-profile --remote-debugging-port` 会让进程刚建完窗口就退出。

---

## 九、验证记录

### 2026-09-22，2.6.15（本次）

在 `C:\Users\lin\AppData\Local\Programs\Mrite-Dev`（安装版开发包，`Mrite.exe` 入口，
`--dev --dev-profile --remote-debugging-port=9333 --inspect=9334`）实测：

- 启动日志：`Mrite v2.6.15 启动中...`，`Root directory: ...\MriteUltra-2.6.13-dev`
- 主进程日志：`[dev-unlock] 开发版解锁已生效…（Mrite 2.6.15）`、`…账号层已放行…`、
  `…热更新已关闭…`、`渲染层拦截已启用（app ready 后）`
- 通过 CDP / Inspector 读取真实运行态（`tools/verify-dev-build.js`、
  `verify-dev-run-gate.js`、`verify-installed-dev.js`）：

  | 检查项 | 结果 |
  | --- | --- |
  | `Mrite.__devUnlock` / `_isActivated()` / `_isExpired()` | `true` / `true` / `false` |
  | `Mrite.STATE.authState` / `sessionAuthorized` | `authorized` / `true` |
  | DOM `.activation-overlay` / `.expired-popup-overlay` | 0 / 0 |
  | `Mrite.showLogin` 仍是补丁版本（未被 `shell.js` 顶掉） | 是 |
  | `Mrite._userToken` / `_userData` | `mrite-dev-unlock-token` / 开发版 |
  | `await Mrite._ensureAccountLogin()`（运行按钮的账号门禁） | `true` |
  | `_loadUser()` 后 token 是否保留 | 保留 |
  | `user-login-status` / `user-me` IPC | `{loggedIn:true}` / `{success:true}` |
  | 主进程 `userService.getLoginStatus()` | `{loggedIn:true, dev:true}` |
  | `check-activation` / `get-license-status` IPC | `{valid:true}` / `{valid:true,activated:true,permanent:true}` |
  | `verify-before-task` IPC | `{allowed:true}` |
  | 主进程 `auth.verifySessionForOperation()` / `verifyOperation('task')` | `true` / `{allowed:true}` |
  | `check-for-update` / `get-update-state` | 无更新（`reason: dev-unlock`，`recordedVersion: 2.6.15`） |
  | 主进程 `userData` / `appVersion` / `isPackaged` | `...\MriteUltra-2.6.13-dev` / `2.6.15` / `true` |
  | `claudeExe`（目录模式解析） | `...\resources\app\node_modules\@anthropic-ai\claude-agent-sdk\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe` |
  | `appEnvDir` / `pwsh` | `...\Mrite-Dev\Mrite_env` / `...\Mrite_env\pwsh\pwsh.exe` |
  | 运行门禁综合判定 | `运行门禁全部通过（账号 + 激活 + 任务校验）` |

- 离线校验（`.stage/verify-2615.js`，43 项全通过）：`app\` 与官方 2.6.15 归档逐文件比对，
  **仅 5 个文件被修改 + 3 个文件新增**（`dev-profile.flag` + 两个 `dev-unlock.js`），
  无文件缺失；7 个被改/新增的 JS 全部 `node --check` 通过；仓库 `patch\` 与实机 `app\` 逐字节一致。

### 2026-09-22（第二次改造）修复「软件里没有模板」

**现象**：装完开发版，模板选择、「我的模板」全空。

**官方模板从哪来（实证）**：拿官方 2.6.15 安装包（`C:\Users\lin\Downloads\Mrite2.6.15`）核对 ——
官方 `resources\` 下只有 `app.asar`(67.6MB) + `app.asar.unpacked` + `assets`，**没有**
`resources\rules-library`；用 asar 列归档内容，模板在 **asar 内部**：

```
\rules-library
\rules-library\common\主引导.md
\rules-library\descriptions\高教社杯.md
\rules-library\paper\system\cls\format.cls
\rules-library\paper\system\fonts\SourceHanSerifCN-Regular.otf
\rules-library\paper\system\main\高教社杯.tex        ← 15 个比赛主文件
\rules-library\paper\system\main\华为杯\figures\*.pdf
\rules-library\paper\system\sections\...            ← 12 个章节变体
\rules-library\templates.json
（共 137 个条目，含目录）
```

所以官方的链路是：**随包内置在 app.asar → 首启由 `ensureLibraries()` 种进 userData → 界面读
`userData\rules-library\templates.json`**。全程不联网，服务器只负责登录 / 激活 / 会员 / 热更新。
原版探测的第一个候选 `process.resourcesPath\app.asar\rules-library` 正是官方包的位置。

**开发版为什么没有**：开发版安装包是**目录模式**（`resources\app` 真实目录，为省 ~250MB 不带
`app.asar`），两个候选都不存在 → `src` 为空 → 播种整段被 `if (src)` 跳过 → 数据目录里只剩
`mkdirSync` 建出的空壳（实测：`%APPDATA%\MriteUltra-2.6.13-dev\rules-library` 仅 4 个残留文件、
无 `templates.json`、`paper\system\main` 为空）。

**是不是内容缺失？不是 —— 已逐字节核对**：

```
node .stage\extract-official-rules.js   # 抽官方 app.asar\rules-library → .stage\official-rules
node .stage\compare-rules.js            # 官方 82 文件 vs 开发版 82 文件：0 缺失 / 0 多余 / 0 内容不同
node .stage\compare-app.js              # 全量：官方 asar(除 node_modules) 526 文件 vs 开发版 529 文件
                                        #   缺失 0；新增 3（两个 dev-unlock.js + dev-profile.flag）
                                        #   修改 6（bootstrap / update-loader / backend-url /
                                        #          executable / rules-library / index.html）
```

即：开发版内置的模板**就是官方 2.6.15 那一份**，无需移植；缺的只是「种进数据目录」这一步。

**修复**：`resolveBundledRulesDir()` 多候选探测（asar → asar.unpacked → **`resources\app`**
→ `MRITE_REAL_RESOURCES` 的同三种 → `getAppPath()` / `__dirname` 兜底），命中即打印来源，
全落空时打印全部候选路径而不是静默。

**验证**（`tools/verify-rules-seed.js`，用假 `electron` 模块把安装目录当打包态跑真实
`ensureLibraries()`，覆盖「全新安装」与「升级自被污染的旧数据目录」两个场景）：

| 检查项 | 结果 |
| --- | --- |
| 断言总数 | **34 通过 / 0 失败** |
| 内置库来源 | `…\resources\app\rules-library`（目录模式候选命中） |
| `templates.json` 模板数 / `paper\system\main` 比赛数 | 15 / 15 |
| 模板主文件可解析 / 说明文档非空 | 15/15 / 15/15 |
| 章节变体 / `format.cls` / 中文字体 | 12 个 / 就位 / 3 个 |
| 求解方案 | `Mrite内置`、`Mrite2.6.13` |
| `listTemplates()` | 15 个，无 `solveMissing` / `paperMissing` |
| 旧数据目录场景：旧内置残留被清、内置文件被当前包覆盖 | 是 |

真实数据目录就地补种（`tools/seed-rules-library.js`）：83 个文件、15 个模板、
2 个求解方案、12 个章节；旧版残留目录（`common\公共求解规则` 等）已清。

> ⚠ **工具链坑**：本机系统 Node 是 v24.9.0，在 Windows 上对**非 ASCII 目录**执行
> `fs.rmSync(dir, { recursive: true, force: true })` 会**直接崩进程**（exit `0xC0000409`，
> 不抛 JS 异常），而应用自身是 Electron 33.4.11 的 Node 20.18.3（同一调用正常）。
> 两个 `tools` 脚本因此内建自举：检测到系统 Node ≥22 时自动用
> `_devtools\electron\electron.exe`（`ELECTRON_RUN_AS_NODE=1`）重跑。
> 注意 Electron 下 `process.resourcesPath` 是只读访问器，脚本用 `Object.defineProperty` 覆盖。

### 2026-09-23（第三次改造）移除「API 常识答题」门禁，模型自由选择

**需求**：不要那套答题门槛，模型想接哪个接哪个。

**原版行为**：`renderer/features/settings/model-management.js` 里有一整套
「API 报错诊断答题」——15 道固定报错题（400/401/402/…/529，每题为「原因 + 责任方」两问）
+ 29 道常识题库随机抽 5 题，每题限时 20 秒，**20/20 全对**才写
`localStorage['mrite-api-quiz-passed']='1'`。未通过时 `_applyApiQuizLock()` 会把
供应商卡片置灰（`.provider-card.locked`）并把
`inputApiBase` / `inputApiModel` / `inputApiKey` / `inputApiFormat` 全部 `disabled`；
点非 DeepSeek 卡片还会弹「连接其他模型」确认框引导去答题。

**改动**（4 个渲染层文件，见第二节表格）：

- 整体删除题库 / 答题弹窗 / 连接前确认框；`_navToSection` 进入「模型配置」不再触发任何东西
- 保留 4 个同名空实现（`_apiQuizPassed`→true、`_applyApiQuizLock`→空、`_onEnterApiConfig`→空、
  `_showApiQuiz`→直接 `finished(true)`），老调用点不会报错
- `_selectProvider()` 里的拦截删掉 → 任何供应商一点即选
- **模型名一律自由填写**：`_ensureModelSelect()` 不再把 DeepSeek 的模型框换成只读下拉，
  统一渲染成 `<input list="apiModelSuggestions">` + `<datalist>`（预置模型只作建议，
  且只放该供应商自己的模型）；端点框去掉 `readOnly`（有官方地址就预填，但可改）

**验证**（`--dev --multi-instance --remote-debugging-port=9335`，CDP 读真实运行态）：

| 检查项 | 结果 |
| --- | --- |
| `#btnApiQuiz` / `.api-quiz-opts` / `.btn-quiz-unlock` | `null` / 0 / 0 |
| `Mrite._apiQuizPassed()` | `true` |
| 连调 `_applyApiQuizLock()` 后四个输入框 | 全部 `enabled` |
| 直选 Kimi（原需答题） | 选中成功，无答题遮罩；端点 `https://api.moonshot.cn/v1`、`readOnly=false`；模型框 `INPUT`、可编辑 |
| DeepSeek 的模型建议列表 | 仅 `deepseek-v4-pro` / `-flash` / `-flash-vision-exp` |
| 手填 `gpt-5.1-custom` | 输入即写回 `settings.apiModel` |
| 模板回归（同实例） | `listTemplates()` → 15 个，首个 `高教社杯` |
| 全新数据目录（`-collab-dev`）自动种库 | 83 文件 + `templates.json`（顺带回归了模板修复） |

**补丁集重新生成**：`.stage/gen-patch-2615.js` 已扩到 12 个文件（新增第 8~12 段），
生成物与实机 `resources\app`、仓库 `.mrrepo\patch` 三者逐字节一致；补丁生成器新增
`cutRange()`（整段替换，锚点缺失/不唯一即报错），保证换官方版本时不会静默改错地方。

### 2026-09-20，2.6.14（历史）

在 `D:\Mrite2.6.13` 上实测（目录模式 `electron.exe app --dev-profile --dev`，
以及打包入口 `Mrite.exe`，两者结果一致）：

- 启动日志：`Mrite v2.6.14 启动中...`，`Root directory: ...\MriteUltra-2.6.13-dev`
  （首次启动自动从 `MriteUltra-2.6.13` 播种 16 项用户数据）
- 主进程日志：`[dev-unlock] 开发版解锁已生效…`、`…账号层已放行…`，
  渲染层日志：`[renderer] [dev-unlock] 渲染层解锁已生效…`
- 通过远程调试读取真实运行态：

  | 检查项 | 结果 |
  | --- | --- |
  | `Mrite._isActivated()` / `Mrite._isExpired()` | `true` / `false` |
  | `Mrite.STATE.authState` | `authorized` |
  | DOM 中 `.activation-overlay` / `.expired-popup-overlay` | 0 / 0 |
  | `Mrite.showLogin` 是否仍是补丁版本 | 是（未被 `core/shell.js` 顶掉） |
  | `Mrite._userToken` / `_userData` | `mrite-dev-unlock-token` / 开发版 |
  | `await Mrite._ensureAccountLogin()`（运行按钮的门禁） | `true` |
  | `_loadUser()` 之后 token 是否还在 | 还在 |
  | `user-login-status` / `user-me` IPC | `{ loggedIn: true }` / `{ success: true }` |
  | 主进程 `userService.getLoginStatus()` | `{ loggedIn: true }` |
  | `check-activation` IPC | `{ valid: true }` |
  | `get-license-status` IPC | `{ valid: true, activated: true, permanent: true }` |
  | `verify-before-task` IPC | `{ allowed: true }` |
  | 主进程 `auth.verifySessionForOperation()` | `true`（`task/index.js` 的唯一任务门槛） |
  | 主进程 `auth.verifyOperation('task')` | `{ allowed: true }` |
  | `check-for-update` / `get-update-state` | 无更新（`dev-unlock`） |
  | `userData\update\app.asar` 是否存在 | 否（热更新负载不会被加载） |

- 运行门禁（账号 + 激活 + 任务校验）三项全部通过；
  实测点一次「运行」确实进入了 `launch-task` → `taskService.launch()` 并启动 agent，
  全程没有任何「需要登录账号」弹窗。

---

## 十、配套调试脚本（在 `tools\`，随安装包一起分发）

| 脚本 | 用途 |
| --- | --- |
| `verify-dev-build.js <port>` | 读渲染层真实状态：激活/遮罩/账号/各授权 IPC/更新状态 |
| `verify-dev-run-gate.js <port>` | **只读**评估运行门禁（账号 + 激活 + verify-before-task） |
| `verify-dev-main.js <port>` | 读主进程 `auth.*` / `userService` / `updater` 状态（需 `--inspect=<port>`） |
| `cdp-eval.js <port> "<expr>"` | 通用：在渲染层执行任意表达式并回显结果 |
| `inspect-asar.js <asar>` | 查看 asar 的版本 / 顶层结构 / unpacked 原生模块布局 |
| `asar-extract-file.js <asar> <内部路径> <输出文件>` | 从 asar 中单取一个文件 |

> 启动示例：
> ```powershell
> & "...\Mrite.exe" --dev --dev-profile --remote-debugging-port=9333 --inspect=9334
> ```
> ⚠ **必须带 `--dev`**：原版 `applySecurity()` 在非 `--dev` 下检测到
> `--inspect` / `--remote-debugging-port` 会直接退出（`[security] Remote debugging detected, exiting`），
> 表现为「刚建完窗口就没了」。
> ⚠ 这些脚本只做**只读**检查。**不要**去调用 `Mrite.onRun()` 做「门禁测试」——
> 那会真的启动任务并消耗 API 额度（`window.electronAPI` 是 contextBridge 暴露的
> 冻结对象，赋值打桩无效）。
> ℹ 脚本里 `require('ws')` 走 `tools\node_modules`（一个指向
> `resources\app\node_modules` 的目录联接），所以不再有写死的绝对路径。

---

## 十一、开发版安装包（Setup.exe）是怎么做的

产物：`Mrite-Dev-2.6.15-Setup.exe`（约 1.5GB，NSIS 安装器 + 内嵌 7z 载荷）。
免管理员、可自选安装目录、可选桌面快捷方式、带卸载项。

### 构建目录 `_devtools\setup-build\`（安装目录下）

| 文件 | 说明 |
| --- | --- |
| `stage.ps1` | 生成载荷：程序根文件 + `resources\app`(开发源码) + `resources\assets` + `_devtools\electron` + `Mrite_env` + `tools`，并写入 `dev-profile.flag` 与安装版 `start-dev.bat` |
| `Mrite-Dev.nsi` | NSIS 脚本（MUI2：欢迎 / 安装目录 / 组件 / 安装 / 完成 + 卸载页） |
| `payload.7z` | 载荷压缩包（`7za a -t7z -mx=7 -mmt=on -ms=on`，约 1.4GB） |
| `icon.ico` | 取自 `resources\assets\icons\icon.ico` |
| `..\nsis\bin\makensis.exe` | NSIS 3.04（electron-builder-binaries 缓存里那份，见下） |
| `..\nsis\7za.exe` | 7-Zip 独立版，随安装包发布，安装时用它解包 |

> 本机没有现成的 `_devtools\nsis\` 工具链（安装包刻意不含它），两个工具从
> electron-builder 缓存里取，复制成上面两个路径即可：
> `%LOCALAPPDATA%\electron-builder\Cache\nsis-3.0.4.1\*\Bin\makensis.exe`（另需同目录
> `Stubs` / `Include` / `Plugins` / `Contrib`，建议整个目录一起复制）、
> `%LOCALAPPDATA%\electron-builder\Cache\7zip@1.0.0\*\bin\7za.exe`。

### 两条构建命令

```powershell
$root = "C:\Users\lin\AppData\Local\Programs\Mrite-Dev"

# 1) 载荷（在 setup-build 目录）
$za = "$root\_devtools\nsis\7za.exe"
Push-Location "$root\_devtools\setup-build\payload"
& $za a -t7z -mx=7 -mmt=on -ms=on "..\payload.7z" "*"
Pop-Location

# 2) 编译安装包
& "$root\_devtools\nsis\bin\makensis.exe" /V1 `
  "$root\_devtools\setup-build\Mrite-Dev.nsi"
```

> `Mrite-Dev.nsi` 用 `!ifndef` 开放了 `PAYLOAD_7Z` / `OUTFILE` / `SEVENZR`，
> 便于用小载荷快速验证脚本：
> `makensis "/DPAYLOAD_7Z=...\payload-small.7z" "/DOUTFILE=...\test.exe" Mrite-Dev.nsi`

### ⚠ 关键坑：不能用 `File /r` 打 3GB+ 载荷

6 万个文件、3.34GB 直接用 `File /r` 会让 32 位 `makensis` 在压缩阶段抛

```
Internal compiler error #12345: error mmapping datablock to 164525.
```

（datablock 的 mmap 失败，且失败偏移每次都不同；`SetDatablockOptimize off`、
去掉 `SetCompressorDictSize 64` 都不解决。）

所以改成：**NSIS 只内嵌一个已压缩的 `payload.7z` + `7za.exe`**（`SetCompress off`
存原始数据，datablock 里只有两个文件，编译几秒钟完成），安装时由 `nsExec` 调用
`7za x` 解包到 `$INSTDIR`，再删掉这两个临时文件。

### 安装行为

| 项 | 值 |
| --- | --- |
| 默认安装目录 | `%LOCALAPPDATA%\Programs\Mrite-Dev`（可在安装向导里改；会记住上次选择） |
| 权限 | 免管理员（`RequestExecutionLevel user`） |
| 快捷方式 | 开始菜单「Mrite 开发版」文件夹（主程序 / 开发模式 / 说明 / 卸载）+ **桌面快捷方式（可勾选，默认勾选）** |
| 卸载项 | `HKCU\...\Uninstall\MriteDev`，控制面板「应用」里可卸载；卸载时询问是否删除用户数据（默认保留） |
| 路径保护 | 安装目录 > 90 字符 或含非英文字符时弹窗警告（Mrite 的 Python/LaTeX 在中文或过深路径下会失效） |
| 数据目录 | `resources\app\dev-profile.flag` → `%APPDATA%\MriteUltra-2.6.13-dev` |

#### ⚠ 卸载逻辑的两个坑（2026-09-22 实测踩到并修复）

1. **静默卸载会无声删掉用户数据**。原来写的是
   `MessageBox MB_ICONQUESTION|MB_YESNO "是否删除用户数据？" IDNO keep`——静默（`/S`）时
   NSIS 会把 MessageBox 当成按下**第一个**按钮 =「是」，于是 `RMDir /r` 直接执行。
   现在：静默模式一律**保留**用户数据，只有交互式卸载才询问，且用
   `MB_DEFBUTTON2` 把默认按钮设为「否」。
2. **判断静默不能用 `${GetOptions}`**。命令恰好只有 `/S`（没有别的参数）时
   `${GetOptions} $R "$/S" $v` 返回的 `$v` 是**空字符串**，`$v != ""` 恒为假 →
   逻辑落回「交互式」分支 → 又踩回第 1 条。改成直接看命令头两个字符是否为 `/S`。
3. **`Uninstall.exe` 自删**：运行中的 `Uninstall.exe` 被占用，`Delete "$INSTDIR\Uninstall.exe"`
   必然失败，结果是卸载后残留一个只含 `Uninstall.exe` 的空目录。改成
   `Exec 'cmd.exe /C ping 127.0.0.1 -n 3 >nul & del /F /Q "$INSTDIR\Uninstall.exe" & rd /Q "$INSTDIR"'`
   —— 分离进程等本进程退出后再删（注意卸载段里要用 `$INSTDIR`，不要用 `$EXEDIR`）。

### 产物里装了什么（原始约 3.34GB / 60743 个文件）

| 部分 | 大小 | 作用 |
| --- | --- | --- |
| `Mrite.exe` + DLL/pak/locales | ~265MB | Electron 主程序与运行库 |
| `resources\app` | ~314MB | **开发版源码**（已解锁；含 claude.exe 等原生模块） |
| `resources\assets` | ~187MB | 内置资源（图标、离线 Python wheels、Word 导出模板） |
| `_devtools\electron` | ~268MB | 调试运行时，供 `start-dev.bat` 直接跑源码 |
| `Mrite_env` | ~2385MB | 集成环境：Python(+科学计算包) / TinyTeX / pandoc / pwsh |
| `tools` | ~0.4MB | 维护脚本（asar 工具、验证脚本） |

> 刻意**不装** `resources\app.asar` 与 `app.asar.unpacked`（省 250MB）：开发版走目录模式，
> 原生模块在 `resources\app\node_modules` 里已有一份。
> ⚠ 前提是已应用 `patch/src/services/task/executable.js` 那处补丁——否则 `claude.exe`
> 解析为 null、任务起不来（官方只在 `app.asar.unpacked` 下做目录扫描）。
> 打包装完后**务必验证**（见下）。

### 安装后必做的验证

```powershell
# 装到临时目录（静默、不会创建桌面快捷方式），再带调试端口启动
& "Mrite-Dev-2.6.15-Setup.exe" /S /D=D:\MriteDevTest
& "D:\MriteDevTest\Mrite.exe" --dev --dev-profile --remote-debugging-port=9333 --inspect=9334
node tools\verify-installed-dev.js 9334   # 看 claudeExe / appEnvDir / userData / verifySessionForOperation
node tools\verify-dev-build.js 9333        # 看界面解锁与账号状态
node tools\verify-dev-run-gate.js 9333     # 看运行门禁三项
```

`claudeExe` 必须解析到安装目录下的真实路径（不是 `null`），`appEnvDir` 必须是安装目录下的
`Mrite_env`，`userData` 必须是 `%APPDATA%\MriteUltra-2.6.13-dev`。

> ⚠ **别用 `Start-Process` / `start` 从自动化脚本里拉起再退出**：父进程一结束，
> 子进程可能被一起收掉（日志只到 `app.whenReady() 触发，创建窗口...` 就断）。
> 验证时让启动命令所在的前台进程一直活着，或者人工双击启动。

---

## 十二、发布到 GitHub Releases

仓库：<https://github.com/06xxlin/Mrite-dev>（公开）。

流程（本机凭据来自 Windows 凭据管理器里的 `git:https://06xxlin@github.com`，不落盘）：

```powershell
# 1) 先建 draft（避免上传中断留下半个已发布版本）
POST https://api.github.com/repos/06xxlin/Mrite-dev/releases
     { tag_name: "v2.6.15-dev", target_commitish: "main", name: "Mrite 开发版 v2.6.15", draft: true, body: "..." }

# 2) 上传资产（1GB 左右，按网速可能十几分钟到几十分钟）
POST https://uploads.github.com/repos/06xxlin/Mrite-dev/releases/<id>/assets?name=Mrite-Dev-2.6.15-Setup.exe
     Content-Type: application/octet-stream   Body: 安装包文件

# 3) 转正式发布
PATCH https://api.github.com/repos/06xxlin/Mrite-dev/releases/<id>   { draft: false }
```

两点注意：

- 仓库是 **public**，`git ls-remote` / 读 API 免鉴权；建 release 与上传资产需要带 `repo` 权限的 token。
- 资产的**同名覆盖**：重发同一版本时先 `DELETE .../releases/assets/<asset_id>` 再上传，
  否则会得到 `already_exists`。

> ⚠ **本机 git 的 schannel TLS 是坏的**（`AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`，
> 所有 https 站点都这样）。git 自带的 openssl 后端不受影响，因此 clone/push 都要加：
> `git -c http.sslBackend=openssl ...`。Node 的 https（含上传 release 资产的脚本）则是正常的。
