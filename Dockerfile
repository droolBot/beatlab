# The website version of BeatLab on Railway: only the beatlab/ folder, served as plain files.
# beatlab.py stays out on purpose. It writes files and opens folders, so it's only for your own PC.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY beatlab /srv
