#!/bin/bash
# helper: save newest REA capture_web_screenshot tool-result as REA_SCREENSHOTS/<name>.png and log its evidence id
T=/home/yin-robosam/.claude/projects/-home-yin-robosam--config-Claude-scratch-workspaces-58174672-8597-4b92-a82d-d39f8be7cc41-b578814c-7db2-4add-8db5-d768e96840c4-scratch-2026-11-15-6e2ebe/cc6ef831-36ca-427a-a5fe-a6a6b9e5ed10/tool-results
D="$(cd "$(dirname "$0")/.." && pwd)"
F=$(ls -t /home/yin-robosam/.claude/projects/-home-yin-robosam--config-Claude-scratch-workspaces-58174672-8597-4b92-a82d-d39f8be7cc41-b578814c-7db2-4add-8db5-d768e96840c4-scratch-2026-11-15-6e2ebe/*/tool-results/mcp-rea-capture_web_screenshot-*.txt | head -1)
out=$(python3 "$D/rea-tools/save_shot.py" "$F" "$D/REA_SCREENSHOTS/$1.png")
echo "$1.png $out" | tee -a "$D/evidence/screenshot_index.txt"
