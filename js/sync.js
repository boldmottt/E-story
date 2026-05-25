/* E-Story Sync Module — DISABLED */
const Sync = {
  isEnabled() { return false; },
  scheduleSync() { /* no-op */ },
  sync() { return { success: false, reason: 'sync_disabled' }; }
};
