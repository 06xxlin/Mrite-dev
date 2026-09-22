// Mrite v2.6 — 规则库服务（三层结构：common 公共 / solve 求解库 / paper 论文模板库）
//
// 顶层目录（项目内可见、可维护；打包后随应用分发并种入 userData）：
//   <rootDir>/rules-library/
//     common/主引导.md（求解流程主规则，注入prompt，不复制到工作区）
//     common/题目/读题规则.md（读题阶段规则，注入）
//     common/数据/读数据规则.md（读数据阶段规则，注入）
//     common/extensions/*（外挂规则：扩展组件）
//     solve/<方案名>/{求解规范.md, 求解计划模板.md, modules/}  内置方案，注入prompt
//     solve/用户-<名称>/{求解规范.md, 求解计划模板.md}  用户创建的方案，注入prompt
//     paper/{rules.md 共享全局约束} + paper/system/{main/<比赛>.tex 或 main/<比赛>/<比赛>.tex+资源目录, cls, fonts, sections/<章节>/<变体>/(+subs#), default.template.json}
//     paper/custom/{cls,fonts,cover + <名>/sections + template.json}  用户模板库（封面/摘要/格式复用系统）
//   外部外挂：
//     external/（index.md / solve-intensity.md / 01-solving/…）——由 loader 单独注入
//
// dev：rootDir = 项目根 → rules-library/ 直接就是项目里可见、可编辑的源；
// 打包：rootDir = userData → 首启把内置 rules-library 种到 userData/rules-library（用户上传写这里）。
//   ★ 目录模式（resources\app 目录、无 app.asar）取 resources\app\rules-library；
//     asar 模式取 resources\app.asar\rules-library。见 resolveBundledRulesDir()。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SOLVE = 'Mrite内置';
const DEFAULT_PAPER = '高教社杯';

// paper 库仅一个物理文件夹：system/（所有模板共用，含系统默认变体 + 用户自建“用户-*”变体）
//   不再有 custom/；用户模板 = templates.json 里的命名组成（main + 每章选某个变体）。
const PAPER_BUILTIN_DIRS = ['system'];

