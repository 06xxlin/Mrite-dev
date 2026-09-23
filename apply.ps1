# apply.ps1 — 一键把原版 Mrite 2.6.15 改造成开发版
# 用法：
#   powershell -ExecutionPolicy Bypass -File apply.ps1 -AppRoot "D:\你的Mrite安装目录"
#   -AppRoot : Mrite 安装根目录（包含 Mrite.exe 与 resources\ 目录）
param(
  [Parameter(Mandatory=$true)]
  [string]$AppRoot,
  # 期望的原版版本号；解包后版本不一致时只警告不中断（可用 -Force 跳过检查）
  [string]$ExpectedVersion = '2.6.15',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$resources = Join-Path $AppRoot 'resources'
$asar      = Join-Path $resources 'app.asar'
$unpacked  = Join-Path $resources 'app.asar.unpacked'
$appDir    = Join-Path $resources 'app'
$patchDir  = Join-Path $PSScriptRoot 'patch'

$patchFiles = @(
  'src\services\dev-unlock.js',
  'src\core\bootstrap.js',
  'src\core\update-loader.js',
  'src\core\backend-url.js',
  'src\services\task\executable.js',
  # ★ 目录模式下内置规则库路径探测：原版只找 app.asar\rules-library，
  #   解包成 resources\app 后永远找不到内置库 → 界面「没有模板」。必须打。
  'src\services\rules-library.js',
  # ★ 移除「API 常识答题」门禁（20 题全对才让连 DeepSeek 以外的模型）：
  #   供应商随便选，端点 / 模型名 / Key 随便填；模型名一律可自由输入（预置模型只作建议）。
  'renderer\features\settings\model-management.js',
  'renderer\features\settings\provider-form.js',
  'renderer\styles\result-components.css',
  'renderer\ui\settings.html',
  # ★ 运行前「网络」预检探的是官方软件服务，开发版后端被黑洞掉后必然失败，
  #   会让「确认运行」按钮永久置灰（任务起不来）→ 这两处把它改成「已跳过」并放行。
  'src\ipc\system.js',
  'renderer\shared\run-detect.js',
  'renderer\dev-unlock.js',
  'renderer\index.html'
)

if (-not (Test-Path $asar)) {
  Write-Host "[错误] 找不到 $asar" -ForegroundColor Red
  Write-Host "       请确认 -AppRoot 指向 Mrite 安装根目录（包含 Mrite.exe）。" -ForegroundColor Red
  exit 1
}

# 1) 备份原归档（只做一次；若已备份则直接移除 app.asar 让位给目录）
$bak = "$asar.original"
if (Test-Path $bak) {
  Write-Host "[1/5] 已存在备份 $bak，移除 app.asar ..."
  Remove-Item $asar -Force
} else {
  Write-Host "[1/5] 备份 app.asar -> app.asar.original"
  Rename-Item $asar $bak
}

# 2) 解包
if (-not (Test-Path $appDir)) {
  Write-Host "[2/5] 解包 $bak -> $appDir（需要 npx/node）"
  npx --yes @electron/asar extract $bak $appDir
  if ($LASTEXITCODE -ne 0) { Write-Host "[错误] 解包失败" -ForegroundColor Red; exit 1 }
} else {
  Write-Host "[2/5] $appDir 已存在，跳过解包"
}

# 3) 校验版本（补丁是按 2.6.15 源码结构制作的）
$pkgPath = Join-Path $appDir 'package.json'
$actualVersion = ''
if (Test-Path $pkgPath) {
  try { $actualVersion = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version } catch {}
}
Write-Host "[3/5] 应用源码版本: $($actualVersion -replace '^$','(未知)')  （补丁适配 $ExpectedVersion）"
if ($actualVersion -ne $ExpectedVersion -and -not $Force) {
  Write-Host "[警告] 版本与补丁适配版本不一致，bootstrap.js / update-loader.js / index.html 结构可能不同。" -ForegroundColor Yellow
  Write-Host "       确认要继续请加 -Force 重新运行。" -ForegroundColor Yellow
  exit 2
}

# 3.5) 解包后 rules-library 必须落在 resources\app\rules-library（内置模板来自这里）
$libDir = Join-Path $appDir 'rules-library'
if (Test-Path $libDir) {
  $tpl = Join-Path $libDir 'templates.json'
  $tplCount = 0
  if (Test-Path $tpl) {
    try { $tplCount = @((Get-Content $tpl -Raw -Encoding UTF8 | ConvertFrom-Json).templates).Count } catch {}
  }
  Write-Host "[3.5/5] 内置规则库: $libDir（模板 $tplCount 个）"
} else {
  Write-Host "[警告] 解包后找不到 $libDir —— 模板列表会是空的，请确认原版安装包的 app.asar 内含 rules-library。" -ForegroundColor Yellow
}

# 4) 覆盖补丁
Write-Host "[4/5] 覆盖补丁文件（$($patchFiles.Count) 个）..."
foreach ($rel in $patchFiles) {
  $src = Join-Path $patchDir $rel
  $dst = Join-Path $appDir $rel
  if (-not (Test-Path $src)) { Write-Host "[错误] 补丁文件缺失: $src" -ForegroundColor Red; exit 1 }
  $dstDir = Split-Path $dst -Parent
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
  Copy-Item $src $dst -Force
  Write-Host "        $rel"
}

# 5) 补齐原生模块（better-sqlite3/sharp/mrite-core/claude.exe）
if (Test-Path $unpacked) {
  Write-Host "[5/5] 补齐原生模块 app.asar.unpacked -> app ..."
  robocopy $unpacked $appDir /E /NFL /NDL /NJH /NJS /NC /NS | Out-Null
} else {
  Write-Host "[5/5] 未找到 app.asar.unpacked（跳过）" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "完成 ✅  已改造成开发版（无登录 / 无激活码）。" -ForegroundColor Green
Write-Host "  应用目录 : $appDir"
Write-Host "  原档备份 : $bak"
Write-Host "  现在启动 $AppRoot\Mrite.exe 即可（使用 %APPDATA%\MriteUltra-2.6.13 数据）。"
Write-Host "  想用独立数据目录 + DevTools："
Write-Host "    electron.exe `"$appDir`" --dev-profile --dev   → %APPDATA%\MriteUltra-2.6.13-dev"
Write-Host "  开发版安装包（Setup.exe）额外在 app 目录里放了 dev-profile.flag，"
Write-Host "  双击 Mrite.exe 即用 -dev 数据目录；本补丁不含该标记。"
Write-Host "  回滚：删除 app 目录，把 app.asar.original 改回 app.asar。"
