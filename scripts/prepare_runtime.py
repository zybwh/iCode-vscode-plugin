#!/usr/bin/env python3
"""Prepare an offline iCode runtime directory from a release-built PyApp binary."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Pre-bootstrap a iCode PyApp binary into a standalone runtime.")
    parser.add_argument("--binary", type=Path, required=True, help="Release-built iCode PyApp binary.")
    parser.add_argument("--target", required=True, help="VS Code target platform, e.g. linux-x64 or win32-x64.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory to write the runtime into.")
    parser.add_argument("--timeout", type=int, default=900, help="Bootstrap timeout in seconds.")
    return parser.parse_args()


def chmod_executable(path: Path) -> None:
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def run_command(argv: list[str], *, env: dict[str, str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=timeout,
        check=False,
    )


def pyapp_env(home: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["PYAPP_INSTALL_DIR_CHRYS"] = str(home / "pyapp-install")
    env["HOME"] = str(home)
    env["XDG_DATA_HOME"] = str(home / "data")
    env["XDG_CACHE_HOME"] = str(home / "cache")
    env["LOCALAPPDATA"] = str(home / "localappdata")
    env["APPDATA"] = str(home / "appdata")
    return env


def install_roots(home: Path) -> list[Path]:
    return [
        home / "pyapp-install",
        home / "data" / "pyapp" / "chrys",
        home / ".local" / "share" / "pyapp" / "chrys",
        home / "Library" / "Application Support" / "pyapp" / "chrys",
        home / "localappdata" / "pyapp" / "chrys",
        home / "appdata" / "pyapp" / "chrys",
    ]


def tree_preview(root: Path, *, max_entries: int = 160) -> str:
    if not root.exists():
        return f"{root} does not exist"
    entries = []
    for index, path in enumerate(sorted(root.rglob("*"))):
        if index >= max_entries:
            entries.append(f"... truncated after {max_entries} entries")
            break
        rel = path.relative_to(root)
        suffix = "/" if path.is_dir() else ""
        entries.append(f"{rel}{suffix}")
    return "\n".join(entries) if entries else "(empty)"


def find_install_dir(home: Path) -> Path:
    matches: list[Path] = []
    for root in install_roots(home):
        if root.exists():
            candidates = [root, *root.rglob("*")]
            matches.extend(path for path in candidates if (path / "python").is_dir())
    if not matches:
        searched = "\n".join(str(root) for root in install_roots(home))
        raise SystemExit(
            "could not find bootstrapped PyApp install dir; searched:\n"
            f"{searched}\n\n"
            "temporary HOME contents:\n"
            f"{tree_preview(home)}"
        )
    return sorted(matches, key=lambda path: len(path.parts))[-1]


def is_windows_target(target: str) -> bool:
    return target.startswith("win32-")


def write_launcher(output_dir: Path, target: str) -> Path:
    if is_windows_target(target):
        launcher = output_dir / "chrys.cmd"
        launcher.write_text(
            "@echo off\r\n"
            "setlocal\r\n"
            "set \"SCRIPT_DIR=%~dp0\"\r\n"
            "\"%SCRIPT_DIR%python\\python.exe\" -m chrys.app.cli.app %*\r\n"
            "exit /b %ERRORLEVEL%\r\n",
            encoding="utf-8",
        )
        return launcher

    launcher = output_dir / "chrys"
    launcher.write_text(
        "#!/usr/bin/env sh\n"
        "set -eu\n"
        "SCRIPT_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\n"
        "exec \"$SCRIPT_DIR/python/bin/python3\" -m chrys.app.cli.app \"$@\"\n",
        encoding="utf-8",
    )
    chmod_executable(launcher)
    return launcher


def validate_launcher(launcher: Path, target: str, timeout: int) -> str:
    if is_windows_target(target):
        argv = [str(launcher.parent / "python" / "python.exe"), "-m", "chrys.app.cli.app", "--version"]
    else:
        argv = [str(launcher), "--version"]
    result = run_command(argv, env=os.environ.copy(), timeout=timeout)
    sys.stdout.write(result.stdout)
    if result.returncode != 0:
        raise SystemExit(f"runtime launcher failed with exit code {result.returncode}")
    version = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
    if not version:
        raise SystemExit("runtime launcher did not print a version")
    return version


def main() -> None:
    args = parse_args()
    binary = args.binary.resolve()
    if not binary.is_file():
        raise SystemExit(f"binary not found: {binary}")
    if not is_windows_target(args.target):
        chmod_executable(binary)

    with tempfile.TemporaryDirectory(prefix="chrys-pyapp-") as tmp:
        home = Path(tmp) / "home"
        home.mkdir(parents=True)
        result = run_command([str(binary), "--version"], env=pyapp_env(home), timeout=args.timeout)
        sys.stdout.write(result.stdout)
        if result.returncode != 0:
            raise SystemExit(f"PyApp bootstrap failed with exit code {result.returncode}")

        install_dir = find_install_dir(home)
        output_dir = args.output_dir.resolve()
        if output_dir.exists():
            shutil.rmtree(output_dir)
        shutil.copytree(install_dir, output_dir, symlinks=True)
        launcher = write_launcher(output_dir, args.target)
        version = validate_launcher(launcher, args.target, args.timeout)
        (output_dir / "STANDALONE_RUNTIME.json").write_text(
            json.dumps(
                {
                    "name": "chrys",
                    "version": version,
                    "target": args.target,
                    "launcher": launcher.name,
                    "source": "release-pyapp-prebootstrapped-by-vsix-cd",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"runtime={output_dir}")


if __name__ == "__main__":
    main()
