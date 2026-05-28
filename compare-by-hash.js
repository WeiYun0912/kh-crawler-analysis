/**
 * 用 production 的 hash 邏輯（含 stripAllAHref 規則）比對兩個資料夾
 * 找出 hash 真正對不上的檔案 → 那些就是 production 會被當成「新增/刪除」的
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const TurndownService = require("turndown");
const urlModule = require("url");
const { applySiteHashRules, hasSiteHashRules } = require("./rules");

const turndownService = new TurndownService();
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const SITE_ID = "coia";
const HASH_VERSION = "v2.3";

function filterAndConvertHtmlForHash(html, baseUrl, siteId) {
    if (!hasSiteHashRules(siteId)) {
        // 走原本邏輯也行，但 coia 一定有規則所以走不到這
        return { markdown: "" };
    }
    try {
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
    } catch (e) {
        console.error("[hash 失敗]", e.message);
        return { markdown: "" };
    }
}

function computeHash(jsonData) {
    const meta_data = {};
    Object.keys(jsonData).forEach((key) => {
        if (!["title", "text", "url", "html"].includes(key)) meta_data[key] = jsonData[key];
    });
    const sortedMetaData = Object.fromEntries(Object.entries(meta_data).sort());
    const { markdown } = filterAndConvertHtmlForHash(jsonData.html, jsonData.url, SITE_ID);
    return md5(markdown + (jsonData.title || "") + JSON.stringify(sortedMetaData) + HASH_VERSION);
}

// 掃描兩個資料夾，建 hash → file 對應
function scanFolder(folder) {
    const files = fs.readdirSync(folder).filter((f) => f.endsWith(".json"));
    const hashToFiles = new Map(); // hash → [{filename, url, title}]
    let bad = 0;
    for (const file of files) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(folder, file), "utf-8"));
            const h = computeHash(j);
            if (!hashToFiles.has(h)) hashToFiles.set(h, []);
            hashToFiles.get(h).push({ filename: file, url: j.url || "", title: j.title || "" });
        } catch (e) {
            bad++;
        }
    }
    console.log(`  ${folder}: ${files.length} 檔，${hashToFiles.size} 種 hash` + (bad ? `, ${bad} 個讀取失敗` : ""));
    return hashToFiles;
}

console.log("=== 掃描兩個資料夾並計算 hash（含 stripAllAHref 規則）===");
const mapA = scanFolder("coia-first-time");
const mapB = scanFolder("coia-second-time");

// 找差異
const hashesA = new Set(mapA.keys());
const hashesB = new Set(mapB.keys());
const onlyA = [...hashesA].filter((h) => !hashesB.has(h));
const onlyB = [...hashesB].filter((h) => !hashesA.has(h));

console.log(`\n=== 結果（hash 層級）===`);
console.log(`只在 A 的 hash（會被當成「刪除」）: ${onlyA.length}`);
console.log(`只在 B 的 hash（會被當成「新增」）: ${onlyB.length}`);
console.log(`共同 hash: ${[...hashesA].filter((h) => hashesB.has(h)).length}`);

console.log(`\n${"═".repeat(70)}\n會被「刪除」的檔案（A 有 B 沒）\n${"═".repeat(70)}`);
for (const h of onlyA) {
    const files = mapA.get(h);
    for (const f of files) {
        console.log(`  📄 ${f.filename}`);
        console.log(`     URL  : ${f.url}`);
        console.log(`     title: ${f.title}`);
        console.log();
    }
}

console.log(`\n${"═".repeat(70)}\n會被「新增」的檔案（B 有 A 沒）\n${"═".repeat(70)}`);
for (const h of onlyB) {
    const files = mapB.get(h);
    for (const f of files) {
        console.log(`  📄 ${f.filename}`);
        console.log(`     URL  : ${f.url}`);
        console.log(`     title: ${f.title}`);
        console.log();
    }
}

// 嘗試配對 onlyA / onlyB（URL 相同就是同一頁、只是 hash 變了）
console.log(`\n${"═".repeat(70)}\n智慧配對：URL 相同的「假新增/刪除」\n${"═".repeat(70)}`);
const onlyAByUrl = new Map();
for (const h of onlyA) {
    for (const f of mapA.get(h)) {
        onlyAByUrl.set(f.url, { ...f, hash: h });
    }
}
const matched = [];
const trulyAddedFiles = [];
for (const h of onlyB) {
    for (const f of mapB.get(h)) {
        const a = onlyAByUrl.get(f.url);
        if (a) {
            matched.push({ a, b: { ...f, hash: h } });
            onlyAByUrl.delete(f.url);
        } else {
            trulyAddedFiles.push({ ...f, hash: h });
        }
    }
}
const trulyDeletedFiles = [...onlyAByUrl.values()];

console.log(`\n  URL 相同但 hash 變了（內容真的變動）: ${matched.length} 對`);
console.log(`  URL 完全只在 A（真正消失）            : ${trulyDeletedFiles.length}`);
console.log(`  URL 完全只在 B（真正新增）            : ${trulyAddedFiles.length}`);
