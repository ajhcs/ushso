# Supplemental Chrome regression review

All 12 actual React/API/fixture cases passed on `954a237a8984d06f5ea0ab15f83c71ce210bf09a`, tree `a781e9801224af92b51389fb898f0b67ab261982`. No product defect or harness correction was required.

The environment was native Chrome 149.0.7827.155 with Node v24.14.0, local HTTP `127.0.0.1:18886`, and viewports 1280×900, 390×900 and 320×900. The Browser plugin is absent; the controller explicitly selected the retained corrected v6 Chrome/CDP harness. No packages were installed.

The flow was Search/Sources → select/remove facets → correct counts, routes, inventory labels and usable desktop/mobile controls. Each API and fixture provider passed six cases: known/unknown count round trips; removing selected facets after zero results; explanations for unavailable facets; complete Sources inventory with current-page examples; mobile 390; and mobile 320. Mobile cases also checked unique description IDs, no document overflow, selection removal and Escape dismissal.

| QA check | Result |
|---|---|
| Expected provider, scenario and Search/Sources route | Passed in all 12 retained DOM audits |
| Meaningful rendered content | Passed in all 12 states |
| Framework error overlay | None in three visually inspected screenshots |
| Page runtime exceptions | None observed; asserted on every tested page |
| Console health | Limited: v6 does not capture every console warning/error |
| Screenshots | Eight retained; desktop Search, desktop Sources and 320px filter panel inspected |
| Interaction proof | 12/12 passed |
| Candidate/source/harness stability | Exact before/after identity and hashes match; Git remains clean |
| Test cleanup | Both ports released; task Chrome processes/profile removed |

The first sandbox `ss` call could not inspect netlink listeners; that limitation is retained. Scoped execution successfully checked both ports before binding. The first browser run passed in 6.1 seconds. Chrome process stderr includes GPU SharedImageManager and GCM registration diagnostics; no tested interaction or page runtime check failed. This harness does not establish the absence of all browser background networking.

Only a small esbuild test bundle was generated in this scratch directory. No full npm build, repository/dist write, gate policy/workspace change, Git mutation, deployment or external implementation provider was used. The single repository build belongs to the controller's gate. This is supplemental browser regression evidence, not deployable-artifact qualification, scientific acceptance, fresh source access, a WebMCP invocation proof or participant research.

`command-receipt.json` binds execution, tool versions, exact source/harness hashes and cleanup. `run-1/receipt.json` contains all cases and local API queries; the 12 DOM snapshots, eight screenshots and Chrome log are retained. `review.json` records the QA details, and `artifact-manifest.json` binds the complete scratch evidence.

## Inspected screenshots

![Desktop Search with explicit unavailable facet explanations](/mnt/d/tmp/plumbob/ushso-epic-execution-20260912/final-browser-review/run-1/api-uniform.png)
![320px fixture filter panel with removable selections](/mnt/d/tmp/plumbob/ushso-epic-execution-20260912/final-browser-review/run-1/fixture-mobile-320.png)
