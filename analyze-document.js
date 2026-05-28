#!/usr/bin/env node
/**
 * 爬蟲文件分析器 CLI — 對單一 JSON 檔做 pattern 偵測
 *
 * 用法：
 *   node analyze-document.js path/to/file.json
 *
 * 輸出：
 *   1. 檔案 metadata（URL / title / html size）
 *   2. 偵測到的 pattern 清單（含證據、對應規則、狀態）
 *   3. 套規則後的改動統計
 *   4. 建議
 *
 * 對應「8 種 pattern」清單請見 crawler-false-change-patterns.html
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// ────── Pattern definitions ──────
const PATTERN_DEFS = {
    1: { name: "URL page 參數有/無",                 status: "solved",     rule: "stripAllAHref" },
    2: { name: "內嵌「回列表」連結的 page=N 漂移",     status: "solved",     rule: "stripAllAHref" },
    3: { name: "URL 重複 query 參數（爬蟲 bug）",      status: "solved",     rule: "stripAllAHref" },
    4: { name: "URL 額外參數漂移（appId2 等）",        status: "solved",     rule: "stripAllAHref" },
    5: { name: "詳細頁的「瀏覽次數」漂移",             status: "solved",     rule: "clearTableColumnsByHeader" },
    6: { name: "列表頁多筆「瀏覽次數」漂移",           status: "solved",     rule: "clearTableColumnsByHeader" },
    7: { name: "日期 / 時間戳漂移",                   status: "observing",  rule: "—" },
    8: { name: "動態 DOM id 漂移",                    status: "historical", rule: "hash v2.3 已修" },
};

const NOISE_KEYWORDS = ["瀏覽", "點閱", "下載", "次數", "觀看", "查看", "閱讀"];

// ────── ANSI colors ──────
const c = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
};

const STATUS_COLOR = {
    solved: c.green,
    open: c.yellow,
    observing: c.gray,
    historical: c.cyan,
};

// ────── Detection ──────
function analyze(jsonData) {
    const url = jsonData.url || "";
    const html = jsonData.html || "";
    const results = [];

    // Type 1: page param
    let urlObj = null;
    try { urlObj = new URL(url); } catch (e) {}
    if (urlObj && urlObj.searchParams.has("page")) {
        results.push({
            type: 1,
            evidence: `URL 包含 page=${urlObj.searchParams.get("page")}`,
        });
    }

    // Type 3: duplicate query keys
    if (url) {
        const queryStr = url.split("?")[1] || "";
        if (queryStr) {
            const pairs = queryStr.split("&").map((p) => p.split("=")[0]);
            const counts = {};
            for (const k of pairs) counts[k] = (counts[k] || 0) + 1;
            const dups = Object.entries(counts).filter(([k, n]) => n > 1).map(([k]) => k);
            if (dups.length > 0) {
                results.push({ type: 3, evidence: `URL 有重複 key: ${dups.join(", ")}` });
            }
        }
    }

    // Type 4: appId2 / extra params
    if (urlObj && urlObj.searchParams.has("appId2")) {
        results.push({ type: 4, evidence: `URL 包含 appId2=${urlObj.searchParams.get("appId2")}` });
    }

    // Parse HTML
    const $ = cheerio.load(html);

    // Type 2: 回列表 link
    const backLinks = [];
    $("a[title]").each((i, el) => {
        const t = $(el).attr("title") || "";
        if (/回到.*列表|回上頁|返回.*列表|回.*目錄/.test(t)) {
            backLinks.push({ title: t, href: $(el).attr("href") });
        }
    });
    if (backLinks.length > 0) {
        const ex = backLinks[0];
        results.push({
            type: 2,
            evidence: `找到 ${backLinks.length} 個「回列表」連結，例如：title="${ex.title}"，href="${ex.href || ""}"`,
        });
    }

    // Type 5/6: <th>瀏覽</th> + numeric td
    $("table").each((ti, table) => {
        const headers = $(table).find("thead th").toArray();
        if (headers.length === 0) return;
        const colIdx = headers.findIndex((th) => {
            const t = $(th).text().trim();
            return NOISE_KEYWORDS.some((k) => t.includes(k));
        });
        if (colIdx === -1) return;
        const matchedHeader = $(headers[colIdx]).text().trim();
        const rows = $(table).find("tbody tr").toArray();

        let numericRows = 0;
        for (const tr of rows) {
            const tds = $(tr).find("td").toArray();
            if (tds[colIdx] && /^\s*\d+\s*$/.test($(tds[colIdx]).text())) numericRows++;
        }
        if (numericRows === 0) return;

        const isDetail = rows.length <= 1;
        const sampleTr = rows[0];
        const sampleNum = sampleTr ? $($(sampleTr).find("td").toArray()[colIdx] || {}).text().trim() : "?";

        results.push({
            type: isDetail ? 5 : 6,
            evidence: `<th>${matchedHeader}</th> 在第 ${colIdx + 1} 欄，tbody 有 ${rows.length} 列（${numericRows} 列為純數字，例如 "${sampleNum}"）`,
        });
    });

    // Type 8: dynamic DOM id
    const dynIds = (html.match(/id="[A-Za-z]+_\d+_\d{8,}"/g) || []).slice(0, 3);
    if (dynIds.length > 0) {
        results.push({ type: 8, evidence: `找到動態 id 屬性，例如：${dynIds[0]}` });
    }

    return { url, html, title: jsonData.title, results };
}

// ────── Apply rules (preview) ──────
function applyAllRules(html) {
    const $ = cheerio.load(html);
    let hrefRemoved = 0;
    let cellsCleared = 0;

    $("a[href]").each((i, a) => { $(a).removeAttr("href"); hrefRemoved++; });

    $("table").each((ti, table) => {
        const headers = $(table).find("thead th").toArray();
        if (headers.length === 0) return;
        const colIdx = headers.findIndex((th) => {
            const t = $(th).text().trim();
            return NOISE_KEYWORDS.some((k) => t.includes(k));
        });
        if (colIdx === -1) return;
        $(table).find("tbody tr").each((i, tr) => {
            const tds = $(tr).find("td").toArray();
            if (tds[colIdx]) { $(tds[colIdx]).text(""); cellsCleared++; }
        });
    });

    return { hrefRemoved, cellsCleared };
}

// ────── Output ──────
function printAnalysis(filePath, analysis, applied) {
    const line = "─".repeat(72);
    console.log(`\n${c.bold}╔${line}╗${c.reset}`);
    console.log(`${c.bold}  爬蟲文件分析報告${c.reset}`);
    console.log(`${c.bold}╚${line}╝${c.reset}\n`);

    // Meta
    console.log(`${c.dim}─── 檔案資訊 ───${c.reset}`);
    console.log(`  ${c.gray}File   ${c.reset} ${filePath}`);
    console.log(`  ${c.gray}URL    ${c.reset} ${analysis.url || "(無)"}`);
    console.log(`  ${c.gray}Title  ${c.reset} ${analysis.title || "(無)"}`);
    console.log(`  ${c.gray}HTML   ${c.reset} ${analysis.html.length.toLocaleString()} 字元`);

    // Patterns
    console.log(`\n${c.dim}─── 偵測到的 pattern（${analysis.results.length}）───${c.reset}`);
    if (analysis.results.length === 0) {
        console.log(`  ${c.green}✓ 沒有偵測到任何已知的假異動 pattern${c.reset}\n`);
    } else {
        for (const r of analysis.results) {
            const def = PATTERN_DEFS[r.type];
            const col = STATUS_COLOR[def.status];
            const num = String(r.type).padStart(2, "0");
            console.log(`\n  ${c.bold}Type ${num}${c.reset} · ${def.name}`);
            console.log(`     ${col}● ${def.status.toUpperCase()}${c.reset}  rule: ${c.cyan}${def.rule}${c.reset}`);
            console.log(`     ${c.gray}證據：${c.reset}${r.evidence}`);
        }
    }

    // Stats
    console.log(`\n${c.dim}─── 套規則後的改動 ───${c.reset}`);
    console.log(`  ${c.bold}${applied.hrefRemoved.toString().padStart(4)}${c.reset}  href 屬性被移除`);
    console.log(`  ${c.bold}${applied.cellsCleared.toString().padStart(4)}${c.reset}  table cell 被清空（${c.yellow}提案中規則${c.reset}）`);

    // Summary
    const solved = analysis.results.filter((r) => PATTERN_DEFS[r.type].status === "solved").length;
    const open = analysis.results.filter((r) => PATTERN_DEFS[r.type].status === "open").length;
    console.log(`\n${c.dim}─── 總結 ───${c.reset}`);
    if (analysis.results.length === 0) {
        console.log(`  ${c.green}這份文件沒有偵測到任何假異動風險。${c.reset}`);
    } else {
        if (solved > 0) console.log(`  ${c.green}● ${solved} 個 pattern 可被現有規則處理${c.reset}`);
        if (open > 0)   console.log(`  ${c.yellow}● ${open} 個 pattern 尚未有規則（需要 clearTableColumnsByHeader 才能解）${c.reset}`);
    }
    console.log();
}

// ────── Batch mode ──────
function analyzeOne(filePath) {
    let jsonData;
    try {
        jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
        return { file: filePath, error: `JSON 解析失敗: ${e.message}` };
    }
    if (typeof jsonData.html !== "string") return { file: filePath, error: "缺少 html 欄位" };
    const analysis = analyze(jsonData);
    return {
        file: filePath,
        url: analysis.url,
        title: analysis.title,
        types: analysis.results.map((r) => r.type),
    };
}

function printBatchReport(results) {
    const total = results.length;
    const ok = results.filter((r) => !r.error);
    const errored = results.filter((r) => r.error);
    const clean = ok.filter((r) => r.types.length === 0);
    const counts = {};
    for (const r of ok) for (const t of new Set(r.types)) counts[t] = (counts[t] || 0) + 1;

    console.log(`\n${c.bold}╔${"─".repeat(72)}╗${c.reset}`);
    console.log(`${c.bold}  批次分析報告 — 共 ${total} 個檔案${c.reset}`);
    console.log(`${c.bold}╚${"─".repeat(72)}╝${c.reset}\n`);

    console.log(`${c.dim}─── 總覽 ───${c.reset}`);
    console.log(`  ${c.bold}${total.toString().padStart(5)}${c.reset}  總檔案數`);
    console.log(`  ${c.green}${clean.length.toString().padStart(5)}${c.reset}  完全乾淨（無 pattern）`);
    console.log(`  ${c.yellow}${(ok.length - clean.length).toString().padStart(5)}${c.reset}  有 pattern`);
    if (errored.length > 0) {
        console.log(`  ${c.red}${errored.length.toString().padStart(5)}${c.reset}  讀取失敗`);
    }

    console.log(`\n${c.dim}─── 各類型 hit 數 ───${c.reset}`);
    for (const t of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const def = PATTERN_DEFS[t];
        const n = counts[t] || 0;
        const col = n > 0 ? STATUS_COLOR[def.status] : c.gray;
        const num = String(t).padStart(2, "0");
        console.log(`  ${col}● Type ${num}${c.reset} · ${def.name.padEnd(32)} ${c.bold}${n.toString().padStart(4)}${c.reset} / ${total}`);
    }

    // 列出有 pattern 的檔案（最多 30 筆）
    const withPatterns = ok.filter((r) => r.types.length > 0).slice(0, 30);
    if (withPatterns.length > 0) {
        console.log(`\n${c.dim}─── 有 pattern 的檔案（最多列 30 筆）───${c.reset}`);
        for (const r of withPatterns) {
            const types = r.types.map((t) => `T${String(t).padStart(2, "0")}`).join(",");
            console.log(`  ${c.cyan}${types.padEnd(20)}${c.reset} ${path.basename(r.file)}`);
        }
        const remaining = ok.filter((r) => r.types.length > 0).length - withPatterns.length;
        if (remaining > 0) console.log(`  ${c.gray}... 以及其他 ${remaining} 筆${c.reset}`);
    }
    if (errored.length > 0) {
        console.log(`\n${c.dim}─── 錯誤 ───${c.reset}`);
        for (const r of errored.slice(0, 10)) console.log(`  ${c.red}${path.basename(r.file)}${c.reset}: ${r.error}`);
    }
    console.log();
}

// ────── Main ──────
function main() {
    const arg = process.argv[2];
    if (!arg) {
        console.error("用法:");
        console.error("  node analyze-document.js <path-to-file.json>      # 單一檔案 (詳細模式)");
        console.error("  node analyze-document.js <path-to-folder>         # 整個資料夾 (批次模式)");
        process.exit(1);
    }
    const targetPath = path.resolve(arg);
    if (!fs.existsSync(targetPath)) {
        console.error(`檔案/資料夾不存在: ${targetPath}`);
        process.exit(1);
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
        // Batch mode
        const files = collectJsonFiles(targetPath);
        if (files.length === 0) {
            console.error(`資料夾中沒有 .json 檔案: ${targetPath}`);
            process.exit(1);
        }
        console.log(`分析 ${files.length} 個檔案...`);
        const results = files.map(analyzeOne);
        printBatchReport(results);
    } else {
        // Single-file mode
        let jsonData;
        try {
            jsonData = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
        } catch (e) {
            console.error(`無法解析 JSON: ${e.message}`);
            process.exit(1);
        }
        if (typeof jsonData.html !== "string") {
            console.error("JSON 中找不到 html 欄位");
            process.exit(1);
        }
        const analysis = analyze(jsonData);
        const applied = applyAllRules(analysis.html);
        printAnalysis(targetPath, analysis, applied);
    }
}

// 遞迴收集資料夾內所有 .json 檔
function collectJsonFiles(dir) {
    const out = [];
    function walk(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) out.push(full);
        }
    }
    walk(dir);
    return out;
}

if (require.main === module) main();

module.exports = { analyze, applyAllRules, PATTERN_DEFS };
