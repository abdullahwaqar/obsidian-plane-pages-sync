/** Fast non-cryptographic string hash (cyrb53), used to detect content changes. */
export function hash(s: string): string
{
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++)
    {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const locks = new Map<string, Promise<unknown>>();

/** Runs fn after any earlier call with the same key has finished, so one note is never pushed twice at once. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T>
{
    const prev = locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const settled = next.catch(() => undefined);
    locks.set(key, settled);
    void settled.then(() =>
    {
        if (locks.get(key) === settled)
        {
            locks.delete(key);
        }
    });
    return next;
}

export function errorMessage(e: unknown): string
{
    return e instanceof Error ? e.message : String(e);
}

export function isInFolder(path: string, folder: string): boolean
{
    return !!folder && path.startsWith(`${folder}/`);
}
