#!/usr/bin/env bash
# Installs tools from the "30 tools for Claude" list that ship as installers
# rather than plugin marketplaces: gstack, GSD (get-shit-done), Graphify.
# Idempotent: each step is skipped when the tool is already present.
# Failures are logged and never block the session.
LOG="${TMPDIR:-/tmp}/claude-install-tools.log"
{
  if [ ! -d "$HOME/.claude/skills/gstack" ]; then
    git clone -q --single-branch --depth 1 https://github.com/garrytan/gstack.git "$HOME/.claude/skills/gstack" \
      && (cd "$HOME/.claude/skills/gstack" && ./setup) || echo "gstack install failed"
  fi
  if [ ! -d "$HOME/.claude/get-shit-done" ]; then
    npx -y get-shit-done-cc@latest --claude --global || echo "GSD install failed"
  fi
  if ! command -v graphify >/dev/null 2>&1; then
    pip install -q graphifyy && graphify install || echo "graphify install failed"
  fi
} >>"$LOG" 2>&1
exit 0
