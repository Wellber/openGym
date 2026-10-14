#!/bin/bash
# render.sh <svg> <out.png> <w> <h>
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SVG=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
HTML=$(mktemp /tmp/rXXXX).html
printf '<html><body style="margin:0;background:transparent"><img src="file://%s" style="width:%spx;height:%spx;display:block"></body></html>' "$SVG" "$3" "$4" > "$HTML"
"$CH" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size=$3,$4 --screenshot="$2" "file://$HTML" >/dev/null 2>&1
rm -f "$HTML"
