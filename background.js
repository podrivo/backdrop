const save = (url) =>
  chrome.downloads.download({ url, filename: `screenshot-${Date.now()}.png`, saveAs: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bitmap = async (url) => createImageBitmap(await (await fetch(url)).blob());

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
  const crop = (img, sy, h, dy) => ctx.drawImage(img, 0, sy * s, img.width, h * s, 0, dy * s, img.width, h * s);

  crop(first, 0, m.top, 0); // UI above the scroller
  for (const { top, img } of shots) crop(img, m.top, m.height, m.top + top);
  crop(first, m.top + m.height, m.viewport - m.top - m.height, m.top + m.height + extra); // UI below it
  return toDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

// Centers the screenshot with rounded corners on a 16:10 crop of the wallpaper at extension path `bg`.
async function frame(url, bg, cssWidth) {
  const shot = await bitmap(url);
  const wall = await bitmap(chrome.runtime.getURL(bg));

  const W = Math.round(shot.width * 1.25);
  const H = Math.round((W * 10) / 16);
  const k = Math.min((W * 0.8) / shot.width, (H * 0.8) / shot.height);
  const w = shot.width * k;
  const h = shot.height * k;

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const cover = Math.max(W / wall.width, H / wall.height);
  ctx.drawImage(wall, (W - wall.width * cover) / 2, (H - wall.height * cover) / 2, wall.width * cover, wall.height * cover);

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
