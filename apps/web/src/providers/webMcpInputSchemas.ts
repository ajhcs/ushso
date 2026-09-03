import commonSchema from '../../../../contracts/machine-toolkit/v1.0.0/schemas/common.schema.json'
import compareAssetsSchema from '../../../../contracts/machine-toolkit/v1.0.0/schemas/compare-assets-input.schema.json'
import getAccessPlanSchema from '../../../../contracts/machine-toolkit/v1.0.0/schemas/get-access-plan-input.schema.json'
import getAssetSchema from '../../../../contracts/machine-toolkit/v1.0.0/schemas/get-asset-input.schema.json'
import getCoverageStatusSchema from '../../../../contracts/machine-toolkit/v1.0.0/schemas/get-coverage-status-input.schema.json'
import getJoinRoutesSchema from '../../../../contracts/machine-toolkit/v1.0.0/schemas/get-join-routes-input.schema.json'
import getRetrievalRecipeSchema from '../../../../contracts/machine-toolkit/v1.0.0/schemas/get-retrieval-recipe-input.schema.json'
import getVariablesSchema from '../../../../contracts/machine-toolkit/v1.0.0/schemas/get-variables-input.schema.json'
import searchAssetsSchema from '../../../../contracts/machine-toolkit/v1.0.0/schemas/search-assets-input.schema.json'

type JsonSchema = Record<string, unknown>

const commonReference = 'common.schema.json#/$defs/'

/**
 * WebMCP agents receive the schema object itself; they are not required to
 * fetch or resolve an external $ref. Embed the frozen common definitions and
 * rewrite only the contract's relative common-schema references.
 */
function selfContained(schema: JsonSchema): JsonSchema {
  const rewritten = JSON.parse(
    JSON.stringify(schema).replaceAll(commonReference, '#/$defs/'),
  ) as JsonSchema
  return Object.freeze({
    ...rewritten,
    $defs: Object.freeze({
      ...((commonSchema as JsonSchema).$defs as JsonSchema),
      ...((rewritten.$defs as JsonSchema | undefined) ?? {}),
    }),
  })
}

export const publicWebMcpInputSchemas = Object.freeze({
  search_assets: selfContained(searchAssetsSchema as JsonSchema),
  get_asset: selfContained(getAssetSchema as JsonSchema),
  get_access_plan: selfContained(getAccessPlanSchema as JsonSchema),
  get_retrieval_recipe: selfContained(getRetrievalRecipeSchema as JsonSchema),
  get_variables: selfContained(getVariablesSchema as JsonSchema),
  get_join_routes: selfContained(getJoinRoutesSchema as JsonSchema),
  compare_assets: selfContained(compareAssetsSchema as JsonSchema),
  get_coverage_status: selfContained(getCoverageStatusSchema as JsonSchema),
})
