// 应用内「清除本地数据」彻底性行为断言（#353）：
// 根因＝数据双写 LS+IDB，旧逻辑只 idbClearAll（objectStore.clear()）且用
// ||Promise.resolve(true) 掩盖失败＝清库事务失败时只清 LS、IDB 残留，启动 idbRestore
// 全量回填＝专属字卡（LS-only）真丢、其余内容全复活（红米 K70/多机型实测）。
// 修复＝idb.js 新增 idbDestroy（deleteDatabase 真删库，回填无源可依）+ personalize.js
//      清除逻辑优先真删库、失败退回 idbClearAll，去掉掩盖失败的 ||true。
// 用法：node tools/verify-clear-local-data.mjs [文件]（默认读 build.mjs 登记的两个 src 文件）
import { readFileSync } from 'fs';

// 可直接对已构建产物核 src 锚（idb.js/personalize.js 源码与产品内均含）：
const root = process.cwd();
const idb = readFileSync(root + '/src/js/idb.js', 'utf8');
const pers = readFileSync(root + '/src/js/personalize.js', 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

// D1 真删库函数存在：deleteDatabase 是「连库删除」的唯一定性锚，clear 没有这个调用
check('D1 idb.js 用 deleteDatabase 真删库', /indexedDB\.deleteDatabase\(DB_NAME\)/.test(idb), 'deleteDatabase 到位');
// D2 删库前关闭现有连接（不关闭会被自身连接 onblocked 阻塞而永不落地）
check('D2 删库前 db.close 释放连接', /d\.close\(\)/.test(idb), '先关连接再删库');
// D3 有超时兜底，删库被其它连接占用时不永久挂起（复用 #135 防挂死经验）
check('D3 删库带超时兜底', /setTimeout\(\(\) => fin\(false\), 6000\)/.test(idb), '6s 兜底');
// D4 personalize 优先调 idbDestroy（真删库优先）
check('D4 清除数据优先真删库', /window\.idbDestroy && window\.idbDestroy\(\)/.test(pers), '优先 idbDestroy');
// D5 去掉掩盖失败的 ||Promise.resolve(true)——这是「只清 LS、IDB 残留回填复活」的直接元凶
check('D5 不再用 ||true 掩盖清库失败', !/idbClearAll && window\.idbClearAll\(\)\) \|\| Promise\.resolve\(true\)/.test(pers), '无 ||true 掩盖');
// D6 失败回退到 idbClearAll（仍保有兜底路径，不因删库失败而完全不清）
check('D6 删库失败退回 idbClearAll', /idbClearAll && window\.idbClearAll\(\)\) \|\| Promise\.resolve\(false\)/.test(pers), '退回 clear');

// R1 回归清单已登记（防这次修复被并行会话/旧缓冲覆盖而无人察觉）
try {
  const fx = readFileSync(root + '/FIX-REGRESSION.md', 'utf8');
  check('R1 FIX-REGRESSION 已登记 #353', fx.indexOf('#353') >= 0 && fx.indexOf('清除本地数据') >= 0, '353 清单在位');
} catch (e) {
  check('R1 FIX-REGRESSION 已登记 #353', false, '清单读取失败');
}
// R2 哨兵已在 build.mjs 登记（needle 各在自己登记的文件里具唯一性，哑哨兵体检构建时兜底）
try {
  const bm = readFileSync(root + '/build.mjs', 'utf8');
  check('R2 build.mjs 登记 #353 哨兵', /idbDestroy \(|deleteDatabase\(DB_NAME\)/.test(bm), 'build.mjs 哨兵在位');
} catch (e) {
  check('R2 build.mjs 登记 #353 哨兵', false, 'build.mjs 读取失败');
}

console.log('verify-clear-local-data: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);