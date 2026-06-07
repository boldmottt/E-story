/* E-Story Database Module — IndexedDB via Dexie.js */
/* v2: Schema versioning, cascade delete, settings sync support */

const DB = new Dexie('EStoryDB');

// H6: Proper schema versioning with upgrade paths
DB.version(1).stores({
  books: '++id, title',
  chunks: '++id, bookId, index',
  sentences: '++id, bookId, chunkId, index',
  vocabulary: '++id, word, bookId'
});

DB.version(2).stores({
  books: '++id, title, fileName, createdAt',
  chunks: '++id, bookId, index',
  sentences: '++id, bookId, chunkId, index',
  feedbackSessions: '++id, bookId, sentenceId, createdAt',
  translationAttempts: '++id, sessionId, attemptNo',
  vocabulary: '++id, word, bookId, status, nextReview, reviewBox',
  studyQueue: '++id, bookId, status, createdAt',
  highlights: '++id, bookId, sentenceId',
  storyMemories: '++id, bookId',
  readingSessions: '++id, bookId, startedAt',
  settings: '++id'
});

DB.version(3).stores({
  structureSessions: '++id, bookId, chunkId, score, createdAt',
  structureTokens: '++id, sessionId, bookId, correctRole, isCorrect'
});

/* ===== Books ===== */
async function addBook(file, content) {
  // Strip .txt extension, remove _djvu suffix (legacy DjVu source residue), then convert underscores to spaces
  const title = file.name.replace(/\.txt$/i, '').replace(/_djvu$/, '').replace(/_/g, ' ');
  const id = await DB.books.add({
    title, fileName: file.name,
    sourceHash: simpleHash(content),
    encoding: detectEncoding(content),
    totalChunks: 0, currentChunk: 0, currentOffset: 0,
    createdAt: Date.now(), updatedAt: Date.now()
  });
  // Split into chunks (chapters/sections)
  const chunks = splitIntoChunks(content);

  // H2/M9: Use bulkAdd for sentences instead of serial adds
  const allSentences = [];
  let wordCount = 0;
  let longSentenceCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const cid = await DB.chunks.add({
      bookId: id, index: i, title: chunks[i].title || `Chapter ${i+1}`,
      content: chunks[i].text, startOffset: chunks[i].start, endOffset: chunks[i].end,
      createdAt: Date.now()
    });
    // Split chunk into sentences
    const sents = splitSentences(chunks[i].text);
    for (let j = 0; j < sents.length; j++) {
      const words = sents[j].text.split(/\s+/).filter(Boolean).length;
      wordCount += words;
      if (words > 25) longSentenceCount++;
      allSentences.push({
        bookId: id, chunkId: cid, index: j,
        text: sents[j].text, para: sents[j].para, startOffset: 0, endOffset: 0
      });
    }
  }

  // Bulk add all sentences at once (M9 fix)
  if (allSentences.length) {
    // Split into chunks of 500 to avoid write limits
    for (let i = 0; i < allSentences.length; i += 500) {
      await DB.sentences.bulkAdd(allSentences.slice(i, i + 500));
    }
  }

  const sentenceCount = allSentences.length;
  // Local difficulty stats (non-indexed fields; no schema bump needed).
  // CEFR/band are filled in lazily on first open via AI.analyzeDifficulty.
  await DB.books.update(id, {
    totalChunks: chunks.length,
    wordCount,
    sentenceCount,
    avgSentenceLen: sentenceCount ? Math.round(wordCount / sentenceCount) : 0,
    longSentenceRatio: sentenceCount ? +(longSentenceCount / sentenceCount).toFixed(2) : 0,
    updatedAt: Date.now()
  });
  return id;
}

async function getBooks() {
  return await DB.books.reverse().sortBy('createdAt');
}

async function getBook(id) {
  return await DB.books.get(id);
}

async function updateBookProgress(id, chunk, offset, page) {
  await DB.books.update(id, { currentChunk: chunk, currentOffset: offset, currentPage: page ?? 0, updatedAt: Date.now() });
}

async function updateReadingProgress(id, pct) {
  await DB.books.update(id, { readingProgress: pct, updatedAt: Date.now() });
}

async function updateBook(id, fields) {
  await DB.books.update(id, { ...fields, updatedAt: Date.now() });
}

