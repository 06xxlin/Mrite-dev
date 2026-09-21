// ★ 后端地址（开发版：已切断）
// ═══════════════════════════════════════════════════════════════════════════
// 原版把官方后端域名做了「偏移 +7 的字符码」混淆，运行时解码后返回，
// 全应用（auth / user / updater / task 代理 / system）都从这里取 base。
//
// 开发版改为：
//   · getBackendBase() 一律返回**黑洞地址**（本机不存在监听的端口），
//     所有拼出来的 URL 都是 http://127.0.0.1:1/...，请求立刻失败，
//     **不会有任何数据包离开本机**，也不会有 DNS 查询；
//   · 真实域名只在模块内部解出来，供 services/dev-unlock.js 建立
//     「网络拦截黑名单」（DNS / http(s) / 渲染层 webRequest）使用，
//     绝不用于发起请求。
//
// 改回官方行为：恢复 getBackendBase() 返回解码出的真实地址即可。
// ═══════════════════════════════════════════════════════════════════════════
const _K = 7;
const _C = [111, 123, 123, 119, 122, 65, 54, 54, 116, 111, 53, 121, 129, 117, 104, 53, 106, 115, 118, 124, 107];

// 黑洞地址：本机 1 端口（保留端口，不会有服务监听）→ 立即 ECONNREFUSED
const BLACKHOLE_BASE = 'http://127.0.0.1:1';

function _decodeReal() {
  let s = '';
  for (let i = 0; i < _C.length; i++) s += String.fromCharCode(_C[i] - _K);
  return s;
}

// 开发版：所有拼接后端 URL 的代码都会拿到黑洞地址
function getBackendBase() {
  return BLACKHOLE_BASE;
}

// 真实后端主机名（只给网络拦截用，比如 mh.rzna.cloud）
function getRealBackendBase() {
  return _decodeReal();
}

function getBlockedHosts() {
  try {
    const host = new URL(_decodeReal()).hostname;
    return host ? [host] : [];
  } catch (e) {
    return [];
  }
}

module.exports = { getBackendBase, getRealBackendBase, getBlockedHosts, BLACKHOLE_BASE };
