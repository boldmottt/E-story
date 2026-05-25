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
  feedbackAttempts: [],
  mode: 'story', // story | study | review
  queueCount: 0,
  _scrollThrottleTimer: null,

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
    
    // Upload
    $('file-input')?.addEventListener('change', (e) => this.handleUpload(e));
    $('upload-area')?.addEventListener('click', () => $('file-input')?.click());
    $('upload-area')?.addEventListener('dragover', (e) => e.preventDefault());
    $('upload-area')?.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) this.processFile(e.dataTransfer.files[0]);
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
    
    // Close quick menu on outside click (L10: single global listener)
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.quick-menu') && !e.target.closest('.sent') && !e.target.closest('.qm-word')) {
        this.closeQuickMenu();
      }
    });
    
    // Throttled scroll position save
    document.addEventListener('scroll', () => {
      if (this.currentView !== 'reader') return;
      if (this._scrollThrottleTimer) clearTimeout(this._scrollThrottleTimer);
      this._scrollThrottleTimer = setTimeout(() => {
        this._saveScrollPosition();
      }, 300);
    }, { passive: true });
    
    // Sync init
    const syncKey = localStorage.getItem('estory_sync_key');
    if (syncKey) {
      Sync.init(syncKey);
      if (Sync.isEnabled()) {
        // Pull remote data on first load
        Sync.sync().then(result => {
          if (result.success) {
            console.log('Sync: initial pull complete');
            this.showToast('☁️ 클라우드 동기화 완료!', 'info');
            // Reload bookshelf with synced data
            this.loadBookshelf();
          }
        });
      }
    }
    
    // Sync event handlers
    $('sync-connect-btn')?.addEventListener('click', () => this.connectSync());
    $('sync-push-btn')?.addEventListener('click', () => this.syncPush());
    $('sync-pull-btn')?.addEventListener('click', () => this.syncPull());
  },

  // ── Sync methods ──
  connectSync() {
    const key = $('settings-sync-key')?.value.trim();
    if (!key) {
      this.showToast('Anon Key를 입력해주세요.', 'error');
      return;
    }
    localStorage.setItem('estory_sync_key', key);
    Sync.init(key);
    if (Sync.isEnabled()) {
      this.showToast('☁️ 동기화 연결 성공!', 'success');
      $('sync-status').textContent = '동기화: 연결됨';
      // Initial sync
      Sync.sync().then(r => {
        if (r.success) {
          this.showToast(`☁️ 동기화 완료!`, 'success');
          this.loadBookshelf();
        }
      });
    } else {
      this.showToast('❌ 동기화 연결 실패', 'error');
    }
  },

  async syncPush() {
    if (!Sync.isEnabled()) {
      this.showToast('먼저 동기화를 연결해주세요.', 'error');
      return;
    }
    this.showToast('⬆️ 업로드 중...', 'info');
    const result = await Sync.pushAll();
    if (result.success) {
      $('sync-status').textContent = `동기화: 연결됨 (마지막: ${new Date().toLocaleTimeString()})`;
      this.showToast('✅ 업로드 완료!', 'success');
    } else {
      this.showToast('❌ 업로드 실패', 'error');
    }
  },

  async syncPull() {
    if (!Sync.isEnabled()) {
      this.showToast('먼저 동기화를 연결해주세요.', 'error');
      return;
    }
    this.showToast('⬇️ 다운로드 중...', 'info');
    const result = await Sync.pullAll();
    if (result.success) {
      $('sync-status').textContent = `동기화: 연결됨 (마지막: ${new Date().toLocaleTimeString()})`;
      this.showToast(`✅ ${result.totalCount}개 레코드 동기화 완료!`, 'success');
      this.loadBookshelf();
    } else {
      this.showToast('❌ 다운로드 실패', 'error');
    }
  },

  _saveScrollPosition() {
    if (!this.currentBook) return;
    const offset = window.scrollY || window.pageYOffset;
    updateBookProgress(this.currentBook.id, this.currentSelectedChunkIndex, offset);
  },

  async _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  switchView(view) {
    this.currentView = view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    document.querySelectorAll('.content').forEach(c => c.classList.toggle('active', c.id === view + '-page'));
    
    if (view === 'vocabulary') this.renderVocabulary();
    if (view === 'queue') this.renderQueue();
    if (view === 'history') this.renderHistory();
    if (view === 'settings') this.loadSettings();
    
    this.updateTopbarTitle(view);
    
    // Persist current view for restore
    getSettings().then(s => {
      saveSettings({ ...s, lastView: view });
    });
  },

  updateTopbarTitle(view) {
    const titles = {
      bookshelf: '📚 내 서재',
      reader: this.currentBook?.title || '읽기',
      vocabulary: '📖 단어장',
      queue: '⏰ 나중에 공부',
      history: '📝 피드백 이력',
      settings: '⚙️ 설정'
    };
    $('topbar-title').textContent = titles[view] || 'E-Story';
  },

  /* ===== Bookshelf ===== */
  async loadBookshelf() {
    const books = await getBooks();
    const grid = $('bookshelf-grid');
    grid.innerHTML = '';
    
    // Add upload area as first card
    const uploadDiv = document.createElement('div');
    uploadDiv.className = 'upload-area';
    uploadDiv.id = 'upload-area';
    uploadDiv.innerHTML = '<div style="font-size:32px;margin-bottom:8px">📂</div><div style="font-size:14px;margin-bottom:4px">txt 파일을 업로드하세요</div><div style="font-size:12px">또는 여기로 드래그 & 드롭</div><input type="file" id="file-input" accept=".txt" style="display:none">';
    grid.appendChild(uploadDiv);
    
    // Use event delegation instead of per-card listeners (M1)
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.book-card');
      if (card) {
        this.openBook(parseInt(card.dataset.id));
        return;
      }
      // Upload area click
      if (e.target.closest('#upload-area')) {
        const input = document.getElementById('file-input');
        if (input) input.click();
      }
    });
    
    // File input change
    grid.addEventListener('change', (e) => {
      if (e.target.id === 'file-input') {
        this.handleUpload(e);
      }
    });
    
    // Drag & drop on upload area
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
    
    books.forEach(book => {
      const pct = book.totalChunks > 0 ? Math.round((book.currentChunk / book.totalChunks) * 100) : 0;
      const card = document.createElement('div');
      card.className = 'book-card';
      card.dataset.id = book.id;
      card.innerHTML = `
        <div class="title">${escapeHtml(book.title)}</div>
        <div class="author">${escapeHtml(book.fileName)}</div>
        <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="meta"><span>${pct}% 완료</span><span>${book.totalChunks}챕터</span></div>
      `;
      grid.appendChild(card);
    });
    
    this.updateQueueBadge();
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

  /* ===== Reader ===== */
  async openBook(bookId) {
    this.currentBook = await getBook(bookId);
    if (!this.currentBook) return;

    // Save last opened book for position restore
    getSettings().then(s => {
      saveSettings({ ...s, lastOpenedBookId: bookId });
    });

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

    // Restore scroll position
    if (this.currentBook.currentOffset) {
      setTimeout(() => {
        window.scrollTo({ top: this.currentBook.currentOffset, behavior: 'instant' });
      }, 50);
    }
  },

  renderReader() {
    const wrap = $('reader-wrap');
    wrap.innerHTML = '';
    
    // Apply font size from settings
    getSettings().then(s => {
      wrap.style.fontSize = (s.fontSize || 16) + 'px';
    });
    
    // Header
    const header = document.createElement('div');
    header.className = 'reader-header';
    header.innerHTML = `
      <div class="ch-title">${escapeHtml(this.currentChunk.title)}</div>
      <div class="book-title">${escapeHtml(this.currentBook.title)}</div>
    `;
    wrap.appendChild(header);
    
    // Chapter navigation
    const navDiv = document.createElement('div');
    navDiv.className = 'ch-nav';
    navDiv.style.cssText = 'display:flex;gap:8px;margin-bottom:14px;align-items:center;';
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '◀ 이전';
    prevBtn.className = 'topbar-btn';
    prevBtn.disabled = this.currentSelectedChunkIndex <= 0;
    prevBtn.style.cssText = `padding:5px 12px;border:1px solid var(--bd);border-radius:6px;background:var(--bg3);color:var(--tx2);font-size:12px;cursor:pointer;${prevBtn.disabled ? 'opacity:0.4;cursor:default' : ''}`;
    prevBtn.onclick = () => this.goToChunk(this.currentSelectedChunkIndex - 1);
    
    const chLabel = document.createElement('span');
    chLabel.style.cssText = 'font-size:12px;color:var(--tx3);flex:1;text-align:center';
    chLabel.textContent = `${this.currentSelectedChunkIndex + 1} / ${this.currentChunks.length}`;
    
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '다음 ▶';
    nextBtn.className = 'topbar-btn';
    nextBtn.disabled = this.currentSelectedChunkIndex >= this.currentChunks.length - 1;
    nextBtn.style.cssText = `padding:5px 12px;border:1px solid var(--bd);border-radius:6px;background:var(--bg3);color:var(--tx2);font-size:12px;cursor:pointer;${nextBtn.disabled ? 'opacity:0.4;cursor:default' : ''}`;
    nextBtn.onclick = () => this.goToChunk(this.currentSelectedChunkIndex + 1);
    
    navDiv.appendChild(prevBtn);
    navDiv.appendChild(chLabel);
    navDiv.appendChild(nextBtn);
    wrap.appendChild(navDiv);
    
    // Mode selector
    const modes = document.createElement('div');
    modes.style.cssText = 'display:flex;gap:6px;margin-bottom:14px;';
    const modeNames = ['story', 'tts'];
    const modeLabels = ['📖 읽기', '🔊 낭독'];
    modeNames.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.className = `topbar-btn${m === this.mode ? ' active-mode' : ''}`;
      btn.textContent = modeLabels[i];
      btn.style.cssText = `padding:5px 12px;border:1px solid var(--bd);border-radius:6px;background:${m === this.mode ? 'var(--a0)' : 'var(--bg3)'};color:${m === this.mode ? '#000' : 'var(--tx2)'};font-size:12px;cursor:pointer;font-family:var(--font)`;
      btn.onclick = () => this.setReaderMode(m);
      modes.appendChild(btn);
    });
    
    // TTS controls (hidden by default)
    const ttsBar = document.createElement('div');
    ttsBar.id = 'tts-bar';
    ttsBar.style.cssText = 'display:none;align-items:center;gap:10px;margin-bottom:14px;padding:10px;background:var(--bg3);border-radius:8px;';
    ttsBar.innerHTML = `
      <button class="topbar-btn" id="tts-play">▶️</button>
      <button class="topbar-btn" id="tts-pause">⏸️</button>
      <button class="topbar-btn" id="tts-stop">⏹️</button>
      <span style="font-size:12px;color:var(--tx3)">속도:</span>
      <input type="range" id="tts-rate" min="0.3" max="2.0" step="0.1" value="${TTS._rate}" style="width:80px">
      <span id="tts-rate-val" style="font-size:12px;color:var(--tx3);min-width:30px">${TTS._rate}x</span>
    `;
    wrap.appendChild(modes);
    wrap.appendChild(ttsBar);
    
    // Text with event delegation
    const textDiv = document.createElement('div');
    textDiv.className = 'reader-text';
    textDiv.id = 'reader-text';
    
    // Group sentences into paragraphs
    let para = document.createElement('p');
    this.currentSentences.forEach((sent, i) => {
      const span = document.createElement('span');
      span.className = 'sent';
      span.dataset.index = i;
      span.dataset.text = sent.text;
      span.textContent = sent.text + ' ';
      para.appendChild(span);
    });
    textDiv.appendChild(para);
    wrap.appendChild(textDiv);
    
    // Event delegation for sentence clicks (H2: single listener)
    textDiv.addEventListener('click', (e) => {
      const sentEl = e.target.closest('.sent');
      if (!sentEl) return;
      const index = parseInt(sentEl.dataset.index);
      const text = sentEl.dataset.text;
      this.onSentenceClick(index, text);
    });
    
    // TTS controls - rate slider saves via TTS.setRate (M10 fix)
    const rateSlider = $('tts-rate');
    if (rateSlider) {
      rateSlider.addEventListener('input', () => {
        TTS._rate = parseFloat(rateSlider.value);
        $('tts-rate-val').textContent = TTS._rate + 'x';
      });
      // Save rate on change (drag end or click)
      rateSlider.addEventListener('change', () => {
        TTS.setRate(parseFloat(rateSlider.value));
      });
    }
    $('tts-play')?.addEventListener('click', () => this.startTTS());
    $('tts-pause')?.addEventListener('click', () => TTS.isSpeaking() ? TTS.pause() : TTS.resume());
    $('tts-stop')?.addEventListener('click', () => TTS.stop());
    
    // Close quick menu on outside click (single listener)
    // Using capture phase to prevent interference
  },

  goToChunk(index) {
    if (index < 0 || index >= this.currentChunks.length) return;
    if (index === this.currentSelectedChunkIndex) return;
    
    // Save progress before moving
    const scrollOffset = window.scrollY || window.pageYOffset;
    updateBookProgress(this.currentBook.id, this.currentSelectedChunkIndex, scrollOffset);
    
    // Switch chunk
    this.currentSelectedChunkIndex = index;
    this.currentChunk = this.currentChunks[index];
    
    // Update AI reading context
    AI.setReadingContext(this.currentBook.title, index, this.currentChunks.length);
    
    // Load sentences for new chunk
    getSentences(this.currentChunk.id).then(sents => {
      this.currentSentences = sents;
      this.renderReader();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    
    // Save current chunk in DB
    updateBookProgress(this.currentBook.id, index, 0);
  },

  setReaderMode(mode) {
    this.mode = mode;
    $('tts-bar').style.display = mode === 'tts' ? 'flex' : 'none';
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
      return `<span class="qm-word" data-word="${clean}" style="cursor:pointer;padding:2px 4px;border-radius:4px;background:var(--bg3);color:var(--tx);font-size:13px;display:inline-block;margin:2px;transition:var(--t)">${clean}</span>`;
    }).join('');
    
    menu.innerHTML = `
      <div class="qm-sentence">${escapeHtml(text)}</div>
      <div class="qm-words" style="margin-bottom:8px;padding:6px;background:var(--bg);border-radius:6px;line-height:1.8">${wordHtml}</div>
      <div class="qm-actions">
        <button class="qm-btn word" onclick="App.wordHint()">📖 단어 힌트</button>
        <button class="qm-btn grammar" onclick="App.grammarHint()">🔍 구문 힌트</button>
        <button class="qm-btn gist" onclick="App.sentenceGist()">📋 문장 요지</button>
        <button class="qm-btn study" onclick="App.openStudy()">✍️ 해석해보기</button>
        <button class="qm-btn queue" onclick="App.queueLater()">⏰ 나중에</button>
      </div>
      <div id="hint-result" style="margin-top:8px;padding:8px;border-radius:6px;background:var(--bg);font-size:12px;color:var(--tx2);line-height:1.5;display:none"></div>
    `;
    
    // Click on a word token to select it
    menu.querySelectorAll('.qm-word').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        // Deselect all, select this one
        menu.querySelectorAll('.qm-word').forEach(w => w.style.background = 'var(--bg3)');
        el.style.background = 'var(--a0)';
        el.style.color = '#000';
        this.selectedWord = el.dataset.word;
        // Auto-show word hint for this word
        this.wordHint(el.dataset.word);
      });
      el.addEventListener('mouseenter', () => { if (el.style.background !== 'var(--a0)') el.style.background = 'var(--bg4)'; });
      el.addEventListener('mouseleave', () => { if (el.style.background !== 'var(--a0)') el.style.background = 'var(--bg3)'; });
    });
    
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
    const hint = await AI.wordHint(word, this.selectedSentence.text);
    result.innerHTML = `<b>${escapeHtml(word)}</b>: ${escapeHtml(hint.meaningKo || '데이터를 불러오는 중입니다')} <span style="color:var(--tx3)">(${escapeHtml(hint.partOfSpeech || '')})</span>`;
  },

  async grammarHint() {
    const result = $('hint-result');
    result.style.display = 'block';
    result.textContent = '분석 중...';
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
    const data = await AI.sentenceGist(this.selectedSentence.text);
    if (data.error) {
      result.textContent = '⚠️ ' + (data.message || '요약 실패');
      return;
    }
    result.textContent = `📋 ${data.gistKo}`;
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
      // Only show comparison when truly finished (H3 fix)
      const cv = $('study-compare');
      cv.classList.add('open');
      cv.innerHTML = `
        <div class="cv-row">
          <div class="cv-box">
            <div class="cv-label">내 해석</div>
            <div class="cv-text">${escapeHtml(text)}</div>
          </div>
          <div class="cv-box">
            <div class="cv-label">구조 해석 (직역)</div>
            <div class="cv-text">${escapeHtml(data.literalTranslationKo || '—')}</div>
          </div>
        </div>
        <div class="cv-row">
          <div class="cv-box" style="grid-column:1/-1">
            <div class="cv-label">자연 해석 (의역)</div>
            <div class="cv-text">${escapeHtml(data.naturalTranslationKo || '—')}</div>
          </div>
        </div>
        ${data.storyNoteKo ? `<div class="cv-note">💡 ${escapeHtml(data.storyNoteKo)}</div>` : ''}
      `;
      
      $('study-submit').textContent = '✅ 완료';
      $('study-submit').disabled = true;
      
      // Save to feedback history
      this.feedbackAttempts.push({
        userTranslation: text,
        aiStatus: data.status,
        issueType: data.issueType,
        feedbackKo: data.feedbackKo,
        hintKo: data.hintKo,
        l1InterferenceKo: data.l1InterferenceKo
      });
      
      await saveFeedbackSession(
        this.currentBook?.id, this.selectedSentence?.index,
        this.selectedSentence?.text, this.feedbackAttempts,
        text, data.literalTranslationKo, data.naturalTranslationKo, data.storyNoteKo
      );
      Sync.scheduleSync();
      
      // Mark queue as done (M4 fix: only on finished)
      if (this._currentQueueId) {
        await markQueueDone(this._currentQueueId);
        this._currentQueueId = null;
        await this.updateQueueBadge();
      }
      
      // Story Buddy buttons
      const buddyDiv = $('study-buddy');
      buddyDiv.innerHTML = `
        <div class="buddy-actions">
          <button class="buddy-btn" onclick="App.askBuddy('situation')">📌 지금 상황은?</button>
          <button class="buddy-btn" onclick="App.askBuddy('speaker')">🗣️ 누가 말하는 중?</button>
          <button class="buddy-btn" onclick="App.askBuddy('mood')">🎭 분위기가 어때?</button>
          <button class="buddy-btn" onclick="App.askBuddy('cultural')">🌍 문화 배경</button>
        </div>
        <div id="buddy-response" class="buddy-response"></div>
      `;
      
      // Save to vocabulary
      this._offerVocabSave();
      
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
    const fb = $('study-feedback');
    fb.innerHTML = '<div class="fb-label">📝 최종 해석 생성 중...</div>';
    
    // Call AI with explicit request for finished status
    const data = await AI.feedback(sentence, userTranslation, this.feedbackAttempts);
    
    const cv = $('study-compare');
    cv.classList.add('open');
    cv.innerHTML = `
      <div class="cv-row">
        <div class="cv-box">
          <div class="cv-label">내 해석</div>
          <div class="cv-text">${escapeHtml(userTranslation)}</div>
        </div>
        <div class="cv-box">
          <div class="cv-label">구조 해석 (직역)</div>
          <div class="cv-text">${escapeHtml(data.literalTranslationKo || data.naturalTranslationKo || '—')}</div>
        </div>
      </div>
      <div class="cv-row">
        <div class="cv-box" style="grid-column:1/-1">
          <div class="cv-label">자연 해석 (의역)</div>
          <div class="cv-text">${escapeHtml(data.naturalTranslationKo || data.literalTranslationKo || '—')}</div>
        </div>
      </div>
      ${data.storyNoteKo ? `<div class="cv-note">💡 ${escapeHtml(data.storyNoteKo)}</div>` : ''}
    `;
    
    $('study-submit').textContent = '✅ 완료';
    $('study-submit').disabled = true;
    
    await saveFeedbackSession(
      this.currentBook?.id, this.selectedSentence?.index,
      this.selectedSentence?.text, this.feedbackAttempts,
      userTranslation, data.literalTranslationKo, data.naturalTranslationKo, data.storyNoteKo
    );
    Sync.scheduleSync();
    
    // Mark queue as done
    if (this._currentQueueId) {
      await markQueueDone(this._currentQueueId);
      this._currentQueueId = null;
      await this.updateQueueBadge();
    }
    
    // Story Buddy
    const buddyDiv = $('study-buddy');
    buddyDiv.innerHTML = `
      <div class="buddy-actions">
        <button class="buddy-btn" onclick="App.askBuddy('situation')">📌 지금 상황은?</button>
        <button class="buddy-btn" onclick="App.askBuddy('speaker')">🗣️ 누가 말하는 중?</button>
        <button class="buddy-btn" onclick="App.askBuddy('mood')">🎭 분위기가 어때?</button>
        <button class="buddy-btn" onclick="App.askBuddy('cultural')">🌍 문화 배경</button>
      </div>
      <div id="buddy-response" class="buddy-response"></div>
    `;
    
    this._offerVocabSave();
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
    
    const data = await AI.storyBuddy(this.selectedSentence.text, questions[type], '');
    resp.textContent = data.answerKo || '분석 결과를 불러올 수 없습니다.';
  },

  _offerVocabSave() {
    const words = this.selectedSentence.text.split(' ').filter(w => w.length > 3);
    if (!words.length) return;
    
    const fb = $('study-feedback');
    const vocabBtn = document.createElement('div');
    vocabBtn.style.cssText = 'margin-top:12px';
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
        <p style="font-size:13px;color:var(--tx2);margin-bottom:12px">이 문장에서 단어장에 저장할 단어를 선택하세요:</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
          ${words.map((w, i) => `<button class="vocab-select-word" data-word="${escapeHtml(w)}" style="padding:6px 12px;border:1px solid var(--bd);border-radius:var(--r-sm);background:var(--bg3);color:var(--tx);font-size:13px;cursor:pointer;font-family:var(--font);transition:var(--t)">${escapeHtml(w)}</button>`).join('')}
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
        await addWord(word, meaning, this.selectedSentence.text, this.currentBook?.id, this.selectedSentence?.index, '');
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
    // Switch to vocabulary page and show review
    this.switchView('vocabulary');
    // TODO: implement full SRS review modal
    this.showToast(`${words.length}개 단어 복습 시간!`, 'info');
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
    $('settings-url').value = s.aiBaseUrl || 'https://api.openai.com/v1';
    $('settings-model').value = s.aiModel || 'gpt-4o-mini';
    $('settings-key').value = '';
    $('settings-key-mode').value = s.apiKeyStorageMode || 'session';
    $('settings-tts-rate').value = s.ttsRate || 0.9;
    $('settings-tts-val').textContent = s.ttsRate + 'x';
    $('settings-fontsize').value = s.fontSize || 16;
    $('settings-fs-val').textContent = s.fontSize + 'px';
    
    // Sync status
    if (Sync.isEnabled()) {
      $('sync-status').textContent = '동기화: 연결됨';
      $('settings-sync-key').value = '••••••••';
    }
  },

  async saveSettings() {
    const s = {
      aiBaseUrl: $('settings-url').value.trim(),
      aiModel: $('settings-model').value.trim(),
      aiKey: $('settings-key').value.trim(),
      apiKeyStorageMode: $('settings-key-mode').value,
      ttsRate: parseFloat($('settings-tts-rate').value),
      fontSize: parseInt($('settings-fontsize').value),
      theme: 'dark', lineHeight: 1.9
    };
    
    AI.setKey(s.aiKey);
    AI.setBaseUrl(s.aiBaseUrl);
    AI.setModel(s.aiModel);
    
    await saveSettings(s);
    this.showToast('설정이 저장되었습니다!', 'success');
  },

  async testAI() {
    const key = $('settings-key').value.trim();
    if (!key) {
      this.showToast('API 키를 입력해주세요.', 'error');
      return;
    }
    AI.setKey(key);
    AI.setBaseUrl($('settings-url').value.trim());
    AI.setModel($('settings-model').value.trim());
    
    try {
      const result = await AI.sentenceGist('The sun set behind the mountains, painting the sky in shades of orange and purple.');
      this.showToast(`✅ 연결 성공! (데모: ${result.gistKo?.slice(0, 30) || 'OK'})`, 'success');
    } catch(e) {
      this.showToast(`❌ 연결 실패: ${e.message}`, 'error');
    }
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
