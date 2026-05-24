/* E-Story AI Module — BYOK + Demo Mode */

const AI = {
  _key: '',
  _baseUrl: 'https://api.openai.com/v1',
  _model: 'gpt-4o-mini',
  _mode: 'demo',  // 'demo' | 'real'
  _storageMode: 'session',

  async init() {
    const s = await getSettings();
    this._baseUrl = s.aiBaseUrl || 'https://api.openai.com/v1';
    this._model = s.aiModel || 'gpt-4o-mini';
    this._storageMode = s.apiKeyStorageMode || 'session';
    
    if (this._storageMode === 'persist' && s.aiKey) {
      this._key = s.aiKey;
      this._mode = 'real';
    } else if (this._storageMode === 'session' && sessionStorage.getItem('estory_ai_key')) {
      this._key = sessionStorage.getItem('estory_ai_key');
      this._mode = 'real';
    }
  },

  setKey(key) {
    this._key = key;
    this._mode = key ? 'real' : 'demo';
    if (key && this._storageMode === 'session') {
      sessionStorage.setItem('estory_ai_key', key);
    }
  },

  setBaseUrl(url) { this._baseUrl = url; },
  setModel(model) { this._model = model; },

  async _call(messages, jsonMode = true) {
    if (this._mode === 'demo') return this._demoResponse(messages);
    
    try {
      const body = {
        model: this._model,
        messages,
        max_tokens: 1500,
        temperature: 0.3
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
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      return JSON.parse(data.choices[0].message.content);
    } catch(e) {
      console.warn('AI call failed, falling back to demo:', e.message);
      window.dispatchEvent(new CustomEvent('ai:demo-fallback', { detail: { message: e.message } }));
      return this._demoResponse(messages);
    }
  },

  /* ===== Hint Ladder ===== */
  async wordHint(word, sentence) {
    const msg = [{
      role: 'system',
      content: `You are an English-Korean dictionary. Return JSON: { "word": "...", "meaningKo": "...", "partOfSpeech": "...", "exampleInSentence": "...", "pronunciation": "..." }`
    }, {
      role: 'user',
      content: `Give me the Korean meaning and part of speech for the word "${word}" in this sentence: "${sentence}"`
    }];
    return await this._call(msg);
  },

  async grammarHint(sentence) {
    const msg = [{
      role: 'system',
      content: `You are an English grammar tutor for Korean learners. Return JSON: { "structure": "...", "keyPoints": ["..."], "tense": "...", "clauseType": "..." }`
    }, {
      role: 'user',
      content: `Explain the grammatical structure of this English sentence in Korean: "${sentence}"`
    }];
    return await this._call(msg);
  },

  async sentenceGist(sentence) {
    const msg = [{
      role: 'system',
      content: `You are a reading assistant. Give a SHORT gist of the sentence in Korean (1 sentence). Never translate fully. Never mention future events. Return JSON: { "gistKo": "..." }`
    }, {
      role: 'user',
      content: `What's the gist of this sentence? "${sentence}"`
    }];
    return await this._call(msg);
  },

  /* ===== One-Point Feedback ===== */
  async feedback(sentence, userTranslation, previousIssues = []) {
    const msg = [{
      role: 'system',
      content: `You are an English tutor for a Korean learner reading a novel.

Rules:
1. Give feedback in Korean.
2. Point out exactly ONE issue per response.
3. Focus on: meaning → nuance/tone → grammar → naturalness (in that order).
4. Do NOT reveal the full translation unless finishRequested.
5. If the translation is good enough, set status to "good_enough".
6. If the user fixed the previous issue, move to the next point.
7. 💡 If the mistake is typical for Korean learners, add l1InterferenceKo.
8. NEVER mention events that happen after the current sentence.

Return JSON only, with schema:
{
  "status": "needs_revision" | "good_enough" | "finished",
  "issueType": "meaning" | "grammar" | "tense" | "article" | "preposition" | "word_choice" | "structure" | "naturalness" | "idiom" | "nuance" | "tone" | "cultural_context" | "implied_meaning" | "none",
  "feedbackKo": "string",
  "hintKo": "string or null",
  "l1InterferenceKo": "string or null",
  "shouldShowModelTranslation": false,
  "literalTranslationKo": null,
  "naturalTranslationKo": null,
  "storyNoteKo": null
}

When finished, include literalTranslationKo (word-for-word), naturalTranslationKo (natural Korean), and storyNoteKo (context/nuance).`
    }, {
      role: 'user',
      content: JSON.stringify({
        sentence,
        userTranslation,
        previousIssues
      })
    }];
    return await this._call(msg);
  },

  /* ===== Story Buddy ===== */
  async storyBuddy(sentence, question, context) {
    const msg = [{
      role: 'system',
      content: `You are a reading buddy for a Korean learner. Answer in Korean. 
NEVER mention events that happen after the provided text. Use ONLY the provided context.
If you don't know for sure, say "현재까지의 내용만으로는 확실하지 않아요."
Return JSON: { "answerKo": "..." }`
    }, {
      role: 'user',
      content: JSON.stringify({ sentence, question, context })
    }];
    return await this._call(msg);
  },

  /* ===== Chapter Summary ===== */
  async chapterSummary(chapterText, previousSummary) {
    const msg = [{
      role: 'system',
      content: `Summarize this chapter in Korean for a learner. Return JSON:
{
  "summary3lines": "...",
  "characters": [{"name": "...", "change": "..."}],
  "keyScenes": ["..."],
  "expressions": [{"en": "...", "meaningKo": "..."}],
  "studySentence": "..."
}`
    }, {
      role: 'user',
      content: chapterText.slice(0, 4000)
    }];
    return await this._call(msg);
  },

  /* ===== Demo Mode ===== */
  _demoResponse(messages) {
    const lastMsg = messages[messages.length - 1]?.content || '';
    const isFeedback = lastMsg.includes('"userTranslation"');
    const isWordHint = lastMsg.includes('meaningKo');
    const isGist = lastMsg.includes('gistKo');
    const isGrammar = lastMsg.includes('grammatical structure');
    const isBuddy = lastMsg.includes('question');
    
    if (isFeedback) {
      return {
        status: 'good_enough',
        issueType: 'none',
        feedbackKo: '좋은 해석입니다! 의미가 잘 전달되었어요. (데모 모드)',
        hintKo: null,
        l1InterferenceKo: null,
        shouldShowModelTranslation: true,
        literalTranslationKo: '단어 단위 직역 예시입니다.',
        naturalTranslationKo: '자연스러운 한국어 해석 예시입니다.',
        storyNoteKo: 'AI 피드백을 사용하려면 설정에서 API 키를 등록해주세요.'
      };
    }
    if (isWordHint) {
      return { word: 'example', meaningKo: '예시', partOfSpeech: 'noun', exampleInSentence: 'I suggest using the demo', pronunciation: '/ɪɡˈzæmpəl/' };
    }
    if (isGist) {
      return { gistKo: '이 문장의 핵심 의미입니다. AI API 키를 설정하면 실제 분석을 받을 수 있어요.' };
    }
    if (isGrammar) {
      return { structure: '주어-동사-목적어 구조', keyPoints: ['기본 SVO 구조입니다'], tense: '현재형', clauseType: '단문' };
    }
    if (isBuddy) {
      return { answerKo: '죄송해요, 지금은 데모 모드입니다. 설정에서 AI API 키를 등록하면 Story Buddy 기능을 사용할 수 있어요.' };
    }
    return { status: 'finished', feedbackKo: '데모 모드에서는 실제 AI 분석이 제공되지 않습니다.' };
  }
};
