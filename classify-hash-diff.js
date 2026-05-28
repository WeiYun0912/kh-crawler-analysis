// 進一步分類那 129 對 hash 不一致的差異模式
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
    return { hash, markdown: filteredResult.markdown, meta_data: sortedMetaData };
}

// === 配對 ===
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

// === 分類 hash 不一致的原因 ===
const buckets = {
    "回列表連結 page=N 差異": { count: 0, samples: [] },
    "頁面內含『點閱/下載/序號』類數字": { count: 0, samples: [] },
    "title 不同": { count: 0, samples: [] },
    "meta_data 不同": { count: 0, samples: [] },
    "其他 markdown 差異": { count: 0, samples: [] },
};
let totalSame = 0, totalDiff = 0;

for (const { fA, fB } of pairs) {
    const jA = JSON.parse(fs.readFileSync(path.join("coia-first-time", fA), "utf-8"));
    const jB = JSON.parse(fs.readFileSync(path.join("coia-second-time", fB), "utf-8"));
    const rA = computeHash(jA);
    const rB = computeHash(jB);
    if (rA.hash === rB.hash) { totalSame++; continue; }
    totalDiff++;

    // 找差異點
    const reasons = [];

    if (jA.title !== jB.title) reasons.push("title 不同");
    if (JSON.stringify(rA.meta_data) !== JSON.stringify(rB.meta_data)) {
        const diffKeys = [];
        const allKeys = new Set([...Object.keys(rA.meta_data), ...Object.keys(rB.meta_data)]);
        for (const k of allKeys) {
            if (JSON.stringify(rA.meta_data[k]) !== JSON.stringify(rB.meta_data[k])) diffKeys.push(k);
        }
        reasons.push("meta_data 不同: " + diffKeys.join(","));
    }

    if (rA.markdown !== rB.markdown) {
        // 計算 markdown 差異區段
        let i = 0;
        while (i < rA.markdown.length && i < rB.markdown.length && rA.markdown[i] === rB.markdown[i]) i++;
        let j = 0;
        while (j < rA.markdown.length - i && j < rB.markdown.length - i &&
               rA.markdown[rA.markdown.length - 1 - j] === rB.markdown[rB.markdown.length - 1 - j]) j++;
        const segA = rA.markdown.slice(i, rA.markdown.length - j);
        const segB = rB.markdown.slice(i, rB.markdown.length - j);

        // 看差異區段附近
        const contextStart = Math.max(0, i - 100);
        const contextEnd = Math.min(rA.markdown.length, rA.markdown.length - j + 100);
        const context = rA.markdown.slice(contextStart, contextEnd);

        if (/page=\d/.test(segA) || /page=\d/.test(segB) || /回到.*列表|第\d頁/.test(context)) {
            buckets["回列表連結 page=N 差異"].count++;
            if (buckets["回列表連結 page=N 差異"].samples.length < 3)
                buckets["回列表連結 page=N 差異"].samples.push({ fA, fB, segA: segA.slice(0, 80), segB: segB.slice(0, 80) });
        } else if (/^\d+$/.test(segA.trim()) && /^\d+$/.test(segB.trim())) {
            buckets["頁面內含『點閱/下載/序號』類數字"].count++;
            if (buckets["頁面內含『點閱/下載/序號』類數字"].samples.length < 3)
                buckets["頁面內含『點閱/下載/序號』類數字"].samples.push({ fA, fB, segA: segA.slice(0, 80), segB: segB.slice(0, 80) });
        } else if (reasons.length === 0) {
            buckets["其他 markdown 差異"].count++;
            if (buckets["其他 markdown 差異"].samples.length < 3)
                buckets["其他 markdown 差異"].samples.push({ fA, fB, segA: segA.slice(0, 200), segB: segB.slice(0, 200) });
        }
    }

    if (reasons.some((r) => r.startsWith("title"))) {
        buckets["title 不同"].count++;
        if (buckets["title 不同"].samples.length < 3) buckets["title 不同"].samples.push({ fA, fB, tA: jA.title, tB: jB.title });
    }
    if (reasons.some((r) => r.startsWith("meta_data"))) {
        buckets["meta_data 不同"].count++;
        if (buckets["meta_data 不同"].samples.length < 3) buckets["meta_data 不同"].samples.push({ fA, fB, reasons });
    }
}

console.log(`配對 ${pairs.length} 對 → hash 一致 ${totalSame} 對 / hash 不一致 ${totalDiff} 對\n`);
console.log("=== hash 不一致原因分布 ===");
for (const [name, b] of Object.entries(buckets)) {
    console.log(`  ${name}: ${b.count}`);
}
for (const [name, b] of Object.entries(buckets)) {
    if (b.samples.length === 0) continue;
    console.log(`\n--- ${name} 範例 ---`);
    for (const s of b.samples) {
        console.log(`  A: ${s.fA}`);
        console.log(`  B: ${s.fB}`);
        if (s.segA !== undefined) {
            console.log(`     A 差異片段: ${JSON.stringify(s.segA)}`);
            console.log(`     B 差異片段: ${JSON.stringify(s.segB)}`);
        }
        if (s.tA !== undefined) {
            console.log(`     A title: ${s.tA}`);
            console.log(`     B title: ${s.tB}`);
        }
        if (s.reasons !== undefined) console.log(`     reasons: ${s.reasons.join(" / ")}`);
        console.log();
    }
}
