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
| `patch/src/services/dev-unlock.js` | 新增 | 主进程解锁：放行授权判定 + 覆盖授权 IPC + 关闭热更新 + 广播「已授权」 |
| `patch/src/core/bootstrap.js` | 修改 | 在 `authService.register()` / `updaterService.register()` 之后调用 `dev-unlock.install()`；新增 `--dev-profile` 独立数据目录 |
| `patch/src/core/update-loader.js` | 修改 | 开发版**永不加载**官方热更新包，避免解锁代码被热更覆盖；`--dev-profile` 指向 `-dev` 数据目录 |
| `patch/renderer/dev-unlock.js` | 新增 | 渲染层解锁：登录遮罩/过期弹窗置空、`_isActivated` 恒为 true |
| `patch/renderer/index.html` | 修改 | 在 `toolbar.js` 之后、`extensions/*` 与 `panels/*` 之前引入 `dev-unlock.js` |

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
- 删除两个 `dev-unlock.js` 并还原 `bootstrap.js` / `update-loader.js` / `index.html`
  的改动，即可恢复原授权逻辑。

---

## 九、验证记录（2026-09-20，2.6.14）

在 `D:\Mrite2.6.13` 的目录模式开发版上实测（`_devtools\electron\electron.exe app --dev-profile --dev`）：

- 启动日志：`Mrite v2.6.14 启动中...`，`Root directory: ...\MriteUltra-2.6.13-dev`
  （首次启动自动从 `MriteUltra-2.6.13` 播种 16 项用户数据）
- 主进程日志：`[dev-unlock] 开发版解锁已生效…`，渲染层日志：`[renderer] [dev-unlock] 渲染层解锁已生效…`
- 通过远程调试读取真实运行态：

  | 检查项 | 结果 |
  | --- | --- |
  | `Mrite._isActivated()` / `Mrite._isExpired()` | `true` / `false` |
  | `Mrite.STATE.authState` | `authorized` |
  | DOM 中 `.activation-overlay` / `.expired-popup-overlay` | 0 / 0 |
  | `check-activation` IPC | `{ valid: true }` |
  | `get-license-status` IPC | `{ activated: true, permanent: true }` |
  | `verify-before-task` IPC | `{ allowed: true }` |
  | 主进程 `auth.verifySessionForOperation()` | `true`（`task/index.js` 的唯一任务门槛） |
  | 主进程 `auth.verifyOperation('task')` | `{ allowed: true }` |
  | `check-for-update` / `get-update-state` | 无更新（`dev-unlock`） |
