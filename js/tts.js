/* E-Story TTS Module — Web Speech API */

const TTS = {
  _synth: null,
  _voices: [],
  _rate: 0.9,
  _currentUtterance: null,
  _isPaused: false,
  _isReading: false,
  _onSentenceEnd: null,
  _sentences: [],
  _sentenceIndex: 0,

  init() {
    this._synth = window.speechSynthesis;
    if (!this._synth) return false;
    this._loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => this._loadVoices();
    }
    // Restore settings
    getSettings().then(s => { this._rate = s.ttsRate || 0.9; });
    return true;
  },

  _loadVoices() {
    this._voices = this._synth.getVoices();
  },

  getEnglishVoice() {
    // Prefer Samantha on macOS, then any English voice
    const preferred = ['Samantha', 'Karen', 'Moira', 'Fiona', 'Google US English', 'Microsoft David', 'Microsoft Zira'];
    for (const name of preferred) {
      const found = this._voices.find(v => v.name.includes(name));
      if (found) return found;
    }
    return this._voices.find(v => v.lang?.startsWith('en')) || this._voices[0] || null;
  },

  async setRate(rate) {
    this._rate = rate;
    const settings = await getSettings();
    saveSettings({ ...settings, ttsRate: rate });
  },

  speakWord(word, callback) {
    if (!this._synth) return;
    this._synth.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = this._rate * 0.8;
    const voice = this.getEnglishVoice();
    if (voice) u.voice = voice;
    if (callback) u.onend = callback;
    this._synth.speak(u);
  },

  speakSentence(text, callback) {
    if (!this._synth) return;
    this._synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = this._rate;
    const voice = this.getEnglishVoice();
    if (voice) u.voice = voice;
    if (callback) u.onend = callback;
    this._currentUtterance = u;
    this._isPaused = false;
    this._synth.speak(u);
    this._isReading = true;
    u.onend = () => {
      this._isReading = false;
      if (callback) callback();
    };
  },

  startReading(sentences, startIndex, onSentenceChange, onDone) {
    if (!this._synth || !sentences.length) return;
    this.stop();
    this._sentences = sentences;
    this._sentenceIndex = startIndex;
    this._onSentenceEnd = onSentenceChange;
    this._isReading = true;
    this._readNext(onDone);
  },

  _readNext(onDone) {
    if (this._sentenceIndex >= this._sentences.length || !this._isReading) {
      this._isReading = false;
      if (onDone) onDone();
      return;
    }
    if (this._onSentenceEnd) this._onSentenceEnd(this._sentenceIndex);
    
    const u = new SpeechSynthesisUtterance(this._sentences[this._sentenceIndex]);
    u.lang = 'en-US';
    u.rate = this._rate;
    const voice = this.getEnglishVoice();
    if (voice) u.voice = voice;
    this._currentUtterance = u;
    this._isPaused = false;
    
    u.onend = () => {
      if (!this._isReading) return;
      this._sentenceIndex++;
      this._readNext(onDone);
    };
    u.onerror = () => {
      this._isReading = false;
      if (onDone) onDone();
    };
    this._synth.speak(u);
  },

  pause() {
    if (this._synth?.speaking && !this._synth.paused) {
      this._synth.pause();
      this._isPaused = true;
    }
  },

  resume() {
    if (this._synth?.paused) {
      this._synth.resume();
      this._isPaused = false;
    }
  },

  stop() {
    if (this._synth) {
      this._synth.cancel();
      this._isReading = false;
      this._isPaused = false;
    }
  },

  isSpeaking() {
    return this._synth?.speaking || false;
  },

  getStatus() {
    if (this._isReading) return this._isPaused ? 'paused' : 'playing';
    return 'stopped';
  }
};
