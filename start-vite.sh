#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
cd /Users/shiphero/shiphero-dashboard
exec /Users/shiphero/.nvm/versions/node/v20.20.2/bin/node \
  /Users/shiphero/shiphero-dashboard/node_modules/.bin/vite \
  --port 5173
