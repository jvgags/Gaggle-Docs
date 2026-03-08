const App = (() => {
  // ── DOM refs ─────────────────────────────────────────────────
  const editor      = document.getElementById('editor');
  const docTitle    = document.getElementById('docTitle');
  const docTitleDisplay = document.getElementById('docTitleDisplay');
  const docTitleWrap    = document.getElementById('docTitleWrap');
  const savedStatus = document.getElementById('savedStatus');
  const wordCountEl = document.getElementById('wordCount');
  const statusWC    = document.getElementById('statusWordCount');
  const statusZoom  = document.getElementById('statusZoom');
  const findBar     = document.getElementById('findBar');
  const saveMenu    = document.getElementById('saveMenu');
  const exportBtn   = document.getElementById('exportBtn');
  const outlineSidebar = document.getElementById('outlineSidebar');
  const outlineList    = document.getElementById('outlineList');
  const hlPicker       = document.getElementById('hlPicker');
  const hlSwatches     = document.getElementById('hlSwatches');
  const hlColorSwatch  = document.getElementById('hlColorSwatch');

  // ── State ────────────────────────────────────────────────────
  let zoomLevel    = 100;
  let saveTimer    = null;
  let isDirty      = false;
  let currentDocId = null;
  let outlineOpen  = false;
  let currentHL    = '#FFFF00';
  let hlPickerOpen = false;
  let savedRange   = null;
  let uiTheme      = 'light';
  let pageTheme    = 'light';
  let settingsOpen = false;
  let novelMode    = false;

  const DEFAULT_SETTINGS_KEY = 'gd_default_settings';
  const DEFAULT_SETTINGS = { font: 'Georgia', fontSize: '12', lineSpacing: '1.6', zoom: '100' };

  const STORE_PREFIX = 'docs_v1_';
  const INDEX_KEY    = 'docs_v1_index';

  // Highlight color palette (Google Docs-style)
  const HL_COLORS = [
    '#FFFF00', '#00FFFF', '#00FF00', '#FF00FF', '#FF0000', '#0000FF', '#FF8000', '#8000FF',
    '#FFFF80', '#80FFFF', '#80FF80', '#FF80FF', '#FF8080', '#8080FF', '#FFD080', '#C0C0C0',
    '#FFFFE0', '#E0FFFF', '#E0FFE0', '#FFE0FF', '#FFE0E0', '#E0E0FF', '#FFE8C0', '#F0F0F0',
    '#FFF0A0', '#A0FFF0', '#A0FFA0', '#F0A0FF', '#FFA0A0', '#A0A0FF', '#FFCC80', '#E0E0E0',
  ];

  // ── INIT ─────────────────────────────────────────────────────
  function init() {
    editor.innerHTML =
      '<h1>Welcome to Gaggle Docs</h1>' +
      '<p>Start typing, or use <strong>File &rarr; My Documents</strong> to load a saved document.</p>' +
      '<h2>Features</h2>' +
      '<ul>' +
      '<li><strong>Rich formatting</strong> &mdash; bold, italic, underline, headings, lists, tables</li>' +
      '<li><strong>Save / Load</strong> &mdash; multiple documents stored in browser localStorage</li>' +
      '<li><strong>Import</strong> &mdash; open .html, .md, or .txt files from disk</li>' +
      '<li><strong>Export</strong> &mdash; Markdown, Word (.docx), Rich Text (.rtf), HTML, plain text</li>' +
      '<li><strong>Smart toolbar</strong> &mdash; reflects font, size &amp; style at the cursor</li>' +
      '<li><strong>Highlight picker</strong> &mdash; choose from a color palette or remove highlight</li>' +
      '<li><strong>Document outline</strong> &mdash; click any heading to jump to it</li>' +
      '<li><strong>Themes</strong> &mdash; Light, Sepia, and Dark for both the UI and the page</li>' +
      '</ul>' +
      '<h2>Getting started</h2>' +
      '<h3>Outline</h3>' +
      '<p>Click the outline button in the toolbar (or press Ctrl+Alt+O) to open the document outline panel.</p>' +
      '<h3>Highlight</h3>' +
      '<p>Select text, then click the highlighter button to pick a color &mdash; or choose <em>None</em> to remove highlighting.</p>' +
      '<h3>Themes</h3>' +
      '<p>Click the <strong>&#9881;</strong> gear icon in the bottom-right of the status bar to open Settings and choose your UI and page themes independently.</p>';

    buildHlSwatches();
    updateWordCount();
    bindEvents();
    setInterval(autoSave, 15000);
    refreshOutline();
    loadThemes();
    loadDefaultSettings();
    loadNovelMode();
  }

  // ── BUILD HIGHLIGHT SWATCHES ──────────────────────────────────
  function buildHlSwatches() {
    hlSwatches.innerHTML = '';
    HL_COLORS.forEach(function(color) {
      var sw = document.createElement('div');
      sw.className = 'hl-swatch' + (color === currentHL ? ' selected' : '');
      sw.style.background = color;
      sw.title = color;
      sw.addEventListener('click', function() { setHighlight(color); });
      hlSwatches.appendChild(sw);
    });
  }

  // ── PASTE HANDLER ─────────────────────────────────────────────
  function handlePaste(e) {
    var text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!text || !looksLikeMarkdown(text)) return; // let browser handle normal pastes
    e.preventDefault();
    var html = mdToHtml(text);
    document.execCommand('insertHTML', false, html);
    markDirty(); updateWordCount(); scheduleSave(); refreshOutline();
  }

  function looksLikeMarkdown(text) {
    // Must have at least one clear markdown pattern to trigger conversion
    return (
      /^#{1,6}\s+\S/m.test(text)          ||  // headings
      /^\s*[-*+]\s+\S/m.test(text)        ||  // unordered list
      /^\s*\d+\.\s+\S/m.test(text)        ||  // ordered list
      /\*\*[^*]+\*\*/.test(text)          ||  // bold
      /\*[^*\n]+\*/.test(text)            ||  // italic
      /`[^`\n]+`/.test(text)              ||  // inline code
      /^```/m.test(text)                  ||  // fenced code block
      /^\s*>\s+\S/m.test(text)            ||  // blockquote
      /^\s*---+\s*$/m.test(text)          ||  // horizontal rule
      /\[.+\]\(.+\)/.test(text)               // link
    );
  }

  // ── EVENTS ───────────────────────────────────────────────────
  function bindEvents() {
    editor.addEventListener('paste', handlePaste);
    editor.addEventListener('input', function() { markDirty(); updateWordCount(); scheduleSave(); refreshOutline(); });
    editor.addEventListener('keyup',   syncToolbar);
    editor.addEventListener('mouseup', syncToolbar);
    editor.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertHTML', false, '\u00a0\u00a0\u00a0\u00a0'); }
    });
    document.addEventListener('selectionchange', syncToolbar);
    document.addEventListener('keydown', handleShortcuts);
    docTitle.addEventListener('input', function() { docTitleDisplay.textContent = docTitle.value || 'Untitled document'; markDirty(); scheduleSave(); });

    exportBtn.addEventListener('click', function(e) { e.stopPropagation(); saveMenu.classList.toggle('open'); });

    // Close all popups when clicking outside
    document.addEventListener('click', function(e) {
      saveMenu.classList.remove('open');
      if (hlPickerOpen && !document.getElementById('hlWrap').contains(e.target)) {
        closeHlPicker();
      }
      if (settingsOpen && !document.getElementById('settingsPanel').contains(e.target)
          && e.target.id !== 'settingsBtn') {
        settingsOpen = false;
        document.getElementById('settingsPanel').classList.remove('open');
      }
    });

    // Color picker proxy
    document.querySelector('.color-btn-wrap .tb-btn').addEventListener('click', function() {
      document.getElementById('textColor').click();
    });
  }

  function handleShortcuts(e) {
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'o') {
      e.preventDefault(); toggleOutline(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault(); copyAsMarkdown(); return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    switch (e.key.toLowerCase()) {
      case 'b': e.preventDefault(); fmt('bold');      break;
      case 'i': e.preventDefault(); fmt('italic');    break;
      case 'u': e.preventDefault(); fmt('underline'); break;
      case 'h': e.preventDefault(); toggleFind();     break;
      case 's': e.preventDefault(); showSaveDialog(); break;
    }
    if (e.key === 'Escape') {
      if (findBar.style.display !== 'none') toggleFind();
      if (hlPickerOpen) closeHlPicker();
      if (settingsOpen) {
        settingsOpen = false;
        document.getElementById('settingsPanel').classList.remove('open');
      }
    }
  }

  // ── TOOLBAR SYNC ─────────────────────────────────────────────
  function syncToolbar() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var node = sel.getRangeAt(0).startContainer;
    if (!editor.contains(node)) return;
    var el = (node.nodeType === Node.TEXT_NODE) ? node.parentElement : node;
    if (!el) return;

    var pairs = [['bold','btnBold'],['italic','btnItalic'],['underline','btnUnderline'],['strikeThrough','btnStrike']];
    pairs.forEach(function(p) {
      var btn = document.getElementById(p[1]);
      if (btn) btn.classList.toggle('active', document.queryCommandState(p[0]));
    });

    document.getElementById('headingStyle').value = getBlockTag(el);
    syncFontFamilySelect(el);
    syncFontSizeSelect(el);
  }

  function getBlockTag(el) {
    var cur = el;
    while (cur && cur !== editor) {
      var tag = (cur.tagName || '').toLowerCase();
      if (['h1','h2','h3','h4','pre','blockquote'].indexOf(tag) !== -1) return tag;
      if (tag === 'p' || tag === 'div') return 'p';
      cur = cur.parentElement;
    }
    return 'p';
  }

  function syncFontFamilySelect(el) {
    var sel = document.getElementById('fontFamily');
    var cur = el, family = '';
    while (cur && cur !== editor) {
      if (cur.style && cur.style.fontFamily) { family = cur.style.fontFamily; break; }
      if (cur.tagName && cur.tagName.toLowerCase() === 'font' && cur.face) { family = cur.face; break; }
      cur = cur.parentElement;
    }
    if (!family) { try { family = window.getComputedStyle(el).fontFamily || ''; } catch(e) {} }
    if (!family) return;
    var norm = family.toLowerCase().replace(/['"]/g,'').split(',')[0].trim();
    for (var i = 0; i < sel.options.length; i++) {
      var on = sel.options[i].value.toLowerCase().replace(/['"]/g,'').trim();
      if (on === norm || norm.indexOf(on) !== -1 || on.indexOf(norm) !== -1) { sel.value = sel.options[i].value; return; }
    }
  }

  function syncFontSizeSelect(el) {
    var sel = document.getElementById('fontSize');
    var pt = 0, cur = el;
    while (cur && cur !== editor) {
      if (cur.style && cur.style.fontSize) { pt = cssToPt(cur.style.fontSize); break; }
      cur = cur.parentElement;
    }
    if (!pt) { try { pt = Math.round(parseFloat(window.getComputedStyle(el).fontSize) * 0.75); } catch(e) { pt = 12; } }
    if (!pt) return;
    for (var i = 0; i < sel.options.length; i++) {
      if (parseInt(sel.options[i].value) === pt) { sel.value = sel.options[i].value; return; }
    }
    var best = sel.options[0], minD = Infinity;
    for (var j = 0; j < sel.options.length; j++) {
      var d = Math.abs(parseInt(sel.options[j].value) - pt);
      if (d < minD) { minD = d; best = sel.options[j]; }
    }
    sel.value = best.value;
  }

  function cssToPt(val) {
    if (!val) return 12;
    if (val.indexOf('pt') !== -1) return Math.round(parseFloat(val));
    if (val.indexOf('px') !== -1) return Math.round(parseFloat(val) * 0.75);
    return 12;
  }

  // ── FORMATTING ───────────────────────────────────────────────
  function fmt(cmd, value) { editor.focus(); document.execCommand(cmd, false, value || null); syncToolbar(); }

  function setFont(f) { editor.focus(); document.execCommand('fontName', false, f); syncToolbar(); }

  function setFontSize(pt) {
    editor.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (range.collapsed) return;
    try {
      var span = document.createElement('span');
      span.style.fontSize = pt + 'pt';
      range.surroundContents(span);
    } catch(e) {
      document.execCommand('fontSize', false, '7');
      editor.querySelectorAll('font[size="7"]').forEach(function(f) {
        var s = document.createElement('span');
        s.style.fontSize = pt + 'pt';
        f.parentNode.insertBefore(s, f);
        while (f.firstChild) s.appendChild(f.firstChild);
        f.remove();
      });
    }
    syncToolbar();
  }

  function setHeading(tag) { editor.focus(); document.execCommand('formatBlock', false, tag); syncToolbar(); refreshOutline(); }
  function setTextColor(c) { document.getElementById('textColorSwatch').style.background = c; fmt('foreColor', c); }
  function clearFormat() { editor.focus(); document.execCommand('removeFormat'); document.execCommand('formatBlock', false, 'p'); syncToolbar(); }

  // ── HIGHLIGHT PICKER ─────────────────────────────────────────
  function toggleHlPicker(e) {
    e.stopPropagation();
    if (hlPickerOpen) { closeHlPicker(); return; }

    // Save selection NOW, before the button click can collapse it
    var sel = window.getSelection();
    savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;

    hlPicker.style.display = 'block';
    hlPickerOpen = true;
    document.getElementById('btnHighlight').classList.add('active');
    hlSwatches.querySelectorAll('.hl-swatch').forEach(function(sw) {
      sw.classList.toggle('selected', sw.title === currentHL);
    });
  }

  function closeHlPicker() {
    hlPicker.style.display = 'none';
    hlPickerOpen = false;
    document.getElementById('btnHighlight').classList.remove('active');
  }

  function setHighlight(color) {
    // Restore the saved selection before touching the editor
    editor.focus();
    if (savedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
      savedRange = null;
    }

    if (!color) {
      document.execCommand('hiliteColor', false, 'transparent');
      hlColorSwatch.style.background = 'linear-gradient(135deg, #fff 45%, #f00 45%, #f00 55%, #fff 55%)';
      closeHlPicker();
      return;
    }
    currentHL = color;
    hlColorSwatch.style.background = color;
    document.execCommand('hiliteColor', false, color);
    hlSwatches.querySelectorAll('.hl-swatch').forEach(function(sw) {
      sw.classList.toggle('selected', sw.title === color);
    });
    closeHlPicker();
  }

  function hexToRgb(hex) {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return 'rgb(' + r + ', ' + g + ', ' + b + ')';
  }

  // ── INSERT ───────────────────────────────────────────────────
  function insertLink() { var u = prompt('URL:', 'https://'); if (u) fmt('createLink', u); }
  function insertHR() { editor.focus(); document.execCommand('insertHorizontalRule'); }
  function insertTable() {
    editor.focus();
    document.execCommand('insertHTML', false,
      '<table><thead><tr><th>Header 1</th><th>Header 2</th><th>Header 3</th></tr></thead>' +
      '<tbody><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr>' +
      '<tr><td>Cell</td><td>Cell</td><td>Cell</td></tr></tbody></table><p></p>');
  }
  function insertImage() {
    var u = prompt('Image URL:');
    if (u) document.execCommand('insertHTML', false, '<img src="' + u + '" alt="image">');
  }
  function selectAll() { editor.focus(); document.execCommand('selectAll'); }

  // ── FIND & REPLACE ───────────────────────────────────────────
  function toggleFind() {
    var vis = findBar.style.display !== 'none';
    findBar.style.display = vis ? 'none' : 'flex';
    var btn = document.getElementById('btnFind');
    if (btn) btn.classList.toggle('active', !vis);
    if (!vis) document.getElementById('findInput').focus();
  }
  function findReplace() {
    var find = document.getElementById('findInput').value;
    var rep  = document.getElementById('replaceInput').value;
    if (!find) return;
    var re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    var n  = (editor.innerHTML.match(re) || []).length;
    editor.innerHTML = editor.innerHTML.replace(re, rep);
    markDirty(); refreshOutline();
    alert('Replaced ' + n + ' occurrence(s).');
  }

  // ── DOCUMENT OUTLINE ─────────────────────────────────────────
  function toggleOutline() {
    outlineOpen = !outlineOpen;
    outlineSidebar.classList.toggle('open', outlineOpen);
    document.getElementById('btnOutline').classList.toggle('active', outlineOpen);
    if (outlineOpen) refreshOutline();
  }

  function refreshOutline() {
    if (!outlineOpen) return;
    var headings = editor.querySelectorAll('h1, h2, h3, h4');
    if (!headings.length) {
      outlineList.innerHTML = '<div class="outline-empty">Add headings to your document to see them here.</div>';
      return;
    }

    headings.forEach(function(h, i) {
      if (!h.id) h.id = 'heading-' + i;
    });

    outlineList.innerHTML = '';
    headings.forEach(function(h) {
      var level = parseInt(h.tagName.replace('H',''), 10);
      var btn = document.createElement('button');
      btn.className = 'outline-item';
      btn.setAttribute('data-level', level);
      btn.setAttribute('data-target', h.id);
      var span = document.createElement('span');
      span.className = 'outline-item-text';
      span.textContent = h.innerText || h.textContent || '(empty heading)';
      btn.appendChild(span);
      btn.addEventListener('click', function() { scrollToHeading(h); });
      outlineList.appendChild(btn);
    });

    highlightActiveOutlineItem();
  }

  function scrollToHeading(headingEl) {
    headingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    headingEl.style.transition = 'background .2s';
    headingEl.style.background = 'rgba(26,115,232,.12)';
    setTimeout(function() { headingEl.style.background = ''; }, 900);
    editor.focus();
  }

  function highlightActiveOutlineItem() {
    var canvas = document.getElementById('canvas');
    var canvasRect = canvas.getBoundingClientRect();
    var headings = editor.querySelectorAll('h1,h2,h3,h4');
    var activeId = null;
    headings.forEach(function(h) {
      var rect = h.getBoundingClientRect();
      if (rect.top <= canvasRect.top + 80) activeId = h.id;
    });
    outlineList.querySelectorAll('.outline-item').forEach(function(btn) {
      btn.classList.toggle('active', btn.getAttribute('data-target') === activeId);
    });
  }

  document.getElementById('canvas').addEventListener('scroll', function() {
    if (outlineOpen) highlightActiveOutlineItem();
  });

  // ── WORD COUNT ───────────────────────────────────────────────
  function updateWordCount() {
    var text  = editor.innerText || '';
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var chars = text.length;
    wordCountEl.textContent = words + ' word' + (words !== 1 ? 's' : '');
    statusWC.textContent    = words + ' word' + (words !== 1 ? 's' : '') + ' / ' + chars + ' char' + (chars !== 1 ? 's' : '');
  }

  // ── ZOOM ─────────────────────────────────────────────────────
  function zoom(d) {
    zoomLevel = Math.min(200, Math.max(50, zoomLevel + d));
    document.getElementById('page').style.transform = 'scale(' + (zoomLevel / 100) + ')';
    statusZoom.textContent = zoomLevel + '%';
  }

  // ── DIRTY / AUTOSAVE ─────────────────────────────────────────
  function markDirty()    { isDirty = true;  savedStatus.textContent = 'Unsaved changes'; }
  function showSavedMsg() { isDirty = false; savedStatus.textContent = 'All changes saved'; }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(autoSave, 3000); }
  function autoSave() {
    if (!isDirty || !currentDocId) return;
    persistDoc(currentDocId, docTitle.value, editor.innerHTML);
    showSavedMsg();
  }

  // ── STORAGE ──────────────────────────────────────────────────
  function getIndex() { try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); } catch(e) { return []; } }
  function setIndex(arr) { localStorage.setItem(INDEX_KEY, JSON.stringify(arr)); }
  function persistDoc(id, title, content) {
    var doc = { id: id, title: title || 'Untitled', content: content, modified: Date.now() };
    localStorage.setItem(STORE_PREFIX + id, JSON.stringify(doc));
    var idx = getIndex();
    setIndex([id].concat(idx.filter(function(x) { return x !== id; })));
  }
  function loadDocById(id) { try { return JSON.parse(localStorage.getItem(STORE_PREFIX + id)); } catch(e) { return null; } }
  function deleteDocById(id) {
    localStorage.removeItem(STORE_PREFIX + id);
    setIndex(getIndex().filter(function(x) { return x !== id; }));
  }
  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ── SAVE DIALOG ──────────────────────────────────────────────
  function showSaveDialog() {
    document.getElementById('saveNameInput').value = docTitle.value || 'Untitled';
    document.getElementById('saveDialog').style.display = 'flex';
    setTimeout(function() { document.getElementById('saveNameInput').select(); }, 50);
  }
  function closeSaveDialog() { document.getElementById('saveDialog').style.display = 'none'; }
  function confirmSave() {
    var name = document.getElementById('saveNameInput').value.trim() || 'Untitled';
    setTitle(name);
    if (!currentDocId) currentDocId = genId();
    persistDoc(currentDocId, name, editor.innerHTML);
    showSavedMsg();
    closeSaveDialog();
  }

  // ── DOC MANAGER ──────────────────────────────────────────────
  function showDocManager() { renderDocList(); document.getElementById('docManager').style.display = 'flex'; }
  function closeDocManager() { document.getElementById('docManager').style.display = 'none'; }
  function renderDocList() {
    var list = document.getElementById('docList');
    var idx  = getIndex();
    if (!idx.length) {
      list.innerHTML = '<div class="doc-empty"><i class="fa-solid fa-file-circle-xmark" style="font-size:32px;opacity:.3;display:block;margin:0 auto 12px"></i>No saved documents yet.</div>';
      return;
    }
    list.innerHTML = idx.map(function(id) {
      var doc = loadDocById(id);
      if (!doc) return '';
      var date = new Date(doc.modified).toLocaleString(undefined, {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
      var active = (id === currentDocId) ? ' style="border-color:var(--accent);background:var(--active)"' : '';
      return '<div class="doc-item"' + active + ' onclick="App.openDoc(\'' + id + '\')">' +
        '<i class="fa-solid fa-file-lines doc-item-icon"></i>' +
        '<div class="doc-item-info"><div class="doc-item-title">' + escHtml(doc.title) + '</div>' +
        '<div class="doc-item-date">Last edited ' + date + '</div></div>' +
        '<button class="doc-item-action" title="Duplicate" onclick="event.stopPropagation();App.duplicateDoc(\'' + id + '\')">' +
        '<i class="fa-solid fa-copy"></i></button>' +
        '<button class="doc-item-del" title="Delete" onclick="event.stopPropagation();App.deleteDoc(\'' + id + '\')">' +
        '<i class="fa-solid fa-trash"></i></button></div>';
    }).join('');
  }

  function openDoc(id) {
    if (isDirty && !confirm('You have unsaved changes. Open this document anyway?')) return;
    var doc = loadDocById(id);
    if (!doc) return;
    currentDocId = doc.id; setTitle(doc.title); editor.innerHTML = doc.content;
    isDirty = false; savedStatus.textContent = 'All changes saved';
    updateWordCount(); refreshOutline(); closeDocManager(); editor.focus();
  }

  function deleteDoc(id) {
    if (!confirm('Delete this document? Cannot be undone.')) return;
    if (id === currentDocId) currentDocId = null;
    deleteDocById(id); renderDocList();
  }

  function duplicateDoc(id) {
    var doc = loadDocById(id);
    if (!doc) return;
    var newId = genId();
    persistDoc(newId, doc.title + ' (copy)', doc.content);
    renderDocList();
  }

  // ── FILE IMPORT ──────────────────────────────────────────────
  function handleFileOpen(event) {
    var file = event.target.files[0];
    if (!file) return;
    var ext = file.name.split('.').pop().toLowerCase();

    // .docx — parse with mammoth.js (returns ArrayBuffer)
    if (ext === 'docx') {
      var reader = new FileReader();
      reader.onload = function(e) {
        mammoth.convertToHtml({ arrayBuffer: e.target.result })
          .then(function(result) {
            currentDocId = null;
            setTitle(file.name.replace(/\.[^.]+$/, ''));
            editor.innerHTML = result.value;
            isDirty = true;
            savedStatus.textContent = 'Unsaved changes';
            updateWordCount(); refreshOutline(); closeDocManager(); editor.focus();
            if (result.messages && result.messages.length) {
              console.info('mammoth conversion notes:', result.messages);
            }
          })
          .catch(function(err) {
            alert('Could not import .docx file: ' + err.message);
          });
      };
      reader.readAsArrayBuffer(file);
      event.target.value = '';
      return;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
      var content = e.target.result;
      var html = '';
      if (ext === 'html' || ext === 'htm') {
        html = new DOMParser().parseFromString(content, 'text/html').body.innerHTML;
      } else if (ext === 'md') {
        html = mdToHtml(content);
      } else {
        html = '<p>' + content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/\n\n+/g,'</p><p>').replace(/\n/g,'<br>') + '</p>';
      }
      currentDocId = null; setTitle(file.name.replace(/\.[^.]+$/, ''));
      editor.innerHTML = html; isDirty = true; savedStatus.textContent = 'Unsaved changes';
      updateWordCount(); refreshOutline(); closeDocManager(); editor.focus();
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  // ── BACKUP & RESTORE ─────────────────────────────────────────
  function backupAllDocs() {
    var idx  = getIndex();
    if (!idx.length) { alert('No saved documents to back up.'); return; }
    var docs = idx.map(function(id) { return loadDocById(id); }).filter(Boolean);
    var payload = JSON.stringify({ version: 1, exported: Date.now(), docs: docs }, null, 2);
    var date    = new Date().toISOString().slice(0, 10);
    dl('gaggle-docs-backup-' + date + '.json', payload, 'application/json;charset=utf-8');
  }

  function restoreFromBackup(event) {
    var file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function(e) {
      var payload;
      try { payload = JSON.parse(e.target.result); }
      catch(err) { alert('Invalid backup file — could not parse JSON.'); return; }

      if (!payload.docs || !Array.isArray(payload.docs) || !payload.docs.length) {
        alert('Backup file contains no documents.'); return;
      }

      var imported = 0, skipped = 0, replaced = 0;

      payload.docs.forEach(function(doc) {
        if (!doc || !doc.id || !doc.title || !doc.content) return;

        var existingId = findDocByTitle(doc.title);

        if (existingId) {
          var answer = confirm(
            '"' + doc.title + '" already exists.\n\n' +
            'OK → Replace existing\n' +
            'Cancel → Keep both (import as copy)'
          );
          if (answer) {
            // Replace — reuse the existing id so it opens seamlessly
            persistDoc(existingId, doc.title, doc.content);
            replaced++;
          } else {
            // Keep both — give the import a new id and a "(restored)" suffix
            var newId = genId();
            persistDoc(newId, doc.title + ' (restored)', doc.content);
            imported++;
          }
        } else {
          // No conflict — restore with original id preserved if possible
          var targetId = getIndex().indexOf(doc.id) === -1 ? doc.id : genId();
          persistDoc(targetId, doc.title, doc.content);
          imported++;
        }
      });

      var msg = [];
      if (imported)  msg.push(imported  + ' document' + (imported  !== 1 ? 's' : '') + ' imported');
      if (replaced)  msg.push(replaced  + ' replaced');
      if (skipped)   msg.push(skipped   + ' skipped');
      alert('Restore complete: ' + msg.join(', ') + '.');
      renderDocList();
    };
    reader.readAsText(file);
  }

  function findDocByTitle(title) {
    var idx = getIndex();
    for (var i = 0; i < idx.length; i++) {
      var doc = loadDocById(idx[i]);
      if (doc && doc.title === title) return idx[i];
    }
    return null;
  }

  function mdToHtml(md) {
    var lines = md.split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // Fenced code block
      if (/^```/.test(line)) {
        var code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(mdEsc(lines[i])); i++; }
        out.push('<pre><code>' + code.join('\n') + '</code></pre>');
        i++; continue;
      }

      // Headings
      var hm = line.match(/^(#{1,6})\s+(.*)/);
      if (hm) {
        var lvl = Math.min(hm[1].length, 4);
        out.push('<h' + lvl + '>' + mdInline(hm[2]) + '</h' + lvl + '>');
        i++; continue;
      }

      // Horizontal rule
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        out.push('<hr/>'); i++; continue;
      }

      // Blockquote
      if (/^\s*>\s?/.test(line)) {
        var bq = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          bq.push(lines[i].replace(/^\s*>\s?/, '')); i++;
        }
        out.push('<blockquote><p>' + mdInline(bq.join(' ')) + '</p></blockquote>');
        continue;
      }

      // Unordered list
      if (/^\s*[-*+]\s+/.test(line)) {
        out.push('<ul>');
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          out.push('<li>' + mdInline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>'); i++;
        }
        out.push('</ul>'); continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        out.push('<ol>');
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          out.push('<li>' + mdInline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>'); i++;
        }
        out.push('</ol>'); continue;
      }

      // Blank line
      if (/^\s*$/.test(line)) { i++; continue; }

      // Paragraph — collect consecutive plain lines
      var para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^#{1,6}\s/.test(lines[i]) && !/^```/.test(lines[i]) &&
             !/^\s*[-*+]\s/.test(lines[i]) && !/^\s*\d+\.\s/.test(lines[i]) &&
             !/^\s*>\s?/.test(lines[i]) && !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      if (para.length) out.push('<p>' + mdInline(para.join(' ')) + '</p>');
    }
    return out.join('\n');
  }

  function mdInline(text) {
    return mdEsc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/_([^_\n]+)_/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  }

  function mdEsc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function setTitle(val) {
    docTitle.value = val;
    docTitleDisplay.textContent = val || 'Untitled document';
  }

  function editTitle() {
    docTitleWrap.classList.add('editing');
    docTitle.style.width = '100%';
    docTitle.focus();
    docTitle.select();
  }

  function commitTitle() {
    var val = docTitle.value.trim() || 'Untitled document';
    setTitle(val);
    docTitleWrap.classList.remove('editing');
    markDirty(); scheduleSave();
  }

  function titleKeydown(e) {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); docTitle.blur(); }
  }

  // ── UTILS ────────────────────────────────────────────────────
  function escHtml(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function focusEditor() { editor.focus(); }
  function printDoc() { window.print(); }
  function newDoc() {
    if (isDirty && !confirm('You have unsaved changes. Start a new document anyway?')) return;
    currentDocId = null; setTitle('Untitled document');
    editor.innerHTML = '<p></p>'; isDirty = false; savedStatus.textContent = 'All changes saved';
    applyDefaultSettings(getDefaultSettings());
    updateWordCount(); refreshOutline(); editor.focus();
  }

  // ── THEMES ───────────────────────────────────────────────────
  function toggleSettings(e) {
    e.stopPropagation();
    settingsOpen = !settingsOpen;
    document.getElementById('settingsPanel').classList.toggle('open', settingsOpen);
  }

  function setUiTheme(theme) {
    uiTheme = theme;
    document.documentElement.setAttribute('data-ui-theme', theme === 'light' ? '' : theme);
    document.querySelectorAll('#uiThemeOptions .theme-chip').forEach(function(c) {
      c.classList.toggle('active', c.getAttribute('data-ui') === theme);
    });
    localStorage.setItem('gd_ui_theme', theme);
  }

  function setPageTheme(theme) {
    pageTheme = theme;
    document.documentElement.setAttribute('data-page-theme', theme === 'light' ? '' : theme);
    document.querySelectorAll('#pageThemeOptions .theme-chip').forEach(function(c) {
      c.classList.toggle('active', c.getAttribute('data-page') === theme);
    });
    localStorage.setItem('gd_page_theme', theme);
  }

  function loadThemes() {
    var ui   = localStorage.getItem('gd_ui_theme')   || 'light';
    var page = localStorage.getItem('gd_page_theme') || 'light';
    setUiTheme(ui);
    setPageTheme(page);
  }

  // ── EXPORT ───────────────────────────────────────────────────
  function saveAs(format) {
    saveMenu.classList.remove('open');
    var title = (docTitle.value || 'document').trim();
    var html  = editor.innerHTML;
    if (format === 'md')        exportMarkdown(title, html);
    else if (format === 'docx') exportDocx(title, html);
    else if (format === 'rtf')  exportRTF(title, html);
    else if (format === 'html') exportHTML(title, html);
    else if (format === 'txt')  exportTxt(title);
  }

  // ── COPY AS MARKDOWN ─────────────────────────────────────────
  function copyAsMarkdown() {
    var sel   = window.getSelection();
    var html  = (sel && !sel.isCollapsed)
      ? (function() {
          var frag = sel.getRangeAt(0).cloneContents();
          var div  = document.createElement('div');
          div.appendChild(frag);
          return div.innerHTML;
        })()
      : editor.innerHTML;

    var td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
    td.addRule('tables', {
      filter: ['table'],
      replacement: function(content, node) {
        var rows = Array.from(node.querySelectorAll('tr'));
        if (!rows.length) return content;
        var toMd = function(r) {
          return '| ' + Array.from(r.querySelectorAll('th,td')).map(function(c) {
            return c.innerText.trim().replace(/\|/g, '\\|');
          }).join(' | ') + ' |';
        };
        var hd  = toMd(rows[0]);
        var sep = '| ' + Array.from(rows[0].querySelectorAll('th,td')).map(function() { return '---'; }).join(' | ') + ' |';
        var body = rows.slice(1).map(toMd).join('\n');
        return '\n\n' + hd + '\n' + sep + (body ? '\n' + body : '') + '\n\n';
      }
    });

    var md  = td.turndown(html);
    var btn = document.getElementById('btnCopyMd');

    function flashBtn() {
      if (!btn) return;
      btn.classList.add('active');
      btn.title = 'Copied!';
      setTimeout(function() {
        btn.classList.remove('active');
        btn.title = 'Copy as Markdown (Ctrl+Shift+M)';
      }, 1500);
    }

    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      flashBtn();
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(flashBtn).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  function exportMarkdown(title, html) {
    var td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
    td.addRule('tables', {
      filter: ['table'],
      replacement: function(content, node) {
        var rows = Array.from(node.querySelectorAll('tr'));
        if (!rows.length) return content;
        var toMd = function(r) {
          return '| ' + Array.from(r.querySelectorAll('th,td')).map(function(c) {
            return c.innerText.trim().replace(/\|/g, '\\|');
          }).join(' | ') + ' |';
        };
        var hd  = toMd(rows[0]);
        var sep = '| ' + Array.from(rows[0].querySelectorAll('th,td')).map(function() { return '---'; }).join(' | ') + ' |';
        var body = rows.slice(1).map(toMd).join('\n');
        return '\n\n' + hd + '\n' + sep + (body ? '\n' + body : '') + '\n\n';
      }
    });
    dl(title + '.md', '# ' + title + '\n\n' + td.turndown(html), 'text/markdown;charset=utf-8');
  }

  async function exportDocx(title, html) {
    try {
      var D    = docx;
      var doc2 = new DOMParser().parseFromString(html, 'text/html');
      var els  = [];

      // docx v8 UMD uses plain string values for HeadingLevel and WidthType
      // D.HeadingLevel and D.WidthType may be undefined in the UMD bundle,
      // so we define the string literals directly.
      var HEADING_MAP = {
        h1: 'Heading1',
        h2: 'Heading2',
        h3: 'Heading3',
        h4: 'Heading4'
      };
      var WIDTH_PCT = (D.WidthType && D.WidthType.PERCENTAGE) ? D.WidthType.PERCENTAGE : 'pct';

      function runs(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{text: node.textContent}] : [];
        var tag = (node.tagName || '').toLowerCase();
        var b = tag==='strong'||tag==='b', i=tag==='em'||tag==='i', u=tag==='u', s=tag==='s'||tag==='strike';
        var out = [];
        if (node.childNodes) {
          Array.from(node.childNodes).forEach(function(c) {
            runs(c).forEach(function(r) {
              out.push({
                text: r.text,
                bold: r.bold || b,
                italics: r.italics || i,
                // docx v8: underline takes {type: 'single'} — use string form for compatibility
                underline: r.underline || (u ? {type: 'single'} : undefined),
                strike: r.strike || s
              });
            });
          });
        }
        return out;
      }

      function toDocx(el) {
        if (el.nodeType === Node.TEXT_NODE) {
          var t = el.textContent.trim();
          return t ? [new D.Paragraph({children: [new D.TextRun({text: t})]})] : [];
        }
        if (el.nodeType !== Node.ELEMENT_NODE) return [];
        var tag = el.tagName.toLowerCase();
        var r   = runs(el).map(function(x) { return new D.TextRun(x); });

        if (HEADING_MAP[tag]) return [new D.Paragraph({heading: HEADING_MAP[tag], children: r})];
        if (tag==='p' || tag==='div') return [new D.Paragraph({children: r})];
        if (tag==='ul') return Array.from(el.querySelectorAll('li')).map(function(li) {
          return new D.Paragraph({bullet: {level: 0}, children: [new D.TextRun({text: li.innerText.trim()})]});
        });
        if (tag==='ol') return Array.from(el.querySelectorAll('li')).map(function(li, idx) {
          return new D.Paragraph({children: [new D.TextRun({text: (idx+1) + '. ' + li.innerText.trim()})]});
        });
        if (tag==='blockquote') return [new D.Paragraph({
          indent: {left: 720},
          children: [new D.TextRun({text: el.innerText.trim(), italics: true, color: '555555'})]
        })];
        if (tag==='pre') return [new D.Paragraph({
          // docx v8: font must be {name: "..."} not a bare string
          children: [new D.TextRun({text: el.innerText, font: {name: 'Courier New'}, size: 20})]
        })];
        if (tag==='hr') return [new D.Paragraph({thematicBreak: true, children: []})];
        if (tag==='table') {
          var trows = Array.from(el.querySelectorAll('tr')).map(function(row) {
            return new D.TableRow({
              children: Array.from(row.querySelectorAll('th,td')).map(function(cell) {
                return new D.TableCell({
                  children: [new D.Paragraph({
                    children: [new D.TextRun({
                      text: cell.innerText.trim(),
                      bold: cell.tagName.toLowerCase() === 'th'
                    })]
                  })],
                  margins: {top: 60, bottom: 60, left: 100, right: 100}
                });
              })
            });
          });
          return [new D.Table({rows: trows, width: {size: 100, type: WIDTH_PCT}})];
        }
        var tv = el.innerText && el.innerText.trim();
        return tv ? [new D.Paragraph({children: [new D.TextRun({text: tv})]})] : [];
      }

      Array.from(doc2.body.childNodes).forEach(function(el) {
        toDocx(el).forEach(function(e) { els.push(e); });
      });

      // Ensure there is at least one child element (docx requires non-empty sections)
      if (!els.length) els.push(new D.Paragraph({children: []}));

      var blob = await D.Packer.toBlob(new D.Document({sections: [{properties: {}, children: els}]}));
      saveBlob(blob, title + '.docx');
    } catch(err) {
      console.error('DOCX export error:', err);
      alert('Export to .docx failed: ' + (err && err.message ? err.message : err));
    }
  }

  function exportRTF(title, html) {
    var doc2 = new DOMParser().parseFromString(html, 'text/html');
    function esc(s) {
      return (s||'').replace(/\\/g,'\\\\').replace(/[{}]/g,function(c){return '\\'+c;})
        .replace(/[^\x00-\x7F]/g,function(c){return '\\u'+c.charCodeAt(0)+'?';});
    }
    function toRTF(node) {
      if (node.nodeType === Node.TEXT_NODE) return esc(node.textContent);
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      var tag   = node.tagName.toLowerCase();
      var inner = Array.from(node.childNodes).map(toRTF).join('');
      switch (tag) {
        case 'h1': return '\\pard\\sb240\\sa120\\b\\fs52 '+inner+'\\b0\\fs24\\par\n';
        case 'h2': return '\\pard\\sb200\\sa100\\b\\fs40 '+inner+'\\b0\\fs24\\par\n';
        case 'h3': return '\\pard\\sb180\\sa80\\b\\fs32 '+inner+'\\b0\\fs24\\par\n';
        case 'h4': return '\\pard\\sb160\\sa60\\b\\fs28 '+inner+'\\b0\\fs24\\par\n';
        case 'p': case 'div': return '\\pard\\sa160 '+inner+'\\par\n';
        case 'strong': case 'b': return '\\b '+inner+'\\b0 ';
        case 'em':     case 'i': return '\\i '+inner+'\\i0 ';
        case 'u':                return '\\ul '+inner+'\\ulnone ';
        case 's': case 'strike': return '\\strike '+inner+'\\strike0 ';
        case 'li':               return '\\pard\\fi-360\\li720\\bullet\\tab '+inner+'\\par\n';
        case 'blockquote':       return '\\pard\\li720\\ri720\\i '+inner+'\\i0\\par\n';
        case 'pre':              return '\\pard\\f1\\fs20 '+esc(node.innerText)+'\\f0\\fs24\\par\n';
        case 'br':               return '\\line\n';
        case 'hr':               return '\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n';
        case 'table':
          return Array.from(node.querySelectorAll('tr')).map(function(tr) {
            var cells = Array.from(tr.querySelectorAll('th,td'));
            var cw    = Math.floor(9360 / Math.max(cells.length, 1));
            var row   = '\\trowd\\trgaph70';
            cells.forEach(function(_, i) { row += '\\cellx' + (cw*(i+1)); });
            cells.forEach(function(cell) {
              var bold = cell.tagName.toLowerCase() === 'th';
              row += ' '+(bold?'\\b ':'')+esc(cell.innerText.trim())+(bold?'\\b0 ':'')+' \\cell';
            });
            return row + ' \\row\n';
          }).join('');
        default: return inner;
      }
    }
    var body = Array.from(doc2.body.childNodes).map(toRTF).join('');
    dl(title+'.rtf',
      '{\\rtf1\\ansi\\deff0\n{\\fonttbl{\\f0 Georgia;}{\\f1 Courier New;}}\n'
      +'{\\colortbl ;\\red85\\green85\\blue85;\\red26\\green115\\blue232;}\n'
      +'\\widowctrl\\wpaper12240\\wpaperh15840\\margl1800\\margr1800\\margt1440\\margb1440\n'
      +'\\f0\\fs24\\sl360\\slmult1\n'+body+'}',
      'application/rtf');
  }

  function exportHTML(title, html) {
    dl(title+'.html',
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8"/>\n<title>'+escHtml(title)+'</title>\n'
      +'<style>\nbody{font-family:Georgia,serif;max-width:800px;margin:60px auto;padding:0 32px;font-size:12pt;line-height:1.6;color:#111}\n'
      +'h1{font-size:26pt}h2{font-size:20pt}h3{font-size:16pt}\n'
      +'table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 10px}\n'
      +'pre{background:#f4f1ed;padding:12px;border-radius:6px}\n'
      +'blockquote{border-left:4px solid #ccc;padding:.4em 1em;color:#555;font-style:italic}\n'
      +'img{max-width:100%}\n</style>\n</head>\n<body>\n<h1>'+escHtml(title)+'</h1>\n'+html+'\n</body>\n</html>',
      'text/html;charset=utf-8');
  }

  function exportTxt(title) { dl(title+'.txt', editor.innerText, 'text/plain;charset=utf-8'); }

  function dl(filename, content, mimeType) { saveBlob(new Blob([content],{type:mimeType}), filename); }
  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href  = url; a.download = filename; a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
  }

  // ── DEFAULT SETTINGS ──────────────────────────────────────────
  function loadDefaultSettings() {
    var s = getDefaultSettings();
    // Sync selects to stored values
    var set = function(id, val) { var el = document.getElementById(id); if (el) el.value = val; };
    set('defaultFont',        s.font);
    set('defaultFontSize',    s.fontSize);
    set('defaultLineSpacing', s.lineSpacing);
    set('defaultZoom',        s.zoom);
    // Apply to current document
    applyDefaultSettings(s);
  }

  function getDefaultSettings() {
    try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(DEFAULT_SETTINGS_KEY))); }
    catch(e) { return Object.assign({}, DEFAULT_SETTINGS); }
  }

  function saveDefaultSettings() {
    var s = {
      font:        (document.getElementById('defaultFont')        || {}).value || DEFAULT_SETTINGS.font,
      fontSize:    (document.getElementById('defaultFontSize')    || {}).value || DEFAULT_SETTINGS.fontSize,
      lineSpacing: (document.getElementById('defaultLineSpacing') || {}).value || DEFAULT_SETTINGS.lineSpacing,
      zoom:        (document.getElementById('defaultZoom')        || {}).value || DEFAULT_SETTINGS.zoom,
    };
    localStorage.setItem(DEFAULT_SETTINGS_KEY, JSON.stringify(s));
    applyDefaultSettings(s);
  }

  function applyDefaultSettings(s) {
    // Font & size on editor
    editor.style.fontFamily = s.font;
    editor.style.fontSize   = s.fontSize + 'pt';
    editor.style.lineHeight = s.lineSpacing;
    // Sync toolbar selects
    var ff = document.getElementById('fontFamily');
    var fs = document.getElementById('fontSize');
    if (ff) ff.value = s.font;
    if (fs) fs.value = s.fontSize;
    // Zoom
    var z = parseInt(s.zoom, 10) || 100;
    zoomLevel = z;
    document.getElementById('page').style.transform = 'scale(' + (z / 100) + ')';
    statusZoom.textContent = z + '%';
  }

  // ── NOVEL MODE ────────────────────────────────────────────────
  function toggleNovelMode() {
    novelMode = !novelMode;
    applyNovelMode();
    localStorage.setItem('gd_novel_mode', novelMode ? '1' : '0');
  }

  function applyNovelMode() {
    var btn    = document.getElementById('btnNovelMode');
    var sw     = document.getElementById('novelToggleSwitch');
    var panel  = document.getElementById('novelSettings');

    editor.classList.toggle('novel-mode', novelMode);
    if (btn) btn.classList.toggle('active', novelMode);
    if (sw)  sw.classList.toggle('on', novelMode);
    if (panel) panel.style.display = novelMode ? 'block' : 'none';

    if (novelMode) applyNovelSettings();
  }

  function applyNovelSettings() {
    var font     = (document.getElementById('novelFont')        || {}).value || "'Times New Roman', serif";
    var size     = (document.getElementById('novelFontSize')    || {}).value || '12pt';
    var spacing  = (document.getElementById('novelLineSpacing') || {}).value || '2';
    var indent   = (document.getElementById('novelIndent')      || {}).value || '2em';
    var dropCap  = document.getElementById('novelDropCap');
    var hasDropCap = dropCap ? dropCap.checked : true;

    var root = document.documentElement;
    root.style.setProperty('--novel-font',    font);
    root.style.setProperty('--novel-size',    size);
    root.style.setProperty('--novel-spacing', spacing);
    root.style.setProperty('--novel-indent',  indent);

    editor.classList.toggle('dropcap-on', novelMode && hasDropCap);

    // Persist settings
    localStorage.setItem('gd_novel_settings', JSON.stringify({ font, size, spacing, indent, dropCap: hasDropCap }));
  }

  function loadNovelMode() {
    var saved = localStorage.getItem('gd_novel_settings');
    if (saved) {
      try {
        var s = JSON.parse(saved);
        var set = function(id, val) { var el = document.getElementById(id); if (el) el.value = val; };
        set('novelFont',        s.font);
        set('novelFontSize',    s.size);
        set('novelLineSpacing', s.spacing);
        set('novelIndent',      s.indent);
        var dc = document.getElementById('novelDropCap');
        if (dc && s.dropCap !== undefined) dc.checked = s.dropCap;
      } catch(e) {}
    }
    if (localStorage.getItem('gd_novel_mode') === '1') {
      novelMode = true;
      applyNovelMode();
    }
  }

  function insertSceneBreak() {
    editor.focus();
    document.execCommand('insertHTML', false,
      '<p class="scene-break" contenteditable="false">* &nbsp; * &nbsp; *</p><p></p>');
    markDirty();
  }

  // ── PUBLIC API ────────────────────────────────────────────────
  return {
    init, fmt, setFont, setFontSize, setHeading, setTextColor, setHighlight,
    toggleHlPicker, clearFormat, insertLink, insertHR, insertTable, insertImage,
    selectAll, toggleFind, findReplace, toggleOutline, saveAs, copyAsMarkdown, newDoc, printDoc,
    zoom, focusEditor, autoSave,
    showSaveDialog, closeSaveDialog, confirmSave,
    showDocManager, closeDocManager, openDoc, deleteDoc, duplicateDoc,
    handleFileOpen, backupAllDocs, restoreFromBackup,
    toggleSettings, setUiTheme, setPageTheme,
    saveDefaultSettings,
    toggleNovelMode, applyNovelSettings, insertSceneBreak,
    editTitle, commitTitle, titleKeydown
  };
})();

document.addEventListener('DOMContentLoaded', App.init);