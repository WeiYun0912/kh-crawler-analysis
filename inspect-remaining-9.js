// 查看新規則後仍 hash 不一致的 9 對到底差在哪
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const TurndownService = require("turndown");
const urlModule = require("url");
const { applySiteHashRules } = require("./rules");

const turndownService = new TurndownService();
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

function filterAndConvertHtmlCore($, baseUrl) {
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
}
function postProcess($) {
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
function hashForSite(jsonData, siteId) {
    const $ = cheerio.load(jsonData.html);
    filterAndConvertHtmlCore($, jsonData.url);
    applySiteHashRules($, siteId);
    return postProcess($);
}

const filesA = fs.readdirSync("coia-first-time").filter((f) => f.endsWith(".json"));
const filesB = fs.readdirSync("coia-second-time").filter((f) => f.endsWith(".json"));
const setA = new Set(filesA), setB = new Set(filesB);
const onlyA = filesA.filter((f) => !setB.has(f));
const onlyB = filesB.filter((f) => !setA.has(f));
function loadUrl(folder, f) { try { return JSON.parse(fs.readFileSync(path.join(folder, f), "utf-8")).url || ""; } catch (e) { return ""; } }
function normalize(url) {
    try {
        const u = new URL(url); const params = new Map();
        for (const [k, v] of u.searchParams.entries()) if (k !== "page") params.set(k, v);
        u.search = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("&");
        return u.toString();
    } catch (e) { return url; }
}
const urlA = new Map(onlyA.map((f) => [f, loadUrl("coia-first-time", f)]));
const urlB = new Map(onlyB.map((f) => [f, loadUrl("coia-second-time", f)]));
const bByN = new Map();
for (const [f, u] of urlB) { const n = normalize(u); if (!bByN.has(n)) bByN.set(n, []); bByN.get(n).push(f); }
const pairs = []; const usedB = new Set();
for (const [fA, uA] of urlA) {
    const cands = (bByN.get(normalize(uA)) || []).filter((f) => !usedB.has(f));
    if (cands.length > 0) { pairs.push({ fA, fB: cands[0] }); usedB.add(cands[0]); }
}

const SITE_ID = "coia";
const remaining = [];
for (const { fA, fB } of pairs) {
    const jA = JSON.parse(fs.readFileSync(path.join("coia-first-time", fA), "utf-8"));
    const jB = JSON.parse(fs.readFileSync(path.join("coia-second-time", fB), "utf-8"));
    const mA = hashForSite(jA, SITE_ID).markdown;
    const mB = hashForSite(jB, SITE_ID).markdown;
    if (mA !== mB) remaining.push({ fA, fB, jA, jB, mA, mB });
}

console.log(`仍有 ${remaining.length} 對 hash 不一致，逐一查看：\n`);
for (const r of remaining) {
    console.log("─".repeat(70));
    console.log(`A: ${r.fA}`);
    console.log(`B: ${r.fB}`);
    console.log(`A url: ${r.jA.url}`);
    console.log(`B url: ${r.jB.url}`);

    // 找出 markdown 差異區段
    let i = 0;
    while (i < r.mA.length && i < r.mB.length && r.mA[i] === r.mB[i]) i++;
    let j = 0;
    while (j < r.mA.length - i && j < r.mB.length - i && r.mA[r.mA.length - 1 - j] === r.mB[r.mB.length - 1 - j]) j++;

    const segA = r.mA.slice(i, r.mA.length - j);
    const segB = r.mB.slice(i, r.mB.length - j);
    console.log(`差異片段大小: A=${segA.length} 字 / B=${segB.length} 字`);
    console.log(`A 差異片段 (前 300 字):`);
    console.log(JSON.stringify(segA.slice(0, 300)));
    console.log(`B 差異片段 (前 300 字):`);
    console.log(JSON.stringify(segB.slice(0, 300)));
    console.log();
}
