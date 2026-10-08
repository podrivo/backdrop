const save = (url) =>
  chrome.downloads.download({ url, filename: `screenshot-${Date.now()}.png`, saveAs: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toDataUrl = (blob) => new Promise((r) => {
  const f = new FileReader();
  f.onload = () => r(f.result);
  f.readAsDataURL(blob);
});

// Runs in the page. Sticky -> relative keeps its layout slot but stops it following the scroll;
// fixed elements stay in the first slice only. Re-scanned every slice to catch JS that toggles them on scroll.
function step(y, hideFixed) {
  for (const el of document.querySelectorAll('*')) {
    const pos = getComputedStyle(el).position;
    if (pos !== 'sticky' && !(hideFixed && pos === 'fixed')) continue;
    if (!el.hasAttribute('data-ss-style')) el.setAttribute('data-ss-style', el.getAttribute('style') ?? '');
    if (pos === 'sticky') {
      el.style.setProperty('position', 'relative', 'important');
      el.style.setProperty('inset', 'auto', 'important');
    } else {
      el.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  scrollTo({ top: y, behavior: 'instant' });
  return scrollY;
}

function restore(y) {
  for (const el of document.querySelectorAll('[data-ss-style]')) {
    el.setAttribute('style', el.dataset.ssStyle);
    el.removeAttribute('data-ss-style');
  }
  scrollTo({ top: y, behavior: 'instant' });
}

// Chrome only paints the visible window, so CDP full-page capture repeats the first screen.
// Scroll one viewport at a time and stitch visible-tab captures instead.
// ponytail: misses fixed/sticky inside shadow DOM, and canvas caps out around 32k px tall; walk shadow roots / tile output if that bites.
async function fullPage(tab) {
  const run = (func, args = []) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }).then(([r]) => r.result);

  const page = await run(() => ({
    height: document.documentElement.scrollHeight, viewport: innerHeight, width: innerWidth, y: scrollY,
  }));

  const shots = [];
  try {
    for (let y = 0; y < page.height; y += page.viewport) {
      const top = await run(step, [y, y > 0]);
      await sleep(550); // captureVisibleTab is limited to 2 calls/sec
      const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      shots.push({ top, img: await createImageBitmap(await (await fetch(url)).blob()) });
    }
  } finally {
    await run(restore, [page.y]);
  }

  const scale = shots[0].img.width / page.width;
  const canvas = new OffscreenCanvas(shots[0].img.width, Math.round(page.height * scale));
  const ctx = canvas.getContext('2d');
  for (const { top, img } of shots) ctx.drawImage(img, 0, Math.round(top * scale));
  return toDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

chrome.runtime.onMessage.addListener(async ({ tabId, full }) => {
  const tab = await chrome.tabs.get(tabId);
  save(full ? await fullPage(tab) : await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));
});
