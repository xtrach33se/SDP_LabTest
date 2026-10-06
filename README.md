# RepoLens — Repo Analysis Tool (RAT)

RepoLens is a full-stack Git repository analytics dashboard. It indexes complete Git histories, calculates the COMS3011A RAT metrics for repositories, directories, files, commit sets, and authors, and presents the results through a filterable web interface.

## Quick start

Requirements: Git, Node.js 18+ (Node.js 20 LTS recommended), npm, and Python 3/build tools for `better-sqlite3` if a prebuilt binary is unavailable.

```bash
git clone https://github.com/xtrach33se/SDP_LabTest.git
cd SDP_LabTest
./start.sh
```

Then open <http://localhost:5173>. The script installs missing root, server, and client dependencies before starting both development servers.

Equivalent manual commands:

```bash
npm run setup
npm run dev
```

If native SQLite installation selects an incompatible Python environment, run:

```bash
npm rebuild --prefix server better-sqlite3 --python=/usr/bin/python3
```

## Production mode

```bash
npm run setup
npm run build
npm start
```

The Express server serves both the API and built React application at <http://localhost:3001> as one deployment unit. `PORT` can override the production port.

## Using RepoLens

1. Select **Add repository**.
2. Deep-clone a public HTTPS/SSH Git URL, or upload a ZIP (maximum 500 MB) containing the repository’s `.git` directory.
3. Wait for clone/extraction, commit parsing, and metric computation to complete.
4. Explore the overview, virtualised file tree, authors, commits, and timeline.
5. Filter globally by canonical author, path, date range, or manually selected commits. Filters persist per repository and are encoded in the URL for sharing.
6. On **Authors**, select identities to merge or apply the repository’s `.mailmap`.
7. Export filtered files, commits, or authors as CSV. Press `Ctrl+K` (`Cmd+K` on macOS) for quick navigation.
8. Use **Settings** to rename, delete, refresh URL-backed repositories, and view ingestion statistics.

## Metrics

For selected commits `H` and object `o` (file, directory, or repository):

- **Lines added (`l⁺`)**: sum of added lines.
- **Lines removed (`l⁻`)**: sum of removed lines.
- **Growth (`δ`)**: `l⁺ − l⁻`.
- **Churn (`λ`)**: `l⁺ + l⁻`.
- **Modifications (`n`)**: commits in `H` where the object has positive churn.
- **Modification frequency (`η`)**: `n / |H|`, or zero for an empty set.
- **Churn rate (`ρ`)**: `λ / |H|`, or zero for an empty set.
- **Author churn (`λₐ`)**: churn contributed by a resolved canonical author.
- **Author ownership (`cₐ`)**: `λₐ / λ`, or zero when total churn is zero.

Directory metrics recursively include descendant files. Repository metrics apply the same calculation to the root. Binary Git numstat entries contribute zero lines. Authors are resolved through `.mailmap` and manual merge rules.

## Architecture

```text
React + Vite + React Query
          │ /api (Vite proxy in development)
          ▼
Express + TypeScript
          │
          ├── streaming git log --numstat parser / Worker Thread
          ├── ZIP and full-depth URL ingestion
          └── SQLite (WAL, indexed commits/diffs, precomputed file_stats)
```

Large file results can stream as NDJSON. File and commit interfaces use list virtualisation. Filters and metric calculations are performed against concrete commit sets in SQLite.

## Verification and tests

```bash
npm test                 # deterministic five-commit synthetic repository suite
npm run verify:cjson     # cJSON reference commit and exact supplied totals
npm run verify           # cJSON, Redis, and Git reference commits (large download/index)
```

The synthetic suite checks exact file, nested-directory, repository, commit-set, empty-commit, and author-merge metrics. The verification script uses these fixed reference revisions:

- cJSON `6d9f2443ab07`
- Redis `b540ca49cba8`
- Git `5a7d1e8045ce`

Clones and verification databases are stored in ignored `.verification-repos/` and `.verification/` directories.

## Project layout

- `client/` — React dashboard, charts, filters, CSV export, themes, and navigation.
- `server/` — Express API, Git ingestion, metric engine, SQLite schema, and tests.
- `scripts/verify-metrics.ts` — reference-repository verification runner.
- `start.sh` — one-command local development startup.

Runtime databases and imported temporary files are intentionally excluded from Git.