// H4: Delete book with full cascade
async function deleteBook(id) {
  await DB.transaction('rw', 
    [DB.books, DB.chunks, DB.sentences, DB.feedbackSessions, DB.translationAttempts, 
     DB.vocabulary, DB.studyQueue, DB.highlights, DB.storyMemories, DB.readingSessions],
    async () => {
      // Delete all related data
      await DB.chunks.where('bookId').equals(id).delete();
      await DB.sentences.where('bookId').equals(id).delete();
      await DB.feedbackSessions.where('bookId').equals(id).delete();
      // Cascade delete translationAttempts via sessionIds
      const sessions = await DB.feedbackSessions.where('bookId').equals(id).toArray();
      for (const s of sessions) {
        await DB.translationAttempts.where('sessionId').equals(s.id).delete();
      }
      await DB.vocabulary.where('bookId').equals(id).delete();
      await DB.studyQueue.where('bookId').equals(id).delete();
      await DB.highlights.where('bookId').equals(id).delete();
      await DB.storyMemories.where('bookId').equals(id).delete();
      await DB.readingSessions.where('bookId').equals(id).delete();
      // Finally delete the book
      await DB.books.delete(id);
    }
  );
}

async function getChunks(bookId) {
  return await DB.chunks.where('bookId').equals(bookId).sortBy('index');
}

async function getSentences(chunkId) {
  return await DB.sentences.where('chunkId').equals(chunkId).sortBy('index');
}

// L5: Better chunk split — use character count not fixed 10 parts
function splitIntoChunks(text) {
  // Try chapter/section headings (case-insensitive). Must start a line.
  // Covers: "Chapter 1", "CHAPTER IV: ...", "Part One", "PART 2", "Book I",
  // and standalone front/back-matter headings.
  const chapterRegex = /(?:^|\n)[ \t]*(?:(?:chapter|part|book)\s+[\w][^\n]{0,60}|prologue|epilogue|introduction|preface|foreword)[ \t]*(?=\n|$)/gi;
  let matches = [...text.matchAll(chapterRegex)];
  
  // Filter out table of contents lines (multiple numbers)
  matches = matches.filter(m => {
    const t = m[0];
    const nums = t.match(/\d+/g);
    return !(nums && nums.length >= 2);
  });
  
  if (matches.length < 2) {
    // Fallback: split by ~5000 chars instead of 10 equal parts (L5 fix)
    const chunkSize = 5000;
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push({
        title: `Page ${Math.floor(i/chunkSize) + 1}`,
        text: text.slice(i, i + chunkSize),
        start: i, end: i + chunkSize
      });
    }
    return chunks.length ? chunks : [{ title: 'Content', text, start: 0, end: 1 }];
  }
  
  const chunks = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i+1].index : text.length;
    const title = matches[i][0].trim();
    const chunkText = text.slice(start, end).trim();
    if (chunkText.length > 20) {
      chunks.push({ title, text: chunkText, start, end });
    }
  }
  return chunks.length ? chunks : [{ title: 'Content', text, start: 0, end: 1 }];
}

// M2: Robust sentence splitter that PRESERVES paragraph structure.
// Returns [{ text, para }] — `para` is the 0-based paragraph index so the
// reader can render real <p> breaks instead of one wall of text.
function splitSentences(text) {
  const abbreviations = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Capt|Col|Gen|Lt|Sgt|Vol|Dept|Ave|Blvd|Rd)\.\s/g;

  // Split on blank-line OR single-line breaks first — these are paragraph boundaries.
  const paragraphs = text.split(/\n+/);
  const out = [];
  let paraIndex = 0;

  for (const rawPara of paragraphs) {
    const para = rawPara.replace(/\s+/g, ' ').trim();
    if (!para) continue;

    const protectedText = para.replace(abbreviations, (m) => m.replace('.', '<<<DOT>>>'));
    const raw = protectedText.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [protectedText];
    const sents = raw
      .map(s => s.replace(/<<<DOT>>>/g, '.').trim())
      .filter(s => s.length > 3);

    if (!sents.length) continue;
    for (const s of sents) out.push({ text: s, para: paraIndex });
    paraIndex++;
  }

  return out;
}

/* ===== Vocabulary ===== */

// Count NEW vocabulary cards added since local midnight. addedAt isn't indexed,
// so filter in memory — fine at local single-user scale (avoids a schema bump).
async function countCardsAddedToday() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const startTs = start.getTime();
  return await DB.vocabulary.filter(v => (v.addedAt || 0) >= startTs).count();
}

