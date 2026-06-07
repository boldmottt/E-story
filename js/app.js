/* E-Story Main App — v2: No-spoiler, reading position, word click */
const $ = id => document.getElementById(id);

let App = {
  currentView: 'bookshelf',
  currentBook: null,
  currentChunk: null,
  currentSelectedChunkIndex: 0,
  currentChunks: [],
  currentSentences: [],
  selectedSentence: null,
  selectedWord: null,
  bookData: null,
  readerMode: 'story', // story | tts (reader sub-mode)
  feedbackAttempts: [],
  queueCount: 0,
  _scrollThrottleTimer: null,
  currentSessionId: null,

  async init() {
    await AI.init();
    TTS.init();
    
    // Navigation (sidebar + bottom tabbar + more-sheet rows)
    document.querySelectorAll('.nav-item, .tab[data-view], .sheet-row[data-view]').forEach(item => {
      item.addEventListener('click', () => {
        this.switchView(item.dataset.view);
        this._closeMoreSheet();
      });
    });

    // Bottom tabbar non-nav actions
    document.querySelectorAll('.tab[data-action], .tabbar .tab-cta').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        if (action === 'more') this._openMoreSheet();
        else if (action === 'review') this.startReview();
      });
    });
    $('more-backdrop')?.addEventListener('click', () => this._closeMoreSheet());

    // Vocab segmented filter control
    document.querySelector('#vocabulary-page .seg-control')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      document.querySelectorAll('#vocabulary-page .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      const filterSel = $('vocab-filter');
      if (filterSel) { filterSel.value = btn.dataset.filter; filterSel.dispatchEvent(new Event('change', { bubbles: true })); }
    });

    // Sticky-title scroll behavior on the stage
    const stage = document.querySelector('.stage');
    const topbar = document.querySelector('.topbar');
    if (stage && topbar) {
      stage.addEventListener('scroll', () => {
        topbar.classList.toggle('scrolled', stage.scrollTop > 18);
      }, { passive: true });
    }
    
    // Settings
    $('settings-save')?.addEventListener('click', () => this.saveSettings());
    $('settings-test-ai')?.addEventListener('click', () => this.testAI());
    $('export-btn')?.addEventListener('click', () => this.exportBackup());
    $('import-btn')?.addEventListener('click', () => $('import-file')?.click());
    $('import-file')?.addEventListener('change', (e) => this.importBackup(e));
    
    // Upload & bookshelf-grid delegation (single listener)
    const grid = $('bookshelf-grid');
    grid.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.book-del');
      if (delBtn) { this.deleteBookConfirm(parseInt(delBtn.dataset.id)); return; }
      const card = e.target.closest('.book-card');
      if (card) { this.openBook(parseInt(card.dataset.id)); return; }
      if (e.target.closest('#upload-area')) {
        const input = document.getElementById('file-input');
        if (input) input.click();
      }
    });
    grid.addEventListener('change', (e) => {
      if (e.target.id === 'file-input') this.handleUpload(e);
    });
    grid.addEventListener('dragover', (e) => {
      if (e.target.closest('#upload-area')) e.preventDefault();
    });
    grid.addEventListener('drop', (e) => {
      const area = e.target.closest('#upload-area');
      if (area) {
        e.preventDefault();
        if (e.dataTransfer.files.length) this.processFile(e.dataTransfer.files[0]);
      }
    });
    
    // Topbar delegation (review button)
    $('topbar-title')?.closest('.topbar')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'review') this.startReview();
    });
    
    // Vocab-header delegation (search, filter, review)
    document.querySelector('.vocab-header')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'review') this.startReview();
    });
    document.querySelector('.vocab-header')?.addEventListener('input', (e) => {
      if (e.target.dataset.action === 'renderVocab') this.renderVocabulary();
    });
    document.querySelector('.vocab-header')?.addEventListener('change', (e) => {
      if (e.target.dataset.action === 'renderVocab') this.renderVocabulary();
    });
    
    // Quick-menu actions — one delegated listener (menu element persists,
    // so binding here avoids stacking a new listener on every sentence click).
    $('quick-menu')?.addEventListener('click', (e) => {
      const vocabBtn = e.target.closest('.qm-vocab-add');
      if (vocabBtn) {
        e.stopPropagation();
        this.saveWordDirect(vocabBtn.dataset.word, vocabBtn.dataset.meaning);
        return;
      }
      const askSend = e.target.closest('.qm-ask-send');
      if (askSend) {
        e.stopPropagation();
        this.submitFreeQuestion();
        return;
      }
      const phraseSave = e.target.closest('.qm-phrase-save');
      if (phraseSave) {
        e.stopPropagation();
        this.savePhrase();
        return;
      }
      const wordEl = e.target.closest('.qm-word');
      if (wordEl) {
        e.stopPropagation();
        if (this._phraseMode) { this.togglePhraseWord(wordEl); return; }
        document.querySelectorAll('.qm-word').forEach(w => w.classList.remove('selected'));
        wordEl.classList.add('selected');
        this.selectedWord = wordEl.dataset.word;
        this.wordHint(wordEl.dataset.word);
        return;
      }
      const action = e.target.closest('.qm-btn')?.dataset.action;
      const handlers = {
        word: () => this.wordHint(),
        phraseMode: () => this.togglePhraseMode(),
        grammar: () => this.grammarHint(),
        gist: () => this.sentenceGist(),
        structure: () => this.openStructure(),
        koreanGrammar: () => this.koreanGrammar(),
        chunkReading: () => this.chunkReading(),
        easyEnglish: () => this.easyEnglish(),
        ask: () => this.askFreeQuestion(),
        study: () => this.openStudy(),
        highlight: () => this.saveHighlight(),
        queue: () => this.queueLater()
      };
      handlers[action]?.();
    });

    // Close study panel
    $('study-close')?.addEventListener('click', () => this.closeStudy());
    
    // Close review modal
    $('review-close')?.addEventListener('click', () => this.closeReview());
    
    // Study submit
    $('study-submit')?.addEventListener('click', () => this.submitTranslation());
    
    // Queue clear
    $('queue-clear')?.addEventListener('click', () => this.clearQueue());

    // Reader → back to bookshelf
    $('topbar-back')?.addEventListener('click', () => this.switchView('bookshelf'));
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeQuickMenu();
        this.closeStudy();
        this.closeReview();
      }
    });

    window.addEventListener('popstate', () => {
      const panel = $('study-panel');
      if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
      }
    });

    await this.loadSettings();
    
    // Restore last opened book (reading position)
    const s = await getSettings();
    if (s.lastOpenedBookId) {
      const book = await getBook(s.lastOpenedBookId);
      if (book && book.id) {
        // Will open the book after bookshelf is loaded
        this._pendingBookId = s.lastOpenedBookId;
      }
    }
    
    await this.loadBookshelf();
    await this.updateQueueBadge();
    
    // Open last book after bookshelf is rendered
    if (this._pendingBookId) {
      await this.openBook(this._pendingBookId);
      this._pendingBookId = null;
    }
    
    // Listen for AI events
    window.addEventListener('ai:demo-fallback', (e) => {
      this.showToast('⚠️ AI 연결 실패 (키 없음): ' + e.detail.message, 'error');
    });
    window.addEventListener('ai:error', (e) => {
      this.showToast('⚠️ AI 오류: ' + e.detail.message, 'error');
    });
    
    // Close quick menu on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.quick-menu') && !e.target.closest('.sent') && !e.target.closest('.qm-word')) {
        this.closeQuickMenu();
      }
    });

    // Flush any open reading session when the tab closes (dependency logging).
    window.addEventListener('beforeunload', () => this._endReadingSession());
    
    // Throttled scroll position save (scroll happens inside .stage in v2.0)
    const stageEl = document.querySelector('.stage');
    (stageEl || document).addEventListener('scroll', () => {
      if (this.currentView !== 'reader') return;
      if (this._scrollThrottleTimer) clearTimeout(this._scrollThrottleTimer);
      this._scrollThrottleTimer = setTimeout(() => {
        this._saveScrollPosition();
      }, 300);
    }, { passive: true });
  },

  _saveScrollPosition() {
    if (!this.currentBook) return;
    const stage = document.querySelector('.stage');
    const offset = stage ? stage.scrollTop : (window.scrollY || window.pageYOffset);
    updateBookProgress(this.currentBook.id, this.currentSelectedChunkIndex, offset, this._page || 0);
  },

  // Save page-level progress for the progress bar (page turns within a chunk).
  _savePageProgress() {
    if (!this.currentBook) return;
    const total = this._totalPages();
    if (total <= 0 || !this.currentChunks.length) return;
    const pageContrib = (this._page || 0) / total;
    const overall = Math.min(100, Math.round(
      ((this.currentSelectedChunkIndex + pageContrib) / this.currentChunks.length) * 100
    ));
    updateReadingProgress(this.currentBook.id, overall);
  },

  async _patchSettings(patch) {
    const s = await getSettings();
    await saveSettings({ ...s, ...patch });
  },

  switchView(view) {
    // Leaving the reader ends the active reading session (dependency logging).
    if (this.currentView === 'reader' && view !== 'reader') this._endReadingSession();
    this.currentView = view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    document.querySelectorAll('.tab[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    document.querySelectorAll('.content').forEach(c => c.classList.toggle('active', c.id === view + '-page'));
    // Reset stage scroll so large-title is visible
    const stage = document.querySelector('.stage');
    if (stage) stage.scrollTop = 0;
    
    const renderers = {
      vocabulary: () => this.renderVocabulary(),
      queue: () => this.renderQueue(),
      highlights: () => this.renderHighlights(),
      history: () => this.renderHistory(),
      report: () => this.renderReport(),
      diagnosis: () => this.renderDiagnosis(),
      settings: () => this.loadSettings()
    };
    renderers[view]?.();
    
    this.updateTopbarTitle(view);
    
    // Persist current view for restore
    this._patchSettings({ lastView: view });
  },

  updateTopbarTitle(view) {
    const titles = {
      bookshelf: '서재',
      reader: this.currentBook?.title || '읽기',
      vocabulary: '단어장',
      queue: '나중에 공부',
      highlights: '하이라이트',
      history: '피드백 이력',
      report: '리포트',
      diagnosis: '실력 진단',
      settings: '설정'
    };
    $('topbar-title').textContent = titles[view] || 'E-Story';
    // Reader hides large-title & shows back button; other views, hide back
    const backBtn = $('topbar-back');
    if (backBtn) backBtn.hidden = (view !== 'reader');
  },

  _openMoreSheet() {
    $('more-sheet')?.classList.add('open');
    $('more-backdrop')?.classList.add('open');
  },
  _closeMoreSheet() {
    $('more-sheet')?.classList.remove('open');
    $('more-backdrop')?.classList.remove('open');
  },

  /* ===== Bookshelf ===== */
  async loadBookshelf() {
    const books = await getBooks();
    const grid = $('bookshelf-grid');
    
    const hasBooks = books.length > 0;
    let html = '';
    if (!hasBooks) {
      html += `<div class="upload-empty" id="upload-area">
        <svg class="empty-illo" viewBox="0 0 120 80" aria-hidden="true"><use href="#illo-shelf"/></svg>
        <div class="empty-title">첫 책을 불러오세요</div>
        <div class="empty-body">.txt 파일을 올리면 챕터·문장 단위로 자동 정리됩니다. 읽다 만난 단어와 표현은 자동으로 단어장에 쌓여요.</div>
        <div class="upload-actions">
          <button class="btn" type="button" id="upload-pick">
            <svg class="ico-svg" width="16" height="16" aria-hidden="true"><use href="#i-cloud-up"/></svg>
            <span>.txt 파일 선택</span>
          </button>
          <div class="url-import"><input type="text" id="url-input" placeholder="또는 URL로 불러오기" class="url-field"><button class="btn-s" id="url-load-btn">불러오기</button></div>
        </div>
        <input type="file" id="file-input" accept=".txt" class="hidden-input">
      </div>`;
    } else {
      html += '<div class="url-import shelf-toolbar" style="grid-column:1/-1"><input type="text" id="url-input" placeholder="URL로 새 책 불러오기" class="url-field"><button class="btn-s" id="upload-pick" aria-label="파일 선택"><svg class="ico-svg" width="16" height="16"><use href="#i-plus"/></svg></button><input type="file" id="file-input" accept=".txt" class="hidden-input"><button class="btn-s" id="url-load-btn">불러오기</button></div>';
    }

    books.forEach(book => {
      const pct = book.readingProgress ?? (book.totalChunks > 0 ? Math.round((book.currentChunk / book.totalChunks) * 100) : 0);
      const bandLabel = { green: '쉬움', yellow: '보통', red: '어려움' };
      const badge = book.difficultyBand
        ? `<span class="diff-badge ${book.difficultyBand}" title="적합도: ${bandLabel[book.difficultyBand] || ''}">${escapeHtml(book.estimatedCefr || '')}</span>`
        : '';
      html += `<div class="book-card" data-id="${book.id}">
        <button class="book-del" data-action="delete" data-id="${book.id}" title="책 삭제" aria-label="책 삭제"><svg class="ico-svg" width="14" height="14"><use href="#i-close"/></svg></button>
        ${badge}
        <div class="title">${escapeHtml(book.title)}</div>
        <div class="author">${escapeHtml(book.fileName)}</div>
        <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="meta"><span>${pct}%</span><span>${book.totalChunks} ch</span></div>
      </div>`;
    });
    
    grid.innerHTML = html;
    
    // URL import + manual pick — bind after element exists
    $('url-load-btn')?.addEventListener('click', () => this.loadBookFromUrl());
    $('url-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.loadBookFromUrl(); });
    $('upload-pick')?.addEventListener('click', () => $('file-input')?.click());
    
    this.updateQueueBadge();
  },

  async deleteBookConfirm(bookId) {
    const book = await getBook(bookId);
    if (!book) return;
    if (!confirm(`"${book.title}"을(를) 삭제할까요?\n진도·단어장·피드백 기록도 함께 삭제됩니다.`)) return;

    await deleteBook(bookId);
    if (this.currentBook?.id === bookId) this.currentBook = null;
    const s = await getSettings();
    if (s.lastOpenedBookId === bookId) await this._patchSettings({ lastOpenedBookId: null });

    this.showToast(`"${book.title}" 삭제됨`, 'success');
    await this.loadBookshelf();
    Sync.scheduleSync();
  },

  async handleUpload(e) {
    const file = e.target.files[0];
    if (file) await this.processFile(file);
    e.target.value = '';
  },

  async processFile(file) {
    if (!file.name.endsWith('.txt')) {
      this.showToast('.txt 파일만 업로드 가능합니다.', 'error');
      return;
    }
    const text = await file.text();
    const id = await addBook(file, text);
    this.showToast(`"${file.name}" 추가 완료!`, 'success');
    await this.loadBookshelf();
    Sync.scheduleSync();
  },

  async loadBookFromUrl() {
    const input = $('url-input');
    let url = input.value.trim();
    if (!url) { this.showToast('URL을 입력해주세요.', 'error'); return; }
    
    // Smart URL fixup. "8000/path" => localhost:8000/path; anything else
    // missing a protocol just gets http:// prefixed.
    if (/^\d+[:/]/.test(url)) {
      url = 'http://localhost:' + url.replace(/^(\d+)[:/]/, '$1/');
    } else if (!/^https?:\/\//.test(url)) {
      url = 'http://' + url;
    }
    input.value = url;
    
    this.showToast('📥 책 다운로드 중...', 'info');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length < 100) throw new Error('파일이 너무 작습니다');
      
      // Create a virtual File object
      const fileName = decodeURIComponent(url.split('/').pop() || 'book.txt');
      const file = new File([text], fileName, { type: 'text/plain' });
      const id = await addBook(file, text);
      this.showToast(`✅ "${fileName}" 추가 완료!`, 'success');
      input.value = '';
      await this.loadBookshelf();
      Sync.scheduleSync();
    } catch(e) {
      // A network/CORS failure surfaces as a TypeError ("Failed to fetch").
      // Most public sites (Project Gutenberg 포함) send no CORS headers, so a
      // browser fetch is blocked — tell the user to download then upload.
      let msg = e.message;
      if (e.message.includes('Failed to fetch') || e.name === 'TypeError') {
        msg = '이 URL은 브라우저 보안 정책(CORS)으로 직접 받을 수 없거나 서버가 꺼져 있습니다. 파일을 PC에 내려받아 업로드하거나, 로컬 서버(맥: python3 serve.py)를 사용해주세요.';
      }
      this.showToast('❌ 불러오기 실패: ' + msg, 'error');
    }
  },

  /* ===== Reader ===== */
  async openBook(bookId) {
    this.currentBook = await getBook(bookId);
    if (!this.currentBook) return;

    // Save last opened book for position restore
    this._patchSettings({ lastOpenedBookId: bookId });

    this.bookData = { id: bookId, book: this.currentBook };
    const chunks = await getChunks(bookId);
    this.currentChunks = chunks;
    const startChunk = Math.min(this.currentBook.currentChunk, chunks.length - 1);
    this.currentSelectedChunkIndex = startChunk;
    this.currentChunk = chunks[startChunk] || chunks[0];
    this.currentSentences = await getSentences(this.currentChunk.id);

    // Set AI reading context for No-spoiler
    AI.setReadingContext(this.currentBook.title, startChunk, chunks.length);

    // Prepend reader page
    $('reader-page').classList.add('active');
    this.switchView('reader');

    this._page = Math.max(0, Math.min(this.currentBook.currentPage || 0, this._totalPages() - 1));
    this.renderReader();
    this.loadChapterSummary();
    this.loadWarmup();
    this.ensureDifficulty();
    this._startReadingSession();
    this._maybeCoachToast();
    this._maybeReviewNudge();

    // Restore scroll position
    if (this.currentBook.currentOffset) {
      setTimeout(() => {
        const stage = document.querySelector('.stage');
        if (stage) stage.scrollTop = this.currentBook.currentOffset;
        else window.scrollTo({ top: this.currentBook.currentOffset, behavior: 'instant' });
      }, 50);
    }
  },

  // Lazily estimate book difficulty (CEFR + green/yellow/red) on first open,
  // using only the first chunk as a sample. Cached on the book record so it
  // runs once. Silent in demo mode (no key) — no badge appears.
  async ensureDifficulty() {
    const book = this.currentBook;
    if (!book || book.difficultyBand) return;
    const sample = this.currentChunks?.[0]?.content;
    if (!sample) return;
    const r = await AI.analyzeDifficulty(sample);
    if (!r || r.error || !r.estimatedCefr) return;
    const fields = {
      estimatedCefr: r.estimatedCefr,
      difficultyBand: r.difficultyBand || 'yellow',
      difficultyNote: r.rationaleKo || ''
    };
    await updateBook(book.id, fields);
    Object.assign(this.currentBook, fields);
  },

  // Paragraphs shown per page within a chunk (keeps each screen short).
  PARAS_PER_PAGE: 2,

  // Ordered list of unique paragraph keys in the current chunk.
  _paraKeys() {
    return [...new Set((this.currentSentences || []).map(s => s.para ?? 0))];
  },

  _totalPages() {
    return Math.max(1, Math.ceil(this._paraKeys().length / this.PARAS_PER_PAGE));
  },

  // The paragraph keys visible on the current page.
  _currentPageParas() {
    const keys = this._paraKeys();
    const start = (this._page || 0) * this.PARAS_PER_PAGE;
    return new Set(keys.slice(start, start + this.PARAS_PER_PAGE));
  },

  // Sentences (with their global index) visible on the current page — used by TTS.
  _visibleSentences() {
    const pageParas = this._currentPageParas();
    const out = [];
    (this.currentSentences || []).forEach((s, i) => {
      if (pageParas.has(s.para ?? 0)) out.push({ s, i });
    });
    return out;
  },

  // Group the CURRENT PAGE's sentences into <p> blocks. data-index stays the
  // global index into currentSentences so click/TTS stay correct across pages.
  renderParagraphs() {
    const pageParas = this._currentPageParas();
    let html = '';
    let curPara = null;
    (this.currentSentences || []).forEach((sent, i) => {
      const p = sent.para ?? 0;
      if (!pageParas.has(p)) return;
      if (p !== curPara) {
        if (curPara !== null) html += '</p>';
        html += '<p>';
        curPara = p;
      }
      html += `<span class="sent" data-index="${i}" data-text="${escapeHtml(sent.text)}">${escapeHtml(sent.text)} </span>`;
    });
    if (curPara !== null) html += '</p>';
    return html || '<p></p>';
  },

  // Page nav markup (within-chunk). Crosses chunk boundaries at the ends.
  _renderPageNav() {
    const total = this._totalPages();
    const page = this._page || 0;
    const atFirst = page <= 0 && this.currentSelectedChunkIndex <= 0;
    const atLast = page >= total - 1 && this.currentSelectedChunkIndex >= this.currentChunks.length - 1;
    return `
      <button class="topbar-btn page-btn" data-page="prev"${atFirst ? ' disabled' : ''}><svg class="ico-svg" width="14" height="14"><use href="#i-chevron-left"/></svg><span>이전</span></button>
      <span class="ch-label">${page + 1} / ${total}</span>
      <button class="topbar-btn page-btn" data-page="next"${atLast ? ' disabled' : ''}><span>다음</span><svg class="ico-svg" width="14" height="14"><use href="#i-chevron-right"/></svg></button>`;
  },

  // Move within the chunk by page; at the edges, move to the adjacent chunk.
  turnPage(dir) {
    const total = this._totalPages();
    const page = this._page || 0;
    if (dir === 'next') {
      if (page < total - 1) { this._page = page + 1; this._renderPage(); this._savePageProgress(); }
      else this.goToChunk(this.currentSelectedChunkIndex + 1, 'first');
    } else {
      if (page > 0) { this._page = page - 1; this._renderPage(); this._savePageProgress(); }
      else this.goToChunk(this.currentSelectedChunkIndex - 1, 'last');
    }
  },

  // Re-render only the text + page nav (keeps warmup/summary/goal intact).
  _renderPage() {
    const rt = $('reader-text');
    if (rt) rt.innerHTML = this.renderParagraphs();
    const nav = $('page-nav');
    if (nav) nav.innerHTML = this._renderPageNav();
    (document.querySelector('.stage') || window).scrollTo({ top: 0, behavior: 'instant' });
  },

  renderReader() {
    const wrap = $('reader-wrap');
    
    // Apply font size from settings
    getSettings().then(s => {
      wrap.style.fontSize = (s.fontSize || 16) + 'px';
    });
    
    const prevDisabled = this.currentSelectedChunkIndex <= 0;
    const nextDisabled = this.currentSelectedChunkIndex >= this.currentChunks.length - 1;
    const ttsOpen = this.readerMode === 'tts';
    
    wrap.innerHTML = `
      <div class="reader-header">
        <div class="ch-title">${escapeHtml(this.currentChunk.title)}</div>
        <div class="book-title">${escapeHtml(this.currentBook.title)}</div>
      </div>
      <div id="chapter-warmup" class="chapter-warmup" hidden></div>
      <div id="chapter-summary" class="chapter-summary" hidden></div>
      <div class="expr-reco-bar">
        <button class="topbar-btn" id="expr-reco-btn"><svg class="ico-svg" width="16" height="16"><use href="#i-sparkle"/></svg><span>이 챕터에서 학습할 표현 추천</span></button>
      </div>
      <div id="expr-reco" class="expr-reco" hidden></div>
      <div class="ch-nav">
        <button class="topbar-btn ch-nav-btn" data-dir="prev"${prevDisabled ? ' disabled' : ''}><svg class="ico-svg" width="16" height="16"><use href="#i-chevron-left"/></svg><span>이전</span></button>
        <span class="ch-label">${this.currentSelectedChunkIndex + 1} / ${this.currentChunks.length}</span>
        <button class="topbar-btn ch-nav-btn" data-dir="next"${nextDisabled ? ' disabled' : ''}><span>다음</span><svg class="ico-svg" width="16" height="16"><use href="#i-chevron-right"/></svg></button>
      </div>
      <div class="mode-selector">
        <button class="mode-btn${this.readerMode === 'story' ? ' active-mode' : ''}" data-mode="story">읽기</button>
        <button class="mode-btn${this.readerMode === 'tts' ? ' active-mode' : ''}" data-mode="tts">낭독</button>
      </div>
      <div id="tts-bar" class="tts-bar${ttsOpen ? ' open' : ''}">
        <button class="topbar-btn" id="tts-play" aria-label="재생"><svg class="ico-svg" width="14" height="14"><use href="#i-play"/></svg></button>
        <button class="topbar-btn" id="tts-pause" aria-label="일시정지"><svg class="ico-svg" width="14" height="14"><use href="#i-pause"/></svg></button>
        <button class="topbar-btn" id="tts-stop" aria-label="정지"><svg class="ico-svg" width="14" height="14"><use href="#i-stop"/></svg></button>
        <span class="tts-label">속도</span>
        <input type="range" id="tts-rate" min="0.3" max="2.0" step="0.1" value="${TTS._rate}">
        <span id="tts-rate-val" class="tts-val">${TTS._rate}x</span>
      </div>
      <div class="reader-text" id="reader-text">
        ${this.renderParagraphs()}
      </div>
      <div class="page-nav" id="page-nav">${this._renderPageNav()}</div>
    `;
    
    // Single event delegation for wrap
    if (!wrap._readerDelegation) {
      wrap.addEventListener('click', (e) => {
        const navBtn = e.target.closest('.ch-nav-btn');
        if (navBtn) {
          if (navBtn.dataset.dir === 'prev') this.goToChunk(this.currentSelectedChunkIndex - 1);
          else if (navBtn.dataset.dir === 'next') this.goToChunk(this.currentSelectedChunkIndex + 1);
          return;
        }
        
        const pageBtn = e.target.closest('.page-btn');
        if (pageBtn) {
          this.turnPage(pageBtn.dataset.page);
          return;
        }

        const modeBtn = e.target.closest('.mode-btn');
        if (modeBtn) {
          this.setReaderMode(modeBtn.dataset.mode);
          return;
        }
        
        if (e.target.closest('#tts-play')) { this.startTTS(); return; }
        if (e.target.closest('#tts-pause')) { TTS.isSpeaking() ? TTS.pause() : TTS.resume(); return; }
        if (e.target.closest('#tts-stop')) { TTS.stop(); return; }

        if (e.target.closest('#expr-reco-btn')) { this.loadExprReco(); return; }
        const addBtn = e.target.closest('.er-add');
        if (addBtn) { this.saveExprFromReco(addBtn); return; }

        const sentEl = e.target.closest('.sent');
        if (sentEl) {
          const index = parseInt(sentEl.dataset.index);
          const text = sentEl.dataset.text;
          this.onSentenceClick(index, text);
        }
      });
      wrap._readerDelegation = true;
    }
    
    // Rate slider events
    const rateSlider = $('tts-rate');
    if (rateSlider) {
      rateSlider.addEventListener('input', () => {
        TTS._rate = parseFloat(rateSlider.value);
        $('tts-rate-val').textContent = TTS._rate + 'x';
      });
      rateSlider.addEventListener('change', () => {
        TTS.setRate(parseFloat(rateSlider.value));
      });
    }
  },

  goToChunk(index, pagePos = 'first') {
    if (index < 0 || index >= this.currentChunks.length) return;
    if (index === this.currentSelectedChunkIndex) return;

    // Save progress before moving
    const scrollOffset = window.scrollY || window.pageYOffset;
    updateBookProgress(this.currentBook.id, this.currentSelectedChunkIndex, scrollOffset, this._page || 0);
    // End the session for the chunk we're leaving, then start a fresh one.
    this._endReadingSession();

    // Switch chunk
    this.currentSelectedChunkIndex = index;
    this.currentChunk = this.currentChunks[index];
    this._startReadingSession();

    // Update AI reading context
    AI.setReadingContext(this.currentBook.title, index, this.currentChunks.length);

    // Load sentences for new chunk
    getSentences(this.currentChunk.id).then(sents => {
      this.currentSentences = sents;
      // Land on the first or last page depending on nav direction.
      this._page = pagePos === 'last' ? this._totalPages() - 1 : 0;
      this.renderReader();
      this.loadChapterSummary();
      this.loadWarmup();
      (document.querySelector('.stage') || window).scrollTo({ top: 0, behavior: 'instant' });
      this._savePageProgress();
    });
    
    // Save current chunk in DB
    updateBookProgress(this.currentBook.id, index, 0, this._page || 0);
  },

  setReaderMode(mode) {
    this.readerMode = mode;
    $('tts-bar').classList.toggle('open', mode === 'tts');
  },

  /* ===== Reading session (help-dependency logging) ===== */
  _startReadingSession() {
    this._endReadingSession();
    if (!this.currentBook) return;
    startReadingSession(this.currentBook.id, this.currentSelectedChunkIndex)
      .then(id => { this.currentSessionId = id; });
  },

  _endReadingSession() {
    const id = this.currentSessionId;
    if (!id) return;
    this.currentSessionId = null;
    const wordsRead = (this.currentSentences || [])
      .reduce((n, s) => n + (s.text ? s.text.split(/\s+/).filter(Boolean).length : 0), 0);
    endReadingSession(id, this.currentSelectedChunkIndex, wordsRead);
  },

  // Fire-and-forget counter bump; safe when no session is active.
  _logHelp(type) {
    if (this.currentSessionId) bumpSessionCounter(this.currentSessionId, type);
  },

  /* ===== Sentence Click → Quick Menu ===== */
  async onSentenceClick(index, text) {
    this.selectedSentence = { index, text };
    this.selectedWord = null;
    this._phraseMode = false;
    this._phraseSel = [];

    // Highlight the sentence (locate by data-index — paging renders a subset)
    document.querySelectorAll('.sent').forEach(s => s.classList.remove('active'));
    const activeEl = document.querySelector(`.sent[data-index="${index}"]`);
    if (activeEl) activeEl.classList.add('active');

    const rect = activeEl?.getBoundingClientRect();
    const menu = $('quick-menu');

    // Generate word tokens for each word in the sentence
    const words = text.split(' ').filter(w => w.length > 0);
    const wordHtml = words.map((w, wi) => {
      const clean = escapeHtml(w);
      return `<span class="qm-word word-chip" data-word="${clean}" data-i="${wi}">${clean}</span>`;
    }).join('');

    menu.innerHTML = `
      <div class="qm-sentence">${escapeHtml(text)}</div>
      <div class="qm-words-wrap">${wordHtml}</div>
      <div class="qm-actions">
        <button class="qm-btn word" data-action="word">단어 힌트</button>
        <button class="qm-btn phrase" data-action="phraseMode">구 저장</button>
        <button class="qm-btn grammar" data-action="grammar">구문 힌트</button>
        <button class="qm-btn structure" data-action="structure">구조 분석</button>
        <button class="qm-btn kgram" data-action="koreanGrammar">한국인 포인트</button>
        <button class="qm-btn chunk" data-action="chunkReading">끊어 읽기</button>
        <button class="qm-btn easy" data-action="easyEnglish">쉬운 영어</button>
        <button class="qm-btn gist" data-action="gist">문장 요지</button>
        <button class="qm-btn ask" data-action="ask">자유 질문</button>
        <button class="qm-btn study" data-action="study">해석해보기</button>
        <button class="qm-btn highlight" data-action="highlight">하이라이트</button>
        <button class="qm-btn queue" data-action="queue">나중에</button>
      </div>
      <div id="hint-result" class="qm-hint-result"></div>
    `;
    
    menu.classList.add('open');

    // 모바일: 좌표 계산을 건너뛰고 CSS의 하단 고정(바텀시트) 배치를 따른다.
    if (window.matchMedia('(max-width:1023px)').matches) {
      menu.style.left = '';
      menu.style.right = '';
      menu.style.top = '';
      menu.style.bottom = '';
      if (activeEl) {
        setTimeout(() => activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
      }
    } else if (rect) {
      // Reset previous positioning
      menu.style.top = '';
      menu.style.bottom = '';

      // Measure actual menu dimensions after it becomes visible
      const menuRect = menu.getBoundingClientRect();
      const menuW = menuRect.width;
      const menuH = menuRect.height;
      const BOTTOM_PAD = 80; // page nav (.page-nav) + breathing room

      // Horizontal: keep within viewport, 10px margin on each side
      const left = Math.min(Math.max(10, rect.left), window.innerWidth - menuW - 10);
      menu.style.left = left + 'px';

      // Vertical: flip up if it overflows past the bottom safe zone
      if (rect.bottom + 8 + menuH > window.innerHeight - BOTTOM_PAD) {
        // Open above the sentence
        menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        menu.style.top = '';
      } else {
        // Open below the sentence (default)
        menu.style.top = (rect.bottom + 8) + 'px';
        menu.style.bottom = '';
      }
    }
  },

  // 구(句) 저장 모드: 단어 칩을 여러 개 골라 "be reluctant to" 같은 표현을 저장.
  togglePhraseMode() {
    this._phraseMode = !this._phraseMode;
    this._phraseSel = [];
    document.querySelectorAll('.qm-word').forEach(w => w.classList.remove('selected'));
    const result = $('hint-result');
    if (!result) return;
    if (!this._phraseMode) { result.style.display = 'none'; result.innerHTML = ''; return; }
    result.style.display = 'block';
    result.innerHTML = `
      <div class="qm-phrase-hint">단어를 순서대로 눌러 표현을 만드세요.</div>
      <div class="qm-phrase-preview" id="qm-phrase-preview">—</div>
      <button class="qm-phrase-save" disabled>🔗 이 표현 저장</button>
    `;
  },

  togglePhraseWord(el) {
    el.classList.toggle('selected');
    this._refreshPhrasePreview();
  },

  _refreshPhrasePreview() {
    const sel = [...document.querySelectorAll('.qm-word.selected')]
      .map(w => ({ i: parseInt(w.dataset.i), word: w.dataset.word }))
      .sort((a, b) => a.i - b.i);
    this._phraseSel = sel;
    const phrase = sel.map(s => s.word).join(' ').replace(/[",.;:!?]+$/g, '').trim();
    const prev = $('qm-phrase-preview');
    const btn = document.querySelector('.qm-phrase-save');
    if (prev) prev.textContent = phrase || '—';
    if (btn) btn.disabled = sel.length < 2;
  },

  async savePhrase() {
    const phrase = this._phraseSel.map(s => s.word).join(' ').replace(/[",.;:!?]+$/g, '').trim();
    if (!phrase || this._phraseSel.length < 2) return;
    const btn = document.querySelector('.qm-phrase-save');
    if (btn) { btn.disabled = true; btn.textContent = '뜻 불러오는 중...'; }
    const hint = await AI.wordHint(phrase, this.selectedSentence.text);
    const meaning = (hint && hint.meaningKo) || '';
    // contextSentence = the full sentence → 생산형 복습에서 빈칸 cloze가 동작.
    const r = await addWord(phrase, meaning, this.selectedSentence.text, this.currentBook?.id, this.selectedSentence?.index, '');
    if (r && r.blocked) {
      this.showToast(`오늘 새 카드 한도(${r.cap}개)에 도달했어요. 내일 다시 추가할 수 있어요.`, 'info');
      if (btn) { btn.textContent = '🔗 이 표현 저장'; btn.disabled = false; }
      return;
    }
    this.showToast(`"${phrase}" 표현 저장됨!`, 'success');
    this.updateQueueBadge();
    Sync.scheduleSync();
    if (btn) btn.textContent = '✅ 저장됨';
  },

  closeQuickMenu() {
    $('quick-menu')?.classList.remove('open');
    this.selectedWord = null;
  },

  async wordHint(targetWord) {
    const word = targetWord || this.selectedWord;
    if (!word) {
      this.showToast('문장에서 단어를 클릭해주세요!', 'info');
      return;
    }
    const result = $('hint-result');
    result.style.display = 'block';
    result.textContent = '단어 뜻 불러오는 중...';
    this._logHelp('dictionaryClicks');
    const hint = await AI.wordHint(word, this.selectedSentence.text);
    const meaning = hint.meaningKo || '';
    result.innerHTML = `<b>${escapeHtml(word)}</b>: ${escapeHtml(meaning || '데이터를 불러오는 중입니다')} <span style="color:var(--tx3)">(${escapeHtml(hint.partOfSpeech || '')})</span>`
      + ` <button class="qm-vocab-add" data-word="${escapeHtml(word)}" data-meaning="${escapeHtml(meaning)}">➕ 단어장</button>`;
  },

  async saveWordDirect(word, meaning) {
    if (!word) return;
    const r = await addWord(word, meaning || '', this.selectedSentence?.text || '', this.currentBook?.id, this.selectedSentence?.index, '');
    if (r && r.blocked) {
      this.showToast(`오늘 새 카드 한도(${r.cap}개)에 도달했어요. 내일 다시 추가할 수 있어요.`, 'info');
      return;
    }
    this.showToast(`"${word}" 단어장에 추가됨!`, 'success');
  },

  async grammarHint() {
    const result = $('hint-result');
    result.style.display = 'block';
    result.textContent = '분석 중...';
    this._logHelp('helpStepsUsed');
    const data = await AI.grammarHint(this.selectedSentence.text);
    if (data.error) {
      result.textContent = '⚠️ ' + (data.message || '분석 실패');
      return;
    }
    result.innerHTML = `<b>문장 구조:</b> ${escapeHtml(data.structure)}<br><b>시제:</b> ${escapeHtml(data.tense)}`;
  },

  async sentenceGist() {
    const result = $('hint-result');
    result.style.display = 'block';
    result.textContent = '요약 중...';
    this._logHelp('translationClicks');
    const data = await AI.sentenceGist(this.selectedSentence.text);
    if (data.error) {
      result.textContent = '⚠️ ' + (data.message || '요약 실패');
      return;
    }
    result.textContent = `📋 ${data.gistKo}`;
  },

  // 한국어로 바로 번역하지 않고, 더 쉬운 영어로 같은 뜻을 보여준다.
  async easyEnglish() {
    const result = $('hint-result');
    result.style.display = 'block';
    result.textContent = '쉬운 영어로 바꾸는 중...';
    if (this.currentSessionId && typeof bumpSessionCounter === 'function') {
      bumpSessionCounter(this.currentSessionId, 'helpStepsUsed');
    }
    const data = await AI.easyEnglish(this.selectedSentence.text);
    if (data.error) {
      result.textContent = '⚠️ ' + (data.message || '실패');
      return;
    }
    result.textContent = `🟢 ${data.easyEn}`;
  },

  // 영어 어순 그대로 의미 단위로 끊어 보여준다(후치수식·관계절 훈련).
  async chunkReading() {
    const result = $('hint-result');
    result.style.display = 'block';
    result.textContent = '끊어 읽는 중...';
    this._logHelp('helpStepsUsed');
    const data = await AI.chunkReading(this.selectedSentence.text);
    if (data.error) {
      result.textContent = '⚠️ ' + (data.message || '실패');
      return;
    }
    result.innerHTML = `<div class="chunk-list">` + data.groups.map(g =>
      `<div class="chunk-row"><span class="chunk-en">${escapeHtml(g.en || '')}</span><span class="chunk-ko">${escapeHtml(g.ko || '')}</span></div>`
    ).join('') + `</div>`;
  },

  // 한국인이 약한 포인트(대명사 지시·완료시제·후치수식·무생물 주어 등)를 짚어준다.
  async koreanGrammar() {
    const result = $('hint-result');
    result.style.display = 'block';
    result.textContent = '한국인 포인트 분석 중...';
    this._logHelp('helpStepsUsed');
    const data = await AI.koreanGrammar(this.selectedSentence.text);
    if (data.error) {
      result.textContent = '⚠️ ' + (data.message || '실패');
      return;
    }
    result.innerHTML = data.points.map(p =>
      `<div class="kg-row"><span class="kg-type">${escapeHtml(p.type || '')}</span><div class="kg-ko">${escapeHtml(p.ko || '')}</div></div>`
    ).join('');
  },


  // 문장에 대해 AI에게 자유롭게 질문하는 입력칸을 연다.
  askFreeQuestion() {
    const result = $('hint-result');
    result.style.display = 'block';
    result.innerHTML = `
      <div class="qm-ask-wrap">
        <textarea class="qm-ask-input" id="qm-ask-input" rows="2" placeholder="이 문장에 대해 무엇이든 물어보세요 (예: 이 표현 무슨 뜻이야?)"></textarea>
        <button class="qm-ask-send">질문하기</button>
      </div>
      <div id="qm-ask-answer" class="qm-ask-answer"></div>
    `;
    const ta = $('qm-ask-input');
    ta?.focus();
    if (ta && window.matchMedia('(max-width:768px)').matches) {
      setTimeout(() => ta.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    }
    ta?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.submitFreeQuestion();
      }
    });
  },

  async submitFreeQuestion() {
    const ta = $('qm-ask-input');
    const ans = $('qm-ask-answer');
    if (!ta || !ans) return;
    const question = ta.value.trim();
    if (!question) { ta.focus(); return; }
    ans.style.display = 'block';
    ans.textContent = '생각 중...';
    const context = `책: "${this.currentBook?.title || '알 수 없음'}", 챕터: ${this.currentSelectedChunkIndex + 1}/${this.currentChunks?.length || '?'} (${this.currentChunk?.title || ''})`;
    const data = await AI.storyBuddy(this.selectedSentence.text, question, context);
    ans.textContent = data.answerKo || '답변을 불러올 수 없습니다.';
  },

  // ── 구조 분석 훈련 (능동 태깅) ──
  _STRUCT_ROLES: ['주어', '동사', '목적어', '보어', '수식어', '기능어'],

  // AI가 6종 외 변형 라벨을 돌려줘도 정답으로 인정되도록 정규화 (정답인데 오답 처리되던 버그 방지)
  _ROLE_CANON: {
    '주어':'주어', '주부':'주어', '주어부':'주어',
    '동사':'동사', '술어':'동사', '술어동사':'동사', '본동사':'동사', '동사구':'동사',
    '목적어':'목적어', '목적부':'목적어', '직접목적어':'목적어', '간접목적어':'목적어',
    '보어':'보어', '주격보어':'보어', '목적격보어':'보어', '보격':'보어',
    '수식어':'수식어', '수식':'수식어', '부사':'수식어', '부사어':'수식어', '부사구':'수식어',
    '형용사':'수식어', '형용사구':'수식어', '관형어':'수식어',
    '기능어':'기능어', '관사':'기능어', '전치사':'기능어', '접속사':'기능어',
    '조동사':'기능어', '한정사':'기능어', '구두점':'기능어', '조사':'기능어', '대명사':'기능어',
  },

  _canonRole(raw) {
    if (!raw) return null;
    const s = String(raw).replace(/\(.*?\)/g, '').replace(/\s+/g, '');
    if (this._ROLE_CANON[s]) return this._ROLE_CANON[s];
    // 더 구체적인(긴) 키부터 부분 일치 검사
    const keys = Object.keys(this._ROLE_CANON).sort((a, b) => b.length - a.length);
    for (const k of keys) if (s.includes(k)) return this._ROLE_CANON[k];
    return null;
  },

  openStructure() {
    this.closeQuickMenu();
    const sentence = this.selectedSentence?.text;
    if (!sentence) return;
    this._logHelp('helpStepsUsed');
    const tokens = sentence.split(/\s+/).filter(Boolean);
    this._structUser = {};   // tokenIndex -> roleIndex
    this._structActive = 0;  // active role index

    const roles = this._STRUCT_ROLES;
    const palette = roles.map((r, ri) =>
      `<button class="struct-role r${ri}${ri === 0 ? ' active' : ''}" data-role="${ri}">${r}</button>`).join('');
    const toks = tokens.map((t, i) =>
      `<span class="struct-tok" data-i="${i}">${escapeHtml(t)}</span>`).join(' ');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.id = 'structure-modal';
    overlay.innerHTML = `
      <div class="modal struct-modal">
        <h2>🏷️ 구조 분석</h2>
        <p class="struct-help">역할을 고른 뒤 단어를 눌러 라벨링하세요. 같은 단어를 다시 누르면 해제됩니다.</p>
        <div class="struct-palette">${palette}</div>
        <div class="struct-tokens">${toks}</div>
        <div class="struct-result" id="struct-result"></div>
        <div class="modal-actions">
          <button class="btn-s" id="struct-cancel">닫기</button>
          <button class="btn" id="struct-submit">채점</button>
        </div>
      </div>`;
    document.getElementById('structure-modal')?.remove();
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.struct-role').forEach(b => {
      b.addEventListener('click', () => {
        this._structActive = parseInt(b.dataset.role);
        overlay.querySelectorAll('.struct-role').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
    });
    overlay.querySelectorAll('.struct-tok').forEach(tok => {
      tok.addEventListener('click', () => {
        const i = parseInt(tok.dataset.i);
        if (this._structUser[i] === this._structActive) {
          delete this._structUser[i];
          tok.className = 'struct-tok';
        } else {
          this._structUser[i] = this._structActive;
          tok.className = 'struct-tok r' + this._structActive;
        }
      });
    });
    overlay.querySelector('#struct-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#struct-submit').addEventListener('click', () => this._gradeStructure(sentence, overlay));
  },

  async _gradeStructure(sentence, overlay) {
    const res = overlay.querySelector('#struct-result');
    const submitBtn = overlay.querySelector('#struct-submit');
    res.innerHTML = '🔍 채점 중...';
    submitBtn.disabled = true;

    const data = await AI.analyzeStructure(sentence);
    submitBtn.disabled = false;
    if (!data || data.error || !Array.isArray(data.items)) {
      res.innerHTML = '⚠️ 분석 실패 — 잠시 후 다시 시도해주세요.';
      return;
    }

    const roles = this._STRUCT_ROLES;
    let hit = 0, labeled = 0;
    const review = [];
    overlay.querySelectorAll('.struct-tok').forEach((el, i) => {
      const item = data.items[i] || {};
      const canon = this._canonRole(item.role);
      const correctIdx = roles.indexOf(canon);
      // 정답 후보: accept 배열(없으면 role) → 모두 정규화
      const acceptRaw = Array.isArray(item.accept) && item.accept.length ? item.accept : [item.role];
      const acceptSet = acceptRaw.map(r => this._canonRole(r)).filter(Boolean);
      if (canon && !acceptSet.includes(canon)) acceptSet.push(canon);

      // 토큰을 '정답 역할' 색으로 칠함 (채점과 설명이 같은 분석에서 나옴)
      el.className = 'struct-tok' + (correctIdx >= 0 ? ' r' + correctIdx : '');
      if (item.why && canon) el.title = `${canon} — ${item.why}`;

      const userRole = this._structUser[i];
      let status = 'skip'; // skip | ok | miss
      if (userRole !== undefined) {
        labeled++;
        if (acceptSet.includes(roles[userRole])) { el.classList.add('ok'); hit++; status = 'ok'; }
        else { el.classList.add('miss'); status = 'miss'; }
      }
      review.push({
        word: el.textContent,
        mine: userRole !== undefined ? roles[userRole] : null,
        correct: canon, correctIdx,
        alt: acceptSet.filter(r => r && r !== canon),
        why: item.why || '', status,
      });
    });
    const score = labeled ? Math.round((hit / labeled) * 100) : 0;

    // === 학습 데이터 저장 (fire-and-forget) ===
    const bookId = this.currentBook?.id;
    const chunkId = this.currentChunk?.id;
    const sIndex = this.selectedSentence?.index;
    if (bookId) {
      (async () => {
        try {
          const sessionId = await addStructureSession({
            bookId, chunkId, sentenceIndex: sIndex,
            sentenceText: sentence,
            score, hitCount: hit, labeledCount: labeled,
            tokenCount: review.length,
          });
          const tokensToSave = review.map(r => ({
            token: r.word,
            mineRole: r.mine,
            correctRole: r.correct,
            isCorrect: r.status === 'ok' ? 1 : 0,
          }));
          await addStructureTokens(sessionId, bookId, tokensToSave);
        } catch (err) {
          console.warn('[structure] 저장 실패:', err);
        }
      })();
    }
    // === END ===

    // 오답 → 미선택 → 정답 순으로 정렬해 틀린 것부터 한눈에
    const order = { miss: 0, skip: 1, ok: 2 };
    const rowHtml = [...review].sort((a, b) => order[a.status] - order[b.status]).map(r => {
      const ci = r.correctIdx >= 0 ? ' r' + r.correctIdx : '';
      let verdict;
      if (r.status === 'ok') verdict = `<span class="sr-ok">✓ 정답</span>`;
      else if (r.status === 'miss') verdict = `<span class="sr-miss">✗ 내 답 <b>${escapeHtml(r.mine)}</b> → 정답 <b>${escapeHtml(r.correct || '?')}</b></span>`;
      else verdict = `<span class="sr-skip">미선택 · 정답 <b>${escapeHtml(r.correct || '?')}</b></span>`;
      const altTxt = r.alt.length ? ` <span class="sr-alt">(${escapeHtml(r.alt.join('/'))}도 인정)</span>` : '';
      return `<div class="sr-item ${r.status}">
        <span class="sr-word${ci}">${escapeHtml(r.word)}</span>
        <div class="sr-detail">
          <div class="sr-verdict">${verdict}${altTxt}</div>
          ${r.why ? `<div class="sr-why">${escapeHtml(r.why)}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    const legend = roles.map((r, ri) => `<span class="struct-legend r${ri}">${r}</span>`).join('');
    res.innerHTML = `
      <div class="struct-score">정답률 ${score}% <span class="struct-sub">(${hit}/${labeled})</span></div>
      <div class="struct-legend-row">${legend}</div>
      ${data.note ? `<div class="struct-note">💡 ${escapeHtml(data.note)}</div>` : ''}
      <div class="struct-review">${rowHtml}</div>`;
  },

  async openStudy() {
    this.closeQuickMenu();
    $('study-panel').classList.add('open');
    history.pushState({ studyPanel: true }, '');
    this.feedbackAttempts = [];
    
    $('study-sentence').textContent = this.selectedSentence.text;
    $('study-user-input').value = '';
    $('study-feedback').classList.remove('open');
    $('study-compare').classList.remove('open');
    $('study-submit').disabled = false;
    $('study-submit').innerHTML = '<svg class="ico-svg" width="16" height="16"><use href="#i-check"/></svg><span>해석 제출</span>';
    $('study-buddy').innerHTML = '';
    
    // Scroll to top of panel
    $('study-body').scrollTop = 0;
  },

  closeStudy() {
    if (history.state && history.state.studyPanel) {
      history.back();
      return;
    }
    $('study-panel').classList.remove('open');
    TTS.stop();
  },

  /* ===== Study Mode: Feedback Loop ===== */
  async submitTranslation() {
    const input = $('study-user-input');
    const text = input.value.trim();
    if (!text) return;
    
    $('study-submit').disabled = true;
    $('study-submit').innerHTML = '<span>분석 중...</span>';
    
    const data = await AI.feedback(this.selectedSentence.text, text, this.feedbackAttempts);
    
    const fb = $('study-feedback');
    fb.classList.add('open');
    
    if (data.status === 'finished') {
      this.feedbackAttempts.push({
        userTranslation: text,
        aiStatus: data.status,
        issueType: data.issueType,
        feedbackKo: data.feedbackKo,
        hintKo: data.hintKo,
        l1InterferenceKo: data.l1InterferenceKo
      });
      await this._renderComparison(this.selectedSentence.text, text);

    } else if (data.status === 'good_enough') {
      // H3: Show "한 번 더 다듬을까요?" dialog instead of revealing translations
      const fb = $('study-feedback');
      fb.classList.add('open');
      fb.innerHTML = `
        <div class="fb-label">💡 개선 포인트 (${this.feedbackAttempts.length + 1})</div>
        <div class="fb-text">${escapeHtml(data.feedbackKo || '좋은 해석이에요!')}</div>
        ${data.hintKo ? `<div class="fb-hint">💭 ${escapeHtml(data.hintKo)}</div>` : ''}
        ${data.l1InterferenceKo ? `<div class="fb-l1">🇰🇷 ${escapeHtml(data.l1InterferenceKo)}</div>` : ''}
        <div class="good-enough-actions" style="margin-top:12px;display:flex;gap:8px">
          <button class="btn" onclick="App._finishStudy()">✅ 이 정도면 충분해요!</button>
          <button class="btn-s" onclick="App._continueStudy()">🔄 한 번 더 다듬기</button>
        </div>
      `;
      
      this.feedbackAttempts.push({
        userTranslation: text,
        aiStatus: data.status,
        issueType: data.issueType,
        feedbackKo: data.feedbackKo,
        hintKo: data.hintKo,
        l1InterferenceKo: data.l1InterferenceKo
      });
      
      input.value = '';
      input.placeholder = '피드백을 반영해서 다시 해석해보세요...';
      $('study-submit').disabled = false;
      $('study-submit').innerHTML = '<svg class="ico-svg" width="16" height="16"><use href="#i-review"/></svg><span>다시 제출</span>';
      
    } else {
      // One-point feedback (H1: escapeHtml applied)
      fb.innerHTML = `
        <div class="fb-label">💡 개선 포인트 (${this.feedbackAttempts.length + 1})</div>
        <div class="fb-text">${escapeHtml(data.feedbackKo)}</div>
        ${data.hintKo ? `<div class="fb-hint">💭 ${escapeHtml(data.hintKo)}</div>` : ''}
        ${data.l1InterferenceKo ? `<div class="fb-l1">🇰🇷 ${escapeHtml(data.l1InterferenceKo)}</div>` : ''}
      `;
      
      this.feedbackAttempts.push({
        userTranslation: text,
        aiStatus: data.status,
        issueType: data.issueType,
        feedbackKo: data.feedbackKo,
        hintKo: data.hintKo,
        l1InterferenceKo: data.l1InterferenceKo
      });
      
      input.value = '';
      input.placeholder = '피드백을 반영해서 다시 해석해보세요...';
      $('study-submit').disabled = false;
      $('study-submit').innerHTML = '<svg class="ico-svg" width="16" height="16"><use href="#i-review"/></svg><span>다시 제출</span>';
    }
  },

  // H3: User chooses to finish study
  _finishStudy() {
    // Call AI.feedback again but this time the previousIssues will trigger 'finished' status
    // Or simply proceed to show the comparison using the last good enough data
    const last = this.feedbackAttempts[this.feedbackAttempts.length - 1];
    if (!last) return;
    
    // Manually mark as finished and show comparison
    const fb = $('study-feedback');
    const cv = $('study-compare');
    cv.classList.add('open');
    
    // We need to get the model translation from the last attempt
    // Since good_enough doesn't include translations, let AI finish properly
    this._finishWithAI(this.selectedSentence.text, last.userTranslation);
  },

  async _finishWithAI(sentence, userTranslation) {
    await this._renderComparison(sentence, userTranslation);
  },

  // Shared finish view. The literal/natural translations come from a dedicated
  // AI call on the ENGLISH source (not the feedback loop), so they never echo
  // the user's input and are reliably distinct from each other.
  async _renderComparison(sentence, userText) {
    const cv = $('study-compare');
    cv.classList.add('open');
    cv.innerHTML = '<div class="cv-label">📝 모델 해석 생성 중...</div>';

    const mt = await AI.modelTranslations(sentence);
    const ok = mt && !mt.error;
    const literal = ok ? (mt.literalTranslationKo || null) : null;
    const natural = ok ? (mt.naturalTranslationKo || null) : null;
    const note = ok ? (mt.storyNoteKo || null) : null;

    cv.innerHTML = `
      <div class="cv-row">
        <div class="cv-box">
          <div class="cv-label">내 해석</div>
          <div class="cv-text">${escapeHtml(userText)}</div>
        </div>
        <div class="cv-box">
          <div class="cv-label">구조 해석 (직역)</div>
          <div class="cv-text">${escapeHtml(literal || '—')}</div>
        </div>
      </div>
      <div class="cv-row">
        <div class="cv-box" style="grid-column:1/-1">
          <div class="cv-label">자연 해석 (의역)</div>
          <div class="cv-text">${escapeHtml(natural || '—')}</div>
        </div>
      </div>
      ${note ? `<div class="cv-note">💡 ${escapeHtml(note)}</div>` : ''}
    `;

    $('study-submit').innerHTML = '<svg class="ico-svg" width="16" height="16"><use href="#i-check"/></svg><span>완료</span>';
    $('study-submit').disabled = true;

    await saveFeedbackSession(
      this.currentBook?.id, this.selectedSentence?.index,
      this.selectedSentence?.text, this.feedbackAttempts,
      userText, literal, natural, note
    );
    Sync.scheduleSync();

    if (this._currentQueueId) {
      await markQueueDone(this._currentQueueId);
      this._currentQueueId = null;
      await this.updateQueueBadge();
    }

    $('study-buddy').innerHTML = `
      <div class="buddy-actions">
        <button class="buddy-btn" onclick="App.askBuddy('situation')">📌 지금 상황은?</button>
        <button class="buddy-btn" onclick="App.askBuddy('speaker')">🗣️ 누가 말하는 중?</button>
        <button class="buddy-btn" onclick="App.askBuddy('mood')">🎭 분위기가 어때?</button>
        <button class="buddy-btn" onclick="App.askBuddy('cultural')">🌍 문화 배경</button>
      </div>
      <div id="buddy-response" class="buddy-response"></div>
    `;
    this._renderOutputPractice();
    this._offerVocabSave();
  },

  // 읽은 문장을 바탕으로 짧게 영어로 써보고(요약·표현 활용) AI에게 부드러운
  // 교정을 받는 출력 연습. 인풋(해석) 다음의 아웃풋 훈련 단계.
  _renderOutputPractice() {
    const buddy = $('study-buddy');
    if (!buddy) return;
    const block = document.createElement('div');
    block.className = 'output-practice';
    block.innerHTML = `
      <div class="op-label">✏️ 오늘의 영작 — 방금 읽은 내용을 영어 1~2문장으로</div>
      <textarea id="op-input" class="op-input" rows="3" placeholder="배운 표현을 써서 영어로 짧게 써보세요. 완벽하지 않아도 돼요."></textarea>
      <button class="op-submit" id="op-submit">교정 받기</button>
      <div id="op-result" class="op-result"></div>
    `;
    buddy.appendChild(block);
    block.querySelector('#op-submit').addEventListener('click', () => this.submitOutput());
  },

  async submitOutput() {
    const ta = $('op-input');
    const out = $('op-result');
    if (!ta || !out) return;
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const btn = $('op-submit');
    if (btn) btn.disabled = true;
    out.style.display = 'block';
    out.textContent = '교정 중...';
    const data = await AI.correctOutput(text, this.selectedSentence?.text || '');
    if (btn) btn.disabled = false;
    if (!data || data.error) {
      out.textContent = '⚠️ 교정을 불러올 수 없습니다.';
      return;
    }
    const notes = Array.isArray(data.notesKo) ? data.notesKo : [];
    out.innerHTML = `
      ${data.correctedEn ? `<div class="op-corrected"><span class="op-tag">교정</span> ${escapeHtml(data.correctedEn)}</div>` : ''}
      ${notes.length ? `<ul class="op-notes">${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
      ${data.usedTargetExpression ? `<div class="op-bonus">🎯 배운 표현을 활용했어요!</div>` : ''}
    `;
  },

  // H3: User chooses to continue
  _continueStudy() {
    $('study-submit').disabled = false;
    $('study-submit').innerHTML = '<svg class="ico-svg" width="16" height="16"><use href="#i-review"/></svg><span>다시 제출</span>';
    $('study-user-input').focus();
  },

  async askBuddy(type) {
    const resp = $('buddy-response');
    resp.classList.add('open');
    resp.textContent = '생각 중...';
    
    const questions = {
      situation: '지금 무슨 상황이야?',
      speaker: '누가 말하는 중이야?',
      mood: '이 문장의 분위기가 어때?',
      cultural: '문화/시대 배경 설명해줘'
    };
    
    const context = `책: "${this.currentBook?.title || '알 수 없음'}", 챕터: ${this.currentSelectedChunkIndex + 1}/${this.currentChunks.length} (${this.currentChunk?.title || ''})`;
    const data = await AI.storyBuddy(this.selectedSentence.text, questions[type], context);
    resp.textContent = data.answerKo || '분석 결과를 불러올 수 없습니다.';
  },

  async loadChapterSummary() {
    const csDiv = $('chapter-summary');
    if (!csDiv) return;
    const text = this.currentChunk?.content || '';
    if (!text || text.length < 50) { csDiv.hidden = true; return; }
    csDiv.hidden = false;
    csDiv.innerHTML = '🔄 요약 불러오는 중...';
    const result = await AI.chapterSummary(text);
    if (result && !result.error && result.summary3lines) {
      let html = `<div class="cs-summary">📝 ${escapeHtml(result.summary3lines)}</div>`;
      if (result.characters?.length) {
        html += `<div class="cs-characters">👤 <b>인물:</b> ${result.characters.map(c => escapeHtml(c)).join(', ')}</div>`;
      }
      if (result.keyScenes?.length) {
        html += `<div class="cs-scenes">🎬 <b>장면:</b> ${result.keyScenes.map(s => escapeHtml(s)).join(', ')}</div>`;
      }
      if (result.expressions?.length) {
        html += `<div class="cs-expr">💡 <b>표현:</b> ${result.expressions.map(e => escapeHtml(e)).join(', ')}</div>`;
      }
      csDiv.innerHTML = html;
    } else {
      csDiv.hidden = true;
    }
  },

  // AI가 이 챕터에서 학습 가치 높은 표현 3~5개만 골라 추천한다(PRD 8.8).
  // 각 항목은 단어장 추가 버튼으로 바로 카드화(카드 한도·중복 처리 그대로).
  async loadExprReco() {
    const box = $('expr-reco');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '🔄 학습할 표현 고르는 중...';
    const r = await AI.selectExpressions(this.currentChunk?.content || '');
    if (!r || r.error || !(r.items?.length)) {
      box.innerHTML = '<div class="er-empty">추천을 불러올 수 없어요. (설정에서 AI 키를 확인하세요)</div>';
      return;
    }
    box.innerHTML = `<div class="er-title">💡 학습할 표현 추천</div>` + r.items.map(it => `
      <div class="er-item">
        <div class="er-main"><span class="er-en">${escapeHtml(it.en || '')}</span> <span class="er-ko">${escapeHtml(it.ko || '')}</span></div>
        ${it.why ? `<div class="er-why">${escapeHtml(it.why)}</div>` : ''}
        <button class="er-add" data-en="${escapeHtml(it.en || '')}" data-ko="${escapeHtml(it.ko || '')}">➕ 단어장</button>
      </div>`).join('');
  },

  async saveExprFromReco(btn) {
    const en = btn.dataset.en, ko = btn.dataset.ko;
    if (!en) return;
    const r = await addWord(en, ko || '', '', this.currentBook?.id, 0, '');
    if (r && r.blocked) {
      this.showToast(`오늘 새 카드 한도(${r.cap}개)에 도달했어요. 내일 다시 추가할 수 있어요.`, 'info');
      return;
    }
    btn.textContent = '✅ 추가됨';
    btn.disabled = true;
    this.updateQueueBadge();
    Sync.scheduleSync();
  },

  // 읽기 전 예열: "지난 이야기"(이전 챕터 요약) + 다가올 챕터의 핵심 표현.
  // 데모/오류 시 조용히 숨긴다. 사용자가 접으면 그 챕터에서는 다시 안 뜬다.
  async loadWarmup() {
    const el = $('chapter-warmup');
    if (!el) return;
    el.hidden = true;
    const idx = this.currentSelectedChunkIndex;
    const cur = this.currentChunk?.content || '';
    if (!cur || cur.length < 50) return;
    if (this._warmupDismissed === `${this.currentBook?.id}:${idx}`) return;
    const prev = idx > 0 ? (this.currentChunks[idx - 1]?.content || '') : '';
    el.hidden = false;
    el.innerHTML = '🔄 예열 불러오는 중...';
    const r = await AI.warmup(prev, cur);
    if (!r || r.error || (!r.previouslyKo && !(r.expressions?.length))) {
      el.hidden = true;
      return;
    }
    const exprs = Array.isArray(r.expressions) ? r.expressions : [];
    el.innerHTML = `
      <button class="warmup-close" title="접기" aria-label="접기">✕</button>
      <div class="warmup-title">🔥 읽기 전 예열</div>
      ${r.previouslyKo ? `<div class="warmup-prev"><b>지난 이야기</b> · ${escapeHtml(r.previouslyKo)}</div>` : ''}
      ${exprs.length ? `<div class="warmup-expr"><b>오늘의 표현</b><ul>${exprs.map(e => `<li><span class="we-en">${escapeHtml(e.en || '')}</span> <span class="we-ko">${escapeHtml(e.ko || '')}</span></li>`).join('')}</ul></div>` : ''}
    `;
    el.querySelector('.warmup-close')?.addEventListener('click', () => {
      el.hidden = true;
      this._warmupDismissed = `${this.currentBook?.id}:${idx}`;
    });
  },

  _offerVocabSave() {
    const words = this.selectedSentence.text.split(' ').filter(w => w.length > 3);
    if (!words.length) return;
    
    const fb = $('study-feedback');
    const vocabBtn = document.createElement('div');
    vocabBtn.className = 'mt-16';
    vocabBtn.innerHTML = `
      <button class="btn" onclick="App.saveWordFromSentence()">📝 단어장에 저장</button>
    `;
    fb.appendChild(vocabBtn);
  },

  async saveWordFromSentence() {
    const words = this.selectedSentence.text.split(' ').filter(w => w.length > 3);
    if (!words.length) {
      this.showToast('저장할 단어가 없습니다.', 'error');
      return;
    }
    // Show word selection modal
    this._showWordSelectModal(words);
  },

  _showWordSelectModal(words) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.id = 'vocab-select-modal';
    overlay.innerHTML = `
      <div class="modal">
        <h2>📝 저장할 단어 선택</h2>
        <p class="vocab-select-desc">이 문장에서 단어장에 저장할 단어를 선택하세요:</p>
        <div class="vocab-select-list">
          ${words.map((w, i) => `<button class="vocab-select-word" data-word="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn-s" id="vocab-select-cancel">취소</button>
        </div>
      </div>`;
    document.getElementById('vocab-select-modal')?.remove();
    document.body.appendChild(overlay);
    
    overlay.querySelectorAll('.vocab-select-word').forEach(btn => {
      btn.addEventListener('click', async () => {
        const word = btn.dataset.word;
        // M6: Fetch actual meaning from AI
        const meaning = await fetchWordMeaning(word, this.selectedSentence.text);
        const r = await addWord(word, meaning, this.selectedSentence.text, this.currentBook?.id, this.selectedSentence?.index, '');
        if (r && r.blocked) {
          this.showToast(`오늘 새 카드 한도(${r.cap}개)에 도달했어요. 내일 다시 추가할 수 있어요.`, 'info');
          overlay.remove();
          return;
        }
        this.showToast(`"${word}" 단어장에 추가됨!`, 'success');
        this.updateQueueBadge();
        Sync.scheduleSync();
        overlay.remove();
      });
      btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--bg4)'; btn.style.borderColor = 'var(--a0)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--bg3)'; btn.style.borderColor = 'var(--bd)'; });
    });
    overlay.querySelector('#vocab-select-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  },

  /* ===== Study Queue ===== */
  async queueLater() {
    this.closeQuickMenu();
    await addToQueue(this.currentBook?.id, this.selectedSentence?.index, this.selectedSentence.text);
    this.showToast('📌 나중에 공부할 문장으로 저장됨!', 'info');
    await this.updateQueueBadge();
    Sync.scheduleSync();
  },

  async saveHighlight() {
    this.closeQuickMenu();
    if (!this.selectedSentence?.text) return;
    await addHighlight(this.currentBook?.id, this.selectedSentence.index, this.selectedSentence.text, this.currentBook?.title);
    this.showToast('⭐ 하이라이트에 저장됨!', 'success');
    Sync.scheduleSync();
  },

  async renderHighlights() {
    const list = $('highlight-list');
    if (!list) return;
    const items = await getHighlights();
    if (!items.length) {
      list.innerHTML = `<div class="empty-state">
        <svg class="empty-illo tinted" viewBox="0 0 120 80"><use href="#illo-quill"/></svg>
        <div class="empty-title">마음에 새길 문장이 없어요</div>
        <div class="empty-body">읽다 멈추게 되는 문장을 골라 하이라이트로 저장하세요. 여기 한 자리에 모입니다.</div>
      </div>`;
      return;
    }
    list.innerHTML = items.map(h => `
      <div class="highlight-item">
        <button class="hl-del" data-id="${h.id}" title="삭제" aria-label="삭제">✕</button>
        <div class="hl-text">${escapeHtml(h.text || '')}</div>
        <div class="hl-meta"><span>${escapeHtml(h.bookTitle || '')}</span><span>${new Date(h.createdAt).toLocaleDateString()}</span></div>
      </div>`).join('');
    list.querySelectorAll('.hl-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        await deleteHighlight(parseInt(btn.dataset.id));
        this.renderHighlights();
      });
    });
  },

  async renderQueue() {
    const items = await getQueue();
    const list = $('queue-list');
    list.innerHTML = '';
    
    if (!items.length) {
      list.innerHTML = `<div class="empty-state">
        <svg class="empty-illo tinted" viewBox="0 0 120 80"><use href="#illo-letter"/></svg>
        <div class="empty-title">미뤄둔 문장이 없어요</div>
        <div class="empty-body">읽다가 다시 와서 보고 싶은 문장은 "나중에"로 저장해두세요. 시간 날 때 차분히 들여다볼 수 있어요.</div>
      </div>`;
      return;
    }
    
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'queue-item';
      div.dataset.id = item.id;
      div.dataset.sentenceId = item.sentenceId ?? 0;
      div.dataset.text = item.text;
      div.innerHTML = `
        <div class="qi-text">${escapeHtml(item.text)}</div>
        <div class="qi-meta">${new Date(item.createdAt).toLocaleDateString()}</div>
        <button class="qi-action">공부하기</button>`;
      list.appendChild(div);
    });
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.qi-action');
      if (!btn) return;
      const itemEl = btn.closest('.queue-item');
      if (!itemEl) return;
      const id = parseInt(itemEl.dataset.id);
      const sentenceId = parseInt(itemEl.dataset.sentenceId);
      const text = itemEl.dataset.text;
      this.studyFromQueue(id, sentenceId, text);
    });
  },

  async studyFromQueue(id, sentenceId, text) {
    // M4: Don't mark done immediately — track for when user actually finishes
    this._currentQueueId = id;
    this.selectedSentence = { index: sentenceId || 0, text };
    this.openStudy();
    // Don't render queue or update badge here — will update when finished
  },

  async clearQueue() {
    const items = await getQueue();
    if (!items.length) {
      this.showToast('큐가 이미 비어 있습니다.', 'info');
      return;
    }
    if (!confirm(`정말 "${items.length}개" 문장을 모두 완료 처리하시겠습니까?`)) return;
    for (const item of items) {
      await markQueueDone(item.id);
    }
    await this.renderQueue();
    await this.updateQueueBadge();
    this.showToast('큐가 비워졌습니다.', 'info');
    Sync.scheduleSync();
  },

  async updateQueueBadge() {
    const count = await getQueueCount();
    const badge = $('queue-badge');
    if (badge) {
      badge.textContent = count > 0 ? count : '';
      badge.style.display = count > 0 ? 'inline' : 'none';
    }
    this.updateReviewBadge();
  },

  // 복습 부채: 복습 예정(마감) 카드 수를 단어장 탭 배지로 보여준다.
  async updateReviewBadge() {
    const due = await countDueReviews();
    const badge = $('review-badge');
    if (badge) {
      badge.textContent = due > 0 ? due : '';
      badge.style.display = due > 0 ? 'inline' : 'none';
    }
    const tabBadge = $('tab-review-badge');
    if (tabBadge) {
      tabBadge.textContent = due > 0 ? (due > 99 ? '99+' : due) : '';
      tabBadge.classList.toggle('show', due > 0);
    }
  },

  // 복습이 많이 밀렸으면 책을 열 때 한 번만 "복습 먼저" 넛지를 띄운다.
  async _maybeReviewNudge() {
    if (this._reviewNudgeShown) return;
    this._reviewNudgeShown = true;
    const due = await countDueReviews();
    if (due >= 30) {
      this.showToast(`📖 복습이 ${due}개 밀렸어요. 오늘은 새 카드보다 복습부터 해볼까요? (단어장 → 복습 시작)`, 'info');
    }
  },

  /* ===== Vocabulary ===== */
  async renderVocabulary() {
    const words = await getVocabulary(this.currentBook?.id);
    const grid = $('vocab-grid');
    grid.innerHTML = '';
    
    if (!words.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <svg class="empty-illo tinted" viewBox="0 0 120 80"><use href="#illo-spread"/></svg>
        <div class="empty-title">단어장이 비어 있어요</div>
        <div class="empty-body">읽다 만난 모르는 단어를 한 번 톡 — 자동으로 카드가 만들어지고 복습 일정이 잡힙니다.</div>
      </div>`;
      return;
    }
    
    words.forEach(w => {
      grid.innerHTML += `
        <div class="vocab-card">
          <div class="v-word">${escapeHtml(w.word)}</div>
          <div class="v-meaning">${escapeHtml(w.meaningKo || '(뜻 추가 필요)')}</div>
          <div class="v-context">"${escapeHtml(w.contextSentence?.slice(0, 80) || '')}..."</div>
          ${w.sceneNote ? `<div class="v-scene">🎬 ${escapeHtml(w.sceneNote)}</div>` : ''}
          <div class="v-meta">
            <span>
              <span class="v-status ${w.status}">${statusLabel(w.status)}</span>
            </span>
            <span>${w.reviewBox > 0 ? '복습 ' + (w.nextReview ? new Date(w.nextReview).toLocaleDateString() : '-') : '신규'}</span>
          </div>
        </div>`;
    });
  },

  /* ===== SRS Review ===== */
  async startReview(bookId) {
    const words = await getVocabForReview(10);
    if (!words.length) {
      this.showToast('복습할 단어가 없습니다!', 'info');
      return;
    }
    
    this._reviewWords = words;
    this._reviewIndex = 0;
    this._reviewRevealed = false;
    
    // Switch to vocabulary page and show review modal
    this.switchView('vocabulary');
    this._showReviewCard();
  },

  _showReviewCard() {
    const modal = $('review-modal');
    const front = $('review-front');
    const back = $('review-back');
    const meaning = $('review-meaning');
    const context = $('review-context');
    const scene = $('review-scene');
    const progress = $('review-progress');
    const footer = $('review-footer');
    const card = $('review-card');
    const actions = $('review-actions');
    
    const idx = this._reviewIndex;
    const word = this._reviewWords[idx];

    if (!word) {
      this._finishReview();
      return;
    }

    progress.textContent = `${idx + 1} / ${this._reviewWords.length}`;
    back.classList.remove('show');
    this._reviewRevealed = false;
    card.style.cursor = 'pointer';
    footer.textContent = `현재 상태: ${statusLabel(word.status)}`;

    // Production card when the saved context contains the word/expression:
    // show Korean meaning + a cloze blank and ask the learner to recall the
    // English. Otherwise fall back to a recognition card (word → meaning).
    const reExpr = new RegExp(word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const isProduction = !!(word.meaningKo && word.contextSentence && reExpr.test(word.contextSentence));

    if (isProduction) {
      const cloze = word.contextSentence.replace(reExpr, '_____');
      front.innerHTML = `
        <div class="rc-mode">✍️ 영어로 떠올리기</div>
        <div class="rc-prompt">${escapeHtml(word.meaningKo)}</div>
        <div class="rc-cloze">"${escapeHtml(cloze)}"</div>
        <input id="rc-input" class="rc-input" placeholder="영어로 입력" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button id="rc-check" class="rc-check">확인</button>
        <div id="rc-judge" class="rc-judge"></div>`;
      meaning.textContent = word.word;
      context.textContent = word.contextSentence ? `"${word.contextSentence}"` : '';
      scene.textContent = word.sceneNote || '';

      const reveal = () => {
        if (this._reviewRevealed) return;
        const input = $('rc-input');
        const judge = $('rc-judge');
        if (input && judge) {
          const ok = input.value.trim().toLowerCase() === word.word.toLowerCase();
          judge.textContent = ok ? '✅ 정답!' : (input.value.trim() ? '↩︎ 정답을 확인하세요' : '정답을 확인하세요');
          judge.className = 'rc-judge ' + (ok ? 'ok' : 'no');
        }
        back.classList.add('show');
        this._reviewRevealed = true;
        card.style.cursor = 'default';
      };
      card.onclick = (e) => { if (!e.target.closest('#rc-input')) reveal(); };
      setTimeout(() => {
        $('rc-check')?.addEventListener('click', (e) => { e.stopPropagation(); reveal(); });
        $('rc-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); reveal(); } });
        $('rc-input')?.addEventListener('focus', (e) => {
          setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
        });
        $('rc-input')?.focus();
      }, 0);
    } else {
      front.textContent = word.word;
      meaning.textContent = word.meaningKo || '(뜻 정보 없음)';
      context.textContent = word.contextSentence ? `"${word.contextSentence}"` : '';
      scene.textContent = word.sceneNote || '';
      // Click card to flip (reveal meaning)
      card.onclick = () => {
        if (!this._reviewRevealed) {
          back.classList.add('show');
          this._reviewRevealed = true;
          card.style.cursor = 'default';
        }
      };
    }

    // Rating buttons
    actions.querySelectorAll('.review-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!this._reviewRevealed) {
          this.showToast('먼저 카드를 클릭해서 뜻을 확인하세요!', 'info');
          return;
        }
        const status = btn.dataset.status;
        await updateVocabStatus(word.id, status);
        word.status = status;
        this._reviewIndex++;
        this._showReviewCard();
      };
    });
    
    modal.classList.add('open');
  },

  _finishReview() {
    const modal = $('review-modal');
    modal.classList.remove('open');
    this.showToast(`✅ 복습 완료! (${this._reviewWords.length}개 단어)`, 'success');
    this.renderVocabulary();
    delete this._reviewWords;
    delete this._reviewIndex;
    delete this._reviewRevealed;
  },

  closeReview() {
    $('review-modal')?.classList.remove('open');
    delete this._reviewWords;
    delete this._reviewIndex;
    delete this._reviewRevealed;
  },

  /* ===== TTS Controls ===== */
  startTTS() {
    // Read only the sentences on the visible page so highlighting matches.
    const texts = this._visibleSentences().map(v => v.s.text);
    TTS.startReading(texts, 0, (idx) => {
      document.querySelectorAll('.sent').forEach((s, i) => {
        s.classList.toggle('highlighted', i === idx);
        if (i === idx) s.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }, () => {
      document.querySelectorAll('.sent').forEach(s => s.classList.remove('highlighted'));
    });
  },

  /* ===== Settings ===== */
  async loadSettings() {
    const s = await getSettings();
    $('settings-url').value = s.aiBaseUrl || '/api/zen/go/v1';
    $('settings-model').value = s.aiModel || 'deepseek-v4-flash';
    $('settings-key').value = '';
    $('settings-key-mode').value = s.apiKeyStorageMode || 'session';
    $('settings-tts-rate').value = s.ttsRate || 0.9;
    $('settings-tts-val').textContent = s.ttsRate + 'x';
    $('settings-fontsize').value = s.fontSize || 16;
    $('settings-fs-val').textContent = s.fontSize + 'px';
    $('settings-card-cap').value = s.dailyCardCap ?? 5;
  },

  async saveSettings() {
    const s = {
      aiBaseUrl: $('settings-url').value.trim(),
      aiModel: $('settings-model').value.trim(),
      aiKey: $('settings-key').value.trim(),
      apiKeyStorageMode: $('settings-key-mode').value,
      ttsRate: parseFloat($('settings-tts-rate').value),
      fontSize: parseInt($('settings-fontsize').value),
      dailyCardCap: parseInt($('settings-card-cap').value) || 0,
      theme: 'dark', lineHeight: 1.9
    };
    
    AI.setKey(s.aiKey, s.apiKeyStorageMode);
    AI.setBaseUrl(s.aiBaseUrl);
    AI.setModel(s.aiModel);

    await saveSettings(s);
    this.showToast('설정이 저장되었습니다!', 'success');
  },

  async testAI() {
    const url = $('settings-url').value.trim();
    const key = $('settings-key').value.trim();
    const proxied = url.startsWith('/') || url.includes('.workers.dev');

    // A browser key is only required when calling an upstream directly.
    if (!proxied && !key) {
      this.showToast('API 키를 입력해주세요.', 'error');
      return;
    }
    if (key) AI.setKey(key, $('settings-key-mode').value);
    AI.setBaseUrl(url);
    AI.setModel($('settings-model').value.trim());

    this.showToast('연결 테스트 중...', 'info');
    const result = await AI.sentenceGist('The sun set behind the mountains, painting the sky in shades of orange and purple.');

    // AI._call returns an error object instead of throwing, so inspect the result.
    if (!result || result.error || !result.gistKo) {
      const msg = result?.message || '응답이 비어있습니다';
      this.showToast(`❌ 연결 실패: ${msg}`, 'error');
      return;
    }
    this.showToast(`✅ 연결 성공! (${result.gistKo.slice(0, 30)})`, 'success');
  },

  /* ===== Feedback History ===== */
  async renderHistory() {
    const sessions = await getFeedbackHistory(this.currentBook?.id);
    const list = $('history-list');
    list.innerHTML = '';
    
    if (!sessions.length) {
      list.innerHTML = `<div class="empty-state">
        <svg class="empty-illo tinted" viewBox="0 0 120 80"><use href="#illo-letter"/></svg>
        <div class="empty-title">아직 피드백이 없어요</div>
        <div class="empty-body">해석 훈련에서 한국어 해석을 제출하면, AI가 미세한 차이까지 짚어 코멘트해 줍니다.</div>
      </div>`;
      return;
    }
    
    sessions.forEach(s => {
      list.innerHTML += `
        <div class="history-item">
          <div class="hi-sent">${escapeHtml(s.originalSentence?.slice(0, 100))}</div>
          <div class="hi-user">내 해석: ${escapeHtml(s.finalUserTranslation?.slice(0, 60))}</div>
          <div class="hi-fb">${s.storyNote ? '💡 ' + escapeHtml(s.storyNote?.slice(0, 100)) : s.literalTranslation ? '🔍 ' + escapeHtml(s.literalTranslation?.slice(0, 80)) : ''}</div>
          <div class="hi-meta"><span>${new Date(s.createdAt).toLocaleString()}</span></div>
        </div>`;
    });
  },

  // 도움 의존도 리포트: "도움 없이 읽은 양"이 늘고 있는지를 보여준다(North Star).
  async renderReport() {
    const body = $('report-body');
    if (!body) return;
    body.innerHTML = '🔄 집계 중...';
    const s = await getDependencyStats();

    if (s.all.sessions === 0) {
      body.innerHTML = `<div class="empty-state">
        <svg class="empty-illo tinted" viewBox="0 0 120 80"><use href="#illo-chart"/></svg>
        <div class="empty-title">아직 데이터가 없어요</div>
        <div class="empty-body">책을 읽기 시작하면 도움 의존도와 독립 독해량이 자동으로 누적됩니다.</div>
      </div>`;
      return;
    }

    const fmt = n => (n || 0).toLocaleString();
    const trendInfo = {
      down: { cls: 'good', txt: '↓ 도움 의존도가 줄고 있어요. 잘하고 있어요!' },
      up:   { cls: 'warn', txt: '↑ 지난주보다 도움을 더 썼어요. 천천히 줄여봐요.' },
      flat: { cls: '',     txt: '→ 지난주와 비슷한 수준이에요.' },
      new:  { cls: '',     txt: '아직 비교할 지난주 데이터가 부족해요. 계속 읽어보세요!' }
    }[s.trend] || { cls: '', txt: '' };

    const card = (title, b) => `
      <div class="report-card">
        <div class="rc-title">${title}</div>
        <div class="rc-big">${b.rate}<span class="rc-unit">회 / 1000단어</span></div>
        <div class="rc-sub">읽은 단어 ${fmt(b.words)} · 세션 ${fmt(b.sessions)}</div>
        <div class="rc-break">📖 사전 ${fmt(b.dict)} · 🌐 번역 ${fmt(b.trans)} · 🔍 힌트 ${fmt(b.help)}</div>
      </div>`;

    const tip = this._coachTip(s);

    body.innerHTML = `
      <div class="report-note">핵심 지표는 <b>1000단어당 도움 사용 횟수</b>입니다. 낮을수록 더 독립적으로 읽고 있다는 뜻이에요.</div>
      ${tip ? `<div class="coach-tip ${tip.cls}"><span class="coach-ico">🧭</span><span>${escapeHtml(tip.text)}</span></div>` : ''}
      <div class="report-trend ${trendInfo.cls}">${trendInfo.txt}</div>
      <div class="report-grid">
        ${card('오늘', s.today)}
        ${card('최근 7일', s.week)}
        ${card('지난 주', s.prevWeek)}
        ${card('전체', s.all)}
      </div>
    `;
  },

  // 책을 열 때 코치 제안을 토스트로 한 번만 살짝 띄운다(앱 세션당 1회).
  async _maybeCoachToast() {
    if (this._coachShown) return;
    this._coachShown = true;
    try {
      const s = await getDependencyStats();
      const tip = this._coachTip(s);
      if (tip) this.showToast('🧭 ' + tip.text, tip.cls === 'good' ? 'success' : 'info');
    } catch (e) { /* non-blocking */ }
  },

  // 적응형 코칭: 최근 읽기 패턴에서 가장 도움이 될 한 가지 제안을 고른다.
  // 의미 있는 표본(주간 200단어 이상)이 없으면 null. 우선순위: 어휘 부담 →
  // 번역 의존 → 잘하고 있을 때 분량 늘리기.
  _coachTip(s) {
    const b = (s.week && s.week.words >= 200) ? s.week : null;
    if (!b) return null;
    const per1k = n => (n / b.words) * 1000;
    const dictRate = per1k(b.dict);
    const transRate = per1k(b.trans);

    if (dictRate >= 30) {
      return { cls: 'warn', text: '어휘 부담이 큰 편이에요. 다음 챕터는 "읽기 전 예열"에서 핵심 표현을 먼저 훑고 시작해보세요.' };
    }
    if (transRate >= 15) {
      return { cls: 'warn', text: '한국어 번역에 자주 기대고 있어요. 문장 요지를 보기 전에 "쉬운 영어"와 "끊어 읽기"를 먼저 시도해보세요.' };
    }
    if (s.trend === 'down' && b.rate <= 15) {
      return { cls: 'good', text: '도움 없이 잘 읽고 있어요! 다음엔 도움을 조금 줄이고 읽는 분량을 살짝 늘려봐도 좋아요.' };
    }
    return null;
  },

  /* ===== 실력 진단 (Proficiency Diagnosis) ===== */

  // 해석 훈련에서 잡히는 이슈 유형 → 한국어 라벨.
  _ISSUE_LABELS: {
    meaning: '의미 파악', grammar: '문법', tense: '시제', article: '관사(a/the)',
    preposition: '전치사', word_choice: '어휘 선택', structure: '문장 구조',
    naturalness: '자연스러움', idiom: '관용표현', nuance: '뉘앙스', tone: '어조'
  },

  _levelLabel(score) {
    if (score == null) return '평가 전';
    if (score >= 85) return '상급';
    if (score >= 70) return '중상급';
    if (score >= 55) return '중급';
    if (score >= 40) return '초중급';
    return '기초';
  },

  // 종합 점수 + "실제로 읽어낸" 책의 CEFR을 함께 보고 대략적인 CEFR을 추정한다.
  // engagedCefr(=readingProgress≥10%인 책만)을 쓰므로 담아두기만 한 책으로
  // CEFR이 부풀려지지 않는다.
  _overallCefr(score, engagedCefr) {
    const order = ['A2', 'B1', 'B2', 'C1'];
    let base = score >= 80 ? 'C1' : score >= 62 ? 'B2' : score >= 45 ? 'B1' : 'A2';
    let hardest = null;
    for (const c of order) if (engagedCefr && engagedCefr[c]) hardest = c;
    if (hardest && order.indexOf(hardest) > order.indexOf(base)) {
      // 점수보다 어려운 책을 실제로 읽고 있으면 한 단계 보정해서 평균낸다.
      base = order[Math.round((order.indexOf(hardest) + order.indexOf(base)) / 2)];
    }
    return base;
  },

  // 표본 수 → 신뢰도 라벨. 본 점수가 표본 적은 추정이라는 걸 사용자에게 알린다.
  // low: 단정하지 않음·점수에 회색 라벨, medium: 참고용, high: 안정.
  _confidence(sample, lowMax, midMax) {
    if (sample < lowMax) return { level: 'low', labelKo: '표본 적음 · 참고용' };
    if (sample < midMax) return { level: 'medium', labelKo: '표본 보통' };
    return { level: 'high', labelKo: '표본 충분' };
  },

  // 수집된 학습 신호를 0~100 영역별 점수표로 환산한다. AI 없이도 동작한다.
  // 표본이 매우 적으면 점수를 계산하되 conf:'low'로 표시해 단정을 피한다.
  _computeProficiency(sig) {
    const clamp = n => Math.max(0, Math.min(100, Math.round(n)));
    const skills = [];

    // 1) 어휘력 — 단어장 상태 분포로 '외운 비율'을 본다.
    // 카드 5개로는 '외움 비율'이 출렁이므로 임계를 올렸다.
    const v = sig.vocab;
    if (v.total < 10) {
      skills.push({ key: 'vocab', label: '어휘력', icon: '📖', score: null, sample: v.total, note: '단어 카드를 10개 이상 모으면 평가돼요.' });
    } else {
      const score = clamp(((v.known + v.learning * 0.4) / v.total) * 100);
      const conf = this._confidence(v.total, 25, 60);
      const weak = (conf.level !== 'low' && v.knownRatio < 0.3) ? '외운 단어 비율이 낮아요. 복습을 더 자주 해보세요.' : null;
      skills.push({ key: 'vocab', label: '어휘력', icon: '📖', score, sample: v.total, conf, weak,
        detail: `단어 ${v.total}개 · 외움 ${v.known} / 학습중 ${v.learning} / 새 ${v.new}` });
    }

    // 2) 구문 파싱 — 구조 분석 토큰 정확도 + 가장 약한 문장 역할.
    // 한 세션에 토큰이 ~10개이므로 5세션≈50토큰부터 의미가 있다.
    const st = sig.structure;
    if (st.totalSessions < 3) {
      skills.push({ key: 'parse', label: '구문 파싱', icon: '🏷️', score: null, sample: st.totalSessions, note: '구조 분석을 3회 이상 하면 평가돼요.' });
    } else {
      const score = clamp(st.accuracy * 100);
      const conf = this._confidence(st.totalSessions, 5, 15);
      // 약한 역할 탐지: 토큰 5개 이상 + 정확도 70% 미만(저신뢰는 80% 미만)일 때만.
      let weakRole = null, weakAcc = 1;
      const accThreshold = conf.level === 'low' ? 0.6 : 0.7;
      for (const [role, g] of Object.entries(sig.roleAcc)) {
        if (role === 'unknown' || g.total < 5) continue;
        if (g.accuracy < weakAcc) { weakAcc = g.accuracy; weakRole = role; }
      }
      const weak = (weakRole && weakAcc < accThreshold) ? `'${weakRole}' 인식 정확도가 ${Math.round(weakAcc * 100)}%로 약해요.` : null;
      skills.push({ key: 'parse', label: '구문 파싱', icon: '🏷️', score, sample: st.totalSessions, conf, weak, weakRole,
        detail: `구조 분석 ${st.totalSessions}회 · 토큰 정확도 ${Math.round(st.accuracy * 100)}%` });
    }

    // 3) 문법·작문 — 해석 훈련에서 지적된 이슈 비율 + 가장 잦은 유형.
    // 임계 3 → 8로 상향(분모가 작으면 1번 지적에 점수가 크게 출렁임).
    // 또한 top issue가 의미를 가지려면 자체 빈도가 ≥3 이어야 함.
    const ti = sig.transIssues;
    if (ti.total < 8) {
      skills.push({ key: 'grammar', label: '문법·작문', icon: '✍️', score: null, sample: ti.total, note: '해석 훈련을 8회 이상 하면 평가돼요.' });
    } else {
      const issueRate = ti.scored / ti.total;
      const score = clamp((1 - issueRate) * 100);
      const conf = this._confidence(ti.total, 15, 40);
      let topIssue = null, topN = 0;
      for (const [k, n] of Object.entries(ti.counts)) if (n > topN) { topN = n; topIssue = k; }
      const weak = (topIssue && topN >= 3) ? `가장 잦은 실수: ${this._ISSUE_LABELS[topIssue] || topIssue} (${topN}회)` : null;
      skills.push({ key: 'grammar', label: '문법·작문', icon: '✍️', score, sample: ti.total, conf, weak, topIssue,
        detail: `해석 시도 ${ti.total}회 · 지적 ${ti.scored}회` });
    }

    // 4) 독해 독립도 — 1000단어당 도움 사용 횟수(낮을수록 좋음).
    // 산식 100-rate*2.5는 임의의 선형이라 향후 사용자 분포로 보정 필요.
    // 단어 수가 적으면 신뢰도 낮음으로 라벨.
    const d = sig.dependency.all;
    if (d.sessions < 2 || d.words < 500) {
      skills.push({ key: 'independence', label: '독해 독립도', icon: '🧭', score: null, sample: d.words, note: '500단어 이상 읽으면 평가돼요.' });
    } else {
      const score = clamp(100 - d.rate * 2.5);
      const conf = this._confidence(d.words, 2000, 8000);
      const weak = (conf.level !== 'low' && d.rate >= 25) ? `1000단어당 도움 ${d.rate}회로 의존도가 높아요.` : null;
      skills.push({ key: 'independence', label: '독해 독립도', icon: '🧭', score, sample: d.words, conf, weak,
        detail: `읽은 단어 ${d.words.toLocaleString()} · 도움률 ${d.rate}/1000` });
    }

    // 5) 읽기 속도 — 보조 신호. wpm 정규화 (wpm-40)/160 도 임의의 상수.
    // getReadingSpeed()는 ≥300단어 충족 시에만 값을 돌려주므로 표본 보장은 그쪽에서 함.
    const wpm = sig.speed;
    if (wpm == null) {
      skills.push({ key: 'speed', label: '읽기 속도', icon: '⚡', score: null, sample: 0, note: '충분히 읽으면 속도가 추정돼요.' });
    } else {
      const score = clamp(((wpm - 40) / (200 - 40)) * 100);
      // 충분히 읽지 않은 평균값은 늘 medium 이하로 본다.
      const conf = this._confidence(d.words || 0, 2000, 8000);
      const weak = (conf.level !== 'low' && wpm < 90) ? `분당 ${wpm}단어로 다소 느린 편이에요.` : null;
      skills.push({ key: 'speed', label: '읽기 속도', icon: '⚡', score, sample: 1, conf, weak, detail: `약 ${wpm} WPM` });
    }

    const scored = skills.filter(s => s.score != null);
    const hasData = scored.length > 0;
    // 신뢰도 가중치: low는 절반만 반영해 종합 점수가 표본 적은 영역에 끌려가지 않게.
    const baseW = { vocab: 1, parse: 1, grammar: 1, independence: 1, speed: 0.5 };
    const confMul = { low: 0.5, medium: 0.85, high: 1 };
    let wsum = 0, wtot = 0;
    for (const s of scored) {
      const w = (baseW[s.key] || 1) * (confMul[s.conf?.level] ?? 1);
      wsum += s.score * w; wtot += w;
    }
    const overallScore = wtot ? Math.round(wsum / wtot) : null;
    // 약점 후보는 신뢰도 low를 제외한 영역(읽기 속도 제외)에서 고른다.
    const core = scored.filter(s => s.key !== 'speed' && s.conf?.level !== 'low');
    const weakest = core.length ? core.reduce((a, b) => (b.score < a.score ? b : a)) : null;
    const cefr = this._overallCefr(overallScore, sig.engagedCefr);
    const levelKo = this._levelLabel(overallScore);
    // 종합 신뢰도: 가중치 충족 정도 (저신뢰 비중이 크면 'low').
    const maxWtot = Object.values(baseW).reduce((a, b) => a + b, 0);
    const overallConf = wtot >= maxWtot * 0.75 ? 'high' : wtot >= maxWtot * 0.45 ? 'medium' : 'low';
    return { skills, scored, hasData, overallScore, overallConf, weakest, cefr, levelKo };
  },

  // AI 진단 재호출 가드: 마지막 호출 이후 7일 또는 새 활동 30건 이상일 때만
  // 새로 호출한다. 그 사이엔 localStorage에 캐시된 결과를 즉시 보여주고
  // '새로 진단' 버튼으로 강제 갱신할 수 있다.
  _DIAG_CACHE_KEY: 'es_diag_ai_v1',
  _DIAG_STALE_DAYS: 7,
  _DIAG_STALE_ACTIVITIES: 30,

  _loadDiagCache() {
    try { return JSON.parse(localStorage.getItem(this._DIAG_CACHE_KEY) || 'null'); }
    catch { return null; }
  },
  _saveDiagCache(data, activityCount) {
    try {
      localStorage.setItem(this._DIAG_CACHE_KEY, JSON.stringify({
        data, activityCount, ts: Date.now()
      }));
    } catch { /* quota or disabled */ }
  },
  _isDiagStale(cache, activityNow) {
    if (!cache) return true;
    const ageMs = Date.now() - (cache.ts || 0);
    if (ageMs > this._DIAG_STALE_DAYS * 86400000) return true;
    if (activityNow - (cache.activityCount || 0) >= this._DIAG_STALE_ACTIVITIES) return true;
    return false;
  },

  async renderDiagnosis() {
    const body = $('diagnosis-body');
    if (!body) return;
    body.innerHTML = '🔄 진단 집계 중...';
    const sig = await getProficiencySignals();
    const p = this._computeProficiency(sig);
    this._lastProficiency = p;
    this._lastActivityCount = await getActivityCount();

    if (!p.hasData) {
      body.innerHTML = `<div class="empty-state">
        <svg class="empty-illo tinted" viewBox="0 0 120 80"><use href="#illo-target"/></svg>
        <div class="empty-title">진단할 데이터가 모이는 중</div>
        <div class="empty-body">책을 읽고, 단어를 모으고, 해석·구조 분석을 몇 번 해보세요. 학습 신호가 충분히 쌓이면 영역별 실력 지도를 그려 드려요.</div>
      </div>`;
      return;
    }

    const lvlCls = s => (s >= 70 ? 'good' : s >= 45 ? 'mid' : 'low');
    const confChip = c => c ? `<span class="conf-chip conf-${c.level}" title="${escapeHtml(c.labelKo)}">${escapeHtml(c.labelKo)}</span>` : '';
    const bar = s => {
      if (s.score == null) {
        return `<div class="skill-row na">
          <div class="skill-head"><span class="skill-name">${s.icon} ${s.label}</span><span class="skill-score na">데이터 부족</span></div>
          <div class="skill-track"><div class="skill-fill" style="width:0%"></div></div>
          <div class="skill-detail">${escapeHtml(s.note || '')}</div>
        </div>`;
      }
      const c = lvlCls(s.score);
      const isLow = s.conf?.level === 'low';
      return `<div class="skill-row${isLow ? ' low-conf' : ''}">
        <div class="skill-head">
          <span class="skill-name">${s.icon} ${s.label}</span>
          <span class="skill-meta">${confChip(s.conf)}<span class="skill-score ${c}">${s.score}</span></span>
        </div>
        <div class="skill-track"><div class="skill-fill ${c}" style="width:${s.score}%"></div></div>
        <div class="skill-detail">${escapeHtml(s.detail || '')}${s.weak ? ` · <span class="skill-weak">⚠️ ${escapeHtml(s.weak)}</span>` : ''}</div>
      </div>`;
    };

    const w = p.weakest;
    const overallChip = p.overallConf === 'low' ? '<span class="conf-chip conf-low" title="전체 표본이 적어요. 참고용으로 보세요.">전체 표본 적음 · 참고용</span>' : '';
    body.innerHTML = `
      <div class="diag-overview">
        <div class="diag-cefr">${escapeHtml(p.cefr)}</div>
        <div class="diag-level">
          <div class="diag-level-txt">${escapeHtml(p.levelKo)} · 종합 ${p.overallScore}점 ${overallChip}</div>
          <div class="diag-overall-bar"><div class="skill-fill ${lvlCls(p.overallScore)}" style="width:${p.overallScore}%"></div></div>
        </div>
      </div>
      <div class="diag-note">영역별 점수는 단어장·구조 분석·해석 훈련·읽기 기록에서 자동 계산됩니다. 표본이 적은 영역은 신뢰도 라벨로 표시돼요.</div>
      <div class="skill-list">${p.skills.map(bar).join('')}</div>
      ${w ? `<div class="diag-weak-card">
        <div class="dw-title">🎯 가장 약한 영역: ${w.icon} ${escapeHtml(w.label)} (${w.score}점)</div>
        <div class="dw-detail">${escapeHtml(w.weak || w.detail || '')}</div>
        <button class="btn" id="diag-drill-btn">🎯 이 약점 보완 학습 시작</button>
      </div>` : '<div class="diag-note">신뢰도 높은 영역에서 두드러진 약점이 아직 보이지 않아요. 학습이 더 쌓이면 약점을 자동으로 짚어드릴게요.</div>'}
      <div class="diag-actions">
        <button class="btn-s" id="diag-ai-btn">🤖 AI 정밀 진단 받기</button>
      </div>
      <div id="diag-ai" class="diag-ai"></div>
      <div id="diag-drill" class="diag-drill"></div>
    `;

    $('diag-ai-btn')?.addEventListener('click', () => this._aiDiagnose(false));
    $('diag-drill-btn')?.addEventListener('click', () => this.startWeaknessDrill(false));

    // 마지막 진단이 있으면 자동 표시(가드 안 거치고 즉시 캐시 노출).
    const cache = this._loadDiagCache();
    if (cache?.data) this._renderDiagAI(cache.data, cache.ts, this._isDiagStale(cache, this._lastActivityCount));
  },

  _renderDiagAI(data, ts, stale) {
    const out = $('diag-ai');
    if (!out) return;
    out.style.display = 'block';
    const list = (arr, tag) => (arr && arr.length) ? `<${tag}>${arr.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</${tag}>` : '';
    const when = ts ? `${new Date(ts).toLocaleDateString()} 진단` : '';
    out.innerHTML = `
      <div class="diag-ai-card">
        <div class="dai-head">
          <div class="dai-level">🧭 ${escapeHtml(data.levelKo || '')}</div>
          <div class="dai-meta">${escapeHtml(when)}${stale ? ' · <span class="dai-stale">새 활동이 쌓였어요</span>' : ''}</div>
        </div>
        <div class="dai-summary">${escapeHtml(data.summaryKo || '')}</div>
        ${(data.strengths && data.strengths.length) ? `<div class="dai-block"><b>💪 강점</b>${list(data.strengths, 'ul')}</div>` : ''}
        ${(data.weaknesses && data.weaknesses.length) ? `<div class="dai-block"><b>⚠️ 약점</b>${list(data.weaknesses, 'ul')}</div>` : ''}
        ${(data.planKo && data.planKo.length) ? `<div class="dai-block"><b>📋 학습 계획</b>${list(data.planKo, 'ol')}</div>` : ''}
        ${stale ? '<button class="btn-s mt-8" id="diag-ai-refresh">🔄 새로 진단</button>' : ''}
      </div>`;
    $('diag-ai-refresh')?.addEventListener('click', () => this._aiDiagnose(true));
  },

  // 로컬 점수표를 AI에게 보내 서술형 정밀 진단 + 학습 계획을 받는다.
  // 가드: 캐시가 신선하면 (7일 미만 + 활동 30건 미만) 캐시 결과 즉시 표시하고
  // AI 호출은 생략. force=true 면 가드를 우회한다.
  async _aiDiagnose(force) {
    const out = $('diag-ai');
    const p = this._lastProficiency;
    if (!out || !p) return;
    const cache = this._loadDiagCache();
    if (!force && cache && !this._isDiagStale(cache, this._lastActivityCount || 0)) {
      this._renderDiagAI(cache.data, cache.ts, false);
      this.showToast('🧭 최근 진단을 표시했어요. 새 학습이 더 쌓이면 자동으로 갱신돼요.', 'info');
      return;
    }
    out.style.display = 'block';
    out.innerHTML = '🤖 AI가 점수표를 분석하는 중...';
    const profile = {
      overall: { score: p.overallScore, cefr: p.cefr, levelKo: p.levelKo, confidence: p.overallConf },
      skills: p.scored.map(s => ({
        key: s.key, label: s.label, score: s.score, sample: s.sample,
        confidence: s.conf?.level || null, weak: s.weak || null
      }))
    };
    const data = await AI.assessProficiency(profile);
    if (data.error) { out.innerHTML = '⚠️ 진단을 불러오지 못했어요. 잠시 후 다시 시도해주세요.'; return; }
    if (!data.isDemo) this._saveDiagCache(data, this._lastActivityCount || 0);
    this._renderDiagAI(data, Date.now(), false);
  },

  // 가장 약한 영역을 집중 보완하는 맞춤 연습 문제를 생성·렌더링한다.
  // 캐시 정책: 약점 영역(key)이 같으면 캐시된 문제 재사용, 영역이 바뀌면 새로 생성.
  // force=true 면 같은 영역이어도 새 문제로 갱신.
  _DRILL_CACHE_KEY: 'es_diag_drill_v1',
  _loadDrillCache() {
    try { return JSON.parse(localStorage.getItem(this._DRILL_CACHE_KEY) || 'null'); }
    catch { return null; }
  },
  _saveDrillCache(weakKey, data) {
    try { localStorage.setItem(this._DRILL_CACHE_KEY, JSON.stringify({ weakKey, data, ts: Date.now() })); }
    catch { /* ignore */ }
  },

  async startWeaknessDrill(force) {
    const out = $('diag-drill');
    const p = this._lastProficiency;
    if (!out || !p || !p.weakest) return;
    const w = p.weakest;
    const cache = this._loadDrillCache();
    if (!force && cache && cache.weakKey === w.key && cache.data) {
      this._renderDrill(cache.data, w, true);
      return;
    }
    out.style.display = 'block';
    out.innerHTML = '🎯 약점 맞춤 문제를 만드는 중...';
    let detail = w.weak || w.detail || '';
    if (w.key === 'parse' && w.weakRole) detail = `구조 파싱에서 '${w.weakRole}' 역할 인식이 약함. ${detail}`;
    if (w.key === 'grammar' && w.topIssue) detail = `해석 훈련에서 '${this._ISSUE_LABELS[w.topIssue] || w.topIssue}' 실수가 잦음. ${detail}`;
    const data = await AI.weaknessDrill(w.label, detail);
    if (data.error || !data.drills || !data.drills.length) {
      out.innerHTML = `<div class="drill-card"><div class="drill-tip">${escapeHtml(data.tipKo || '⚠️ 문제를 생성하지 못했어요. 다시 시도해주세요.')}</div></div>`;
      return;
    }
    if (!data.isDemo) this._saveDrillCache(w.key, data);
    this._renderDrill(data, w, false);
  },

  _renderDrill(data, w, cached) {
    const out = $('diag-drill');
    if (!out) return;
    out.style.display = 'block';
    out.innerHTML = `
      <div class="drill-card">
        <div class="drill-focus">🎯 ${escapeHtml(data.focusKo || w.label)}${cached ? ' <span class="dai-meta">· 저장된 문제</span>' : ''}</div>
        ${data.tipKo ? `<div class="drill-tip">💡 ${escapeHtml(data.tipKo)}</div>` : ''}
        <div class="drill-items">
          ${data.drills.map((d, i) => `
            <div class="drill-item">
              <div class="di-q"><span class="di-num">${i + 1}</span> ${escapeHtml(d.en || '')}</div>
              ${d.taskKo ? `<div class="di-task">${escapeHtml(d.taskKo)}</div>` : ''}
              <button class="di-reveal" data-i="${i}">정답 보기</button>
              <div class="di-answer" id="di-ans-${i}" style="display:none">
                <div class="di-a">✅ ${escapeHtml(d.answerKo || '')}</div>
                ${d.explainKo ? `<div class="di-explain">${escapeHtml(d.explainKo)}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
        <div class="drill-foot"><button class="btn-s" id="drill-refresh">🔄 다른 문제로</button></div>
      </div>`;
    out.querySelectorAll('.di-reveal').forEach(btn => {
      btn.addEventListener('click', () => {
        const ans = $('di-ans-' + btn.dataset.i);
        if (ans) { ans.style.display = 'block'; btn.style.display = 'none'; }
      });
    });
    $('drill-refresh')?.addEventListener('click', () => this.startWeaknessDrill(true));
  },

  /* ===== Backup ===== */
  async exportBackup() {
    const json = await exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `E-Story-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('✅ 백업 파일 다운로드 완료!', 'success');
  },

  async importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      
      // C3: Confirm before destructive import
      if (!confirm('⚠️ 기존 데이터가 모두 대체됩니다.\n현재 데이터를 자동 백업하고 진행하시겠습니까?')) {
        this.showToast('가져오기가 취소되었습니다.', 'info');
        e.target.value = '';
        return;
      }
      
      // Auto-backup before import
      try {
        const backup = await exportData();
        const blob = new Blob([backup], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `E-Story-before-import-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch(backupErr) {
        console.warn('Auto-backup failed (non-fatal):', backupErr);
      }
      
      await importData(text);
      this.showToast('✅ 데이터 복원 완료! 페이지를 새로고침합니다.', 'success');
      setTimeout(() => location.reload(), 1000);
    } catch(err) {
      this.showToast('❌ 복원 실패: ' + err.message, 'error');
    }
    e.target.value = '';
  },

  /* ===== Toast ===== */
  showToast(msg, type = 'info') {
    const c = $('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3000);
  }
};

/* ===== Helpers ===== */
function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function statusLabel(s) {
  return { 'new': '새 단어', 'learning': '학습중', 'known': '알아요' }[s] || s;
}

/* ===== Init on DOM Ready ===== */
document.addEventListener('DOMContentLoaded', () => App.init());
