// Mrite v2.6 — Claude 可执行文件解析
const path = require('path');
const fs = require('fs');

// ★ 新版 claude.exe（2.1.191+）依赖 bash（Git for Windows）执行命令，找不到 bash 时会启动失败——
//   但 Mrite 此前不注入、不检测 bash，只表现为「模型无响应/卡住」。这里负责探测本机可用的 Git Bash 目录，
//   供 buildEffectivePath 注入到 agent PATH，以及供运行前检测/错误映射给出明确提示。
let _gitBashDirsCache = null; // 会话内缓存：探测一次即可，安装 Git 后重启软件再探测
function resolveGitBashDirs() {
  if (_gitBashDirsCache) return _gitBashDirsCache;
  const dirs = [];
  try {
    if (process.platform !== 'win32') { _gitBashDirsCache = []; return []; }
    // ★ Mrite_env 里可能内置了 Git Bash（零安装），优先命中——若 Mrite 把 MinGit 打进 Mrite_env/git，
    //   这里无需用户装 Git 就能让 claude.exe 有 bash。
    let appEnvDir = '';
    try { const a = require('../../env/assets'); appEnvDir = (a.getAppEnvDir && a.getAppEnvDir()) || ''; } catch (_) {}
    const appEnvGit = appEnvDir ? [
      path.join(appEnvDir, 'git', 'bin'),
      path.join(appEnvDir, 'git', 'usr', 'bin'),
      path.join(appEnvDir, 'Git', 'bin'),
      path.join(appEnvDir, 'Git', 'usr', 'bin'),
      path.join(appEnvDir, 'bin'),
    ] : [];
    // 常见 Git for Windows bash 所在目录（免清单靠 ProgramFiles/LocalAppData 逐级扫）
    const roots = [
      ...appEnvGit,
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin'),
      path.join(process.env['ProgramW6432'] || 'C:\\Program Files', 'Git', 'bin'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin'),
    ];
    for (const d of roots) {
      try { if (d && fs.existsSync(path.join(d, 'bash.exe')) && dirs.indexOf(d) < 0) dirs.push(d); } catch (_) {}
    }
    // 已挂在系统 PATH、且其下确实有 bash.exe 的目录（命中即收录，去重——即便 Git 未装成默认目录也能命中）
    const p = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
    for (const d of p) {
      try { if (d && /git/i.test(d) && fs.existsSync(path.join(d, 'bash.exe')) && dirs.indexOf(d) < 0) dirs.push(d); } catch (_) {}
    }
  } catch (_) {}
  _gitBashDirsCache = dirs;
  return dirs;
}

// ★ claude.exe 需要「bash（Git for Windows）**或** PowerShell 7（pwsh）」其一作为 shell。多数用户 Windows 自带的是 PowerShell 5.1
//   （powershell.exe），claude 要的是 pwsh 7（PowerShell 7+），故单独探测。命中任一个，claude 就有可用的 shell。
//   优先级：内置 Mrite_env/pwsh > 用户自己的 pwsh。内置版本与求解引擎同包验证，跨电脑最稳定。
let _pwshPath = null; // null=未探测；''=没找到；非空=找到的可执行文件路径
function resolvePwshPath() {
  if (_pwshPath !== null) return _pwshPath;
  let found = '';
  try {
    if (process.platform !== 'win32') { _pwshPath = ''; return ''; }
    // ① 内置 Mrite_env/pwsh/pwsh.exe（随软件发布，必须优先）
    try {
      const a = require('../../env/assets');
      const envDir = a.getAppEnvDir && a.getAppEnvDir();
      if (envDir) {
        const bp = path.join(envDir, 'pwsh', 'pwsh.exe');
        if (fs.existsSync(bp)) found = bp;
      }
    } catch (_) {}
    // ② 用户自己的 pwsh（安装在常见位置）
    const roots = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7-preview', 'pwsh.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'pwsh.exe'),
    ];
    if (!found) {
      for (const c of roots) { try { if (c && fs.existsSync(c)) { found = c; break; } } catch (_) {} }
    }
    // ③ 用户自己的 pwsh（挂在系统 PATH）
    if (!found) {
      const p = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
      for (const d of p) { try { if (d && fs.existsSync(path.join(d, 'pwsh.exe'))) { found = path.join(d, 'pwsh.exe'); break; } } catch (_) {} }
    }
  } catch (_) {}
  _pwshPath = found;
  return found;
}

// 返回 pwsh 来源：'user'（用户自己的）| 'bundled'（Mrite_env 内置）| ''（没有）
function resolvePwshSource() {
  const p = resolvePwshPath();
  if (!p) return '';
  try {
    const a = require('../../env/assets');
    const envDir = a.getAppEnvDir && a.getAppEnvDir();
    const bundledRoot = envDir ? path.join(envDir, 'pwsh').toLowerCase() : '';
    if (bundledRoot && p.toLowerCase().indexOf(bundledRoot) === 0) return 'bundled';
  } catch (_) {}
  return 'user';
}

