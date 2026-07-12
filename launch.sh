#!/usr/bin/env bash
# Interactive go-live wizard: authenticates npm + GitHub CLI, publishes
# delta-sync-sdk, then creates and pushes this repo as a public GitHub repo
# with agent-discoverability topics attached.
#
# Run this yourself, in your own terminal: npm login and gh auth login --web
# both need YOUR live input (password/2FA/browser approval) — nothing else
# can complete those steps for you. Every irreversible step below (publish,
# repo creation) pauses for a y/N confirmation before it runs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(cd "${SCRIPT_DIR}/../foundry-sdk" && pwd)"
BOILERPLATE_DIR="${SCRIPT_DIR}"
REPO_NAME="rag-reliability-boilerplate"
TOPICS=(mcp-server langchain-tool rag agentic-infrastructure evals)

confirm() {
    read -r -p "$1 [y/N] " reply
    case "$reply" in
        [yY][eE][sS]|[yY]) return 0 ;;
        *) echo "Aborted at your request." ; exit 1 ;;
    esac
}

require_cli() {
    command -v "$1" >/dev/null 2>&1 || { echo "Missing required CLI: $1. Install it and re-run."; exit 1; }
}

echo "=== 0/6: Checking required tools ==="
require_cli npm
require_cli gh
require_cli git

echo
echo "=== 1/6: npm authentication ==="
if npm whoami >/dev/null 2>&1; then
    echo "Already logged in to npm as $(npm whoami)."
else
    echo "Opening npm login — follow the prompts in this terminal."
    npm login
fi

echo
echo "=== 2/6: GitHub CLI authentication ==="
if gh auth status >/dev/null 2>&1; then
    echo "Already logged in to GitHub CLI."
else
    echo "Opening GitHub device login in your browser — approve it there, then return here."
    gh auth login --web
fi

echo
echo "=== 3/6: Publish delta-sync-sdk to npm ==="
cd "${SDK_DIR}"
PKG_NAME=$(node -p "require('./package.json').name")
PKG_VERSION=$(node -p "require('./package.json').version")
echo "About to publish ${PKG_NAME}@${PKG_VERSION} to public npm — this is hard to fully undo (npm only allows unpublishing within 72h and with restrictions)."
confirm "Build, typecheck, and publish ${PKG_NAME}@${PKG_VERSION} now?"
npm run build
npm run typecheck
npm publish --access public

echo
echo "=== 4/6: Prepare the boilerplate repo locally ==="
cd "${BOILERPLATE_DIR}"
if [ ! -d .git ]; then
    git init
fi
git add -A
git commit -m "Initial commit: RAG reliability boilerplate (SDK trigger, MCP server, LangChain tool, OpenAPI/plugin manifest, Smithery config, GitHub Action, honest eval fixture)" || echo "Nothing new to commit."

echo
echo "=== 5/6: Create the public GitHub repo and push ==="
echo "About to create a PUBLIC repo named '${REPO_NAME}' under your GitHub account and push this code to it."
confirm "Create and push ${REPO_NAME} now?"
gh repo create "${REPO_NAME}" --public --source=. --remote=origin --push

echo
echo "=== 6/6: Add discoverability topics ==="
TOPIC_ARGS=()
for t in "${TOPICS[@]}"; do
    TOPIC_ARGS+=(--add-topic "$t")
done
gh repo edit "${TOPIC_ARGS[@]}"

echo
echo "Done. Live at: $(gh repo view --json url -q .url)"
echo "Published package: https://www.npmjs.com/package/${PKG_NAME}"
