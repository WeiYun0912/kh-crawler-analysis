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

    // Hash preview section
    const hashHtml = [
        '<div id="__ci_hash_section" style="padding:14px 18px;border-bottom:1px solid #E0D6C2;background:rgba(122,24,24,0.03);">',
          '<div style="font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#7A1818;font-weight:600;margin-bottom:8px;">Production Pipeline Preview</div>',
          '<div id="__ci_hash_status" style="font-size:12px;color:#5C5249;">⏳ 載入 turndown + md5 中…</div>',
        '</div>'
    ].join('');

    // Actions
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
        '<div style="overflow-y:auto;flex:1;min-height:0;">' + findingsHtml + hashHtml + '</div>',
        actionsHtml
    ].join('');

    document.body.appendChild(panel);

    // ──────────────────────────────────────────────
    //  Event handlers
    // ──────────────────────────────────────────────
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

    // ── 標亮原網頁元素 ──
    panel.querySelectorAll('.__ci_highlight').forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.idx);
            const target = findings[idx] && findings[idx].domTarget;
            if (!target) return;
            // 先暫時隱藏浮窗（不要擋住）
            const origZ = panel.style.zIndex;
            panel.style.opacity = '0.3';
            // 滾動 + 高亮
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const origOutline = target.style.outline;
            const origOutlineOffset = target.style.outlineOffset;
            const origTransition = target.style.transition;
            target.style.transition = 'outline 0.2s, outline-offset 0.2s, box-shadow 0.2s';
            target.style.outline = '3px solid #B45309';
            target.style.outlineOffset = '2px';
            target.style.boxShadow = '0 0 0 4px rgba(180, 83, 9, 0.25)';
            setTimeout(() => {
                target.style.outline = origOutline;
                target.style.outlineOffset = origOutlineOffset;
                target.style.boxShadow = '';
                target.style.transition = origTransition;
                panel.style.opacity = '1';
            }, 3500);
        };
    });

    // ──────────────────────────────────────────────
    //  Hash computation (async, load turndown + md5)
    // ──────────────────────────────────────────────
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector('script[data-ci-lib="' + src + '"]')) return resolve();
            const s = document.createElement('script');
            s.src = src;
            s.dataset.ciLib = src;
            s.onload = resolve;
            s.onerror = (e) => reject(new Error('Load failed: ' + src));
            document.head.appendChild(s);
        });
    }

    const INLINE_COUNTER_REGEX = /(?:總|目前|累積|累計|統計)?(?:點閱|點閱率|點閱數|點閱次|點閱人次|點閱人數|觀看|觀看率|觀看次|觀看數|觀看人數|觀看人次|瀏覽|瀏覽率|瀏覽次|瀏覽人次|瀏覽人數|查看|查看率|查看次|查看人次|查看人數|點擊|點擊率|點擊次|點擊人次|點擊人數|閱讀|閱讀率|閱讀次|閱讀人次|閱讀人數|累積|累積率|累積次|累積人次|累積人數|到站|到站率|到站次|到站人次|到站人數|到訪|到訪人數|到訪人次|到訪次|訪問|訪問人次|訪問人數|訪問數)(?:[：:－\-＞>]\s*|\s*)\d+/g;
    const INLINE_VISITOR_REGEX = /您是第[\s\S]{0,30}?\d[\d,]*[\s\S]{0,15}?位\s*(?:瀏覽者|訪客|讀者|看官|訪問者|來賓)?/g;
    const INLINE_FOOTER_DATE_REGEX = /(?:更新日期|最後更新|最近更新|今日日期|查詢日期|系統日期|目前時間)[\s\S]{0,30}?\d{4}[\s\S]{0,5}?[-\/.]\s*\d{1,2}\s*[-\/.]\s*\d{1,2}(?:[\s\S]{0,15}?\d{1,2}:\d{2}(?::\d{2})?)?(?:\s*<\/[a-zA-Z]+>)*/g;

    // 簡化版 production cleanup（mirror filterAndConvertHtml 的 cheerio 部分）
    function cleanupForHash(doc) {
        doc.querySelectorAll('[onclick], [onmouseover], [onmousedown]').forEach(el => el.remove());
        doc.querySelectorAll('a[href^="javascript:"], script, style, a[href="#"], meta, link, noscript, img, .advertisement, .footer, div.toplink.nosnippet, div.advanced_search, a[onmousedown]').forEach(el => el.remove());
        doc.querySelectorAll('iframe').forEach(iframe => {
            const src = iframe.getAttribute('src');
            if (src && /^https:\/\/www\.google\.com\/maps\/embed/.test(src)) { iframe.remove(); return; }
            if (src) {
                const p = doc.createElement('p');
                p.textContent = src;
                iframe.replaceWith(p);
            }
        });
    }

    async function computeHashPreview() {
        const statusEl = document.getElementById('__ci_hash_status');
        try {
            await loadScript('https://cdn.jsdelivr.net/npm/turndown@7.1.2/dist/turndown.js');
            await loadScript('https://cdn.jsdelivr.net/npm/blueimp-md5@2.19.0/js/md5.min.js');

            const TS = window.TurndownService;
            const _md5 = window.md5;
            if (!TS || !_md5) throw new Error('library 載入後找不到 TurndownService / md5');

            const doc = new DOMParser().parseFromString(html, 'text/html');
            cleanupForHash(doc);
            let filteredHtml = doc.body.innerHTML;
            filteredHtml = filteredHtml.replace(/\n{2,}/g, '\n')
                .replace(INLINE_COUNTER_REGEX, '')
                .replace(INLINE_VISITOR_REGEX, '')
                .replace(INLINE_FOOTER_DATE_REGEX, '');
            const td = new TS();
            let markdown = td.turndown(filteredHtml);
            markdown = markdown.trim().replace(/(\r?\n\s*){2,}/g, '\n').replace(/ {3,}/g, ' ');

            // production hash 公式：md5(markdown + title + JSON(sortedMeta) + version)
            // 我們沒有 crawler 的 meta_data，用空 {} 當預估
            const metaJson = '{}';
            const hashInput = markdown + (title || '') + metaJson + 'v2.3';
            const hashHex = _md5(hashInput);

            statusEl.innerHTML = [
                '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12px;">',
                  '<div style="color:#8B7E70;font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;padding-top:2px;">Markdown size</div>',
                  '<div style="color:#1B1612;font-family:\'Menlo\',\'Consolas\',monospace;">' + markdown.length.toLocaleString() + ' chars · ' + markdown.split('\n').length + ' lines</div>',
                  '<div style="color:#8B7E70;font-family:\'Menlo\',\'Consolas\',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;padding-top:2px;">預估 md5</div>',
                  '<div style="font-family:\'Menlo\',\'Consolas\',monospace;color:#7A1818;font-weight:600;word-break:break-all;">' + hashHex + ' <button id="__ci_copyhash" style="font-family:\'Menlo\',monospace;font-size:9px;letter-spacing:0.08em;padding:2px 8px;border:1px solid #C9BFAE;background:#F4EFE4;color:#5C5249;cursor:pointer;border-radius:2px;margin-left:6px;">複製</button></div>',
                '</div>',
                '<div style="font-size:11px;color:#8B7E70;margin-top:8px;">⚠ 此 hash 假設 meta_data 為空 {}。Production 實際 hash 還會加上 crawler 抽出的 meta（如 category、updated_at），所以可能跟此值不同。但能驗證「清洗後的 markdown 是否乾淨」。</div>',
            ].join('');

            document.getElementById('__ci_copyhash').onclick = async () => {
                try {
                    await navigator.clipboard.writeText(hashHex);
                    document.getElementById('__ci_copyhash').textContent = '✓';
                    setTimeout(() => {
                        const b = document.getElementById('__ci_copyhash');
                        if (b) b.textContent = '複製';
                    }, 1200);
                } catch (e) {}
            };
        } catch (e) {
            statusEl.innerHTML = '<span style="color:#B45309;">⚠ 無法載入 turndown/md5 library（可能該站點 CSP 擋掉）。<br><span style="font-size:11px;color:#5C5249;">改用「下載 .json」拖到桌面分析器算 hash。</span></span>';
        }
    }
    computeHashPreview();
})();
