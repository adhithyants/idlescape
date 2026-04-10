#!/bin/bash

VIDEO="${1:-/home/goku/Videos/screensaver/girl-behind-curtains-3.3840x2160.mp4}"

# Prevent duplicate playback
pgrep -x "mpv" >/dev/null && exit 0

# Launch optimized mpv screensaver
# Prefer gpu-next since it has been more reliable across the sample videos.
exec mpv \
  --fs \
  --loop=inf \
  --no-audio \
  --really-quiet \
  --stop-screensaver=no \
  --hwdec=no \
  --vo=gpu-next \
  --dither=no \
  --profile=fast \
  --no-osc \
  --no-osd-bar \
  --no-input-default-bindings \
  --no-config \
  "$VIDEO"
