"""Tiny deterministic repository profile and diff analyzer for the first DevMuse exercise."""
import argparse
import json
import subprocess
from pathlib import Path

def inspect(repo: Path, base: str):
    detectors = {"Python/FastAPI": ["requirements.txt", "app/main.py"], "TypeScript/Playwright": ["package.json", "playwright.config.ts"], "Java/Maven": ["pom.xml"], "Java/Gradle": ["build.gradle", "build.gradle.kts"]}
    frameworks = [name for name, markers in detectors.items() if any((repo / marker).exists() for marker in markers)]
    changed = subprocess.run(["git", "diff", "--name-only", f"{base}...HEAD"], cwd=repo, capture_output=True, text=True, check=True).stdout.splitlines()
    risks = []
    if any("core.py" in name for name in changed):
        risks.append({"priority": "high", "scenario": "Validate upper/lower discount boundaries (negative, 0, 50, 51, 100)"})
        risks.append({"priority": "high", "scenario": "Check percentage values never produce negative totals"})
    if any("main.py" in name for name in changed):
        risks.append({"priority": "medium", "scenario": "Verify API status codes and response contract"})
    return {"repository": str(repo), "frameworks": frameworks, "base": base, "changed_files": changed, "suggested_tests": risks}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    parser.add_argument("--base", default="main")
    args = parser.parse_args()
    print(json.dumps(inspect(Path(args.repo).resolve(), args.base), indent=2))
