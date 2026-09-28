#!/usr/bin/env python3
from pathlib import Path
import os,secrets
target=Path(".env")
if target.exists():
    raise SystemExit(".env already exists; existing secrets were preserved.")
values={"ADMIN_USERNAME":"admin","ADMIN_PASSWORD":secrets.token_urlsafe(24),"INTERNAL_TOKEN":secrets.token_hex(32),"ENCRYPTION_KEY":secrets.token_hex(32),"STREAM_HOST":"stream.vrchatlegends.com","WATCH_HOST":"watch.vrchatlegends.com","STUDIO_HOST":"studio.vrchatlegends.com","OAUTH_CLIENT_ID":"","OAUTH_CLIENT_SECRET":"","DISCORD_BOT_TOKEN":""}
fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,"w") as f:
    f.write("".join(f"{k}={v}\n" for k,v in values.items()))
print("Created .env with unique secrets. Read ADMIN_PASSWORD locally to sign into the studio.")
