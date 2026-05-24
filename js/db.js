/* E-Story Database Module — IndexedDB via Dexie.js */

const DB = new Dexie('EStoryDB');

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

/* ===== Books ===== */
async function addBook(file, content) {
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
  const chunkIds = [];
  for (let i = 0; i < chunks.length; i++) {
    const cid = await DB.chunks.add({
      bookId: id, index: i, title: chunks[i].title || `Chapter ${i+1}`,
      content: chunks[i].text, startOffset: chunks[i].start, endOffset: chunks[i].end,
      createdAt: Date.now()
    });
    chunkIds.push(cid);
    // Split chunk into sentences
    const sents = splitSentences(chunks[i].text);
    for (let j = 0; j < sents.length; j++) {
      await DB.sentences.add({
        bookId: id, chunkId: cid, index: j,
        text: sents[j], startOffset: 0, endOffset: 0
      });
    }
  }
  await DB.books.update(id, { totalChunks: chunks.length, updatedAt: Date.now() });
  return id;
}

async function getBooks() {
  return await DB.books.reverse().sortBy('createdAt');
}

async function getBook(id) {
  return await DB.books.get(id);
}

async function updateBookProgress(id, chunk, offset) {
  await DB.books.update(id, { currentChunk: chunk, currentOffset: offset, updatedAt: Date.now() });
}

async function getChunks(bookId) {
  return await DB.chunks.where('bookId').equals(bookId).sortBy('index');
}

async function getSentences(chunkId) {
  return await DB.sentences.where('chunkId').equals(chunkId).sortBy('index');
}

function splitIntoChunks(text) {
  // Try chapter/section headings
  // Prologue/Epilogue도 포함, OCR 노이즈(파이프| 등) 허용, 목차 줄(숫자 여러개) 제외
  const chapterRegex = /(?:^|\n)(?:(?:CHAPTER|Chapter|chapter)\s+[\w\s,.!?'"|—–-]+|Prologue|ProLoGuE|Epilogue)(?:\n|$)/g;
  let matches = [...text.matchAll(chapterRegex)];
  
  // 필터: 목차 줄(챕터 숫자가 여러 개 포함된 줄) 제외
  matches = matches.filter(m => {
    const text = m[0];
    const chapterNums = text.match(/\d+/g);
    // 챕터 숫자가 2개 이상이면 목차 줄
    return !(chapterNums && chapterNums.length >= 2);
  });
  
  if (matches.length < 2) {
    // Fallback: split by double newlines into reasonable chunks
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 50);
    const chunkSize = Math.max(1, Math.floor(paragraphs.length / 10));
    const chunks = [];
    for (let i = 0; i < paragraphs.length; i += chunkSize) {
      chunks.push({
        title: `Page ${Math.floor(i/chunkSize) + 1}`,
        text: paragraphs.slice(i, i + chunkSize).join('\n\n'),
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

function splitSentences(text) {
  // Remove excessive whitespace
  text = text.replace(/\s+/g, ' ').trim();
  // Split by sentence-ending punctuation
  const raw = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [text];
  return raw.map(s => s.trim()).filter(s => s.length > 3);
}

/* ===== Vocabulary ===== */
async function addWord(word, meaning, sentence, bookId, sentenceId, scene) {
  const existing = await DB.vocabulary.where('word').equals(word.toLowerCase()).first();
  if (existing) return existing.id;
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
  let sessions = await DB.feedbackSessions.orderBy('createdAt').reverse().toArray();
  if (bookId) sessions = sessions.filter(s => s.bookId === bookId);
  return sessions.slice(0, 50);
}

/* ===== Settings ===== */
async function getSettings() {
  let s = await DB.settings.get(1);
  if (!s) {
    s = {
      id: 1, theme: 'dark', fontSize: 16, lineHeight: 1.9,
      ttsRate: 0.9, ttsVoice: '',
      aiProvider: '', aiBaseUrl: 'https://api.openai.com/v1',
      aiModel: 'gpt-4o-mini', aiKey: '', aiKeyMode: 'session',
      apiKeyStorageMode: 'session'
    };
    await DB.settings.put(s);
  }
  return s;
}

async function saveSettings(s) {
  s.id = 1;
  await DB.settings.put(s);
}

/* ===== Backup/Restore ===== */
async function exportData() {
  const data = {
    version: 2, exportedAt: new Date().toISOString(),
    books: await DB.books.toArray(),
    chunks: await DB.chunks.toArray(),
    sentences: await DB.sentences.toArray(),
    vocabulary: await DB.vocabulary.toArray(),
    feedbackSessions: await DB.feedbackSessions.toArray(),
    translationAttempts: await DB.translationAttempts.toArray(),
    studyQueue: await DB.studyQueue.toArray(),
    highlights: await DB.highlights.toArray(),
    settings: await DB.settings.toArray()
  };
  return JSON.stringify(data, null, 2);
}

async function importData(json) {
  const data = JSON.parse(json);
  // Validate structure before deleting
  const expectedTables = ['books','chunks','sentences','vocabulary','feedbackSessions','translationAttempts','studyQueue','highlights','settings'];
  for (const table of expectedTables) {
    if (data[table] !== undefined && !Array.isArray(data[table])) {
      throw new Error(`Invalid format: "${table}" is not an array`);
    }
  }
  if (!data.books?.length && !data.vocabulary?.length && !data.studyQueue?.length) {
    throw new Error('Invalid backup: no recognizable data found');
  }
  await DB.delete();
  await DB.open();
  for (const table of expectedTables) {
    if (data[table]?.length) await DB[table].bulkAdd(data[table]);
  }
}

/* ===== Helpers ===== */
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 1000); i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return h.toString(16);
}

function detectEncoding(text) {
  // Check for null bytes (UTF-16) or high ASCII patterns
  if (text.includes('\u0000')) return 'utf-16';
  return 'utf-8';
}
