/* E-Story AI Module — BYOK + Demo Mode */
/* v2: No-spoiler, JSON recovery, error classification, cache */

// Only the local serve.py exposes the /api/zen proxy. On static hosting
// (e.g. GitHub Pages) the relative path 404s, so default to a direct
// OpenAI-compatible endpoint that the user configures with their own key.
const AI_IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const AI_DEFAULT_URL = AI_IS_LOCAL ? '/api/zen/go/v1' : 'https://api.openai.com/v1';
const AI_DEFAULT_MODEL = AI_IS_LOCAL ? 'deepseek-v4-flash' : 'gpt-4o-mini';

const AI = {
  _key: '',
  // Local: same-origin proxy (serve.py injects the key, avoids CORS).
  // Hosted: a direct endpoint the user sets in Settings (BYOK).
  _baseUrl: AI_DEFAULT_URL,
  _model: AI_DEFAULT_MODEL,
  _mode: 'demo',
  _storageMode: 'session',

  // Reading context for No-spoiler
  _readingContext: { bookTitle: '', chunkIndex: 0, totalChunks: 0 },

  // LRU response cache
  _cache: new Map(),
  _CACHE_MAX: 100,

  // ── Shared No-spoiler system prompt ──
  _NO_SPOILER_PROMPT: `## No-Spoiler Rules (CRITICAL)
- The user is READING a book RIGHT NOW. They have NOT finished it.
- NEVER reveal events, character fates, or plot twists that happen AFTER the user's current position.
- If asked about something that happens later, say "이 내용은 아직 읽지 않은 부분이에요. 계속 읽어보세요!"
- Base ALL answers ONLY on the text the user has already read (sentences/chunks they've seen).
- Do NOT use your training knowledge of famous books to answer questions about future events.
- When in doubt, err on the side of NOT revealing information.`,

  /** True when calls go through a proxy that injects the key server-side
   *  (same-origin serve.py via relative path, or a Cloudflare Worker). */
  _isProxied() {
    return this._baseUrl.startsWith('/') || this._baseUrl.includes('.workers.dev');
  },

  async init() {
    this._baseUrl = AI_DEFAULT_URL;
    this._model = AI_DEFAULT_MODEL;
    this._key = '';
    this._mode = 'demo';
    this._readingContext = { bookTitle: '', chunkIndex: 0, totalChunks: 0 };
    this._cache = new Map();

    // Check storage for existing key — respects apiKeyStorageMode
    try {
      const s = await getSettings();
      if (s.apiKeyStorageMode === 'persist') {
        const storedKey = localStorage.getItem('estory_ai_key');
        if (storedKey) { this._key = storedKey; this._mode = 'real'; this._storageMode = 'persist'; }
      } else {
        const sessionKey = sessionStorage.getItem('estory_ai_key');
        if (sessionKey) { this._key = sessionKey; this._mode = 'real'; }
      }
      // Always fall back to DB-stored key
      if (s.aiKey && s.aiKey !== 'OPENCODE_GO_API_KEY' && s.aiKey !== 'OPENCODE_ZEN_API_KEY') {
        this._key = s.aiKey;
        this._mode = 'real';
        this._storageMode = s.apiKeyStorageMode || 'session';
      }
      // Use settings for baseUrl/model if configured
      if (s.aiBaseUrl) this._baseUrl = s.aiBaseUrl;
      if (s.aiModel) this._model = s.aiModel;
    } catch (e) {
      console.warn('AI.init: settings load failed, using defaults', e);
    }

    // Proxied mode needs no browser-side key — the server injects it.
    if (this._isProxied()) this._mode = 'real';
  },

  setKey(key, storageMode) {
    if (key && key.trim()) {
      this._key = key.trim();
      this._mode = 'real';
      this._storageMode = storageMode || this._storageMode || 'session';
      if (this._storageMode === 'persist') {
        localStorage.setItem('estory_ai_key', this._key);
      } else {
        sessionStorage.setItem('estory_ai_key', this._key);
      }
    }
  },

  setBaseUrl(url) { if (url) this._baseUrl = url; },
  setModel(model) { if (model) this._model = model; },

  /** Store reading context for No-spoiler enforcement */
  setReadingContext(bookTitle, chunkIndex, totalChunks) {
    this._readingContext = { bookTitle, chunkIndex, totalChunks };
  },

  /** Build the full system prompt with No-spoiler + task instructions */
  _buildPrompt(taskInstructions) {
    const ctx = this._readingContext;
    let ctxBlock = '';
    if (ctx.bookTitle) {
      ctxBlock = `\n## Current Reading Context\n- Book: "${ctx.bookTitle}"\n- Current position: 챕터 ${ctx.chunkIndex + 1} / ${ctx.totalChunks || '?'}\n- The user has read up to this point. NEVER reference events after this chapter.`;
    }
    return `${this._NO_SPOILER_PROMPT}${ctxBlock}\n\n${taskInstructions}`;
  },

  /** Generate cache key from sentence + hint type */
  _cacheKey(prefix, ...parts) {
    return prefix + ':' + parts.join('|').slice(0, 200);
  },

  /** Get from cache or call and cache */
  async _cached(key, fetcher) {
    if (this._cache.has(key)) {
      const entry = this._cache.get(key);
      entry.hits = (entry.hits || 0) + 1;
      return entry.data;
    }
    const data = await fetcher();
    if (data && !data.error) {
      this._cache.set(key, { data, hits: 0, ts: Date.now() });
      // Evict oldest if over limit
      if (this._cache.size > this._CACHE_MAX) {
        const oldest = [...this._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) this._cache.delete(oldest[0]);
      }
    }
    return data;
  },

  /** Core API call with No-spoiler, JSON recovery, error classification */
  async _call(messages, taskInstructions, jsonMode = true, maxTokens = 4000) {
    // Proxied mode holds the key server-side, so a browser key isn't required.
    if (!this._isProxied() && (this._mode !== 'real' || !this._key)) {
      window.dispatchEvent(new CustomEvent('ai:demo-fallback', { detail: { message: 'API 키가 설정되지 않음', code: 'no_key' } }));
      return this._demoResponse(messages);
    }

    try {
      // Inject no-spoiler system prompt at the front
      const sysPrompt = this._buildPrompt(taskInstructions || '');
      const fullMessages = [
        { role: 'system', content: sysPrompt },
        ...messages
      ];

      const body = {
        // deepseek-v4-flash is a reasoning model: it spends large token budgets
        // on hidden reasoning before emitting content. Too low a cap => empty
        // content (finish_reason "length"). 4000 leaves room for both.
        model: this._model, messages: fullMessages,
        max_tokens: maxTokens, temperature: 0.3, stream: false
      };
      if (jsonMode) body.response_format = { type: 'json_object' };

      const headers = { 'Content-Type': 'application/json' };
      if (!this._isProxied()) headers['Authorization'] = 'Bearer ' + this._key;

      const res = await fetch(this._baseUrl + '/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const code = res.status === 401 ? 'auth' :
                     res.status === 429 ? 'rate_limit' :
                     res.status >= 500 ? 'server' : 'unknown';
        throw new Error(code + '|' + `HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      let content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('empty|Empty response from AI');

      if (jsonMode) {
        // Robust JSON extraction
        const parsed = this._extractJSON(content);
        if (parsed) return parsed;
        throw new Error('parse|JSON 파싱 실패: 응답이 JSON 형식이 아닙니다');
      }

      return content;
    } catch (e) {
      const [code, ...msgParts] = (e.message || 'unknown|Unknown error').split('|');
      const msg = msgParts.join('|') || e.message;

      console.warn('AI call failed:', e);

      // Dispatch specific error events
      if (code === 'auth' || code === 'no_key') {
        window.dispatchEvent(new CustomEvent('ai:demo-fallback', { detail: { message: msg, code } }));
        return this._demoResponse(messages);
      }

      // For other errors, return error state (not demo)
      window.dispatchEvent(new CustomEvent('ai:error', { detail: { message: msg, code } }));
      return { error: true, code, message: msg };
    }
  },

  /** Extract JSON from potentially messy LM output */
  _extractJSON(text) {
    if (!text) return null;
    // Try direct parse first
    try { return JSON.parse(text); } catch(e) {}
    // Try stripping code fences
    const cleaned = text.replace(/```(?:json)?\s*\n?/g, '').trim();
    try { return JSON.parse(cleaned); } catch(e) {}
    // Try finding first { ... } block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch(e) {}
    }
    return null;
  },

  /* ── Hint methods ── */

  async wordHint(word, sentence) {
    const key = this._cacheKey('wh', word, sentence);
    return this._cached(key, async () => {
      const r = await this._call([
        { role: 'system', content: 'Return JSON: { "word": "...", "meaningKo": "...", "partOfSpeech": "..." } — Translate the given word in context of the sentence.' },
        { role: 'user', content: `Korean meaning of "${word}" in: "${sentence}"` }
      ], 'You are a concise English-Korean dictionary. Give the meaning of the specific word the user asks about, in the context of this sentence.');
      if (r && !r.error) return r;
      return { word, meaningKo: '(API 오류)', partOfSpeech: '' };
    });
  },

  async grammarHint(sentence) {
    const key = this._cacheKey('gh', sentence);
    return this._cached(key, async () => {
      const r = await this._call([
        { role: 'system', content: 'Return JSON: { "structure": "...", "keyPoints": [], "tense": "...", "clauseType": "..." } — Explain grammar in Korean.' },
        { role: 'user', content: `Explain grammar of: "${sentence}"` }
      ], 'Explain the grammar structure of this sentence in Korean. Focus on one key point. Do NOT translate the sentence.');
      if (r && !r.error) return r;
      return { structure: '(API 오류)', keyPoints: [], tense: '', clauseType: '' };
    });
  },

  async sentenceGist(sentence) {
    const key = this._cacheKey('sg', sentence);
    return this._cached(key, async () => {
      const r = await this._call([
        { role: 'user', content: `Short Korean gist (2-3 words) of: "${sentence}"` }
      ], 'Return JSON: { "gistKo": "..." } — A VERY short Korean gist (2-3 words) of this single sentence. NO spoilers, NO future context. Use present tense only.');
      if (r && !r.error) return r;
      return { error: true, code: 'unknown', message: '(API 연결을 확인해주세요)' };
    });
  },

  /** Paraphrase the sentence into SIMPLER English (not Korean). Helps the
   *  reader understand without leaning on translation — reduces dependency. */
  async easyEnglish(sentence) {
    const key = this._cacheKey('ee', sentence);
    return this._cached(key, async () => {
      const r = await this._call([
        { role: 'system', content: 'Return JSON: { "easyEn": "..." }' },
        { role: 'user', content: `Rewrite in simpler English: "${sentence}"` }
      ], 'Rewrite this single sentence in SIMPLER English (around CEFR A2-B1): common words, shorter clauses, same meaning. Output English only — do NOT translate to Korean. One sentence. NO spoilers, no outside context.');
      if (r && !r.error && r.easyEn) return r;
      return { error: true, code: 'unknown', message: '(API 연결을 확인해주세요)' };
    });
  },

  /** Model's OWN Korean translations of the English sentence, independent of
   *  the user's attempt — used for the final comparison view so 직역/의역이
   *  사용자 입력을 베끼지 않고 서로 구분된다. */
  async modelTranslations(sentence) {
    const key = this._cacheKey('mt', sentence);
    return this._cached(key, async () => {
      const r = await this._call([
        { role: 'system', content: 'Return JSON: { "literalTranslationKo": "...", "naturalTranslationKo": "...", "storyNoteKo": "..." }' },
        { role: 'user', content: `English sentence: "${sentence}"` }
      ], '이 영어 문장을 한국어로 두 가지로 번역하라. 사용자의 번역과 무관하게 원문만 보고 새로 작성한다. literalTranslationKo = 어순·구문을 살린 직역. naturalTranslationKo = 한국어답게 매끄러운 의역. 두 번역은 반드시 서로 달라야 한다(같은 문장 반복 금지). storyNoteKo = 이 문장의 뉘앙스·장면 의미 한 줄. NO spoilers.');
      if (r && !r.error) return r;
      return { error: true };
    });
  },

  /** Label each whitespace token of an English sentence with a grammar role.
   *  Returns { tokens, roles[], note } aligned by index. Reasoning models burn
   *  a large hidden budget here, so a high max_tokens is required. */
  async analyzeStructure(sentence) {
    const tokens = sentence.split(/\s+/).filter(Boolean);
    const key = this._cacheKey('as2', sentence);
    return this._cached(key, async () => {
      const numbered = tokens.map((t, i) => `${i}: ${t}`).join('\n');
      const r = await this._call([
        { role: 'system', content: `Return ONLY JSON:
{
  "items": [
    { "role": "<주어|동사|목적어|보어|수식어|기능어 중 하나>", "accept": ["<같은 6종 중 정답으로 인정 가능한 역할 모두>"], "why": "<그 역할인 이유를 한국어 한 문장으로. 관계되는 단어/동사/전치사를 짚어라>" }
  ],
  "note": "<문장 전체 구조를 한국어로 설명. 절이 여러 개면 각 절의 주어·동사를 짚어라>"
}` },
        { role: 'user', content: numbered }
      ], `각 토큰(인덱스 0..${tokens.length - 1})에 문법 역할을 부여한다.
- role은 반드시 다음 6개 중 하나만: 주어, 동사, 목적어, 보어, 수식어, 기능어.
- 기능어 = 관사·전치사·접속사·조동사·소유격 한정사(his/her 등)·구두점처럼 문법 기능만 하는 단어.
- 전치사 뒤 명사는 목적어. 종속절(as/when/because…)의 명사 주어는 그 절의 주어다.
- 한 단어가 두 역할로 모두 타당하면(예: 분사·to부정사·소유격) accept에 모두 넣는다. accept에는 반드시 role을 포함한다.
- items 길이는 정확히 ${tokens.length}개, 인덱스 순서대로.
- why는 초보자도 이해할 친절한 한 문장. 문법 용어를 쓰면 괄호로 풀어 설명한다.
- why와 note는 위 역할 분류와 절대 모순되면 안 된다. 동일한 분석에서 도출하라.`, true, 8000);
      if (r && !r.error && Array.isArray(r.items) && r.items.length === tokens.length) {
        return { tokens, items: r.items, note: r.note || '' };
      }
      return { error: true, tokens };
    });
  },

  async feedback(sentence, userTranslation, previousIssues = []) {
    return await this._call([
      { role: 'system', content: `You are an English tutor for a Korean learner reading a novel.

Rules in order of priority:
1. Give feedback in Korean. ONE issue per response.
2. Focus: meaning > nuance/tone > grammar > naturalness.
3. Do NOT reveal full translation unless finished (status === 'finished').
4. If user translation is good enough, use status "good_enough".
5. If user fixed previous issue, move to next.
6. Add l1InterferenceKo for Korean-typical mistakes.

Return JSON: { "status": "needs_revision"|"good_enough"|"finished", "issueType": "meaning"|"grammar"|"tense"|"article"|"preposition"|"word_choice"|"structure"|"naturalness"|"idiom"|"nuance"|"tone"|"none", "feedbackKo": "", "hintKo": null, "l1InterferenceKo": null, "shouldShowModelTranslation": false, "literalTranslationKo": null, "naturalTranslationKo": null, "storyNoteKo": null }

CRITICAL: shouldShowModelTranslation is ALWAYS false for 'good_enough' status. Only set true when status is 'finished'.
When finished, include literalTranslationKo, naturalTranslationKo, storyNoteKo.` },
      { role: 'user', content: JSON.stringify({ sentence, userTranslation, previousIssues }) }
    ], 'You are a Korean-speaking English tutor. One feedback point at a time. NEVER show model translations until the user has finished (status="finished").');
  },

  async storyBuddy(sentence, question, context) {
    const key = this._cacheKey('sb', sentence, question);
    return this._cached(key, async () => {
      const r = await this._call([
        { role: 'user', content: JSON.stringify({ sentence, question, context }) }
      ], 'Return JSON: { "answerKo": "..." } — Korean answer about the story. NO spoilers. Only talk about what has happened up to this sentence. If asked about future, say "아직 읽지 않은 부분이에요."');
      if (r && !r.error) return r;
      return { answerKo: '(API 연결 오류)' };
    });
  },

  async chapterSummary(text) {
    const key = this._cacheKey('cs', text.slice(0, 500));
    return this._cached(key, async () => {
      const r = await this._call([
        { role: 'user', content: text.slice(0, 4000) }
      ], 'Return JSON: { "summary3lines": "", "characters": [], "keyScenes": [], "expressions": [], "studySentence": "" } — Korean chapter summary. Only summarize the text provided. Do NOT add information from outside this text.');
      if (r && !r.error) return r;
      return { summary3lines: '(API 오류)', characters: [], keyScenes: [], expressions: [] };
    });
  },

  /* ── Demo fallback (only when no key) ── */
  _demoResponse(messages) {
    const lastMsg = messages[messages.length - 1]?.content || '';
    if (lastMsg.includes('"userTranslation"')) {
      return {
        status: 'needs_revision', issueType: 'none',
        feedbackKo: '⚙️ 설정에서 API 키를 등록하면 AI 피드백을 받을 수 있습니다.',
        hintKo: null, l1InterferenceKo: null,
        shouldShowModelTranslation: false,
        literalTranslationKo: null,
        naturalTranslationKo: null,
        storyNoteKo: null
      };
    }
    if (lastMsg.includes('"sentence"') && lastMsg.includes('"question"')) {
      return { answerKo: '⚙️ 설정에서 API 키를 등록해주세요.' };
    }
    if (lastMsg.includes('simpler English')) {
      return { easyEn: '⚙️ Set an API key in Settings to use this.' };
    }
    return { gistKo: '⚙️ 설정에서 API 키를 등록해주세요.' };
  }
};
