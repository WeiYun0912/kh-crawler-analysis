/**
 * Crawler Noise Inspector — Bookmarklet
 *
 * 用法：把這個檔案做成書籤（看 install-inspector.html）
 * 在任何網頁點書籤 → 右上角浮出檢測結果
 *
 * 偵測：與桌面分析器 PATTERN_DEFS 對齊的 10 種類型（部分）
 *  - Type 1: URL 含 page 參數
 *  - Type 2: 含「回 XX 列表」連結
 *  - Type 3: URL 有重複 query key
 *  - Type 4: URL 有 appId2
 *  - Type 5/6: 表格 thead 含瀏覽/點閱/下載
 *  - Type 9: 您是第 N 位瀏覽者
 *  - Type 10: Footer 更新日期戳
 */
(function () {
    // 若已有開著就先關掉（讓重新點變成 toggle）
    const existing = document.getElementById('__crawler_inspector__');
    if (existing) { existing.remove(); return; }

    const url = location.href;
    const html = document.documentElement.outerHTML;
    const title = document.title;
    const bodyText = document.body.innerText || '';
    const findings = [];

    // ── Type 1: URL page 參數
    try {
        const u = new URL(url);
        if (u.searchParams.has('page')) {
            findings.push({
                type: 1, name: 'URL page 參數',
                evidence: 'URL 含 page=' + u.searchParams.get('page'),
                severity: 'low',
            });
        }
    } catch (e) {}

    // ── Type 2: 回列表連結
    const backLinks = [];
    document.querySelectorAll('a[title]').forEach(a => {
        const t = a.getAttribute('title') || '';
        if (/回到.*列表|回上頁|返回.*列表|回.*目錄/.test(t)) {
            backLinks.push({ title: t });
        }
    });
    if (backLinks.length > 0) {
        findings.push({
            type: 2, name: '回列表連結',
            evidence: backLinks.length + ' 個，例：title="' + backLinks[0].title + '"',
            severity: 'mid',
        });
    }

    // ── Type 3: 重複 query key
    try {
        const u = new URL(url);
        const keys = [...u.searchParams.keys()];
        const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
        if (dup.length > 0) {
            findings.push({
                type: 3, name: 'URL 重複 query 參數',
                evidence: '重複 key: ' + dup.join(', '),
                severity: 'high',
            });
        }
    } catch (e) {}

    // ── Type 4: appId2
    try {
        const u = new URL(url);
        if (u.searchParams.has('appId2')) {
            findings.push({
                type: 4, name: 'URL appId2 參數',
                evidence: 'appId2=' + u.searchParams.get('appId2'),
                severity: 'low',
            });
        }
    } catch (e) {}

    // ── Type 5/6: 表格 thead 含 noise 關鍵字
    const NOISE_KW = ['瀏覽', '點閱', '下載', '次數', '觀看', '查看', '閱讀'];
    document.querySelectorAll('table').forEach(table => {
        const headers = [...table.querySelectorAll('thead th')];
        if (!headers.length) return;
        const matchedIdx = headers.findIndex(th => NOISE_KW.some(k => (th.textContent || '').includes(k)));
        if (matchedIdx === -1) return;
        const rows = table.querySelectorAll('tbody tr');
        findings.push({
            type: rows.length <= 1 ? 5 : 6,
            name: rows.length <= 1 ? '詳細頁瀏覽欄' : '列表頁多筆瀏覽欄',
            evidence: '<th>' + headers[matchedIdx].textContent.trim() + '</th>，' + rows.length + ' 列',
            severity: 'high',
        });
    });

    // ── Type 9: 您是第 N 位瀏覽者
    const visitorMatch = bodyText.match(/您是第\s*[\d,]+\s*位\s*(?:瀏覽者|訪客|讀者|看官|訪問者|來賓)?/);
    if (visitorMatch) {
        findings.push({
            type: 9, name: 'Footer 訪客計數器',
            evidence: visitorMatch[0],
            severity: 'high',
        });
    }

    // ── Type 10: Footer 更新日期戳
    const dateMatch = bodyText.match(/(?:更新日期|最後更新|最近更新|今日日期|查詢日期|系統日期|目前時間)[：:\s]*\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/);
    if (dateMatch) {
        findings.push({
            type: 10, name: 'Footer 更新日期戳',
            evidence: dateMatch[0],
            severity: 'high',
        });
    }

    // ── Build UI Overlay ──
    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const panel = document.createElement('div');
    panel.id = '__crawler_inspector__';
    panel.style.cssText = [
        'position:fixed', 'top:20px', 'right:20px', 'width:380px',
        'max-height:calc(100vh - 40px)', 'background:#F4EFE4', 'border:1px solid #C9BFAE',
        'border-radius:4px', 'box-shadow:0 8px 32px -8px rgba(28,22,18,0.3)',
        "font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif",
        'font-size:13px', 'color:#1B1612', 'z-index:2147483647',
        'overflow:auto', 'line-height:1.5'
    ].join(';');

    const findingsHtml = findings.length === 0
        ? '<div style="padding:24px;text-align:center;color:#2C5F2D;font-style:italic;">✓ 沒偵測到已知 noise pattern</div>'
        : findings.map(f => {
            const color = f.severity === 'high' ? '#B45309' : f.severity === 'mid' ? '#6B6258' : '#45617A';
            return [
                '<div style="padding:12px 16px;border-bottom:1px solid #E0D6C2;">',
                  '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;">',
                    '<span style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;background:' + color + ';color:#F4EFE4;padding:2px 6px;border-radius:2px;font-weight:600;">T' + String(f.type).padStart(2, '0') + '</span>',
                    '<span style="font-weight:600;">' + esc(f.name) + '</span>',
                  '</div>',
                  '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:11px;color:#5C5249;word-break:break-all;">' + esc(f.evidence) + '</div>',
                '</div>'
            ].join('');
        }).join('');

    panel.innerHTML = [
        '<div style="padding:12px 16px;border-bottom:1px solid #C9BFAE;display:flex;justify-content:space-between;align-items:center;">',
          '<div>',
            '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#7A1818;font-weight:600;">Crawler Noise Inspector</div>',
            '<div style="font-size:11px;color:#5C5249;margin-top:2px;">' + esc(location.hostname) + '</div>',
          '</div>',
          '<button id="__ci_close__" style="background:none;border:1px solid #C9BFAE;font-size:16px;width:24px;height:24px;cursor:pointer;border-radius:2px;color:#5C5249;line-height:1;">×</button>',
        '</div>',
        '<div style="padding:0;">' + findingsHtml + '</div>',
        '<div style="padding:12px 16px;border-top:1px solid #C9BFAE;display:flex;gap:8px;flex-wrap:wrap;">',
          '<button id="__ci_copy__" style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:11px;padding:6px 12px;background:#7A1818;color:#F4EFE4;border:none;cursor:pointer;border-radius:2px;">複製為 JSON</button>',
          '<button id="__ci_download__" style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:11px;padding:6px 12px;background:#F4EFE4;color:#1B1612;border:1px solid #C9BFAE;cursor:pointer;border-radius:2px;">下載 .json</button>',
        '</div>'
    ].join('');

    document.body.appendChild(panel);

    document.getElementById('__ci_close__').onclick = () => panel.remove();

    document.getElementById('__ci_copy__').onclick = async () => {
        const data = { url, title, html };
        const btn = document.getElementById('__ci_copy__');
        try {
            await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
            const orig = btn.textContent;
            btn.textContent = '✓ 已複製到剪貼簿';
            setTimeout(() => { btn.textContent = orig; }, 1500);
        } catch (e) {
            alert('複製失敗: ' + e.message);
        }
    };

    document.getElementById('__ci_download__').onclick = () => {
        const data = { url, title, html };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = location.hostname.replace(/\./g, '_') + '_' + Date.now() + '.html.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    };
})();
