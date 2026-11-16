#!/bin/bash
# click toolbox category $1 then list flyout blocks
cd "$(dirname "$0")"
node cdp.mjs "[{\"op\":\"eval\",\"expr\":\"(()=>{const e=[...document.querySelectorAll('.scratchCategoryMenuItem')].find(e=>e.innerText.trim()==='$1');const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()\"}]" | tr -d '[]' > /tmp/claude-1000/pt.txt
X=$(cut -d, -f1 /tmp/claude-1000/pt.txt); Y=$(cut -d, -f2 /tmp/claude-1000/pt.txt)
node cdp.mjs "[{\"op\":\"click\",\"x\":$X,\"y\":$Y},{\"op\":\"wait\",\"ms\":900},{\"op\":\"eval\",\"expr\":"// returns the flyout's visible top-level blocks: [text, x, y] (left edge + 8px, top + 12px)\n(()=>{const fl=document.querySelector('.blocklyFlyout');return [...fl.querySelectorAll('.blocklyBlockCanvas > g.blocklyDraggable')].map(g=>{const r=g.getBoundingClientRect();return [g.textContent.replace(/\\s+/g,' ').trim().slice(0,50),Math.round(r.x+8),Math.round(r.y+12)]}).filter(b=>b[2]>90&&b[2]<660)})()\n"}]"
