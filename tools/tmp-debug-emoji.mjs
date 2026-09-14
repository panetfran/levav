import { readFileSync } from 'node:fs';
let src = readFileSync('tools/shot-gc-inputbar.mjs', 'utf8');
// 在 data: 拾取前打印 mine tab 的 DOM 状态
src = src.replace("const pickedData = await evalJs(", `const dbg = await evalJs(\`(function(){
  var tabs=[...document.querySelectorAll('.emoji-tab')].map(function(t){return (t.dataset.etab)+':'+(t.classList.contains('sel')?'sel':'');});
  var chips=[...document.querySelectorAll('#emoji-groups *')].filter(function(e){return e.children.length===0&&e.textContent.trim();}).map(function(e){return e.textContent.trim().slice(0,8);});
  var grids=document.querySelectorAll('#emoji-list .emoji-grid').length;
  var items=[...document.querySelectorAll('#emoji-list .emoji-item img')].map(function(im){return (im.getAttribute('src')||'').slice(0,30);});
  return JSON.stringify({tabs:tabs,chips:chips.slice(0,6),grids:grids,items:items});
})()\`);
console.log('[mine-tab 状态]', dbg);
const pickedData = await evalJs(`);
writeFileSync('tools/tmp-debug-emoji.mjs', src);
import('node:child_process');
