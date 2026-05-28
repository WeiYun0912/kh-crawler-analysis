/**
 * Site Hash Rules 對外入口
 *
 * 在計算 hash 之前對 cheerio $ 套用該站點的所有啟用規則。
 * 找不到站點規則時直接 no-op，不影響任何未配置的站點。
 */

const { COMMON_RULES } = require("./common-rules");
const { SITE_RULES } = require("./site-rules");

/**
 * 該站點是否有啟用任何 hash 規則
 * @param {string} siteId
 * @returns {boolean}
 */
function hasSiteHashRules(siteId) {
    if (!siteId) return false;
    const siteConfig = SITE_RULES[siteId];
    return Array.isArray(siteConfig) && siteConfig.length > 0;
}

/**
 * 取得該站點啟用的規則清單（給 log / debug 用）
 * @param {string} siteId
 * @returns {Array<{rule: string, options?: object}>}
 */
function getSiteHashRules(siteId) {
    if (!siteId) return [];
    const siteConfig = SITE_RULES[siteId];
    return Array.isArray(siteConfig) ? siteConfig : [];
}

/**
 * @param {CheerioAPI} $   cheerio 載入的 DOM
 * @param {string} siteId  站點識別（real env 是 UUID）
 */
function applySiteHashRules($, siteId) {
    if (!siteId) return;
    const siteConfig = SITE_RULES[siteId];
    if (!siteConfig || siteConfig.length === 0) return;

    for (const { rule, options } of siteConfig) {
        const ruleDef = COMMON_RULES[rule];
        if (!ruleDef) {
            console.warn(`[site-hash-rules] 未知規則: "${rule}" (siteId=${siteId}) — 已跳過`);
            continue;
        }
        try {
            ruleDef.apply($, options);
        } catch (e) {
            console.error(`[site-hash-rules] 套用規則 "${rule}" 失敗:`, e.message);
        }
    }
}

module.exports = { applySiteHashRules, hasSiteHashRules, getSiteHashRules, COMMON_RULES, SITE_RULES };
