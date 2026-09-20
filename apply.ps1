# apply.ps1 — 一键把原版 Mrite 2.6.14 改造成开发版
# 用法：
#   powershell -ExecutionPolicy Bypass -File apply.ps1 -AppRoot "D:\Mrite2.6.13"
#   -AppRoot : Mrite 安装根目录（包含 Mrite.exe 与 resources\ 目录）
param(
  [Parameter(Mandatory=$true)]
  [string]$AppRoot,
  # 期望的原版版本号；解包后版本不一致时只警告不中断（可用 -Force 跳过检查）
  [string]$ExpectedVersion = '2.6.14',
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

# 3) 校验版本（补丁是按 2.6.14 源码结构制作的）
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
Write-Host "  回滚：删除 app 目录，把 app.asar.original 改回 app.asar。"
