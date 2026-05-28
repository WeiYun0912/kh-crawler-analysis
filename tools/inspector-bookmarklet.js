/**
 * Crawler Noise Inspector — Bookmarklet / Extension content script
 *
 * 在任何網頁點書籤/extension icon → 右上角浮出檢測結果
 * 同步檔案：extension/inspector.js
 */
(function () {
    // 已有就關掉（toggle 行為）
    const existing = document.getElementById('__crawler_inspector__');
    if (existing) { existing.remove(); return; }

    const url = location.href;
    const html = document.documentElement.outerHTML;
    const title = document.title;
    const bodyText = document.body.innerText || '';

    // ── Pattern 全資訊 ──
    const PATTERN_INFO = {
        1:  { name: 'URL page 參數有/無',          impact: '同一頁的 URL 有/無 page=1 會被視為兩筆不同資料', solution: '站點規則 stripAllAHref' },
        2:  { name: '內嵌「回列表」連結漂移',      impact: '頁面內「回到 XX 列表」連結的 page 數隨時間變',    solution: '站點規則 stripAllAHref' },
        3:  { name: 'URL 重複 query 參數',         impact: '爬蟲組 URL 時把同個 key 加了兩次（程式 bug）',    solution: '修爬蟲程式 / 套 stripAllAHref' },
        4:  { name: 'URL 額外參數漂移',            impact: 'URL 含 appId2 等語意無關參數',                     solution: '站點規則 stripAllAHref' },
        5:  { name: '詳細頁「瀏覽次數」漂移',      impact: '頁面有獨立瀏覽計數器，每次刷新都會 +1',           solution: '站點規則 clearTableColumnsByHeader' },
        6:  { name: '列表頁多筆「瀏覽次數」漂移',  impact: '列表頁每筆公告都有獨立瀏覽欄，整批一起漂移',     solution: '站點規則 clearTableColumnsByHeader' },
        9:  { name: 'Footer「您是第 N 位瀏覽者」', impact: '訪客計數器整站共用、每次刷新都不同',              solution: 'filterAndConvertHtml inline regex' },
        10: { name: 'Footer「更新日期 YYYY-MM-DD」', impact: '顯示當下日期（不是真實 metadata），每天會變', solution: 'filterAndConvertHtml inline regex' },
    };

    // ── Helper: 在 DOM 找含某段文字的元素（最深層的）──
    function findTextOwner(needle) {
        if (!needle) return null;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            if (walker.currentNode.textContent.includes(needle)) {
                return walker.currentNode.parentElement;
            }
        }
        return null;
    }

    // ──────────────────────────────────────────────
    //  Detect findings
    // ──────────────────────────────────────────────
    const findings = [];

    // Type 1: URL page 參數
    try {
        const u = new URL(url);
        if (u.searchParams.has('page')) {
            findings.push({
                type: 1, severity: 'low',
                evidence: 'URL 含 page=' + u.searchParams.get('page'),
                details: { url, paramValue: u.searchParams.get('page') },
            });
        }
    } catch (e) {}

    // Type 2: 回列表連結
    const backLinks = [];
    document.querySelectorAll('a[title]').forEach(a => {
        const t = a.getAttribute('title') || '';
        if (/回到.*列表|回上頁|返回.*列表|回.*目錄/.test(t)) {
            backLinks.push({ title: t, href: a.getAttribute('href'), el: a });
        }
    });
    if (backLinks.length > 0) {
        findings.push({
            type: 2, severity: 'mid',
            evidence: backLinks.length + ' 個連結，例：title="' + backLinks[0].title + '"',
            domTarget: backLinks[0].el,
            details: { matches: backLinks },
        });
    }

    // Type 3: 重複 query key
    try {
        const u = new URL(url);
        const keys = [...u.searchParams.keys()];
        const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
        if (dup.length > 0) {
            findings.push({
                type: 3, severity: 'high',
                evidence: '重複的 key: ' + dup.join(', '),
                details: { url, dupKeys: dup, allParams: [...u.searchParams.entries()] },
            });
        }
    } catch (e) {}

    // Type 4: appId2
    try {
        const u = new URL(url);
        if (u.searchParams.has('appId2')) {
            findings.push({
                type: 4, severity: 'low',
                evidence: 'appId2=' + u.searchParams.get('appId2'),
                details: { url, paramValue: u.searchParams.get('appId2') },
            });
        }
    } catch (e) {}

    // Type 5/6: 表格 thead 含 noise 關鍵字
    const NOISE_KW = ['瀏覽', '點閱', '下載', '次數', '觀看', '查看', '閱讀'];
    document.querySelectorAll('table').forEach(table => {
        const headers = [...table.querySelectorAll('thead th')];
        if (!headers.length) return;
        const matchedIdx = headers.findIndex(th => NOISE_KW.some(k => (th.textContent || '').includes(k)));
        if (matchedIdx === -1) return;
        const rows = [...table.querySelectorAll('tbody tr')];
        const matchedHeader = headers[matchedIdx].textContent.trim();
        // 抽幾個 sample row 的對應 cell
        const sampleCells = rows.slice(0, 5).map(tr => {
            const tds = tr.querySelectorAll('td');
            return tds[matchedIdx] ? (tds[matchedIdx].textContent || '').trim() : '';
        });
        findings.push({
            type: rows.length <= 1 ? 5 : 6,
            severity: 'high',
            evidence: '<th>' + matchedHeader + '</th>，tbody ' + rows.length + ' 列',
            domTarget: table,
            details: {
                headerText: matchedHeader,
                columnIndex: matchedIdx,
                rowCount: rows.length,
                sampleCells,
                allHeaders: headers.map(h => h.textContent.trim()),
            },
        });
    });

    // Type 9: 您是第 N 位瀏覽者
    const visitorRe = /您是第\s*[\d,]+\s*位\s*(?:瀏覽者|訪客|讀者|看官|訪問者|來賓)?/;
    const visitorMatch = bodyText.match(visitorRe);
    if (visitorMatch) {
        const owner = findTextOwner(visitorMatch[0]);
        findings.push({
            type: 9, severity: 'high',
            evidence: visitorMatch[0],
            domTarget: owner,
            details: {
                matchedText: visitorMatch[0],
                ownerHtml: owner ? owner.outerHTML.slice(0, 200) : '(找不到 DOM 元素)',
                ownerSelector: owner ? owner.tagName.toLowerCase() + (owner.className ? '.' + owner.className.split(' ')[0] : '') : '',
            },
        });
    }

    // Type 10: Footer 更新日期戳
    const dateRe = /(?:更新日期|最後更新|最近更新|今日日期|查詢日期|系統日期|目前時間)[：:\s]*\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/;
    const dateMatch = bodyText.match(dateRe);
    if (dateMatch) {
        const owner = findTextOwner(dateMatch[0]);
        findings.push({
            type: 10, severity: 'high',
            evidence: dateMatch[0],
            domTarget: owner,
            details: {
                matchedText: dateMatch[0],
                ownerHtml: owner ? owner.outerHTML.slice(0, 200) : '(找不到 DOM 元素)',
                ownerSelector: owner ? owner.tagName.toLowerCase() + (owner.className ? '.' + owner.className.split(' ')[0] : '') : '',
            },
        });
    }

    // ──────────────────────────────────────────────
    //  UI helpers
    // ──────────────────────────────────────────────
    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    const severityColors = {
        high: { bg: '#B45309', label: 'HIGH' },
        mid:  { bg: '#6B6258', label: 'MID' },
        low:  { bg: '#45617A', label: 'LOW' },
    };

    // ──────────────────────────────────────────────
    //  Panel HTML
    // ──────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.id = '__crawler_inspector__';
    panel.style.cssText = [
        'position:fixed', 'top:20px', 'right:20px',
        'width:min(680px, calc(100vw - 40px))',
        'max-height:calc(100vh - 40px)',
        'background:#F4EFE4', 'border:1px solid #C9BFAE',
        'border-radius:6px', 'box-shadow:0 12px 40px -8px rgba(28,22,18,0.35)',
        "font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif",
        'font-size:13px', 'color:#1B1612', 'z-index:2147483647',
        'overflow:hidden', 'line-height:1.5',
        'display:flex', 'flex-direction:column'
    ].join(';');

    // Header
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

    // Summary banner
    const summaryHtml = findings.length === 0
        ? '<div style="padding:18px;background:rgba(44,95,45,0.08);color:#2C5F2D;font-weight:500;border-bottom:1px solid #C9BFAE;flex-shrink:0;">✓ 沒偵測到已知 noise pattern — 這頁應該不會在 production 製造假異動。</div>'
        : (function () {
              const high = findings.filter(f => f.severity === 'high').length;
              const mid = findings.filter(f => f.severity === 'mid').length;
              return '<div style="padding:14px 18px;background:rgba(180,83,9,0.06);border-bottom:1px solid #C9BFAE;flex-shrink:0;">' +
                  '<div style="font-size:14px;font-weight:600;color:#B45309;">⚠️ 偵測到 ' + findings.length + ' 種 noise pattern</div>' +
                  '<div style="font-size:12px;color:#5C5249;margin-top:4px;">' +
                  (high > 0 ? high + ' 個高影響 · ' : '') +
                  (mid > 0 ? mid + ' 個中影響 · ' : '') +
                  '若此站爬蟲已套對應規則，hash 不受影響；否則此頁每天會在 production 製造假異動。' +
                  '</div>' +
              '</div>';
          })();

    // 預先把 detail body 渲染好（之後 toggle 用）
    function renderDetailBody(f) {
        const d = f.details || {};
        const rows = [];
        if (f.type === 1) {
            rows.push(['完整 URL', d.url]);
            rows.push(['page 參數值', d.paramValue]);
        } else if (f.type === 2 && d.matches) {
            rows.push(['找到 ' + d.matches.length + ' 個「回列表」連結', d.matches.slice(0, 5).map(m => '• ' + m.title + (m.href ? ' → ' + m.href : '')).join('\n')]);
        } else if (f.type === 3) {
            rows.push(['完整 URL', d.url]);
            rows.push(['所有 query params', d.allParams.map(([k, v]) => k + '=' + v).join('\n')]);
        } else if (f.type === 4) {
            rows.push(['完整 URL', d.url]);
            rows.push(['appId2 值', d.paramValue]);
        } else if (f.type === 5 || f.type === 6) {
            rows.push(['完整 thead 結構', d.allHeaders.map((h, i) => (i === d.columnIndex ? '⮕ ' : '   ') + h).join('\n')]);
            rows.push(['對應 column index', String(d.columnIndex)]);
            rows.push(['前 5 列 cell 內容', d.sampleCells.map((c, i) => (i + 1) + '. ' + (c || '(空)')).join('\n')]);
            rows.push(['tbody 總列數', String(d.rowCount)]);
        } else if (f.type === 9 || f.type === 10) {
            rows.push(['匹配到的文字', d.matchedText]);
            rows.push(['DOM 元素', d.ownerSelector || '(unknown)']);
            rows.push(['元素 outerHTML (前 200 字)', d.ownerHtml]);
        }

        return rows.map(([label, val]) => [
            '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8B7E70;padding-top:8px;">' + esc(label) + '</div>',
            '<pre style="margin:6px 0 0;background:#1F1B17;color:#E8DEC8;padding:8px 10px;border-radius:3px;font-family:\'Menlo\',\'Consolas\',monospace;font-size:11.5px;white-space:pre-wrap;word-break:break-all;line-height:1.55;">' + esc(val || '') + '</pre>'
        ].join('')).join('');
    }

    // Render each finding card
    const findingsHtml = findings.map((f, idx) => {
        const info = PATTERN_INFO[f.type] || { name: 'Type ' + f.type, impact: '—', solution: '—' };
        const sev = severityColors[f.severity] || severityColors.mid;
        const hasTarget = !!f.domTarget;
        return [
            '<article style="padding:14px 18px;border-bottom:1px solid #E0D6C2;" data-idx="' + idx + '">',
              '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">',
                '<span style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;background:#7A1818;color:#F4EFE4;padding:3px 8px;border-radius:2px;font-weight:700;letter-spacing:0.04em;">T' + String(f.type).padStart(2, '0') + '</span>',
                '<span style="font-size:14px;font-weight:600;color:#1B1612;flex:1;">' + esc(info.name) + '</span>',
                '<span style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:9px;background:' + sev.bg + ';color:#F4EFE4;padding:2px 6px;border-radius:2px;letter-spacing:0.08em;">' + sev.label + '</span>',
                (hasTarget ? '<button class="__ci_highlight" data-idx="' + idx + '" title="在原網頁標亮這個元素" style="font-size:14px;border:1px solid #C9BFAE;background:#F4EFE4;width:28px;height:24px;border-radius:2px;cursor:pointer;line-height:1;padding:0;">👁</button>' : ''),
                '<button class="__ci_toggle" data-idx="' + idx + '" title="展開/收合詳情" style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:11px;border:1px solid #C9BFAE;background:#F4EFE4;color:#5C5249;padding:3px 9px;border-radius:2px;cursor:pointer;">▶ 詳情</button>',
              '</div>',
              '<div style="display:grid;grid-template-columns:54px 1fr;gap:6px 12px;font-size:12.5px;">',
                '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8B7E70;padding-top:2px;">影響</div>',
                '<div style="color:#1B1612;">' + esc(info.impact) + '</div>',
                '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8B7E70;padding-top:2px;">解法</div>',
                '<div style="color:#1B1612;"><code style="background:rgba(122,24,24,0.08);color:#7A1818;padding:1px 6px;border-radius:2px;font-family:\'Menlo\',\'Consolas\',monospace;font-size:11.5px;">' + esc(info.solution) + '</code></div>',
                '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8B7E70;padding-top:2px;">證據</div>',
                '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:11.5px;color:#5C5249;word-break:break-all;background:#EFE8D9;padding:6px 10px;border-radius:2px;border-left:2px solid #7A1818;">' + esc(f.evidence) + '</div>',
              '</div>',
              '<div class="__ci_detail" data-idx="' + idx + '" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed #C9BFAE;">' + renderDetailBody(f) + '</div>',
            '</article>'
        ].join('');
    }).join('');

    // Actions
    const actionsHtml = [
        '<div style="padding:12px 18px;border-top:1px solid #C9BFAE;display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:#EFE8D9;flex-shrink:0;">',
          '<button id="__ci_copy__" style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:11px;padding:7px 14px;background:#7A1818;color:#F4EFE4;border:none;cursor:pointer;border-radius:3px;font-weight:600;">複製為 JSON</button>',
          '<button id="__ci_download__" style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:11px;padding:7px 14px;background:#F4EFE4;color:#1B1612;border:1px solid #C9BFAE;cursor:pointer;border-radius:3px;">下載 .json</button>',
        '</div>'
    ].join('');

    panel.innerHTML = [
        headerHtml,
        summaryHtml,
        '<div style="overflow-y:auto;flex:1;min-height:0;">' + findingsHtml + '</div>',
        actionsHtml
    ].join('');

    document.body.appendChild(panel);

    // ──────────────────────────────────────────────
    //  Event handlers
    // ──────────────────────────────────────────────
    document.getElementById('__ci_close__').onclick = () => {
        clearHighlight();
        panel.remove();
    };

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

    // ── Toggle 詳情 ──
    panel.querySelectorAll('.__ci_toggle').forEach(btn => {
        btn.onclick = () => {
            const idx = btn.dataset.idx;
            const detailEl = panel.querySelector('.__ci_detail[data-idx="' + idx + '"]');
            if (!detailEl) return;
            const open = detailEl.style.display !== 'none';
            detailEl.style.display = open ? 'none' : 'block';
            btn.textContent = open ? '▶ 詳情' : '▼ 收合';
        };
    });

    // ──────────────────────────────────────────────
    //  標亮原網頁元素 — 框出 + 標籤 + toggle
    // ──────────────────────────────────────────────
    let currentHighlight = null;  // { target, origStyle, labelEl, currentBtn }

    function clearHighlight() {
        if (!currentHighlight) return;
        const { target, origStyle, labelEl, currentBtn } = currentHighlight;
        Object.assign(target.style, origStyle);
        if (labelEl && labelEl.parentNode) labelEl.parentNode.removeChild(labelEl);
        if (currentBtn) currentBtn.textContent = '👁';
        panel.style.opacity = '1';
        currentHighlight = null;
    }

    function highlightElement(target, finding, btn) {
        // 已標亮的 → 切掉
        if (currentHighlight && currentHighlight.target === target) {
            clearHighlight();
            return;
        }
        // 換一個 finding → 清掉上一個
        clearHighlight();

        const info = PATTERN_INFO[finding.type] || { name: 'Type ' + finding.type };
        const sev = severityColors[finding.severity] || severityColors.mid;

        // 滾動到位
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 把浮窗淡掉一下（用戶看標亮位置）
        panel.style.opacity = '0.35';

        // 套用厚紅框 + 紅色光暈
        const origStyle = {
            outline: target.style.outline,
            outlineOffset: target.style.outlineOffset,
            boxShadow: target.style.boxShadow,
            transition: target.style.transition,
            position: target.style.position,
            zIndex: target.style.zIndex,
            backgroundColor: target.style.backgroundColor,
        };
        target.style.transition = 'outline 0.2s, outline-offset 0.2s, box-shadow 0.2s, background-color 0.2s';
        target.style.outline = '4px solid ' + sev.bg;
        target.style.outlineOffset = '3px';
        target.style.boxShadow = '0 0 0 10px rgba(180, 83, 9, 0.18), 0 0 40px rgba(180, 83, 9, 0.35)';
        target.style.backgroundColor = 'rgba(180, 83, 9, 0.08)';

        // 加上標籤 callout（在元素上方或下方）
        const labelEl = document.createElement('div');
        labelEl.id = '__ci_highlight_label__';
        const rect = target.getBoundingClientRect();
        const labelText = 'T' + String(finding.type).padStart(2, '0') + ' · ' + info.name + ' — 這裡有問題';
        labelEl.style.cssText = [
            'position:absolute',
            'z-index:2147483647',
            'background:' + sev.bg,
            'color:#F4EFE4',
            "font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif",
            'font-size:13px',
            'font-weight:600',
            'padding:6px 14px',
            'border-radius:4px',
            'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
            'white-space:nowrap',
            'max-width:90vw',
            'overflow:hidden',
            'text-overflow:ellipsis',
            'pointer-events:none',
        ].join(';');
        labelEl.textContent = labelText;
        // 三角箭頭
        const arrow = document.createElement('div');
        arrow.style.cssText = [
            'position:absolute',
            'bottom:-6px',
            'left:24px',
            'width:0', 'height:0',
            'border-left:7px solid transparent',
            'border-right:7px solid transparent',
            'border-top:7px solid ' + sev.bg,
        ].join(';');
        labelEl.appendChild(arrow);
        document.body.appendChild(labelEl);

        // 算 label 位置（在元素上方；若空間不夠就在下方）
        const labelRect = labelEl.getBoundingClientRect();
        const elTop = rect.top + window.scrollY;
        const placeAbove = rect.top >= labelRect.height + 16;
        if (placeAbove) {
            labelEl.style.top = (elTop - labelRect.height - 10) + 'px';
            labelEl.style.left = (rect.left + window.scrollX + 8) + 'px';
        } else {
            // 改放下方，且翻轉箭頭
            labelEl.style.top = (elTop + rect.height + 10) + 'px';
            labelEl.style.left = (rect.left + window.scrollX + 8) + 'px';
            arrow.style.cssText = [
                'position:absolute',
                'top:-6px', 'left:24px',
                'width:0', 'height:0',
                'border-left:7px solid transparent',
                'border-right:7px solid transparent',
                'border-bottom:7px solid ' + sev.bg,
            ].join(';');
        }

        // 浮窗 1.5 秒後恢復不透明（用戶能繼續操作浮窗）
        setTimeout(() => { panel.style.opacity = '1'; }, 1500);

        currentHighlight = { target, origStyle, labelEl, currentBtn: btn };
        btn.textContent = '✕';  // 點同一個會切掉
    }

    panel.querySelectorAll('.__ci_highlight').forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.idx);
            const f = findings[idx];
            if (!f || !f.domTarget) return;
            highlightElement(f.domTarget, f, btn);
        };
    });

    // 按 Esc 取消標亮
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape' && currentHighlight) {
            clearHighlight();
        }
        if (e.key === 'Escape' && !document.getElementById('__crawler_inspector__')) {
            document.removeEventListener('keydown', escHandler);
        }
    });

})();
