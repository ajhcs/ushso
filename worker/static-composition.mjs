import { StaticCoverageRepository } from '../packages/coverage/static-coverage-repository.mjs';
import { StaticPlannerRepository } from '../packages/planner/static-planner-repository.mjs';
import { createStaticPublicationReadContext } from '../packages/registry/publication-read-context.mjs';
import { StaticAssetCatalogRepository } from '../packages/registry/static-asset-catalog-repository.mjs';
import { StaticSearchBackend } from '../packages/search/static-search-backend.mjs';
import { PublicQueryService } from './public-query-service.mjs';

export function createStaticPublicQueryService({ loadCatalog, loadEngine }) {
  const catalogRepository = new StaticAssetCatalogRepository({ loadCatalog });
  const publicationResolver = Object.freeze({
    async resolve({ request, env, signal }) {
      const corpus = await catalogRepository.describePublication({ request, env, signal });
      return createStaticPublicationReadContext(corpus);
    }
  });
  return new PublicQueryService({
    publicationResolver,
    catalogRepository,
    searchBackend: new StaticSearchBackend({ loadEngine }),
    coverageRepository: new StaticCoverageRepository(),
    plannerRepository: new StaticPlannerRepository()
  });
}