function createRulesLibrary(rootDir) {
  const baseDir = path.join(rootDir, 'rules-library');
  const commonDir = path.join(baseDir, 'common');
  const solveDir = path.join(baseDir, 'solve');
  const paperDir = path.join(baseDir, 'paper');
  const extDir = path.join(baseDir, 'external');
  const systemPaperDir = path.join(paperDir, 'system'); // ★ 唯一物理模板库（主文件/sections/cls/fonts）
  // ★ v4 单一库：用户自建变体直接写进 system/sections/NN.标题/用户-*/，与系统默认变体同库同构，无独立 custom 库。
  //   userPaperDir 保留为 system 的别名，供旧的用户模板读写函数继续落到唯一库里；用户模板的「命名组成」存 templates.json。
  const userPaperDir = systemPaperDir;


  // LaTeX 编译产物：装配到工作区时一律过滤，避免污染工作区 / 覆盖用户编译结果
  const COMPILE_JUNK = ['.aux', '.log', '.out', '.synctex.gz', '.fls', '.fdb_latexmk', '.bbl', '.blg', '.toc', '.lof', '.lot', '.idx', '.ilg', '.nav', '.snm', '.vrb'];
  function isCompileJunk(name) {
    const n = String(name || '').toLowerCase();
    return COMPILE_JUNK.some(ext => n.endsWith(ext));
  }

  // 逐文件复制（兼容 asar 内 src：读字节写目标）
  function copyDirSafe(src, dst) {
    if (!fs.existsSync(src)) return false;
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const item of fs.readdirSync(src, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      if (!item.isDirectory() && isCompileJunk(item.name)) continue; // ★ 过滤 LaTeX 编译产物
      const s = path.join(src, item.name), d = path.join(dst, item.name);
      if (item.isDirectory()) copyDirSafe(s, d);
      else {
        if (!fs.existsSync(path.dirname(d))) fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
      }
    }
    return true;
  }
  function copyFileSafe(src, dst) {
    if (!fs.existsSync(src)) return false;
    if (!fs.existsSync(path.dirname(dst))) fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return true;
  }

  // ★ v2.6: 复制用户模板到工作区时——不复制 .md 规则文件（规则走 prompt 注入）
  //   规则文件：论文章节规范.md / 规则.md / desc.txt / 读题规则.md / 读数据规则.md / 求解规范.md / 求解计划模板.md / 主规则.md
  const RULE_MD_NAMES = new Set(['论文章节规范.md', '规则.md', 'desc.txt', '读题规则.md', '读数据规则.md', '求解规范.md', '求解计划模板.md', '主规则.md', 'index.md']);
  function isRuleMd(name) { return RULE_MD_NAMES.has(String(name || '').trim()); }
  function copyDirSafeNoMd(src, dst) {
    if (!fs.existsSync(src)) return false;
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const item of fs.readdirSync(src, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      if (!item.isDirectory() && isCompileJunk(item.name)) continue;
      if (!item.isDirectory() && isRuleMd(item.name)) continue; // ★ 跳过规则 .md
      const s = path.join(src, item.name), d = path.join(dst, item.name);
      if (item.isDirectory()) copyDirSafeNoMd(s, d);
      else {
        if (!fs.existsSync(path.dirname(d))) fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
      }
    }
    return true;
  }

  // ★ v2.6: 用户论文模板路径辅助：value="用户-名称" → paper/custom/名称/
  function userPaperPath(value) {
    const name = String(value || '').startsWith(USER_PREFIX)
      ? String(value).slice(USER_PREFIX.length)
      : String(value || '');
    return path.join(userPaperDir, name);
  }

  function getCommonRulesDir() { return commonDir; }
  function getExternalRulesDir() { return extDir; }

  // ★ 求解方案列表：统一从 solve/ 目录读取，按 USER_PREFIX 区分内置/用户
  //   返回 { name: 显示名, value: 目录名, source: builtin|user }
  function listSolveSchemes() {
    const result = [];
    if (fs.existsSync(solveDir)) {
      fs.readdirSync(solveDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('待命名-')) // 跳过新建未完成留下的「待命名-*」临时目录，避免显示成规则
        .forEach(d => {
          if (d.name.startsWith(USER_PREFIX)) {
            result.push({ name: d.name.slice(USER_PREFIX.length), value: d.name, source: 'user' });
          } else {
            result.push({ name: d.name, value: d.name, source: 'builtin' });
          }
        });
    }
    return result;
  }
  // ★ 求解方案兜底：DB / 渲染层可能存着一个已经不存在的方案名——内置方案被下线（如已删除的
  //   `Mrite绘图专精`），或用户把自建的「用户-xxx」删了。原值直接用会两头出问题：
  //   ① 建工作区时 `assembleWorkspace` 报「求解规则「…」不存在」，任务起不来；
  //   ② 启动注入时更隐蔽——`collectRuleMarkdown` 扫不到目录只会返回空数组，**求解规则整套静默消失**，
  //      任务照跑但 AI 看不到任何约束。
  //   统一出口：原值存在就用原值 → 否则退回内置方案 `Mrite内置` → 连内置都没有再退到第一个可用方案；
  //   一个都没有才保留原值返回，由上层照常报错（此时是规则库真的坏了，不该假装成功）。
  function resolveSolveScheme(name) {
    const wanted = String(name == null ? '' : name).trim() || DEFAULT_SOLVE;
    const exists = n => !!n && fs.existsSync(path.join(solveDir, n));
    if (exists(wanted)) return { scheme: wanted, fellBack: false };
    if (exists(DEFAULT_SOLVE)) return { scheme: DEFAULT_SOLVE, fellBack: true, missing: wanted };
    const first = listSolveSchemes()[0];
    if (first) return { scheme: first.value, fellBack: true, missing: wanted };
    return { scheme: wanted, fellBack: false };
  }

  // ★ 新建求解规则时以内置「Mrite内置」为起点：把内置规则的内容整份拷进新建目录，用户在副本上改
  //   （副本保存后带「用户-」前缀 → 可右键重命名/删除；内置本体仍只读）
  function seedSolveFromBuiltin(destDir) {
    const src = path.join(solveDir, 'Mrite内置');
    if (!fs.existsSync(src)) return { ok: false, error: '内置求解规则缺失' };
    try { copyDirSafe(src, destDir); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  // 主文件条目兼容两种形态：
  //   1) main/<比赛>.tex（历史单文件）；
  //   2) main/<比赛>/<比赛>.tex（带封面图片等同级资源的文件夹）。
  // 文件夹内优先找同名 .tex，其次 main.tex / 论文.tex，最后取按名称排序的第一个 .tex。
  function resolveMainEntry(mainDir, name) {
    const n = String(name || '').trim();
    if (!n || n === '.' || n === '..' || /[\\/\0]/.test(n)) return null;
    const legacyFile = path.join(mainDir, n + '.tex');
    if (fs.existsSync(legacyFile) && fs.statSync(legacyFile).isFile()) {
      return { name: n, file: legacyFile, dir: mainDir, bundled: false };
    }
    const bundleDir = path.join(mainDir, n);
    if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) return null;
    const preferred = [n + '.tex', 'main.tex', '论文.tex'];
    for (const fileName of preferred) {
      const candidate = path.join(bundleDir, fileName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { name: n, file: candidate, dir: bundleDir, bundled: true };
      }
    }
    const fallback = fs.readdirSync(bundleDir, { withFileTypes: true })
      .filter(x => x.isFile() && /\.tex$/i.test(x.name) && !x.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))[0];
    return fallback ? { name: n, file: path.join(bundleDir, fallback.name), dir: bundleDir, bundled: true } : null;
  }

  function listMainEntryNames(mainDir) {
    if (!fs.existsSync(mainDir)) return [];
    const names = [];
    const seen = new Set();
    for (const item of fs.readdirSync(mainDir, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      const name = item.isFile() && /\.tex$/i.test(item.name)
        ? item.name.replace(/\.tex$/i, '')
        : (item.isDirectory() ? item.name : '');
      if (!name || seen.has(name) || !resolveMainEntry(mainDir, name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  }

  function copyMainEntryAssets(entry, dstDir) {
    if (!entry || !entry.bundled || !fs.existsSync(entry.dir)) return;
    const mainAbs = path.resolve(entry.file);
    for (const item of fs.readdirSync(entry.dir, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      const src = path.join(entry.dir, item.name);
      if (!item.isDirectory() && path.resolve(src) === mainAbs) continue;
      if (!item.isDirectory() && isCompileJunk(item.name)) continue;
      const dst = path.join(dstDir, item.name);
      if (item.isDirectory()) copyDirSafe(src, dst);
      else copyFileSafe(src, dst);
    }
  }

  // ★ v2.7 两库结构：
  //   内置 = paper/system/main/<比赛>.tex 或 paper/system/main/<比赛>/
  //   用户 = templates.json 里 source:'user' 的模板（命名组成：main + 每章选变体；物理变体在 system/sections，无独立 custom 库）
  function listPaperFormats() {
    const result = [];
    const systemDir = path.join(paperDir, 'system');
    const mainDir = path.join(systemDir, 'main');
    if (mainDir && fs.existsSync(mainDir)) {
      for (const name of listMainEntryNames(mainDir)) result.push({ name, value: name, source: 'builtin' });
    }
    // 用户模板 = templates.json 中 source:'user' 的组成（命名模板），不再有物理 custom 目录
    try {
      getTemplates().filter(t => t.source === 'user' && t.paperFormat).forEach(t => {
        result.push({ name: t.name, value: t.paperFormat, source: 'user' });
      });
    } catch (_) {}
    // ★ 把最常用的「高教社杯」排到第一个（默认比赛），其余保持原有顺序（稳定排序，不按名字打乱）
    result.sort((a, b) => {
      const aw = a.name === DEFAULT_PAPER ? 0 : 1;
      const bw = b.name === DEFAULT_PAPER ? 0 : 1;
      return aw - bw;
    });
    return result;
  }

  // ★ 内置规则版本号——规则内容变更时递增，触发 userData 全量同步
  //   2.6.5：删除图片质检与绘图库崩溃源（移除 scripts/、dataclasses 字体注入），
  //          旧版本 userData 缓存的内置模板必须被覆盖为当前干净版本，避免再次冲突。
  //   2.6.6：完全不继承旧数据——升级时强制清空 userData 旧规则库内置内容并整体重种（保留用户自建资产），
  //          彻底解决 2.5「完整调入」/ 旧2.6 残留导致的模板加载失败、路径错误、下载失败、导出word出错。
  const RULES_LIB_VERSION = '2.7.8'; // 2.7.6：页数规则收敛（默认 30 页目标 28~30 达标单点声明、去掉 pages.adjust、删华为杯 ≥50 页赛名例外）+ 研赛封面「题目」标签改隶书、研赛摘要放宽到两页、清掉模板写作提示词里的「研究生建模」套话。2.7.7：组合图布局放宽为 1×N / 2×N（禁 2×2 与 3 行以上）、允许不同类型混搭，_common.py 的 validate_subplots 同步放行。2.7.8：新增内置求解方案 Mrite2.6.13（冻结的旧规则集，与 Mrite内置 并列可选）。每次都强制 userData 重种——否则旧 _common.py 会继续拦截两行组合图，新增方案也不会出现在下拉里。
  function rulesVersionFile(dir) { return path.join(dir, '.rules-version'); }
  function readRulesVersion(dir) {
    try { return fs.readFileSync(rulesVersionFile(dir), 'utf-8').trim(); } catch { return ''; }
  }

  // 强制同步内置规则到 userData（覆盖旧文件，但保留用户自建内容）
  function forceSyncBuiltin(src, dst) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const item of fs.readdirSync(src, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue; // 跳过 .rules-version 等隐藏文件
      const s = path.join(src, item.name), d = path.join(dst, item.name);
      // 永远不覆盖用户数据
      if (item.name === 'templates.json' || item.name === 'user-templates') continue;
      if (item.name.startsWith(USER_PREFIX)) continue;
      if (item.name === 'custom') continue;
      if (item.isDirectory()) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        forceSyncBuiltin(s, d);
      } else {
        if (!fs.existsSync(path.dirname(d))) fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
      }
    }
  }

  // ★ 清理userData中asar已删除的旧内置文件（防止旧版残留：如 solve/Mrite内置/scripts/）
  //   只删内置内容，不删用户自建模板（带USER_PREFIX的目录）、templates.json、custom/、user-templates/
  function removeStaleItems(src, dst) {
    if (!fs.existsSync(dst)) return;
    for (const item of fs.readdirSync(dst, { withFileTypes: true })) {
      // 永远不删用户数据
      if (item.name === 'templates.json' || item.name === 'user-templates') continue;
      // 不删用户自建模板（带 USER_PREFIX 的目录）
      if (item.name.startsWith(USER_PREFIX)) continue;
      // paper/custom/ 是用户论文模板专属目录，不删
      if (item.name === 'custom') continue;
      const s = path.join(src, item.name), d = path.join(dst, item.name);
      if (item.isDirectory()) {
        if (!fs.existsSync(s)) {
          // asar里已无此目录 → 整个删除
          try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
        } else {
          // 递归清理子目录
          removeStaleItems(s, d);
        }
      } else {
        if (!fs.existsSync(s)) {
          // asar里已无此文件 → 删除
          try { fs.unlinkSync(d); } catch (_) {}
        }
      }
    }
  }

  // 只复制缺失项（★ P1-12: 不覆盖custom/用户已删除的内容，但缺失的内置规则要补种回来）
  function copyMissingSafe(src, dst) {
    if (!fs.existsSync(src)) return;
    for (const item of fs.readdirSync(src, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      const s = path.join(src, item.name), d = path.join(dst, item.name);
      if (item.isDirectory()) {
        if (!fs.existsSync(d)) {
          copyDirSafe(s, d);
        } else {
          copyMissingSafe(s, d);
        }
      } else {
        if (!fs.existsSync(d)) {
          if (!fs.existsSync(path.dirname(d))) fs.mkdirSync(path.dirname(d), { recursive: true });
          fs.copyFileSync(s, d);
        }
      }
    }
  }

  // ★ v2.6 完全不继承旧数据：识别旧版「完整调入」/ 旧版拼接式残留的规则库结构。
  //   只要检测到：① 缺少新版分层标志（paper/common + paper/contests）；或 ② paper/ 下存在非内置的旧比赛目录；
  //   或 ③ solve/<方案>/scripts 残留（v2.6.5 已清除），一律判定为需要强制清空重建，防止旧模板干扰新装配。
  function looksLegacyRulesLib(dst) {
    try {
      if (!fs.existsSync(dst)) return false;
      const pDir = path.join(dst, 'paper');
      const hasNewLayout = fs.existsSync(path.join(pDir, 'system', 'main'));
      let hasLegacy = false;
      if (fs.existsSync(pDir)) {
        for (const item of fs.readdirSync(pDir, { withFileTypes: true })) {
          if (item.isDirectory() && !PAPER_BUILTIN_DIRS.includes(item.name) && !item.name.startsWith(USER_PREFIX)) {
            hasLegacy = true; break;
          }
        }
      }
      if (!hasLegacy && fs.existsSync(path.join(dst, 'solve'))) {
        for (const item of fs.readdirSync(path.join(dst, 'solve'), { withFileTypes: true })) {
          if (item.isDirectory() && !item.name.startsWith('.') && !item.name.startsWith(USER_PREFIX)) {
            if (fs.existsSync(path.join(dst, 'solve', item.name, 'scripts'))) { hasLegacy = true; break; }
          }
        }
      }
      return !hasNewLayout || hasLegacy;
    } catch { return false; }
  }

  // ★ v2.6 完全不继承旧数据：清空 userData 旧规则库里的内置内容，只保留用户自建资产：
  //   templates.json / user-templates / 任意层级的 custom / 任意层级的「用户-*」目录。
  //   其余内置文件（含旧「完整调入」残留）全部删除，供随后 copyDirSafe 整体重种当前拼接式规则库。
  function wipeBuiltinKeepUser(dst) {
    if (!fs.existsSync(dst)) return;
    for (const item of fs.readdirSync(dst, { withFileTypes: true })) {
      const name = item.name;
      if (name.startsWith('.')) continue;                    // .rules-version 等隐藏文件保留（稍后重写）
      if (name === 'templates.json' || name === 'user-templates' || name === 'custom') continue; // 保留用户资产
      if (name.startsWith(USER_PREFIX)) continue;            // 保留用户自建模板目录
      const p = path.join(dst, name);
      if (item.isDirectory()) {
        // 深入内置目录内部，清掉其内置子项，但保留其内嵌的 custom/ 用户模板
        wipeBuiltinKeepUser(p);
        // 内置目录若已空则移除，避免旧空壳残留
        try { if (fs.readdirSync(p).length === 0) fs.rmdirSync(p); } catch (_) {}
      } else {
        try { fs.unlinkSync(p); } catch (_) {}
      }
    }
  }

  // ★ v2.6 模板注册清单「白名单兜底」：内置模板一律以当前包为准重建，只保留用户自建模板。
  //   背景：forceSyncBuiltin / removeStaleItems 都把 templates.json 当「用户资产」跳过不覆盖，
  //   导致旧版本 userData 残留的「旧内置模板条目」仍然指向已改版/已删除的模板 → 整个模板功能失效。
  //   本函数在每次打包态启动时重建 templates.json：
  //   ① 内置模板（source!=='user'）从当前包 bundled src/templates.json 派生，并剔除已随包移除的竞赛死条目；
  //   ② 用户自建模板（source==='user'）从旧 dst/templates.json 保留，按名称去重、不与内置重名。
  function reconcileBuiltinTemplates(src, dst) {
    try {
      // ① 当前包内置模板（权威来源）
      let builtin = [];
      const srcTpl = path.join(src, 'templates.json');
      if (fs.existsSync(srcTpl)) {
        try {
          const t = JSON.parse(fs.readFileSync(srcTpl, 'utf-8'));
          if (Array.isArray(t.templates)) builtin = t.templates.filter(x => x && x.source !== 'user');
        } catch (_) {}
      }
      // 剔除内置里指向「本包已移除竞赛文件」的死条目（来源包 paper/system/main/ 实时扫描）
      const contestsDir = path.join(src, 'paper', 'system', 'main');
      const contestsSet = new Set(listMainEntryNames(contestsDir));
      if (contestsSet.size > 0) {
        builtin = builtin.filter(x => {
          if (String(x && x.source || '') === 'builtin') return contestsSet.has(String(x.paperFormat || ''));
          return true;
        });
      }
      // ② 旧清单里的用户自建模板（保留），按名称去重
      const userTpl = [];
      const seenUser = new Set();
      const dstTpl = path.join(dst, 'templates.json');
      if (fs.existsSync(dstTpl)) {
        try {
          const t = JSON.parse(fs.readFileSync(dstTpl, 'utf-8'));
          if (Array.isArray(t.templates)) {
            for (const x of t.templates) {
              if (x && x.source === 'user') {
                const n = String(x.name || '');
                if (n && !seenUser.has(n)) { seenUser.add(n); userTpl.push(x); }
              }
            }
          }
        } catch (_) {}
      }
      // 合并：内置优先，同名用户模板不重复
      const builtinNames = new Set(builtin.map(x => String(x.name || '')));
      const finalList = builtin.concat(userTpl.filter(x => !builtinNames.has(String(x.name || ''))));
      writeTextFile(path.join(dst, 'templates.json'), JSON.stringify({ templates: finalList }, null, 2));
      return finalList;
    } catch (e) { console.warn('Mrite: 模板清单白名单重建失败:', e.message); return null; }
  }

  // ★ 内置规则库来源探测（按「权威优先」顺序）：
  //   ① asar 模式：resources/app.asar/rules-library、resources/app.asar.unpacked/rules-library
  //      （官方原版就是这个：模板打包在 app.asar 内部）
  //   ② 目录模式：resources/app/rules-library —— ★ 开发版安装包是这种（没有 app.asar）。
  //      原版只探测 ①，目录模式两个候选都不存在 → 打包态永远找不到内置库，
  //      userData 里只建出空目录 → 界面「没有模板」
  //   ③ MRITE_REAL_RESOURCES 下的同两种（loader 重定向 resourcesPath 到临时目录时）
  //   ④ app.getAppPath()/rules-library、__dirname/../../rules-library 兜底
  function bundledRulesCandidates() {
    const list = [];
    const res = process.resourcesPath || '';
    const realRes = process.env.MRITE_REAL_RESOURCES || '';
    for (const r of [res, realRes]) {
      if (!r) continue;
      list.push(path.join(r, 'app.asar', 'rules-library'));
      list.push(path.join(r, 'app.asar.unpacked', 'rules-library'));
      list.push(path.join(r, 'app', 'rules-library')); // ★ 目录模式
    }
    try { if (app && typeof app.getAppPath === 'function') list.push(path.join(app.getAppPath(), 'rules-library')); } catch (_) {}
    list.push(path.join(__dirname, '..', '..', 'rules-library')); // src/services → app 根
    return list.filter(Boolean);
  }
  function resolveBundledRulesDir() {
    for (const c of bundledRulesCandidates()) {
      try { if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c; } catch (_) {}
    }
    return '';
  }

  // 确保库目录存在；打包态从内置 rules-library 种入 userData/rules-library
  function ensureLibraries() {
    try {
      if (app && app.isPackaged) {
        const src = resolveBundledRulesDir();
        if (src) {
          console.log('[rules-library] 内置规则库来源:', src);
          if (!fs.existsSync(baseDir)) {
            copyDirSafe(src, baseDir);
            // ★ 首次种入也走一遍白名单重建：保证 templates.json 只含当前包真实存在的比赛
            reconcileBuiltinTemplates(src, baseDir);
          } else {
            // ★ v2.6.9: 每次启动强制覆盖内置规则（用户规则经常改版，需以最新版本为准），
            //   不再依赖版本号判断。forceSyncBuiltin 覆盖内置文件但保留用户自建资产
            //   （templates.json / user-templates / custom / 用户-*）；removeStaleItems 清理
            //   asar 已删除的旧内置残留，防止旧模板干扰新装配。
            forceSyncBuiltin(src, baseDir);
            removeStaleItems(src, baseDir);
            // ★ v2.6: 模板注册清单白名单兜底——内置模板以当前包为准重建，只保留用户自建模板。
            //   必须在 forceSyncBuiltin/removeStaleItems 之后执行（它们已跳过 templates.json），
            //   修正旧 userData 残留的旧内置模板条目，避免新版模板识别失效。
            reconcileBuiltinTemplates(src, baseDir);
          }
        } else {
          // ★ 探测不到内置库时不再静默：模板下拉会空，日志里给出全部候选路径便于定位
          console.warn('Mrite: 未找到内置规则库，模板列表将为空。已探测:');
          for (const c of bundledRulesCandidates()) console.warn('  - ' + c);
        }
        // 写入当前版本标记
        try { fs.writeFileSync(rulesVersionFile(baseDir), RULES_LIB_VERSION, 'utf-8'); } catch (_) {}
      }
    } catch (e) { console.warn('Mrite: 规则库种子失败:', e.message); }
    for (const d of [commonDir, solveDir, paperDir, extDir]) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
    // ★ v2.6: paper/ 下结构目录确保存在（含custom）
    for (const sub of PAPER_BUILTIN_DIRS) {
      const p = path.join(paperDir, sub);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }
    // ★ v3: system/custom 基础模板子目录确保存在（5 部分：main/、fonts/、cls/、sections/；不再有 cover）
    for (const d of [path.join(userPaperDir, 'main'), path.join(userPaperDir, 'cls'), path.join(userPaperDir, 'fonts'), path.join(userPaperDir, 'sections'),
                     path.join(systemPaperDir, 'cls'), path.join(systemPaperDir, 'fonts'), path.join(systemPaperDir, 'main'), path.join(systemPaperDir, 'sections')]) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
    cleanupUnsavedTemplates();
    return { baseDir, commonDir, solveDir, paperDir, extDir, userTemplatesRoot: userTemplatesRoot() };
  }

  // ★ 未保存的临时模板与残留编译临时目录：启动时自动清理
  function cleanupUnsavedTemplates() {
    // ① 整个未保存模板临时区直接删除
    try { fs.rmSync(newTemplatesRoot(), { recursive: true, force: true }); } catch (_) {}
    // ② 清理残留的编译临时目录
    try {
      let ud = '';
      try { ud = require('electron').app.getPath('userData'); } catch (_) {}
      if (!ud) ud = require('os').homedir();
      const tmpRoot = path.join(ud, 'tmp');
      if (fs.existsSync(tmpRoot)) {
        for (const d of fs.readdirSync(tmpRoot, { withFileTypes: true })) {
          if (d.isDirectory() && d.name.startsWith('mrite-compile-')) {
            try { fs.rmSync(path.join(tmpRoot, d.name), { recursive: true, force: true }); } catch (_) {}
          }
        }
      }
    } catch (_) {}
    // ③ 清理 solve/ 与 paper/ 下残留的「待命名-*」孤儿临时目录（新建未保存就关闭造成的）
    for (const base of [solveDir, paperDir]) {
      try {
        if (!fs.existsSync(base)) continue;
        for (const d of fs.readdirSync(base, { withFileTypes: true })) {
          if (d.isDirectory() && d.name.startsWith('待命名-')) {
            try { fs.rmSync(path.join(base, d.name), { recursive: true, force: true }); } catch (_) {}
          }
        }
      } catch (_) {}
    }
  }

  // ── 模板预设（组合：名称 + 求解规则 + 论文；论文按赛名命名）──
  // source 字段：builtin=系统内置（网页端不显示）；user=用户自建（网页端只显示这些）
  function templatesPath() { return path.join(baseDir, 'templates.json'); }
  const USER_PREFIX = '用户-'; // 用户模板物化到 solve/paper 的目录前缀
  function userTemplatesRoot() { return path.join(baseDir, 'user-templates'); }
  function sanitizeDirName(raw) {
    const n = String(raw || '').trim();
    return n.replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || '未命名模板';
  }
  function readTextFile(p) { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } }
  function writeTextFile(p, content) {
    if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(content == null ? '' : content), 'utf-8');
  }

  function getTemplates() {
    try {
      const p = templatesPath();
      if (fs.existsSync(p)) {
        const t = JSON.parse(fs.readFileSync(p, 'utf-8'));
        // ★ 即使 templates 为空数组也返回（用户删光模板后不应再恢复默认）
        if (Array.isArray(t.templates)) return t.templates;
      }
    } catch (e) { console.warn('Mrite: templates.json 读取失败:', e.message); }
    // 兜底（仅 templates.json 缺失/损坏时）：由 paper 库派生
    return listPaperFormats().map(f => ({ name: f.name, solveScheme: DEFAULT_SOLVE, paperFormat: f.name }));
  }

  function listTemplates() {
    // ★ 校验每个模板引用的求解/论文规则是否仍存在（用户删过规则 → 标记，前端提示"已删除"）
    const schemeValues = new Set(listSolveSchemes().map(s => s.value));
    const formatValues = new Set(listPaperFormats().map(f => f.value));
    const list = getTemplates().map(t => {
      const out = Object.assign({}, t);
      out.solveMissing = !schemeValues.has(String(t.solveScheme || ''));
      out.paperMissing = !formatValues.has(String(t.paperFormat || ''));
      return out;
    });
    // ★ 展示顺序：把最常用的「高教社杯」模板排在第一；内置（builtin）模板优先，用户自建（user）模板排在下方；组内保持 templates.json 原顺序
    //   （ES2019+ Array.sort 稳定，组内相对顺序不变，不会按名字打乱）
    return list.sort((a, b) => {
      const aw = a.name === DEFAULT_PAPER ? 0 : 1;
      const bw = b.name === DEFAULT_PAPER ? 0 : 1;
      if (aw !== bw) return aw - bw;
      const au = a.source === 'user' ? 1 : 0;
      const bu = b.source === 'user' ? 1 : 0;
      return au - bu;
    });
  }

  // 校验模板：名称 + 求解规则 + 论文 齐全即可（论文按赛名命名，不强制主名绑定）
  function validateTemplate(tpl) {
    const name = tpl && tpl.name ? String(tpl.name).trim() : '';
    const solveScheme = (tpl && tpl.solveScheme) || DEFAULT_SOLVE;
    const paperFormat = (tpl && tpl.paperFormat) || '';
    if (!name || !paperFormat) return { ok: false, error: '模板信息不完整（需 名称/论文）' };
    // ★ 模板名称最多 7 个字（用码点计数，中文/emoji 都算 1）
    if ([...name].length > 7) return { ok: false, error: '模板名称最多 7 个字' };
    return { ok: true, template: { name, solveScheme, paperFormat, source: tpl.source || 'builtin', desc: (tpl.desc || '').slice(0, 200) } };
  }

  function saveTemplate(tpl) {
    const v = validateTemplate(tpl);
    if (!v.ok) return v;
    const list = getTemplates();
    const idx = list.findIndex(x => x.name === v.template.name);
    // ★ 保留既有 source/desc（网页端用户模板不会被此函数覆盖为 builtin）
    const prev = idx >= 0 ? list[idx] : null;
    // ★ 组合保存（save-template）只管理「名称+求解规则+模板格式」这个组合，绝不能把拼接器已保存的 composition
    //   摸掉——否则会出现「保存的好好的，回去看模板内容全没了」。更新时显式保留 composition/updatedAt。
    if (idx >= 0) {
      // 更新：保留既有 source（内置模板保持内置；用户模板保持 user）+ 既有 composition/updatedAt
      list[idx] = { ...v.template, source: prev.source || 'user', desc: v.template.desc || prev.desc || '', composition: prev.composition, updatedAt: prev.updatedAt };
    } else {
      // ★ 新建模板：桌面端创建的一律标记为 user（可删除）；仅 templates.json 预置的才是 builtin
      list.push({ ...v.template, source: 'user' });
    }
    try { fs.writeFileSync(templatesPath(), JSON.stringify({ templates: list }, null, 2), 'utf-8'); }
    catch (e) { return { ok: false, error: '写入 templates.json 失败: ' + e.message }; }
    return { ok: true, template: v.template };
  }

  // 删除模板（仅移除组合记录，不删除已生成的工作区目录）
  function deleteTemplate(name) {
    const n = String(name || '').trim();
    if (!n) return { ok: false, error: '缺少模板名称' };
    const list = getTemplates();
    const tpl = list.find(x => x.name === n);
    if (!tpl) return { ok: false, error: '模板不存在: ' + n };
    // ★ 系统内置模板（source:'builtin'）不可删除
    if (tpl.source === 'builtin') return { ok: false, error: '「' + n + '」是系统内置模板，不可删除' };
    const next = list.filter(x => x.name !== n);
    try { fs.writeFileSync(templatesPath(), JSON.stringify({ templates: next }, null, 2), 'utf-8'); }
    catch (e) { return { ok: false, error: '写入 templates.json 失败: ' + e.message }; }
    return { ok: true };
  }

  // ════════════════════════════════════════════
  // 用户模板（source:'user'）—— 网页端模板编辑器读写
  // 内容区：rules-library/user-templates/<名称>/
  //   求解规范.md、论文章节规范.md、论文.tex、format.cls、章节*.tex
  // 物化区（运行时 assembleWorkspace 直接从库目录装配，必须落盘）：
  //   solve/用户-<名称>/求解规范.md   →  工作区 求解/
  //   paper/用户-<名称>/论文章节规范.md+论文.tex+format.cls+*.tex → 工作区 论文/
  // templates.json 条目 {name, source:'user', solveScheme:'用户-<名称>', paperFormat:'用户-<名称>'}
  // ════════════════════════════════════════════
  function userSlug(name) { return USER_PREFIX + sanitizeDirName(name); }
  function userRoot(name) { return path.join(userTemplatesRoot(), sanitizeDirName(name)); }

  // 默认 LaTeX 骨架（无参考格式时保证 论文.tex / format.cls 存在）
  function defaultLatexFiles() {
    return [
      { name: 'format.cls', content: '\\NeedsTeXFormat{LaTeX2e}\n\\ProvidesClass{format}[Mrite user template]\n\\LoadClass[12pt]{ctexart}\n\\RequirePackage{amsmath,amssymb,geometry,graphicx,booktabs,multirow,enumitem}\n\\geometry{a4paper,top=2.5cm,bottom=2.5cm,left=3cm,right=3cm}\n\\endinput\n' },
      { name: '论文.tex', content: '\\documentclass{format}\n\\begin{document}\n\n%%% 在这里编写你的论文模板骨架：\n%%% \\section{问题重述} ... \\input{章节文件} ...\n\n\\end{document}\n' }
    ];
  }

  function ensureLatexPresent(files) {
    const list = Array.isArray(files) ? files.filter(f => f && f.name) : [];
    const def = defaultLatexFiles();
    const out = list.slice();
    // ★ CLS 由系统内置自动提供：即使已有 论文.tex，也始终补上默认 format.cls（缺则编译失败）
    if (!out.some(f => f.name === 'format.cls')) out.unshift(def[0]);
    if (!out.some(f => f.name === '论文.tex')) out.push(def[1]);
    return out;
  }

  // ★ 分体结构：从主文件 论文.tex 里解析 \input{X} / \include{X}，
  //   为每个被引用但尚未存在的章节生成空占位 .tex 文件（AI 运行时填充）。
  function autoSectionFiles(files) {
    const list = Array.isArray(files) ? files.filter(f => f && f.name) : [];
    const main = list.find(f => f.name === '论文.tex');
    if (!main || !main.content) return list;
    const re = /\\(?:input|include)\{([^}]+)\}/g;
    const refs = [];
    let m;
    while ((m = re.exec(main.content)) !== null) {
      let n = (m[1] || '').trim().replace(/\.tex$/i, '');
      if (n && !refs.includes(n)) refs.push(n);
    }
    for (const n of refs) {
      const fname = n + '.tex';
      if (!list.some(f => f.name === fname)) list.push({ name: fname, content: '' });
    }
    return list;
  }

  function writeUserContent(slug, tpl) {
    // 直接写入统一目录（solve/用户-<slug>/ 和 paper/custom/<slug>/）
    const solvePath = path.join(solveDir, userSlug(slug));
    if (!fs.existsSync(userPaperDir)) fs.mkdirSync(userPaperDir, { recursive: true });
    const paperPath = path.join(userPaperDir, sanitizeDirName(slug));
    writeTextFile(path.join(solvePath, '求解规范.md'), tpl.solveMd || '');
    // 复制内置求解计划模板
    const builtinPlan = path.join(solveDir, 'Mrite内置', '求解计划模板.md');
    if (fs.existsSync(builtinPlan)) {
      fs.copyFileSync(builtinPlan, path.join(solvePath, '求解计划模板.md'));
    }
    writeTextFile(path.join(paperPath, '论文章节规范.md'), tpl.paperMd || '');
    const latex = autoSectionFiles(ensureLatexPresent(tpl.latexFiles));
    for (const f of latex) {
      const safe = path.basename(f.name);
      if (safe === '.' || safe.includes('..')) continue;
      writeTextFile(path.join(paperPath, safe), f.content);
    }
    return latex;
  }

  // 物化到 solve/、paper/custom/（运行时装配用）
  function materializeUser(slug, solveMd, paperMd, latex) {
    const solvePath = path.join(solveDir, userSlug(slug));
    if (!fs.existsSync(userPaperDir)) fs.mkdirSync(userPaperDir, { recursive: true });
    const paperPath = path.join(userPaperDir, sanitizeDirName(slug));
    if (fs.existsSync(solvePath)) fs.rmSync(solvePath, { recursive: true, force: true });
    if (fs.existsSync(paperPath)) fs.rmSync(paperPath, { recursive: true, force: true });
    fs.mkdirSync(paperPath, { recursive: true });
    writeTextFile(path.join(solvePath, '求解规范.md'), solveMd || '');
    // 复制内置求解计划模板
    const builtinPlan2 = path.join(solveDir, 'Mrite内置', '求解计划模板.md');
    if (fs.existsSync(builtinPlan2)) {
      fs.copyFileSync(builtinPlan2, path.join(solvePath, '求解计划模板.md'));
    }
    writeTextFile(path.join(paperPath, '论文章节规范.md'), paperMd || '');
    for (const f of latex) {
      const safe = path.basename(f.name);
      if (safe === '.' || safe.includes('..')) continue;
      writeTextFile(path.join(paperPath, safe), f.content);
    }
  }

  function listUserTemplates() {
    return getTemplates().filter(t => t.source === 'user');
  }

  // 新建用户模板；重名（含内置）拒绝
  function createUserTemplate(input) {
    const name = input && input.name ? String(input.name).trim() : '';
    if (!name) return { ok: false, error: '模板名称不能为空' };
    if ([...name].length > 7) return { ok: false, error: '模板名称最多 7 个字' };
    if (getTemplates().some(t => t.name === name)) return { ok: false, error: '模板名称已存在: ' + name };
    const slug = sanitizeDirName(name);
    writeUserContent(slug, input);
    const entry = {
      name, source: 'user',
      solveScheme: userSlug(slug), paperFormat: userSlug(slug),
      desc: (input.desc || '').slice(0, 200),
      updatedAt: new Date().toISOString(),
    };
    const list = getTemplates();
    list.push(entry);
    try { fs.writeFileSync(templatesPath(), JSON.stringify({ templates: list }, null, 2), 'utf-8'); }
    catch (e) { return { ok: false, error: '写入 templates.json 失败: ' + e.message }; }
    return { ok: true, template: { name, source: 'user', solveScheme: entry.solveScheme, paperFormat: entry.paperFormat } };
  }

  // 读取用户模板完整内容（含 latex 文件内容）
  function readUserTemplate(name) {
    const tpl = getTemplates().find(t => t.name === name && t.source === 'user');
    if (!tpl) return { ok: false, error: '用户模板不存在: ' + name };
    const solvePath = path.join(solveDir, userSlug(name));
    const paperPath = path.join(userPaperDir, sanitizeDirName(name));
    const latexFiles = [];
    if (fs.existsSync(paperPath)) {
      for (const f of fs.readdirSync(paperPath)) {
        if (f.startsWith('.') || f === '论文章节规范.md') continue;
        if (/\.(tex|cls|sty)$/i.test(f)) latexFiles.push({ name: f, content: readTextFile(path.join(paperPath, f)) });
      }
    }
    return {
      ok: true,
      template: {
        name, source: 'user',
        solveScheme: tpl.solveScheme, paperFormat: tpl.paperFormat,
        desc: tpl.desc || '',
        solveMd: readTextFile(path.join(solvePath, '求解规范.md')),
        paperMd: readTextFile(path.join(paperPath, '论文章节规范.md')),
        latexFiles, updatedAt: tpl.updatedAt || '',
      },
    };
  }

  // 更新用户模板内容
  function updateUserTemplate(name, input) {
    const tpl = getTemplates().find(t => t.name === name && t.source === 'user');
    if (!tpl) return { ok: false, error: '用户模板不存在: ' + name };
    const slug = sanitizeDirName(name);
    writeUserContent(slug, input);
    tpl.desc = (input.desc != null ? String(input.desc) : tpl.desc).slice(0, 200);
    tpl.updatedAt = new Date().toISOString();
    try { fs.writeFileSync(templatesPath(), JSON.stringify({ templates: getTemplates() }, null, 2), 'utf-8'); }
    catch (e) { return { ok: false, error: '写入 templates.json 失败: ' + e.message }; }
    return { ok: true };
  }

  // ════════════════════════════════════════════
  // 用户规则统一存储：直接存到 solve/ 和 paper/ 目录，用 USER_PREFIX 区分
  //   求解模板：rules-library/solve/用户-<名称>/求解规范.md
  //   论文模板：rules-library/paper/用户-<名称>/论文章节规范.md + *.tex/.cls/.sty
  // ════════════════════════════════════════════
  function userSolveRoot() { return solveDir; }
  function userPaperRoot() { return paperDir; }
  // ★ 未保存模板的临时区（userData/tmp/mrite-new-templates）：启动时整体清理
  function newTemplatesRoot() {
    let ud = '';
    try { ud = app.getPath('userData'); } catch (_) {}
    if (!ud) ud = require('os').homedir();
    return path.join(ud, 'tmp', 'mrite-new-templates');
  }
  function newSolveRoot() { return path.join(newTemplatesRoot(), 'solve'); }
  function newPaperRoot() { return path.join(newTemplatesRoot(), 'paper'); }

  function statMtime(p) { try { return fs.statSync(p).mtime.toISOString(); } catch { return ''; } }

  function listUserSolveTemplates() {
    if (!fs.existsSync(solveDir)) return [];
    return fs.readdirSync(solveDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith(USER_PREFIX))
      .map(d => {
        const dir = path.join(solveDir, d.name);
        const md = readTextFile(path.join(dir, '求解规范.md'));
        return { name: d.name.slice(USER_PREFIX.length), kind: 'solve', source: 'user', updatedAt: statMtime(dir), hasContent: !!md.trim(), desc: readTextFile(path.join(dir, 'desc.txt')) };
      })
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  function createUserSolveTemplate(input) {
    const name = input && input.name ? String(input.name).trim() : '';
    if (!name) return { ok: false, error: '模板名称不能为空' };
    const safe = sanitizeDirName(name);
    const slug = USER_PREFIX + safe;
    const dir = path.join(solveDir, slug);
    if (fs.existsSync(dir)) return { ok: false, error: '模板名称已存在: ' + name };
    fs.mkdirSync(dir, { recursive: true });
    writeTextFile(path.join(dir, '求解规范.md'), input.solveMd || '');
    // 复制内置求解计划模板
    const builtinPlan3 = path.join(solveDir, 'Mrite内置', '求解计划模板.md');
    if (fs.existsSync(builtinPlan3)) {
      fs.copyFileSync(builtinPlan3, path.join(dir, '求解计划模板.md'));
    }
    return { ok: true, template: { name: safe, kind: 'solve', source: 'user' } };
  }

  function readUserSolveTemplate(name) {
    const safe = sanitizeDirName(name);
    const dir = path.join(solveDir, USER_PREFIX + safe);
    if (!fs.existsSync(dir)) return { ok: false, error: '求解模板不存在: ' + name };
    return { ok: true, template: { name: safe, kind: 'solve', source: 'user', solveMd: readTextFile(path.join(dir, '求解规范.md')), desc: readTextFile(path.join(dir, 'desc.txt')), updatedAt: statMtime(dir) } };
  }

  function updateUserSolveTemplate(name, input) {
    const safe = sanitizeDirName(name);
    const dir = path.join(solveDir, USER_PREFIX + safe);
    if (!fs.existsSync(dir)) return { ok: false, error: '求解模板不存在: ' + name };
    writeTextFile(path.join(dir, '求解规范.md'), input.solveMd || '');
    return { ok: true };
  }

  // ★ P2-1: 删除规则后同步清理 templates.json 里的组合引用（指向已删物化名的组合模板一并移除）
  function pruneTemplatesBySlug(slug) {
    try {
      const p = templatesPath();
      if (!fs.existsSync(p)) return;
      const t = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!Array.isArray(t.templates)) return;
      const next = t.templates.filter(x => !(x.solveScheme === slug && x.paperFormat === slug));
      if (next.length !== t.templates.length) {
        fs.writeFileSync(p, JSON.stringify({ templates: next }, null, 2), 'utf-8');
      }
    } catch (_) {}
  }

  function deleteUserSolveTemplate(name) {
    const safe = sanitizeDirName(name);
    const dir = path.join(solveDir, USER_PREFIX + safe);
    if (!fs.existsSync(dir)) return { ok: false, error: '求解模板不存在: ' + name };
    fs.rmSync(dir, { recursive: true, force: true });
    pruneTemplatesBySlug(USER_PREFIX + safe);
    return { ok: true };
  }

  // ── 论文模板库（支持子目录 + 二进制字体）──
  const BINARY_EXTS = ['.ttf','.otf','.woff','.woff2','.png','.jpg','.jpeg','.gif','.ico','.pdf','.bin','.dat'];
  function isBinaryExt(name) {
    const n = String(name||'').split('.').pop().toLowerCase();
    return BINARY_EXTS.indexOf('.' + n) >= 0;
  }
  // 相对路径清洗（防目录穿越）
  function relToSafe(rel) {
    return String(rel||'').replace(/\\/g,'/').split('/').filter(s => s && s !== '.' && s !== '..').join('/');
  }
  // 递归读取目录内所有文件，二进制转 base64
  function readDirAll(dir, base, out) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.name.startsWith('.')) continue;
      const full = path.join(dir, f.name);
      const rel = base ? base + '/' + f.name : f.name;
      if (f.isDirectory()) readDirAll(full, rel, out);
      else out.push({ name: rel, binary: isBinaryExt(f.name), content: isBinaryExt(f.name) ? fs.readFileSync(full).toString('base64') : readTextFile(full) });
    }
  }
  // 把选中的 main 条目转换成可导入/下载的平铺文件集合：wrapper 固定命名为论文.tex，
  // 文件夹型条目的其它资源保持其相对路径（如 figures/logo.pdf）。
  function appendMainEntryFiles(mainEntry, latexFiles) {
    if (!mainEntry) return;
    const selected = [];
    if (mainEntry.bundled) readDirAll(mainEntry.dir, '', selected);
    else selected.push({ name: path.basename(mainEntry.file), binary: false, content: readTextFile(mainEntry.file) });
    const mainRel = mainEntry.bundled ? path.relative(mainEntry.dir, mainEntry.file).replace(/\\/g, '/') : path.basename(mainEntry.file);
    for (const item of selected) {
      const out = item.name === mainRel ? { name: '论文.tex', binary: false, content: readTextFile(mainEntry.file) } : item;
      const old = latexFiles.findIndex(x => x.name === out.name);
      if (old >= 0) latexFiles[old] = out; else latexFiles.push(out);
    }
  }
  // 写一组文件（文本 utf-8 / 二进制 base64），自动建子目录
  function writeLatexFiles(dir, latex) {
    for (const f of latex || []) {
      const rel = relToSafe(f.name);
      if (!rel) continue;
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (f.binary || isBinaryExt(f.name)) fs.writeFileSync(target, Buffer.from(String(f.content||''), 'base64'));
      else writeTextFile(target, f.content || '');
    }
  }
  // 清理目录中不在新文件集合里的文件（递归）
  function listUserPaperTemplates() {
    if (!fs.existsSync(userPaperDir)) return [];
    return fs.readdirSync(userPaperDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => {
        const dir = path.join(userPaperDir, d.name);
        const all = [];
        readDirAll(dir, '', all);
        return { name: d.name, kind: 'paper', source: 'user', updatedAt: statMtime(dir), fileCount: all.filter(x => x.name !== '论文章节规范.md' && x.name !== 'desc.txt').length, desc: readTextFile(path.join(dir, 'desc.txt')) };
      })
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  // 用户章节占位模板（新建章节无内容时播种一个干净的 \section 骨架）
  function userSectionPlaceholder(key) {
    return '\n% ═══ 用户章节「' + key + '」写作规则 —— 模板内嵌，AI 先读本文件再写 ═══\n' +
      '% 在本章节写入你的内容；% 注释即为写作指引，随模板自描述。\n' +
      '\\section{' + key + '}\n\n' +
      '...\n';
  }

  // ★ v2.7 用户论文模板 = template.json + sections/<章节>/<变体>/main.tex（可带子文件）
  //   input = { name, desc?, sections: [{ key, variant?, newpage?, files?:[{name,content}] }] }
  function createUserPaperTemplate(input) {
    const name = input && input.name ? String(input.name).trim() : '';
    if (!name) return { ok: false, error: '模板名称不能为空' };
    const safe = sanitizeDirName(name);
    if (!fs.existsSync(userPaperDir)) fs.mkdirSync(userPaperDir, { recursive: true });
    const dir = path.join(userPaperDir, safe);
    if (fs.existsSync(dir)) return { ok: false, error: '模板名称已存在: ' + name };
    fs.mkdirSync(dir, { recursive: true });
    const raw = Array.isArray(input.sections) ? input.sections : [];
    const sections = raw.map(s => ({ key: String(s.key || '未命名章节').trim(), variant: s.variant || 'default', newpage: !!s.newpage }));
    writeTextFile(path.join(dir, 'template.json'), JSON.stringify({ name: safe, sections }, null, 2));
    for (const s of raw) {
      const key = String(s.key || '未命名章节').trim();
      const variant = s.variant || 'default';
      const vdir = path.join(dir, 'sections', key, variant);
      fs.mkdirSync(vdir, { recursive: true });
      if (Array.isArray(s.files) && s.files.length) {
        for (const f of s.files) { if (f && f.name) writeTextFile(path.join(vdir, f.name), String(f.content || '')); }
      } else {
        writeTextFile(path.join(vdir, 'main.tex'), userSectionPlaceholder(key));
      }
    }
    if (input.desc) writeTextFile(path.join(dir, 'desc.txt'), String(input.desc));
    return { ok: true, template: { name: safe, kind: 'paper', source: 'user', sections } };
  }

  function readUserPaperTemplate(name) {
    const safe = sanitizeDirName(name);
    const dir = path.join(userPaperDir, safe);
    if (!fs.existsSync(dir)) return { ok: false, error: '论文模板不存在: ' + name };
    let sections = [];
    try { const j = JSON.parse(readTextFile(path.join(dir, 'template.json'))); if (Array.isArray(j.sections)) sections = j.sections; } catch (_) {}
    const readSec = sections.map(s => {
      const key = String(s.key || '未命名章节').trim();
      const variant = s.variant || 'default';
      const vdir = path.join(dir, 'sections', key, variant);
      const files = [];
      if (fs.existsSync(vdir)) readDirAll(vdir, '', files);
      return { key, variant, newpage: !!s.newpage, files: files.filter(x => x.name !== 'desc.txt') };
    });
    return { ok: true, template: { name: safe, kind: 'paper', source: 'user', sections: readSec, desc: readTextFile(path.join(dir, 'desc.txt')), updatedAt: statMtime(dir) } };
  }

  function updateUserPaperTemplate(name, input) {
    const safe = sanitizeDirName(name);
    const dir = path.join(userPaperDir, safe);
    if (!fs.existsSync(dir)) return { ok: false, error: '论文模板不存在: ' + name };
    const raw = Array.isArray(input.sections) ? input.sections : [];
    const sections = raw.map(s => ({ key: String(s.key || '未命名章节').trim(), variant: s.variant || 'default', newpage: !!s.newpage }));
    writeTextFile(path.join(dir, 'template.json'), JSON.stringify({ name: safe, sections }, null, 2));
    // 重写 sections
    try { fs.rmSync(path.join(dir, 'sections'), { recursive: true, force: true }); } catch (_) {}
    for (const s of raw) {
      const key = String(s.key || '未命名章节').trim();
      const variant = s.variant || 'default';
      const vdir = path.join(dir, 'sections', key, variant);
      fs.mkdirSync(vdir, { recursive: true });
      if (Array.isArray(s.files) && s.files.length) {
        for (const f of s.files) { if (f && f.name) writeTextFile(path.join(vdir, f.name), String(f.content || '')); }
      } else {
        writeTextFile(path.join(vdir, 'main.tex'), userSectionPlaceholder(key));
      }
    }
    if (input.desc) writeTextFile(path.join(dir, 'desc.txt'), String(input.desc));
    return { ok: true };
  }

  // ★ v4 拼接模式：按「NN.标题」编号顺序列出章节模块（key + 来源 + 变体递归 subs），供制作器分级选择。
  //   templateRoot = 模板根（system 或 custom/<名>），扫描 sections/NN.标题/<变体>/。
  //   key = NN. 后的标题（如“摘要”）；variants = 该章节的可选“变体文件夹”（如 模型建立求解（默认）），
  //   每个变体的 subs 递归 = 下一级“块文件夹”（如 问题#的模型建立与求解（默认）/），再下一级为 模型准备/分析/建立/求解…
  function listPaperSections(templateRoot) {
    const libRoot = templateRoot || systemPaperDir;
    const sectionsDir = path.join(libRoot, 'sections');
    if (!fs.existsSync(sectionsDir)) return [];
    const isUserRoot = templateRoot && templateRoot !== systemPaperDir;
    const src = isUserRoot ? 'user' : 'system';
    // ★ 统一递归扫描“块文件夹”：dir 下一层的每个子目录 = 一个块（可含 .tex + 可选 subs/）。
    //   返回 [{name, source, isDef, isUser, path, subs:[…递归]}]；path=从 sections/ 起的相对层级路径（供预览读 .tex）。
    function scanBlocks(dir, baseSegs) {
      if (!fs.existsSync(dir)) return [];
      const segs = baseSegs || [];
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(x => x.isDirectory() && !x.name.startsWith('.') && x.name !== 'subs')
        .map(b => {
          // ★ 来源按「变体末尾识别符」判定：以「（用户）」结尾=用户，否则系统；用户自建即使中间含「默认」也按末尾识别
          const isUser = /（用户）|\(用户\)$/.test(b.name);
          const isDef = /（默认）|\(默认\)|（default）|\(default\)$/.test(b.name);
          return {
            name: b.name,
            source: isUser ? 'user' : 'system',
            isDef: isDef,
            isUser: isUser,
            path: segs.concat([b.name]),
            subs: scanBlocks(path.join(dir, b.name, 'subs'), segs.concat([b.name, 'subs'])),
          };
        });
    }
    const chapters = scanNumberedSections(sectionsDir);
    return chapters.map(ch => ({
      key: ch.key,
      dir: ch.dir,
      variants: scanBlocks(path.join(sectionsDir, ch.dir), [ch.dir]),
    }));
  }

  // ★ v4 读某章节变体的内容文件 + 其 subs/ 下的子块（分级递归；按 NN.编号目录定位）。
  //   候选：[templateRoot]/sections/<NN.标题>/<变体>/ → system 同，templateRoot 缺省为 system。
  function variantDirFor(templateRoot, k, v) {
    function resolve(root) {
      const secDir = path.join(root, 'sections');
      if (!fs.existsSync(secDir)) return null;
      // 先试 key 作为直接目录名；否则按 NN.编号扫描定位到 key 对应的实际目录
      let target = path.join(secDir, k);
      if (!fs.existsSync(target)) {
        const found = scanNumberedSections(secDir).filter(s => s.key === k)[0];
        if (!found) return null;
        target = path.join(secDir, found.dir);
      }
      const vdir = path.join(target, v);
      return fs.existsSync(vdir) ? vdir : null;
    }
    if (templateRoot) { const p = resolve(templateRoot); if (p) return p; }
    return resolve(systemPaperDir);
  }

  function readContentEntry(key, variant, templateRoot) {
    const k = String(key || '').trim();
    const v = String(variant || 'default').trim();
    const vdir = variantDirFor(templateRoot, k, v);
    if (!vdir) return { ok: false, error: '未找到内容：' + k + '/' + v };
    // 内容文件：变体根第一个 .tex（无则空）；subs 子块按 NN 扫描
    let content = '';
    for (const f of fs.readdirSync(vdir, { withFileTypes: true })) {
      if (f.isFile() && /\.tex$/i.test(f.name)) { content = fs.readFileSync(path.join(vdir, f.name), 'utf-8'); break; }
    }
    const subs = scanNumberedSections(path.join(vdir, 'subs')).map(function(s) { return { name: s.key }; });
    return { ok: true, key: k, variant: v, content: content, subs: subs };
  }

  // ★ v3 读某内容块内的指定子文件（层级子块，如 5.1.1分析与准备）
  function readContentFile(key, variant, fileName, templateRoot) {
    const k = String(key || '').trim(), v = String(variant || 'default').trim(), fn = String(fileName || '').trim();
    const vdir = variantDirFor(templateRoot, k, v);
    if (vdir && fs.existsSync(vdir) && /\.tex$/i.test(fn)) {
      const c = path.join(vdir, fn);
      if (fs.existsSync(c)) return { ok: true, key: k, variant: v, name: fn, content: fs.readFileSync(c, 'utf-8') };
    }
    return { ok: false, error: '未找到子内容：' + k + '/' + v + '/' + fn };
  }

  // ★ v4 按「相对 system/sections/ 的层级路径」读某文件夹里唯一的 .tex（供组合器 2/3/4 列预览）。
  //   relPath = 层级段数组，如 ['05.模型的建立与求解','模型建立求解（默认）','subs','模型准备（默认）']；
  //   解析到目录后取其第一个 .tex（每个文件夹唯一一个 .tex）。templateRoot 缺省 system。
  function readPaperFile(relPath, templateRoot) {
    const segs = Array.isArray(relPath) ? relPath.map(s => String(s).trim()).filter(Boolean) : [];
    if (!segs.length) return { ok: false, error: '路径为空' };
    const root = templateRoot || systemPaperDir;
    let base = path.join(root, 'sections');
    for (const seg of segs) {
      if (seg === '..' || seg.includes('/') || seg.includes('\\') || seg.includes(':') || seg.includes('\0')) return { ok: false, error: '非法路径段' };
      base = path.join(base, seg);
    }
    // 目录：取其第一个 .tex；若 path 本身是 .tex 文件则直接读
    if (fs.existsSync(base) && fs.statSync(base).isFile() && /\.tex$/i.test(base)) {
      return { ok: true, path: segs.join('/'), content: fs.readFileSync(base, 'utf-8') };
    }
    if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
      for (const f of fs.readdirSync(base, { withFileTypes: true })) {
        if (f.isFile() && /\.tex$/i.test(f.name)) {
          return { ok: true, path: segs.join('/') + '/' + f.name, content: fs.readFileSync(path.join(base, f.name), 'utf-8') };
        }
      }
    }
    return { ok: false, error: '未找到 .tex：' + segs.join('/') };
  }

  // ★ v4 按「相对 system/sections/ 的层级路径」写某文件夹里的 .tex（预览区保存）。
  //   relPath 指到文件夹（取第一个 .tex）或直接到 .tex 文件；content 覆盖写入。
  function savePaperFile(relPath, content) {
    const segs = Array.isArray(relPath) ? relPath.map(s => String(s).trim()).filter(Boolean) : [];
    if (!segs.length) return { ok: false, error: '路径为空' };
    const root = systemPaperDir;
    let base = path.join(root, 'sections');
    for (const seg of segs) {
      if (seg === '..' || seg.includes('/') || seg.includes('\\') || seg.includes(':') || seg.includes('\0')) return { ok: false, error: '非法路径段' };
      base = path.join(base, seg);
    }
    // 定位目标文件：目录 → 第一个 .tex；直接 .tex → 本身
    let target = null;
    if (fs.existsSync(base) && fs.statSync(base).isFile() && /\.tex$/i.test(base)) target = base;
    else if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
      for (const f of fs.readdirSync(base, { withFileTypes: true })) {
        if (f.isFile() && /\.tex$/i.test(f.name)) { target = path.join(base, f.name); break; }
      }
    }
    if (!target) return { ok: false, error: '未找到可保存的 .tex：' + segs.join('/') };
    writeTextFile(target, String(content != null ? content : ''));
    return { ok: true, path: segs.join('/') };
  }

  // ★ 保存一个章节变体条目（新建章节/更新内容）——写入 templateRoot/sections/<章节>/<变体>/
  //   用户约定：新建 = 一个新文件夹（内容块名），内部放「同名 .tex」；若该层不为最末层级，再预建 subs/ 子块目录（下一级切换内容）。
  //   识别后缀（（用户）/（默认）等）只加在文件夹名上用于来源判定；.tex 文件名用去掉后缀的裸名。
  function saveContentEntry(key, variant, content, templateRoot) {
    const k = String(key || '').trim();
    if (!k) return { ok: false, error: '章节名不能为空' };
    const v = String(variant || 'default').trim();
    const dir = path.join(templateRoot || systemPaperDir, 'sections', k, v);
    fs.mkdirSync(dir, { recursive: true });
    // ★ .tex 文件名：去掉末尾来源识别符（（用户）/（默认）/…），与 copySectionRecursive 的剥离规则一致。
    const fileBase = String(v).replace(/（默认）$|（用户）$|（default）$|（custom）$|\(默认\)$|\(用户\)$|\(default\)$|\(custom\)$/, '') || k;
    writeTextFile(path.join(dir, fileBase + '.tex'), String(content != null ? content : ''));
    // ★ 非最末层级（一级标题变体下仍有二级/三级）：预建 subs/，供下一级切换内容存放。
    fs.mkdirSync(path.join(dir, 'subs'), { recursive: true });
    return { ok: true, key: k, variant: v };
  }

  // ★ 新建一个「章节空壳」文件夹（第1列）：sections/NN.标题/ —— 仅建目录，无 .tex、无 subs（用户约定：第1层不配套产生内容）。
  //   NN = 现有章节最大编号 + 1；标题 = 用户输入（章节本身无识别后缀）。
  function createPaperSection(title, templateRoot) {
    const t = String(title || '').trim();
    if (!t) return { ok: false, error: '章节名不能为空' };
    const root = templateRoot || systemPaperDir;
    const sectionsDir = path.join(root, 'sections');
    if (!fs.existsSync(sectionsDir)) fs.mkdirSync(sectionsDir, { recursive: true });
    let maxNum = 0;
    for (const d of fs.readdirSync(sectionsDir, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'subs') continue;
      const m = d.name.match(/^(\d+)\./);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    // ★ 重名校验：章节标题不能与已有章节重名（即使 NN 编号不同，也会出现两个同名标题导致区分/配置混乱）
    const dup = scanNumberedSections(sectionsDir).filter(s => s.key === t)[0];
    if (dup) return { ok: false, error: '已存在同名章节：' + t };
    const dirName = (maxNum + 1) + '.' + t;
    const dir = path.join(sectionsDir, dirName);
    if (fs.existsSync(dir)) return { ok: false, error: '章节已存在：' + dirName };
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, key: t, dir: dirName, path: [dirName] };
  }

  // ★ 在指定父级下新建一个「内容块」（第2/3/4列）：<父级路径>/<块名（用户）>/同名.tex + （可选）subs/。
  //   parentPath = 层级路径段数组（从 sections/ 起，如 ['05.模型的建立与求解','模型建立求解（默认）','subs']）；
  //   withSubs = 非最末层（还有下一级）才预建 subs/；blockName 自动补「（用户）」识别符；.tex 用去掉识别符的裸名。
  function savePaperBlock(parentPath, blockName, content, withSubs, templateRoot) {
    const segs = Array.isArray(parentPath) ? parentPath.map(s => String(s).trim()).filter(Boolean) : [];
    const name = String(blockName || '').trim();
    if (!name) return { ok: false, error: '内容块名不能为空' };
    if (!segs.length) return { ok: false, error: '父级路径为空' };
    const root = templateRoot || systemPaperDir;
    let base = path.join(root, 'sections');
    for (const seg of segs) {
      if (seg === '..' || seg.includes('/') || seg.includes('\\') || seg.includes(':') || seg.includes('\0')) return { ok: false, error: '非法路径段' };
      base = path.join(base, seg);
    }
    const folderName = /（用户）$|\(用户\)$|（默认）$|\(默认\)$|（default）$|\(default\)$/.test(name) ? name : name + '（用户）';
    const dir = path.join(base, folderName);
    if (fs.existsSync(dir)) return { ok: false, error: '内容块已存在：' + folderName };
    fs.mkdirSync(dir, { recursive: true });
    const fileBase = String(folderName).replace(/（默认）$|（用户）$|（default）$|（custom）$|\(默认\)$|\(用户\)$|\(default\)$|\(custom\)$/, '') || name;
    writeTextFile(path.join(dir, fileBase + '.tex'), String(content != null ? content : ''));
    if (withSubs) fs.mkdirSync(path.join(dir, 'subs'), { recursive: true });
    return { ok: true, name: folderName, folder: dir, path: segs.concat([folderName]), withSubs: !!withSubs };
  }

  // ★ 删除一个章节变体条目（仅用户自建可删；系统库不可删，避免破坏内置）。
  //   v4 单一库：用户自建「用户-*」变体也存于 system/sections/ 下，故不再以「root===systemPaperDir」整库拒绝，
  //   改为「末段名称以（用户）结尾才可删」的判定，并按 NN.标题 定位目录（用裸 key 会找不到编号目录）。
  function deleteContentEntry(key, variant, templateRoot) {
    const k = String(key || '').trim(), v = String(variant || 'default').trim();
    if (!k) return { ok: false, error: '章节名不能为空' };
    const root = templateRoot || systemPaperDir;
    const sectionsDir = path.join(root, 'sections');
    if (!fs.existsSync(sectionsDir)) return { ok: false, error: '未找到章节库' };
    const ch = scanNumberedSections(sectionsDir).filter(s => s.key === k)[0];
    if (!ch) return { ok: false, error: '未找到章节：' + k };
    const dir = path.join(sectionsDir, ch.dir, v);
    if (!fs.existsSync(dir)) return { ok: false, error: '内容不存在：' + k + '/' + v };
    if (!/(（用户）|\(用户\))$/.test(v)) return { ok: false, error: '仅用户自建内容可删除' };
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { return { ok: false, error: '删除失败' }; }
    pruneEmptyNodeDirs(root, [ch.dir]);
    return { ok: true };
  }

  // ★ 向上清理空目录：删除节点后，把因此变空的 subs/、用户变体目录、纯空章节目录一并清掉；
  //   遇到系统（（默认）/裸名）变体目录或非空目录即停，不误删系统内容。
  function pruneEmptyNodeDirs(root, parentSegs) {
    const sectionsDir = path.join(root, 'sections');
    const segs = (parentSegs || []).slice();
    while (segs.length) {
      const cur = path.join(sectionsDir, ...segs);
      if (!fs.existsSync(cur) || !fs.statSync(cur).isDirectory()) break;
      const name = segs[segs.length - 1];
      const isSysNode = name !== 'subs' && /（默认）|（default）|\(默认\)|\(default\)$/.test(name);
      if (isSysNode) break;                       // 系统（默认）变体外壳：保留
      if (fs.readdirSync(cur).length > 0) break;  // 非空即停
      try { fs.rmdirSync(cur); } catch (_) { break; }
      segs.pop();
    }
  }

  // ★ 级联删除一个「章节」：sections/NN.标题/ 整个文件夹（含所有变体与 subs 子树）。
  //   仅当该章节不含系统（默认）变体（=用户自建空壳或纯用户变体）才可删；系统内置章节保留。
  function deletePaperSection(key, templateRoot) {
    const k = String(key || '').trim();
    if (!k) return { ok: false, error: '章节名不能为空' };
    const root = templateRoot || systemPaperDir;
    const sectionsDir = path.join(root, 'sections');
    if (!fs.existsSync(sectionsDir)) return { ok: false, error: '未找到章节库' };
    const ch = scanNumberedSections(sectionsDir).filter(s => s.key === k)[0];
    if (!ch) return { ok: false, error: '未找到章节：' + k };
    if ((ch.variants || []).some(v => v.isDef)) return { ok: false, error: '系统内置章节不可删除' };
    const dir = path.join(sectionsDir, ch.dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { return { ok: false, error: '删除失败' }; }
    return { ok: true };
  }

  // ★ 级联删除任意「内容节点」：按相对 system/sections/ 的层级路径定位到文件夹，整体递归删除。
  //   仅末段名称以（用户）结尾（=用户自建内容块）才可删；系统（默认）与裸名模板子块均拒绝。
  //   删除后向上清理空目录（pruneEmptyNodeDirs）。
  function deletePaperNode(relPath, templateRoot) {
    const segs = Array.isArray(relPath) ? relPath.map(s => String(s).trim()).filter(Boolean) : [];
    if (!segs.length) return { ok: false, error: '路径为空' };
    const root = templateRoot || systemPaperDir;
    let base = path.join(root, 'sections');
    for (const seg of segs) {
      if (seg === '..' || seg.includes('/') || seg.includes('\\') || seg.includes(':') || seg.includes('\0')) return { ok: false, error: '非法路径段' };
      base = path.join(base, seg);
    }
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return { ok: false, error: '未找到内容：' + segs.join('/') };
    const name = segs[segs.length - 1];
    if (!/(（用户）|\(用户\))$/.test(name)) return { ok: false, error: '仅用户自建内容可删除' };
    try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) { return { ok: false, error: '删除失败' }; }
    pruneEmptyNodeDirs(root, segs.slice(0, -1));
    return { ok: true };
  }

  // ★ 重命名一个「章节」：改目录标题段，保留 NN 编号前缀（顺序由编号决定，不改编号）；仅用户自建章节可改。
  function renamePaperSection(key, newKey, templateRoot) {
    const k = String(key || '').trim(), nk = String(newKey || '').trim();
    if (!k) return { ok: false, error: '章节名不能为空' };
    if (!nk) return { ok: false, error: '新章节名不能为空' };
    const root = templateRoot || systemPaperDir;
    const sectionsDir = path.join(root, 'sections');
    if (!fs.existsSync(sectionsDir)) return { ok: false, error: '未找到章节库' };
    const ch = scanNumberedSections(sectionsDir).filter(s => s.key === k)[0];
    if (!ch) return { ok: false, error: '未找到章节：' + k };
    if ((ch.variants || []).some(v => v.isDef)) return { ok: false, error: '系统内置章节不可重命名' };
    const m = ch.dir.match(/^(\d+)\.(.+)$/);
    const newDirName = m ? (m[1] + '.' + nk) : nk;
    const oldDir = path.join(sectionsDir, ch.dir);
    const newDir = path.join(sectionsDir, newDirName);
    if (fs.existsSync(newDir)) return { ok: false, error: '已存在同名章节：' + newDirName };
    try { fs.renameSync(oldDir, newDir); } catch (e) { return { ok: false, error: '重命名失败：' + e.message }; }
    return { ok: true, key: nk, dir: newDirName };
  }

  // ★ 重命名一个「内容节点」：改文件夹名（保留（用户）来源后缀），并同步改内部同名 .tex 的裸名；仅用户自建节点可改。
  function renamePaperNode(relPath, newName, templateRoot) {
    const segs = Array.isArray(relPath) ? relPath.map(s => String(s).trim()).filter(Boolean) : [];
    const name = String(newName || '').trim();
    if (!segs.length) return { ok: false, error: '路径为空' };
    if (!name) return { ok: false, error: '名称不能为空' };
    const root = templateRoot || systemPaperDir;
    let base = path.join(root, 'sections');
    for (const seg of segs) {
      if (seg === '..' || seg.includes('/') || seg.includes('\\') || seg.includes(':') || seg.includes('\0')) return { ok: false, error: '非法路径段' };
      base = path.join(base, seg);
    }
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return { ok: false, error: '未找到内容：' + segs.join('/') };
    const oldName = segs[segs.length - 1];
    if (!/(（用户）|\(用户\))$/.test(oldName)) return { ok: false, error: '仅用户自建内容可重命名' };
    const newFolder = name + '（用户）';
    const newDir = path.join(path.dirname(base), newFolder);
    if (fs.existsSync(newDir)) return { ok: false, error: '已存在同名内容：' + newFolder };
    try { fs.renameSync(base, newDir); } catch (e) { return { ok: false, error: '重命名失败：' + e.message }; }
    // 同步改名内部同名 .tex（去掉来源后缀的裸名 → 新裸名）
    const oldBare = oldName.replace(/(（用户）|\(用户\))$/, '');
    const newTex = path.join(newDir, name + '.tex');
    const oldTex = path.join(newDir, oldBare + '.tex');
    if (fs.existsSync(oldTex) && oldTex !== newTex && !fs.existsSync(newTex)) {
      try { fs.renameSync(oldTex, newTex); } catch (_) {}
    }
    return { ok: true, name: newFolder, path: segs.slice(0, -1).concat([newFolder]) };
  }

  // ★ v4 拼接模式：保存一个用户论文模板 = 把「命名组成」写进 templates.json（main + 每章选变体，可递归）。
  //   物理变体全部在 system/sections/（含用户自建“用户-*”），无独立 custom/ 目录。系统内置/用户模板统一从该库装配。
  function saveUserPaperComposition(name, sections, main) {
    const n = String(name || '').trim();
    if (!n) return { ok: false, error: '模板名称不能为空' };
    if ([...n].length > 7) return { ok: false, error: '模板名称最多 7 个字' };
    // ★ 保护内置模板：用户保存的组成不能覆盖 source:'builtin' 的同名模板（否则国赛等内置会被盖掉）。
    const hitBuiltin = getTemplates().find(x => x.name === n && x.source === 'builtin');
    if (hitBuiltin) return { ok: false, error: '「' + n + '」是内置模板，不能覆盖，请换一个名称' };
    // ★ 级联自动调用：剔除 _sel === false 的子块（保留勾选的），其余保留；未标 _sel 的默认保留（全勾）。
    function filterSel(subs) {
      return (Array.isArray(subs) ? subs : [])
        .filter(s => (s && s._sel !== false))
        .map(s => ({
          key: String(s.key || '未命名章节').trim(), variant: s.variant || 'default', newpage: !!s.newpage,
          subs: s._sel !== undefined ? filterSel(s.subs) : (Array.isArray(s.subs) ? s.subs : undefined),
        }));
    }
    const clean = (Array.isArray(sections) ? sections : []).map(s => ({
      key: String(s.key || '未命名章节').trim(), variant: (s.variant == null ? null : s.variant), newpage: !!s.newpage,
      subs: (Array.isArray(s.subs) && s.subs.length) ? filterSel(s.subs) : undefined,
    }));
    const comp = { main: main || DEFAULT_PAPER, sections: clean };
    const list = getTemplates();
    const idx = list.findIndex(x => x.name === n);
    const entry = {
      name: n, source: 'user',
      solveScheme: DEFAULT_SOLVE, paperFormat: n,
      desc: String(name || '').trim(),
      composition: comp,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    try { fs.writeFileSync(templatesPath(), JSON.stringify({ templates: list }, null, 2), 'utf-8'); }
    catch (e) { return { ok: false, error: '写入 templates.json 失败: ' + e.message }; }
    return { ok: true, name: n, sections: clean, main: comp.main, copied: 0 };
  }

  // ★ v2.7 赛名专属默认覆盖（system/format-defaults.json）：内置比赛的章节组成统一来自
  //   default.template.json，但个别比赛某章默认写法不同，或整个章节不适用。
  //   本表按「赛名 → 章节 key → 变体名 | null」覆盖，避免为该比赛复制整份组成导致章节增删时两处漂移。
  function readFormatDefaults() {
    const p = path.join(systemPaperDir, 'format-defaults.json');
    try {
      if (!fs.existsSync(p)) return {};
      const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return (j && j.formats && typeof j.formats === 'object' && !Array.isArray(j.formats)) ? j.formats : {};
    } catch (e) { console.warn('Mrite: format-defaults.json 读取失败:', e.message); return {}; }
  }
  // 把覆盖表套到组成上，返回新对象（不改原组成）：
  //   变体名 = 换用该变体；null = 不装配该章节；没有配置 = 原样保留。
  function applyFormatDefaults(comp, paperFormat) {
    if (!comp || !Array.isArray(comp.sections)) return comp;
    const pf = String(paperFormat || '').replace(/^用户-/, '');
    const map = readFormatDefaults()[pf];
    if (!map || typeof map !== 'object' || Array.isArray(map)) return comp;
    const byKey = {};
    for (const s of scanNumberedSections(path.join(systemPaperDir, 'sections'))) byKey[s.key] = s;
    const kept = [];
    for (const s of comp.sections) {
      const key = String((s && s.key) || '');
      if (!Object.prototype.hasOwnProperty.call(map, key)) { kept.push(s); continue; }
      const want = map[key];
      if (want === null) continue;
      if (typeof want !== 'string' || !want.trim()) { kept.push(s); continue; }
      const sec = byKey[key];
      if (!sec || !(sec.variants || []).some(v => v.name === want)) {
        console.warn('Mrite: 「' + pf + '」章节「' + key + '」的默认变体「' + want + '」不存在，回退系统默认');
        kept.push(s);
        continue;
      }
      kept.push({ ...s, variant: want });
    }
    return { ...comp, sections: kept };
  }

  // ★ v2.7 读取一个「模板格式」的组成：
  //   用户 = templates.json 里带 composition 的条目（paperFormat 或 name 匹配）；
  //   内置 = system/default.template.json（再套 format-defaults.json 的赛名覆盖）。
  //   供右栏拼接器「打开用户/内置模板格式」时恢复已有组成。
  function getPaperComposition(paperFormat) {
    const pf = String(paperFormat || '').replace(/^用户-/, '') || '';
    const entry = getTemplates().find(t => t.composition && (String(t.paperFormat || '') === pf || String(t.name || '') === pf));
    if (entry && entry.composition) {
      const comp = entry.composition;
      return { ok: true, source: 'user', main: comp.main || pf,
        sections: (Array.isArray(comp.sections) ? comp.sections : []).map(s => ({ key: String(s.key || ''), variant: (s.variant == null ? null : s.variant), subs: s.subs })) };
    }
    try {
      const jp = path.join(systemPaperDir, 'default.template.json');
      if (fs.existsSync(jp)) {
        const comp = applyFormatDefaults(JSON.parse(fs.readFileSync(jp, 'utf-8')), pf);
        if (comp && Array.isArray(comp.sections)) {
          // ★ 系统模板：优先用「点击的赛名」作为主文件（与启动任务时的 assembleWorkspace 一致），
          //   单文件/文件夹型 main 均可；不存在时才回退到 default.template.json 的 main。
          let m = comp.main || pf;
          if (pf && resolveMainEntry(path.join(systemPaperDir, 'main'), pf)) m = pf;
          return { ok: true, source: 'builtin', main: m,
            sections: comp.sections.map(s => ({ key: String(s.key || ''), variant: s.variant || 'default', subs: s.subs })) };
        }
      }
    } catch (_) {}
    return { ok: false };
  }

  // ★ 上传 zip 解压后直接存到 paper/custom/ 目录
  function republishUserPaper(name) {
    // 已经在 paper/custom/<name>/ 中，无需额外操作
    return { ok: true };
  }

  function deleteUserPaperTemplate(name) {
    const safe = sanitizeDirName(name);
    const dir = path.join(userPaperDir, safe);
    if (!fs.existsSync(dir)) return { ok: false, error: '论文模板不存在: ' + name };
    fs.rmSync(dir, { recursive: true, force: true });
    pruneTemplatesBySlug(USER_PREFIX + safe);
    return { ok: true };
  }

  // ── 内置模板参考（网页端"从内置开始"复制用）──
  function listBuiltinSolveTemplates() {
    return listSolveSchemes().filter(s => s.source === 'builtin').map(s => ({
      name: s.name, kind: 'solve', source: 'builtin',
      solveMd: readTextFile(path.join(solveDir, s.value, '求解规范.md')),
    }));
  }
  // 列出内置论文模板：latexFiles = paper/common + paper/contests/<name>.tex(重命名为论文.tex)
  //   paperMd = paper/rules/论文章节规范.md（所有内置比赛共用同一份）
  function listBuiltinPaperTemplates() {
    const writingRulePath = path.join(paperDir, 'rules.md');
    const commonPaper = path.join(paperDir, 'system');
    return listPaperFormats().filter(f => f.source === 'builtin').map(f => {
      const latexFiles = [];
      // 1) common里所有 tex/cls/sty + 子目录 (fonts/)
      if (fs.existsSync(commonPaper)) {
        for (const x of fs.readdirSync(commonPaper, { withFileTypes: true })) {
          if (x.name.startsWith('.')) continue;
          const full = path.join(commonPaper, x.name);
          if (x.isDirectory()) {
            // fonts/ 等子目录：递归读取
            const sub = [];
            readDirAll(full, x.name, sub);
            sub.forEach(s => latexFiles.push(s));
          } else if (/\.(tex|cls|sty)$/i.test(x.name)) {
            latexFiles.push({ name: x.name, content: readTextFile(full) });
          }
        }
      }
      // 2) 主文件 wrapper + 所选条目的同级资源；wrapper 重命名为"论文.tex"。
      appendMainEntryFiles(resolveMainEntry(path.join(paperDir, 'system', 'main'), f.value), latexFiles);
      return {
        name: f.name, kind: 'paper', source: 'builtin',
        paperMd: readTextFile(writingRulePath),
        latexFiles,
      };
    });
  }

  // 读取内置模板内容（网页端"从内置开始"复制用）
  function readBuiltinTemplate(name) {
    const tpl = getTemplates().find(t => t.name === name && t.source !== 'user');
    if (!tpl) return { ok: false, error: '内置模板不存在: ' + name };
    const solveDirPath = path.join(solveDir, tpl.solveScheme || '');
    const paperFormat = tpl.paperFormat || '';
    // ★ v2.6: rules路径按内置/用户区分
    const writingRulePath = String(paperFormat).startsWith(USER_PREFIX)
      ? path.join(userPaperPath(paperFormat), '论文章节规范.md')
      : path.join(paperDir, 'rules.md');
    const commonPaper = path.join(paperDir, 'system');
    const latexFiles = [];
    // 1) common所有文件（含 fonts/ 子目录）
    if (fs.existsSync(commonPaper)) {
      readDirAll(commonPaper, '', latexFiles);
    }
    // 2) 用户选择的contests
    const isUserPaperBuiltin = !String(paperFormat).startsWith(USER_PREFIX);
    if (isUserPaperBuiltin) {
      appendMainEntryFiles(resolveMainEntry(path.join(paperDir, 'system', 'main'), paperFormat), latexFiles);
    } else {
      // 用户化的内置模板极少，兜底：从 paper/custom/<名>/ 读
      const paperDirPath = userPaperPath(paperFormat);
      if (fs.existsSync(paperDirPath)) {
        const all = [];
        readDirAll(paperDirPath, '', all);
        // 过滤 md 规则文件（latex 文件不含规则）
        for (const x of all) {
          if (x.name === '论文章节规范.md' || x.name === '规则.md') continue;
          latexFiles.push(x);
        }
      }
    }
    return {
      ok: true,
      template: {
        name, source: 'builtin',
        solveScheme: tpl.solveScheme, paperFormat: tpl.paperFormat,
        desc: tpl.desc || '',
        solveMd: readTextFile(path.join(solveDirPath, '求解规范.md')),
        paperMd: readTextFile(writingRulePath),
        latexFiles,
      },
    };
  }

  // 删除用户模板：移除 templates.json 条目 + 规则目录
  function deleteUserTemplate(name) {
    const n = String(name || '').trim();
    if (!n) return { ok: false, error: '缺少模板名称' };
    const tpl = getTemplates().find(t => t.name === n && t.source === 'user');
    const list = getTemplates().filter(t => !(t.name === n && t.source === 'user'));
    if (!tpl) return { ok: false, error: '用户模板不存在: ' + n };
    for (const p of [userRoot(n), path.join(solveDir, userSlug(n)), path.join(userPaperDir, sanitizeDirName(n))]) {
      try { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
    }
    try { fs.writeFileSync(templatesPath(), JSON.stringify({ templates: list }, null, 2), 'utf-8'); }
    catch (e) { return { ok: false, error: '写入 templates.json 失败: ' + e.message }; }
    return { ok: true };
  }

  // 校验文件夹是否为 Mrite 规则包（加密文件或标准规则文件）
  function isValidRulePackage(folderPath, kind) {
    if (!fs.existsSync(folderPath)) return false;
    const expected = kind === 'solve'
      ? ['求解规范.md', '求解计划模板.md', '主规则.md', 'index.md']
      : ['论文章节规范.md', 'format.cls', 'main.tex', '论文.tex', 'index.md'];
    for (const f of expected) { if (fs.existsSync(path.join(folderPath, f))) return true; }
    // 加密包：任意文件以 //MRITE: 开头
    try {
      for (const e of fs.readdirSync(folderPath, { withFileTypes: true })) {
        if (e.isFile() && !e.name.startsWith('.')) {
          const head = fs.readFileSync(path.join(folderPath, e.name), 'utf-8').slice(0, 32);
          if (head.startsWith('//MRITE:')) return true;
        }
      }
    } catch (_) {}
    return false;
  }

  // 导入求解规则：直接存到 solve/用户-<名>/
  function importSolveScheme(folderPath) {
    if (!folderPath) return { ok: false, error: '未选择文件夹' };
    const name = path.basename(folderPath);
    if (!name || name.startsWith('.')) return { ok: false, error: '无效的规则文件夹名称' };
    if (!isValidRulePackage(folderPath, 'solve')) return { ok: false, error: '不是有效的 Mrite 求解规则包（需含 求解规范.md / 求解计划模板.md，或为加密规则包）' };
    const safe = sanitizeDirName(name);
    const dir = path.join(solveDir, USER_PREFIX + safe);
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      copyDirSafe(folderPath, dir);
      // 用户模板缺 求解计划模板.md 时复制内置模板
      if (!fs.existsSync(path.join(dir, '求解计划模板.md'))) {
        const builtinTpl = path.join(solveDir, 'Mrite内置', '求解计划模板.md');
        if (fs.existsSync(builtinTpl)) {
          fs.copyFileSync(builtinTpl, path.join(dir, '求解计划模板.md'));
        }
      }
    } catch (e) { return { ok: false, error: '导入失败: ' + e.message }; }
    return { ok: true, name: safe, value: USER_PREFIX + safe };
  }

  // 导入论文格式：存到 paper/custom/<名>/（自包含目录）
  function importPaperFormat(folderPath) {
    if (!folderPath) return { ok: false, error: '未选择文件夹' };
    const name = path.basename(folderPath);
    if (!name || name.startsWith('.')) return { ok: false, error: '无效的规则文件夹名称' };
    if (!isValidRulePackage(folderPath, 'paper')) return { ok: false, error: '不是有效的 Mrite 论文格式包（需含 论文章节规范.md / .tex / format.cls，或为加密格式包）' };
    const safe = sanitizeDirName(name);
    if (!fs.existsSync(userPaperDir)) fs.mkdirSync(userPaperDir, { recursive: true });
    const dir = path.join(userPaperDir, safe);
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      copyDirSafe(folderPath, dir);
    } catch (e) { return { ok: false, error: '导入失败: ' + e.message }; }
    return { ok: true, name: safe, value: USER_PREFIX + safe };
  }

  // ★ v2.6 新装配流程：
  //   不复制任何规则 .md 到工作区（规则改为 prompt 构建阶段按需注入）；同时创建 题目/ 数据/ 求解/ 论文/ 四个空文件夹。

  // ★ 扫描「NN.标题」编号顺序的章节目录：返回按数字排序的 [{num, key, dir, variants:[{name,isDef,isUser,contentFile,subs}]}]。
  //   NN 前缀即固定顺序（外章节标题必须按此顺序来）；标题 = NN. 后的文字。
  //   统一形态：每一级都是「变体文件夹列表」；一个变体文件夹 = 一个块，含根目录 .tex（contentFile）+ 可选 subs/（下一级）。
  //   章节目录（sections/ 或某块）/subs 直接是一组「块文件夹」；每个块文件夹里按「（默认）/用户-*」再分变体。
  function scanNumberedSections(root, orderKeys) {
    // 块列表：root 下的每个子目录是一个「块」（如 00.摘要 或 模型建立求解（默认）下的 subs/问题#…（默认）/）
    if (!fs.existsSync(root)) return [];
    const order = (orderKeys || []).map(o => String(o).trim()).filter(Boolean);
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory() && !x.name.startsWith('.') && x.name !== 'subs');
    const out = [];
    for (const d of dirs) {
      const m = d.name.match(/^(\d+)\.\s*(.+)$/);
      const num = m ? parseInt(m[1], 10) : null;
      const key = m ? m[2].trim() : d.name;
      const blockDir = path.join(root, d.name);
      // 一个块里的变体：直接子目录（如 模型建立求解（默认））。每个变体=一个「块」：根 .tex + 可选 subs/
      const variants = [];
      const vdirs = fs.readdirSync(blockDir, { withFileTypes: true }).filter(x => x.isDirectory() && !x.name.startsWith('.') && x.name !== 'subs');
      for (const v of vdirs) {
        // ★ 只看名字末尾括号标记：默认(系统)/用户(用户)，用户自建不被误判
        const isDef = /（默认）|\(默认\)|（default）|\(default\)$/.test(v.name);
        const isUser = /（用户）|\(用户\)$/.test(v.name);
        const vdir = path.join(blockDir, v.name);
        let contentFile = '';
        for (const f of fs.readdirSync(vdir, { withFileTypes: true })) {
          if (f.isFile() && /\.tex$/i.test(f.name)) { contentFile = f.name; break; }
        }
        const subs = scanNumberedSections(path.join(vdir, 'subs'), order);
        variants.push({ name: v.name, isDef: isDef, isUser: isUser, contentFile: contentFile, subs: subs });
      }
      out.push({ num: num, key: key, dir: d.name, variants: variants });
    }
    // 排序：先按数字（NN 编号=外章节顺序），无数字的保持目录原序（准备/分析/建立/求解 天然顺序），
    //   若提供 orderKeys 再按该顺序兜底（大章节以目录编号为准）。
    out.sort((a, b) => {
      if (a.num != null && b.num != null) return a.num - b.num;
      if (a.num != null) return -1;
      if (b.num != null) return 1;
      const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1; if (bi >= 0) return 1;
      return 0; // 无编号、无 order：保持 readdir 原序
    });
    return out;
  }

  // ★ 复刻一个「章节」到 论文/（分级递归版，按文件的 NN 顺序 + 变体选择）。
  //   spec = {key, variant, subs:[递归]};  srcBase = 章节根（内置 system/sections 或 用户模板 sections）。
  //   把所选变体根目录的内容 .tex 复制为 <key>.tex，若含 % __SUBS__ 则注入本层 subs 的 \input；再对每个 sub 递归。
  // ★ 层级序号驱动 copy：chainNo = 当前块的层级序号（一级 "5"，二级 "5.1"，三级 "5.1.1"）。
  //   输出文件名 = chainNo + key（如 "5.模型的建立与求解"、"5.1问题一"、"5.1.1模型准备"）；
  //   父级 % __SUBS__ 自动注入 \input{<子块chainNo><子块key>.tex}，调用一律带序号。
  function copySectionRecursive(srcBase, spec, dstDir, problems, chainNo, depth) {
    const key = spec && spec.key ? String(spec.key).trim() : '';
    if (!key) return;
    const dep = depth || 0;
    // 定位章节目录：srcBase 下可能是「NN.标题」命名的文件夹，需按 key 找到实际目录
    let secDir = path.join(srcBase, key);
    let selectedVariant = spec.variant || '';
    if (!fs.existsSync(secDir)) {
      // 按 NN 前缀扫描定位（key 是标题，目录带 NN.）
      const found = scanNumberedSections(srcBase).filter(s => s.key === key)[0];
      if (found) { secDir = path.join(srcBase, found.dir); if (!selectedVariant) selectedVariant = found.variants.filter(v => v.isDef)[0] ? found.variants.filter(v => v.isDef)[0].name : (found.variants[0] ? found.variants[0].name : ''); }
    }
    if (!fs.existsSync(secDir)) { if (problems) problems.push('章节模块「' + key + '」缺失'); return; }
    // 选中变体：默认取（默认），否则取用户选中
    let variantDir = null;
    if (selectedVariant) {
      const vd = path.join(secDir, selectedVariant);
      if (fs.existsSync(vd)) variantDir = vd;
    }
    if (!variantDir) {
      // ★ 兼容「模板式块」：secDir 本身就是变体（根目录直接含 .tex + 可选 subs/）
      const selfTex = fs.existsSync(secDir) ? fs.readdirSync(secDir, { withFileTypes: true }).some(x => x.isFile() && /\.tex$/i.test(x.name)) : false;
      if (selfTex) {
        variantDir = secDir;
      } else {
        const defV = fs.existsSync(secDir) ? fs.readdirSync(secDir, { withFileTypes: true }).filter(x => x.isDirectory() && !x.name.startsWith('.') && /（默认）|\(默认\)|（default）|\(default\)/.test(x.name))[0] : null;
        variantDir = defV ? path.join(secDir, defV.name) : (!fs.existsSync(secDir) ? null : (fs.readdirSync(secDir, { withFileTypes: true }).filter(x => x.isDirectory() && !x.name.startsWith('.'))[0] ? path.join(secDir, fs.readdirSync(secDir, { withFileTypes: true }).filter(x => x.isDirectory() && !x.name.startsWith('.'))[0].name) : null));
      }
    }
    if (!variantDir || !fs.existsSync(variantDir)) { if (problems) problems.push('章节「' + key + '」无可用变体'); return; }

    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    const subSpecs = (spec.subs && spec.subs.length) ? spec.subs : [];
    // 复制变体根下的非 .tex 资源文件（subs/ 由递归展开）
    for (const item of fs.readdirSync(variantDir, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      if (item.name === 'subs') continue;
      const s = path.join(variantDir, item.name);
      if (item.isDirectory()) copyDirSafe(s, path.join(dstDir, item.name));
      else if (item.isFile() && !/\.tex$/i.test(item.name)) copyFileSafe(s, path.join(dstDir, item.name));
    }
    // ★ 级联自动调用：把每个子块的内容 .tex 复制为 <子块key>.tex，并在其 % __SUBS__ 注入它勾选的下一级。
    //   subSpecs 来自「勾选→组成」的级联树；若未提供 subSpecs，则按 subs/ 下 NN 编号顺序全取（默认全勾）。
    let subsHtml = '';
    const subDir = path.join(variantDir, 'subs');
    const orderedSubs = scanNumberedSections(subDir);
    const resolveSubs = subSpecs.length ? subSpecs : orderedSubs.map(o => ({ key: o.key, variant: (o.variants.filter(v => v.isDef)[0] || o.variants[0] || {}).name || '' }));
    const no = chainNo || '';
    for (let si = 0; si < resolveSubs.length; si++) {
      const subSec = resolveSubs[si];
      if (!subSec || !subSec.key) continue;
      // ★ 子块层级序号 = 父序号 + '.' + (seq+1)；递归复制，并取回其输出文件名，父级 build \input 列表
      const subNo = (no ? (no + '.') : '') + (si + 1);
      const childOut = copySectionRecursive(path.join(variantDir, 'subs'), { key: subSec.key, variant: subSec.variant, subs: subSec.subs }, dstDir, problems, subNo, dep + 1);
      if (subSec.newpage) subsHtml += '\\newpage\n';
      subsHtml += '\\input{' + childOut + '}\n';
    }
    // 主内容：变体根的内容 .tex → <key>.tex，注入 % __SUBS__（仅当有可解析的编号子块时替换；
    //   若变体有 subs/ 但是「模板+按问题实例化」形态（如 5.X.问题X），则保留 % __SUBS__ 占位交给 AI 按题目问数展开）
    let content = '';
    const contentSrc = path.join(variantDir, (function() { const f = fs.existsSync(variantDir) ? fs.readdirSync(variantDir, { withFileTypes: true }).filter(x => x.isFile() && /\.tex$/i.test(x.name))[0] : null; return f ? f.name : 'main.tex'; })());
    // ★ 输出文件名 = <层级序号>.<标题>；一级标题用 key，二级/三级用「内容文件名」（去掉（默认）/（用户）识别符）
    let baseName = key;
    if (contentSrc && dep > 0) { // 二级/三级子块用内容文件名（去识别符）；顶层一级用 key
      var bn = path.basename(contentSrc).replace(/\.tex$/i, '');
      bn = bn.replace(/（默认）$|（用户）$|（default）$|（custom）$|\(默认\)$|\(用户\)$|\(default\)$|\(custom\)$/, '');
      baseName = bn;
    }
    var outName = (chainNo || '') + '.' + baseName;
    if (fs.existsSync(contentSrc)) content = fs.readFileSync(contentSrc, 'utf-8');
    const hasSubsDir = fs.existsSync(subDir);
    content = content.replace(/^[ \t]*% __SUBS__[ \t]*$/gm, function() {
      if (subsHtml) return subsHtml.replace(/\n$/, '');
      if (hasSubsDir) return '';
      return '';
    });
    writeTextFile(path.join(dstDir, outName + '.tex'), content);
    return outName + '.tex';
  }

  // ★ v4 模板即规则：按「文件系统 NN.编号顺序 + 每章选变体」递归拼装工作区 论文/。
  //   统一只读 system 库（不再区分 custom 独立库）；外章节顺序 = sections/ 目录编号，内容可自定义（选变体）。
  //   内置/用户：main=库下 main/<比赛>.tex 或 main/<比赛>/（wrapper + 同级资源），
  //   产出 论文.tex + 主文件资源 + 各章 <key>.tex + format.cls + fonts/。
  function assembleWorkspace(workDir, opts) {
    // ★ 传进来的方案名可能已经不存在（见 resolveSolveScheme）→ 这里先兜底，别让一个过期目录名把任务挡在门外。
    const solvePicked = resolveSolveScheme((opts && opts.solveScheme) || DEFAULT_SOLVE);
    const solveScheme = solvePicked.scheme;
    const solveFallback = solvePicked.fellBack ? { from: solvePicked.missing, to: solveScheme } : null;
    if (solveFallback) console.warn('Mrite: 求解方案「' + solveFallback.from + '」已不存在，自动改用「' + solveFallback.to + '」');
    const paperFormat = (opts && opts.paperFormat) || DEFAULT_PAPER;
    const problems = [];

    const systemDir = path.join(paperDir, 'system');
    const commonGuide = path.join(commonDir, '主引导.md');
    const solveSrc = path.join(solveDir, solveScheme);

    // ── 资源定位：唯一物理库 = system（所有模板共用；用户模板只是 templates.json 里的「命名组成」） ──
    //   主文件=system/main/<赛名>.tex 或 system/main/<赛名>/<赛名>.tex；章节变体全部在 system/sections/NN.标题/<变体>/。
    //   builtin：主文件赛名=paperFormat（如 高教社杯），组成=system/default.template.json。
    //   user：组成=templates.json 里该模板的 composition {main, sections}；主文件=该组成 main（赛名）。
    const tplRoot = systemDir;
    let composition = null;
    const tplEntry = String(paperFormat).startsWith(USER_PREFIX) ? null : getTemplates().find(t => t.paperFormat === paperFormat);
    const isUserComposition = getTemplates().find(t => (t.composition) && (t.paperFormat === paperFormat || t.name === paperFormat));
    let mainName = paperFormat; // builtin 默认赛名
    if (opts.composition) {
      // ★ 下载「当前正在编辑/聚合」的组成时直接传入，覆盖从 templates.json 读取
      const c = Array.isArray(opts.composition) ? { main: opts.main, sections: opts.composition } : opts.composition;
      composition = { main: (c && c.main) || opts.main || DEFAULT_PAPER, sections: (c && Array.isArray(c.sections) ? c.sections : []) };
      mainName = composition.main;
    } else if (isUserComposition && isUserComposition.composition) {
      composition = isUserComposition.composition;
      mainName = composition.main || DEFAULT_PAPER;
    } else {
      // builtin：章节组成复用 system/default.template.json，再套赛名专属默认变体覆盖（format-defaults.json）；
      // 主文件优先采用当前选择的赛名。旧逻辑会被 default.template.json 的 main=高教社杯覆盖，
      // 导致选择其它比赛仍装配高教社杯 wrapper。
      const jp = path.join(systemDir, 'default.template.json');
      if (fs.existsSync(jp)) { try { composition = applyFormatDefaults(JSON.parse(fs.readFileSync(jp, 'utf-8')), paperFormat); } catch (_) {} }
      if (resolveMainEntry(path.join(systemDir, 'main'), paperFormat)) mainName = paperFormat;
      else if (composition && composition.main) mainName = composition.main || DEFAULT_PAPER;
    }
    // 主文件 wrapper：支持历史单文件，以及携带 figures/ 等资源的文件夹条目。
    const mainEntry = resolveMainEntry(path.join(systemDir, 'main'), mainName);
    const mainFilePath = mainEntry ? mainEntry.file : '';
    const clsSrc = path.join(systemDir, 'cls', 'format.cls');
    const fontsSrc = path.join(systemDir, 'fonts');
    const sectionRoot = path.join(systemDir, 'sections');

    // ── 校验 ──
    if (!mainFilePath || !fs.existsSync(mainFilePath)) problems.push('主文件（论文 wrapper）缺失');
    if (!fs.existsSync(clsSrc)) problems.push('论文格式文件缺失（format.cls）');
    if (!fs.existsSync(fontsSrc)) problems.push('字体目录缺失（fonts/）');
    if (!fs.existsSync(commonGuide)) problems.push('系统公共规则缺失（common/主引导.md）');
    if (!fs.existsSync(solveSrc)) problems.push('求解规则「' + solveScheme + '」不存在');
    if (!fs.existsSync(sectionRoot)) problems.push('章节目录缺失（sections/）');

    // 1) 确保 4 个空目录
    for (const d of ['题目', '数据', '求解', '论文']) {
      const p = path.join(workDir, d);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }
    const paperDst = path.join(workDir, '论文');

    // 2) 通用资源：format.cls + fonts/；文件夹型主文件的其它内容直接落到论文根目录，
    //    因而 figures/logo.pdf 等资源与最终 论文.tex 保持同级目录关系。
    copyFileSafe(clsSrc, path.join(paperDst, 'format.cls'));
    copyDirSafe(fontsSrc, path.join(paperDst, 'fonts'));
    copyMainEntryAssets(mainEntry, paperDst);

    // 3) 按「组成顺序」复刻章节 → 生成一级 \input 列表（变体按组成指定，缺省取「（默认）」）
    //    ★ 组成同时决定章节顺序与每章变体：论文章节先后 = 编辑器里拖后的顺序，不再固化目录 NN 号。
    //      每章输出文件仍按 NN 号命名（chainNo，如 "5.模型的建立与求解"），不改编号（避免打破 5.x 交叉引用）。
    //      无组成（残缺/旧数据）时回退目录 NN 扫描序。
    const orderedSections = scanNumberedSections(sectionRoot);
    const secByKey = {};
    for (const s of orderedSections) if (s && s.key) secByKey[s.key] = s;
    const compSections = (composition && Array.isArray(composition.sections)) ? composition.sections : null;
    const orderList = (compSections && compSections.length)
      ? compSections.filter(cs => cs && cs.key).map(cs => ({ key: cs.key, variant: cs.variant, subs: cs.subs }))
      : orderedSections.map(s => ({ key: s.key, variant: '', subs: undefined }));
    let body = '';
    for (const ord of orderList) {
      const sec = secByKey[ord.key];
      if (!sec) continue; // 组成里的章节在目录中不存在 → 跳过（copySectionRecursive 在发现缺失子块时记 problems）
      var chainNo = (sec.num != null) ? String(sec.num) : '';
      const spec = { key: sec.key, variant: ord.variant || ((sec.variants.filter(v => v.isDef)[0] || sec.variants[0] || {}).name || ''), subs: ord.subs };
      copySectionRecursive(sectionRoot, spec, paperDst, problems, chainNo);
      body += '\\input{' + chainNo + '.' + sec.key + '.tex}\n';
    }

    // 4) 组装 论文.tex：main wrapper 替换 __SECTIONS__（仅匹配独占一行的注释标记）
    let mainTex = fs.existsSync(mainFilePath) ? fs.readFileSync(mainFilePath, 'utf-8') : '';
    if (/% __SECTIONS__/.test(mainTex)) {
      mainTex = mainTex.replace(/^[ \t]*% __SECTIONS__[ \t]*$/gm, body.replace(/\n$/, ''));
    } else {
      mainTex += '\n' + body;
    }
    fs.writeFileSync(path.join(paperDst, '论文.tex'), mainTex, 'utf-8');

    // 5) 复制求解脚本
    const scriptsSrc = path.join(solveSrc, 'scripts');
    if (fs.existsSync(scriptsSrc)) copyDirSafe(scriptsSrc, path.join(workDir, '求解', 'scripts'));
    // 6) 播种 求解/_common.py（若不存在）
    const commonPySrc = path.join(solveSrc, '_common.py');
    const commonPyDst = path.join(workDir, '求解', '_common.py');
    if (!fs.existsSync(commonPySrc)) return { solveScheme, paperFormat, solveFallback, ok: problems.length === 0, error: problems.join('；') };
    if (!fs.existsSync(commonPyDst)) copyFileSafe(commonPySrc, commonPyDst);

    return { solveScheme, paperFormat, solveFallback, ok: problems.length === 0, error: problems.join('；') };
  }

  // ★ v2.6 模板说明：统一目录 rules-library/descriptions/<模板名>.md，按模板名读取
  //   说明文件是给用户在「模板说明」区快速了解比赛/结构/风格用的 Markdown 文档。
  function getTemplateDescription(name) {
    const n = String(name || '').trim();
    if (!n) return { ok: true, name: n, text: '' };
    try {
      const safe = sanitizeDirName(n);
      const descDirPath = path.join(baseDir, 'descriptions');
      const file = path.join(descDirPath, safe + '.md');
      if (fs.existsSync(file)) {
        const text = fs.readFileSync(file, 'utf-8');
        return { ok: true, name: n, text };
      }
      // ★ 兜底：自建模板（source:user，如「国赛」）通常没有同名说明文件，但其 paperFormat / solveScheme 可能挂着一篇说明文章
      //   （例：「国赛」模板的 paperFormat=高教社杯 → 回退读取 descriptions/高教社杯.md）。
      //   这样模板预览区就有内容可撑满，不再只显示「暂无说明文档」占位。
      const tpl = getTemplates().find(t => t.name === n);
      const fallbacks = [tpl && tpl.paperFormat, tpl && tpl.solveScheme];
      for (const fb of fallbacks) {
        const fbName = String(fb || '').trim();
        if (!fbName || fbName === n) continue;
        const ffile = path.join(descDirPath, sanitizeDirName(fbName) + '.md');
        if (fs.existsSync(ffile)) {
          return { ok: true, name: n, text: fs.readFileSync(ffile, 'utf-8'), fallback: fbName };
        }
      }
      return { ok: true, name: n, text: '' };
    } catch (e) {
      return { ok: false, name: n, error: e.message };
    }
  }

  return {
    getBaseDir: () => baseDir,
    getCommonRulesDir,
    getExternalRulesDir,
    getSolveLibraryDir: () => solveDir,
    getPaperLibraryDir: () => paperDir,
    getTemplateDescription,
    listSolveSchemes,
    resolveSolveScheme,
    seedSolveFromBuiltin,
    listPaperFormats,
    ensureLibraries,
    assembleWorkspace,
    getTemplates, listTemplates, validateTemplate, saveTemplate, deleteTemplate, importSolveScheme, importPaperFormat, templatesPath,
    createUserTemplate, readUserTemplate, updateUserTemplate, deleteUserTemplate, listUserTemplates, userSlug, userRoot,
    readBuiltinTemplate,
    listUserSolveTemplates, createUserSolveTemplate, readUserSolveTemplate, updateUserSolveTemplate, deleteUserSolveTemplate,
    listUserPaperTemplates, createUserPaperTemplate, readUserPaperTemplate, updateUserPaperTemplate, deleteUserPaperTemplate, republishUserPaper, listPaperSections, saveUserPaperComposition, getPaperComposition, readContentEntry, readContentFile, readPaperFile, savePaperFile, saveContentEntry, createPaperSection, savePaperBlock, deleteContentEntry, deletePaperSection, deletePaperNode, renamePaperSection, renamePaperNode,
    listBuiltinSolveTemplates, listBuiltinPaperTemplates,
    // ★ v3 两库同构：system/（main/ + sections/递归 + cls/fonts + default.template.json）+ custom/<名>/（同构克隆，用户可改）
    //   rules.md 为共享资源，统一位于 paper/rules.md（所有模板复用），章节细则随各变体 .tex 注释走
    //   getWritingRulePath：所有模板统一返回 paper/rules.md（机器可读全局约束）
    getCommonPaperPath: () => systemPaperDir,
    getWritingRulePath: () => path.join(paperDir, 'rules.md'),
    getPaperMainPath: (format) => {
      const f = format || DEFAULT_PAPER;
      // 用户模板 = templates.json 里的命名组成；返回解析后的实际 wrapper 文件路径，兼容 main 文件夹条目。
      const t = getTemplates().find(x => x.composition && (x.paperFormat === f || x.name === f));
      const mainName = (t && t.composition && t.composition.main) || (String(f).startsWith(USER_PREFIX) ? DEFAULT_PAPER : f);
      const entry = resolveMainEntry(path.join(systemPaperDir, 'main'), mainName);
      return entry ? entry.file : path.join(systemPaperDir, 'main', mainName + '.tex');
    },
    DEFAULT_SOLVE, DEFAULT_PAPER,
  };
}

module.exports = { createRulesLibrary, DEFAULT_SOLVE, DEFAULT_PAPER };
