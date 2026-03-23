# ELARIS — Installation Guide (Raspberry Pi)

Tested on: Raspberry Pi 4 / 5 with Raspberry Pi OS (Bookworm 64-bit)

---

## 1. System Update

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 2. Install Node.js (v20+)

Raspberry Pi OS ships with an old Node.js. Install the current LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should print v20.x.x or higher
```

---

## 3. Install MQTT Broker (Mosquitto)

Elaris uses MQTT to communicate with ESP devices.

```bash
sudo apt install -y mosquitto mosquitto-clients

# Enable & start on boot
sudo systemctl enable mosquitto
sudo systemctl start mosquitto

# Verify it is running
sudo systemctl status mosquitto
```

> Default broker runs on `localhost:1883` — no password needed for local use.

---

## 4. Install Elaris

Clone the repository and install dependencies:

```bash
mkdir -p ~/elaris
git clone https://github.com/elaris-control/core.git ~/elaris/elaris-core
cd ~/elaris/elaris-core
npm install
```

> **WinSCP users:** Copy only these folders/files to the Pi:
> - `src/`
> - `public/`
> - `scripts/`
> - `package.json`
> - `package-lock.json`
> - `ecosystem.config.js`
>
> **Never copy** the `data/` folder — it contains the Pi's database. Copying it from Windows will wipe all your devices and users.
>
> **Never copy** `.env` from Windows — it contains secrets generated for that machine. Generate a fresh one on the Pi (see step 5).

---

## 5. Configure Environment

Generate a `.env` with random secrets in one command:

```bash
cd ~/elaris/elaris-core
node -e "
const c=require('crypto');
console.log('PORT=8080');
console.log('NODE_ENV=production');
console.log('MQTT_URL=mqtt://localhost:1883');
console.log('');
console.log('# Engineer unlock code — use this to access commissioning tools');
console.log('ENGINEER_CODE='+c.randomBytes(16).toString('hex'));
console.log('');
console.log('# Signing secrets — do not share or change after first run');
console.log('ENGINEER_SECRET='+c.randomBytes(32).toString('hex'));
console.log('APP_SECRET='+c.randomBytes(32).toString('hex'));
console.log('');
console.log('APP_URL=http://localhost:8080');
console.log('TRUST_PROXY=');
" > .env
chmod 600 .env
cat .env
```

**Save the `ENGINEER_CODE` value** — you will need it to access the commissioning tools in the UI. Everything else is internal.

> You can set `ENGINEER_CODE` to any value you want (e.g. a PIN you will remember). The other two secrets (`ENGINEER_SECRET`, `APP_SECRET`) must stay as long random strings.

> **Running behind nginx / Cloudflare / a reverse proxy?**
> Set `TRUST_PROXY=1` so rate-limiting uses the real client IP instead of the proxy IP.
> Leave it blank if Elaris is exposed directly.

> The server **will refuse to start** if `NODE_ENV=production` and any of the three secrets are missing or empty.

---

## 6. Start Elaris with PM2 (recommended)

PM2 is a process manager for Node.js that keeps ELARIS running, restarts it on crash, and starts it automatically on boot.

### Install PM2

```bash
sudo npm install -g pm2
```

### Start ELARIS

```bash
cd ~/elaris/elaris-core
pm2 start ecosystem.config.js
```

The `ecosystem.config.js` file tells PM2 to load the `.env` automatically via Node's built-in `--env-file` flag (requires Node 20.6+).

### Auto-start on boot

```bash
pm2 startup
# Copy and run the command it prints (looks like: sudo env PATH=... pm2 startup ...)
pm2 save
```

### Common PM2 commands

| What | Command |
|------|---------|
| Start | `pm2 start ecosystem.config.js` |
| Stop | `pm2 stop elaris` |
| Restart | `pm2 restart elaris` |
| Reload (zero-downtime) | `pm2 reload elaris` |
| View logs (live) | `pm2 logs elaris` |
| View logs (last 100 lines) | `pm2 logs elaris --lines 100` |
| Status / overview | `pm2 status` |
| Details | `pm2 show elaris` |
| Remove from PM2 | `pm2 delete elaris` |
| Save current process list | `pm2 save` |

---

## 7. Run as systemd service (alternative to PM2)

If you prefer systemd over PM2, skip step 6 and use this instead. **Pick one or the other — not both.**

```bash
sudo nano /etc/systemd/system/elaris.service
```

Paste (replace `myfirstpi` with your actual username):

```ini
[Unit]
Description=ELARIS Smart Control
After=network.target mosquitto.service

[Service]
Type=simple
User=myfirstpi
WorkingDirectory=/home/myfirstpi/elaris/elaris-core
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/home/myfirstpi/elaris/elaris-core/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable elaris
sudo systemctl start elaris

# Check status
sudo systemctl status elaris

