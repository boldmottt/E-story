/* E-Story Sync Module — Supabase REST API */
/* v1: Full pull on load, push on write, merge strategy */

const Sync = {
  _enabled: false,
  _anonKey: '',
  _projectUrl: 'https://ytvakzjiwxlxqtlmltuu.supabase.co',
  _lastSync: 0,
  _syncTimer: null,
  _isSyncing: false,

  // Table schema mapping (Dexie → Supabase column mapping)
  _tableMap: {
    books: { table: 'books', idField: 'id' },
    chunks: { table: 'chunks', idField: 'id' },
    sentences: { table: 'sentences', idField: 'id' },
    feedbackSessions: { table: 'feedback_sessions', idField: 'id' },
    translationAttempts: { table: 'translation_attempts', idField: 'id' },
    vocabulary: { table: 'vocabulary', idField: 'id' },
    studyQueue: { table: 'study_queue', idField: 'id' },
    highlights: { table: 'highlights', idField: 'id' },
    storyMemories: { table: 'story_memories', idField: 'id' },
    readingSessions: { table: 'reading_sessions', idField: 'id' },
    settings: { table: 'settings', idField: 'id' }
  },

  init(key) {
    if (!key || !key.trim()) return false;
    this._anonKey = key.trim();
    this._enabled = true;
    return true;
  },

  isEnabled() { return this._enabled; },

  /** Convert camelCase Dexie field names to snake_case for Supabase */
  _toSnake(obj) {
    const result = {};
    for (const [key, val] of Object.entries(obj || {})) {
      const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      result[snake] = val;
    }
    return result;
  },

  /** Convert snake_case Supabase fields to camelCase for Dexie */
  _toCamel(obj) {
    const result = {};
    for (const [key, val] of Object.entries(obj || {})) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      result[camel] = val;
    }
    return result;
  },

  /** Generic REST call to Supabase */
  async _fetch(method, table, options = {}) {
    if (!this._enabled) return null;
    const url = `${this._projectUrl}/rest/v1/${table}${options.query || ''}`;
    const headers = {
      'apikey': this._anonKey,
      'Authorization': `Bearer ${this._anonKey}`,
      'Content-Type': 'application/json',
    };
    if (options.prefer) headers['Prefer'] = options.prefer;

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        console.warn(`Sync ${method} ${table}: HTTP ${res.status} ${err.slice(0, 100)}`);
        return null;
      }
      if (res.status === 204) return [];
      return await res.json();
    } catch (e) {
      console.warn(`Sync fetch error:`, e.message);
      return null;
    }
  },

  /** Fetch all records from a Supabase table */
  async _fetchAll(tableName) {
    const result = await this._fetch('GET', tableName, {
      query: '?select=*&order=updated_at.asc.nullslast'
    });
    if (!Array.isArray(result)) return [];
    return result.map(r => this._toCamel(r));
  },

  /** Upsert records to Supabase (insert or update) */
  async _upsert(tableName, records) {
    if (!records || !records.length) return;
    const snakeRecords = records.map(r => this._toSnake(r));
    // Split into chunks of 100 to avoid payload limits
    for (let i = 0; i < snakeRecords.length; i += 100) {
      const chunk = snakeRecords.slice(i, i + 100);
      await this._fetch('POST', tableName, {
        body: chunk,
        prefer: 'resolution=merge-duplicates'
      });
    }
  },

  /** Upload blob/data for sync (full backup) */
  async pushAll() {
    if (!this._enabled) return { success: false, reason: 'sync_disabled' };
    try {
      const tables = Object.keys(this._tableMap);
      for (const table of tables) {
        const meta = this._tableMap[table];
        const records = await DB[table].toArray();
        if (records.length) {
          await this._upsert(meta.table, records);
        }
      }
      this._lastSync = Date.now();
      return { success: true, count: tables.length };
    } catch (e) {
      console.warn('Sync push failed:', e.message);
      return { success: false, error: e.message };
    }
  },

  /** Pull all data from Supabase into IndexedDB (merge, cloud wins) */
  async pullAll() {
    if (!this._enabled) return { success: false, reason: 'sync_disabled' };
    try {
      const tables = Object.keys(this._tableMap);
      let totalCount = 0;

      for (const table of tables) {
        const meta = this._tableMap[table];
        const remoteRecords = await this._fetchAll(meta.table);
        if (!remoteRecords.length) continue;

        // Get local records for merge
        const localRecords = await DB[table].toArray();
        const localMap = new Map(localRecords.map(r => [r[meta.idField], r]));

        // Merge: remote wins if updatedAt is newer or local doesn't exist
        const toUpdate = [];
        const toAdd = [];

        for (const remote of remoteRecords) {
          const local = localMap.get(remote[meta.idField]);
          if (!local) {
            // New remote record
            toAdd.push(remote);
          } else if (remote.updatedAt > local.updatedAt) {
            // Remote is newer
            toUpdate.push(remote);
          }
          // If local is newer, keep local (don't push, pushAll handles that)
        }

        // Apply updates
        for (const r of toUpdate) {
          await DB[table].put(r);
        }
        // Bulk add new records
        if (toAdd.length) {
          await DB[table].bulkAdd(toAdd);
        }

        totalCount += remoteRecords.length;
      }

      this._lastSync = Date.now();
      return { success: true, totalCount };
    } catch (e) {
      console.warn('Sync pull failed:', e.message);
      return { success: false, error: e.message };
    }
  },

  /** One-shot full sync: push local changes, then pull remote changes */
  async sync() {
    if (this._isSyncing) return { success: false, reason: 'already_syncing' };
    this._isSyncing = true;
    try {
      // First push local changes
      await this.pushAll();
      // Then pull remote changes
      const pullResult = await this.pullAll();
      return { success: true, ...pullResult };
    } finally {
      this._isSyncing = false;
    }
  },

  /** Schedule a debounced sync (fires after 2s of inactivity) */
  scheduleSync() {
    if (!this._enabled) return;
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      this.sync();
    }, 2000);
  }
};
