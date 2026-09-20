# Mrite-dev 开发版：技术说明与构建文档（v2.6.14）

> 面向开发者 / 维护者。README 只写项目介绍；补丁改了哪些文件、安装包怎么构建、
> 数据目录与调试脚本等技术细节都在本文档。

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

## 二、补丁内容（6 个文件）

| 文件 | 类型 | 作用 |
| --- | --- | --- |
| `patch/src/services/dev-unlock.js` | 新增 | 主进程解锁：放行授权判定 + 覆盖授权 IPC + **放行账号登录 IPC** + 关闭热更新 + 广播「已授权」 |
| `patch/src/core/bootstrap.js` | 修改 | 在 `authService.register()` / `userService.register()` / `updaterService.register()` 之后调用 `dev-unlock.install()`；新增 `--dev-profile` 独立数据目录 |
| `patch/src/core/update-loader.js` | 修改 | 开发版**永不加载**官方热更新包，避免解锁代码被热更覆盖；`--dev-profile` 指向 `-dev` 数据目录 |
| `patch/src/services/task/executable.js` | 修改 | 目录模式（`resources\app`，没有 `app.asar.unpacked`）下也能找到 `claude.exe`：增加对 `app\node_modules\@anthropic-ai\...\@anthropic-ai\` 的目录扫描 |
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
| 双击 `Mrite.exe`（app 目录里有 `dev-profile.flag`） | `%APPDATA%\MriteUltra-2.6.13-dev` | 等价于常开 `--dev-profile`：安装版开发包用这个标记，装完双击即用独立数据目录 |

> **`dev-profile.flag` 标记**：在 `resources\app\` 下放一个同名空文件即可，
> 补丁里的 `update-loader.js`（决定 userData）与 `bootstrap.js`（决定 rootDir/播种）
> 都会认它。删掉该文件就回到「与正式版共用 `MriteUltra-2.6.13`」。
> 生成一个带此标记的开发版安装包见第十一节。

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

---

## 十一、开发版安装包（Setup.exe）是怎么做的

产物：`Mrite-Dev-2.6.14-Setup.exe`（约 1.5GB，NSIS 安装器 + 内嵌 7z 载荷）。
免管理员、可自选安装目录、可选桌面快捷方式、带卸载项。

### 构建目录 `D:\Mrite2.6.13\_devtools\setup-build\`

| 文件 | 说明 |
| --- | --- |
| `stage.ps1` | 生成载荷：程序根文件 + `resources\app`(开发源码) + `resources\assets` + `_devtools\electron` + `Mrite_env` + `tools`，并写入 `dev-profile.flag` 与安装版 `start-dev.bat` |
| `Mrite-Dev.nsi` | NSIS 脚本（MUI2：欢迎 / 安装目录 / 组件 / 安装 / 完成 + 卸载页） |
| `payload.7z` | 载荷压缩包（7zr `-mx=7 -mmt`，约 1.4GB） |
| `icon.ico` | 取自 `resources\assets\icons\icon.ico` |
| `..\nsis\bin\makensis.exe` | NSIS 3.04（来自 electron-builder-binaries） |
| `..\nsis\7zr.exe` | 7-Zip 26.03 精简版，随安装包发布，安装时用它解包 |

### 两条构建命令

```powershell
# 1) 载荷（在 setup-build 目录）
$zr = "D:\Mrite2.6.13\_devtools\nsis\7zr.exe"
Push-Location "D:\Mrite2.6.13\_devtools\setup-build\payload"
& $zr a -t7z -mx=7 -mmt=on -ms=on "..\payload.7z" "*"
Pop-Location

# 2) 编译安装包
& "D:\Mrite2.6.13\_devtools\nsis\bin\makensis.exe" /V1 `
  "D:\Mrite2.6.13\_devtools\setup-build\Mrite-Dev.nsi"
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

所以改成：**NSIS 只内嵌一个已压缩的 `payload.7z` + `7zr.exe`**（`SetCompress off`
存原始数据，datablock 里只有两个文件，编译几秒钟完成），安装时由 `nsExec` 调用
`7zr x` 解包到 `$INSTDIR`，再删掉这两个临时文件。

### 安装行为

| 项 | 值 |
| --- | --- |
| 默认安装目录 | `%LOCALAPPDATA%\Programs\Mrite-Dev`（可在安装向导里改；会记住上次选择） |
| 权限 | 免管理员（`RequestExecutionLevel user`） |
| 快捷方式 | 开始菜单「Mrite 开发版」文件夹（主程序 / 开发模式 / 说明 / 卸载）+ **桌面快捷方式（可勾选，默认勾选）** |
| 卸载项 | `HKCU\...\Uninstall\MriteDev`，控制面板「应用」里可卸载；卸载时询问是否删除用户数据（默认保留） |
| 路径保护 | 安装目录 > 90 字符 或含非英文字符时弹窗警告（Mrite 的 Python/LaTeX 在中文或过深路径下会失效） |
| 数据目录 | `resources\app\dev-profile.flag` → `%APPDATA%\MriteUltra-2.6.13-dev` |

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
& "Mrite-Dev-2.6.14-Setup.exe" /S /D=D:\MriteDevTest
Start-Process "D:\MriteDevTest\Mrite.exe" -ArgumentList "--dev","--remote-debugging-port=9333","--inspect=9334"
node tools\verify-installed-dev.js 9334   # 看 claudeExe / appEnvDir / userData / verifySessionForOperation
node tools\verify-dev-build.js 9333       # 看界面解锁与账号状态
```

`claudeExe` 必须解析到安装目录下的真实路径（不是 `null`），`appEnvDir` 必须是安装目录下的
`Mrite_env`，`userData` 必须是 `%APPDATA%\MriteUltra-2.6.13-dev`。

---

## 十二、发布到 GitHub Releases

仓库：<https://github.com/06xxlin/Mrite-dev>（公开）。

流程（本机凭据来自 Windows 凭据管理器里的 `git:https://06xxlin@github.com`，不落盘）：

```powershell
# 1) 先建 draft（避免上传中断留下半个已发布版本）
POST https://api.github.com/repos/06xxlin/Mrite-dev/releases
     { tag_name: "v2.6.14-dev", target_commitish: "main", name: "Mrite 开发版 v2.6.14", draft: true, body: "..." }

# 2) 上传资产（1GB 左右，按网速可能十几分钟到几十分钟）
POST https://uploads.github.com/repos/06xxlin/Mrite-dev/releases/<id>/assets?name=Mrite-Dev-2.6.14-Setup.exe
     Content-Type: application/octet-stream   Body: 安装包文件

# 3) 转正式发布
PATCH https://api.github.com/repos/06xxlin/Mrite-dev/releases/<id>   { draft: false }
```

两点注意：

- 仓库是 **public**，`git ls-remote` / 读 API 免鉴权；建 release 与上传资产需要带 `repo` 权限的 token。
- 资产的**同名覆盖**：重发同一版本时先 `DELETE .../releases/assets/<asset_id>` 再上传，
  否则会得到 `already_exists`。