# View logs
sudo journalctl -u elaris -f
```

---

## 8. ESPHome (for flashing ESP devices)

Only needed if you want to use the ESPHome Installer page to flash firmware directly from ELARIS.

### Recommended

Use the built-in ESPHome page inside ELARIS:

`http://<PI_IP>:8080/esphome.html`

The installer can automatically create the Python virtual environment and install ESPHome for you.

### Manual install

```bash
# Install Python tools if not present
sudo apt install -y python3-pip python3-venv

# Allow access to USB serial ports
sudo usermod -aG dialout $USER

# Re-login or reboot for group change to take effect
sudo reboot
```

After reboot:

```bash
cd ~/elaris/elaris-core
python3 -m venv data/esphome_venv
data/esphome_venv/bin/pip install --upgrade pip esphome
data/esphome_venv/bin/esphome version
```

Then open: `http://<PI_IP>:8080/esphome.html`

---

## 9. ESPHome Native API (external devices)

The native API import lets you connect to any existing ESPHome device over TCP (port 6053) without reflashing it. No extra install is needed — ELARIS connects directly.

### Steps

1. Open the installer: `http://<PI_IP>:8080/esphome.html`
2. Select an existing device card or create a new one (enter IP address)
3. Click **Native Import**
4. If the device has no encryption, click **Connect** — entities are discovered automatically
5. Choose **read-only** (monitor only) or **managed** mode, then click **Sync**

### Encryption

If your ESPHome device has `api: encryption: key:` in its YAML, ELARIS will show a warning after the first connection attempt. To find the key:

```bash
# If the firmware was built on this machine or via Home Assistant ESPHome addon:
cat /config/esphome/secrets.yaml   # on Home Assistant
# or look in the secrets.yaml file next to your device YAML
```

The key is a base64-encoded string that looks like: `rPOflI7ENv6ZUjnDtcqCMnmBR7tAFGS3j3A25LZi7Ow=`

Enter it once in the **Encryption key** field — ELARIS stores it in the database and uses it automatically from that point on.

> **Recommended for local networks:** Remove the `api: encryption:` block from your device YAML and reflash once. After that, no key is ever needed.

---

## 10. Mosquitto — Allow LAN devices

For ESPHome boards on the LAN (like the KC868-A16) Mosquitto must accept connections from other devices on the network.

```bash
sudo bash scripts/setup_mosquitto_esphome.sh
```

This writes:

```conf
listener 1883 0.0.0.0
allow_anonymous true
```

and restarts Mosquitto.

> This is the recommended setup for local/lab use. For production, replace with username/password auth.

---

## 11. Find Your Pi's IP Address

```bash
hostname -I
```

Use this IP to open the app from any device on the same network:
`http://192.168.x.x:8080`

---

## Quick Reference

| What | Command |
|------|---------|
| Start app (PM2) | `pm2 start ecosystem.config.js` |
| Restart (PM2) | `pm2 restart elaris` |
| Logs live (PM2) | `pm2 logs elaris` |
| Start app (dev, no PM2) | `npm start` |
| Start (dev mode) | `npm run dev` |
| Recover admin account | `npm run recover-admin` |
| MQTT broker status | `sudo systemctl status mosquitto` |
| Elaris logs (systemd) | `sudo journalctl -u elaris -f` |
| Restart (systemd) | `sudo systemctl restart elaris` |
| ESPHome version | `data/esphome_venv/bin/esphome version` |
| View DB (interactive) | `sqlite3 data/elaris.db` |
| List all tables | `sqlite3 data/elaris.db ".tables"` |

---

## Troubleshooting

### Server refuses to start — `FATAL: Missing required env vars`

The `.env` file is missing or one of `ENGINEER_CODE`, `ENGINEER_SECRET`, `APP_SECRET` is empty.
Re-run step 5 to generate a new `.env`.

### PM2 starts but env vars are not loaded

Make sure you start with `pm2 start ecosystem.config.js` and **not** `pm2 start src/index.js`.
The `ecosystem.config.js` adds the `--env-file=.env` flag that loads the `.env`.

To fix an existing PM2 process:
```bash
pm2 stop elaris
pm2 delete elaris
pm2 start ecosystem.config.js
pm2 save
```

### Users disappear after restart

The DB path is relative to the working directory. Always start from the project root, or use PM2/systemd which sets the working directory correctly.

### `invalid ELF header` / `better-sqlite3` error

Node modules were compiled on Windows and copied to the Pi. Fix:
```bash
cd ~/elaris/elaris-core && npm rebuild
```

### `Cannot find module 'js-yaml'`

Dependencies not installed on the Pi. Fix:
```bash
cd ~/elaris/elaris-core && npm install
```

### Rate limited on login

Too many failed login attempts triggered the in-memory rate limiter. Fix: restart the app.
```bash
pm2 restart elaris
```
