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
> - `.env` (if you created one)
>
> **Never copy** the `data/` folder — it contains the Pi's database. Copying it from Windows will wipe all your devices and users.

---

## 5. Configure Environment

Create a `.env` file in the project root:

```bash
nano ~/elaris/elaris-core/.env
```

Paste and adjust:

```env
PORT=8080
NODE_ENV=development
MQTT_URL=mqtt://localhost:1883
```

> For production add also:
> ```env
> NODE_ENV=production
> ENGINEER_CODE=your_secret_code
> ENGINEER_SECRET=your_secret_key
> APP_SECRET=your_app_secret
> ```

> **Running behind nginx / Cloudflare / a reverse proxy?**
> Add `TRUST_PROXY=1` so rate-limiting uses the real client IP instead of the proxy IP.
> Leave it out (or blank) if Elaris is exposed directly.

---

## 6. Start Elaris

```bash
cd ~/elaris/elaris-core
npm start
```

Open in browser: `http://<PI_IP>:8080`

First run will ask you to create an admin account.

---

## 7. Run as a Service (auto-start on boot)

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

## 8. Run with PM2 (recommended alternative to systemd)

PM2 is a process manager for Node.js that keeps ELARIS running, restarts it on crash, and starts it automatically on boot. Easier to use than systemd for most setups.

### Install PM2

```bash
sudo npm install -g pm2
```

### Start ELARIS with PM2

```bash
cd ~/elaris/elaris-core
pm2 start src/index.js --name elaris
```

### Auto-start on boot

```bash
pm2 startup
# Copy and run the command it prints, then:
pm2 save
```

### Common PM2 commands

| What | Command |
|------|---------|
| Start | `pm2 start src/index.js --name elaris` |
| Stop | `pm2 stop elaris` |
| Restart | `pm2 restart elaris` |
| View logs (live) | `pm2 logs elaris` |
| View logs (last 100 lines) | `pm2 logs elaris --lines 100` |
| Status / overview | `pm2 status` |
| Remove from PM2 | `pm2 delete elaris` |
| Save current process list | `pm2 save` |

> If you use PM2, you don't need the systemd service in step 7 — pick one or the other.

---

## 9. ESPHome (for flashing ESP devices)

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
| Start app | `npm start` |
| Start (dev mode) | `npm run dev` |
| Recover admin account | `npm run recover-admin` |
| MQTT broker status | `sudo systemctl status mosquitto` |
| Elaris service logs (systemd) | `sudo journalctl -u elaris -f` |
| Restart service (systemd) | `sudo systemctl restart elaris` |
| PM2 status | `pm2 status` |
| PM2 logs (live) | `pm2 logs elaris` |
| PM2 restart | `pm2 restart elaris` |
| ESPHome version | `data/esphome_venv/bin/esphome version` |
| View DB (interactive) | `sqlite3 data/elaris.db` |
| List all tables | `sqlite3 data/elaris.db ".tables"` |

---

## Troubleshooting

### Users disappear after restart
The DB path is relative to the working directory. Always start from the project root:
```bash
cd ~/elaris/elaris-core && npm start
```
Or use the systemd service which sets `WorkingDirectory` correctly.

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
sudo systemctl restart elaris
```
