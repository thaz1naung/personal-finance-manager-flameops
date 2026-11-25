# Personal Finance Manager – EC2 Deployment Steps

Deploying the [personal-finance-manager-flameops](https://github.com/thaz1naung/personal-finance-manager-flameops) NestJS API on an Ubuntu 26.04 EC2 instance with PostgreSQL 18, Node 26.13.1 (nvm), bun, and systemd.

| Environment | Folder | Database | Port | Runs with |
|---|---|---|---|---|
| Prod | `/usr/local/bin/personal-finance-manager-flameops` | `pfm_db` | 3000 | systemd service |
| Dev | `/usr/local/bin/personal-finance-manager-flameops-dev` | `pfm_dev` | 3001 | manually (`bun run start:dev`) |

---

## 0. Connect to the server

From the local VM:

```bash
ssh -i ~/.ssh/deploy-test-server-2-key.pem ubuntu@<EC2_PUBLIC_IP>
```

> The public IP changes whenever the instance is stopped and started (a reboot keeps it). Attach an **Elastic IP** to keep it fixed.
> Check the prompt before running commands: `ubuntu@ip-172-31-...` = EC2, `thazinag@ubuntu2604` = local VM.

---

## 1. Clone the repository

```bash
cd /usr/local/bin
sudo chown ubuntu:ubuntu .
git clone https://github.com/thaz1naung/personal-finance-manager-flameops.git
```

---

## 2. Install PostgreSQL

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib -y
psql --version                       # PostgreSQL 18.x
sudo systemctl status postgresql.service
```

> If apt shows `503 Service Unavailable`, the Ubuntu mirror is temporarily down: run `sudo apt update` and retry.

---

## 3. Set up database users and databases

### 3.1 Check existing roles

```bash
sudo -i -u postgres
psql
```

```sql
\du                 -- list roles
\q
```

```bash
exit
```

### 3.2 Create the app role and database

```bash
sudo -iu postgres psql
```

```sql
SHOW hba_file;      -- client authentication rules (who can connect, and how)
SHOW config_file;   -- server behaviour settings (postgresql.conf)

CREATE ROLE pfm_user WITH LOGIN;
\password pfm_user
CREATE DATABASE pfm_db OWNER pfm_user;
\q
```

### 3.3 Test the login

```bash
psql -h 127.0.0.1 -U pfm_user -d pfm_db
```

```sql
\q
```

> `sudo` is not needed here; you log in as `pfm_user` with its password.

### psql tips

- Backslash commands (`\l`, `\du`, `\c`, `\q`) need a backslash `\` and no `;`.
- SQL statements end with `;`.
- If the prompt shows `-#` instead of `=#`, psql is waiting for the rest of a statement. Press **Ctrl+C** or type `\r` to clear it.
- If a list opens with `(END)` at the bottom, press **q** to close it.

---

## 4. Install Node.js (nvm) and bun

```bash
cd ~
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash
```

Make sure these lines are in `~/.bashrc` (the installer usually adds them):

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"                    # loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # loads nvm bash_completion
```

```bash
source ~/.bashrc
nvm install --lts
nvm use 26.13.1
npm install -g --allow-scripts=bun bun
which bun        # /home/ubuntu/.nvm/versions/node/v26.13.1/bin/bun
```

> `npm install -g` installs globally no matter which folder you run it from.
> `--allow-scripts=bun` lets bun's setup script download the bun binary.

---

## 5. Prod: install dependencies and run migrations

```bash
cd /usr/local/bin/personal-finance-manager-flameops
nvm use
bun install

export DATABASE_URL="postgresql://pfm_user:1234@127.0.0.1:5432/pfm_db"
bun run migrate
```

> `bun run migrate` builds the app (`dist/`) and creates the tables.
> The systemd variables only reach the service, not your terminal, so migrations need `DATABASE_URL` exported (or a `.env` file).
> Don't put `;` at the end of the URL, and don't forget the closing `"`.

---

## 6. Prod: create the systemd service

```bash
which bun
systemctl list-units 'postgresql*'     # confirm the name: postgresql@18-main.service
sudo nano /etc/systemd/system/personal-finance.service
```

```ini
[Unit]
Description=Personal Finance Manager API
Requires=postgresql@18-main.service
After=network.target postgresql@18-main.service

[Service]
User=ubuntu
WorkingDirectory=/usr/local/bin/personal-finance-manager-flameops
Environment="PATH=/home/ubuntu/.nvm/versions/node/v26.13.1/bin:/usr/local/bin:/usr/bin:/bin"
Environment=NODE_ENV=production
Environment="DATABASE_URL=postgresql://pfm_user:1234@127.0.0.1:5432/pfm_db"
Environment=DATABASE_SSL=false
Environment=PORT=3000
ExecStart=/home/ubuntu/.nvm/versions/node/v26.13.1/bin/bun run start:prod
RestartSec=5
Restart=always

[Install]
WantedBy=multi-user.target
```

Save in nano: **Ctrl+O**, **Enter**, **Ctrl+X**.

### What each part does

**`[Unit]`: what the service is and what it depends on**
- `Requires=`: the app needs PostgreSQL. When the app starts, systemd starts PostgreSQL too. If PostgreSQL stops or fails, the app is stopped as well.
- `After=`: sets the order. The app starts only after networking is up and PostgreSQL has started. `Requires=` says *what* is needed; `After=` says *when* to start.
- `postgresql@18-main` is Ubuntu's naming: `18` = major version (it stays the same for 18.x updates), `main` = default cluster. `postgresql.service` is only a wrapper.

**`[Service]`: how to run the app**
- `User=ubuntu`: runs the app as a normal user, not root.
- `WorkingDirectory=`: the project folder (like `cd` before starting).
- `PATH`: systemd doesn't load your shell setup (`.bashrc`), so it doesn't know about nvm. This line tells it where to find `node` (Node 26.13.1). Without it, the app couldn't find Node, or would find the wrong version, and the project's version check would fail.
- `Environment=`: the app's settings (these replace `.env` for prod).
- `ExecStart=`: the start command, with the full path to bun. `start:prod` runs `node dist/main.js`.
- `Restart=always` + `RestartSec=5`: if the app stops for any reason (crash, error, killed), systemd waits 5 seconds and starts it again. The wait stops it from restarting hundreds of times per second when something is badly broken, and gives PostgreSQL time to come back if it was briefly down.

**`[Install]`: when to start it automatically**
- `multi-user.target` is the normal "server is fully booted" state. Together with `enable`, the app starts at every boot.

---

## 7. Prod: enable, start and verify

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now personal-finance
sudo systemctl is-enabled personal-finance      # enabled
sudo systemctl status personal-finance --no-pager
curl http://localhost:3000/categories
```

> `restart` only starts the service now. **`enable` is required** for it to start after a reboot.

### Everyday commands

| Situation | Command |
|---|---|
| Closed terminal / logged back in | Nothing, it keeps running |
| Server rebooted | Nothing, it starts automatically |
| New code or migration | `sudo systemctl restart personal-finance` |
| Edited the service file | `sudo systemctl daemon-reload` then `restart` |
| Stop / start manually | `sudo systemctl stop` / `start personal-finance` |
| View logs | `journalctl -u personal-finance -f` |
| Logs since last boot | `journalctl -u personal-finance -b --no-pager -n 50` |

### Updating prod

```bash
cd /usr/local/bin/personal-finance-manager-flameops
git pull
bun install
export DATABASE_URL="postgresql://pfm_user:1234@127.0.0.1:5432/pfm_db"
bun run migrate
sudo systemctl restart personal-finance
```

---

## 8. Dev environment

Dev uses a **separate folder** (so dev builds don't overwrite prod's `dist/`) and a **separate database** (so testing doesn't touch prod data).

### 8.1 One-time setup

```bash
sudo -i -u postgres psql -c "CREATE DATABASE pfm_dev OWNER pfm_user;"

cd /usr/local/bin
git clone https://github.com/thaz1naung/personal-finance-manager-flameops.git personal-finance-manager-flameops-dev
cd personal-finance-manager-flameops-dev
nvm use
bun install
```

Create `.env` (the app reads it automatically):

```bash
cat > .env <<'EOF'
DATABASE_URL=postgresql://pfm_user:1234@127.0.0.1:5432/pfm_dev
DATABASE_SSL=false
PORT=3001
EOF
cat .env
```

> If you use `vi` instead: press `i` to type, then **Esc** and `:wq` + **Enter** to save.

Run migrations on the dev database:

```bash
bun run migrate
```

### 8.2 Start dev

```bash
cd /usr/local/bin/personal-finance-manager-flameops-dev
unset PORT DATABASE_URL DATABASE_SSL     # exported variables override .env
bun run start:dev
```

- Look for `Nest application successfully started` and `API: http://localhost:3001`.
- Stop with **Ctrl+C**. Dev also stops when the terminal closes or the server reboots (this is expected).
- `EADDRINUSE ... 3000` means `PORT=3001` wasn't loaded: check `cat .env` and `echo $PORT`.

---

## 9. Access from outside (Postman / browser)

AWS **Security group → Edit inbound rules → Add rule**:

| Type | Port | Source |
|---|---|---|
| Custom TCP | 3000 | My IP |
| Custom TCP | 3001 | My IP |

- Prod: `http://<EC2_PUBLIC_IP>:3000/categories`, Swagger: `/docs`
- Dev: `http://<EC2_PUBLIC_IP>:3001/categories`

> Use **My IP**, not `0.0.0.0/0`: the API has no authentication. If your home or office IP changes, update the rule.

---

## 10. Troubleshooting

| Error | Meaning | Fix |
|---|---|---|
| `ECONNREFUSED` | Server reachable, app not running | `systemctl status`, `journalctl` |
| `Request timed out` | Blocked by network | Security group rule / My IP / correct public IP |
| `EADDRINUSE` | Port already in use | Use another port, or stop the other process |
| `DATABASE_URL must be a PostgreSQL connection URL` | Variable missing or invalid | `export DATABASE_URL=...` (no `;` at the end) |
| `not-found` from systemctl | You're on the wrong machine | Check the prompt; SSH into EC2 |

Find the current public IP from the server:

```bash
curl -s http://checkip.amazonaws.com
```

> During a reboot the API is unavailable for about 30–90 seconds. It comes back automatically once systemd starts it.

---

## Notes

- The `node` superuser role and the `personal-finance` database created during early testing are not used by the app. They can be removed:
  ```sql
  DROP DATABASE "personal-finance";
  DROP ROLE node;
  ```
- The `pfm` schema created with `CREATE SCHEMA pfm;` is not used either. The app's migrations create tables in the default `public` schema.
- Password `1234` is for learning only. For real production, use a strong password and move the variables into a root-only `EnvironmentFile=`.
