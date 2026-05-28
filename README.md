# kh-crawler-analysis

爬蟲 hash 對比與規則分析工具集 — 用來找出「為什麼每次同步都有大量假新增/假刪除」的根因，並輔助設計清洗規則。

## 什麼情境用？

- 同步爬蟲後發現某站點新增 / 刪除暴增（>10 筆短時間發生）
- 想驗證新加的 hash 清洗規則是否生效
- 想在加新站點到爬蟲前，先「探勘」該站有沒有 noise pattern
- 想知道實際 production 算出的 md5 hash 是什麼

## 主要組件

### `tools/crawler-document-analyzer.html`
文件分析器。支援三種模式：

1. **單檔分析** — 拖一個 JSON 進去，看它中了哪些 pattern、清洗前後的 markdown 對比、實際 production md5 hash
2. **批次分析** — 拖多檔或整個資料夾，看整批的 pattern 分布；點任一列展開詳情
3. **兩個資料夾對比** — 拖兩天的爬蟲輸出，找出 hash 不同的對、只在某邊的檔案、以及「規則建議」自動聚類分析

支援 CSV / Markdown / JSON 匯出。

### `tools/crawler-false-change-patterns.html`
10 種已知 noise pattern 的速查表（Type 1 ~ 10）。

### `tools/inspector-bookmarklet.js` + `tools/install-inspector.html`
**書籤版 inspector** — 逛任何網站時點一下書籤，右上角浮出檢測結果列出該頁有哪些 noise pattern。可以「下載成 JSON」拖到桌面分析器繼續分析。

安裝：開 `tools/install-inspector.html`，把「⚓ Noise Inspector」按鈕拖到瀏覽器書籤列。

### `extension/`
**Chrome Extension 版** — 跟 bookmarklet 同樣的偵測邏輯，但裝在工具列上一鍵掃描。

安裝步驟：見 `extension/README.md`。簡單 4 步：產圖示 → 開 chrome://extensions → 開發人員模式 → 載入未封裝項目（選 `extension/` 資料夾）。

### `analyze-document.js`
CLI 版分析器，可分析單檔或整個資料夾：

```bash
node analyze-document.js path/to/file.json
node analyze-document.js path/to/folder/
```

### `compare-by-hash.js`
用 production hash 邏輯比對兩個資料夾，輸出統計與 DIFF 對清單。

### `rules/`
清洗規則庫（與 production `utils/crawler/rules/` 同步）：
- `common-rules.js` — 規則定義
- `site-rules.js` — 站點 → 規則 對應
- `index.js` — 對外 API

## 已知 noise pattern（10 種）

| # | 類型 | 解法 |
|---|------|------|
| 1 | URL `page` 參數有/無 | `stripAllAHref` |
| 2 | 內嵌「回列表」連結的 `page=N` 漂移 | `stripAllAHref` |
| 3 | URL 重複 query 參數（爬蟲 bug） | `stripAllAHref` |
| 4 | URL 額外參數漂移（`appId2` 等） | `stripAllAHref` |
| 5 | 詳細頁的瀏覽次數漂移 | `clearTableColumnsByHeader` |
| 6 | 列表頁多筆瀏覽次數漂移 | `clearTableColumnsByHeader` |
| 7 | 日期 / 時間戳漂移 | 觀察中 |
| 8 | 動態 DOM id 漂移 | hash v2.3 已用 markdown 計算 |
| 9 | Footer「您是第 N 位瀏覽者」 | inline regex |
| 10 | Footer「更新日期 YYYY-MM-DD」site-wide 時間戳 | inline regex |

## 快速開始

```bash
# 安裝相依套件
npm install

# 比對兩個資料夾（CLI）
node compare-by-hash.js

# 開分析器（在瀏覽器拖檔案使用）
open tools/crawler-document-analyzer.html
```

## 設計重點

- 分析器**完全在 client-side 跑**，沒有 server，資料不外流
- 演算法 mirror production `utils/crawler.js` 的 `filterAndConvertHtml` + `filterAndConvertHtmlForHash` + `md5(...)` 邏輯
- 用 `turndown` + `blueimp-md5` 在瀏覽器重現 production hash 流程
