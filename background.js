const save = (url) =>
  chrome.downloads.download({ url, filename: `screenshot-${Date.now()}.png`, saveAs: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toDataUrl = (blob) => new Promise((r) => {
  const f = new FileReader();
  f.onload = () => r(f.result);
  f.readAsDataURL(blob);
});

// Chrome only paints the visible window, so CDP full-page capture repeats the first screen.
// Scroll one viewport at a time and stitch visible-tab captures instead.
// ponytail: sticky/fixed headers repeat in each slice and canvas caps out around 32k px tall; hide fixed elements / tile output if that bites.
async function fullPage(tab) {
  const run = (func, args = []) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }).then(([r]) => r.result);

  const page = await run(() => ({
    height: document.documentElement.scrollHeight, viewport: innerHeight, width: innerWidth, y: scrollY,
  }));

  const shots = [];
  for (let y = 0; y < page.height; y += page.viewport) {
    const top = await run((y) => (scrollTo(0, y), scrollY), [y]);
    await sleep(550); // captureVisibleTab is limited to 2 calls/sec
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    shots.push({ top, img: await createImageBitmap(await (await fetch(url)).blob()) });
  }
  await run((y) => scrollTo(0, y), [page.y]);

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
