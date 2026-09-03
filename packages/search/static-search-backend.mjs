import { assertPublicationReadContext } from '../registry/publication-read-context.mjs';
import { SEARCH_BACKEND_VERSION } from './search-backend.mjs';

function assertSignal(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

/**
 * Static search is intentionally injected with the promoted production engine.
 * The adapter never imports the distinct historical evaluator implementation.
 */
export class StaticSearchBackend {
  backend_version = SEARCH_BACKEND_VERSION;

  constructor({ loadEngine }) {
    if (typeof loadEngine !== 'function') throw new TypeError('loadEngine must be a function');
    this.loadEngine = loadEngine;
  }

  async #engine({ publication, request, env, signal }) {
    assertPublicationReadContext(publication);
    assertSignal(signal);
    const engine = await this.loadEngine(request, env);
    assertSignal(signal);
    return engine;
  }

  async interpret({ query, ...options }) {
    return (await this.#engine(options)).interpret(query);
  }

  async searchAssets({ query, ...options }) {
    return (await this.#engine(options)).retrieve(query, { signal: options.signal });
  }
}
