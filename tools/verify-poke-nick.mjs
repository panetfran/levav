// ===== 专项回归：拍一拍人称「昵称制」（v3.30.x 起：{me}/{ta} 占位符 + 字卡写死的 TA/ta/他/她 全部按昵称回填） =====
// 用户需求：聊天里发送拍一拍时，消息显示「我的昵称 + TA 的昵称」；
//          昵称（含默认 TA、含「他」的名字）不受联系人称呼功能（taFit）影响。
// v3.30.x 变更：此前字卡文案里写死的独立 ta/TA/他（非占位符）按性别称呼（他/她）替换
//          ——用户改联系人昵称后拍一拍里仍显示 TA/ta，费解。现统一昵称制：
//          发送「拍了拍你的脸蛋」→ {me} 拍了拍{ta}的脸蛋；文案残留 TA/ta/他/她 一并按
//          联系人昵称回填（昵称未设回落默认 TA）；仅保护 其他/他们/她们/他人、svg、base64。
// 用例：
//   A 称呼=她、聊天昵称未设：发「摸了摸ta的头」→ 我 摸了摸TA的头（昵称制：不再跟随称呼 她）
//   B 称呼=她、昵称未设：发「拍了拍你」→ 我 拍了拍TA（昵称槽位回填默认 TA，不受称呼改写）
//   C 设置 cs-lbl 昵称（阿红/小明）后：发「拍了拍你的脸蛋」→ 阿红 拍了拍小明的脸蛋
//   D 「戳了戳我的头」→ 阿红 戳了戳小明的头（含我字卡人称映射不回退）
//   E 昵称已设、称呼不设置：「摸了摸ta的头」→ 阿红 摸了摸小明的头（写死 ta 也按昵称回填）
//   G 「拍了拍TA的肩膀」→ 阿红 拍了拍小明的肩膀（大写 TA 同规则）
//   H 「摸了摸他的头」→ 阿红 摸了摸小明的头（他/她 同规则；其他/他们等合成词不受影响）
//   F 全程无未捕获异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'period.js', 'accounting.js', 'garden.js', 'decision.js', 'pong.js', 'snake-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-pokenick-root-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) {
      p = normalize(join(root, rel));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { hit = statSync(p).isFile(); } catch (e) {}
    }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pokenick-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
try {
  await cdpConnect();
  const jsErrors = [];
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);

  // 通过拍一拍面板输入行发送（pokeInput 动态创建，Enter 触发 doPokeInput → sendPoke）
  const sendPokeViaInput = async (txt) => {
    return evalJs("(function () {" +
      "try { document.getElementById('poke-card').hidden = true; } catch (e) {}" +
      "var mp = document.getElementById('more-poke'); if (!mp) return 'no-more-poke';" +
      "mp.click();" +
      "var card = document.getElementById('poke-card'); if (!card || card.hidden) return 'no-card';" +
      "var inp = card.querySelector('input'); if (!inp) return 'no-input';" +
      "inp.value = " + JSON.stringify(txt) + ";" +
      "inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));" +
      "return 'sent'; })()");
  };
  const lastPokeText = async () => evalJs("(function () { var all = document.querySelectorAll('#chat-body .msg-poke span, #chat-body .msg-poke'); var el = all[all.length - 1]; return el ? el.textContent : null; })()");

  console.log('\n== 准备：称呼=她，聊天昵称未设 ==');
  await evalJs("window.xyStore('xy-home-v2:default').set('partner-gender','she'); window.dispatchEvent(new CustomEvent('ta-word-changed')); true");
  ok('taWord=她', (await evalJs('window.taWord()')) === '她');

  console.log('\n== A 字卡写死 ta：昵称制（称呼不再生效） ==');
  const a = await sendPokeViaInput('摸了摸ta的头');
  await sleep(300);
  const ta = await lastPokeText();
  ok('「摸了摸ta的头」→ 我 摸了摸TA的头（昵称未设回落默认 TA，不再变 她）', a === 'sent' && ta === '我 摸了摸TA的头', { sent: a, got: ta });

  console.log('\n== B 昵称槽位不受称呼改写（v3.26 修复点保留） ==');
  const b = await sendPokeViaInput('拍了拍你');
  await sleep(300);
  const tb = await lastPokeText();
  ok('「拍了拍你」→ 我 拍了拍TA（不再变成 她）', b === 'sent' && tb === '我 拍了拍TA', { sent: b, got: tb });

  console.log('\n== C/D 双昵称回填 ==');
  await evalJs("window.xyStore('xy-home-v2:default').set('cs-lbl-user','阿红'); window.xyStore('xy-home-v2:default').set('cs-lbl-partner','小明'); true");
  const c = await sendPokeViaInput('拍了拍你的脸蛋');
  await sleep(300);
  const tc = await lastPokeText();
  ok('「拍了拍你的脸蛋」→ 阿红 拍了拍小明的脸蛋', c === 'sent' && tc === '阿红 拍了拍小明的脸蛋', { sent: c, got: tc });
  const d = await sendPokeViaInput('戳了戳我的头');
  await sleep(300);
  const td = await lastPokeText();
  ok('「戳了戳我的头」→ 阿红 戳了戳小明的头', d === 'sent' && td === '阿红 戳了戳小明的头', { sent: d, got: td });

  console.log('\n== E 昵称已设、称呼不设置：写死 ta 也按昵称 ==');
  await evalJs("window.xyStore('xy-home-v2:default').set('partner-gender',''); window.dispatchEvent(new CustomEvent('ta-word-changed')); true");
  const e = await sendPokeViaInput('摸了摸ta的头');
  await sleep(300);
  const te = await lastPokeText();
  ok('「摸了摸ta的头」→ 阿红 摸了摸小明的头（写死 ta 回填昵称）', e === 'sent' && te === '阿红 摸了摸小明的头', { sent: e, got: te });

  console.log('\n== G/H 大写 TA 与 他/她 同规则 ==');
  const g = await sendPokeViaInput('拍了拍TA的肩膀');
  await sleep(300);
  const tg = await lastPokeText();
  ok('「拍了拍TA的肩膀」→ 阿红 拍了拍小明的肩膀', g === 'sent' && tg === '阿红 拍了拍小明的肩膀', { sent: g, got: tg });
  const h = await sendPokeViaInput('摸了摸他的头');
  await sleep(300);
  const th = await lastPokeText();
  ok('「摸了摸他的头」→ 阿红 摸了摸小明的头', h === 'sent' && th === '阿红 摸了摸小明的头', { sent: h, got: th });

  console.log('\n== F 无 JS 异常 ==');
  ok('加载与操作全程无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 项通过');
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
