"""Build the Lambda bundle: `uv run python scripts/build_lambda.py`.

Installs the runtime dependencies as Linux x86_64 wheels for Python 3.11 (works from Windows
or macOS, no Docker), adds the `overhearth` package and the Lambda Web Adapter start script, and
writes `build/lambda.zip`. The zip is written here rather than by CDK so that `run.sh` keeps its
executable bit, which a zip made on Windows would lose.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
STAGE = BUILD / "lambda"
ZIP = BUILD / "lambda.zip"
SKIP = {"__pycache__"}
EXECUTABLE = {"run.sh"}


def run(*args: str) -> None:
    print("$", " ".join(args))
    subprocess.run(args, check=True, cwd=ROOT)


def main() -> None:
    shutil.rmtree(STAGE, ignore_errors=True)
    STAGE.mkdir(parents=True)
    requirements = BUILD / "requirements.txt"
    run("uv", "export", "--frozen", "--no-dev", "--no-hashes", "--no-emit-project", "-o", str(requirements))
    run(
        "uv",
        "pip",
        "install",
        "-r",
        str(requirements),
        "--target",
        str(STAGE),
        "--python-platform",
        "x86_64-manylinux2014",
        "--python-version",
        "3.11",
        "--only-binary",
        ":all:",
    )
    shutil.copytree(ROOT / "src" / "overhearth", STAGE / "overhearth", ignore=shutil.ignore_patterns(*SKIP))
    shutil.copy2(ROOT / "src" / "overhearth" / "run.sh", STAGE / "run.sh")

    ZIP.unlink(missing_ok=True)
    count = 0
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(STAGE.rglob("*")):
            if path.is_dir() or SKIP & set(path.parts):
                continue
            relative = path.relative_to(STAGE).as_posix()
            info = zipfile.ZipInfo.from_file(path, relative)
            mode = 0o755 if relative in EXECUTABLE else 0o644
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            if relative in EXECUTABLE:
                # Normalise line endings so the shebang works even after a Windows checkout.
                data = path.read_bytes().replace(b"\r\n", b"\n")
            else:
                data = path.read_bytes()
            archive.writestr(info, data)
            count += 1
    unpacked = sum(p.stat().st_size for p in STAGE.rglob("*") if p.is_file())
    zipped = ZIP.stat().st_size
    print(f"wrote {ZIP.relative_to(ROOT)}: {count} files, {zipped / 1e6:.1f} MB zipped, {unpacked / 1e6:.1f} MB in all")
    if unpacked > 250e6:
        sys.exit("the bundle is over Lambda's 250 MB unzipped limit")


if __name__ == "__main__":
    main()
