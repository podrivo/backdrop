const save = (url, ext) =>
  chrome.downloads.download({ url, filename: `backdrop-${Date.now()}.${ext}`, saveAs: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bitmap = async (url) => createImageBitmap(await (await fetch(url)).blob());

const toDataUrl = (blob) => new Promise((r) => {
  const f = new FileReader();
  f.onload = () => r(f.result);
  f.readAsDataURL(blob);
});

// Everything stays lossless until here, so the image is compressed exactly once.
// Photo backgrounds are ~5x smaller as JPEG; plain UI captures are smaller (and sharper) as PNG.
async function encode(img, type) {
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d').drawImage(img, 0, 0);
  return toDataUrl(await canvas.convertToBlob({ type, quality: 0.9 }));
}

// The functions below run in the page via chrome.scripting.

// Scrollbars + Next.js badge. Badge lives in a shadow root whose :host { display } can beat a
// document stylesheet — inline !important on the host is what actually hides it.
function hideChrome() {
  if (!document.querySelector('style[data-ss-chrome]')) {
    const s = document.createElement('style');
    s.dataset.ssChrome = '';
    s.textContent =
      '*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}' +
      'nextjs-portal,[data-nextjs-toast],[data-next-badge-root],#__next-build-watcher{display:none!important}';
    document.documentElement.appendChild(s);
  }
  for (const el of document.querySelectorAll(
    'nextjs-portal, [data-nextjs-toast], [data-next-badge-root], #__next-build-watcher',
  )) {
    if (!el.hasAttribute('data-ss-chrome-style')) {
      el.setAttribute('data-ss-chrome-style', el.getAttribute('style') ?? '');
    }
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
  }
}

function showChrome() {
  document.querySelector('style[data-ss-chrome]')?.remove();
  for (const el of document.querySelectorAll('[data-ss-chrome-style]')) {
    el.setAttribute('style', el.dataset.ssChromeStyle);
    el.removeAttribute('data-ss-chrome-style');
  }
}

// Picks what to scroll: the document, or (for app layouts where it doesn't scroll) the largest scrollable element.
function measure() {
  let el = document.scrollingElement;
  if (el.scrollHeight <= innerHeight + 1) {
    let best = 0;
    for (const e of document.querySelectorAll('*')) {
      const area = e.clientWidth * e.clientHeight;
      if (area > best && e.scrollHeight > e.clientHeight + 1 && /auto|scroll|overlay/.test(getComputedStyle(e).overflowY)) {
        best = area;
        el = e;
      }
    }
  }
  el.setAttribute('data-ss-scroller', '');
  const isDoc = el === document.scrollingElement;
  const r = el.getBoundingClientRect();
  const top = isDoc ? 0 : Math.max(0, r.top + el.clientTop);
  const left = isDoc ? 0 : Math.max(0, r.left + el.clientLeft);
  const height = isDoc ? innerHeight : el.clientHeight;
  const contentWidth = isDoc ? innerWidth : el.clientWidth;
  // Footer chrome: short last child sitting on the column floor (gap checks fail when the
  // nav sibling is flex-1 and only pt-4 separates them).
  const pinBottom = (x0, x1) => {
    const y1 = top + height;
    let best = 0;
    for (const e of document.querySelectorAll('*')) {
      if (e.children.length < 2) continue;
      const b = e.getBoundingClientRect();
      if (b.height < height * 0.8 || b.left > x0 + 8 || b.right < x1 - 8) continue;
      const last = e.children[e.children.length - 1].getBoundingClientRect();
      if (Math.abs(b.bottom - last.bottom) > 24) continue;
      if (last.height > b.height * 0.35 || last.top < b.top + b.height * 0.5) continue;
      best = Math.max(best, Math.ceil(y1 - last.top));
    }
    return best;
  };
  return {
    top,
    left,
    height,
    contentWidth,
    leftBottom: isDoc ? 0 : pinBottom(0, left),
    rightBottom: isDoc ? 0 : pinBottom(left + contentWidth, innerWidth),
    scrollHeight: el.scrollHeight,
    width: innerWidth,
    viewport: innerHeight,
    start: el.scrollTop,
  };
}

// Sticky -> relative keeps its layout slot but stops it following the scroll. Fixed elements are hidden after the
// first slice unless they wrap the scroller (app shells). Re-scanned every slice to catch JS that toggles them on scroll.
function step(y, hideFixed) {
  const scroller = document.querySelector('[data-ss-scroller]');
  for (const el of document.querySelectorAll('*')) {
    const pos = getComputedStyle(el).position;
    const sticky = pos === 'sticky';
    if (!sticky && !(hideFixed && pos === 'fixed' && !el.contains(scroller))) continue;
    if (!el.hasAttribute('data-ss-style')) el.setAttribute('data-ss-style', el.getAttribute('style') ?? '');
    if (sticky) {
      el.style.setProperty('position', 'relative', 'important');
      el.style.setProperty('inset', 'auto', 'important');
    } else {
      el.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  scroller.scrollTo({ top: y, behavior: 'instant' });
  return scroller.scrollTop;
}

function restore(y) {
  for (const el of document.querySelectorAll('[data-ss-style]')) {
    el.setAttribute('style', el.dataset.ssStyle);
    el.removeAttribute('data-ss-style');
  }
  const scroller = document.querySelector('[data-ss-scroller]');
  scroller?.scrollTo({ top: y, behavior: 'instant' });
  scroller?.removeAttribute('data-ss-scroller');
}

// Chrome only paints the visible window, so CDP full-page capture repeats the first screen.
// Scroll one region-height at a time and stitch visible-tab captures, as if the scroller grew to fit its content.
// ponytail: misses fixed/sticky inside shadow DOM, and canvas caps out around 32k px tall; walk shadow roots / tile output if that bites.
async function fullPage(tab) {
  const run = (func, args = []) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }).then(([r]) => r.result);

  // hideChrome already ran in capture(); measure/step assume it's in place.
  const m = await run(measure);
  const shots = [];
  try {
    for (let y = 0; ; y += m.height) {
      await run(hideChrome); // Next.js may remount the portal between slices
      const top = await run(step, [y, y > 0]);
      await sleep(550); // captureVisibleTab is limited to 2 calls/sec
      const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      shots.push({ top, img: await bitmap(url) });
      if (top + m.height >= m.scrollHeight - 1 || (shots.length > 1 && top <= shots.at(-2).top)) break;
    }
  } finally {
    await run(restore, [m.start]);
  }

  const first = shots[0].img;
  const s = first.width / m.width;
  const extra = m.scrollHeight - m.height;
  const canvas = new OffscreenCanvas(first.width, Math.round((m.viewport + extra) * s));
  const ctx = canvas.getContext('2d');
  // Full-width strips re-paste side chrome on every slice; only the scroller column scrolls.
  // Grow side column: sample the painted sidebar color from the first shot (CSS tokens often
  // resolve to a parent gray that doesn't match the visible aside), then pin footer chrome.
  const crop = (img, sx, sy, sw, sh, dx, dy, dw = sw, dh = sh) => {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    ctx.drawImage(img, sx * s, sy * s, sw * s, sh * s, dx * s, dy * s, dw * s, dh * s);
  };
  const probe = new OffscreenCanvas(1, 1);
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  const sampleBg = (sx, w, bodyH) => {
    // Upper body of the visible sidebar — matches what the eye sees, skips footer/icons.
    const xs = [0.25, 0.5, 0.75].map((t) => sx + w * t);
    const ys = [0.12, 0.22, 0.32].map((t) => m.top + bodyH * t);
    for (const y of ys) {
      for (const x of xs) {
        probeCtx.clearRect(0, 0, 1, 1);
        probeCtx.drawImage(first, Math.floor(x * s), Math.floor(y * s), 1, 1, 0, 0, 1, 1);
        const [r, g, b, a] = probeCtx.getImageData(0, 0, 1, 1).data;
        if (a > 250) return `rgb(${r},${g},${b})`;
      }
    }
    return null;
  };
  const side = (sx, w, dx, bottomH) => {
    if (w <= 0) return;
    bottomH = Math.max(0, Math.min(bottomH || 0, m.height - 1));
    const bodyH = m.height - bottomH;
    const bg = sampleBg(sx, w, bodyH);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(dx * s, m.top * s, w * s, (m.height + extra) * s);
    } else {
      const bandY = m.top + Math.max(0, Math.min(bodyH - 1, Math.floor(bodyH * 0.2)));
      crop(first, sx, bandY, w, 1, dx, m.top, w, m.height + extra);
    }
    // Keep border-r/l through the grown middle (fillRect is bg only).
    const edge = sx === 0 ? w - 1 : 0;
    const edgeY = m.top + Math.max(0, Math.min(bodyH - 1, Math.floor(bodyH * 0.2)));
    crop(first, sx + edge, edgeY, 1, 1, dx + edge, m.top, 1, m.height + extra);
    crop(first, sx, m.top, w, bodyH, dx, m.top);
    if (bottomH > 0) crop(first, sx, m.top + bodyH, w, bottomH, dx, m.top + bodyH + extra);
  };

  crop(first, 0, 0, m.width, m.top, 0, 0); // UI above the scroller
  side(0, m.left, 0, m.leftBottom);
  const right = m.left + m.contentWidth;
  side(right, m.width - right, right, m.rightBottom);
  for (const { top, img } of shots) crop(img, m.left, m.top, m.contentWidth, m.height, m.left, m.top + top);
  crop(first, 0, m.top + m.height, m.width, m.viewport - m.top - m.height, 0, m.top + m.height + extra); // UI below
  return canvas;
}

// Centers the screenshot with rounded corners; padding is a fraction of width so tall pages don't get huge gutters.
async function frame(shot, bg, cssWidth) {
  const wall = await bitmap(chrome.runtime.getURL(bg));

  const pad = Math.round(shot.width * 0.125);
  const W = shot.width + pad * 2;
  const H = shot.height + pad * 2;
  const w = shot.width;
  const h = shot.height;
  const k = 1;

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const cover = Math.max(W / wall.width, H / wall.height);
  ctx.drawImage(wall, (W - wall.width * cover) / 2, (H - wall.height * cover) / 2, wall.width * cover, wall.height * cover);

  const px = (shot.width / cssWidth) * k; // CSS px -> output px
  ctx.beginPath();
  squircle(ctx, (W - w) / 2, (H - h) / 2, w, h, 48 * px);

  // Two stacked shadows (tight + wide) read smoother than a single blur.
  ctx.fillStyle = '#000';
  for (const [blur, y, alpha] of [[8, 4, 0.18], [64, 32, 0.35]]) {
    ctx.shadowColor = `rgba(0,0,0,${alpha})`;
    ctx.shadowBlur = blur * px;
    ctx.shadowOffsetY = y * px;
    ctx.fill();
  }
  ctx.shadowColor = 'transparent';
  ctx.clip();
  ctx.drawImage(shot, (W - w) / 2, (H - h) / 2, w, h);
  return canvas;
}

// Superellipse corners (n=5) read as a squircle — flatter sides than roundRect's circular arcs.
function squircle(ctx, x, y, w, h, r, n = 5) {
  r = Math.min(r, w / 2, h / 2);
  const segs = 16;
  const corner = (cx, cy, a0, a1) => {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + ((a1 - a0) * i) / segs;
      const c = Math.cos(a), s = Math.sin(a);
      ctx.lineTo(cx + Math.sign(c) * Math.abs(c) ** (2 / n) * r, cy + Math.sign(s) * Math.abs(s) ** (2 / n) * r);
    }
  };
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  corner(x + w - r, y + r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  corner(x + w - r, y + h - r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  corner(x + r, y + h - r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  corner(x + r, y + r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

async function capture({ tabId, full, bg }) {
  const tab = await chrome.tabs.get(tabId);
  const run = (func) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func }).then(([r]) => r.result);
  // One path for every mode: hide chrome, wait a paint, capture, always restore.
  await run(hideChrome);
  await sleep(100);
  let shot;
  try {
    shot = full
      ? await fullPage(tab)
      : await bitmap(await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));
  } finally {
    await run(showChrome);
  }
  if (bg) save(await encode(await frame(shot, bg, tab.width), 'image/jpeg'), 'jpg');
  else save(await encode(shot, 'image/png'), 'png');
}

// The badge shows progress (full-page captures take a while) and surfaces errors instead of failing silently.
const badge = (text, title = 'Backdrop') => {
  chrome.action.setBadgeText({ text });
  chrome.action.setTitle({ title });
};

chrome.runtime.onMessage.addListener((msg, _, ack) => {
  ack();
  badge('…', 'Capturing…');
  chrome.action.setBadgeBackgroundColor({ color: '#666' });
  capture(msg).then(
    () => badge(''),
    (e) => {
      console.error(e);
      chrome.action.setBadgeBackgroundColor({ color: '#d33' });
      badge('!', `Capture failed: ${e.message}`);
    },
  );
});
