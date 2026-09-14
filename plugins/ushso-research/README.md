# USHSO research plugin

Local review candidate for Astra and other MCP clients. Requires Node 22.15+.

Eight read-only tools share schemas and HTTP routing with WebMCP. Run `node scripts/generate-agent-plugin.mjs` at the repository root after changing canonical definitions or the browser client. Do not edit generated assets by hand.

Current version mapping is published by `/api/contract` and generated `assets/discovery.json`: inputs remain `observatory-machine-toolkit.v1.0.0`; responses use `observatory-machine-toolkit.v1.1.0`. Each of the eight tools advertises separate input and response schema URLs. Strict v1.0 response consumers must migrate; unknown quota has null counters, never zero or unlimited. The legacy discovery `tool_contract_version` identifies the input toolkit, not the current response shape. The disabled planner is not an advertised public capability.

The plugin-relative executable is `./scripts/mcp.mjs`. Hosts that do not resolve plugin-relative commands must configure an absolute path to this file, or use command `node` with that absolute path as its argument. Do not assume `${PLUGIN_ROOT}` is expanded in legacy MCP configurations. No installation into a user's client has been performed. Native Astra and browser WebMCP qualification remain separate.

The stdio server writes only newline-delimited JSON-RPC to stdout. Defaults to https://ushso.org; localhost testing permits only http://127.0.0.1. The research planner is excluded. No credentials or model key are needed for metadata inspection.

## Install

Copy this directory to a clean location and run `node scripts/mcp.mjs` with Node 22.15+. The plugin has no npm dependencies and must not import the USHSO development checkout. Full novice/advanced setup, stdio versus WebMCP, and recovery notes live in `docs/research-program/mcp-setup.md`.

Stdio MCP is the tested install path. Native WebMCP is not promised in unsupported browsers; the HTTP route under `/api/machine/v1` remains a tested fallback. Marketplace UI installation is not claimed.

Advertised tools: `observatory.search_assets`, `observatory.get_asset`, `observatory.get_access_plan`, `observatory.get_retrieval_recipe`, `observatory.get_variables`, `observatory.get_join_routes`, `observatory.compare_assets`, `observatory.get_coverage_status`. `observatory.plan_research` is disabled and is not listed. A successful tool envelope is not a completed research task.
