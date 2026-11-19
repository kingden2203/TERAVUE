const UA = 'TERRAVUE/0.2 (+free weather safety app for the Philippines)';

async function request(url, { timeout = 12000, retries = 1, headers = {}, method = 'GET', body, parse = 'json' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method, body, signal: ctrl.signal,
        headers: { 'user-agent': UA, accept: parse === 'json' ? 'application/json' : 'text/html,*/*', ...headers },
      });
      if (!res.ok) {
        const err = new Error(`Upstream ${res.status}`);
        err.status = res.status;
        // 4xx will not get better on retry (429 might)
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err;
        lastErr = err;
      } else {
        return parse === 'json' ? await res.json() : await res.text();
      }
    } catch (err) {
      lastErr = err;
      if (err.status >= 400 && err.status < 500 && err.status !== 429) break;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastErr;
}

export const fetchJSON = (url, opts) => request(url, { ...opts, parse: 'json' });
export const fetchText = (url, opts) => request(url, { ...opts, parse: 'text' });
