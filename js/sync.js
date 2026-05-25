/* E-Story Sync Module — DISABLED */
/* 
 * 🔴 Sync is DISABLED until OAuth + UUID migration are implemented.
 * 
 * What's needed to re-enable:
 * 1. Supabase JS SDK OAuth flow (signInWithGoogle/onAuthStateChanged)
 * 2. db.js v3 migration: UUID PKs instead of auto-increment integers
 * 3. All INSERTs populate user_id = supabase.auth.user().id
 * 4. _dirty flag + _synced_at tracking for incremental sync
 * 5. Proper soft-delete (deleted_at) to prevent zombie records
 * 6. settings table: api_key, provider, last_opened_book_id columns
 * 
 * See: vendor/supabase.js, supabase/schema.sql, supabase/rls.sql
 */

const Sync = {
  _enabled: false,

  init() {
    this._enabled = false;
    console.warn('Sync disabled — requires Supabase OAuth + UUID PK migration');
    return false;
  },

  isEnabled() { return false; },
  sync() { return { success: false, reason: 'sync_disabled' }; },
  pushAll() { return { success: false, reason: 'sync_disabled' }; },
  pullAll() { return { success: false, reason: 'sync_disabled' }; },
  scheduleSync() { /* no-op */ }
};
