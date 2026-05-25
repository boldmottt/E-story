-- ============================================================
-- E-Story Row Level Security (RLS) 정책
-- 모든 테이블: auth.uid() = user_id 인 행만 접근 가능
-- anon key로도 본인 데이터만 안전하게读写
-- ============================================================

-- 1. books
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_books_select" ON books FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_books_insert" ON books FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_books_update" ON books FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_books_delete" ON books FOR DELETE USING (auth.uid() = user_id);

-- 2. chunks
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_chunks_select" ON chunks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_chunks_insert" ON chunks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_chunks_update" ON chunks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_chunks_delete" ON chunks FOR DELETE USING (auth.uid() = user_id);

-- 3. sentences
ALTER TABLE sentences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_sentences_select" ON sentences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_sentences_insert" ON sentences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_sentences_update" ON sentences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_sentences_delete" ON sentences FOR DELETE USING (auth.uid() = user_id);

-- 4. vocabulary
ALTER TABLE vocabulary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_vocab_select" ON vocabulary FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_vocab_insert" ON vocabulary FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_vocab_update" ON vocabulary FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_vocab_delete" ON vocabulary FOR DELETE USING (auth.uid() = user_id);

-- 5. study_queue
ALTER TABLE study_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_queue_select" ON study_queue FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_queue_insert" ON study_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_queue_update" ON study_queue FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_queue_delete" ON study_queue FOR DELETE USING (auth.uid() = user_id);

-- 6. feedback_sessions
ALTER TABLE feedback_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_feedback_select" ON feedback_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_feedback_insert" ON feedback_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_feedback_update" ON feedback_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_feedback_delete" ON feedback_sessions FOR DELETE USING (auth.uid() = user_id);

-- 7. translation_attempts
ALTER TABLE translation_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_attempts_select" ON translation_attempts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_attempts_insert" ON translation_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_attempts_update" ON translation_attempts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_attempts_delete" ON translation_attempts FOR DELETE USING (auth.uid() = user_id);

-- 8. highlights
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_highlights_select" ON highlights FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_highlights_insert" ON highlights FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_highlights_update" ON highlights FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_highlights_delete" ON highlights FOR DELETE USING (auth.uid() = user_id);

-- 9. story_memories
ALTER TABLE story_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_memories_select" ON story_memories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_memories_insert" ON story_memories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_memories_update" ON story_memories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_memories_delete" ON story_memories FOR DELETE USING (auth.uid() = user_id);

-- 10. reading_sessions
ALTER TABLE reading_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_reading_select" ON reading_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_reading_insert" ON reading_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_reading_update" ON reading_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_reading_delete" ON reading_sessions FOR DELETE USING (auth.uid() = user_id);

-- 11. settings
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_settings_select" ON settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_settings_insert" ON settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_settings_update" ON settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_own_settings_delete" ON settings FOR DELETE USING (auth.uid() = user_id);
