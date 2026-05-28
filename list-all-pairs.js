// 列出 129 對 hash 不一致的全部檔名配對
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const TurndownService = require("turndown");
const urlModule = require("url");

const turndownService = new TurndownService();
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

function filterAndConvertHtml(html, baseUrl) {
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
    let filteredHtml = $.html();
    filteredHtml = filteredHtml.replace(/\n{2,}/g, "\n");
    filteredHtml = filteredHtml.replace(
        /(?:總|目前|累積|累計|統計)?(?:點閱|點閱率|點閱數|點閱次|點閱人次|點閱人數|觀看|觀看率|觀看次|觀看數|觀看人數|觀看人次|瀏覽|瀏覽率|瀏覽次|瀏覽人次|瀏覽人數|查看|查看率|查看次|查看人次|查看人數|點擊|點擊率|點擊次|點擊人次|點擊人數|閱讀|閱讀率|閱讀次|閱讀人次|閱讀人數|累積|累積率|累積次|累積人次|累積人數|到站|到站率|到站次|到站人次|到站人數|到訪|到訪人數|到訪人次|到訪次|訪問|訪問人次|訪問人數|訪問數)(?:[：:－\-＞>]\s*|\s*)\d+/g,
        ""
    );
    let markdown = turndownService.turndown(filteredHtml);
    markdown = markdown.trim().replace(/(\r?\n\s*){2,}/g, "\n").replace(/ {3,}/g, " ");
    return { filteredHtml, markdown };
}

function computeHash(jsonData) {
    const meta_data = {};
    Object.keys(jsonData).forEach((key) => {
        if (!["title", "text", "url", "html"].includes(key)) meta_data[key] = jsonData[key];
    });
    const filteredResult = filterAndConvertHtml(jsonData.html, jsonData.url);
    const sortedMetaData = Object.fromEntries(Object.entries(meta_data).sort());
    const hash = md5(filteredResult.markdown + jsonData.title + JSON.stringify(sortedMetaData) + "v2.3");
    return { hash, markdown: filteredResult.markdown };
}

const filesA = fs.readdirSync("coia-first-time").filter((f) => f.endsWith(".json"));
const filesB = fs.readdirSync("coia-second-time").filter((f) => f.endsWith(".json"));
const setA = new Set(filesA), setB = new Set(filesB);
const onlyA = filesA.filter((f) => !setB.has(f));
const onlyB = filesB.filter((f) => !setA.has(f));

function loadUrl(folder, f) {
    try { return JSON.parse(fs.readFileSync(path.join(folder, f), "utf-8")).url || ""; } catch (e) { return ""; }
}
function normalize(url) {
    try {
        const u = new URL(url);
        const params = new Map();
        for (const [k, v] of u.searchParams.entries()) {
            if (k === "page") continue;
            params.set(k, v);
        }
        u.search = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("&");
        return u.toString();
    } catch (e) { return url; }
}
const urlA = new Map(onlyA.map((f) => [f, loadUrl("coia-first-time", f)]));
const urlB = new Map(onlyB.map((f) => [f, loadUrl("coia-second-time", f)]));
const bByN = new Map();
for (const [f, u] of urlB) { const n = normalize(u); if (!bByN.has(n)) bByN.set(n, []); bByN.get(n).push(f); }
const pairs = [];
const usedB = new Set();
for (const [fA, uA] of urlA) {
    const cands = (bByN.get(normalize(uA)) || []).filter((f) => !usedB.has(f));
    if (cands.length > 0) { pairs.push({ fA, fB: cands[0] }); usedB.add(cands[0]); }
}

// 蒐集 hash 不一致的配對
const diffList = [];
for (const { fA, fB } of pairs) {
    const jA = JSON.parse(fs.readFileSync(path.join("coia-first-time", fA), "utf-8"));
    const jB = JSON.parse(fs.readFileSync(path.join("coia-second-time", fB), "utf-8"));
    const rA = computeHash(jA);
    const rB = computeHash(jB);
    if (rA.hash === rB.hash) continue;

    // 找差異片段
    let i = 0;
    while (i < rA.markdown.length && i < rB.markdown.length && rA.markdown[i] === rB.markdown[i]) i++;
    let j = 0;
    while (j < rA.markdown.length - i && j < rB.markdown.length - i &&
           rA.markdown[rA.markdown.length - 1 - j] === rB.markdown[rB.markdown.length - 1 - j]) j++;
    const segA = rA.markdown.slice(i, rA.markdown.length - j);
    const segB = rB.markdown.slice(i, rB.markdown.length - j);

    // 找該差異附近的「回到xxx列表」標題
    const ctxStart = Math.max(0, i - 200);
    const ctxEnd = Math.min(rA.markdown.length - j + 200, rA.markdown.length);
    const ctx = rA.markdown.slice(ctxStart, ctxEnd);
    const titleMatch = ctx.match(/"([^"]*?回到[^"]*?列表)"/) || ctx.match(/"([^"]*?第\d頁)"/);

    diffList.push({
        fA,
        fB,
        segA,
        segB,
        backLinkTitle: titleMatch ? titleMatch[1] : null,
        urlA: jA.url,
        urlB: jB.url,
    });
}

// 依照「回列表標題」分群，方便回報
const groups = new Map();
for (const item of diffList) {
    const key = item.backLinkTitle || "(未抓到回列表標題)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
}

console.log(`hash 不一致總數: ${diffList.length} 對\n`);
console.log(`=== 依「回列表連結 title」分群 ===\n`);

const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [title, items] of sortedGroups) {
    console.log(`\n══════════════════════════════════════════════════════════════════`);
    console.log(`回列表標題: "${title}"   共 ${items.length} 對`);
    console.log(`══════════════════════════════════════════════════════════════════`);
    for (const item of items) {
        console.log(`  A: ${item.fA}`);
        console.log(`  B: ${item.fB}`);
        console.log(`     A 中 page=${item.segA.trim()}  →  B 中 page=${item.segB.trim()}`);
        console.log();
    }
}

// 同時輸出檔案，供使用者開啟
const out = [];
out.push(`# Hash 不一致配對清單（共 ${diffList.length} 對）\n`);
out.push(`原因：頁面內嵌「回列表」連結中的 page=N 數字會隨時間漂移，導致 markdown 內容相差 1 個字元，hash 就不一致。\n\n`);
for (const [title, items] of sortedGroups) {
    out.push(`\n## 回列表標題: "${title}"  (${items.length} 對)\n\n`);
    out.push(`| A 檔案 | B 檔案 | page A→B |\n|--------|--------|----------|\n`);
    for (const item of items) {
        out.push(`| ${item.fA} | ${item.fB} | ${item.segA.trim()}→${item.segB.trim()} |\n`);
    }
}
fs.writeFileSync("hash-diff-pairs.md", out.join(""), "utf-8");
console.log(`\n\n✓ 完整清單已輸出到: hash-diff-pairs.md`);
