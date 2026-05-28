/**
 * 站點 → 規則 啟用清單
 *
 * 目前實驗階段先寫死在 code，未來會搬到 DB（由 UI 維護）。
 * 搬到 DB 後 schema 預期長這樣：
 *   table site_hash_rules:
 *     site_id    VARCHAR   (對應 crawler.site_id)
 *     rule_name  TEXT      (對應 common-rules.js 裡的 key)
 *     options    JSONB
 *
 * Key 使用 crawler 表的 site_id 欄位（短字串，不是 UUID）。
 * 例如：coia 站點的 site_id = "coia"。
 */

const SITE_RULES = {
    coia: [
        { rule: "stripAllAHref" },
        { rule: "clearTableColumnsByHeader" },  // 用預設關鍵字：瀏覽/點閱/下載/次數/觀看/查看/閱讀
    ],
};

module.exports = { SITE_RULES };
