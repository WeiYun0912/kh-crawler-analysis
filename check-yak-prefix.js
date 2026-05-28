// 統計 yak 兩天 URL 路徑的「前綴/系列」分布
const fs = require('fs');
const path = require('path');

function loadUrls(dir) {
    const urls = [];
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
            if (j.url) urls.push(j.url);
        } catch (e) {}
    }
    return urls;
}

function pathPrefix(url) {
    try {
        const u = new URL(url);
        // 取 /tw/XXX 這層 → XXX
        const segs = u.pathname.split('/').filter(Boolean);  // ['tw', 'artist2017', '11']
        if (segs.length === 0) return '/';
        return '/' + segs[0] + (segs.length > 1 ? '/' + segs[1].replace(/\d+$/, '*').replace(/^\d+$/, '*') : '');
    } catch (e) {
        return '?';
    }
}

const urlsA = loadUrls('yak-0527');
const urlsB = loadUrls('yak-0528');

function countPrefix(urls) {
    const counts = new Map();
    for (const u of urls) {
        const p = pathPrefix(u);
        counts.set(p, (counts.get(p) || 0) + 1);
    }
    return counts;
}

const cA = countPrefix(urlsA);
const cB = countPrefix(urlsB);

const allPrefixes = new Set([...cA.keys(), ...cB.keys()]);
const rows = [...allPrefixes].map(p => ({
    prefix: p,
    a: cA.get(p) || 0,
    b: cB.get(p) || 0,
    diff: (cB.get(p) || 0) - (cA.get(p) || 0),
})).sort((x, y) => (y.a + y.b) - (x.a + x.b));

console.log('=== Prefix 分布（依總數排序）===');
console.log('Prefix'.padEnd(35) + 'A'.padStart(6) + 'B'.padStart(6) + 'B-A'.padStart(7));
console.log('─'.repeat(54));
for (const r of rows) {
    const marker = r.a > 0 && r.b === 0 ? '  ⚠ A 獨有' : r.a === 0 && r.b > 0 ? '  ⚠ B 獨有' : '';
    console.log(r.prefix.padEnd(35) + String(r.a).padStart(6) + String(r.b).padStart(6) + String(r.diff).padStart(7) + marker);
}

// 看「A 完全沒 / B 有」、「A 有 / B 完全沒」的 prefix
const aMissing = rows.filter(r => r.a === 0 && r.b > 0);
const bMissing = rows.filter(r => r.b === 0 && r.a > 0);
console.log(`\n=== A 完全沒爬到的 prefix: ${aMissing.length} 個（B 共 ${aMissing.reduce((s, r) => s + r.b, 0)} 筆）===`);
console.log(`=== B 完全沒爬到的 prefix: ${bMissing.length} 個（A 共 ${bMissing.reduce((s, r) => s + r.a, 0)} 筆）===`);
