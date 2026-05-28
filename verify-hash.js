// 模擬 process_crawler_files 裡的 hash 邏輯，驗證假異動配對是否會真的撞到 hash 一致
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const TurndownService = require("turndown");
const urlModule = require("url");

const turndownService = new TurndownService();
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

// === 從你的 controller 複製過來的 filterAndConvertHtml ===
function filterAndConvertHtml(html, baseUrl) {
    const $ = cheerio.load(html);
    $("[onclick], [onmouseover], [onmousedown]").remove();
    $('a[href^="javascript:"]').remove();
    $("script").remove();
    $("style").remove();
    $('a[href="#"]').remove();
    $("meta").remove();
    $("input").each(function () {
        const $picker = $(this).next('[class*="picker"]');
        $(this).remove();
        if ($picker.length) {
            $picker.find("select").remove();
            $picker.find("table").remove();
            $picker.find("button").remove();
        }
    });
    $("link").remove();
    $("div.toplink.nosnippet").remove();
    $("div.advanced_search").remove();
    $("a[onmousedown]").remove();
    $("noscript").remove();
    $("img").remove();
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
        if (href) {
            const fullUrl = urlModule.resolve(baseUrl, href);
            $(this).attr("href", fullUrl);
        }
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

function computeHash(jsonData, hashVersion = "v2.3") {
    const meta_data = {};
    Object.keys(jsonData).forEach((key) => {
        if (!["title", "text", "url", "html"].includes(key)) meta_data[key] = jsonData[key];
    });
    const filteredResult = filterAndConvertHtml(jsonData.html, jsonData.url);
    const sortedMetaData = Object.fromEntries(Object.entries(meta_data).sort());
    const hash = md5(filteredResult.markdown + jsonData.title + JSON.stringify(sortedMetaData) + hashVersion);
    return { hash, markdown: filteredResult.markdown, meta_data: sortedMetaData };
}

// === 收集 163 對配對 ===
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
for (const [f, u] of urlB) {
    const n = normalize(u);
    if (!bByN.has(n)) bByN.set(n, []);
    bByN.get(n).push(f);
}
const pairs = [];
const usedB = new Set();
for (const [fA, uA] of urlA) {
    const cands = (bByN.get(normalize(uA)) || []).filter((f) => !usedB.has(f));
    if (cands.length > 0) {
        pairs.push({ fA, fB: cands[0] });
        usedB.add(cands[0]);
    }
}

console.log(`配對到 ${pairs.length} 對假異動候選，開始比對 hash...`);

let sameHash = 0;
let diffHash = 0;
const diffSamples = [];

for (const { fA, fB } of pairs) {
    const jA = JSON.parse(fs.readFileSync(path.join("coia-first-time", fA), "utf-8"));
    const jB = JSON.parse(fs.readFileSync(path.join("coia-second-time", fB), "utf-8"));
    const rA = computeHash(jA);
    const rB = computeHash(jB);
    if (rA.hash === rB.hash) {
        sameHash++;
    } else {
        diffHash++;
        if (diffSamples.length < 5) {
            // 找差異點
            const diffPoints = [];
            if (rA.markdown !== rB.markdown) diffPoints.push(`markdown (A=${rA.markdown.length} / B=${rB.markdown.length})`);
            if (jA.title !== jB.title) diffPoints.push(`title (A="${jA.title}" / B="${jB.title}")`);
            const mA = JSON.stringify(rA.meta_data);
            const mB = JSON.stringify(rB.meta_data);
            if (mA !== mB) {
                // 找哪個欄位不同
                const diffKeys = [];
                const allKeys = new Set([...Object.keys(rA.meta_data), ...Object.keys(rB.meta_data)]);
                for (const k of allKeys) {
                    const a = JSON.stringify(rA.meta_data[k]);
                    const b = JSON.stringify(rB.meta_data[k]);
                    if (a !== b) diffKeys.push(k);
                }
                diffPoints.push(`meta_data: ${diffKeys.join(", ")}`);
            }
            diffSamples.push({ fA, fB, diffPoints, rA, rB, jA, jB });
        }
    }
}

console.log(`\n===== 結果 =====`);
console.log(`hash 一致 (真正同一筆，不會被當成新增/刪除): ${sameHash} 對`);
console.log(`hash 不一致 (還是會被當成新增/刪除): ${diffHash} 對`);

if (diffSamples.length > 0) {
    console.log(`\n===== Hash 不一致的樣本（最多 5 個）=====`);
    for (const s of diffSamples) {
        console.log("\nA:", s.fA);
        console.log("B:", s.fB);
        console.log("差異點:", s.diffPoints.join(" | "));
        // 印出 markdown 前 200 字的 diff
        if (s.rA.markdown !== s.rB.markdown) {
            // 找第一個不同的位置
            let i = 0;
            while (i < s.rA.markdown.length && i < s.rB.markdown.length && s.rA.markdown[i] === s.rB.markdown[i]) i++;
            const start = Math.max(0, i - 50);
            console.log("  markdown 首個差異點 @" + i + ":");
            console.log("    A: ..." + JSON.stringify(s.rA.markdown.slice(start, i + 100)));
            console.log("    B: ..." + JSON.stringify(s.rB.markdown.slice(start, i + 100)));
        }
        // meta_data
        const allKeys = new Set([...Object.keys(s.rA.meta_data), ...Object.keys(s.rB.meta_data)]);
        for (const k of allKeys) {
            const a = JSON.stringify(s.rA.meta_data[k]);
            const b = JSON.stringify(s.rB.meta_data[k]);
            if (a !== b) {
                const aShort = a && a.length > 150 ? a.slice(0, 150) + "..." : a;
                const bShort = b && b.length > 150 ? b.slice(0, 150) + "..." : b;
                console.log(`  meta_data.${k}:`);
                console.log(`    A: ${aShort}`);
                console.log(`    B: ${bShort}`);
            }
        }
    }
}
