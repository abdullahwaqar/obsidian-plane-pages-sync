import { type RequestUrlResponse, requestUrl } from "obsidian";

export interface PlaneProject
{
    id: string;
    name: string;
    identifier: string;
}

export interface PlanePage
{
    id: string;
    name: string;
    description_html?: string;
    is_locked?: boolean;
    archived_at?: string | null;
}

export class PlaneError extends Error
{
    constructor(public status: number, message: string)
    {
        super(message);
    }
}

const MIN_GAP_MS = 1050; // Plane allows 60 req/min per key

/** Thin client for the Plane REST API. All calls go through one serial queue. */
export class PlaneClient
{
    private chain: Promise<unknown> = Promise.resolve();
    private last = 0;

    constructor(private cfg: () => { apiBase: string; apiKey: string; workspace: string; })
    {}

    private get base()
    {
        const { apiBase, workspace } = this.cfg();
        return `${apiBase.replace(/\/+$/, "")}/api/v1/workspaces/${encodeURIComponent(workspace)}`;
    }

    private request<T>(method: string, path: string, body?: unknown): Promise<T>
    {
        const run = async (): Promise<T> =>
        {
            for (let attempt = 0; attempt < 4; attempt++)
            {
                const wait = this.last + MIN_GAP_MS - Date.now();
                if (wait > 0)
                {
                    await sleep(wait);
                }
                this.last = Date.now();

                const res: RequestUrlResponse = await requestUrl({
                    url: `${this.base}${path}`,
                    method,
                    headers: { "X-API-Key": this.cfg().apiKey, "Content-Type": "application/json" },
                    body: body === undefined ? undefined : JSON.stringify(body),
                    throw: false,
                });

                if (res.status === 429)
                {
                    const reset = Number(res.headers["x-ratelimit-reset"] ?? res.headers["X-RateLimit-Reset"]);
                    await sleep(reset ? Math.max(1000, reset * 1000 - Date.now() + 250) : 5000);
                    continue;
                }
                if (res.status >= 500 && attempt < 3)
                {
                    await sleep(2000 * (attempt + 1));
                    continue;
                }
                if (res.status >= 400)
                {
                    let detail = "";
                    try
                    {
                        detail = JSON.stringify(res.json);
                    }
                    catch
                    {
                        detail = res.text?.slice(0, 200) ?? "";
                    }
                    throw new PlaneError(res.status, `Plane ${method} ${path} -> ${res.status} ${detail}`);
                }
                if (res.status === 204 || !res.text)
                {
                    return undefined as T;
                }
                return res.json as T;
            }
            throw new PlaneError(429, "Plane rate limit: gave up after retries");
        };
        const p = this.chain.then(run, run);
        this.chain = p.catch(() => undefined);
        return p;
    }

    async listProjects(): Promise<PlaneProject[]>
    {
        const out: PlaneProject[] = [];
        let cursor = "";
        for (let i = 0; i < 20; i++)
        {
            const res = await this.request<
                { results?: PlaneProject[]; next_page_results?: boolean; next_cursor?: string; } | PlaneProject[]
            >(
                "GET",
                `/projects/?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
            );
            if (Array.isArray(res))
            {
                return res;
            }
            out.push(...(res.results ?? []));
            if (!res.next_page_results || !res.next_cursor)
            {
                break;
            }
            cursor = res.next_cursor;
        }
        return out;
    }

    createPage(projectId: string, name: string, html: string, externalId: string)
    {
        return this.request<PlanePage>("POST", `/projects/${projectId}/pages/`, {
            name,
            description_html: html,
            access: 0,
            external_id: externalId,
            external_source: "obsidian",
        });
    }

    updatePage(projectId: string, pageId: string, name: string, html: string)
    {
        return this.request<PlanePage>("PUT", `/projects/${projectId}/pages/${pageId}/`, {
            name,
            description_html: html,
        });
    }

    getPage(projectId: string, pageId: string)
    {
        return this.request<PlanePage>("GET", `/projects/${projectId}/pages/${pageId}/`);
    }

    archivePage(projectId: string, pageId: string)
    {
        return this.request<void>("POST", `/projects/${projectId}/pages/${pageId}/archive/`);
    }

    restorePage(projectId: string, pageId: string)
    {
        return this.request<void>("DELETE", `/projects/${projectId}/pages/${pageId}/archive/`);
    }
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
