# Demo 範例檔案

這些是從 `coia-first-time/` 複製過來的測試用 JSON，每個檔案示範特定 pattern。
拖到 `crawler-document-analyzer.html` 即可看到偵測結果。

## 「瀏覽」表格欄位（Type 5/6）

| 檔案 | 預期偵測 | Demo 重點 |
|------|---------|-----------|
| `..._cms_bulletin_php_appId_hrBulletin_n_about.html.json` | **Type 6** · 4 欄、10 列「瀏覽」 | 列表頁最典型代表 |
| `..._meeting_php_n_about_appId_Meeting.html.json` | **Type 6** · 2 欄「標題 / 瀏覽」 | 結構最乾淨、最好解釋 |
| `..._data_php_n_Download_appId_Statistics_appId2_1_page_1.html.json` | **Type 1 + 6** · URL 有 `page=1` + 列表「瀏覽」欄 + `appId2` | 一次中三個 pattern |

## a href / URL 漂移（Type 1/2）

| 檔案 | 預期偵測 | Demo 重點 |
|------|---------|-----------|
| `..._cms_emphasis_detail_php_id_570_n_Emphasis_page_2.html.json` | **Type 1 + 2** · URL 有 `page=2` + 「回到衛生福利組列表」連結 | 經典 page 漂移案例 |
| `..._cms_subsidy_detail_php_id_2174_n_Services_appId_Services2025072500004.html.json` | **Type 2** · 「回到高雄原住民故事館列表」連結 | detail 頁底部回列表連結 |

## Demo SOP

1. 開 `tools/crawler-document-analyzer.html`
2. 從這個資料夾拖檔案進去 dropzone
3. 看「偵測到的 pattern」卡片 → 對照上表
4. 看「套規則後的改動」統計 → 數字會吻合
5. 展開「完整 HTML 對比」→ 看 href 被清掉的效果
