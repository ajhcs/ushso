# Source-selection candidate transition

This is a prospective, unapproved transition for the exact root package, npm lockfile and CI workflow in `transition.json`. It is not an approval receipt. The candidate remains pending independent review with no transferred historical approval and no release qualification.

The verifier checks the exact candidate pins as an atomic set, retains the original root test chain and legacy commands, checks the scoped build extension, and verifies package/lock consistency and CI gates. These structural checks do not prove every test ran or authorize deployment. The current technical-evidence builders pin the verifier and transition artifacts into their new pending subjects.

The fixtures preserve PR-003 `package.json` at `bf46d92b0e4fc91457bd3eb78aa1742ae84038f2`, the historical CI workflow at `30fa0c59ecd4d3d1dd1f56cd8422c6c470e45cb0`, and the PR087 lock at `33b3146dec73984087b49724cc18e690310b0b1d`. Existing historical hashes remain unchanged. Historical transition tests operate on those actual bytes, including their original rejection cases; they do not relabel the new package or lock as previously reviewed.

Any later change to a pinned candidate input fails closed and requires a new explicit transition disposition. Updating a manifest is not evidence that a reviewer approved it. Human source rights and release acceptance remain outside this structural lane.