// Returns the card id on success. When the daily cap is reached for a GENUINELY
// new card, returns { blocked:true, cap } so the UI can hard-stop the add.
// Re-adding an existing word is never blocked (dedup path).
async function addWord(word, meaning, sentence, bookId, sentenceId, scene) {
  const existing = await DB.vocabulary.where({word: word.toLowerCase(), bookId: bookId}).first();
  if (existing) return existing.id;

  const settings = await getSettings();
  const cap = settings.dailyCardCap ?? 5;
  if (cap > 0 && (await countCardsAddedToday()) >= cap) {
    return { blocked: true, cap };
  }

  return await DB.vocabulary.add({
    word: word.toLowerCase(), lemma: word.toLowerCase(), meaningKo: meaning,
    definitionEn: '', partOfSpeech: '', pronunciation: '', audioUrl: '',
    contextSentence: sentence, sceneNote: scene || '', characterNames: '', tone: '',
    sentenceId: sentenceId || 0, bookId,
    status: 'new', reviewBox: 0, nextReview: Date.now(),
    addedAt: Date.now(), updatedAt: Date.now()
  });
}

async function getVocabulary(bookId) {
  if (bookId) return await DB.vocabulary.where('bookId').equals(bookId).sortBy('addedAt');
  return await DB.vocabulary.orderBy('addedAt').reverse().toArray();
}

async function getVocabForReview(limit = 10) {
  const now = Date.now();
  const due = await DB.vocabulary.where('nextReview').belowOrEqual(now).toArray();
  return due.sort((a, b) => a.nextReview - b.nextReview).slice(0, limit);
}

// Count cards due for review now (review debt). Used for the sidebar badge and
// the "review-first" nudge when debt piles up.
async function countDueReviews() {
  return await DB.vocabulary.where('nextReview').belowOrEqual(Date.now()).count();
}

async function updateVocabStatus(id, status) {
  const boxMap = { 'new': 0, 'learning': 1, 'known': 3 };
  const intervalMap = [0, 1, 3, 7]; // days
  const box = boxMap[status] || 0;
  const days = intervalMap[Math.min(box, 3)];
  const next = new Date(Date.now() + days * 86400000).getTime();
  await DB.vocabulary.update(id, { status, reviewBox: box, nextReview: next, updatedAt: Date.now() });
}

/* ===== Study Queue ===== */
async function addToQueue(bookId, sentenceId, text, reason = 'sentence') {
  return await DB.studyQueue.add({
    bookId, sentenceId, text, reason,
    status: 'pending', createdAt: Date.now()
  });
}

async function getQueue() {
  return await DB.studyQueue.where('status').equals('pending').sortBy('createdAt');
}

async function markQueueDone(id) {
  await DB.studyQueue.update(id, { status: 'reviewed', reviewedAt: Date.now() });
}

async function getQueueCount() {
  return await DB.studyQueue.where('status').equals('pending').count();
}

/* ===== Highlights (마음에 든 문장 저장) ===== */
async function addHighlight(bookId, sentenceId, text, bookTitle) {
  return await DB.highlights.add({
    bookId, sentenceId, text, bookTitle: bookTitle || '',
    note: '', tags: [], createdAt: Date.now(), updatedAt: Date.now()
  });
}

async function getHighlights() {
  return await DB.highlights.reverse().sortBy('createdAt');
}

async function deleteHighlight(id) {
  await DB.highlights.delete(id);
}

/* ===== Reading Sessions (help-dependency logging) =====
 * North Star: 도움 의존도 감소. We log how much help the reader leans on
 * (dictionary lookups, Korean translations, hint-ladder steps) per session so
 * reports can later show whether dependency is dropping over time. */
async function startReadingSession(bookId, chunkIndex) {
  return await DB.readingSessions.add({
    bookId, chunkIndex,
    startedAt: Date.now(),
    dictionaryClicks: 0, translationClicks: 0, helpStepsUsed: 0,
    endChunk: null, wordsRead: 0, endedAt: null
  });
}

async function bumpSessionCounter(sessionId, type) {
  if (!sessionId) return;
  if (!['dictionaryClicks', 'translationClicks', 'helpStepsUsed'].includes(type)) return;
  const row = await DB.readingSessions.get(sessionId);
  if (!row) return;
  await DB.readingSessions.update(sessionId, { [type]: (row[type] || 0) + 1 });
}

