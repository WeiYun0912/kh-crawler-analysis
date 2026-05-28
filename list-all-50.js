// 列出全部 50 對「同 URL 但 hash 不同」的檔名
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
function filterForHash(html, baseUrl) {
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
    $("link").remove(); $("div.toplink.nosnippet").remove(); $("div.advanced_search").remove();
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
    applySiteHashRules($, SITE_ID);
    let filteredHtml = $.html();
    filteredHtml = filteredHtml.replace(/\n{2,}/g, "\n");
    filteredHtml = filteredHtml.replace(/(?:總|目前|累積|累計|統計)?(?:點閱|點閱率|點閱數|點閱次|點閱人次|點閱人數|觀看|觀看率|觀看次|觀看數|觀看人數|觀看人次|瀏覽|瀏覽率|瀏覽次|瀏覽人次|瀏覽人數|查看|查看率|查看次|查看人次|查看人數|點擊|點擊率|點擊次|點擊人次|點擊人數|閱讀|閱讀率|閱讀次|閱讀人次|閱讀人數|累積|累積率|累積次|累積人次|累積人數|到站|到站率|到站次|到站人次|到站人數|到訪|到訪人數|到訪人次|到訪次|訪問|訪問人次|訪問人數|訪問數)(?:[：:－\-＞>]\s*|\s*)\d+/g, "");
    let markdown = turndownService.turndown(filteredHtml);
    return markdown.trim().replace(/(\r?\n\s*){2,}/g, "\n").replace(/ {3,}/g, " ");
}
function computeHash(j) {
    const meta = {};
    Object.keys(j).forEach((k) => { if (!["title","text","url","html"].includes(k)) meta[k] = j[k]; });
    const sorted = Object.fromEntries(Object.entries(meta).sort());
    const md = filterForHash(j.html, j.url);
    return { hash: md5(md + (j.title || "") + JSON.stringify(sorted) + "v2.3"), md };
}
function scanByUrl(folder) {
    const urlMap = new Map();
    for (const f of fs.readdirSync(folder).filter(x => x.endsWith(".json"))) {
        try { const j = JSON.parse(fs.readFileSync(path.join(folder, f), "utf-8")); urlMap.set(j.url || f, { filename: f, json: j }); } catch (e) {}
    }
    return urlMap;
}
const mapA = scanByUrl("coia-first-time");
const mapB = scanByUrl("coia-second-time");
const groups = { '純數字漂移': [], '列表內容大量變動': [] };
for (const [url, a] of mapA) {
    const b = mapB.get(url);
    if (!b) continue;
    const ra = computeHash(a.json);
    const rb = computeHash(b.json);
    if (ra.hash === rb.hash) continue;
    let i = 0; while (i < ra.md.length && i < rb.md.length && ra.md[i] === rb.md[i]) i++;
    let j = 0; while (j < ra.md.length - i && j < rb.md.length - i && ra.md[ra.md.length - 1 - j] === rb.md[rb.md.length - 1 - j]) j++;
    const segA = ra.md.slice(i, ra.md.length - j);
    const segB = rb.md.slice(i, rb.md.length - j);
    if (/^\d+$/.test(segA.trim()) && /^\d+$/.test(segB.trim())) {
        groups['純數字漂移'].push({ url, file: a.filename, a: segA.trim(), b: segB.trim() });
    } else {
        groups['列表內容大量變動'].push({ url, file: a.filename, lenA: segA.length, lenB: segB.length });
    }
}
for (const [name, list] of Object.entries(groups)) {
    console.log("\n" + "═".repeat(78));
    console.log(`【${name}】共 ${list.length} 個`);
    console.log("═".repeat(78));
    list.sort((x, y) => x.file.localeCompare(y.file));
    for (const item of list) {
        console.log(`📄 ${item.file}`);
        console.log(`   URL: ${item.url}`);
        if (item.a !== undefined) console.log(`   點閱數: A=${item.a} / B=${item.b}`);
        else console.log(`   差異片段: A=${item.lenA} 字 / B=${item.lenB} 字（點閱數散落在多個 row）`);
        console.log();
    }
}
