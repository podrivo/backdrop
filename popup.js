document.querySelectorAll('button').forEach((b) => {
  b.onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ tabId: tab.id, full: b.dataset.full === 'true' });
    window.close();
  };
});
