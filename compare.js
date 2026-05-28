const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

// ========== 參數解析 ==========
function parseArgs() {
    const args = process.argv.slice(2);
    const flags = {};
    const positional = [];
    for (const arg of args) {
        if (arg.startsWith("--")) {
            const [key, val] = arg.slice(2).split("=");
            flags[key] = val !== undefined ? val : true;
        } else {
            positional.push(arg);
        }
    }
    return { flags, positional };
}

const { flags, positional } = parseArgs();

if (flags.help) {
    console.log(`用法: node compare.js [資料夾A] [資料夾B] [輸出檔名] [選項]

選項:
  --show-full    「僅順序不同」的檔案也印出完整 HTML diff
  --help         顯示此說明
`);
    process.exit(0);
}

const FOLDER_A = positional[0] || "youth0412";
const FOLDER_B = positional[1] || "youth0413";
const OUTPUT_FILE = positional[2] || `compare-result-${FOLDER_A}-vs-${FOLDER_B}.xlsx`;
const SHOW_FULL = !!flags["show-full"];
// Excel 單格上限 32767 字元，保留一些空間
const EXCEL_CELL_MAX = 32000;
// ==========================

const dirA = path.resolve(__dirname, FOLDER_A);
const dirB = path.resolve(__dirname, FOLDER_B);

function getJsonFiles(dir) {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
        return { _error: `無法解析: ${e.message}` };
    }
}

function truncate(str, max) {
    if (typeof str !== "string") str = JSON.stringify(str);
    if (str.length <= max) return str;
    return str.slice(0, max) + `\n...(截斷，原始共 ${str.length} 字元)`;
}

/**
 * 逐行 diff（考慮順序）
 * 使用 Hunt-McIlroy / patience-like 演算法：
 * 先找 LCS，再把非 LCS 的行標記為 removed / added
 * 對超大檔案做分段處理避免記憶體爆炸
 */
function lineDiff(textA, textB) {
    const linesA = textA.split("\n");
    const linesB = textB.split("\n");

    // 如果行數太多 (>5000)，改用分段比對避免 O(n*m) 太慢
    if (linesA.length > 5000 || linesB.length > 5000) {
        return chunkDiff(linesA, linesB);
    }

    return myersDiff(linesA, linesB);
}

/**
 * 簡化版 Myers diff，輸出 removed/added 行（含行號）
 * 適用於 5000 行以內
 */
