# Crawler Noise Inspector — Chrome Extension

點圖示偵測當下頁面的 crawler hash noise pattern。Manifest V3。

## 檔案

```
extension/
├── manifest.json          # Manifest V3 設定
├── background.js          # Service worker — 接住點擊、注入 inspector
├── inspector.js           # 偵測 + UI overlay（同 tools/inspector-bookmarklet.js）
├── icons/
│   ├── make-icons.html    # 一次性圖示產生器（用一次後刪掉）
│   ├── icon16.png         # ← 用 make-icons.html 產生
│   ├── icon48.png         # ← 用 make-icons.html 產生
│   └── icon128.png        # ← 用 make-icons.html 產生
└── README.md
```

## 安裝（unpacked / 開發者模式）

1. 先產圖示：開 `extension/icons/make-icons.html`，按三次「下載」把 16/48/128 三個 PNG 存到 `extension/icons/` 資料夾
2. 開瀏覽器：`chrome://extensions`（Edge: `edge://extensions`）
3. 右上角開「**開發人員模式**」
4. 左上「**載入未封裝項目**」→ 選 `extension/` 資料夾
5. 工具列右上的拼圖 icon → 釘選「Crawler Noise Inspector」到工具列

## 使用

1. 逛任何網頁，例如 `https://coia.kcg.gov.tw/web_tw/index.php`
2. 點工具列上的 Inspector icon
3. 右上角浮出檢測結果：

```
┌── Crawler Noise Inspector ── × ──┐
│ coia.kcg.gov.tw                    │
├────────────────────────────────────┤
│ [T05] 詳細頁瀏覽欄                  │
│ [T09] Footer 訪客計數器             │
│ [T10] Footer 更新日期戳             │
├────────────────────────────────────┤
│ [複製為 JSON] [下載 .json]          │
└────────────────────────────────────┘
```

4. 再點一次 icon 關閉浮窗

### 想做深度分析

按「下載 .json」拿到一個 JSON 檔，拖到 `tools/crawler-document-analyzer.html` 跑完整分析（含 markdown line-diff、production md5 hash、規則建議）。

## 更新偵測邏輯

`extension/inspector.js` 跟 `tools/inspector-bookmarklet.js` 是同一份偵測程式碼，**改動時兩邊都要同步**：

```bash
# 改完 tools/inspector-bookmarklet.js 後：
cp tools/inspector-bookmarklet.js extension/inspector.js
```

修改 extension 後在 `chrome://extensions` 對該 extension 按重新整理 icon（🔄）即可生效。

## 為什麼這 4 個檔案就夠

- **manifest.json** — 宣告權限（只要 `activeTab` + `scripting`，沒有 `<all_urls>` 等 broad 權限，最小化）
- **background.js** — 點圖示時用 `chrome.scripting.executeScript` 把 inspector 注入到當前 tab
- **inspector.js** — 跟 bookmarklet 同一份。注入後跑一次，在頁面右上角畫浮窗
- **icons/** — 工具列圖示

沒有 popup、沒有 content_scripts 自動注入、沒有背景常駐邏輯 — **最小權限**，只在使用者主動點圖示時才執行一次。
