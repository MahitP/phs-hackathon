#!/usr/bin/env bash
# One-time Raspberry Pi setup for SkyWindow (Raspberry Pi OS Bookworm/Bullseye).
#   git clone <your repo> ~/skywindow && cd ~/skywindow && bash scripts/setup_pi.sh
set -e
cd "$(dirname "$0")/.."

echo "== enabling I2C (Base HAT + LCD) =="
sudo raspi-config nonint do_i2c 0

echo "== system packages =="
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip i2c-tools mpg123 git

echo "== python venv =="
python3 -m venv .venv --system-site-packages
. .venv/bin/activate
pip install -r requirements.txt
# Seeed grove.py provides the Base HAT ADC driver
pip install git+https://github.com/Seeed-Studio/grove.py

[ -f .env ] || cp .env.example .env
[ -f data/smoke_day_2023.json ] || python scripts/fetch_smoke_day.py

echo "== I2C devices (expect 04 = Base HAT, 3e = LCD text, 62 or 30 = LCD backlight) =="
sudo i2cdetect -y 1 || true

echo "== systemd service (starts on boot) =="
sudo tee /etc/systemd/system/skywindow.service >/dev/null <<EOF
[Unit]
Description=SkyWindow
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$PWD
ExecStart=$PWD/.venv/bin/uvicorn server.app:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now skywindow
echo
echo "Done. Dashboard: http://$(hostname -I | awk '{print $1}'):8000   logs: journalctl -u skywindow -f"
