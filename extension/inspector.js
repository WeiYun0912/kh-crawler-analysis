/**
 * Crawler Noise Inspector — Bookmarklet / Extension content script
 *
 * 用法：把這個檔案做成書籤（看 install-inspector.html）
 *      或裝 Chrome extension（看 extension/README.md）
 *
 * 在任何網頁點書籤/extension icon → 右上角浮出檢測結果
 */
(function () {
    // 已有就關掉（toggle 行為）
    const existing = document.getElementById('__crawler_inspector__');
    if (existing) { existing.remove(); return; }

    const url = location.href;
    const html = document.documentElement.outerHTML;
    const title = document.title;
    const bodyText = document.body.innerText || '';

    // ── Pattern 全資訊（給浮窗顯示用，跟 patterns catalog 對齊）──
    const PATTERN_INFO = {
        1:  { name: 'URL page 參數有/無',          impact: '同一頁的 URL 有/無 page=1 會被視為兩筆不同資料', solution: '站點規則 stripAllAHref' },
        2:  { name: '內嵌「回列表」連結漂移',      impact: '頁面內「回到 XX 列表」連結的 page 數隨時間變',    solution: '站點規則 stripAllAHref' },
        3:  { name: 'URL 重複 query 參數',         impact: '爬蟲組 URL 時把同個 key 加了兩次（程式 bug）',    solution: '修爬蟲程式 / 套 stripAllAHref' },
        4:  { name: 'URL 額外參數漂移',            impact: 'URL 含 appId2 等語意無關參數',                     solution: '站點規則 stripAllAHref' },
        5:  { name: '詳細頁「瀏覽次數」漂移',      impact: '頁面有獨立瀏覽計數器，每次刷新都會 +1',           solution: '站點規則 clearTableColumnsByHeader' },
        6:  { name: '列表頁多筆「瀏覽次數」漂移',  impact: '列表頁每筆公告都有獨立瀏覽欄，整批一起漂移',     solution: '站點規則 clearTableColumnsByHeader' },
        9:  { name: 'Footer「您是第 N 位瀏覽者」', impact: '訪客計數器整站共用、每次刷新都不同',              solution: 'filterAndConvertHtml inline regex（已預設套用所有站點）' },
        10: { name: 'Footer「更新日期 YYYY-MM-DD」', impact: '顯示當下日期（不是頁面真實 metadata），每天會變', solution: 'filterAndConvertHtml inline regex（已預設套用所有站點）' },
    };

    const findings = [];

    // ── Type 1: URL page 參數
    try {
        const u = new URL(url);
        if (u.searchParams.has('page')) {
            findings.push({ type: 1, evidence: 'URL 含 page=' + u.searchParams.get('page'), severity: 'low' });
        }
    } catch (e) {}

    // ── Type 2: 回列表連結
    const backLinks = [];
    document.querySelectorAll('a[title]').forEach(a => {
        const t = a.getAttribute('title') || '';
        if (/回到.*列表|回上頁|返回.*列表|回.*目錄/.test(t)) backLinks.push({ title: t });
    });
    if (backLinks.length > 0) {
        findings.push({
            type: 2,
            evidence: backLinks.length + ' 個連結，例：title="' + backLinks[0].title + '"',
            severity: 'mid',
        });
    }

    // ── Type 3: 重複 query key
    try {
        const u = new URL(url);
        const keys = [...u.searchParams.keys()];
        const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
        if (dup.length > 0) {
            findings.push({ type: 3, evidence: '重複的 key: ' + dup.join(', '), severity: 'high' });
        }
    } catch (e) {}

    // ── Type 4: appId2
    try {
        const u = new URL(url);
        if (u.searchParams.has('appId2')) {
            findings.push({ type: 4, evidence: 'appId2=' + u.searchParams.get('appId2'), severity: 'low' });
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
        const matchedHeader = headers[matchedIdx].textContent.trim();
        findings.push({
            type: rows.length <= 1 ? 5 : 6,
            evidence: '<th>' + matchedHeader + '</th>，tbody ' + rows.length + ' 列',
            severity: 'high',
        });
    });

    // ── Type 9: 您是第 N 位瀏覽者
    const visitorMatch = bodyText.match(/您是第\s*[\d,]+\s*位\s*(?:瀏覽者|訪客|讀者|看官|訪問者|來賓)?/);
    if (visitorMatch) {
        findings.push({ type: 9, evidence: visitorMatch[0], severity: 'high' });
    }

    // ── Type 10: Footer 更新日期戳
    const dateMatch = bodyText.match(/(?:更新日期|最後更新|最近更新|今日日期|查詢日期|系統日期|目前時間)[：:\s]*\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/);
    if (dateMatch) {
        findings.push({ type: 10, evidence: dateMatch[0], severity: 'high' });
    }

    // ──────────────────────────────────────────────
    //  Build UI Overlay
    // ──────────────────────────────────────────────

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const severityColors = {
        high: { bg: '#B45309', label: 'HIGH' },
        mid:  { bg: '#6B6258', label: 'MID' },
        low:  { bg: '#45617A', label: 'LOW' },
    };

    const panel = document.createElement('div');
    panel.id = '__crawler_inspector__';
    panel.style.cssText = [
        'position:fixed', 'top:20px', 'right:20px',
        'width:min(640px, calc(100vw - 40px))',
        'max-height:calc(100vh - 40px)',
        'background:#F4EFE4', 'border:1px solid #C9BFAE',
        'border-radius:6px', 'box-shadow:0 12px 40px -8px rgba(28,22,18,0.35)',
        "font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif",
        'font-size:13px', 'color:#1B1612', 'z-index:2147483647',
        'overflow:hidden', 'line-height:1.5',
        'display:flex', 'flex-direction:column'
    ].join(';');

    // ── Header ──
    const headerHtml = [
        '<div style="padding:14px 18px;border-bottom:1px solid #C9BFAE;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;background:#EFE8D9;flex-shrink:0;">',
          '<div style="min-width:0;flex:1;">',
            '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#7A1818;font-weight:600;margin-bottom:4px;">Crawler Noise Inspector</div>',
            '<div style="font-size:12px;color:#1B1612;font-weight:500;word-break:break-all;">' + esc(location.hostname + location.pathname) + '</div>',
            '<div style="font-size:11px;color:#5C5249;margin-top:2px;word-break:break-word;">' + esc(title || '(無標題)') + '</div>',
          '</div>',
          '<button id="__ci_close__" style="background:none;border:1px solid #C9BFAE;font-size:16px;width:26px;height:26px;cursor:pointer;border-radius:3px;color:#5C5249;line-height:1;flex-shrink:0;">×</button>',
        '</div>'
    ].join('');

    // ── Findings summary banner ──
    const summaryHtml = findings.length === 0
        ? '<div style="padding:18px;background:rgba(44,95,45,0.08);color:#2C5F2D;font-weight:500;border-bottom:1px solid #C9BFAE;flex-shrink:0;">✓ 沒偵測到已知 noise pattern — 這頁應該不會在 production 製造假異動。</div>'
        : (function () {
              const high = findings.filter(f => f.severity === 'high').length;
              const mid = findings.filter(f => f.severity === 'mid').length;
              const total = findings.length;
              const heat = high > 0 ? '⚠️' : '⚙️';
              return '<div style="padding:14px 18px;background:rgba(180,83,9,0.06);border-bottom:1px solid #C9BFAE;flex-shrink:0;">' +
                  '<div style="font-size:14px;font-weight:600;color:#B45309;">' + heat + ' 偵測到 ' + total + ' 種 noise pattern</div>' +
                  '<div style="font-size:12px;color:#5C5249;margin-top:4px;">' +
                  (high > 0 ? high + ' 個高影響 · ' : '') +
                  (mid > 0 ? mid + ' 個中影響 · ' : '') +
                  '若此站爬蟲已套對應規則，hash 不會受影響；否則此頁每天會在 production 製造假異動。' +
                  '</div>' +
              '</div>';
          })();

    // ── Finding cards ──
    const findingsHtml = findings.map(f => {
        const info = PATTERN_INFO[f.type] || { name: 'Type ' + f.type, impact: '—', solution: '—' };
        const sev = severityColors[f.severity] || severityColors.mid;
        return [
            '<article style="padding:14px 18px;border-bottom:1px solid #E0D6C2;">',
              '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">',
                '<span style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;background:#7A1818;color:#F4EFE4;padding:3px 8px;border-radius:2px;font-weight:700;letter-spacing:0.04em;">T' + String(f.type).padStart(2, '0') + '</span>',
                '<span style="font-size:14px;font-weight:600;color:#1B1612;">' + esc(info.name) + '</span>',
                '<span style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:9px;background:' + sev.bg + ';color:#F4EFE4;padding:2px 6px;border-radius:2px;letter-spacing:0.08em;">' + sev.label + '</span>',
              '</div>',
              '<div style="display:grid;grid-template-columns:54px 1fr;gap:6px 12px;font-size:12.5px;">',
                '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8B7E70;padding-top:2px;">影響</div>',
                '<div style="color:#1B1612;">' + esc(info.impact) + '</div>',
                '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8B7E70;padding-top:2px;">解法</div>',
                '<div style="color:#1B1612;"><code style="background:rgba(122,24,24,0.08);color:#7A1818;padding:1px 6px;border-radius:2px;font-family:\'Menlo\',\'Consolas\',monospace;font-size:11.5px;">' + esc(info.solution) + '</code></div>',
                '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8B7E70;padding-top:2px;">證據</div>',
                '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:11.5px;color:#5C5249;word-break:break-all;background:#EFE8D9;padding:6px 10px;border-radius:2px;border-left:2px solid #7A1818;">' + esc(f.evidence) + '</div>',
              '</div>',
            '</article>'
        ].join('');
    }).join('');

    // ── Actions footer ──
    const actionsHtml = [
        '<div style="padding:12px 18px;border-top:1px solid #C9BFAE;display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:#EFE8D9;flex-shrink:0;">',
          '<button id="__ci_copy__" style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:11px;padding:7px 14px;background:#7A1818;color:#F4EFE4;border:none;cursor:pointer;border-radius:3px;font-weight:600;">複製為 JSON</button>',
          '<button id="__ci_download__" style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:11px;padding:7px 14px;background:#F4EFE4;color:#1B1612;border:1px solid #C9BFAE;cursor:pointer;border-radius:3px;">下載 .json</button>',
          '<span style="flex:1;"></span>',
          '<a href="https://github.com/WeiYun0912/kh-crawler-analysis" target="_blank" rel="noopener" style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;color:#5C5249;text-decoration:none;">查看 pattern 完整文件 ↗</a>',
        '</div>'
    ].join('');

    panel.innerHTML = [
        headerHtml,
        summaryHtml,
        '<div style="overflow-y:auto;flex:1;min-height:0;">' + findingsHtml + '</div>',
        actionsHtml
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
