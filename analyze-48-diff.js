// 分析 48 對「URL 相同但內容真的不同」的具體差異點
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const TurndownService = require("turndown");
const urlModule = require("url");
const { applySiteHashRules } = require("./rules");

const turndownService = new TurndownService();
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const SITE_ID = "coia";

function filterAndConvertHtmlForHash(html, baseUrl, siteId) {
    const $ = cheerio.load(html);
    $("[onclick], [onmouseover], [onmousedown]").remove();
    $('a[href^="javascript:"]').remove();
    $("script").remove(); $("style").remove();
    $('a[href="#"]').remove(); $("meta").remove();
    $("input").each(function () {
        const $picker = $(this).next('[class*="picker"]');
        $(this).remove();
        if ($picker.length) { $picker.find("select").remove(); $picker.find("table").remove(); $picker.find("button").remove(); }
    });
    $("link").remove();
    $("div.toplink.nosnippet").remove(); $("div.advanced_search").remove();
    $("a[onmousedown]").remove(); $("noscript").remove(); $("img").remove();
    $(".advertisement, .footer").remove();
    $("a").each(function () {
        const href = $(this).attr("href");
        const title = $(this).attr("title");
        const alt = $(this).find("img").attr("alt");
        const mediaFileExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|mp3|mp4|avi|mov|wmv|mkv|flv|webm)$/i;
        if (href && href.match(/^#/)) $(this).remove();
        if (href && mediaFileExtensions.test(href)) $(this).remove();
        if (href && /html=|back|return/i.test(href)) $(this).remove();
        if (title && /回上頁|返回|back|return/i.test(title)) $(this).remove();
        if (alt && /回上頁|返回|back|return/i.test(alt)) $(this).remove();
        if (href) { const fullUrl = urlModule.resolve(baseUrl, href); $(this).attr("href", fullUrl); }
    });
    $("iframe").each(function () {
        const src = $(this).attr("src");
        if (src && src.match(/^https:\/\/www\.google\.com\/maps\/embed/)) $(this).remove();
        if (src) $(this).replaceWith(`<p>${src}</p>`);
    });
    applySiteHashRules($, siteId);
    let filteredHtml = $.html();
    filteredHtml = filteredHtml.replace(/\n{2,}/g, "\n");
    filteredHtml = filteredHtml.replace(
        /(?:總|目前|累積|累計|統計)?(?:點閱|點閱率|點閱數|點閱次|點閱人次|點閱人數|觀看|觀看率|觀看次|觀看數|觀看人數|觀看人次|瀏覽|瀏覽率|瀏覽次|瀏覽人次|瀏覽人數|查看|查看率|查看次|查看人次|查看人數|點擊|點擊率|點擊次|點擊人次|點擊人數|閱讀|閱讀率|閱讀次|閱讀人次|閱讀人數|累積|累積率|累積次|累積人次|累積人數|到站|到站率|到站次|到站人次|到站人數|到訪|到訪人數|到訪人次|到訪次|訪問|訪問人次|訪問人數|訪問數)(?:[：:－\-＞>]\s*|\s*)\d+/g,
        ""
    );
    let markdown = turndownService.turndown(filteredHtml);
    markdown = markdown.trim().replace(/(\r?\n\s*){2,}/g, "\n").replace(/ {3,}/g, " ");
    return { markdown };
}

function computeHash(jsonData) {
    const meta_data = {};
    Object.keys(jsonData).forEach((key) => {
        if (!["title", "text", "url", "html"].includes(key)) meta_data[key] = jsonData[key];
    });
    const sortedMetaData = Object.fromEntries(Object.entries(meta_data).sort());
    const { markdown } = filterAndConvertHtmlForHash(jsonData.html, jsonData.url, SITE_ID);
    return { hash: md5(markdown + (jsonData.title || "") + JSON.stringify(sortedMetaData) + "v2.3"), markdown, meta_data: sortedMetaData };
}

// 建 url -> 檔案 對應（兩邊都建）
function scanByUrl(folder) {
    const files = fs.readdirSync(folder).filter((f) => f.endsWith(".json"));
    const urlMap = new Map();
    for (const file of files) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(folder, file), "utf-8"));
            urlMap.set(j.url || file, { filename: file, json: j });
        } catch (e) {}
    }
    return urlMap;
}

const mapA = scanByUrl("coia-first-time");
const mapB = scanByUrl("coia-second-time");

// 找出「兩邊都有同 URL 但 hash 不同」的對
const reasons = new Map(); // reason -> [{url, ...}]
let count = 0;
for (const [url, a] of mapA) {
    const b = mapB.get(url);
    if (!b) continue;
    const ra = computeHash(a.json);
    const rb = computeHash(b.json);
    if (ra.hash === rb.hash) continue;
    count++;

    // 找差異片段
    let i = 0;
    while (i < ra.markdown.length && i < rb.markdown.length && ra.markdown[i] === rb.markdown[i]) i++;
    let j = 0;
    while (
        j < ra.markdown.length - i &&
        j < rb.markdown.length - i &&
        ra.markdown[ra.markdown.length - 1 - j] === rb.markdown[rb.markdown.length - 1 - j]
    )
        j++;
    const segA = ra.markdown.slice(i, ra.markdown.length - j);
    const segB = rb.markdown.slice(i, rb.markdown.length - j);

    // 分類差異模式
    let reason;
    // 純數字差異（點閱/下載次數）
    if (/^\d+$/.test(segA.trim()) && /^\d+$/.test(segB.trim())) {
        reason = "純數字漂移（下載/點閱次數）";
    }
    // 日期 column 漂移（YYY-MM-DD 格式）
    else if (/^\d{2,3}-\d{1,2}-\d{1,2}$/.test(segA.trim()) || /^\d{2,3}-\d{1,2}-\d{1,2}$/.test(segB.trim())) {
        reason = "日期漂移";
    }
    // 包含中文公告/列表項目
    else if (segA.includes("\n") || segB.includes("\n") || segA.length > 50) {
        reason = "列表內容大量變動（多筆公告差異）";
    }
    // meta_data 差異
    else if (JSON.stringify(ra.meta_data) !== JSON.stringify(rb.meta_data)) {
        reason = "meta_data 差異";
    } else {
        reason = "其他小變動";
    }

    if (!reasons.has(reason)) reasons.set(reason, []);
    reasons.get(reason).push({ url, filename: a.filename, segA, segB, lenA: segA.length, lenB: segB.length });
}

console.log(`共 ${count} 對「同 URL 但 hash 不同」\n`);
console.log("=== 依差異模式分類 ===\n");
const sorted = [...reasons.entries()].sort((x, y) => y[1].length - x[1].length);
for (const [reason, items] of sorted) {
    console.log(`【${reason}】${items.length} 對`);
}

console.log("\n=== 各類取 3 個範例 ===");
for (const [reason, items] of sorted) {
    console.log(`\n─────── ${reason} (${items.length}) ───────`);
    for (const it of items.slice(0, 3)) {
        console.log(`  URL: ${it.url}`);
        console.log(`  檔: ${it.filename}`);
        console.log(`  差異片段大小: A=${it.lenA} 字 / B=${it.lenB} 字`);
        const showA = it.segA.length > 200 ? it.segA.slice(0, 200) + "..." : it.segA;
        const showB = it.segB.length > 200 ? it.segB.slice(0, 200) + "..." : it.segB;
        console.log(`  A: ${JSON.stringify(showA)}`);
        console.log(`  B: ${JSON.stringify(showB)}`);
        console.log();
    }
}