function myersDiff(linesA, linesB) {
    const n = linesA.length;
    const m = linesB.length;

    // 建立 LCS 用的 DP（空間優化：只保留兩列）
    // 但對 5000x5000 仍太大，改用 Map-based 貪心法
    // 先用 hash 快速跳過完全相同的前綴和後綴
    let prefixLen = 0;
    while (prefixLen < n && prefixLen < m && linesA[prefixLen] === linesB[prefixLen]) {
        prefixLen++;
    }
    let suffixLen = 0;
    while (
        suffixLen < n - prefixLen &&
        suffixLen < m - prefixLen &&
        linesA[n - 1 - suffixLen] === linesB[m - 1 - suffixLen]
    ) {
        suffixLen++;
    }

    const subA = linesA.slice(prefixLen, n - suffixLen);
    const subB = linesB.slice(prefixLen, m - suffixLen);

    if (subA.length === 0 && subB.length === 0) {
        return { removed: [], added: [] };
    }

    // 對剩餘部分做簡單的 LCS (O(n*m) 但 n,m 已縮小)
    // 如果子序列仍然太大，直接全部標記為 diff
    if (subA.length * subB.length > 10_000_000) {
        const removed = subA.map((line, i) => ({ lineNum: prefixLen + i + 1, text: line }));
        const added = subB.map((line, i) => ({ lineNum: prefixLen + i + 1, text: line }));
        return { removed, added };
    }

    // 標準 LCS DP
    const dp = Array.from({ length: subA.length + 1 }, () => new Uint16Array(subB.length + 1));
    for (let i = 1; i <= subA.length; i++) {
        for (let j = 1; j <= subB.length; j++) {
            if (subA[i - 1] === subB[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // 回溯找出 diff
    const removed = [];
    const added = [];
    let i = subA.length,
        j = subB.length;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && subA[i - 1] === subB[j - 1]) {
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            added.unshift({ lineNum: prefixLen + j, text: subB[j - 1] });
            j--;
        } else {
            removed.unshift({ lineNum: prefixLen + i, text: subA[i - 1] });
            i--;
        }
    }

    return { removed, added };
}

/**
 * 分段比對：將大檔案切成小塊逐段比對
 * 適用於超大 HTML
 */
function chunkDiff(linesA, linesB) {
    const CHUNK = 500;
    const removed = [];
    const added = [];

    // 先跳過相同的前綴/後綴
    let prefixLen = 0;
    while (prefixLen < linesA.length && prefixLen < linesB.length && linesA[prefixLen] === linesB[prefixLen]) {
        prefixLen++;
    }
    let suffixLen = 0;
    while (
        suffixLen < linesA.length - prefixLen &&
        suffixLen < linesB.length - prefixLen &&
        linesA[linesA.length - 1 - suffixLen] === linesB[linesB.length - 1 - suffixLen]
    ) {
        suffixLen++;
    }

    const subA = linesA.slice(prefixLen, linesA.length - suffixLen);
    const subB = linesB.slice(prefixLen, linesB.length - suffixLen);

    // 直接對剩餘的不同區塊做逐行標記
    const maxLen = Math.max(subA.length, subB.length);
    for (let i = 0; i < maxLen; i++) {
        const a = i < subA.length ? subA[i] : undefined;
        const b = i < subB.length ? subB[i] : undefined;
        if (a !== b) {
            if (a !== undefined) removed.push({ lineNum: prefixLen + i + 1, text: a });
            if (b !== undefined) added.push({ lineNum: prefixLen + i + 1, text: b });
        }
    }

    return { removed, added };
}

/**
 * 判斷兩段文字是否只是行的順序不同（內容完全一樣）
 */
function isOrderOnlyDiff(strA, strB) {
    const sortedA = strA.split("\n").sort().join("\n");
    const sortedB = strB.split("\n").sort().join("\n");
    return sortedA === sortedB;
}

/**
 * 比對兩個 JSON 物件，回傳差異列表
 * html 欄位會區分「僅順序不同」和「真正內容不同」
 */
function compareJson(a, b, fileName) {
    const diffs = [];
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

    for (const key of allKeys) {
        const valA = a[key];
        const valB = b[key];

        if (!(key in a)) {
            diffs.push({ field: key, type: "新增欄位", folderA: "", folderB: truncate(String(valB), EXCEL_CELL_MAX) });
        } else if (!(key in b)) {
            diffs.push({ field: key, type: "移除欄位", folderA: truncate(String(valA), EXCEL_CELL_MAX), folderB: "" });
        } else {
            const strA = typeof valA === "string" ? valA : JSON.stringify(valA);
            const strB = typeof valB === "string" ? valB : JSON.stringify(valB);

            if (strA !== strB) {
                if (key === "html") {
                    // 先判斷是純順序問題還是真正內容不同
                    const orderOnly = isOrderOnlyDiff(strA, strB);

                    if (orderOnly) {
                        if (SHOW_FULL) {
                            // --show-full 模式：順序不同也列出完整 diff
                            const { removed, added } = lineDiff(strA, strB);
                            const formatLines = (items) =>
                                items
                                    .map((item) => `L${item.lineNum}: ${item.text.trim()}`)
                                    .filter((l) => l.length > 3)
                                    .join("\n");
                            const removedText = removed.length > 0 ? formatLines(removed) : "(無)";
                            const addedText = added.length > 0 ? formatLines(added) : "(無)";

                            diffs.push({
                                field: key,
                                type: "僅順序不同",
                                folderA: truncate(`[順序變更 ${removed.length} 行]\n${removedText}`, EXCEL_CELL_MAX),
                                folderB: truncate(`[順序變更 ${added.length} 行]\n${addedText}`, EXCEL_CELL_MAX),
                            });
                        } else {
                            diffs.push({
                                field: key,
                                type: "僅順序不同",
                                folderA: "(內容相同，僅 HTML 元素排列順序不同)",
                                folderB: "(內容相同，僅 HTML 元素排列順序不同)",
                            });
                        }
                    } else {
                        // 真正內容不同，做完整逐行 diff
                        const { removed, added } = lineDiff(strA, strB);

                        const formatLines = (items) =>
                            items
                                .map((item) => `L${item.lineNum}: ${item.text.trim()}`)
                                .filter((l) => l.length > 3)
                                .join("\n");

                        const removedText = removed.length > 0 ? formatLines(removed) : "(無)";
                        const addedText = added.length > 0 ? formatLines(added) : "(無)";

                        diffs.push({
                            field: key,
                            type: "內容不同",
                            folderA: truncate(`[移除/變更 ${removed.length} 行]\n${removedText}`, EXCEL_CELL_MAX),
                            folderB: truncate(`[新增/變更 ${added.length} 行]\n${addedText}`, EXCEL_CELL_MAX),
                        });

                        // 如果 diff 內容超過 Excel 單格上限，額外寫一份完整 diff 到檔案
                        const fullRemovedText = removed.map((item) => `L${item.lineNum}: ${item.text}`).join("\n");
                        const fullAddedText = added.map((item) => `L${item.lineNum}: ${item.text}`).join("\n");
                        const fullDiff = `=== ${fileName} / ${key} ===\n\n--- ${FOLDER_A} 移除/變更的行 (${removed.length} 行) ---\n${fullRemovedText}\n\n+++ ${FOLDER_B} 新增/變更的行 (${added.length} 行) +++\n${fullAddedText}\n`;
                        if (fullDiff.length > EXCEL_CELL_MAX) {
                            const diffDir = path.resolve(__dirname, "diff-details");
                            if (!fs.existsSync(diffDir)) fs.mkdirSync(diffDir);
                            const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
                            const diffFile = path.join(diffDir, `${safeFileName}.${key}.diff.txt`);
                            fs.writeFileSync(diffFile, fullDiff, "utf-8");
                            diffs[diffs.length - 1].folderA +=
                                `\n\n(完整 diff 見: diff-details/${safeFileName}.${key}.diff.txt)`;
                        }
                    }
                } else {
                    diffs.push({
                        field: key,
                        type: "內容不同",
                        folderA: truncate(strA, EXCEL_CELL_MAX),
                        folderB: truncate(strB, EXCEL_CELL_MAX),
                    });
                }
            }
        }
    }
    return diffs;
}

// ========== 主流程 ==========
console.log(`比對資料夾: ${FOLDER_A} vs ${FOLDER_B}`);
if (SHOW_FULL) console.log("模式: --show-full (順序不同也列出完整 diff)");
console.time("比對耗時");

const filesA = new Set(getJsonFiles(dirA));
const filesB = new Set(getJsonFiles(dirB));

const onlyInA = [...filesA].filter((f) => !filesB.has(f));
const onlyInB = [...filesB].filter((f) => !filesA.has(f));
const common = [...filesA].filter((f) => filesB.has(f));

console.log(`${FOLDER_A} 獨有: ${onlyInA.length} 個檔案`);
console.log(`${FOLDER_B} 獨有: ${onlyInB.length} 個檔案`);
console.log(`共同檔案: ${common.length} 個`);

// Sheet 1: 差異明細
const realDiffRows = [];
const orderOnlyRows = [];
let realDiffCount = 0; // 真正內容不同
let orderOnlyCount = 0; // 僅順序不同
let sameCount = 0; // 完全相同
let processed = 0;

for (const file of common) {
    const jsonA = readJson(path.join(dirA, file));
    const jsonB = readJson(path.join(dirB, file));
    const diffs = compareJson(jsonA, jsonB, file);

    if (diffs.length > 0) {
        // 判斷這個檔案是否全部差異都是「僅順序不同」
        const hasRealDiff = diffs.some((d) => d.type !== "僅順序不同");
        if (hasRealDiff) {
            realDiffCount++;
        } else {
            orderOnlyCount++;
        }

        for (const d of diffs) {
            const row = {
                檔案名稱: file,
                欄位: d.field,
                差異類型: d.type,
                [`${FOLDER_A} 的值`]: d.folderA,
                [`${FOLDER_B} 的值`]: d.folderB,
            };
            if (d.type === "僅順序不同") {
                orderOnlyRows.push(row);
            } else {
                realDiffRows.push(row);
            }
        }
    } else {
        sameCount++;
    }

    processed++;
    if (processed % 500 === 0 || processed === common.length) {
        process.stdout.write(`\r已處理: ${processed}/${common.length}`);
    }
}

console.log(`\n真正內容不同: ${realDiffCount} 個, 僅順序不同: ${orderOnlyCount} 個, 完全相同: ${sameCount} 個`);

// Sheet 2: 獨有檔案
const onlyRows = [];
for (const f of onlyInA) {
    const json = readJson(path.join(dirA, f));
    onlyRows.push({
        檔案名稱: f,
        所在資料夾: FOLDER_A,
        title: json.title || "",
        url: json.url || "",
    });
}
for (const f of onlyInB) {
    const json = readJson(path.join(dirB, f));
    onlyRows.push({
        檔案名稱: f,
        所在資料夾: FOLDER_B,
        title: json.title || "",
        url: json.url || "",
    });
}

// Sheet 3: 總覽
const summaryRows = [
    { 項目: `${FOLDER_A} 總檔案數`, 數量: filesA.size },
    { 項目: `${FOLDER_B} 總檔案數`, 數量: filesB.size },
    { 項目: "共同檔案數", 數量: common.length },
    { 項目: "真正內容不同", 數量: realDiffCount },
    { 項目: "僅順序不同", 數量: orderOnlyCount },
    { 項目: "內容完全相同", 數量: sameCount },
    { 項目: `僅在 ${FOLDER_A}`, 數量: onlyInA.length },
    { 項目: `僅在 ${FOLDER_B}`, 數量: onlyInB.length },
];

// 產生 Excel
const wb = XLSX.utils.book_new();

const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
wsSummary["!cols"] = [{ wch: 30 }, { wch: 10 }];
XLSX.utils.book_append_sheet(wb, wsSummary, "總覽");

if (realDiffRows.length > 0) {
    const wsReal = XLSX.utils.json_to_sheet(realDiffRows);
    wsReal["!cols"] = [{ wch: 50 }, { wch: 15 }, { wch: 12 }, { wch: 80 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsReal, "內容不同");
}

if (orderOnlyRows.length > 0) {
    const wsOrder = XLSX.utils.json_to_sheet(orderOnlyRows);
    wsOrder["!cols"] = [{ wch: 50 }, { wch: 15 }, { wch: 12 }, { wch: 80 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsOrder, "僅順序不同");
}

if (onlyRows.length > 0) {
    const wsOnly = XLSX.utils.json_to_sheet(onlyRows);
    wsOnly["!cols"] = [{ wch: 50 }, { wch: 20 }, { wch: 40 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsOnly, "獨有檔案");
}

XLSX.writeFile(wb, path.resolve(__dirname, OUTPUT_FILE));
console.timeEnd("比對耗時");
console.log(`結果已輸出: ${OUTPUT_FILE}`);
