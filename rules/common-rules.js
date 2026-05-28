/**
 * 共用清洗規則庫（給 hash 計算用，不影響入庫內容）
 *
 * 設計原則：
 *  - 每條規則用「字串名稱」對應一個 apply 函數
 *  - apply 接收 cheerio 的 $ 物件 + options
 *  - 之後規則設定搬到 DB 時，DB 只會存 rule_name + options (JSON)，
 *    函數本體永遠在 code 裡（DB 不能存函數）
 *
 * 新增規則的方法：在 COMMON_RULES 加一條，立刻可被 site-rules.js 引用。
 */

const COMMON_RULES = {
    /**
     * 從所有 <a> 標籤的 href 移除指定 query 參數
     * options: { params: string[] }
     * 範例：{ params: ['page'] } 會把 ?page=1、&page=2 等都拿掉
     */
    stripAHrefQueryParams: {
        description: "從所有 <a> 標籤的 href 移除指定 query 參數",
        apply: ($, options) => {
            const params = (options && options.params) || [];
            if (params.length === 0) return;
            $("a[href]").each(function () {
                const href = $(this).attr("href");
                if (!href) return;
                try {
                    // 此時 a href 已經由 filterAndConvertHtml 轉成 absolute
                    const u = new URL(href);
                    let modified = false;
                    for (const p of params) {
                        if (u.searchParams.has(p)) {
                            u.searchParams.delete(p);
                            modified = true;
                        }
                    }
                    if (modified) $(this).attr("href", u.toString());
                } catch (e) {
                    // 解析失敗（可能是 mailto:、tel: 等）→ 跳過
                }
            });
        },
    },

    /**
     * 無差別移除所有 <a> 標籤的 href 屬性
     * 結果：連結文字保留，但 URL 完全消失，turndown 後變純文字
     * 適用情境：該站點的內嵌連結含有易變 token / page / id 等與內容語意無關的雜訊，
     *           最直接的方式就是直接讓 hash 無視所有 href
     * options: 無
     */
    stripAllAHref: {
        description: "移除所有 <a> 的 href 屬性（保留連結文字、turndown 後變純文字）",
        apply: ($) => {
            $("a[href]").each(function () {
                $(this).removeAttr("href");
            });
        },
    },

    /**
     * 清空 thead 中含特定關鍵字的 column 所對應的 tbody td 內容
     * 適用情境：列表頁的「瀏覽次數」、「下載次數」等動態計數欄位 —
     *           thead 是中文標頭、tbody 對應位置是純數字，每天會自然漂移
     * options: { headerKeywords: string[] }
     *   - 預設關鍵字：['瀏覽', '點閱', '下載', '次數', '觀看', '查看', '閱讀']
     * 範例：
     *   thead: <th>標題</th><th>瀏覽</th>
     *   tbody: <td>公告 X</td><td>1234</td>
     *   → 套用後：<td>公告 X</td><td></td>
     */
    clearTableColumnsByHeader: {
        description: "清空 thead 中含關鍵字的 column 對應 tbody td 內容（處理點閱/瀏覽數漂移）",
        apply: ($, options) => {
            const keywords =
                (options && Array.isArray(options.headerKeywords) && options.headerKeywords.length > 0)
                    ? options.headerKeywords
                    : ["瀏覽", "點閱", "下載", "次數", "觀看", "查看", "閱讀"];

            $("table").each(function () {
                const $table = $(this);
                const $headers = $table.find("thead th");
                if ($headers.length === 0) return;

                // 找出所有匹配關鍵字的 column index（支援多 column 同時匹配）
                const matchedCols = [];
                $headers.each(function (idx) {
                    const text = $(this).text().trim();
                    if (keywords.some((k) => text.includes(k))) matchedCols.push(idx);
                });
                if (matchedCols.length === 0) return;

                $table.find("tbody tr").each(function () {
                    const $tds = $(this).find("td");
                    for (const colIdx of matchedCols) {
                        const $td = $tds.eq(colIdx);
                        if ($td.length) $td.text("");
                    }
                });
            });
        },
    },
};

module.exports = { COMMON_RULES };
