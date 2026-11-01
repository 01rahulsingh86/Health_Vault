# DevMuse Universal Testing — Demo Repository

A small **Python FastAPI + TypeScript Playwright** application, deliberately containing a feature-branch bug for DevMuse to find. The repository has two branches, `main` and `feature/discount-rules`. The feature branch permits excessive discounts, violating the documented 0–50% rule.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q
uvicorn app.main:app --reload
```

Visit http://127.0.0.1:8000 and http://127.0.0.1:8000/docs.

Browser tests (Node.js required):

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

## Exercise the sample feature PR

```bash
git checkout feature/discount-rules
python -m devmuse.inspect --base main
python -m pytest -q
```

Ask DevMuse: "Review the changes from main to feature/discount-rules. Propose boundary tests and generate a test-only draft PR." An initial test suite passes while **missing important boundary cases**; a good testing agent should propose those cases and find the bug.

To publish both branches to your GitHub account after creating an empty repo named `devmuse-demo`:

```bash
git remote add origin https://github.com/YOUR_USERNAME/devmuse-demo.git
git push -u origin main
git push -u origin feature/discount-rules
```

Open a pull request from `feature/discount-rules` into `main` in GitHub. Do not merge: the feature branch intentionally contains a bug.

## What this demo proves

- Repository discovery (FastAPI and Playwright)
- PR diff inspection
- Test risk proposal
- Unit + API tests and optional browser tests
- A deliberately flawed change for regression test generation

The `devmuse.inspect` script is a small deterministic scaffold, **not** the autonomous multi-agent DevMuse product. Future steps add LLM reasoning, isolated execution, approval gates, and GitHub App integration.
