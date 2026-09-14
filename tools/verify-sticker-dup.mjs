// verify-sticker-dup.mjs — #256 联系人表情包「屏上重复、刷新消失」修复回归
// 验证相邻重复判定三处收口：addRec 实时去重与刷新归一化（collapseRapidDups/
// normCollapseRange）共用 dupGapMs 唯一窗口源 + mediaTxtEq 跨形式（@@m:令牌 ↔
// data:base64）比对 + dupSig 令牌展开。直接从 src/js/chat.js 提取函数求值，
// 不依赖构建产物（构建前后均可跑）。
// 跑法：node tools/verify-sticker-dup.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } };

// --- 按函数名提取源码（花括号配平）---
function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数 ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('花括号不配平：' + name);
}

// --- 媒体池桩：令牌 @@m:<32hex> → 池内容 ---
const pool = new Map();
const TOK = (h) => '@@m:' + h;
const isTok = (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s);
const constLine = (src.match(/const DUP_GAP_TEXT = 2500, DUP_GAP_MEDIA = 60000;/) || [])[0];
if (!constLine) throw new Error('未找到 DUP_GAP 窗口常量声明');
const sandbox = `
const window = {
  mochiMediaIsToken: (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s),
  mochiMediaExpand: (s) => { const m = /^@@m:([0-9a-f]{32})$/.exec(s || ''); return m ? (pool.get(m[1]) || null) : null; }
};
const pool = __POOL__;
let msgs = [];
${constLine}
${extractFn('mediaTxtEq')}
${extractFn('dupGapMs')}
${extractFn('dupSig')}
${extractFn('collapseRapidDups')}
${extractFn('normCollapseRange')}
return { mediaTxtEq, dupGapMs, dupSig, collapseRapidDups, normCollapseRange, getMsgs: () => msgs };
`;
const api = new Function('__POOL__', sandbox)(pool);

// --- 测试数据：两张不同的 PNG 表情（内容必须真实不同）---
const imgA = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(120) + 'ENDa';
const imgB = 'data:image/png;base64,iVBORw0KGgo' + 'B'.repeat(120) + 'ENDb';
pool.set('a'.repeat(32), imgA); // 令牌池：imgA 的令牌

const rec = (side, text, ts, extra) => Object.assign({ side, text, ts, type: 'sticker' }, extra || {});

// ===== A. dupGapMs 窗口口径 =====
ok('A1 收件侧 sticker 型 → 60000ms', api.dupGapMs(rec('in', imgA, 0)) === 60000);
ok('A2 收件侧 image 型 → 60000ms', api.dupGapMs({ side: 'in', type: 'image', text: imgA, ts: 0 }) === 60000);
ok('A3 发件侧 sticker 型（人为重发）→ 2500ms', api.dupGapMs(rec('out', imgA, 0)) === 2500);
ok('A4 img 字段型 → 60000ms（既有语义）', api.dupGapMs({ side: 'out', img: imgA, text: '', ts: 0 }) === 60000);
ok('A5 voice 字段型 → 60000ms（既有语义）', api.dupGapMs({ side: 'in', voice: 'x', text: '', ts: 0 }) === 60000);
ok('A6 普通文本 → 2500ms', api.dupGapMs({ side: 'in', text: '嗯', ts: 0 }) === 2500);
ok('A7 special 型 → 60000ms（既有语义）', api.dupGapMs({ side: 'in', special: 'poke', text: 'x', ts: 0 }) === 60000);

// ===== B. mediaTxtEq 跨形式比对 =====
ok('B1 令牌 ↔ base64 同内容 → 相等', api.mediaTxtEq(TOK('a'.repeat(32)), imgA));
ok('B2 base64 ↔ 令牌 同内容 → 相等', api.mediaTxtEq(imgA, TOK('a'.repeat(32))));
ok('B3 不同内容（令牌↔base64）→ 不等', !api.mediaTxtEq(TOK('a'.repeat(32)), imgB));
ok('B4 池 miss 令牌 → 回退直比（不误判）', !api.mediaTxtEq(TOK('f'.repeat(32)), imgA));
ok('B5 两令牌同哈希 → 相等', api.mediaTxtEq(TOK('a'.repeat(32)), TOK('a'.repeat(32))));

// ===== C. dupSig 令牌展开 =====
ok('C1 同内容 base64 与令牌签名一致', api.dupSig(rec('in', imgA, 100)) === api.dupSig(rec('in', TOK('a'.repeat(32)), 100)));
ok('C2 不同内容签名不同', api.dupSig(rec('in', imgA, 100)) !== api.dupSig(rec('in', imgB, 100)));

