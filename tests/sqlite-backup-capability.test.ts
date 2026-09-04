import { describe, expect, it } from 'vitest';

import { isSqliteBackupSupported } from '../src/main/storage/deskpet-database';

describe('SQLite backup capability', () => {
  it('detects a runtime without backup before the user starts an export', () => {
    expect(isSqliteBackupSupported({ backup: undefined })).toBe(false);
    expect(isSqliteBackupSupported({ backup: async () => 1 })).toBe(true);
  });
});
