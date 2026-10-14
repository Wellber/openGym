#!/bin/bash
# Regenerates every raster icon of WS-GYM from the SVGs in this folder:
# public/icon-*.png (PWA), Android launcher icons and splash screens (any size already there).
# Needs ImageMagick and Google Chrome (headless, renders the SVGs). Run from frontend/.
set -euo pipefail
B=resources/brand; R="$B/render.sh"; T=$(mktemp -d)
"$R" $B/wsgym-icon.svg $T/icon.png 1024 1024
"$R" $B/wsgym-foreground.svg $T/fg.png 1024 1024
"$R" public/brand-mark.svg $T/mark.png 1104 990
magick $T/icon.png \( +clone -alpha extract -fill black -colorize 100 -fill white -draw "circle 512,512 512,0" \) -alpha off -compose copy_opacity -composite $T/round.png
magick $T/icon.png -resize 180x180 public/icon-180.png
magick $T/icon.png -resize 512x512 public/icon-512.png
for f in $(find android/app/src/main/res -name "*.png"); do
  d=$(magick identify -format "%wx%h" "$f"); w=${d%x*}; h=${d#*x}
  case "$(basename "$f")" in
    ic_launcher.png) magick $T/icon.png -resize "${d}!" "$f";;
    ic_launcher_round.png) magick $T/round.png -resize "${d}!" "$f";;
    ic_launcher_foreground.png) magick $T/fg.png -resize "${d}!" "$f";;
    ic_launcher_background.png) magick -size "$d" xc:'#0c0e12' "$f";;
    splash.png) s=$(( (w<h?w:h) * 35 / 100 )); magick -size "$d" xc:'#0c0e12' \( $T/mark.png -resize ${s}x${s} \) -gravity center -composite "$f";;
  esac
done
rm -rf "$T"; echo "icons regenerated"
