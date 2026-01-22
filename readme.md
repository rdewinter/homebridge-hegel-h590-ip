# homebridge-hegel-h590-ip

Homebridge platform plugin to control a Hegel H590 via IP:
- Power On/Off
- Input selection: USB and OPTICAL3 only
- No volume control

## Install (local)
1) Put this folder somewhere (e.g. /var/lib/homebridge/plugins/homebridge-hegel-h590-ip)
2) Build:
   npm install
   npm run build
3) Install into Homebridge:
   sudo npm install -g /path/to/homebridge-hegel-h590-ip

## Homebridge config
Add platform:

{
  "platform": "HegelH590IP",
  "name": "Hegel H590",
  "host": "192.168.80.91",
  "port": 50001,
  "debug": false
}

If your H590 expects different input names, override:
- inputUsbCommand
- inputOptical3Command