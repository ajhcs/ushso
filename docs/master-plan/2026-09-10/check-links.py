"""Check local Markdown file destinations in this plan and its dated audit."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).parent
AUDIT = ROOT.parent.parent / 'reviews' / '2026-09-10-product-data-audit'
errors = []
links = 0
files = 0
for root in (ROOT, AUDIT):
    for page in sorted(root.rglob('*.md')):
        files += 1
        text = re.sub(r'```[\s\S]*?```', '', page.read_text())
        for match in re.finditer(r'!?\[[^\]]*\]\(([^\n]+?)\)', text):
            target = match.group(1).strip().strip('<>')
            if re.match(r'^[a-z][a-z0-9+.-]*:', target) or target.startswith('#'):
                continue
            target = target.split('#')[0]
            links += 1
            if not (page.parent / target).resolve().exists():
                errors.append({'file': str(page), 'target': target})
result = {
    'status': 'FAIL' if errors else 'PASS',
    'scope': 'Markdown local file destinations; not external URL availability or anchor validation',
    'markdown_files': files, 'local_links': links, 'errors': errors,
}
(ROOT / 'link-validation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
raise SystemExit(bool(errors))
