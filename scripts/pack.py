"""Build icode-vscode-plugin VSIX package."""

import argparse
import hashlib
import json
import os
import stat
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

VALID_TARGETS = {
    "linux-x64",
    "linux-arm64",
    "darwin-x64",
    "darwin-arm64",
    "win32-x64",
}

CONTENT_TYPES_TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="css" ContentType="text/css"/>
  <Default Extension="exe" ContentType="application/octet-stream"/>
  <Default Extension="cmd" ContentType="text/plain"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="webp" ContentType="image/webp"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="txt" ContentType="text/plain"/>
  <Default Extension="xml" ContentType="application/xml"/>
{overrides}
</Types>"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build icode-vscode-plugin VSIX package.")
    parser.add_argument(
        "--target",
        choices=sorted(VALID_TARGETS),
        help="VS Code target platform for a platform-specific VSIX.",
    )
    parser.add_argument(
        "--binary",
        type=Path,
        help="Path to a prebuilt iCode binary to bundle in a platform-specific VSIX.",
    )
    parser.add_argument(
        "--runtime",
        type=Path,
        help="Path to a prebuilt standalone iCode runtime directory to bundle in a platform-specific VSIX.",
    )
    return parser.parse_args()


def content_types(binary_name: str | None) -> str:
    overrides = ""
    if binary_name == "chrys":
        overrides = '  <Override PartName="/extension/bin/chrys" ContentType="application/octet-stream"/>\n'
    return CONTENT_TYPES_TEMPLATE.format(overrides=overrides.rstrip())


def zip_write_executable(z: zipfile.ZipFile, source: Path, arcname: str) -> None:
    info = zipfile.ZipInfo.from_file(source, arcname)
    if source.name != "chrys.exe":
        mode = stat.S_IFREG | 0o755
        info.external_attr = mode << 16
    with open(source, "rb") as f:
        z.writestr(info, f.read(), zipfile.ZIP_DEFLATED)


def runtime_launcher_name(target: str) -> str:
    return "chrys.cmd" if target == "win32-x64" else "chrys"


def zip_write_directory(z: zipfile.ZipFile, source_dir: Path, arcdir: str) -> None:
    for source in sorted(source_dir.rglob("*")):
        if not source.is_file():
            continue
        arcname = f"{arcdir}/{source.relative_to(source_dir).as_posix()}"
        z.write(source, arcname)


def validate_frontend_licenses(ext_dir: Path) -> list[Path]:
    """Reject missing, stale or unreviewed bundled dependency notices."""
    required = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "ASSET_PROVENANCE.md",
                "licenses/components.json"]
    for name in required:
        if not (ext_dir / name).is_file():
            raise SystemExit(f"required license document missing: {name}")
    components = json.loads((ext_dir / "licenses/components.json").read_text())
    lock = json.loads((ext_dir / "package-lock.json").read_text())
    approved = set()
    paths = [ext_dir / name for name in required]
    for component in components:
        name = component["name"]
        package_path = component.get("packagePath", f"node_modules/{name}")
        locked = lock["packages"].get(package_path, {})
        if locked.get("version") != component["version"]:
            raise SystemExit(f"license inventory version mismatch: {name}")
        license_path = ext_dir / component["file"]
        if not license_path.is_file():
            raise SystemExit(f"dependency license missing: {name}")
        if hashlib.sha256(license_path.read_bytes()).hexdigest() != component["sha256"]:
            raise SystemExit(f"dependency license hash mismatch: {name}")
        approved.add(package_path)
        paths.append(license_path)
    bundled = set()
    for bundle in ["extension.js", "webview.js"]:
        metadata = ext_dir / "dist" / f"{bundle}.meta.json"
        if not metadata.is_file():
            raise SystemExit("build dependency inventory missing; run npm run build")
        for source in json.loads(metadata.read_text())["inputs"]:
            parts = source.replace("\\", "/").split("node_modules/")
            if len(parts) == 1:
                continue
            package_parts = parts[-1].split("/")
            name = "/".join(package_parts[:2]) if package_parts[0].startswith("@") else package_parts[0]
            bundled.add("node_modules/".join(parts[:-1]) + "node_modules/" + name)
    if bundled != approved:
        raise SystemExit(f"bundled dependency license inventory mismatch: bundled={sorted(bundled)}, approved={sorted(approved)}")
    return paths


def validate_runtime_licenses(runtime_path: Path) -> None:
    candidates = list(runtime_path.glob("python/**/chrys-*.dist-info/licenses"))
    if not any(all((directory / name).is_file() and (directory / name).stat().st_size
                   for name in ["LICENSE", "NOTICE"]) for directory in candidates):
        raise SystemExit("bundled runtime must retain iCode dist-info LICENSE and NOTICE")