// ===== D. collapseRapidDups 刷新归一化行为 =====
ok('D1 收件侧同款表情包跨形式 10s → 删 1（此前漏判）',
  api.collapseRapidDups([rec('in', imgA, 0), rec('in', TOK('a'.repeat(32)), 10000)]) === 1);
ok('D2 收件侧同款表情包同形式 10s → 删 1（此前 2500ms 窗漏过）',
  api.collapseRapidDups([rec('in', imgA, 0), rec('in', imgA, 10000)]) === 1);
ok('D3 发件侧人为重发 10s → 不删',
  api.collapseRapidDups([rec('out', imgA, 0), rec('out', imgA, 10000)]) === 0);
ok('D4 收件侧 70s → 不删（超媒体窗）',
  api.collapseRapidDups([rec('in', imgA, 0), rec('in', imgA, 70000)]) === 0);
ok('D5 两张不同表情包 10s → 不删',
  api.collapseRapidDups([rec('in', imgA, 0), rec('in', imgB, 10000)]) === 0);
ok('D6 普通文本重复 2s → 删 1（既有语义）',
  api.collapseRapidDups([{ side: 'in', text: '嗯', ts: 0 }, { side: 'in', text: '嗯', ts: 2000 }]) === 1);
ok('D7 普通文本重复 4s → 不删',
  api.collapseRapidDups([{ side: 'in', text: '嗯', ts: 0 }, { side: 'in', text: '嗯', ts: 4000 }]) === 0);
ok('D8 img 字段型重复 10s → 删 1（既有语义）',
  api.collapseRapidDups([{ side: 'in', img: imgA, text: '', ts: 0 }, { side: 'in', img: imgA, text: '', ts: 10000 }]) === 1);
ok('D9 中间隔着对方消息 → 不删（只删相邻）',
  api.collapseRapidDups([rec('in', imgA, 0), { side: 'out', text: '哈哈', ts: 5000 }, rec('in', imgA, 10000)]) === 0);
ok('D10 空消息（无内容）→ 不删（既有 hasContent 守卫）',
  api.collapseRapidDups([{ side: 'in', text: '', ts: 0 }, { side: 'in', text: '', ts: 1000 }]) === 0);

// ===== E. normCollapseRange（msgs 别名同款逻辑）=====
{
  const t0 = 1780000000000;
  pool.set && null; // noop
  const m1 = rec('in', imgA, t0), m2 = rec('in', TOK('a'.repeat(32)), t0 + 1300);
  const probe = new Function('__POOL__', '__M1__', '__M2__', `
    const window = {
      mochiMediaIsToken: (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s),
      mochiMediaExpand: (s) => { const m = /^@@m:([0-9a-f]{32})$/.exec(s || ''); return m ? (pool.get(m[1]) || null) : null; }
    };
    const pool = __POOL__;
    let msgs = [ __M1__, __M2__ ];
    ${constLine}
    ${extractFn('mediaTxtEq')}
    ${extractFn('dupGapMs')}
    ${extractFn('dupSig')}
    ${extractFn('collapseRapidDups')}
    ${extractFn('normCollapseRange')}
    const removed = normCollapseRange(0, 2);
    return { removed, len: msgs.length };
  `);
  const r = probe(pool, m1, m2);
  ok('E1 normCollapseRange 跨形式同款表情包 1.3s → 删 1', r.removed === 1 && r.len === 1);
}

// ===== F. addRec 接线静态锚（源码级）=====
ok('F1 addRec 实时去重走 mediaTxtEq', /if \(!mediaTxtEq\(p\.text, rec\.text\)\) continue;/.test(src));
ok('F2 addRec 窗口走 dupGapMs(rec)', /dts <= dupGapMs\(rec\)/.test(src));
ok('F3 旧 1200ms 硬编码已清除', !/dts <= 1200/.test(src));
ok('F4 normCollapseRange 走 dupGapMs', extractFn('normCollapseRange').includes('dupGapMs(a)'));
ok('F5 collapseRapidDups 走 dupGapMs', extractFn('collapseRapidDups').includes('dupGapMs(a)'));
ok('F6 窗口常量唯一（无残留局部 GAP 声明）', !/const GAP_TEXT = 2500, GAP_MEDIA = 60000/.test(src));
ok('F7 dupSig 令牌展开接线', extractFn('dupSig').includes('mochiMediaExpand'));

console.log(`verify-sticker-dup: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
