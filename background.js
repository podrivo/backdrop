const save = (url) =>
  chrome.downloads.download({ url, filename: `screenshot-${Date.now()}.png`, saveAs: true });

chrome.runtime.onMessage.addListener(async ({ tabId, full }) => {
  const tab = await chrome.tabs.get(tabId);
  if (!full) return save(await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));

  const target = { tabId };
  const send = (method, params) => chrome.debugger.sendCommand(target, method, params);

  await chrome.debugger.attach(target, '1.3');
  try {
    // The debugger infobar shrinks the viewport; pin it to the pre-attach size.
    await send('Emulation.setDeviceMetricsOverride', {
      width: tab.width, height: tab.height, deviceScaleFactor: 0, mobile: false,
    });
    const { cssContentSize: { width, height } } = await send('Page.getLayoutMetrics');
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    await save('data:image/png;base64,' + data);
  } finally {
    await chrome.debugger.detach(target);
  }
});
