// ===== 经期「生理期」标记链路验证（OPPO Reno16 Edge/Via 用户反馈回归）=====
// 反馈：经期记录没办法设置成生理期，编辑完确定也不会变红、卡在那里不会动。
// 覆盖：①日详情浮层新增「生理期」开关（标记→保存→日格变红→持久化）
//      ②开关回显与取消
//      ③长按双触发去重：contextmenu 与 500ms 定时器竞态只 toggle 一次（两种到达顺序）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9930 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pmark-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
async function touch(type, x, y) {
  const pts = type === 'touchEnd' ? [] : [{ x, y }];
  await cdp('Input.dispatchTouchEvent', { type, touchPoints: pts });
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await gotoApp();
await evalJs(`(function(){
  Object.keys(localStorage).filter(function(k){return k.indexOf('xy-home-v2:period')===0;}).forEach(function(k){localStorage.removeItem(k);});
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  var app = document.querySelector('.app[data-app="period"]');
  app.click();
  return document.getElementById('page-period') && !document.getElementById('page-period').hidden ? 'open' : 'not-open';
})()`);
await sleep(700);

// 目标日期：本月 10 号（非今天，避免与「记录今天」入口混淆；未来/过去都不限制）
const targetDs = await evalJs(`(function(){
  var n = new Date();
  return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-10';
})()`);
const cellInfo = await evalJs(`(function(){
  var c = document.querySelector('#period-grid .pc-cell[data-date="' + '${targetDs}' + '"]');
  if (!c) return null;
  var r = c.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, cls: c.className };
})();
`);
check('P0 找到目标日格且初始非经期', !!cellInfo && String(cellInfo.cls).indexOf('ph-period') < 0, JSON.stringify(cellInfo));

// ---- A 组：日详情浮层「生理期」开关 ----
let s = await evalJs(`(function(){
  var c = document.querySelector('#period-grid .pc-cell[data-date="' + '${targetDs}' + '"]');
  c.click();
  var pop = document.getElementById('period-day-pop');
  if (!pop) return 'no-pop';
  var btn = pop.querySelector('.dp-period');
  return { opened: true, hasToggle: !!btn, label: btn ? btn.textContent : '', on: btn ? btn.classList.contains('on') : false };
})()`);
await sleep(400);
check('A1 点日格打开浮层且有「生理期」开关', s && s.opened && s.hasToggle, JSON.stringify(s));
check('A2 初始未标记状态正确', s && !s.on && /标记这天为生理期/.test(String(s.label)), String(s && s.label));

s = await evalJs(`(function(){
  var pop = document.getElementById('period-day-pop');
  var btn = pop.querySelector('.dp-period');
  btn.click();
  // 顺带填一条备注，模拟用户完整编辑流程（ce-box 场景下保存不崩）
  var nb = pop.querySelector('.ce-box.dp-note') || pop.querySelector('textarea.dp-note');
  if (nb) nb.textContent = '第一天，肚子有点疼';
  var onNow = btn.classList.contains('on');
  pop.querySelector('.dp-save').click();
  return { onNow: onNow, closed: !document.getElementById('period-day-pop'), errs: window.__errs };
})()`);
await sleep(500);
check('A3 开关可打开（变 on + 文案变化）', s && s.onNow, JSON.stringify(s));
check('A4 保存后浮层关闭、无 JS 异常', s && s.closed && (!s.errs || !s.errs.length), JSON.stringify(s && s.errs));

s = await evalJs(`(function(){
  var c = document.querySelector('#period-grid .pc-cell[data-date="' + '${targetDs}' + '"]');
  var recsRaw = localStorage.getItem('xy-home-v2:period-records');
  return { cls: c ? c.className : '', red: !!(c && c.classList.contains('ph-period')), recs: recsRaw };
})()`);
check('A5 日格变红（ph-period）', s && s.red, String(s && s.cls));
check('A6 period-records 已持久化该日', s && String(s.recs).indexOf(targetDs) >= 0, String(s && s.recs));

// ---- B 组：重开回显 + 取消标记 ----
s = await evalJs(`(function(){
  var c = document.querySelector('#period-grid .pc-cell[data-date="' + '${targetDs}' + '"]');
  c.click();
  var pop = document.getElementById('period-day-pop');
  var btn = pop.querySelector('.dp-period');
  var echoOn = btn.classList.contains('on');
  btn.click(); // 取消
  var offNow = !btn.classList.contains('on');
  pop.querySelector('.dp-save').click();
  return { echoOn: echoOn, offNow: offNow, closed: !document.getElementById('period-day-pop') };
})()`);
await sleep(500);
check('B1 重开回显已标记状态', s && s.echoOn, JSON.stringify(s));
check('B2 取消标记保存成功', s && s.offNow && s.closed, '');
s = await evalJs(`(function(){
  var c = document.querySelector('#period-grid .pc-cell[data-date="' + '${targetDs}' + '"]');
  var recsRaw = localStorage.getItem('xy-home-v2:period-records') || '[]';
  var arr = JSON.parse(recsRaw);
  return { red: !!(c && c.classList.contains('ph-period')), n: arr.length };
})()`);
check('B3 红色取消、记录清空', s && !s.red && s.n === 0, JSON.stringify(s));

// ---- C 组：长按双触发去重（顺序1：contextmenu 先到）----
// 真实触摸 touchStart → 300ms 时 contextmenu 先到（应清掉定时器只 toggle 一次）→ 等 700ms → touchEnd
{
  await touch('touchStart', cellInfo.x, cellInfo.y);
  await sleep(300);
  await evalJs(`(function(){
    var c = document.querySelector('#period-grid .pc-cell[data-date="' + '${targetDs}' + '"]');
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return 'ctx';
  })()`);
  await sleep(700);
  await touch('touchEnd', cellInfo.x, cellInfo.y);
  await sleep(400);
  s = await evalJs(`(function(){
    var arr = JSON.parse(localStorage.getItem('xy-home-v2:period-records') || '[]');
    var c = document.querySelector('#period-grid .pc-cell[data-date="' + '${targetDs}' + '"]');
    return { n: arr.length, red: !!(c && c.classList.contains('ph-period')) };
  })()`);
  check('C1 contextmenu 先到：只标一次（红色生效，不被定时器二次翻转）', s && s.n === 1 && s.red, JSON.stringify(s));

  // 清场
  await evalJs(`(function(){
    var arr = JSON.parse(localStorage.getItem('xy-home-v2:period-records') || '[]');
    arr.length = 0;
    localStorage.setItem('xy-home-v2:period-records', JSON.stringify(arr));
    document.querySelector('.app[data-app="period"]').click();
    return 'reset';
  })()`);
  await sleep(500);
}
// ---- D 组：长按双触发去重（顺序2：定时器先到，contextmenu 后到）----
{
  await touch('touchStart', cellInfo.x, cellInfo.y);
  await sleep(650); // 定时器 500ms 已触发并 toggle 一次
  await evalJs(`(function(){
    var c = document.querySelector('#period-grid .pc-cell[data-date="' + '${targetDs}' + '"]');
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return 'ctx';
  })()`);
  await sleep(300);
  await touch('touchEnd', cellInfo.x, cellInfo.y);
  await sleep(400);
  s = await evalJs(`(function(){
    var arr = JSON.parse(localStorage.getItem('xy-home-v2:period-records') || '[]');
    var c = document.querySelector('#period-grid .pc-cell[data-date="' + '${targetDs}' + '"]');
    return { n: arr.length, red: !!(c && c.classList.contains('ph-period')) };
  })()`);
  check('D1 定时器先到：contextmenu 不再二次翻转（保持红色）', s && s.n === 1 && s.red, JSON.stringify(s));
}

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);
