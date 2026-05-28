// Service worker — 接住 toolbar icon 點擊，注入 inspector.js 到當前頁面
// 用 activeTab 權限（最小化），只在使用者主動點圖示時才會跑

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab || !tab.id) return;

    // chrome://、edge://、about:、file:// 等特殊頁面禁止注入
    const url = tab.url || '';
    if (/^(chrome|edge|about|chrome-extension|moz-extension):/.test(url)) {
        chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
        chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#B45309' });
        setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 2000);
        return;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['inspector.js'],
        });
    } catch (e) {
        console.error('[Crawler Noise Inspector] inject failed:', e);
        chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
        chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#B45309' });
        setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 2000);
    }
});
