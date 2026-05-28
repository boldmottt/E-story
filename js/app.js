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
    
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => this.switchView(item.dataset.view));
    });
    
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
      const wordEl = e.target.closest('.qm-word');
      if (wordEl) {
        e.stopPropagation();
        document.querySelectorAll('.qm-word').forEach(w => w.classList.remove('selected'));
        wordEl.classList.add('selected');
        this.selectedWord = wordEl.dataset.word;
        this.wordHint(wordEl.dataset.word);
        return;
      }
      const action = e.target.closest('.qm-btn')?.dataset.action;
      const handlers = {
        word: () => this.wordHint(),
        grammar: () => this.grammarHint(),
        gist: () => this.sentenceGist(),
        structure: () => this.openStructure(),
        chunkReading: () => this.chunkReading(),
        easyEnglish: () => this.easyEnglish(),
        ask: () => this.askFreeQuestion(),
        study: () => this.openStudy(),
        queue: () => this.queueLater()
      };
      handlers[action]?.();
    });

    // Close study panel
    $('study-close')?.addEventListener('click', () => this.closeStudy());
    
    // Study submit
    $('study-submit')?.addEventListener('click', () => this.submitTranslation());
    
    // Queue clear
    $('queue-clear')?.addEventListener('click', () => this.clearQueue());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeQuickMenu();
        this.closeStudy();
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
    
    // Throttled scroll position save
    document.addEventListener('scroll', () => {
      if (this.currentView !== 'reader') return;
      if (this._scrollThrottleTimer) clearTimeout(this._scrollThrottleTimer);
      this._scrollThrottleTimer = setTimeout(() => {
        this._saveScrollPosition();
      }, 300);
    }, { passive: true });
  },

  _saveScrollPosition() {
    if (!this.currentBook) return;
    const offset = window.scrollY || window.pageYOffset;
    updateBookProgress(this.currentBook.id, this.currentSelectedChunkIndex, offset);
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
    document.querySelectorAll('.content').forEach(c => c.classList.toggle('active', c.id === view + '-page'));
    
    const renderers = {
      vocabulary: () => this.renderVocabulary(),
      queue: () => this.renderQueue(),
      history: () => this.renderHistory(),
      report: () => this.renderReport(),
      settings: () => this.loadSettings()
    };
    renderers[view]?.();
    
    this.updateTopbarTitle(view);
    
    // Persist current view for restore
    this._patchSettings({ lastView: view });
  },

  updateTopbarTitle(view) {
    const titles = {
      bookshelf: '📚 내 서재',
      reader: this.currentBook?.title || '읽기',
      vocabulary: '📖 단어장',
      queue: '⏰ 나중에 공부',
      history: '📝 피드백 이력',
      report: '📊 리포트',
      settings: '⚙️ 설정'
    };
    $('topbar-title').textContent = titles[view] || 'E-Story';
  },

  /* ===== Bookshelf ===== */
  async loadBookshelf() {
    const books = await getBooks();
    const grid = $('bookshelf-grid');
    
    let html = '<div class="upload-area" id="upload-area"><div class="upload-icon">📂</div><div class="upload-label">txt 파일을 업로드하세요</div><div class="upload-hint">또는 여기로 드래그 & 드롭</div><input type="file" id="file-input" accept=".txt" class="hidden-input"></div>';
    html += '<div class="url-import"><input type="text" id="url-input" placeholder="또는 CORS 허용된 URL / 로컬 서버 주소 (맥: python3 serve.py)" class="url-field"><button class="btn-s" id="url-load-btn">📥 불러오기</button></div>';

    books.forEach(book => {
      const pct = book.totalChunks > 0 ? Math.round((book.currentChunk / book.totalChunks) * 100) : 0;
      const bandLabel = { green: '쉬움', yellow: '보통', red: '어려움' };
      const badge = book.difficultyBand
        ? `<span class="diff-badge ${book.difficultyBand}" title="적합도: ${bandLabel[book.difficultyBand] || ''}">${escapeHtml(book.estimatedCefr || '')}</span>`
        : '';
      html += `<div class="book-card" data-id="${book.id}">
        <button class="book-del" data-action="delete" data-id="${book.id}" title="책 삭제" aria-label="책 삭제">✕</button>
        ${badge}
        <div class="title">${escapeHtml(book.title)}</div>
        <div class="author">${escapeHtml(book.fileName)}</div>
        <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="meta"><span>${pct}% 완료</span><span>${book.totalChunks}챕터</span></div>
      </div>`;
    });
    
    grid.innerHTML = html;
    
    // URL import — bind after element exists
    $('url-load-btn')?.addEventListener('click', () => this.loadBookFromUrl());
    $('url-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.loadBookFromUrl(); });
    
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
        window.scrollTo({ top: this.currentBook.currentOffset, behavior: 'instant' });
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

  // Group sentences into real <p> blocks by paragraph index.
  // Legacy books (no `para` field) fall back to a single paragraph.
  renderParagraphs() {
    const sents = this.currentSentences;
    let html = '';
    let curPara = null;
    sents.forEach((sent, i) => {
      const p = sent.para ?? 0;
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
      <div class="ch-nav">
        <button class="topbar-btn ch-nav-btn" data-dir="prev"${prevDisabled ? ' disabled' : ''}>◀ 이전</button>
        <span class="ch-label">${this.currentSelectedChunkIndex + 1} / ${this.currentChunks.length}</span>
        <button class="topbar-btn ch-nav-btn" data-dir="next"${nextDisabled ? ' disabled' : ''}>다음 ▶</button>
      </div>
      <div class="mode-selector">
        <button class="mode-btn${this.readerMode === 'story' ? ' active-mode' : ''}" data-mode="story">📖 읽기</button>
        <button class="mode-btn${this.readerMode === 'tts' ? ' active-mode' : ''}" data-mode="tts">🔊 낭독</button>
      </div>
      <div id="tts-bar" class="tts-bar${ttsOpen ? ' open' : ''}">
        <button class="topbar-btn" id="tts-play">▶️</button>
        <button class="topbar-btn" id="tts-pause">⏸️</button>
        <button class="topbar-btn" id="tts-stop">⏹️</button>
        <span class="tts-label">속도:</span>
        <input type="range" id="tts-rate" min="0.3" max="2.0" step="0.1" value="${TTS._rate}">
        <span id="tts-rate-val" class="tts-val">${TTS._rate}x</span>
      </div>
      <div class="reader-text" id="reader-text">
        ${this.renderParagraphs()}
      </div>
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
        
        const modeBtn = e.target.closest('.mode-btn');
        if (modeBtn) {
          this.setReaderMode(modeBtn.dataset.mode);
          return;
        }
        
        if (e.target.closest('#tts-play')) { this.startTTS(); return; }
        if (e.target.closest('#tts-pause')) { TTS.isSpeaking() ? TTS.pause() : TTS.resume(); return; }
        if (e.target.closest('#tts-stop')) { TTS.stop(); return; }
        
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

  goToChunk(index) {
    if (index < 0 || index >= this.currentChunks.length) return;
    if (index === this.currentSelectedChunkIndex) return;

    // Save progress before moving
    const scrollOffset = window.scrollY || window.pageYOffset;
    updateBookProgress(this.currentBook.id, this.currentSelectedChunkIndex, scrollOffset);
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
      this.renderReader();
      this.loadChapterSummary();
      this.loadWarmup();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    
    // Save current chunk in DB
    updateBookProgress(this.currentBook.id, index, 0);
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
    
    // Highlight the sentence
    document.querySelectorAll('.sent').forEach(s => s.classList.remove('active'));
    const sentEls = document.querySelectorAll('.sent');
    if (sentEls[index]) sentEls[index].classList.add('active');
    
    const rect = sentEls[index]?.getBoundingClientRect();
    const menu = $('quick-menu');
    
    // Generate word tokens for each word in the sentence
    const words = text.split(' ').filter(w => w.length > 0);
    const wordHtml = words.map(w => {
      const clean = escapeHtml(w);
      return `<span class="qm-word word-chip" data-word="${clean}">${clean}</span>`;
    }).join('');
    
    menu.innerHTML = `
      <div class="qm-sentence">${escapeHtml(text)}</div>
      <div class="qm-words-wrap">${wordHtml}</div>
      <div class="qm-actions">
        <button class="qm-btn word" data-action="word">📖 단어 힌트</button>
        <button class="qm-btn grammar" data-action="grammar">🔍 구문 힌트</button>
        <button class="qm-btn structure" data-action="structure">🏷️ 구조 분석</button>
        <button class="qm-btn chunk" data-action="chunkReading">✂️ 끊어 읽기</button>
        <button class="qm-btn easy" data-action="easyEnglish">🟢 쉬운 영어</button>
        <button class="qm-btn gist" data-action="gist">📋 문장 요지</button>
        <button class="qm-btn ask" data-action="ask">💬 자유 질문</button>
        <button class="qm-btn study" data-action="study">✍️ 해석해보기</button>
        <button class="qm-btn queue" data-action="queue">⏰ 나중에</button>
      </div>
      <div id="hint-result" class="qm-hint-result"></div>
    `;
    
    menu.classList.add('open');
    if (rect) {
      const top = rect.bottom + 8;
      const left = Math.min(rect.left, window.innerWidth - 340);
      menu.style.top = top + 'px';
      menu.style.left = Math.max(10, left) + 'px';
    }
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
    this.feedbackAttempts = [];
    
    $('study-sentence').textContent = this.selectedSentence.text;
    $('study-user-input').value = '';
    $('study-feedback').classList.remove('open');
    $('study-compare').classList.remove('open');
    $('study-submit').disabled = false;
    $('study-submit').textContent = '✍️ 해석 제출';
    $('study-buddy').innerHTML = '';
    
    // Scroll to top of panel
    $('study-body').scrollTop = 0;
  },

  closeStudy() {
    $('study-panel').classList.remove('open');
    TTS.stop();
  },

  /* ===== Study Mode: Feedback Loop ===== */
  async submitTranslation() {
    const input = $('study-user-input');
    const text = input.value.trim();
    if (!text) return;
    
    $('study-submit').disabled = true;
    $('study-submit').textContent = '분석 중...';
    
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
      $('study-submit').textContent = '🔄 다시 제출';
      
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
      $('study-submit').textContent = '🔄 다시 제출';
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

    $('study-submit').textContent = '✅ 완료';
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
    $('study-submit').textContent = '🔄 다시 제출';
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

  async renderQueue() {
    const items = await getQueue();
    const list = $('queue-list');
    list.innerHTML = '';
    
    if (!items.length) {
      list.innerHTML = '<div class="review-empty"><div class="icon">📭</div>저장된 문장이 없습니다.<br>읽기 중 어려운 문장을 ⏰ 나중에 공부에 저장해보세요.</div>';
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
      grid.innerHTML = '<div class="review-empty" style="grid-column:1/-1"><div class="icon">📖</div>아직 저장된 단어가 없습니다.<br>읽기 중 모르는 단어를 단어장에 저장해보세요.</div>';
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
            <span>${w.reviewBox > 0 ? '📅 복습: ' + (w.nextReview ? new Date(w.nextReview).toLocaleDateString() : '-') : '🆕 신규'}</span>
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

  /* ===== TTS Controls ===== */
  startTTS() {
    const texts = this.currentSentences.map(s => s.text);
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
      list.innerHTML = '<div class="review-empty"><div class="icon">📝</div>아직 피드백 기록이 없습니다.<br>Study Mode에서 해석을 제출해보세요.</div>';
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
      body.innerHTML = '<div class="review-empty"><div class="icon">📊</div>아직 읽기 기록이 없습니다.<br>책을 읽으면 도움 의존도가 여기에 쌓입니다.</div>';
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
  return { 'new': '🆕 새 단어', 'learning': '📖 학습중', 'known': '✅ 알고 있음' }[s] || s;
}

/* ===== Init on DOM Ready ===== */
document.addEventListener('DOMContentLoaded', () => App.init());
