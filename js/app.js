/* E-Story Main App */
const $ = id => document.getElementById(id);

let App = {
  currentView: 'bookshelf',
  currentBook: null,
  currentChunk: null,
  currentSentences: [],
  selectedSentence: null,
  bookData: null,
  feedbackAttempts: [],
  mode: 'story', // story | study | review
  queueCount: 0,

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
    
    await this.loadBookshelf();
    await this.updateQueueBadge();
    await this.loadSettings();
    
    // Listen for AI demo fallback notification
    window.addEventListener('ai:demo-fallback', (e) => {
      this.showToast('⚠️ AI 연결 실패, 데모 모드로 대체됨: ' + e.detail.message, 'error');
    });
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
    
    // Add upload area
    grid.innerHTML = '<div class="upload-area" id="upload-area"><div style="font-size:32px;margin-bottom:8px">📂</div><div style="font-size:14px;margin-bottom:4px">txt 파일을 업로드하세요</div><div style="font-size:12px">또는 여기로 드래그 & 드롭</div><input type="file" id="file-input" accept=".txt" style="display:none"></div>';
    
    // Rebind upload events
    setTimeout(() => {
      document.getElementById('file-input')?.addEventListener('change', (e) => App.handleUpload(e));
      document.getElementById('upload-area')?.addEventListener('click', () => document.getElementById('file-input')?.click());
      document.getElementById('upload-area')?.addEventListener('dragover', (e) => e.preventDefault());
      document.getElementById('upload-area')?.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) App.processFile(e.dataTransfer.files[0]); });
    }, 50);
    
    books.forEach(book => {
      const pct = book.totalChunks > 0 ? Math.round((book.currentChunk / book.totalChunks) * 100) : 0;
      grid.innerHTML += `
        <div class="book-card" data-id="${book.id}">
          <div class="title">${escapeHtml(book.title)}</div>
          <div class="author">${book.fileName}</div>
          <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="meta"><span>${pct}% 완료</span><span>${book.totalChunks}챕터</span></div>
        </div>`;
    });
    
    grid.querySelectorAll('.book-card').forEach(card => {
      card.addEventListener('click', () => this.openBook(parseInt(card.dataset.id)));
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
  },

  /* ===== Reader ===== */
  async openBook(bookId) {
    this.currentBook = await getBook(bookId);
    if (!this.currentBook) return;
    
    this.bookData = { id: bookId, book: this.currentBook };
    const chunks = await getChunks(bookId);
    const startChunk = Math.min(this.currentBook.currentChunk, chunks.length - 1);
    this.currentChunk = chunks[startChunk] || chunks[0];
    this.currentSentences = await getSentences(this.currentChunk.id);
    
    // Prepend reader page
    $('reader-page').classList.add('active');
    this.switchView('reader');
    
    this.renderReader();
    
    // Generate chapter summary if available (story memory)
    // This will be lazy-loaded
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
    
    // Text
    const textDiv = document.createElement('div');
    textDiv.className = 'reader-text';
    
    // Group sentences into paragraphs (sequential similar-index sentences)
    let para = document.createElement('p');
    this.currentSentences.forEach((sent, i) => {
      const span = document.createElement('span');
      span.className = 'sent';
      span.dataset.index = i;
      span.dataset.text = sent.text;
      span.textContent = sent.text + ' ';
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSentenceClick(i, sent.text);
      });
      para.appendChild(span);
    });
    textDiv.appendChild(para);
    wrap.appendChild(textDiv);
    
    // TTS controls
    const rateSlider = $('tts-rate');
    if (rateSlider) {
      rateSlider.addEventListener('input', () => {
        TTS._rate = parseFloat(rateSlider.value);
        $('tts-rate-val').textContent = TTS._rate + 'x';
      });
    }
    $('tts-play')?.addEventListener('click', () => this.startTTS());
    $('tts-pause')?.addEventListener('click', () => TTS.isSpeaking() ? TTS.pause() : TTS.resume());
    $('tts-stop')?.addEventListener('click', () => TTS.stop());
    
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.quick-menu') && !e.target.closest('.sent')) {
        this.closeQuickMenu();
      }
    });
  },

  setReaderMode(mode) {
    this.mode = mode;
    $('tts-bar').style.display = mode === 'tts' ? 'flex' : 'none';
  },

  /* ===== Sentence Click → Quick Menu ===== */
  async onSentenceClick(index, text) {
    this.selectedSentence = { index, text };
    
    // Highlight the sentence
    document.querySelectorAll('.sent').forEach(s => s.classList.remove('active'));
    const sentEls = document.querySelectorAll('.sent');
    if (sentEls[index]) sentEls[index].classList.add('active');
    
    const rect = sentEls[index]?.getBoundingClientRect();
    const menu = $('quick-menu');
    
    menu.innerHTML = `
      <div class="qm-sentence">${escapeHtml(text)}</div>
      <div class="qm-actions">
        <button class="qm-btn word" onclick="App.wordHint()">📖 단어 힌트</button>
        <button class="qm-btn grammar" onclick="App.grammarHint()">🔍 구문 힌트</button>
        <button class="qm-btn gist" onclick="App.sentenceGist()">📋 문장 요지</button>
        <button class="qm-btn study" onclick="App.openStudy()">✍️ 해석해보기</button>
        <button class="qm-btn queue" onclick="App.queueLater()">⏰ 나중에</button>
      </div>
      <div id="hint-result" style="margin-top:8px;padding:8px;border-radius:6px;background:var(--bg);font-size:12px;color:var(--tx2);line-height:1.5;display:none"></div>
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
  },

  async wordHint() {
    const result = $('hint-result');
    result.style.display = 'block';
    result.textContent = '단어 뜻 불러오는 중...';
    const words = this.selectedSentence.text.split(' ').filter(w => w.length > 3);
    const randomWord = words[Math.floor(Math.random() * words.length)] || 'example';
    const hint = await AI.wordHint(randomWord, this.selectedSentence.text);
    result.innerHTML = `<b>${randomWord}</b>: ${hint.meaningKo || '데이터를 불러오는 중입니다'} <span style="color:var(--tx3)">(${hint.partOfSpeech || ''})</span>`;
  },

  async grammarHint() {
    const result = $('hint-result');
    result.style.display = 'block';
    result.textContent = '분석 중...';
    const data = await AI.grammarHint(this.selectedSentence.text);
    result.innerHTML = `<b>문장 구조:</b> ${data.structure}<br><b>시제:</b> ${data.tense}`;
  },

  async sentenceGist() {
    const result = $('hint-result');
    result.style.display = 'block';
    result.textContent = '요약 중...';
    const data = await AI.sentenceGist(this.selectedSentence.text);
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
    
    if (data.status === 'finished' || data.shouldShowModelTranslation) {
      // Show comparison
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
            <div class="cv-text">${data.literalTranslationKo || '—'}</div>
          </div>
        </div>
        <div class="cv-row">
          <div class="cv-box" style="grid-column:1/-1">
            <div class="cv-label">자연 해석 (의역)</div>
            <div class="cv-text">${data.naturalTranslationKo || '—'}</div>
          </div>
        </div>
        ${data.storyNoteKo ? `<div class="cv-note">💡 ${data.storyNoteKo}</div>` : ''}
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
      
    } else {
      // One-point feedback
      fb.innerHTML = `
        <div class="fb-label">💡 개선 포인트 (${this.feedbackAttempts.length + 1})</div>
        <div class="fb-text">${data.feedbackKo}</div>
        ${data.hintKo ? `<div class="fb-hint">💭 ${data.hintKo}</div>` : ''}
        ${data.l1InterferenceKo ? `<div class="fb-l1">🇰🇷 ${data.l1InterferenceKo}</div>` : ''}
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
        await addWord(word, '(뜻을 입력하세요)', this.selectedSentence.text, this.currentBook?.id, this.selectedSentence?.index, '');
        this.showToast(`"${word}" 단어장에 추가됨!`, 'success');
        this.updateQueueBadge();
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
    await markQueueDone(id);
    this.selectedSentence = { index: sentenceId || 0, text };
    this.openStudy();
    await this.renderQueue();
    await this.updateQueueBadge();
  },

  async clearQueue() {
    const items = await getQueue();
    for (const item of items) {
      await markQueueDone(item.id);
    }
    await this.renderQueue();
    await this.updateQueueBadge();
    this.showToast('큐가 비워졌습니다.', 'info');
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
      await importData(text);
      this.showToast('✅ 데이터 복원 완료! 페이지를 새로고침합니다.', 'success');
      setTimeout(() => location.reload(), 1000);
    } catch(err) {
      this.showToast('❌ 복원 실패: ' + err.message, 'error');
    }
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