async function endReadingSession(sessionId, endChunk, wordsRead) {
  if (!sessionId) return;
  await DB.readingSessions.update(sessionId, {
    endChunk, wordsRead: wordsRead || 0, endedAt: Date.now()
  });
}

// Estimate reading speed (words/min) from finished sessions of plausible
// duration. Returns null when there isn't enough data (caller uses a default).
async function getReadingSpeed() {
  const sessions = await DB.readingSessions.toArray();
  let words = 0, minutes = 0;
  for (const s of sessions) {
    if (!s.endedAt || !s.startedAt || !s.wordsRead) continue;
    const mins = (s.endedAt - s.startedAt) / 60000;
    if (mins < 0.5 || mins > 120) continue; // ignore idle/abandoned sessions
    words += s.wordsRead;
    minutes += mins;
  }
  if (words < 300 || minutes <= 0) return null;
  return Math.round(words / minutes);
}

// Aggregate reading sessions into help-dependency stats. North Star: the rate
// of help (dictionary + translation + hint steps) per 1000 words read should
// fall over time. Returns today, this-week, and last-week buckets + a trend.
async function getDependencyStats() {
  const sessions = await DB.readingSessions.toArray();
  const now = Date.now();
  const DAY = 86400000;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const todayTs = startOfToday.getTime();
  const weekTs = now - 7 * DAY;
  const prevWeekTs = now - 14 * DAY;

  const empty = () => ({ words: 0, dict: 0, trans: 0, help: 0, sessions: 0 });
  const add = (b, s) => {
    b.words += s.wordsRead || 0;
    b.dict += s.dictionaryClicks || 0;
    b.trans += s.translationClicks || 0;
    b.help += s.helpStepsUsed || 0;
    b.sessions += 1;
  };
  const rate = b => b.words > 0 ? +(((b.dict + b.trans + b.help) / b.words) * 1000).toFixed(1) : 0;

  const today = empty(), week = empty(), prevWeek = empty(), all = empty();
  for (const s of sessions) {
    const t = s.startedAt || 0;
    add(all, s);
    if (t >= todayTs) add(today, s);
    if (t >= weekTs) add(week, s);
    else if (t >= prevWeekTs) add(prevWeek, s);
  }

  const weekRate = rate(week), prevRate = rate(prevWeek);
  let trend = 'flat';
  if (prevWeek.sessions > 0 && week.sessions > 0) {
    if (weekRate < prevRate) trend = 'down';      // good: less dependency
    else if (weekRate > prevRate) trend = 'up';   // more dependency
  } else trend = 'new';

  return {
    today: { ...today, rate: rate(today) },
    week: { ...week, rate: weekRate },
    prevWeek: { ...prevWeek, rate: prevRate },
    all: { ...all, rate: rate(all) },
    trend
  };
}

/* ===== Feedback ===== */
async function saveFeedbackSession(bookId, sentenceId, originalSentence, attempts, finalTranslation, literal, natural, storyNote) {
  const sid = await DB.feedbackSessions.add({
    bookId, sentenceId, originalSentence,
    status: 'finished', finalUserTranslation: finalTranslation,
    literalTranslation: literal, naturalTranslation: natural,
    storyNote, createdAt: Date.now(), updatedAt: Date.now()
  });
  for (let i = 0; i < attempts.length; i++) {
    await DB.translationAttempts.add({
      sessionId: sid, attemptNo: i + 1,
      ...attempts[i], createdAt: Date.now()
    });
  }
  return sid;
}

async function getFeedbackHistory(bookId) {
  let query = DB.feedbackSessions.orderBy('createdAt').reverse();
  if (bookId) query = query.filter(s => s.bookId === bookId);
  return query.limit(50).toArray();
}

/* ===== Settings (with extended defaults for C5 restore) ===== */
// Fixed defaults: DeepSeek official API. User only needs to enter their key.
const DEFAULT_AI_URL_REMOTE = 'https://api.deepseek.com';
const DEFAULT_AI_MODEL_REMOTE = 'deepseek-v4-flash';
const DEFAULT_AI_URL_LOCAL = '/api/zen/go/v1';
const DEFAULT_AI_MODEL_LOCAL = 'deepseek-v4-flash';

