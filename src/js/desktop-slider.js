// ===== 功能：桌面左右滑动翻页（scroll-snap 原生滚动） =====
// 支持触摸/鼠标横向拖动（原生滚动），指示器圆点点击切换
// v3.6.x：支持动态页数——新增/删除桌面页后由 personalize.js 调用 deskRebuild()
// 重建圆点与索引，无需刷新页面
(function () {
  const pages = document.getElementById('desktop-pages');
  if (!pages) return;

  // 动态查询（新增/删除页后结构变化，不能缓存 NodeList）
  function getSlides() { return Array.prototype.slice.call(pages.querySelectorAll('.page-slide')); }
  function getDots() { return Array.prototype.slice.call(document.querySelectorAll('#desktop-dots .dot')); }

  let idx = 0;

  // v3.6.x：页间有 gap 缝隙，每页滚动步长 = clientWidth + gap
  // gap 是 CSS 固定值（.desktop-pages 的 flex gap），不随布局变化，但元素
  // display:none 时 getComputedStyle 仍返回 CSS 值，可安全读取
  function pageStep() {
    const g = parseFloat(getComputedStyle(pages).columnGap) || 0;
    return pages.clientWidth + g;
  }

  function go(i) {
    const slides = getSlides();
    idx = Math.max(0, Math.min(slides.length - 1, i));
    // v3.5.132：页面隐藏（display:none）时 clientWidth=0，直接赋值会产生 Infinity 下标
    if (!pages.clientWidth) return;
    // 直接赋值 scrollLeft 立即切换（scroll-snap 会自动吸附），避免 smooth 滚动被 snap 打断
    pages.scrollLeft = idx * pageStep();
    getDots().forEach((d, k) => d.classList.toggle('active', k === idx));
  }

  function sync() {
    // v3.5.132：隐藏时跳过（防抖窗口内切页 → clientWidth=0 → idx 写坏、圆点全灭）
    if (!pages.clientWidth) return;
    const pos = pages.scrollLeft / pageStep();
    const cur = Math.round(pos);
    if (cur !== idx) {
      idx = cur;
      getDots().forEach((d, k) => d.classList.toggle('active', k === idx));
    }
  }

  // 原生滚动结束（含触摸松手、滚轮）后同步圆点
  let scrollTimer = null;
  pages.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(sync, 120);
  }, { passive: true });

  // 圆点点击切换：事件委托（v3.6.x：圆点是动态重建的，不能直接绑每颗）
  document.getElementById('desktop-dots').addEventListener('click', (e) => {
    const dot = e.target.closest('.dot');
    if (!dot) return;
    go(getDots().indexOf(dot));
  });

  // v3.5.132：旋转后按新宽度重设 scrollLeft（否则停在 1.x 页位置，圆点与内容不符）
  window.addEventListener('resize', () => {
    if (pages.clientWidth) pages.scrollLeft = idx * pageStep();
  });

  // v3.6.x：桌面页隐藏时（切到聊天/设置等）旋转，resize 里 clientWidth=0 会跳过——
  // 返回桌面时按新宽度重设一次，避免 scrollLeft 停在两页之间、圆点与内容错位
  const phonePage = document.getElementById('page-phone');
  if (phonePage) {
    const mo = new MutationObserver(() => {
      if (!phonePage.hidden && pages.clientWidth) {
        pages.scrollLeft = idx * pageStep();
        sync();
      }
    });
    mo.observe(phonePage, { attributes: true, attributeFilter: ['hidden'] });
  }

  // v3.6.x：外部（新增/删除桌面页后）调用，重建圆点数量 + 校正当前索引
  // v3.27.x（#140）：页数钳到实际 slide 数——deskRebuild 可能在 buildDeskPages
  // 删页完成前被触发（回填重放/恢复默认竞态），此时 idx 可能 ≥ slides.length；
  // 旧实现把 scrollLeft 设到超界页位（Chrome 上 snap 到空白区，视觉=当前页空白、
  // 卡片全部「不显示」）。钳制后圆点/索引与实际页数一致。
  window.deskRebuild = function () {
    const slides = getSlides();
    idx = Math.max(0, Math.min(Math.max(slides.length - 1, 0), idx));
    // 重建圆点
    const dotsBox = document.getElementById('desktop-dots');
    if (dotsBox) {
      dotsBox.innerHTML = '';
      for (let i = 0; i < slides.length; i++) {
        const d = document.createElement('span');
        d.className = 'dot' + (i === idx ? ' active' : '');
        dotsBox.appendChild(d);
      }
    }
    if (pages.clientWidth) {
      pages.scrollLeft = idx * pageStep();
      sync();
    }
  };

  sync();

  // v3.x：暴露给桌面长按拖拽（跨页翻页 + 当前页索引）
  window.deskGo = go;
  window.deskIdx = function () { return idx; };
})();
