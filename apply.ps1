# apply.ps1 — 一键把原版 Mrite 2.6.13 改造成开发版
# 用法：
#   powershell -ExecutionPolicy Bypass -File apply.ps1 -AppRoot "D:\Mrite2.6.13"
#   -AppRoot : Mrite 安装根目录（包含 Mrite.exe 与 resources\ 目录）
param(
  [Parameter(Mandatory=$true)]
  [string]$AppRoot
)

$ErrorActionPreference = 'Stop'

$resources = Join-Path $AppRoot 'resources'
$asar      = Join-Path $resources 'app.asar'
$unpacked  = Join-Path $resources 'app.asar.unpacked'
$appDir    = Join-Path $resources 'app'
$patchDir  = Join-Path $PSScriptRoot 'patch'

if (-not (Test-Path $asar)) {
  Write-Host "[错误] 找不到 $asar" -ForegroundColor Red
  Write-Host "       请确认 -AppRoot 指向 Mrite 安装根目录（包含 Mrite.exe）。" -ForegroundColor Red
  exit 1
}

# 1) 备份原归档（只做一次；若已备份则直接移除 app.asar 让位给目录）
$bak = "$asar.bak"
if (Test-Path $bak) {
  Write-Host "[1/4] 已存在备份 $bak，移除 app.asar ..."
  Remove-Item $asar -Force
} else {
  Write-Host "[1/4] 备份 app.asar -> app.asar.bak"
  Rename-Item $asar $bak
}

# 2) 解包
if (-not (Test-Path $appDir)) {
  Write-Host "[2/4] 解包 $bak -> $appDir（需要 npx/node）"
  npx --yes @electron/asar extract $bak $appDir
  if ($LASTEXITCODE -ne 0) { Write-Host "[错误] 解包失败" -ForegroundColor Red; exit 1 }
} else {
  Write-Host "[2/4] $appDir 已存在，跳过解包"
}

# 3) 覆盖补丁
Write-Host "[3/4] 覆盖补丁文件..."
Copy-Item (Join-Path $patchDir 'src\services\dev-unlock.js') (Join-Path $appDir 'src\services\dev-unlock.js') -Force
Copy-Item (Join-Path $patchDir 'src\core\bootstrap.js')      (Join-Path $appDir 'src\core\bootstrap.js')      -Force
Copy-Item (Join-Path $patchDir 'renderer\dev-unlock.js')     (Join-Path $appDir 'renderer\dev-unlock.js')     -Force
Copy-Item (Join-Path $patchDir 'renderer\index.html')        (Join-Path $appDir 'renderer\index.html')        -Force

# 4) 补齐原生模块（better-sqlite3/sharp/mrite-core/claude.exe）
if (Test-Path $unpacked) {
  Write-Host "[4/4] 补齐原生模块 app.asar.unpacked -> app ..."
  robocopy $unpacked $appDir /E /NFL /NDL /NJH /NJS /NC /NS | Out-Null
} else {
  Write-Host "[4/4] 未找到 app.asar.unpacked（跳过）" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "完成 ✅  已改造成开发版（无登录 / 无激活码）。" -ForegroundColor Green
Write-Host "  应用目录 : $appDir"
Write-Host "  原档备份 : $bak"
Write-Host "  现在启动 $AppRoot\Mrite.exe 即可。"
Write-Host "  回滚：删除 app 目录，把 app.asar.bak 改回 app.asar。"
