import {
  GENERIC_NOT_FOUND_HTML,
  WEB_DISCOVERABILITY_SERVICE_VERSION,
  WebDiscoverabilityError,
  canonicalDatasetUrl,
  renderDatasetHtml,
  renderGoneHtml,
  robotsText,
  stableDatasetPath
} from '../packages/web-discoverability/src/index.mjs';

export const WP13_WEB_DISCOVERABILITY_CANDIDATE = Object.freeze({
  version: 'ushso-worker-web-discoverability-candidate.v1.0.0',
  wired_to_worker_entry: false,
  public_enabled: false,
  deployment_authorized: false
});

const HTML_HEADERS = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'content-language': 'en',
  'content-security-policy': "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-ancestors 'none'; img-src 'none'; object-src 'none'; script-src 'none'; style-src 'none'",
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
});

function headerValue(value, label, max = 2_048) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new WebDiscoverabilityError('SEO_RESPONSE_HEADER_INVALID', label);
  }
  return value;
}

function pinHeaders(pin) {
  return {
    'x-ushso-publication-manifest': headerValue(pin.publication_manifest_id, 'publication_manifest_id', 300),
    'x-ushso-search-generation': headerValue(pin.search_generation_id, 'search_generation_id', 300),
    'x-ushso-seo-generation': headerValue(pin.seo_generation_id, 'seo_generation_id', 300)
  };
}

function bodyForMethod(request, body) {
  return request.method === 'HEAD' ? null : body;
}

function htmlResponse(request, body, { status, pin, cacheControl, etag = null, extraHeaders = {} }) {
  const headers = {
    ...HTML_HEADERS,
    ...pinHeaders(pin),
    'cache-control': cacheControl,
    vary: 'Accept',
    ...extraHeaders
  };
  if (etag !== null) headers.etag = `W/"${headerValue(etag, 'etag', 128)}"`;
  return new Response(bodyForMethod(request, body), { status, headers });
}

function xmlResponse(request, result, cacheControl) {
  return new Response(bodyForMethod(request, result.xml), {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'content-language': 'en',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      etag: `"${headerValue(result.sha256, 'sitemap_sha256', 128)}"`,
      ...pinHeaders(result.publication_pin)
    }
  });
}

function serviceUnavailable(request) {
  const body = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Service unavailable | US Health Systems Observatory</title><meta name="robots" content="noindex,nofollow"></head><body><main><h1>Service unavailable</h1><p>The public dataset page is temporarily unavailable.</p></main></body></html>';
  return new Response(bodyForMethod(request, body), {
    status: 503,
    headers: {
      ...HTML_HEADERS,
      'cache-control': 'no-store',
      'retry-after': '60'
    }
  });
}

function acceptsHtml(request) {
  const accept = request.headers.get('accept');
  if (accept === null) return true;
  if (accept.length > 1_024) return false;
  let selected = null;
  for (const range of accept.split(',').slice(0, 64)) {
    const [rawType, ...parameters] = range.trim().toLowerCase().split(';');
    const [type, subtype, extra] = rawType.split('/');
    if (extra !== undefined || !type || !subtype) continue;
    const specificity = type === 'text' && subtype === 'html' ? 2
      : type === 'text' && subtype === '*' ? 1
        : type === '*' && subtype === '*' ? 0
          : -1;
    if (specificity < 0) continue;
    let quality = 1;
    const qualityParameter = parameters.find(parameter => /^\s*q\s*=/u.test(parameter));
    if (qualityParameter !== undefined) {
      const value = qualityParameter.slice(qualityParameter.indexOf('=') + 1).trim();
      if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.test(value)) continue;
      quality = Number(value);
    }
    if (selected === null || specificity > selected.specificity
        || (specificity === selected.specificity && quality > selected.quality)) {
      selected = { specificity, quality };
    }
  }
  return selected !== null && selected.quality > 0;
}

function methodAllowed(request) {
  return request.method === 'GET' || request.method === 'HEAD';
}

