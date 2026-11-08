//! Application settings over the frozen 001 `settings(key,value,version)` table.
//!
//! W1 exposes exactly one key, `application.timeZone`. Reads fall back to the
//! instance OS default at version 0 without writing; writes are atomic
//! compare-and-set on the version from the last read.

import { ServiceError, CONTRACT_VERSION } from './manual-items-service.mjs';

const KEY = 'application.timeZone';

function validation(message) {
  return new ServiceError('validation_failed', message);
}

export class ApplicationSettingsService {
  constructor(storage, { osTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
    this.storage = storage;
    this.osTimeZone = osTimeZone;
  }

  snapshot(timeZone, version) {
    return { contractVersion: CONTRACT_VERSION, settings: { timeZone }, version, warning: null };
  }

  async readRaw() {
    const result = await this.storage.command('query', {
      sql: `SELECT value, version FROM settings WHERE key='${KEY}'`,
      params: [],
    });
    const row = result.rows[0];
    return row ? { value: row[0], version: row[1] } : null;
  }

  async read() {
    const current = await this.readRaw();
    if (!current) return this.snapshot(this.osTimeZone(), 0);
    return this.snapshot(current.value, current.version);
  }

  async write(timeZone, expectedVersion) {
    if (typeof timeZone !== 'string' || !timeZone.trim()) throw validation('timeZone 无效。');
    try {
      new Intl.DateTimeFormat('en', { timeZone });
    } catch {
      throw validation('timeZone 无效。');
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw validation('expectedVersion 无效。');
    }
    const current = await this.readRaw();
    if (!current) {
      if (expectedVersion !== 0) throw new ServiceError('version_conflict', '设置版本已变化，请重新读取。');
      try {
        const result = await this.storage.command('transact', {
          ops: [{ sql: `INSERT INTO settings(key,value,version) VALUES('${KEY}',?,1)`, params: [timeZone] }],
        });
        if (result.results[0].changes !== 1) throw new ServiceError('version_conflict', '设置版本已变化，请重新读取。');
      } catch (error) {
        if (error.code === 'WEB_BACKEND_SQL_ERROR') throw new ServiceError('version_conflict', '设置版本已变化，请重新读取。');
        throw error;
      }
      return this.snapshot(timeZone, 1);
    }
    if (current.version !== expectedVersion) {
      throw new ServiceError('version_conflict', '设置版本已变化，请重新读取。');
    }
    const result = await this.storage.command('transact', {
      ops: [{
        sql: `UPDATE settings SET value=?, version=version+1 WHERE key='${KEY}' AND version=?`,
        params: [timeZone, expectedVersion],
      }],
    });
    if (result.results[0].changes !== 1) throw new ServiceError('version_conflict', '设置版本已变化，请重新读取。');
    return this.snapshot(timeZone, expectedVersion + 1);
  }
}