def main() -> None:
    args = parse_args()
    if args.binary and args.runtime:
        raise SystemExit("--binary and --runtime are mutually exclusive")
    if bool(args.target) != (bool(args.binary) or bool(args.runtime)):
        raise SystemExit("--target must be provided with --binary or --runtime")

    this_dir = Path(__file__).resolve().parent
    ext_dir = this_dir.parent  # vscode/

    license_paths = validate_frontend_licenses(ext_dir)
    pkg_path = ext_dir / "package.json"
    with open(pkg_path) as f:
        pkg = json.load(f)
    nls_path = ext_dir / "package.nls.json"
    nls = json.loads(nls_path.read_text()) if nls_path.exists() else {}

    def resolve_nls(value: str) -> str:
        if value.startswith("%") and value.endswith("%"):
            return nls.get(value[1:-1], value)
        return value

    publisher = pkg["publisher"]
    name = pkg["name"]
    version = pkg["version"]
    target_suffix = f"-{args.target}" if args.target else ""
    vsix_name = f"{name}-{version}{target_suffix}.vsix"
    vsix_path = ext_dir / vsix_name
    binary_name = None
    runtime_path = None
    runtime_launcher = None
    binary_notices = []
    if args.binary:
        binary_path = args.binary.resolve()
        if not binary_path.is_file():
            raise SystemExit(f"bundled binary not found: {binary_path}")
        for notice_name in ["LICENSE", "NOTICE"]:
            notice = binary_path.parent / notice_name
            if not notice.is_file() or not notice.stat().st_size:
                raise SystemExit(f"raw binary requires adjacent upstream {notice_name}")
            binary_notices.append(notice)
        binary_name = "chrys.exe" if args.target == "win32-x64" else "chrys"
        if binary_name == "chrys.exe" and binary_path.name != "chrys.exe":
            raise SystemExit("win32-x64 platform VSIX expects a chrys.exe binary")
        if binary_name == "chrys" and binary_path.name != "chrys":
            raise SystemExit(f"{args.target} platform VSIX expects a chrys binary")
    elif args.runtime:
        runtime_path = args.runtime.resolve()
        if not runtime_path.is_dir():
            raise SystemExit(f"bundled runtime directory not found: {runtime_path}")
        validate_runtime_licenses(runtime_path)
        runtime_launcher = runtime_launcher_name(args.target)
        if not (runtime_path / runtime_launcher).is_file():
            raise SystemExit(f"{args.target} platform VSIX expects runtime launcher {runtime_launcher}")
        binary_path = None
    else:
        binary_path = None

    identity_target = f' TargetPlatform="{escape(args.target)}"' if args.target else ""
    runtime_asset = (
        f'<Asset Type="Microsoft.VisualStudio.Code.Installable" Path="extension/runtime/{runtime_launcher}"/>'
        if runtime_launcher
        else ""
    )
    binary_asset = (
        f'<Asset Type="Microsoft.VisualStudio.Code.Installable" Path="extension/bin/{binary_name}"/>'
        if binary_name
        else ""
    )
    manifest = f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Id="{escape(publisher)}.{escape(name)}" Version="{escape(version)}" Publisher="{escape(publisher)}"{identity_target}/>
    <DisplayName>{escape(resolve_nls(pkg.get("displayName", name)))}</DisplayName>
    <Description>{escape(resolve_nls(pkg.get("description", "")))}</Description>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json"/>
    <Asset Type="Microsoft.VisualStudio.Code.Installable" Path="extension/dist/extension.js"/>
    <Asset Type="Microsoft.VisualStudio.Code.Installable" Path="extension/dist/webview.js"/>
    <Asset Type="Microsoft.VisualStudio.Code.Installable" Path="extension/dist/theme.css"/>
    <Asset Type="Microsoft.VisualStudio.Code.Installable" Path="extension/dist/assets"/>
    {binary_asset}
    {runtime_asset}
  </Assets>
</PackageManifest>"""

    with zipfile.ZipFile(vsix_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types(binary_name))
        z.writestr("extension.vsixmanifest", manifest)
        z.writestr("extension/package.json", json.dumps(pkg, indent=2))
        for nls_file in sorted(ext_dir.glob("package.nls*.json")):
            z.write(nls_file, f"extension/{nls_file.name}")
        for document in license_paths:
            z.write(document, f"extension/{document.relative_to(ext_dir).as_posix()}")
        for document in binary_notices:
            z.write(document, f"extension/runtime-licenses/{document.name}")
        readme_path = ext_dir / "README.md"
        if readme_path.exists():
            z.write(readme_path, "extension/README.md")
        release_checklist_path = ext_dir / "RELEASE_CHECKLIST.md"
        if release_checklist_path.exists():
            z.write(release_checklist_path, "extension/RELEASE_CHECKLIST.md")
        design_decisions_path = ext_dir / "DESIGN_DECISIONS.md"
        if design_decisions_path.exists():
            z.write(design_decisions_path, "extension/DESIGN_DECISIONS.md")
        capability_plan_path = ext_dir / "FEATURE_PARITY.md"
        if capability_plan_path.exists():
            z.write(capability_plan_path, "extension/FEATURE_PARITY.md")
        z.write(ext_dir / "dist" / "extension.js", "extension/dist/extension.js")
        z.write(ext_dir / "dist" / "webview.js", "extension/dist/webview.js")
        z.write(ext_dir / "dist" / "theme.css", "extension/dist/theme.css")
        assets_dir = ext_dir / "dist" / "assets"
        if assets_dir.exists():
            zip_write_directory(z, assets_dir, "extension/dist/assets")
        if binary_path and binary_name:
            zip_write_executable(z, binary_path, f"extension/bin/{binary_name}")
        if runtime_path:
            zip_write_directory(z, runtime_path, "extension/runtime")
        resources_dir = ext_dir / "resources"
        if resources_dir.exists():
            for path in resources_dir.rglob("*"):
                if path.is_file():
                    z.write(path, f"extension/resources/{path.relative_to(resources_dir)}")
    size = os.path.getsize(vsix_path)
    print(f"{vsix_name}  ({size:,} bytes)")


if __name__ == "__main__":
    main()
