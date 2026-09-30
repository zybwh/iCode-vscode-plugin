"""Exercise license gates and actual archive contents without a backend build."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


class LicensePackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ["scripts/pack.py", "package.json", "package-lock.json", "LICENSE", "NOTICE",
                     "THIRD_PARTY_NOTICES.md", "ASSET_PROVENANCE.md", "README.md",
                     "RELEASE_CHECKLIST.md", "DESIGN_DECISIONS.md"]:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        shutil.copytree(ROOT / "licenses", self.root / "licenses")
        (self.root / "dist").mkdir()
        for bundle, inputs in [("extension.js", {}), ("webview.js", {
            "node_modules/marked/lib/marked.esm.js": {},
            "node_modules/dompurify/dist/purify.es.mjs": {},
        }), ("diagrams.js", {
            "node_modules/beautiful-mermaid/src/ascii/index.ts": {},
        })]:
            (self.root / "dist" / bundle).write_text("// packaging fixture\n")
            (self.root / "dist" / f"{bundle}.meta.json").write_text(json.dumps({"inputs": inputs}))
        (self.root / "dist/theme.css").write_text("")

    def pack(self, *args):
        return subprocess.run([sys.executable, str(self.root / "scripts/pack.py"), *args],
                              capture_output=True, text=True, encoding="utf-8")

    def test_universal_contains_complete_notices(self):
        result = self.pack()
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(next(self.root.glob("*.vsix"))) as archive:
            for name in ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "ASSET_PROVENANCE.md",
                         "licenses/components.json", "licenses/beautiful-mermaid-LICENSE.txt", "licenses/marked-LICENSE.txt", "licenses/dompurify-LICENSE.txt"]:
                self.assertEqual(archive.read(f"extension/{name}"), (ROOT / name).read_bytes())
            self.assertNotIn("extension/runtime", archive.namelist())

    def test_missing_or_altered_license_blocks_packaging(self):
        notice = self.root / "licenses/marked-LICENSE.txt"
        notice.write_text("truncated notice")
        self.assertIn("hash mismatch", self.pack().stderr)
        notice.unlink()
        self.assertIn("license missing", self.pack().stderr)
        self.assertFalse(list(self.root.glob("*.vsix")))

    def test_dependency_upgrade_requires_notice_review(self):
        lock = self.root / "package-lock.json"
        data = json.loads(lock.read_text(encoding="utf-8"))
        data["packages"]["node_modules/marked"]["version"] = "999.0.0"
        lock.write_text(json.dumps(data))
        self.assertIn("version mismatch", self.pack().stderr)

    def test_new_bundled_dependency_requires_notice(self):
        meta = self.root / "dist/extension.js.meta.json"
        meta.write_text(json.dumps({"inputs": {"node_modules/@example/new/index.js": {}}}))
        self.assertIn("inventory mismatch", self.pack().stderr)
        meta.unlink()
        self.assertIn("run npm run build", self.pack().stderr)

    def test_all_platform_runtime_notices_are_preserved(self):
        for target in ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]:
            with self.subTest(target=target):
                runtime = self.root / target
                runtime.mkdir()
                launcher = "chrys.cmd" if target.startswith("win32") else "chrys"
                (runtime / launcher).write_text("fixture launcher")
                self.assertIn("LICENSE and NOTICE", self.pack("--target", target, "--runtime", str(runtime)).stderr)
                site = "python/Lib/site-packages" if target.startswith("win32") else "python/lib/python3.14/site-packages"
                licenses = runtime / site / "chrys-0.27.1.dist-info/licenses"
                licenses.mkdir(parents=True)
                (licenses / "LICENSE").write_text("upstream license")
                (licenses / "NOTICE").write_text("upstream third-party notices")
                dep = runtime / site / "dependency.dist-info/licenses/LICENSE"
                dep.parent.mkdir(parents=True)
                dep.write_text("dependency copyright and terms")
                result = self.pack("--target", target, "--runtime", str(runtime))
                self.assertEqual(result.returncode, 0, result.stderr)
                with zipfile.ZipFile(next(self.root.glob(f"*-{target}.vsix"))) as archive:
                    for path in [licenses / "LICENSE", licenses / "NOTICE", dep]:
                        self.assertEqual(archive.read(f"extension/runtime/{path.relative_to(runtime).as_posix()}"), path.read_bytes())

    def test_raw_binary_requires_and_includes_upstream_notices(self):
        binary = self.root / "binary/chrys"
        binary.parent.mkdir()
        binary.write_bytes(b"fixture binary")
        args = ("--target", "darwin-arm64", "--binary", str(binary))
        self.assertIn("adjacent upstream LICENSE", self.pack(*args).stderr)
        for name in ["LICENSE", "NOTICE"]:
            (binary.parent / name).write_text(f"upstream {name}")
        result = self.pack(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(next(self.root.glob("*-darwin-arm64.vsix"))) as archive:
            identity = ET.fromstring(archive.read("extension.vsixmanifest")).find("{*}Metadata/{*}Identity")
            self.assertEqual(identity.attrib["Id"], "icode.icode-vscode-plugin")
            self.assertEqual(identity.attrib["Publisher"], "icode")
            for name in ["LICENSE", "NOTICE"]:
                self.assertEqual(archive.read(f"extension/runtime-licenses/{name}").decode(), f"upstream {name}")


if __name__ == "__main__":
    unittest.main()
