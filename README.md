# Mrite-dev 开发版补丁

一个**轻量补丁包**：把原版 Mrite 2.6.13 打包程序改造成**无登录 / 无激活码 / 无会员时长校验**的开发版。

- 只含 4 个文件（2 个修改 + 2 个新增），覆盖到原版解包后的源码目录即可
- 不改服务器、不提供任何 Key；只是把客户端侧的授权门槛放行
- 任务仍使用「设置 → 模型配置」里**你自己的 API Key** 直连，与服务器授权无关

---

## 一、适用版本

原版 **Mrite 2.6.13**（安装目录里含 `Mrite.exe` 和 `resources\app.asar`）。
其它版本理论上同思路可行，但 `bootstrap.js` / `index.html` 结构可能略有差异。

---

## 二、补丁内容（4 个文件）

| 文件 | 类型 | 作用 |
| --- | --- | --- |
| `patch/src/services/dev-unlock.js` | 新增 | 主进程解锁：放行授权判定 + 覆盖授权 IPC + 广播“已授权” |
| `patch/src/core/bootstrap.js` | 修改 | 在 `authService.register()` 之后调用 `dev-unlock.install()` |
| `patch/renderer/dev-unlock.js` | 新增 | 渲染层解锁：登录遮罩/过期弹窗置空、`_isActivated` 恒为 true |
| `patch/renderer/index.html` | 修改 | 在 `toolbar.js` 之后引入 `dev-unlock.js` |

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
   Rename-Item "<ROOT>\resources\app.asar" "<ROOT>\resources\app.asar.bak"
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

`-AppRoot` 指向包含 `Mrite.exe` 的安装根目录。

---

## 五、回滚

```powershell
Remove-Item "<ROOT>\resources\app" -Recurse -Force
Rename-Item "<ROOT>\resources\app.asar.bak" "<ROOT>\resources\app.asar"
```

改回后重新启动即恢复原版（含登录 / 激活）。

---

## 六、模型配置

开发版**不走服务器代理**，任务直接调用「设置 → 模型配置」里填写的 API：

- Anthropic 格式接口：`baseURL` 填到 `/anthropic` 这类端点，`格式` 选 anthropic
- OpenAI 格式接口：`格式` 选 openai，程序会自动做 Anthropic ↔ OpenAI 转换
- 示例：`https://api.deepseek.com/anthropic` + 模型 `deepseek-v4-pro`（anthropic 格式）

换模型、换 Key 都在 App 的「设置 → 模型配置」里完成，无需重新打补丁。

---

## 七、注意事项

- 本补丁只匹配 **2.6.13** 版本；其它版本请按同样思路手动改 `bootstrap.js` / `index.html`。
- 原生模块（`app.asar.unpacked`）与 `app` 目录必须配套，缺一不可。
- 开发版不再向服务器上报运行记录；本地用量统计仍保留。
- 删除 `dev-unlock.js` 两个文件并还原 `bootstrap.js` / `index.html` 的两处改动，即可恢复原授权逻辑。
