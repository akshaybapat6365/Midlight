import fs from 'node:fs/promises';
import path from 'node:path';

export type PersistedState = {
  contractAddress?: string;
  clinic?: {
    issuerSecretKeyHex: string;
  };
  patients?: Record<
    string,
    {
      patientSecretKeyHex: string;
      patientPublicKeyHex: string;
    }
  >;
};

const DEFAULT_STATE: PersistedState = {
  patients: {},
};

export class StateStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async read(): Promise<PersistedState> {
    try {
      const raw = await fs.readFile(this.#filePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedState;
      return { ...DEFAULT_STATE, ...parsed, patients: parsed.patients ?? {} };
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as any).code === 'ENOENT') return { ...DEFAULT_STATE };
      throw e;
    }
  }

  async write(next: PersistedState): Promise<void> {
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    await fs.writeFile(this.#filePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  }

  async update(fn: (prev: PersistedState) => PersistedState): Promise<PersistedState> {
    const prev = await this.read();
    const next = fn(prev);
    await this.write(next);
    return next;
  }
}

