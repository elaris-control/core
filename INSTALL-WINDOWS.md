# ELARIS — Windows Installation Guide

Tested on Windows 10 / 11 (64-bit).

---

## Prerequisites

Install the following before running ELARIS:

### 1. Node.js 20+

Download and install from [nodejs.org](https://nodejs.org) (LTS version).

Verify:
```powershell
node --version   # should print v20.x.x or higher
npm --version
```

### 2. Mosquitto MQTT Broker

Download the Windows installer from [mosquitto.org/download](https://mosquitto.org/download/).

After install, configure it to allow LAN access (needed for ESP devices):

Open `C:\Program Files\mosquitto\mosquitto.conf` and add at the bottom:

```
listener 1883 0.0.0.0
allow_anonymous true
```

Then start the service:
```powershell
# Run as Administrator
net start mosquitto
```

To start automatically on boot, set the service to Automatic in Services (`services.msc`).

### 3. Python 3 + ESPHome (for USB/OTA flashing)

Skip this step if you only use OTA flashing via IP and already have the device flashed.

```powershell
# Install Python 3 from python.org, then:
pip install esphome
```

Verify:
```powershell
esphome version
```

For USB flashing on Windows, install the CP210x or CH340 driver for your board (usually included with the board's documentation).

---

## Install ELARIS

```powershell
git clone https://github.com/elaris-control/core.git
cd core
npm install
```

---

## Environment configuration

Create a `.env` file in the project root. You can generate random secrets with:

```powershell
node -e "const c=require('crypto'); console.log('PORT=8080\nNODE_ENV=production\nMQTT_URL=mqtt://localhost:1883\nENGINEER_CODE='+c.randomBytes(16).toString('hex')+'\nENGINEER_SECRET='+c.randomBytes(32).toString('hex')+'\nAPP_SECRET='+c.randomBytes(32).toString('hex'))"
```

Copy the output into a new `.env` file, or create it manually:

```env
PORT=8080
NODE_ENV=production
MQTT_URL=mqtt://localhost:1883

# Engineer unlock code — share this with your commissioning engineer
ENGINEER_CODE=<random hex>

# Signing secrets — do not share or change after first run
ENGINEER_SECRET=<random hex>
APP_SECRET=<random hex>
```

---

## Run ELARIS

### Option A — Manual (development / testing)

```powershell
npm start
```

Open `http://localhost:8080` in your browser.

### Option B — PM2 (recommended for production)

PM2 keeps ELARIS running in the background and restarts it automatically:

```powershell
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Follow the instructions printed by `pm2 startup` to configure auto-start on boot.

Useful commands:
```powershell
pm2 status          # service status
pm2 logs elaris     # live logs
pm2 restart elaris  # restart
```

### Option C — Windows Service (NSSM)

Download [NSSM](https://nssm.cc/download) and run:

```powershell
nssm install elaris "node" "C:\path\to\core\src\index.js"
nssm set elaris AppDirectory "C:\path\to\core"
nssm set elaris AppEnvironmentExtra "PORT=8080" "NODE_ENV=production" "MQTT_URL=mqtt://localhost:1883"
nssm start elaris
```

---

## USB flash (serial ports)

On Windows, USB-to-serial adapters appear as `COM3`, `COM4`, etc. ELARIS detects them automatically. If your port doesn't appear, install the driver for your board:

- **CP2102** (most Kincony boards): [Silicon Labs CP210x driver](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)
- **CH340**: [CH340 driver](http://www.wch-ic.com/downloads/CH341SER_EXE.html)

---

## Firewall

Allow port 8080 (ELARIS web UI) and 1883 (Mosquitto) through Windows Firewall if you need access from other devices on the LAN:

```powershell
# Run as Administrator
netsh advfirewall firewall add rule name="ELARIS" protocol=TCP dir=in localport=8080 action=allow
netsh advfirewall firewall add rule name="Mosquitto" protocol=TCP dir=in localport=1883 action=allow
```

---

## Verify

Open `http://localhost:8080` — first run prompts you to create an admin account.

To check Mosquitto is receiving MQTT messages from your ESP devices:
```powershell
mosquitto_sub -h localhost -t "elaris/#" -v
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm install` fails on `better-sqlite3` | Install [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |
| Mosquitto not connecting | Check firewall rules, confirm service is running (`net start mosquitto`) |
| USB port not appearing | Install CP210x or CH340 driver for your board |
| `esphome` not found | Run `pip install esphome` and restart the terminal |
