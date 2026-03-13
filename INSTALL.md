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

Copy the project to the Pi (via WinSCP, scp, or git clone) and install dependencies:

```bash
cd ~/elaris/elaris-core    # adjust to your folder name
npm install
npm rebuild                # required if node_modules were copied from a Windows machine
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

## 9. Mosquitto — Allow LAN devices

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

## 10. Find Your Pi's IP Address

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
| Elaris service logs | `sudo journalctl -u elaris -f` |
| Restart service | `sudo systemctl restart elaris` |
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
