// -----------------------------------------------------------------------------
// The state kept in /data (the only writable place of the container): the
// built indexes and their guards, the serial of the inverter, the pause after
// a 429/5xx and the stop after refused credentials, so that a restart never
// forgets a jump the user has not accepted nor retries too soon. Never a
// password, a cookie nor any text of the inverter. A small JSON file, written
// through a temporary file and a rename. Failures are logged, never fatal.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

export const DEFAULT_STATE_FILE = '/data/imeon-state.json';

export function createFileStore(file = DEFAULT_STATE_FILE) {
  return {
    load() {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      } catch {
        return {};
      }
    },
    async save(data) {
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(data), 'utf8');
      await rename(tmp, file);
    },
  };
}

/** The same in memory (tests). */
export function createMemoryStore(initial = {}) {
  let data = structuredClone(initial);
  return {
    load: () => structuredClone(data),
    async save(next) {
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
  };
}
