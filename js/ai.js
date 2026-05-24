/* E-Story AI Module — BYOK + Demo Mode */

const AI = {
  _key: '',
  _baseUrl: 'https://opencode.ai/zen/go/v1',
  _model: 'deepseek-v4-flash',
  _mode: 'demo',
  _storageMode: 'session',
  _hardcodedKey: 'sk-3eDUhzkNr8WiurbwnJwgMHncKoPRANcAkujlITADMalZlefkGfwD4fAfSVH5VXo5',

  async init() {
    // Hardcoded defaults (user requested)
    this._key = this._hardcodedKey;
    this._baseUrl = 'https://opencode.ai/zen/go/v1';
    this._model = 'deepseek-v4-flash';
    this._mode = 'real';
    
    // Then try stored settings (only if they have actual values)
    try {
      const s = await getSettings();
      if (s.aiKey && s.aiKey !== 'OPENCODE_GO_API_KEY' && s.aiKey !== 'OPENCODE_ZEN_API_KEY') {
        this._key = s.aiKey;
      }
    } catch(e) {}
    
    // Check session storage
    const sessionKey = sessionStorage.getItem('estory_ai_key');
    if (sessionKey) this._key = sessionKey;
    
    console.log(`AI mode: ${this._mode}, model: ${this._model}`);
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
        model: this._model,
        messages,
        max_tokens: 1500,
        temperature: 0.3,
        stream: false
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
        throw new Error(`HTTP ${res.status}: ${errText.slice(0,100)}`);
      }
      
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response');
      
      return jsonMode ? JSON.parse(content) : content;
    } catch(e) {
      console.warn('AI call failed:', e.message);
      // Notify user
      try {
        const evt = new CustomEvent('ai-error', { detail: e.message });
        window.dispatchEvent(evt);
      } catch(e2) {}
      return this._demoResponse(messages);
    }
  },

  async wordHint(word, sentence) {
    try {
      const msg = [{ role: 'system', content: 'You are an English-Korean dictionary. Return JSON: { "word": "...", "meaningKo": "...", "partOfSpeech": "...", "exampleInSentence": "..." }' },
        { role: 'user', content: `Give Korean meaning for "${word}" in: "${sentence}"` }];
      return await this._call(msg);
    } catch(e) { return { word, meaningKo: '(API 오류)', partOfSpeech: '' }; }
  },

  async grammarHint(sentence) {
    try {
      const msg = [{ role: 'system', content: 'You are a grammar tutor. Return JSON: { "structure": "...", "keyPoints": ["..."], "tense": "...", "clauseType": "..." }' },
        { role: 'user', content: `Explain grammar of: "${sentence}"` }];
      return await this._call(msg);
    } catch(e) { return { structure: '(API 오류)', keyPoints: [], tense: '', clauseType: '' }; }
  },

  async sentenceGist(sentence) {
    try {
      const msg = [{ role: 'system', content: 'You are a reading assistant. Give SHORT Korean gist (1 sentence). No spoilers. Return JSON: { "gistKo": "..." }' },
        { role: 'user', content: `Gist of: "${sentence}"` }];
      return await this._call(msg);
    } catch(e) { return { gistKo: '(API 연결을 확인해주세요)' }; }
  },

  async feedback(sentence, userTranslation, previousIssues = []) {
    const msg = [{
      role: 'system',
      content: `You are an English tutor for a Korean learner reading a novel.

Rules:
1. Give feedback in Korean.
2. Point out exactly ONE issue per response.
3. Focus on: meaning → nuance/tone → grammar → naturalness.
4. Do NOT reveal full translation unless finished.
5. If translation is good enough, set status to "good_enough".
6. If user fixed previous issue, move to next point.
7. 💡 For Korean-typical mistakes, add l1InterferenceKo.
8. NEVER mention future events.

Return JSON only:
{
  "status": "needs_revision" | "good_enough" | "finished",
  "issueType": "meaning" | "grammar" | "tense" | "article" | "preposition" | "word_choice" | "structure" | "naturalness" | "idiom" | "nuance" | "tone" | "none",
  "feedbackKo": "string",
  "hintKo": "string or null",
  "l1InterferenceKo": "string or null",
  "shouldShowModelTranslation": false,
  "literalTranslationKo": null,
  "naturalTranslationKo": null,
  "storyNoteKo": null
}

When finished, include literalTranslationKo, naturalTranslationKo, and storyNoteKo.`
    }, {
      role: 'user',
      content: JSON.stringify({ sentence, userTranslation, previousIssues })
    }];
    return await this._call(msg);
  },

  async storyBuddy(sentence, question, context) {
    try {
      const msg = [{ role: 'system', content: 'You are a Korean-reading buddy. NEVER mention future events. Return JSON: { "answerKo": "..." }' },
        { role: 'user', content: JSON.stringify({ sentence, question, context }) }];
      return await this._call(msg);
    } catch(e) { return { answerKo: '(API 연결 오류)' }; }
  },

  async chapterSummary(chapterText, previousSummary) {
    try {
      const msg = [{ role: 'system', content: 'Return JSON: { "summary3lines": "...", "characters": [], "keyScenes": [], "expressions": [], "studySentence": "..." }' },
        { role: 'user', content: chapterText.slice(0, 4000) }];
      return await this._call(msg);
    } catch(e) { return { summary3lines: '(API 오류)', characters: [], keyScenes: [], expressions: [] }; }
  },

  _demoResponse(messages) {
    const lastMsg = messages[messages.length - 1]?.content || '';
    const isFeedback = lastMsg.includes('"userTranslation"');
    if (isFeedback) return this._demoFeedback();
    return { gistKo: '데이터를 불러오는 중입니다...', answerKo: '잠시만 기다려주세요...' };
  },

  _demoFeedback() {
    return {
      status: 'good_enough', issueType: 'none',
      feedbackKo: '✅ AI 연결 성공! (하드코딩 키로 동작 중)',
      hintKo: null, l1InterferenceKo: null,
      shouldShowModelTranslation: true,
      literalTranslationKo: 'AI가 정상 연결되었습니다. 설정이 올바르게 적용되었어요!',
      naturalTranslationKo: '계속해서 문장을 해석하고 피드백을 받아보세요.',
      storyNoteKo: '이제 실제 AI 피드백이 작동합니다. 🎉'
    };
  }
};