function decodeDatasetId(pathname) {
  const match = /^\/datasets\/([^/]+)$/u.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

function retainedSitemapRoute(pathname) {
  const match = /^\/sitemaps\/([^/]+)\/datasets-\d{5}\.xml$/u.exec(pathname);
  if (!match) return null;
  try {
    return { seoGenerationId: decodeURIComponent(match[1]), path: pathname };
  } catch {
    return { seoGenerationId: '', path: pathname };
  }
}

function isCandidateRoute(pathname) {
  return pathname === '/robots.txt' || pathname === '/sitemap.xml' || pathname.startsWith('/datasets/') || pathname.startsWith('/sitemaps/');
}

export function createWp13WebDiscoverabilityCandidateHandler({ service }) {
  if (!service || service.service_version !== WEB_DISCOVERABILITY_SERVICE_VERSION) throw new TypeError('WP13_WEB_DISCOVERABILITY_SERVICE_REQUIRED');
  return Object.freeze({
    candidate_version: WP13_WEB_DISCOVERABILITY_CANDIDATE.version,
    public_enabled: false,
    async handle(request, env = undefined) {
      const url = new URL(request.url);
      if (!isCandidateRoute(url.pathname)) return null;
      if (url.pathname.startsWith('/datasets/') && !acceptsHtml(request)) return null;
      if (!methodAllowed(request)) {
        return new Response(null, {
          status: 405,
          headers: {
            allow: 'GET, HEAD',
            'cache-control': 'no-store',
            ...(url.pathname.startsWith('/datasets/') ? { vary: 'Accept' } : {})
          }
        });
      }
      try {
        const retained = retainedSitemapRoute(url.pathname);
        if (retained !== null) {
          if (!retained.seoGenerationId) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
          const result = await service.retainedSitemapShard({ request, env, ...retained });
          if (result.kind === 'not_found') return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
          return xmlResponse(request, result, 'public, max-age=31536000, immutable');
        }

        const session = await service.openRequest({ request, env });
        if (url.pathname === '/sitemap.xml') return xmlResponse(request, service.currentSitemap(session), 'no-store');
        if (url.pathname === '/robots.txt') {
          const robots = service.robots(session);
          return new Response(bodyForMethod(request, robotsText(robots.origin)), {
            status: 200,
            headers: {
              'content-type': 'text/plain; charset=utf-8',
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
              ...pinHeaders(robots.publication_pin)
            }
          });
        }

        const decodedId = decodeDatasetId(url.pathname);
        let resolution;
        try {
          resolution = decodedId === null || decodedId === '' ? { kind: 'not_found' } : service.resolveDataset(session, decodedId);
        } catch (error) {
          if (error instanceof WebDiscoverabilityError && error.code === 'SEO_PUBLIC_ID_INVALID') resolution = { kind: 'not_found' };
          else throw error;
        }
        const pin = session.artifact.publication_pin;
        if (resolution.kind === 'record') {
          const canonicalPath = stableDatasetPath(resolution.record.public_id);
          if (url.pathname !== canonicalPath) {
            return new Response(null, {
              status: 308,
              headers: {
                location: headerValue(canonicalDatasetUrl(service.canonical_site_origin, resolution.record.public_id), 'location'),
                'cache-control': 'public, max-age=31536000, immutable',
                vary: 'Accept',
                ...pinHeaders(pin)
              }
            });
          }
          return htmlResponse(request, renderDatasetHtml(resolution.record), {
            status: 200,
            pin,
            cacheControl: 'no-store',
            etag: resolution.record.render_receipt.html_sha256
          });
        }
        if (resolution.kind === 'redirect') {
          return new Response(null, {
            status: 308,
            headers: {
              location: headerValue(resolution.location, 'location'),
              'cache-control': 'public, max-age=31536000, immutable',
              vary: 'Accept',
              ...pinHeaders(pin)
            }
          });
        }
        if (resolution.kind === 'gone') {
          return htmlResponse(request, renderGoneHtml(resolution.canonical_url), {
            status: 410,
            pin,
            cacheControl: 'no-store'
          });
        }
        return htmlResponse(request, GENERIC_NOT_FOUND_HTML, {
          status: 404,
          pin,
          cacheControl: 'no-store'
        });
      } catch (error) {
        if (request.signal?.aborted) throw error;
        return serviceUnavailable(request);
      }
    }
  });
}