function getClaudePlatformPackagePrefixes() {
  return ['@anthropic-ai/claude-agent-sdk-win32-', '@anthropic-ai/claude-code-win32-'];
}

function getClaudePreferredArchSuffixes() {
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch;
  return [arch];
}

function pushExistingClaudeBinariesFromDir(baseDir, exeName, candidates) {
  try {
    if (!baseDir || !fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) return;
    const prefixes = getClaudePlatformPackagePrefixes();
    const preferred = getClaudePreferredArchSuffixes();
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const matches = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const scopedName = `@anthropic-ai/${entry.name}`;
      if (!prefixes.some(prefix => scopedName.startsWith(prefix))) continue;
      const exe = path.join(baseDir, entry.name, exeName);
      if (!fs.existsSync(exe)) continue;
      matches.push({ exe, rank: preferred.some(suffix => scopedName.endsWith(suffix)) ? 0 : 1 });
    }
    matches.sort((a, b) => a.rank - b.rank);
    matches.forEach(match => candidates.push(match.exe));
  } catch {}
}

function collectClaudeExecutableCandidates() {
  const exeName = 'claude.exe';
  const candidates = [], seen = new Set();
  const prefixes = getClaudePlatformPackagePrefixes();
  const suffixes = getClaudePreferredArchSuffixes();
  const packageNames = [], packageFolderNames = [];

  const pushCandidate = (candidate) => {
    if (!candidate || typeof candidate !== 'string') return;
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      const scopedName = prefix + suffix;
      packageNames.push(scopedName);
      packageFolderNames.push(scopedName.replace(/^@anthropic-ai\//, ''));
    }
  }

  // ★ 跨设备（P0-1）：loader 重定向 resourcesPath 到临时目录，claude.exe 仍在真实
  //   resources/app.asar.unpacked。MRITE_REAL_RESOURCES 由 loader 注入为真实 resources 目录。
  const realResources = process.env.MRITE_REAL_RESOURCES || '';
  const resourceRoots = [];
  if (process.resourcesPath) resourceRoots.push(process.resourcesPath);
  if (realResources) resourceRoots.push(realResources);
  if (process.execPath) resourceRoots.push(path.join(path.dirname(process.execPath), 'resources'));

  for (const root of resourceRoots) {
    for (const pkg of packageFolderNames) {
      [
        path.join(root, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'node_modules', pkg, exeName),
        path.join(root, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', pkg, exeName),
        path.join(root, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', pkg, exeName),
        path.join(root, 'app.asar.unpacked', 'node_modules', pkg, exeName),
        path.join(root, 'app', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'node_modules', pkg, exeName),
        path.join(root, 'app', 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', pkg, exeName),
        path.join(root, 'app', 'node_modules', '@anthropic-ai', pkg, exeName),
        path.join(root, 'app', 'node_modules', pkg, exeName)
      ].forEach(pushCandidate);
    }
  }

  for (const pkg of packageNames) {
    try {
      const resolved = require.resolve(`${pkg}/${exeName}`);
      pushCandidate(resolved);
      if (resolved.includes('.asar')) pushCandidate(resolved.replace('.asar', '.asar.unpacked'));
    } catch {}
  }

  if (__dirname.includes('.asar')) {
    for (const pkg of packageFolderNames) {
      [
        path.join(__dirname.replace('.asar', '.asar.unpacked'), '..', '..', 'node_modules', '@anthropic-ai', pkg, exeName),
        path.join(__dirname.replace('.asar', '.asar.unpacked'), '..', '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'node_modules', pkg, exeName),
        path.join(__dirname.replace('.asar', '.asar.unpacked'), '..', '..', 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', pkg, exeName)
      ].forEach(pushCandidate);
    }
  }

  return candidates;
}

function resolveClaudeCodeExecutable() {
  const exeName = 'claude.exe';
  const candidates = [];

  // ★ 收集所有候选来源（此前 pushExisting 的候选被丢弃、未参与遍历，导致打包版找不到 claude.exe）
  const realResources = process.env.MRITE_REAL_RESOURCES || '';
  const scanRoots = [];
  if (process.resourcesPath) scanRoots.push(process.resourcesPath);
  if (realResources) scanRoots.push(realResources);
  if (process.execPath) scanRoots.push(path.join(path.dirname(process.execPath), 'resources'));
  for (const root of scanRoots) {
    pushExistingClaudeBinariesFromDir(path.join(root, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'node_modules', '@anthropic-ai'), exeName, candidates);
    pushExistingClaudeBinariesFromDir(path.join(root, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', '@anthropic-ai'), exeName, candidates);
    // ★ 目录模式（resources\app 目录、没有 app.asar.unpacked）：原生依赖就在 app\node_modules 下，
    //   形如 <root>\app\node_modules\@anthropic-ai\claude-agent-sdk\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe
    //   （require.resolve 因包的 exports 限制拿不到该子路径，必须按目录扫描）
    pushExistingClaudeBinariesFromDir(path.join(root, 'app', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'node_modules', '@anthropic-ai'), exeName, candidates);
    pushExistingClaudeBinariesFromDir(path.join(root, 'app', 'node_modules', '@anthropic-ai'), exeName, candidates);
  }
  collectClaudeExecutableCandidates().forEach(c => { if (c && candidates.indexOf(c) < 0) candidates.push(c); });

  // ★ 逐个检查，返回第一个存在的 claude.exe
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes('.asar') && !candidate.includes('.asar.unpacked')) continue;
    try { if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  return null;
}

function getClaudeExecutableDiagnostics() {
  const exeName = 'claude.exe';
  const bits = [
    `platform=${process.platform}`, `arch=${process.arch}`,
    `resourcesPath=${process.resourcesPath || ''}`, `dirname=${__dirname}`,
  ];
  if (process.resourcesPath) {
    const roots = [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'node_modules', '@anthropic-ai'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', '@anthropic-ai'),
    ];
    for (const root of roots) {
      try {
        const names = fs.existsSync(root) ? fs.readdirSync(root).filter(name => name.includes('claude')) : [];
        bits.push(`${root} => ${names.join(',') || 'empty/missing'}`);
      } catch (e) { bits.push(`${root} => ${e.message}`); }
    }
  }
  bits.push(`exe=${exeName}`);
  return bits.join(' | ');
}

function getSolverExecutableProbeResult() {
  const candidates = collectClaudeExecutableCandidates();
  const candidateStatuses = candidates.map(candidate => {
    const item = { path: candidate, insideAsarArchive: candidate.includes('.asar') && !candidate.includes('.asar.unpacked') };
    try {
      if (!fs.existsSync(candidate)) { item.status = 'missing'; return item; }
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) { item.status = 'not_file'; return item; }
      item.status = 'ok'; item.size = stat.size;
    } catch (e) { item.status = 'error'; item.error = e.message; }
    return item;
  });
  const resolvedExecutable = resolveClaudeCodeExecutable();
  const pwshPath = resolvePwshPath();
  const pwshSource = resolvePwshSource();
  const bashDirs = resolveGitBashDirs();
  const executableSource = resolvedExecutable && (
    resolvedExecutable.includes('app.asar.unpacked') ||
    resolvedExecutable.toLowerCase().includes(path.join('node_modules', '@anthropic-ai').toLowerCase())
  ) ? 'bundled' : (resolvedExecutable ? 'external' : '');
  const preferredShell = pwshPath && pwshSource === 'bundled'
    ? { type: 'pwsh', path: pwshPath, source: 'bundled' }
    : (bashDirs.length
      ? { type: 'bash', path: path.join(bashDirs[0], 'bash.exe'), source: 'user' }
      : (pwshPath ? { type: 'pwsh', path: pwshPath, source: pwshSource || 'user' } : null));
  return {
    platform: process.platform, arch: process.arch,
    resourcesPath: process.resourcesPath || '', dirname: __dirname,
    packagedAsarRuntime: isPackagedAsarRuntime(),
    resolvedExecutable,
    executableSource,
    executableName: 'claude.exe',
    // ★ bash / pwsh（PowerShell 7）可用性：claude.exe 依赖「bash 或 pwsh 其一」作为 shell，缺失任一即启动失败、
    //   表现为「模型无响应/卡住」，需显式暴露给运行前检测/错误映射。
    bash: { found: bashDirs.length > 0, dirs: bashDirs },
    pwsh: { found: !!pwshPath, path: pwshPath, source: pwshSource },
    preferredShell,
    // hasShell=bash 或 pwsh 任一存在；实际运行优先使用内置 pwsh。
    hasShell: bashDirs.length > 0 || !!pwshPath,
    diagnostics: getClaudeExecutableDiagnostics(),
    candidateStatuses,
  };
}

function isPackagedAsarRuntime() {
  return __dirname.includes('.asar') || Boolean(process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'app.asar')));
}

module.exports = {
  resolveClaudeCodeExecutable, collectClaudeExecutableCandidates,
  getClaudeExecutableDiagnostics, getSolverExecutableProbeResult,
  resolveGitBashDirs, resolvePwshPath, resolvePwshSource,
  isPackagedAsarRuntime,
};
