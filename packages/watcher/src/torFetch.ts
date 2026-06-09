import { TorClient, storage } from "tor-js/wasm-file";

export interface TorHandle {
  client: TorClient;
  /** Restore the original global fetch and close the Tor client. */
  restore: () => void;
}

/**
 * Bootstraps a Tor client (Arti-in-WASM, via tor-js) and routes ALL of this
 * process's `fetch` through it by overriding `globalThis.fetch`. Helios-WASM
 * calls the global `fetch`, so once this is installed every consensus/execution
 * RPC request the light client makes egresses over Tor — hiding the watcher's
 * IP and unlinking its query pattern from the upstream RPC.
 *
 * In Node, omitting `gateway` bootstraps over direct TCP (slow cold start);
 * passing a gateway URL enables tor-js's fast bootstrap.
 */
export async function installTorFetch(opts: { gateway?: string } = {}): Promise<TorHandle> {
  // In-memory storage avoids the wasm-file backend's one-file-per-microdescriptor
  // pattern, which exhausts the process fd limit (EMFILE) on the Tor consensus.
  const client = new TorClient({
    storage: new storage.MemoryStorage(),
    logLevel: "error",
    ...(opts.gateway ? { gateway: opts.gateway } : {}),
  });
  await client.ready();

  const original = globalThis.fetch;

  const debug = process.env.ARGUS_DEBUG_FETCH === "1";

  const torFetch: typeof fetch = async (input, init) => {
    // Resolve the URL without consuming any Request body yet.
    const urlStr =
      input instanceof Request ? input.url : typeof input === "string" ? input : input.toString();

    // Only http(s) egress goes over Tor. data:/blob:/file: URLs (e.g. Helios loading
    // its WASM via a data: URL) are local and must use the original fetch — routing
    // them through Tor fails with "No host in URL".
    if (!/^https?:/i.test(urlStr)) return original(input, init);

    // Helios-WASM (wasm-bindgen) may call fetch with a Request object carrying the
    // method/headers/body, OR with (url, init). Normalize both shapes.
    let url: string;
    let method = init?.method;
    const headers: Record<string, string> = {};
    let body: string | Uint8Array | ArrayBuffer | undefined;

    if (input instanceof Request) {
      url = input.url;
      method = method ?? input.method;
      input.headers.forEach((v, k) => (headers[k] = v));
      if (input.method !== "GET" && input.method !== "HEAD") {
        body = new Uint8Array(await input.arrayBuffer());
      }
    } else {
      url = typeof input === "string" ? input : input.toString();
    }

    const h = init?.headers;
    if (h) {
      if (h instanceof Headers) h.forEach((v, k) => (headers[k] = v));
      else if (Array.isArray(h)) for (const [k, v] of h) headers[k] = v;
      else Object.assign(headers, h);
    }

    const rawBody = init?.body;
    if (rawBody != null) {
      body =
        typeof rawBody === "string" || rawBody instanceof Uint8Array || rawBody instanceof ArrayBuffer
          ? rawBody
          : String(rawBody);
    }

    if (debug) console.error(`[tor-fetch] ${method ?? "GET"} ${url}`);

    const resp = await client.fetch(url, { method, headers, body, signal: init?.signal ?? undefined });

    // tor-js returns a Response with an empty `.url`; Helios reads `response.url`
    // and does Url::parse() on it → "url parse" on "". Backfill the request URL.
    if (!resp.url) {
      try {
        Object.defineProperty(resp, "url", { value: url, configurable: true });
      } catch {
        /* read-only in some runtimes; best-effort */
      }
    }
    return resp;
  };

  globalThis.fetch = torFetch;

  return {
    client,
    restore: () => {
      globalThis.fetch = original;
      client.close();
    },
  };
}
