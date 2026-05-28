// 分析 yak 兩天 only-in-X 對的 URL pattern
const fs = require('fs');
const path = require('path');

function loadIndex(dir) {
    const map = new Map();          // url → filename
    const byFile = new Map();        // filename → url
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
            if (j.url) {
                map.set(j.url, f);
                byFile.set(f, j.url);
            }
        } catch (e) {}
    }
    return { map, byFile };
}

const A = loadIndex('yak-0527');
const B = loadIndex('yak-0528');

const urlsA = new Set(A.map.keys());
const urlsB = new Set(B.map.keys());

const onlyAUrls = [...urlsA].filter(u => !urlsB.has(u));
const onlyBUrls = [...urlsB].filter(u => !urlsA.has(u));

console.log(`only-in-A URLs: ${onlyAUrls.length}`);
console.log(`only-in-B URLs: ${onlyBUrls.length}`);
console.log();

// 用 normalize URL 配對 — 排除 trailing slash 差異
function normalize(url) {
    return url.replace(/\/+$/, '').toLowerCase();
}

const normMapA = new Map();
for (const u of onlyAUrls) {
    const n = normalize(u);
    if (!normMapA.has(n)) normMapA.set(n, []);
    normMapA.get(n).push(u);
}
const normMapB = new Map();
for (const u of onlyBUrls) {
    const n = normalize(u);
    if (!normMapB.has(n)) normMapB.set(n, []);
    normMapB.get(n).push(u);
}

// 找出 normalize 後配對到的對
const trailingSlashPairs = [];
const otherOnlyA = [];
const otherOnlyB = [];

for (const [n, aUrls] of normMapA) {
    const bUrls = normMapB.get(n);
    if (bUrls) {
        for (const a of aUrls) {
            for (const b of bUrls) {
                trailingSlashPairs.push({ a, b });
            }
        }
    } else {
        otherOnlyA.push(...aUrls);
    }
}
for (const [n, bUrls] of normMapB) {
    if (!normMapA.has(n)) otherOnlyB.push(...bUrls);
}

console.log(`=== 配對結果 ===`);
console.log(`✓ trailing slash 差異配對到: ${trailingSlashPairs.length} 對`);
console.log(`✗ 真正只在 A 的 URL: ${otherOnlyA.length}`);
console.log(`✗ 真正只在 B 的 URL: ${otherOnlyB.length}`);

// 看其他 only-A / only-B 是不是另有規律
console.log(`\n=== trailing slash 對的前 10 例 ===`);
trailingSlashPairs.slice(0, 10).forEach(p => {
    console.log(`  A: ${p.a}`);
    console.log(`  B: ${p.b}`);
});

console.log(`\n=== 真正只在 A 的前 15 個 URL ===`);
otherOnlyA.slice(0, 15).forEach(u => console.log(`  ${u}`));

console.log(`\n=== 真正只在 B 的前 15 個 URL ===`);
otherOnlyB.slice(0, 15).forEach(u => console.log(`  ${u}`));
