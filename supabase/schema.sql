-- ============================================================
-- E-Story Supabase Schema v1
-- 모든 테이블은 user_id(auth.users) 기준으로 파티셔닝
-- id는 UUID v4 (클라이언트 생성, 양방향 sync 충돌 방지)
-- soft delete 지원 (deleted_at)
-- ============================================================

-- 1. books
CREATE TABLE books (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file_name TEXT,
  source_hash TEXT,
  encoding TEXT DEFAULT 'utf-8',
  total_chunks INTEGER DEFAULT 0,
  current_chunk INTEGER DEFAULT 0,
  current_offset INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_books_user_id ON books(user_id);
CREATE INDEX idx_books_user_updated ON books(user_id, updated_at);

-- 2. chunks
CREATE TABLE chunks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  start_offset INTEGER DEFAULT 0,
  end_offset INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_chunks_user_id ON chunks(user_id);
CREATE INDEX idx_chunks_book_id ON chunks(book_id);
CREATE INDEX idx_chunks_user_updated ON chunks(user_id, updated_at);

-- 3. sentences
CREATE TABLE sentences (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_offset INTEGER DEFAULT 0,
  end_offset INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_sentences_user_id ON sentences(user_id);
CREATE INDEX idx_sentences_chunk_id ON sentences(chunk_id);
CREATE INDEX idx_sentences_user_updated ON sentences(user_id, updated_at);

-- 4. vocabulary
CREATE TABLE vocabulary (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  lemma TEXT,
  meaning_ko TEXT,
  definition_en TEXT,
  part_of_speech TEXT,
  pronunciation TEXT,
  audio_url TEXT,
  context_sentence TEXT,
  scene_note TEXT,
  character_names TEXT,
  tone TEXT,
  sentence_id TEXT,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'new',
  review_box INTEGER DEFAULT 0,
  next_review TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_vocab_user_id ON vocabulary(user_id);
CREATE INDEX idx_vocab_word ON vocabulary(word);
CREATE INDEX idx_vocab_user_updated ON vocabulary(user_id, updated_at);

-- 5. study_queue
CREATE TABLE study_queue (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  sentence_id TEXT,
  text TEXT NOT NULL,
  reason TEXT DEFAULT 'sentence',
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_queue_user_id ON study_queue(user_id);
CREATE INDEX idx_queue_status ON study_queue(status);
CREATE INDEX idx_queue_user_updated ON study_queue(user_id, updated_at);

-- 6. feedback_sessions
CREATE TABLE feedback_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  sentence_id TEXT,
  original_sentence TEXT,
  status TEXT DEFAULT 'finished',
  final_user_translation TEXT,
  literal_translation TEXT,
  natural_translation TEXT,
  story_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_feedback_user_id ON feedback_sessions(user_id);
CREATE INDEX idx_feedback_user_updated ON feedback_sessions(user_id, updated_at);

-- 7. translation_attempts
CREATE TABLE translation_attempts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES feedback_sessions(id) ON DELETE CASCADE,
  attempt_no INTEGER,
  user_translation TEXT,
  ai_status TEXT,
  issue_type TEXT,
  feedback_ko TEXT,
  hint_ko TEXT,
  l1_interference_ko TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_attempts_session ON translation_attempts(session_id);
CREATE INDEX idx_attempts_user_updated ON translation_attempts(user_id, updated_at);

-- 8. highlights
CREATE TABLE highlights (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  sentence_id TEXT,
  text TEXT,
  user_translation TEXT,
  note TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_highlights_user_id ON highlights(user_id);
CREATE INDEX idx_highlights_user_updated ON highlights(user_id, updated_at);

-- 9. story_memories
CREATE TABLE story_memories (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  up_to_chunk INTEGER,
  summary_ko TEXT,
  characters JSONB DEFAULT '[]',
  open_questions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_memories_user_id ON story_memories(user_id);
CREATE INDEX idx_memories_user_updated ON story_memories(user_id, updated_at);

-- 10. reading_sessions
CREATE TABLE reading_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  start_chunk INTEGER,
  end_chunk INTEGER,
  mode TEXT DEFAULT 'story',
  saved_to_queue_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_reading_user_id ON reading_sessions(user_id);
CREATE INDEX idx_reading_user_updated ON reading_sessions(user_id, updated_at);

-- 11. settings (사용자별 1행)
CREATE TABLE settings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'dark',
  font_size INTEGER DEFAULT 16,
  line_height REAL DEFAULT 1.9,
  tts_rate REAL DEFAULT 0.9,
  tts_voice TEXT DEFAULT '',
  ai_base_url TEXT DEFAULT '',
  ai_model TEXT DEFAULT '',
  last_opened_book_id TEXT,
  last_view TEXT DEFAULT 'bookshelf',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(user_id)
);
CREATE INDEX idx_settings_user ON settings(user_id);
