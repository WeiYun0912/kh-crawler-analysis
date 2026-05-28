/**
 * 原型驗證：兩條路徑（content / hash）+ 站點專屬規則
 *
 * 對兩組檔案：
 *  1. cms_emphasis_detail id=570（你已開過的「回到衛生福利組列表」案例）
 *  2. data.php BusinessReport（appId2 + page 差異）
 * 各做：
 *  - 舊邏輯算 hash（filterAndConvertHtml）
 *  - 新邏輯算 hash（filterAndConvertHtmlForHash，套用站點規則）
 *  - 顯示 A、B 兩邊 hash 是否一致（一致 = 規則修掉了假異動）
 *  - 顯示 markdown 套規則前後的具體差異
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const TurndownService = require("turndown");
const urlModule = require("url");
const { applySiteHashRules } = require("./rules");

const turndownService = new TurndownService();
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

// ==================================================================
// 將既有 filterAndConvertHtml 拆成 core + post-process，便於 hash 那條
// 路徑在 turndown 之前插入站點規則
// ==================================================================
function filterAndConvertHtmlCore($, baseUrl) {
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
}

function postProcessToMarkdown($) {
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

// 入庫用：保留 a href 完整
function filterAndConvertHtml(html, baseUrl) {
    const $ = cheerio.load(html);
    filterAndConvertHtmlCore($, baseUrl);
    return postProcessToMarkdown($);
}

// Hash 用：通用清洗後額外套站點規則
function filterAndConvertHtmlForHash(html, baseUrl, siteId) {
    const $ = cheerio.load(html);
    filterAndConvertHtmlCore($, baseUrl);
    applySiteHashRules($, siteId);
    return postProcessToMarkdown($);
}

function computeHashes(jsonData, siteId) {
    const meta_data = {};
    Object.keys(jsonData).forEach((key) => {
        if (!["title", "text", "url", "html"].includes(key)) meta_data[key] = jsonData[key];
    });
    const sortedMetaData = Object.fromEntries(Object.entries(meta_data).sort());
    const hashVersion = "v2.3";

    const oldR = filterAndConvertHtml(jsonData.html, jsonData.url);
    const newR = filterAndConvertHtmlForHash(jsonData.html, jsonData.url, siteId);

    const oldHash = md5(oldR.markdown + jsonData.title + JSON.stringify(sortedMetaData) + hashVersion);
    const newHash = md5(newR.markdown + jsonData.title + JSON.stringify(sortedMetaData) + hashVersion);
    return { oldHash, newHash, oldMarkdown: oldR.markdown, newMarkdown: newR.markdown };
}

function firstDiffWindow(a, b, span = 80) {
    if (a === b) return null;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const from = Math.max(0, i - span);
    return {
        pos: i,
        aWindow: a.slice(from, i + span),
        bWindow: b.slice(from, i + span),
    };
}

// ==================================================================
// 測試案例
// ==================================================================
const SITE_ID = "coia"; // 測試用 placeholder（real env 是 UUID）

const tests = [
    {
        name: "案例 1：cms_emphasis_detail id=570（「回到衛生福利組列表」連結 page=N 差異）",
        A: "coia-first-time/coia_kcg_gov_tw_web_tw_cms_emphasis_detail_php_id_570_n_Emphasis_page_1.html.json",
        B: "coia-second-time/coia_kcg_gov_tw_web_tw_cms_emphasis_detail_php_id_570_n_Emphasis_page_2.html.json",
    },
    {
        name: "案例 2：data.php BusinessReport（URL appId2=1 + 內部 pagebar page=1 差異）",
        A: "coia-first-time/coia_kcg_gov_tw_web_tw_data_php_n_Download_appId_BusinessReport.html.json",
        B: "coia-second-time/coia_kcg_gov_tw_web_tw_data_php_n_Download_appId_BusinessReport_appId2_1_page_1.html.json",
    },
];

for (const t of tests) {
    console.log("\n" + "═".repeat(78));
    console.log(t.name);
    console.log("═".repeat(78));

    const jA = JSON.parse(fs.readFileSync(t.A, "utf-8"));
    const jB = JSON.parse(fs.readFileSync(t.B, "utf-8"));

    console.log(`A 檔: ${path.basename(t.A)}`);
    console.log(`B 檔: ${path.basename(t.B)}`);
    console.log(`A url: ${jA.url}`);
    console.log(`B url: ${jB.url}`);

    const rA = computeHashes(jA, SITE_ID);
    const rB = computeHashes(jB, SITE_ID);

    console.log("\n─ 舊邏輯（沒有站點規則）─");
    console.log(`  A hash: ${rA.oldHash}`);
    console.log(`  B hash: ${rB.oldHash}`);
    console.log(`  一致? ${rA.oldHash === rB.oldHash ? "✓ YES" : "✗ NO  → 會被當成新增/刪除"}`);

    console.log("\n─ 新邏輯（套用 coia 規則：stripAllAHref）─");
    console.log(`  A hash: ${rA.newHash}`);
    console.log(`  B hash: ${rB.newHash}`);
    console.log(
        `  一致? ${
            rA.newHash === rB.newHash ? "✓ YES  → 規則成功修掉假異動" : "✗ NO  → 還有其他差異點"
        }`
    );

    // B 套規則前後的 markdown 差異
    const diffB = firstDiffWindow(rB.oldMarkdown, rB.newMarkdown);
    console.log("\n─ B 檔 markdown：套規則前 vs 套規則後 ─");
    if (!diffB) {
        console.log("  無變化（規則沒匹配到任何東西）");
    } else {
        console.log(`  首個差異 @${diffB.pos}:`);
        console.log(`    舊: ...${JSON.stringify(diffB.aWindow)}`);
        console.log(`    新: ...${JSON.stringify(diffB.bWindow)}`);
    }

    // 若套完規則仍然 hash 不同，顯示 A vs B 的差異
    if (rA.newHash !== rB.newHash) {
        const diffAB = firstDiffWindow(rA.newMarkdown, rB.newMarkdown);
        console.log("\n─ 套規則後 A vs B markdown 仍有差異 ─");
        console.log(`  首個差異 @${diffAB.pos}:`);
        console.log(`    A: ...${JSON.stringify(diffAB.aWindow)}`);
        console.log(`    B: ...${JSON.stringify(diffAB.bWindow)}`);
    }
}

// ==================================================================
// 加碼：對 156 對「假異動候選」整批跑，看新規則修掉幾對
// ==================================================================
console.log("\n" + "═".repeat(78));
console.log("整批驗證：156 對假異動候選套用新規則後的修復率");
console.log("═".repeat(78));

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

let oldSame = 0, oldDiff = 0;
let newSame = 0, newDiff = 0;
let fixed = 0;
for (const { fA, fB } of pairs) {
    const jA = JSON.parse(fs.readFileSync(path.join("coia-first-time", fA), "utf-8"));
    const jB = JSON.parse(fs.readFileSync(path.join("coia-second-time", fB), "utf-8"));
    const rA = computeHashes(jA, SITE_ID);
    const rB = computeHashes(jB, SITE_ID);
    if (rA.oldHash === rB.oldHash) oldSame++; else oldDiff++;
    if (rA.newHash === rB.newHash) newSame++; else newDiff++;
    if (rA.oldHash !== rB.oldHash && rA.newHash === rB.newHash) fixed++;
}
console.log(`配對候選: ${pairs.length} 對`);
console.log(`舊邏輯一致: ${oldSame} / 不一致: ${oldDiff}`);
console.log(`新邏輯一致: ${newSame} / 不一致: ${newDiff}`);
console.log(`✓ 新規則修掉的假異動數: ${fixed} 對`);
console.log(`✓ 修復率: ${((fixed / oldDiff) * 100).toFixed(1)}%`);
