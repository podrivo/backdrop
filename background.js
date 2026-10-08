const save = (url) =>
  chrome.downloads.download({ url, filename: `screenshot-${Date.now()}.png`, saveAs: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toDataUrl = (blob) => new Promise((r) => {
  const f = new FileReader();
  f.onload = () => r(f.result);
  f.readAsDataURL(blob);
});

// The functions below run in the page via chrome.scripting.

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
  return {
    top: isDoc ? 0 : Math.max(0, el.getBoundingClientRect().top + el.clientTop),
    height: isDoc ? innerHeight : el.clientHeight,
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

  const m = await run(measure);
  const shots = [];
  try {
    for (let y = 0; ; y += m.height) {
      const top = await run(step, [y, y > 0]);
      await sleep(550); // captureVisibleTab is limited to 2 calls/sec
      const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      shots.push({ top, img: await createImageBitmap(await (await fetch(url)).blob()) });
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
  const crop = (img, sy, h, dy) => ctx.drawImage(img, 0, sy * s, img.width, h * s, 0, dy * s, img.width, h * s);

  crop(first, 0, m.top, 0); // UI above the scroller
  for (const { top, img } of shots) crop(img, m.top, m.height, m.top + top);
  crop(first, m.top + m.height, m.viewport - m.top - m.height, m.top + m.height + extra); // UI below it
  return toDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

// Base color, then soft color blobs placed at BLOBS positions.
const BACKGROUNDS = {
  sunset: ['#2d1b4e', '#ff6b6b', '#ffa94d', '#c2255c'],
  ocean: ['#0b1d3a', '#1c7ed6', '#22b8cf', '#5f3dc4'],
  aurora: ['#081c15', '#2f9e44', '#20c997', '#7048e8'],
  grape: ['#1a1033', '#9c36b5', '#e64980', '#4263eb'],
  mint: ['#e6fcf5', '#63e6be', '#74c0fc', '#ffd8a8'],
};
const BLOBS = [[0.15, 0.2], [0.85, 0.25], [0.55, 0.95]];

// Centers the screenshot with rounded corners on a 16:10 abstract background.
async function frame(url, name, cssWidth) {
  const [base, ...blobs] = BACKGROUNDS[name];
  const shot = await createImageBitmap(await (await fetch(url)).blob());

  const W = Math.round(shot.width * 1.25);
  const H = Math.round((W * 10) / 16);
  const k = Math.min((W * 0.8) / shot.width, (H * 0.8) / shot.height);
  const w = shot.width * k;
  const h = shot.height * k;

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  blobs.forEach((color, i) => {
    const [x, y] = BLOBS[i];
    const g = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, W * 0.6);
    g.addColorStop(0, color);
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });

  const px = (shot.width / cssWidth) * k; // CSS px -> output px
  ctx.beginPath();
  ctx.roundRect((W - w) / 2, (H - h) / 2, w, h, 24 * px);

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
  return toDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

chrome.runtime.onMessage.addListener(async ({ tabId, full, bg }) => {
  const tab = await chrome.tabs.get(tabId);
  const url = full ? await fullPage(tab) : await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  save(bg ? await frame(url, bg, tab.width) : url);
});