async function getSettings() {
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  let s = await DB.settings.get(1);
  if (!s) {
    s = {
      id: 1, theme: 'dark', fontSize: 16, lineHeight: 1.9,
      ttsRate: 0.9, ttsVoice: '',
      aiProvider: '',
      aiBaseUrl: isLocal ? DEFAULT_AI_URL_LOCAL : DEFAULT_AI_URL_REMOTE,
      aiModel: isLocal ? DEFAULT_AI_MODEL_LOCAL : DEFAULT_AI_MODEL_REMOTE,
      aiKey: '', aiKeyMode: 'persist',
      apiKeyStorageMode: 'persist',
      aiPinDefaults: true,
      dailyCardCap: 5,
      lastOpenedBookId: null, lastView: 'bookshelf'
    };
    await DB.settings.put(s);
  } else if (s.aiPinDefaults !== false) {
    // Pinned defaults — keep URL/model locked to the latest baseline,
    // regardless of legacy values. User's key is preserved.
    const targetUrl = isLocal ? DEFAULT_AI_URL_LOCAL : DEFAULT_AI_URL_REMOTE;
    const targetModel = isLocal ? DEFAULT_AI_MODEL_LOCAL : DEFAULT_AI_MODEL_REMOTE;
    if (s.aiBaseUrl !== targetUrl || s.aiModel !== targetModel) {
      s.aiBaseUrl = targetUrl;
      s.aiModel = targetModel;
      await DB.settings.put(s);
    }
    if (!s.aiKeyMode) s.aiKeyMode = 'persist';
  }
  return s;
}

async function saveSettings(s) {
  s.id = 1;
  await DB.settings.put(s);
}

/* ===== Backup/Restore ===== */
const EXPORT_TABLES = ['books','chunks','sentences','vocabulary','feedbackSessions','translationAttempts','studyQueue','highlights','settings','structureSessions','structureTokens'];

async function exportData() {
  const entries = await Promise.all(EXPORT_TABLES.map(name => DB[name].toArray().then(rows => [name, rows])));
  const data = {
    version: 2, exportedAt: new Date().toISOString(),
    ...Object.fromEntries(entries)
  };
  return JSON.stringify(data, null, 2);
}

async function importData(json) {
  const data = JSON.parse(json);
  // Validate structure before deleting
  for (const table of EXPORT_TABLES) {
    if (data[table] !== undefined && !Array.isArray(data[table])) {
      throw new Error(`Invalid format: "${table}" is not an array`);
    }
  }
  if (!data.books?.length && !data.vocabulary?.length && !data.studyQueue?.length) {
    throw new Error('Invalid backup: no recognizable data found');
  }
  await DB.delete();
  await DB.open();
  for (const table of EXPORT_TABLES) {
    if (data[table]?.length) await DB[table].bulkAdd(data[table]);
  }
}

/* ===== Helpers ===== */
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return h.toString(16);
}

function detectEncoding(text) {
  if (text.includes('\u0000')) return 'utf-16';
  return 'utf-8';
}

// M6: Update word meaning via AI
async function fetchWordMeaning(word, sentence) {
  try {
    // Try AI first
    const hint = await AI.wordHint(word, sentence);
    if (hint && hint.meaningKo && !hint.error) {
      return hint.meaningKo;
    }
  } catch(e) {}
  return '(뜻을 불러오는 중...)';
}

/* ===== Structure Analysis ===== */

async function addStructureSession(sessionData) {
  const record = {
    bookId: sessionData.bookId,
    chunkId: sessionData.chunkId,
    sentenceIndex: sessionData.sentenceIndex,
    sentenceText: sessionData.sentenceText,
    score: sessionData.score,
    hitCount: sessionData.hitCount,
    labeledCount: sessionData.labeledCount,
    tokenCount: sessionData.tokenCount,
    createdAt: Date.now()
  };
  return await DB.structureSessions.add(record);
}

async function addStructureTokens(sessionId, bookId, tokens) {
  if (!tokens || !tokens.length) return;
  const rows = tokens.map(t => ({
    sessionId,
    bookId,
    token: t.token,
    mineRole: t.mineRole,
    correctRole: t.correctRole,
    isCorrect: t.isCorrect ? 1 : 0,
    createdAt: Date.now()
  }));
  await DB.structureTokens.bulkAdd(rows);
}

