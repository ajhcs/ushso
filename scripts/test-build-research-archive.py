#!/usr/bin/env python3
"""Portable regression tests for the research archive generator."""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest

# Dynamic imports must not mutate the exact candidate during verification.
sys.dont_write_bytecode = True


TEST_ROOT = Path(__file__).resolve().parent
BUILDER = TEST_ROOT / "build-research-archive.py"
STAGING = Path(
    os.environ.get(
        "USHSO_RESEARCH_STAGING_SCRIPT",
        str(TEST_ROOT / "stage-research-assets.mjs"),
    )
)
TEMP_BASE_VALUE = os.environ.get("TMPDIR") or os.environ.get("RUNNER_TEMP")
if not TEMP_BASE_VALUE or not Path(TEMP_BASE_VALUE).is_absolute():
    raise RuntimeError("tests require an absolute TMPDIR or RUNNER_TEMP")
TEMP_BASE = Path(TEMP_BASE_VALUE)


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def write_json(path: Path, value: object) -> bytes:
    body = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return body


def import_builder():
    spec = importlib.util.spec_from_file_location("archive_builder_regression", BUILDER)
    if not spec or not spec.loader:
        raise AssertionError("unable to import archive builder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_fixture(root: Path) -> tuple[Path, Path, Path, Path]:
    dictionary = root / "research-dictionaries-v1"
    scientific_review = root / "scientific-review-v1"
    scientific_conflicts = root / "scientific-conflicts-v1"
    cache = root / "cache"
    cache.mkdir(parents=True)

    generation = "archive-generator-regression-generation"
    page = json.dumps([{"name": "field_a", "evidence_ids": []}], separators=(",", ":")).encode("utf-8")
    page_sha = digest(page)
    parser_issue = json.dumps([{"code": "PARSER_TEST", "message": "retained parser issue"}], separators=(",", ":")).encode("utf-8")
    parser_sha = digest(parser_issue)
    record_id = "record-a"
    record_file = f"records/{digest(record_id.encode())}.json"
    descriptor = {
        "format": "ushso.dictionary-review.v1",
        "record_id": record_id,
        "generation": generation,
        "baseline_record_sha256": "a" * 64,
        "source_proposal_sha256": "b" * 64,
        "publication_authorized": False,
        "review_status": "pending_owner_review",
        "schema_applicability": "unresolved",
        "evidence": [],
        "provenance": [],
        "limitations": ["fixture only"],
        "variable_count": 1,
        "isolated_fields": [],
        "supplements": [],
        "pages": [{"sha256": page_sha, "count": 1, "bytes": len(page)}],
        "parser_issues_artifact": {
            "format": "ushso.glyph-parser-issues.v1",
            "file": f"parser-issues/{parser_sha}.json",
            "sha256": parser_sha,
            "bytes": len(parser_issue),
            "count": 1,
            "all_parser_issues_preserved": True,
            "source": "glyph-v2-qualified-replay",
        },
    }
    descriptor_body = json.dumps(descriptor, separators=(",", ":")).encode("utf-8")
    dictionary_manifest = {
        "format": "ushso.dictionary-review-package.v1",
        "generation": generation,
        "review_status": "pending_owner_review",
        "publication_authorized": False,
        "canonical_records_changed": 0,
        "records": [{"record_id": record_id, "file": record_file, "sha256": digest(descriptor_body), "variables": 1, "isolated_fields": 0}],
        "variables": 1,
        "pages": 1,
        "maximum_page_bytes": len(page),
    }
    write_json(dictionary / "manifest.json", dictionary_manifest)
    (dictionary / record_file).parent.mkdir(parents=True, exist_ok=True)
    (dictionary / record_file).write_bytes(descriptor_body)
    (dictionary / "pages").mkdir(parents=True, exist_ok=True)
    (dictionary / "pages" / f"{page_sha}.json").write_bytes(page)
    (dictionary / "parser-issues").mkdir(parents=True, exist_ok=True)
    (dictionary / "parser-issues" / f"{parser_sha}.json").write_bytes(parser_issue)

    write_json(
        scientific_review / "manifest.json",
        {
            "schema": "ushso.scientific-review-assets.v1",
            "generation": generation,
            "draft_sha256": "c" * 64,
            "source_packet_sha256": "d" * 64,
            "owner_decision": None,
            "publication_authorized": False,
            "claims": [],
        },
    )
    write_json(
        scientific_conflicts / "manifest.json",
        {
            "schema": "ushso.scientific-conflicts-package.v1",
            "generation": generation,
            "source_packet_sha256": "e" * 64,
            "draft_sha256": "f" * 64,
            "review_status": "pending_owner_review",
            "owner_decision": None,
            "publication_authorized": False,
            "canonical_records_changed": 0,
            "records": [],
        },
    )
    return dictionary, scientific_review, scientific_conflicts, cache


class ArchiveGeneratorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture_root = Path(tempfile.mkdtemp(prefix="ushso-research-archive-fixture-", dir=TEMP_BASE))
        self.dictionary, self.scientific_review, self.scientific_conflicts, self.cache = make_fixture(self.fixture_root)

    def tearDown(self) -> None:
        shutil.rmtree(self.fixture_root, ignore_errors=True)

    def build_direct(self, cache: Path | None = None, lock: Path | None = None):
        module = import_builder()
        return module.build(
            [
                ("dictionary", "research-dictionaries-v1", self.dictionary),
                ("scientific-review", "scientific-review-v1", self.scientific_review),
                ("scientific-conflicts", "scientific-conflicts-v1", self.scientific_conflicts),
            ],
            cache or self.cache,
            lock or self.fixture_root / "lock.json",
        )

    def build_cli(self, cache: Path, lock: Path) -> dict:
        result = subprocess.run(
            [
                sys.executable,
                str(BUILDER),
                "--dictionary",
                str(self.dictionary),
                "--scientific-review",
                str(self.scientific_review),
                "--scientific-conflicts",
                str(self.scientific_conflicts),
                "--cache",
                str(cache),
                "--lock-output",
                str(lock),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(result.stdout)

    def stage(self, lock: Path, archive: Path) -> dict:
        self.assertTrue(STAGING.is_file(), f"missing staging script: {STAGING}")
        checker = self.fixture_root / "check-lock.mjs"
        checker.write_text(
            f'''import fs from 'node:fs/promises';
import path from 'node:path';
import {{createHash}} from 'node:crypto';
import {{stageResearchAssets, treeDigest, validateLock}} from {json.dumps(str(STAGING))};
const [, , lockFile, sourceRoot, archivePath, outputRoot, temporaryBase] = process.argv;
const lockBytes = await fs.readFile(lockFile);
const lock = JSON.parse(lockBytes);
validateLock(lock);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(root, relative = '') {{
  const result = [];
  for (const entry of (await fs.readdir(root, {{withFileTypes: true}})).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {{
    const next = relative ? `${{relative}}/${{entry.name}}` : entry.name;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full, next));
    else if (entry.isFile()) {{ const bytes = await fs.readFile(full); result.push({{relative: next, bytes: bytes.length, sha256: digest(bytes)}}); }}
    else throw Error('fixture special file');
  }}
  return result;
}}
for (const pkg of lock.packages) {{
  const files = (await walk(path.join(sourceRoot, pkg.prefix))).map(file => ({{...file, relative: `${{pkg.prefix}}/${{file.relative}}`}}));
  if (treeDigest(files) !== pkg.tree_sha256) throw Error('TREE_DIGEST:' + pkg.id);
}}
const staged = await stageResearchAssets({{lock, lockSha256: digest(lockBytes), archivePath, outputRoot, temporaryBase}});
console.log(JSON.stringify({{packages: staged.index.packages.length, archive: staged.index.source_archive_sha256}}));
''',
            encoding="utf-8",
        )
        output_root = self.fixture_root / "staged"
        temporary_base = self.fixture_root / "node-temp"
        output_root.mkdir()
        temporary_base.mkdir()
        result = subprocess.run(
            ["node", str(checker), str(lock), str(self.fixture_root), str(archive), str(output_root), str(temporary_base)],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(result.stdout)

    def assert_deterministic_archive(self, archive: Path, expected_names: list[str]) -> None:
        compressed = archive.read_bytes()
        self.assertEqual(compressed[:2], b"\x1f\x8b")
        self.assertEqual(struct.unpack("<I", compressed[4:8])[0], 0)
        with tarfile.open(archive, mode="r:gz") as tar:
            members = tar.getmembers()
            self.assertEqual([member.name for member in members], sorted(expected_names))
            self.assertTrue(all(member.isfile() for member in members))
            self.assertTrue(all(member.mode == 0o644 and member.uid == 0 and member.gid == 0 and member.mtime == 0 for member in members))
            self.assertTrue(all(member.uname == "" and member.gname == "" and member.pax_headers == {} for member in members))
        self.assertEqual(gzip.decompress(compressed)[-1024:], b"\0" * 1024)

    def test_deterministic_three_package_lock_and_staging(self) -> None:
        first_lock = self.fixture_root / "lock-a.json"
        second_lock = self.fixture_root / "lock-b.json"
        first = self.build_cli(self.cache, first_lock)
        archive = Path(first["archive"])
        archive_bytes = archive.read_bytes()
        second = self.build_cli(self.cache, second_lock)
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual(first["bytes"], second["bytes"])
        self.assertEqual(archive_bytes, archive.read_bytes())
        self.assertEqual(first_lock.read_bytes(), second_lock.read_bytes())

        lock = json.loads(first_lock.read_bytes())
        stage_result = self.stage(first_lock, archive)
        self.assertEqual(stage_result["packages"], 3)
        expected_names = []
        for package in lock["packages"]:
            package_root = self.fixture_root / package["prefix"]
            expected_names.extend(
                f"{package['prefix']}/{file.relative_to(package_root).as_posix()}"
                for file in package_root.rglob("*")
                if file.is_file()
            )
        self.assert_deterministic_archive(archive, expected_names)

    def assert_mutation_rejected(self, action) -> None:
        module = import_builder()
        page = next((self.dictionary / "pages").glob("*.json"))
        original = page.read_bytes()
        state = {"seen": 0}
        original_hash = module.sha_file

        def hooked(file: Path) -> str:
            if Path(file).resolve() == page.resolve():
                state["seen"] += 1
                if state["seen"] == 2:
                    action(page)
            return original_hash(file)

        module.sha_file = hooked
        change_cache = self.cache / "change-cache"
        change_cache.mkdir()
        lock = self.fixture_root / "mutation-lock.json"
        try:
            with self.assertRaises(ValueError) as raised:
                module.build(
                    [
                        ("dictionary", "research-dictionaries-v1", self.dictionary),
                        ("scientific-review", "scientific-review-v1", self.scientific_review),
                        ("scientific-conflicts", "scientific-conflicts-v1", self.scientific_conflicts),
                    ],
                    change_cache,
                    lock,
                )
            self.assertEqual(str(raised.exception), "SOURCE_CHANGED")
            self.assertGreaterEqual(state["seen"], 2)
            self.assertFalse(lock.exists())
        finally:
            module.sha_file = original_hash
            page.write_bytes(original)

    def test_existing_file_mutation_is_rejected(self) -> None:
        self.assert_mutation_rejected(lambda page: page.write_bytes(bytes([page.read_bytes()[0] ^ 1]) + page.read_bytes()[1:]))

    def test_added_file_after_initial_scan_is_rejected(self) -> None:
        late = self.dictionary / "late-added.txt"
        try:
            self.assert_mutation_rejected(lambda _page: late.write_bytes(b"created after source scan\n"))
        finally:
            late.unlink(missing_ok=True)

    def test_removed_file_after_initial_scan_is_rejected(self) -> None:
        self.assert_mutation_rejected(lambda page: page.unlink())

    def test_unsafe_source_path_is_rejected_before_archive(self) -> None:
        (self.dictionary / "unsafe name.txt").write_bytes(b"unsafe\n")
        with self.assertRaisesRegex(ValueError, r"^UNSAFE_SOURCE_PATH:"):
            self.build_direct()
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_imported_build_rejects_unsafe_prefix(self) -> None:
        module = import_builder()
        for prefix in ("bad prefix", "bad/name", "../bad"):
            with self.subTest(prefix=prefix):
                with self.assertRaisesRegex(ValueError, r"^UNSAFE_SOURCE_PATH:"):
                    module.build(
                        [("dictionary", prefix, self.dictionary),
                         ("scientific-review", "scientific-review-v1", self.scientific_review),
                         ("scientific-conflicts", "scientific-conflicts-v1", self.scientific_conflicts)],
                        self.cache,
                        self.fixture_root / f"unsafe-prefix-{prefix.replace('/', '_')}.json",
                    )
                self.assertEqual(list(self.cache.iterdir()), [])

    def test_manifest_replacement_between_read_and_inventory_is_rejected(self) -> None:
        module = import_builder()
        manifest = self.dictionary / "manifest.json"
        original_body = manifest.read_bytes()
        replacement = json.loads(original_body)
        replacement["variables"] = 2
        replacement_body = json.dumps(replacement, separators=(",", ":")).encode("utf-8")
        original_read = module.read_regular_bytes
        state = {"replaced": False}

        def hooked(file: Path) -> bytes:
            body = original_read(file)
            if Path(file).resolve() == manifest.resolve() and not state["replaced"]:
                manifest.write_bytes(replacement_body)
                state["replaced"] = True
            return body

        module.read_regular_bytes = hooked
        lock = self.fixture_root / "manifest-race-lock.json"
        try:
            with self.assertRaisesRegex(ValueError, r"^MANIFEST_CHANGED$"):
                module.build(
                    [("dictionary", "research-dictionaries-v1", self.dictionary),
                     ("scientific-review", "scientific-review-v1", self.scientific_review),
                     ("scientific-conflicts", "scientific-conflicts-v1", self.scientific_conflicts)],
                    self.cache,
                    lock,
                )
            self.assertTrue(state["replaced"])
            self.assertFalse(lock.exists())
            self.assertEqual(list(self.cache.iterdir()), [])
        finally:
            module.read_regular_bytes = original_read
            manifest.write_bytes(original_body)

    def test_source_root_symlink_is_rejected(self) -> None:
        source_link = self.fixture_root / "dictionary-root-link"
        source_link.symlink_to(self.dictionary, target_is_directory=True)
        module = import_builder()
        with self.assertRaisesRegex(ValueError, r"^SYMLINK_SOURCE_ROOT:"):
            module.build(
                [("dictionary", "research-dictionaries-v1", source_link),
                 ("scientific-review", "scientific-review-v1", self.scientific_review),
                 ("scientific-conflicts", "scientific-conflicts-v1", self.scientific_conflicts)],
                self.cache,
                self.fixture_root / "root-link-lock.json",
            )

    def test_source_ancestor_symlink_is_rejected(self) -> None:
        source_parent_link = self.fixture_root / "source-parent-link"
        source_parent_link.symlink_to(self.fixture_root, target_is_directory=True)
        root_through_link = source_parent_link / self.dictionary.name
        module = import_builder()
        with self.assertRaisesRegex(ValueError, r"^SYMLINK_SOURCE_ANCESTOR:"):
            module.build(
                [("dictionary", "research-dictionaries-v1", root_through_link),
                 ("scientific-review", "scientific-review-v1", self.scientific_review),
                 ("scientific-conflicts", "scientific-conflicts-v1", self.scientific_conflicts)],
                self.cache,
                self.fixture_root / "source-ancestor-lock.json",
            )

    def test_cache_and_cache_ancestor_symlinks_are_rejected(self) -> None:
        target = self.fixture_root / "cache-target"
        target.mkdir()
        cache_link = self.fixture_root / "cache-link"
        cache_link.symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, r"^SYMLINK_CACHE:"):
            self.build_direct(cache_link, self.fixture_root / "cache-link-lock.json")

        parent_target = self.fixture_root / "cache-parent-target"
        parent_target.mkdir()
        parent_link = self.fixture_root / "cache-parent-link"
        parent_link.symlink_to(parent_target, target_is_directory=True)
        nested_cache = parent_link / "nested-cache"
        (parent_target / "nested-cache").mkdir()
        with self.assertRaisesRegex(ValueError, r"^SYMLINK_CACHE:"):
            self.build_direct(nested_cache, self.fixture_root / "cache-ancestor-lock.json")

    def test_child_symlink_is_rejected(self) -> None:
        target = next(self.dictionary.glob("pages/*.json"))
        (self.dictionary / "linked-page.json").symlink_to(target)
        with self.assertRaisesRegex(ValueError, r"^SYMLINK_SOURCE:"):
            self.build_direct()

    def test_archive_collision_is_rejected_without_overwrite(self) -> None:
        lock = self.fixture_root / "collision-lock.json"
        result = self.build_cli(self.cache, lock)
        archive = Path(result["archive"])
        archive.write_bytes(b"corrupt-cache-entry")
        with self.assertRaises(ValueError) as raised:
            self.build_direct(self.cache, self.fixture_root / "collision-retry-lock.json")
        self.assertEqual(str(raised.exception), "CACHE_COLLISION")
        self.assertEqual(archive.read_bytes(), b"corrupt-cache-entry")

    def test_lock_output_remains_exclusive(self) -> None:
        lock = self.fixture_root / "exclusive-lock.json"
        self.build_direct(self.cache, lock)
        original = lock.read_bytes()
        with self.assertRaises(FileExistsError):
            self.build_direct(self.cache, lock)
        self.assertEqual(lock.read_bytes(), original)


if __name__ == "__main__":
    unittest.main(verbosity=2)
