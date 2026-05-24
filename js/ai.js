/* E-Story AI Module — BYOK + Demo Mode */

const AI = {
  _key: '',
  _baseUrl: 'https://opencode.ai/zen/go/v1',
  _model: 'deepseek-v4-flash',
  _mode: 'demo',
  _storageMode: 'session',

  async init() {
    this._baseUrl = 'https://opencode.ai/zen/go/v1';
    this._model = 'deepseek-v4-flash';
    this._key = '';
    this._mode = 'demo';

    const sessionKey = sessionStorage.getItem('estory_ai_key');
    if (sessionKey) { this._key = sessionKey; this._mode = 'real'; }

    try {
      const s = await getSettings();
      if (s.aiKey && s.aiKey !== 'OPENCODE_GO_API_KEY' && s.aiKey !== 'OPENCODE_ZEN_API_KEY') {
        this._key = s.aiKey;
        this._mode = 'real';
      }
    } catch(e) {}
  },

  setKey(key) {
    if (key && key.trim()) {
      this._key = key.trim();
      this._mode = 'real';
      sessionStorage.setItem('estory_ai_key', this._key);
    }
  },

  setBaseUrl(url) { if (url) this._baseUrl = url; },
  setModel(model) { if (model) this._model = model; },

  async _call(messages, jsonMode = true) {
    if (this._mode !== 'real' || !this._key) {
      return this._demoResponse(messages);
    }

    try {
      const body = {
        model: this._model, messages,
        max_tokens: 1500, temperature: 0.3, stream: false
      };
      if (jsonMode) body.response_format = { type: 'json_object' };

      const res = await fetch(this._baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this._key
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100)}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response');

      return jsonMode ? JSON.parse(content) : content;
    } catch (e) {
      console.warn('AI call failed:', e.message);
      try { window.dispatchEvent(new CustomEvent('ai-error', { detail: e.message })); } catch(e2) {}
      return this._demoResponse(messages);
    }
  },

  async wordHint(word, sentence) {
    try {
      const r = await this._call([{ role: 'system', content: 'You are an English-Korean dictionary. Return JSON: { "word": "...", "meaningKo": "...", "partOfSpeech": "..." }' },
        { role: 'user', content: `Korean meaning of "${word}" in: "${sentence}"` }]);
      return r;
    } catch(e) { return { word, meaningKo: '(API 오류)', partOfSpeech: '' }; }
  },

  async grammarHint(sentence) {
    try {
      return await this._call([{ role: 'system', content: 'Return JSON: { "structure": "...", "keyPoints": [], "tense": "...", "clauseType": "..." }' },
        { role: 'user', content: `Explain grammar of: "${sentence}"` }]);
    } catch(e) { return { structure: '(API 오류)', keyPoints: [], tense: '', clauseType: '' }; }
  },

  async sentenceGist(sentence) {
    try {
      return await this._call([{ role: 'system', content: 'Return JSON: { "gistKo": "..." } — short Korean gist, no spoilers.' },
        { role: 'user', content: `Gist of: "${sentence}"` }]);
    } catch(e) { return { gistKo: '(API 연결을 확인해주세요)' }; }
  },

  async feedback(sentence, userTranslation, previousIssues = []) {
    return await this._call([{
      role: 'system',
      content: `You are an English tutor for a Korean learner reading a novel.

Rules:
- Give feedback in Korean. ONE issue per response.
- Focus: meaning > nuance/tone > grammar > naturalness.
- Do NOT reveal full translation unless finished.
- If translation is good enough, set status to "good_enough".
- If user fixed previous issue, move to next.
- 💡 Add l1InterferenceKo for Korean-typical mistakes.
- NEVER mention future events.

Return JSON: { "status": "needs_revision"|"good_enough"|"finished", "issueType": "meaning"|"grammar"|"tense"|"article"|"preposition"|"word_choice"|"structure"|"naturalness"|"idiom"|"nuance"|"tone"|"none", "feedbackKo": "", "hintKo": null, "l1InterferenceKo": null, "shouldShowModelTranslation": false, "literalTranslationKo": null, "naturalTranslationKo": null, "storyNoteKo": null }

When finished, include literalTranslationKo, naturalTranslationKo, storyNoteKo.`
    }, {
      role: 'user',
      content: JSON.stringify({ sentence, userTranslation, previousIssues })
    }]);
  },

  async storyBuddy(sentence, question, context) {
    try {
      return await this._call([{ role: 'system', content: 'Return JSON: { "answerKo": "..." } — Korean answer, NO spoilers.' },
        { role: 'user', content: JSON.stringify({ sentence, question, context }) }]);
    } catch(e) { return { answerKo: '(API 연결 오류)' }; }
  },

  async chapterSummary(text) {
    try {
      return await this._call([{ role: 'system', content: 'Return JSON: { "summary3lines": "", "characters": [], "keyScenes": [], "expressions": [], "studySentence": "" }' },
        { role: 'user', content: text.slice(0, 4000) }]);
    } catch(e) { return { summary3lines: '(API 오류)', characters: [], keyScenes: [], expressions: [] }; }
  },

  _demoResponse(messages) {
    const lastMsg = messages[messages.length - 1]?.content || '';
    if (lastMsg.includes('"userTranslation"')) {
      return {
        status: 'good_enough', issueType: 'none',
        feedbackKo: '⚙️ API 키를 설정에서 등록하면 AI 피드백을 받을 수 있습니다.',
        hintKo: null, l1InterferenceKo: null,
        shouldShowModelTranslation: true,
        literalTranslationKo: '설정 메뉴(⚙️)에서 API 키를 입력해주세요.',
        naturalTranslationKo: 'OpenCode Go / OpenAI 호환 API 키를 등록하면 실제 분석이 제공됩니다.',
        storyNoteKo: '설정에서 API URL, 모델명, 키를 입력하고 저장하세요.'
      };
    }
    return { gistKo: '설정에서 API 키를 등록해주세요.' };
  }
};
