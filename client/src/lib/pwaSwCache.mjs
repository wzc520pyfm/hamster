/**
 * Pure helpers mirrored by client/public/sw.js fetch caching.
 * Uses production isCacheableShellAssetResponse via Node strip-types bridge in tests.
 */

/**
 * Simulate cache-first: never store invalid/HTML asset responses.
 * @param {{
 *   cache: Map<string, { body: string, contentType: string, ok?: boolean }>,
 *   requestUrl: string,
 *   fetchResponse: { ok: boolean, contentType: string, body: string } | null,
 *   isCacheable: (req: { url: string, mode?: string }, res: object) => boolean,
 * }} args
 */
export function cacheFirstPutDecision(args) {
  const { cache, requestUrl, fetchResponse, isCacheable } = args
  if (cache.has(requestUrl)) {
    const hit = cache.get(requestUrl)
    if (
      requestUrl.includes('/assets/') &&
      /\.js$/i.test(requestUrl) &&
      String(hit.contentType).includes('text/html')
    ) {
      cache.delete(requestUrl)
    } else {
      return { served: 'cache', cached: false, entry: hit }
    }
  }
  if (!fetchResponse) return { served: 'network-miss', cached: false, entry: null }
  const request = { url: requestUrl, mode: 'cors' }
  const response = {
    ok: fetchResponse.ok,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? fetchResponse.contentType : null) },
  }
  const cacheable = isCacheable(request, response)
  if (cacheable) {
    const entry = {
      body: fetchResponse.body,
      contentType: fetchResponse.contentType,
      ok: fetchResponse.ok,
    }
    cache.set(requestUrl, entry)
    return { served: 'network', cached: true, entry }
  }
  return {
    served: 'network',
    cached: false,
    entry: {
      body: fetchResponse.body,
      contentType: fetchResponse.contentType,
      ok: fetchResponse.ok,
    },
  }
}
