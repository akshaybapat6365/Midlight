import fs from 'node:fs/promises';
import path from 'node:path';
const DEFAULT_STATE = {
    patients: {},
};
export class StateStore {
    #filePath;
    constructor(filePath) {
        this.#filePath = filePath;
    }
    async read() {
        try {
            const raw = await fs.readFile(this.#filePath, 'utf8');
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_STATE, ...parsed, patients: parsed.patients ?? {} };
        }
        catch (e) {
            if (e instanceof Error && 'code' in e && e.code === 'ENOENT')
                return { ...DEFAULT_STATE };
            throw e;
        }
    }
    async write(next) {
        await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
        await fs.writeFile(this.#filePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    }
    async update(fn) {
        const prev = await this.read();
        const next = fn(prev);
        await this.write(next);
        return next;
    }
}
//# sourceMappingURL=store.js.map