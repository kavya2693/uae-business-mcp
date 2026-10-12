#!/usr/bin/env bash
# Calls every tool through the official MCP Inspector CLI against a running server.
# Usage: scripts/inspector-smoke.sh [mcp-url]   (needs Node >= 22.19 for the Inspector)
set -euo pipefail
URL="${1:-http://127.0.0.1:3311/mcp}"
DATE="${DATE:-$(TZ=Asia/Dubai date -v+1d +%F 2>/dev/null || TZ=Asia/Dubai date -d tomorrow +%F)}"
I=(npx -y @modelcontextprotocol/inspector@2.10.1 --cli "$URL" --transport http)
# The Inspector CLI exits 5 when a tool returns isError (expected for the rejection cases), so ignore its exit code.
call() { echo "=== $*"; { "${I[@]}" --method tools/call --tool-name "$@" 2>/dev/null || true; } | grep -v '^{"error":{"code":"tool_is_error"' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(JSON.stringify({isError:r.isError,...r.structuredContent}).slice(0,900))})'; }
call get_business_info

call get_opening_hours --tool-arg date="$DATE"
call search_menu --tool-arg 'dietary=["vegan","gluten-free"]' --tool-arg maxPriceAED=30
call search_menu --tool-arg text=حمص
call check_availability --tool-arg date="$DATE" --tool-arg time=19:30 --tool-arg partySize=4
call request_booking --tool-arg name="Inspector Test" --tool-arg phone="+971 50 123 4567" --tool-arg date="$DATE" --tool-arg time=19:30 --tool-arg partySize=4 --tool-arg notes="Smoke test"
call request_booking --tool-arg name="Bad Phone" --tool-arg phone="+44 20 7946 0000" --tool-arg date="$DATE" --tool-arg time=19:30 --tool-arg partySize=2
call request_booking --tool-arg name="Too Many" --tool-arg phone="0501234567" --tool-arg date="$DATE" --tool-arg time=19:30 --tool-arg partySize=12
call request_booking --tool-arg name="Past" --tool-arg phone="0501234567" --tool-arg date=2020-01-01 --tool-arg time=19:30 --tool-arg partySize=2
call request_booking --tool-arg name="Late" --tool-arg phone="0501234567" --tool-arg date="$DATE" --tool-arg time=03:00 --tool-arg partySize=2
REF=$({ "${I[@]}" --method tools/call --tool-name request_booking --tool-arg name="Status Check" --tool-arg phone="+971 55 765 4321" --tool-arg date="$DATE" --tool-arg time=20:00 --tool-arg partySize=2 2>/dev/null || true; } | grep -o '"reference": "[A-Z]*-[A-Z0-9]*"' | head -1 | cut -d'"' -f4)
call get_booking_status --tool-arg reference="$REF" --tool-arg phone="055 765 4321"
call get_booking_status --tool-arg reference="$REF" --tool-arg phone="+971 50 000 0000"
echo "=== rate limit: 6 more requests from the same phone"
for i in 1 2 3 4 5 6; do call request_booking --tool-arg name="Spam $i" --tool-arg phone="+971 52 222 3333" --tool-arg date="$DATE" --tool-arg time=21:00 --tool-arg partySize=2 | grep -o '"status":"[A-Z_]*"\|"code":"[A-Z_]*"' | tr '\n' ' '; echo; done
