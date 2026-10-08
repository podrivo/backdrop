chrome.runtime.onMessage.addListener(async ({ tabId, full }) => {
  const target = { tabId };
  const send = (method, params) => chrome.debugger.sendCommand(target, method, params);

  await chrome.debugger.attach(target, '1.3');
  try {
    const params = { format: 'png' };
    if (full) {
      const { cssContentSize: { width, height } } = await send('Page.getLayoutMetrics');
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width, height, scale: 1 };
    }
    const { data } = await send('Page.captureScreenshot', params);
    await chrome.downloads.download({
      url: 'data:image/png;base64,' + data,
      filename: `screenshot-${Date.now()}.png`,
      saveAs: true,
    });
  } finally {
    await chrome.debugger.detach(target);
  }
});
