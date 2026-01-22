import net from 'net';

export interface HegelClientOptions {
  host: string;
  port: number;
  timeoutMs: number;
  debug: boolean;
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export class HegelClient {
  private socket: net.Socket | null = null;
  private connecting = false;
  private buffer = '';
  private lastActivity = 0;

  constructor(private readonly opts: HegelClientOptions) {}

  private d(msg: string) {
    if (this.opts.debug) this.opts.log(`[HegelClient] ${msg}`);
  }

  private ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (this.connecting) {
      // small wait loop
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (this.socket && !this.socket.destroyed && !this.connecting) return resolve();
          if (Date.now() - started > this.opts.timeoutMs) return reject(new Error('Connect timeout'));
          setTimeout(tick, 50);
        };
        tick();
      });
    }

    this.connecting = true;

    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      sock.setNoDelay(true);

      const onError = (err: Error) => {
        this.d(`socket error: ${err.message}`);
      };

      sock.on('error', onError);

      sock.on('data', (data) => {
        this.lastActivity = Date.now();
        this.buffer += data.toString('utf8');
      });

      sock.on('close', () => {
        this.d('socket closed');
        this.socket = null;
      });

      sock.connect(this.opts.port, this.opts.host, () => {
        this.d(`connected to ${this.opts.host}:${this.opts.port}`);
        this.socket = sock;
        this.connecting = false;
        this.buffer = '';
        resolve();
      });

      // connect timeout
      setTimeout(() => {
        if (this.socket === sock) return;
        if (!sock.destroyed && this.connecting) {
          this.connecting = false;
          sock.destroy();
          reject(new Error('Connect timeout'));
        }
      }, this.opts.timeoutMs);
    });
  }

public async send(command: string): Promise<void> {
  await this.ensureConnected();
  if (!this.socket) throw new Error('Socket not connected');

  const cmd = command.trim() + '\r';
  this.d(`>> ${command}`);

  await new Promise<void>((resolve, reject) => {
    this.socket!.write(cmd, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

  public disconnect() {
    if (this.socket && !this.socket.destroyed) {
      this.d('disconnecting');
      this.socket.destroy();
    }
    this.socket = null;
  }
}