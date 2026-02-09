import crypto from 'node:crypto';
export class JobStore {
    #jobs = new Map();
    #maxJobs;
    #maxLogs;
    constructor(params) {
        this.#maxJobs = params?.maxJobs ?? 50;
        this.#maxLogs = params?.maxLogs ?? 200;
    }
    get(id) {
        return this.#jobs.get(id) ?? null;
    }
    create(type, runner) {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const record = {
            id,
            type,
            status: 'running',
            createdAt: now,
            updatedAt: now,
            logs: [],
        };
        this.#jobs.set(id, record);
        this.#enforceMaxJobs();
        const log = (line) => {
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
            .catch((err) => {
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
        if (this.#jobs.size <= this.#maxJobs)
            return;
        // Drop oldest jobs first.
        const sorted = Array.from(this.#jobs.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const toDelete = sorted.slice(0, Math.max(0, sorted.length - this.#maxJobs));
        for (const job of toDelete)
            this.#jobs.delete(job.id);
    }
}
//# sourceMappingURL=jobs.js.map