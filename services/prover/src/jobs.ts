import crypto from 'node:crypto';

export type JobStatus = 'running' | 'succeeded' | 'failed';

export type JobRecord<T> = {
  readonly id: string;
  readonly type: string;
  status: JobStatus;
  readonly createdAt: string;
  updatedAt: string;
  logs: string[];
  result?: T;
  error?: { message: string; stack?: string };
};

export class JobStore {
  readonly #jobs = new Map<string, JobRecord<any>>();
  readonly #maxJobs: number;
  readonly #maxLogs: number;

  constructor(params?: { maxJobs?: number; maxLogs?: number }) {
    this.#maxJobs = params?.maxJobs ?? 50;
    this.#maxLogs = params?.maxLogs ?? 200;
  }

  get(id: string): JobRecord<any> | null {
    return this.#jobs.get(id) ?? null;
  }

  create<T>(type: string, runner: (log: (line: string) => void) => Promise<T>): JobRecord<T> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record: JobRecord<T> = {
      id,
      type,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      logs: [],
    };

    this.#jobs.set(id, record);
    this.#enforceMaxJobs();

    const log = (line: string) => {
      record.logs.push(`${new Date().toISOString()} ${line}`);
      if (record.logs.length > this.#maxLogs) {
        record.logs = record.logs.slice(record.logs.length - this.#maxLogs);
      }
      record.updatedAt = new Date().toISOString();
    };

    // Fire-and-forget runner.
    void runner(log)
      .then((result) => {
        record.status = 'succeeded';
        record.result = result;
        record.updatedAt = new Date().toISOString();
      })
      .catch((err: any) => {
        record.status = 'failed';
        record.error = {
          message: err?.message ? String(err.message) : String(err),
          stack: err?.stack ? String(err.stack) : undefined,
        };
        record.updatedAt = new Date().toISOString();
      });

    return record;
  }

  #enforceMaxJobs() {
    if (this.#jobs.size <= this.#maxJobs) return;

    // Drop oldest jobs first.
    const sorted = Array.from(this.#jobs.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const toDelete = sorted.slice(0, Math.max(0, sorted.length - this.#maxJobs));
    for (const job of toDelete) this.#jobs.delete(job.id);
  }
}

