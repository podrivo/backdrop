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
  return {
    top: isDoc ? 0 : Math.max(0, r.top + el.clientTop),
    left: isDoc ? 0 : Math.max(0, r.left + el.clientLeft),
    height: isDoc ? innerHeight : el.clientHeight,
    contentWidth: isDoc ? innerWidth : el.clientWidth,
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
  // Side chrome once, then fill the hole with a solid sample from the strip's center —
  // stretching the bottom row picks up borders / rounded-corner AA / transparency.
  const crop = (img, sx, sy, sw, sh, dx, dy, dw = sw, dh = sh) => {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    ctx.drawImage(img, sx * s, sy * s, sw * s, sh * s, dx * s, dy * s, dw * s, dh * s);
  };
  const sample = (x, y) => {
    const c = new OffscreenCanvas(1, 1);
    const cctx = c.getContext('2d');
    cctx.drawImage(first, Math.floor(x * s), Math.floor(y * s), 1, 1, 0, 0, 1, 1);
    const [r, g, b, a] = cctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r},${g},${b},${a / 255})`;
  };
  const side = (sx, w, dx) => {
    if (w <= 0) return;
    crop(first, sx, m.top, w, m.height, dx, m.top);
    if (extra > 0) {
      ctx.fillStyle = sample(sx + w / 2, m.top + m.height / 2);
      ctx.fillRect(dx * s, (m.top + m.height) * s, w * s, extra * s);
    }
  };

  crop(first, 0, 0, m.width, m.top, 0, 0); // UI above the scroller
  side(0, m.left, 0);
  const right = m.left + m.contentWidth;
  side(right, m.width - right, right);
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
