---
name: s32-reader
description: Read a synthetic reference and run the matching synthetic script for Sidekick Skills verification.
---
# Synthetic Skills verification

Read [context](references/context.md) using the read tool. Then use bash to run `/bin/bash` with the absolute path of `scripts/echo.sh` in this skill directory. Keep the command cwd at the run directory. The script only writes a synthetic artifact in that cwd. Add the script marker as a candidate tag. Use only source evidence from the user text; do not access real services or other files.
