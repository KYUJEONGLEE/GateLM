from __future__ import annotations

from pathlib import Path
import tomllib
import unittest


class RuntimeDependencyExtrasTest(unittest.TestCase):
    def test_production_pii_extra_keeps_gpu_and_export_dependencies_out(self) -> None:
        pyproject_path = Path(__file__).resolve().parents[2] / "pyproject.toml"
        pyproject = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
        dependencies = pyproject["project"]["optional-dependencies"]["pii"]
        normalized = [dependency.lower() for dependency in dependencies]

        for required in ("numpy", "onnxruntime", "tokenizers", "transformers"):
            self.assertTrue(
                any(dependency.startswith(required) for dependency in normalized),
                f"PII runtime extra omitted {required}",
            )

        for forbidden in ("torch", "optimum", "cuda", "nvidia"):
            self.assertFalse(
                any(dependency.startswith(forbidden) for dependency in normalized),
                f"PII runtime extra must not include {forbidden}",
            )


if __name__ == "__main__":
    unittest.main()