async function getStructureStats(bookId) {
  let sessions;
  if (bookId) {
    sessions = await DB.structureSessions.where('bookId').equals(bookId).toArray();
  } else {
    sessions = await DB.structureSessions.toArray();
  }
  if (!sessions.length) {
    return { totalSessions: 0, avgScore: 0, totalTokens: 0, correctTokens: 0, accuracy: 0 };
  }
  const totalSessions = sessions.length;
  const avgScore = Math.round(sessions.reduce((s, row) => s + row.score, 0) / totalSessions);
  const totalTokens = sessions.reduce((s, row) => s + (row.tokenCount || 0), 0);
  const correctTokens = sessions.reduce((s, row) => s + (row.hitCount || 0), 0);
  const accuracy = totalTokens > 0 ? Math.round((correctTokens / totalTokens) * 100) / 100 : 0;
  return { totalSessions, avgScore, totalTokens, correctTokens, accuracy };
}

async function getStructureRoleAccuracy(bookId) {
  let tokens;
  if (bookId) {
    tokens = await DB.structureTokens.where('bookId').equals(bookId).toArray();
  } else {
    tokens = await DB.structureTokens.toArray();
  }
  if (!tokens.length) return {};
  const groups = {};
  for (const t of tokens) {
    const role = t.correctRole || 'unknown';
    if (!groups[role]) groups[role] = { total: 0, correct: 0 };
    groups[role].total++;
    if (t.isCorrect) groups[role].correct++;
  }
  for (const role of Object.keys(groups)) {
    groups[role].accuracy = Math.round((groups[role].correct / groups[role].total) * 100) / 100;
  }
  return groups;
}

/* ===== Proficiency diagnosis aggregators ===== */

// Aggregate translation-practice issue types across all attempts. Tells us which
// kinds of mistakes (grammar/tense/article/preposition/word_choice/...) the
// learner makes most often when producing translations. 'none' isn't counted.
async function getTranslationIssueStats() {
  const attempts = await DB.translationAttempts.toArray();
  const counts = {};
  let scored = 0;
  for (const a of attempts) {
    const t = a.issueType;
    if (!t || t === 'none') continue;
    counts[t] = (counts[t] || 0) + 1;
    scored++;
  }
  return { total: attempts.length, scored, counts };
}

// Vocabulary status distribution + a rough mastery signal. knownRatio is the
// share of cards moved to 'known'; learning counts partially toward mastery.
async function getVocabLevelStats() {
  const all = await DB.vocabulary.toArray();
  const dist = { new: 0, learning: 0, known: 0 };
  for (const v of all) dist[v.status] = (dist[v.status] || 0) + 1;
  const total = all.length;
  const knownRatio = total ? +(dist.known / total).toFixed(2) : 0;
  return { total, ...dist, knownRatio };
}

// Total count of "learning activities" the learner has accumulated. Used to
// decide when a cached AI diagnosis is stale enough to be worth re-running.
// Counts cheap things (sessions, vocab cards, attempts, structure tokens).
async function getActivityCount() {
  const [vocab, sessions, attempts, structTokens] = await Promise.all([
    DB.vocabulary.count(),
    DB.readingSessions.count(),
    DB.translationAttempts.count(),
    DB.structureTokens.count()
  ]);
  return vocab + sessions + attempts + structTokens;
}

// Bundle every learning signal we have into one object for the proficiency
// diagnosis view. Pure aggregation — scoring/interpretation happens in app.js
// so it can run offline (demo mode) without an AI call.
async function getProficiencySignals() {
  const [vocab, structure, roleAcc, transIssues, dependency, speed, books] = await Promise.all([
    getVocabLevelStats(),
    getStructureStats(),
    getStructureRoleAccuracy(),
    getTranslationIssueStats(),
    getDependencyStats(),
    getReadingSpeed(),
    getBooks()
  ]);
  // CEFR distribution of books. Two buckets: every difficulty-assessed book
  // (cefrCounts) and books the learner has actually read into meaningfully
  // (engagedCefr, readingProgress ≥ 0.1). The diagnosis uses engagedCefr to
  // avoid CEFR inflation from "just added but not read" books.
  const cefrCounts = {}, engagedCefr = {};
  for (const b of books) {
    if (!b.estimatedCefr) continue;
    cefrCounts[b.estimatedCefr] = (cefrCounts[b.estimatedCefr] || 0) + 1;
    if ((b.readingProgress || 0) >= 0.1) {
      engagedCefr[b.estimatedCefr] = (engagedCefr[b.estimatedCefr] || 0) + 1;
    }
  }
  return { vocab, structure, roleAcc, transIssues, dependency, speed, cefrCounts, engagedCefr };
}
