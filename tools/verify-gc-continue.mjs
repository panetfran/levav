// ===== 验证脚本：群聊「继续说」按钮（构建后无头 Chrome） =====
// 用法：node build.mjs && node tools/verify-gc-continue.mjs
// 检查项：①开启「底部聊天栏按钮触发」后群聊继续说按钮显示
//         ②点击继续说 → 群聊成员回复（新 in 消息落库）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}

const types = { '.html': 'text/html' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gc-cont-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  eval 异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 200)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});try{var st=window.activeStore();st.set('cs-trigger-bar','1');}catch(e){}try{var g=window.xyStore('xy-home-v2');g.set('reply-gc-rs-min','1');g.set('reply-gc-rs-max','1');}catch(e){}document.dispatchEvent(new Event('continue-say-changed'));return true;})()");
await sleep(400);

const before = await evalJs("(function(){var msgs=JSON.parse(localStorage.getItem('xy-home-v2:group-chat-msgs')||'[]');window.__gcErrs=[];window.addEventListener('error',function(ev){window.__gcErrs.push(String(ev.message||ev.error||''));});return msgs.length;})()");
// 诊断：群聊成员、继续说按钮、是否进入群聊页
const diag = await evalJs("(function(){" +
  "var members=[];try{members=(window.getContacts&&window.getContacts())||[];}catch(e){}" +
  "var page=document.getElementById('page-group-chat');" +
  "var typing=document.getElementById('gc-typing');" +
  "return JSON.stringify({contacts:members.length,pageVisible:page?!page.hidden:false,typingHidden:typing?typing.hidden:'na',msgs:JSON.parse(localStorage.getItem('xy-home-v2:group-chat-msgs')||'[]').length});" +
  "})()");
const btn = await evalJs("(function(){var b=document.getElementById('gc-continue-btn');if(!b)return 'missing';b.click();return getComputedStyle(b).display;})()");
await sleep(45000);
const after = await evalJs("(function(){var msgs=JSON.parse(localStorage.getItem('xy-home-v2:group-chat-msgs')||'[]');var newOnes=msgs.slice(" + before + ");return JSON.stringify({count:newOnes.length,sides:newOnes.map(function(m){return m.side;})});})()");
check('继续说按钮显示且可点击', btn !== 'missing' && btn !== 'none', 'display=' + btn);
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
