# Mrite-dev 开发版补丁（v2.6.14）

一个**轻量补丁包**：把原版 Mrite 打包程序改造成**无登录 / 无激活码 / 无会员时长校验**的开发版。

- 只含 5 个文件（3 个修改 + 2 个新增），覆盖到原版解包后的源码目录即可
- 不改服务器、不提供任何 Key；只是把客户端侧的授权门槛放行
- 任务仍使用「设置 → 模型配置」里**你自己的 API Key** 直连，与服务器授权无关

---

## 一、适用版本

| 版本 | 状态 | 补丁文件数 | 备注 |
| --- | --- | --- | --- |
| **Mrite 2.6.14** | ✅ 当前补丁 | 5 | 新增 `update-loader.js` 热更新防护 |
| Mrite 2.6.13 | 历史版本 | 4 | 见 git 提交 `2705d52`，无热更新加载器 |

判断方法：安装目录里 `Mrite.exe` 的「属性 → 详细信息 → 产品版本」，或解包后看 `package.json` 的
`version`。本补丁按 **2.6.14** 的源码结构制作；其它版本请按同样思路手动改
`bootstrap.js` / `update-loader.js` / `index.html`。

---

## 二、补丁内容（5 个文件）

| 文件 | 类型 | 作用 |
| --- | --- | --- |
| `patch/src/services/dev-unlock.js` | 新增 | 主进程解锁：放行授权判定 + 覆盖授权 IPC + **放行账号登录 IPC** + 关闭热更新 + 广播「已授权」 |
| `patch/src/core/bootstrap.js` | 修改 | 在 `authService.register()` / `userService.register()` / `updaterService.register()` 之后调用 `dev-unlock.install()`；新增 `--dev-profile` 独立数据目录 |
| `patch/src/core/update-loader.js` | 修改 | 开发版**永不加载**官方热更新包，避免解锁代码被热更覆盖；`--dev-profile` 指向 `-dev` 数据目录 |
| `patch/renderer/dev-unlock.js` | 新增 | 渲染层解锁：**伪造常驻登录会话** + 登录遮罩/过期弹窗置空 + `_isActivated` 恒为 true |
| `patch/renderer/index.html` | 修改 | 在**最后一个业务脚本 `index.js` 之前**引入 `dev-unlock.js` |

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
   patch\renderer\dev-unlock.js      →  <ROOT>\resources\app\renderer\dev-unlock.js
   patch\renderer\index.html         →  <ROOT>\resources\app\renderer\index.html
   ```

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
版本号是否为 2.6.14，不符时给出提醒。

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

2.6.14 起 userData 被加载器**固定**为 `MriteUltra-2.6.13`（不再随版本号新建目录），
补丁在此基础上加了 `--dev-profile` 分支指向 `-dev` 目录。

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

- 本补丁只匹配 **2.6.14** 版本；其它版本请按同样思路手动改 `bootstrap.js` /
  `update-loader.js` / `index.html`。
- **热更新已被关闭**（`check-for-update` / `apply-update` / `apply-local-patch` 三个
  IPC 均被覆盖，加载器也不再加载 `userData\update\app.asar`）。这是有意为之：
  否则官方热更包一旦落地，下次启动就会用正式版代码覆盖开发版。
- 原生模块（`app.asar.unpacked`）与 `app` 目录必须配套，缺一不可。
- 开发版不再向服务器上报运行记录（`report-usage` / `report-task-log` /
  `report-event` 均改为本地应答）；本地用量统计仍保留。
- 账号层是**本地伪造**的常驻会话（`设置 → 账号` 会显示「开发版」，会员时长显示
  「永久有效」）。点「退出登录」不会真的退出，这是预期行为。
- 删除两个 `dev-unlock.js` 并还原 `bootstrap.js` / `update-loader.js` / `index.html`
  的改动，即可恢复原授权逻辑。

---

## 九、验证记录（2026-09-20，2.6.14）

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

## 十、配套调试脚本（在 `D:\Mrite2.6.13\tools\`）

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
> & "...\_devtools\electron\electron.exe" "...\app" --dev-profile --dev --remote-debugging-port=9333 --inspect=9334
> ```
> ⚠ 这些脚本只做**只读**检查。**不要**去调用 `Mrite.onRun()` 做「门禁测试」——
> 那会真的启动任务并消耗 API 额度（`window.electronAPI` 是 contextBridge 暴露的
> 冻结对象，赋值打桩无效）。
