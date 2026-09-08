#!/usr/bin/env python3
"""Build a deterministic, content-addressed research source archive and lock.

The builder deliberately keeps lock creation exclusive. Source roots and the
cache must be existing, symlink-free directory trees. The source inventory is
hashed before and after archive creation so additions, removals, and content
changes cannot be silently left out of a successful build.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import stat
import tarfile
import tempfile
from pathlib import Path


MAX_FILE_BYTES = 25 * 1024 * 1024
SAFE_PATH = re.compile(
    r"^(?!/)(?!.*\\)(?!.*(?:^|/)\.\.?($|/))[A-Za-z0-9._~+@%:-]+(?:/[A-Za-z0-9._~+@%:-]+)*$"
)


def fail(code: str, detail: object = "") -> None:
    if detail:
        raise ValueError(f"{code}:{detail}")
    raise ValueError(code)


def absolute_path(value: str | os.PathLike[str], require_absolute: bool = False) -> Path:
    path = Path(value)
    if require_absolute and not path.is_absolute():
        fail("EXISTING_ABSOLUTE_CACHE_REQUIRED")
    if not path.is_absolute():
        path = Path.cwd() / path
    # abspath normalizes lexical '.' and '..' without resolving symlinks.
    return Path(os.path.abspath(os.fspath(path)))


def _lstat(path: Path, code: str) -> os.stat_result:
    try:
        return os.lstat(path)
    except FileNotFoundError:
        if code == "SOURCE_CHANGED":
            fail(code)
        fail(code, path)
    except OSError as error:
        if code == "SOURCE_CHANGED":
            fail(code)
        fail(code, f"{path}:{error.errno}")
    raise AssertionError("unreachable")


def _is_same_file(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        left.st_dev == right.st_dev
        and left.st_ino == right.st_ino
        and left.st_mode == right.st_mode
        and left.st_size == right.st_size
    )


def _open_regular(path: Path) -> tuple[int, os.stat_result]:
    before = _lstat(path, "SOURCE_CHANGED")
    if stat.S_ISLNK(before.st_mode):
        fail("SYMLINK_SOURCE", path)
    if not stat.S_ISREG(before.st_mode):
        fail("SPECIAL_SOURCE", path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = -1
    try:
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
    except OSError as error:
        if descriptor >= 0:
            os.close(descriptor)
        fail("SOURCE_CHANGED")
    if not _is_same_file(before, opened):
        os.close(descriptor)
        fail("SOURCE_CHANGED", path)
    return descriptor, opened


def sha_file(file: Path) -> str:
    """Hash one regular source file without following a symlink."""
    descriptor, opened = _open_regular(file)
    digest = hashlib.sha256()
    try:
        with os.fdopen(descriptor, "rb", closefd=True) as stream:
            descriptor = -1
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        after = _lstat(file, "SOURCE_CHANGED")
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if not _is_same_file(opened, after):
        fail("SOURCE_CHANGED", file)
    return digest.hexdigest()


def read_regular_bytes(file: Path) -> bytes:
    descriptor, opened = _open_regular(file)
    try:
        with os.fdopen(descriptor, "rb", closefd=True) as stream:
            descriptor = -1
            body = stream.read()
        after = _lstat(file, "SOURCE_CHANGED")
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if not _is_same_file(opened, after):
        fail("SOURCE_CHANGED", file)
    return body


def validate_source_root(value: str | os.PathLike[str]) -> Path:
    """Reject source roots and every lexical ancestor that is a symlink."""
    path = absolute_path(value)
    for current in reversed(path.parents):
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            fail("SOURCE_ROOT_MISSING", current)
        except OSError as error:
            fail("SOURCE_ROOT_MISSING", f"{current}:{error.errno}")
        if stat.S_ISLNK(info.st_mode):
            fail("SYMLINK_SOURCE_ANCESTOR", current)
        if not stat.S_ISDIR(info.st_mode):
            fail("SOURCE_ROOT_ANCESTOR", current)
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        fail("SOURCE_ROOT_MISSING", path)
    except OSError as error:
        fail("SOURCE_ROOT_MISSING", f"{path}:{error.errno}")
    if stat.S_ISLNK(info.st_mode):
        fail("SYMLINK_SOURCE_ROOT", path)
    if not stat.S_ISDIR(info.st_mode):
        fail("SOURCE_ROOT", path)
    return path


def validate_cache(value: str | os.PathLike[str]) -> Path:
    """Require an existing absolute cache and symlink-free ancestors."""
    path = Path(value)
    if not path.is_absolute():
        fail("EXISTING_ABSOLUTE_CACHE_REQUIRED")
    path = absolute_path(path)
    for current in reversed(path.parents):
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            fail("EXISTING_ABSOLUTE_CACHE_REQUIRED", current)
        except OSError as error:
            fail("EXISTING_ABSOLUTE_CACHE_REQUIRED", f"{current}:{error.errno}")
        if stat.S_ISLNK(info.st_mode):
            fail("SYMLINK_CACHE", current)
        if not stat.S_ISDIR(info.st_mode):
            fail("EXISTING_ABSOLUTE_CACHE_REQUIRED", current)
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        fail("EXISTING_ABSOLUTE_CACHE_REQUIRED", path)
    except OSError as error:
        fail("EXISTING_ABSOLUTE_CACHE_REQUIRED", f"{path}:{error.errno}")
    if stat.S_ISLNK(info.st_mode):
        fail("SYMLINK_CACHE", path)
    if not stat.S_ISDIR(info.st_mode):
        fail("EXISTING_ABSOLUTE_CACHE_REQUIRED", path)
    return path


def assert_safe_path(value: str) -> None:
    # Keep this expression in lockstep with staging's SAFE_PATH. Archive paths
    # and source-relative paths therefore share the same alphabet and traversal
    # rejection before either archive or lock bytes are produced.
    if not SAFE_PATH.fullmatch(value):
        fail("UNSAFE_SOURCE_PATH", value)


def source_inventory(root: Path, prefix: str) -> list[tuple[str, Path, int, str]]:
    """Return a sorted (archive path, source path, bytes, sha256) inventory."""
    assert_safe_path(prefix)
    if "/" in prefix:
        fail("UNSAFE_SOURCE_PATH", prefix)
    validate_source_root(root)
    files: list[tuple[str, Path, int, str]] = []

    def visit(directory: Path, relative_directory: str = "") -> None:
        try:
            with os.scandir(directory) as iterator:
                entries = sorted(iterator, key=lambda entry: entry.name)
        except OSError as error:
            fail("SOURCE_CHANGED", f"{directory}:{error.errno}")
        for entry in entries:
            relative = f"{relative_directory}/{entry.name}" if relative_directory else entry.name
            assert_safe_path(relative)
            child = Path(entry.path)
            try:
                info = os.lstat(child)
            except FileNotFoundError:
                fail("SOURCE_CHANGED", child)
            except OSError as error:
                fail("SOURCE_CHANGED", f"{child}:{error.errno}")
            if stat.S_ISLNK(info.st_mode):
                fail("SYMLINK_SOURCE", relative)
            if stat.S_ISDIR(info.st_mode):
                visit(child, relative)
                continue
            if not stat.S_ISREG(info.st_mode):
                fail("SPECIAL_SOURCE", relative)
            if info.st_size > MAX_FILE_BYTES:
                fail("ASSET_TOO_LARGE", relative)
            digest = sha_file(child)
            files.append((f"{prefix}/{relative}", child, info.st_size, digest))

    visit(root)
    return sorted(files, key=lambda row: row[0])


def inventory_signature(rows: list[tuple[str, Path, int, str]]) -> tuple[tuple[str, int, str], ...]:
    return tuple((name, size, digest) for name, _file, size, digest in rows)


def verify_source_inventories(source_packages: list[dict]) -> None:
    for package in source_packages:
        current = source_inventory(package["root"], package["prefix"])
        if inventory_signature(current) != package["signature"]:
            fail("SOURCE_CHANGED")


def write_source_file(tar: tarfile.TarFile, info: tarfile.TarInfo, file: Path, size: int, digest: str) -> None:
    descriptor, opened = _open_regular(file)
    try:
        with os.fdopen(descriptor, "rb", closefd=True) as content:
            descriptor = -1
            tar.addfile(info, content)
        # Retain the per-entry check in addition to the complete post-build
        # inventory. This narrows the race window for a replacement while the
        # entry is streamed into the archive.
        if opened.st_size != size or sha_file(file) != digest:
            fail("SOURCE_CHANGED")
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def build(roots, cache, lock_file):
    cache = validate_cache(cache)
    lock_file = Path(lock_file)
    packages = []
    source_packages = []
    files: list[tuple[str, Path, int, str]] = []
    generation = None

    for kind, prefix, root_value in roots:
        root = validate_source_root(root_value)
        manifest_path = root / "manifest.json"
        try:
            manifest_bytes = read_regular_bytes(manifest_path)
            manifest = json.loads(manifest_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError):
            fail("INVALID_MANIFEST", manifest_path)
        generation_value = manifest["generation"]
        if generation is None:
            generation = generation_value
        if generation != generation_value:
            fail("GENERATION_MISMATCH")

        rows = source_inventory(root, prefix)
        source_packages.append({"root": root, "prefix": prefix, "signature": inventory_signature(rows)})
        files.extend(rows)
        manifest_row = next((row for row in rows if row[0] == f"{prefix}/manifest.json"), None)
        if manifest_row is None:
            fail("SOURCE_CHANGED")
        _name, _manifest_file, _manifest_bytes, manifest_sha256 = manifest_row
        if hashlib.sha256(manifest_bytes).hexdigest() != manifest_sha256:
            fail("MANIFEST_CHANGED")
        tree = hashlib.sha256()
        for name, _file, size, digest in rows:
            tree.update(f"{name}\0{size}\0{digest}\n".encode("utf-8"))
        package = {
            "kind": kind,
            "id": kind + "-review-package",
            "prefix": prefix,
            "manifest_path": f"{prefix}/manifest.json",
            "manifest_sha256": manifest_sha256,
            "tree_sha256": tree.hexdigest(),
            "file_count": len(rows),
            "bytes": sum(row[2] for row in rows),
            "generation": generation_value,
            "status": {
                "review_status": "pending_owner_review",
                "publication_authorized": False,
                "scientific_applicability": "unresolved",
            },
        }
        if kind == "scientific-review":
            package["claim_count"] = len(manifest["claims"])
        else:
            package["record_count"] = len(manifest["records"])
        packages.append(package)

    descriptor, temporary = tempfile.mkstemp(prefix=".research-archive-partial-", dir=cache)
    try:
        with os.fdopen(descriptor, "wb") as raw:
            descriptor = -1
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=6) as gz:
                with tarfile.open(mode="w|", fileobj=gz, format=tarfile.USTAR_FORMAT) as tar:
                    for name, file, size, digest in sorted(files, key=lambda row: row[0]):
                        info = tarfile.TarInfo(name)
                        info.size = size
                        info.mode = 0o644
                        info.uid = info.gid = info.mtime = 0
                        info.uname = info.gname = ""
                        write_source_file(tar, info, file, size, digest)
            raw.flush()
            os.fsync(raw.fileno())

        # Unlike the per-entry check, this complete post-build inventory also
        # catches files created or removed after the initial source walk.
        verify_source_inventories(source_packages)
        validate_cache(cache)
        digest = sha_file(Path(temporary))
        size = Path(temporary).stat().st_size
        name = f"research-assets-{digest}.tar.gz"
        archive = cache / name
        validate_cache(cache)
        try:
            os.link(temporary, archive)
        except FileExistsError:
            if archive.is_symlink() or not archive.is_file() or archive.stat().st_size != size or sha_file(archive) != digest:
                fail("CACHE_COLLISION")

        # Check once more after CAS installation before creating the lock.
        verify_source_inventories(source_packages)
        validate_cache(cache)
        lock = {
            "format": "ushso.research-assets-lock.v1",
            "source": {
                "archive": {
                    "path": str(archive),
                    "sha256": digest,
                    "bytes": size,
                    "url": "https://github.com/ajhcs/ushso/releases/download/research-assets-"
                    + digest[:16]
                    + "/"
                    + name,
                }
            },
            "packages": packages,
            "cloudflare": {
                "max_files": 100000,
                "max_file_bytes": MAX_FILE_BYTES,
                "plan_qualification": "required_before_deployment",
            },
        }
        # Keep this intentionally exclusive: an existing lock is never
        # overwritten, even when its bytes would be identical.
        with lock_file.open("x") as output:
            json.dump(lock, output, indent=2)
            output.write("\n")
        return {"archive": str(archive), "sha256": digest, "bytes": size, "lock": str(lock_file), "files": len(files)}
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        Path(temporary).unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dictionary", required=True)
    parser.add_argument("--scientific-review", required=True)
    parser.add_argument("--scientific-conflicts", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--lock-output", required=True)
    args = parser.parse_args()
    print(
        json.dumps(
            build(
                [
                    ("dictionary", "research-dictionaries-v1", args.dictionary),
                    ("scientific-review", "scientific-review-v1", args.scientific_review),
                    ("scientific-conflicts", "scientific-conflicts-v1", args.scientific_conflicts),
                ],
                args.cache,
                args.lock_output,
            )
        )
    )


if __name__ == "__main__":
    main()
