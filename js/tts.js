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
    // If no voices yet, try to reload them once
    if (!this._voices.length) {
      this._loadVoices();
      // If still empty after reload, schedule a retry
      if (!this._voices.length) {
        setTimeout(() => this._loadVoices(), 500);
      }
    }
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
    // M10: Debounced save via settings update
    clearTimeout(this._rateTimer);
    this._rateTimer = setTimeout(async () => {
      const settings = await getSettings();
      saveSettings({ ...settings, ttsRate: rate });
    }, 500); // debounce 500ms
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
    this._onDone = onDone;
    if (this._sentenceIndex >= this._sentences.length || !this._isReading) {
      this._isReading = false;
      if (onDone) onDone();
      return;
    }
    if (this._onSentenceEnd) this._onSentenceEnd(this._sentenceIndex);
    
    const text = this._sentences[this._sentenceIndex];
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = this._rate;
    const voice = this.getEnglishVoice();
    if (voice) u.voice = voice;
    this._currentUtterance = u;
    this._isPaused = false;
    
    // H2: Watchdog timer for Chrome's silent-stop bug (~15s+ utterances)
    // If onend doesn't fire within the estimated time + margin, force-advance.
    const estDuration = Math.max(3000, text.length * 80 / this._rate);
    clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      if (!this._isReading || this._isPaused) return;
      this._synth.cancel();
      this._sentenceIndex++;
      this._readNext(onDone);
    }, estDuration * 2);
    
    let ended = false;
    u.onend = () => {
      if (ended) return;
      ended = true;
      clearTimeout(this._watchdog);
      if (!this._isReading) return;
      this._sentenceIndex++;
      this._readNext(onDone);
    };
    u.onerror = () => {
      if (ended) return;
      ended = true;
      clearTimeout(this._watchdog);
      this._isReading = false;
      if (onDone) onDone();
    };
    this._synth.speak(u);
  },

  pause() {
    if (this._synth?.speaking && !this._synth.paused) {
      this._synth.pause();
      this._isPaused = true;
      clearTimeout(this._watchdog);
    }
  },

  resume() {
    if (this._synth?.paused) {
      this._synth.resume();
      this._isPaused = false;
      // Restart watchdog from resume point (use same generous estimate)
      if (this._currentUtterance) {
        const text = this._currentUtterance.text || '';
        const estDuration = Math.max(3000, text.length * 80 / this._rate);
        clearTimeout(this._watchdog);
        this._watchdog = setTimeout(() => {
          if (!this._isReading || this._isPaused) return;
          this._synth.cancel();
          this._sentenceIndex++;
          this._readNext(this._onDone);
        }, estDuration * 2);
      }
    }
  },

  stop() {
    if (this._synth) {
      this._synth.cancel();
      this._isReading = false;
      this._isPaused = false;
      this._currentUtterance = null;
      this._onSentenceEnd = null;
      this._onDone = null;
      this._sentences = [];
      this._sentenceIndex = 0;
      clearTimeout(this._watchdog);
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
