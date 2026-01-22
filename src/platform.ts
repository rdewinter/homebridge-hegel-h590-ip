import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { HegelClient } from './hegelClient';

export const PLATFORM_NAME = 'HegelH590IP';
export const PLUGIN_NAME = 'homebridge-hegel-h590-ip';

type InputName = 'USB' | 'OPTICAL3';

interface HegelConfig extends PlatformConfig {
  name?: string;
  host: string;
  port?: number;
  timeoutMs?: number;
  debug?: boolean;

  powerOnCommand?: string;         // default: -p.1
  powerOffCommand?: string;        // default: -p.0
  inputUsbCommand?: string;        // default: -i.11  (jouw H590)
  inputOptical3Command?: string;   // default: -i.10  (jouw H590)
}

export class HegelH590Platform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private accessory?: PlatformAccessory;
  private tvService?: Service;

  // “Optimistic / last-command-wins” state (write-only device)
  private isOn = false;
  private activeInput: InputName = 'OPTICAL3';

  private readonly name: string;

  private readonly cmdPowerOn: string;
  private readonly cmdPowerOff: string;
  private readonly cmdUsb: string;
  private readonly cmdOpt3: string;

  private readonly client: HegelClient;

  constructor(
    public readonly log: Logger,
    public readonly config: HegelConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    if (!config?.host) {
      throw new Error('Missing "host" in config for HegelH590IP.');
    }

    this.name = config.name ?? 'Hegel H590';

    // Defaults for jouw H590 (zoals getest):
    this.cmdPowerOn = config.powerOnCommand ?? '-p.1';
    this.cmdPowerOff = config.powerOffCommand ?? '-p.0';
    this.cmdOpt3 = config.inputOptical3Command ?? '-i.10';
    this.cmdUsb = config.inputUsbCommand ?? '-i.11';

    const host = config.host;
    const port = config.port ?? 50001;
    const timeoutMs = config.timeoutMs ?? 1500;
    const debug = config.debug ?? false;

    this.client = new HegelClient({
      host,
      port,
      timeoutMs,
      debug,
      log: (m) => this.log.info(m),
      warn: (m) => this.log.warn(m),
    });

    this.api.on('didFinishLaunching', () => {
      this.setupAccessory();
    });

    this.api.on('shutdown', () => {
      this.client.disconnect();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    // Cached accessory from Homebridge
    this.accessory = accessory;
  }

  private setupAccessory() {
    const uuid = this.api.hap.uuid.generate(`HegelH590IP:${this.config.host}:${this.config.port ?? 50001}`);

    let accessory = this.accessory;
    if (!accessory) {
      accessory = new this.api.platformAccessory(this.name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessory = accessory;
      this.log.info(`Registered new accessory: ${this.name}`);
    } else {
      this.log.info(`Loaded cached accessory: ${accessory.displayName}`);
    }

    // Accessory Information
    const info = accessory.getService(this.Service.AccessoryInformation)
      ?? accessory.addService(this.Service.AccessoryInformation);

    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'Hegel')
      .setCharacteristic(this.Characteristic.Model, 'H590')
      .setCharacteristic(this.Characteristic.SerialNumber, String(this.config.host));

    // Television service (shows inputs in Home app nicely)
    const tv = accessory.getService(this.Service.Television)
      ?? accessory.addService(this.Service.Television, this.name);

    this.tvService = tv;

    tv.setCharacteristic(this.Characteristic.ConfiguredName, this.name);
    tv.setCharacteristic(this.Characteristic.SleepDiscoveryMode, this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // IMPORTANT:
    // - We DO NOT set Active at startup (prevents auto power-off during restart).
    // - Device is write-only; HomeKit state is “last-command-wins”.

    // Power (Active)
    tv.getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.isOn ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE))
      .onSet(async (value) => {
        const wantOn = value === this.Characteristic.Active.ACTIVE;
        await this.sendPower(wantOn);

        // Update local + UI immediately (optimistic)
        this.isOn = wantOn;
        tv.updateCharacteristic(this.Characteristic.Active, wantOn ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);

        this.log.info(`Power command sent: ${wantOn ? 'ON' : 'OFF'}`);
      });

    // Input selection (ActiveIdentifier)
    tv.getCharacteristic(this.Characteristic.ActiveIdentifier)
    .onGet(() => (this.activeInput === 'OPTICAL3' ? 1 : 2))
    .onSet(async (value) => {
      const id = Number(value);
      if (id === 1) {
        await this.sendInput('OPTICAL3');
      } else if (id === 2) {
        await this.sendInput('USB');
      }

      tv.updateCharacteristic(
        this.Characteristic.ActiveIdentifier,
        this.activeInput === 'OPTICAL3' ? 1 : 2,
      );
    });

    // Ignore RemoteKey to avoid transport/volume behavior
    tv.getCharacteristic(this.Characteristic.RemoteKey)
      .onSet(() => {
        // intentionally no-op
      });

    // Create & link only the two input sources
    const opt3Input = this.ensureInputSource(accessory, 'OPTICAL3', 1); 
    const usbInput  = this.ensureInputSource(accessory, 'USB', 2);

    // Link input services to TV service
    tv.addLinkedService(usbInput);
    tv.addLinkedService(opt3Input);

    // Optional: set a default shown input (safe; does NOT send anything to device)
    tv.updateCharacteristic(this.Characteristic.ActiveIdentifier, this.activeInput === 'USB' ? 1 : 2);
  }

  private ensureInputSource(accessory: PlatformAccessory, name: InputName, identifier: number): Service {
    const subtype = `InputSource-${identifier}`;
    const serviceName = `${this.name} ${name}`;

    const input = accessory.getServiceById(this.Service.InputSource, subtype)
      ?? accessory.addService(this.Service.InputSource, serviceName, subtype);

    input.setCharacteristic(this.Characteristic.ConfiguredName, name);
    input.setCharacteristic(this.Characteristic.Identifier, identifier);
    input.setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED);
    input.setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.OTHER);

    return input;
  }

  private async sendPower(on: boolean) {
    // Write-only: just send. No polling, no status.
    await this.client.send(on ? this.cmdPowerOn : this.cmdPowerOff);
  }

  private async sendInput(input: InputName) {
    const cmd = input === 'USB' ? this.cmdUsb : this.cmdOpt3;
    await this.client.send(cmd);
    this.activeInput = input;
  }
}