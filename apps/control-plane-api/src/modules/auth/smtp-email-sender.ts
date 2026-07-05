import { Socket, connect as connectTcp } from 'node:net';
import { TLSSocket, connect as connectTls } from 'node:tls';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmailSender, VerificationEmailMessage } from './email-sender';

type SmtpSocket = Socket | TLSSocket;

interface SmtpConfig {
  from: string;
  host: string;
  password: string | null;
  port: number;
  secure: boolean;
  tlsMode: 'disabled' | 'opportunistic' | 'required';
  user: string | null;
}

interface SmtpResponse {
  code: number;
  lines: string[];
}

@Injectable()
export class SmtpEmailSender implements EmailSender {
  constructor(private readonly config: ConfigService) {}

  async sendVerificationEmail(
    message: VerificationEmailMessage,
  ): Promise<void> {
    const smtpConfig = this.readConfig();
    const connection = await SmtpConnection.open(smtpConfig);

    try {
      await connection.sendMail({
        body: this.renderBody(message),
        from: smtpConfig.from,
        subject: 'GateLM email verification code',
        to: message.email,
      });
    } finally {
      await connection.close();
    }
  }

  private readConfig(): SmtpConfig {
    const host = this.readRequired('SMTP_HOST');
    const from = this.readRequired('SMTP_FROM');
    const secure = this.config.get<string>('SMTP_SECURE') === 'true';
    const port = Number(
      this.config.get<string | number>('SMTP_PORT') ?? (secure ? 465 : 587),
    );
    const user = this.readOptional('SMTP_USER');
    const password = this.readOptional('SMTP_PASSWORD');
    const tlsMode =
      this.config.get<string>('SMTP_TLS_MODE') === 'disabled'
        ? 'disabled'
        : this.config.get<string>('SMTP_TLS_MODE') === 'required'
          ? 'required'
          : 'opportunistic';

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SMTP_PORT must be an integer between 1 and 65535.');
    }
    if ((user && !password) || (!user && password)) {
      throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together.');
    }

    return {
      from,
      host,
      password,
      port,
      secure,
      tlsMode,
      user,
    };
  }

  private readRequired(key: string): string {
    const value = this.readOptional(key);
    if (!value) {
      throw new Error(`${key} is required when AUTH_EMAIL_TRANSPORT=smtp.`);
    }

    return value;
  }

  private readOptional(key: string): string | null {
    const value = this.config.get<string>(key)?.trim();
    return value ? value : null;
  }

  private renderBody(message: VerificationEmailMessage): string {
    return [
      'Use this code to verify your GateLM account.',
      '',
      `Verification code: ${message.code}`,
      `Expires at: ${message.expiresAt.toISOString()}`,
      '',
      'If you did not request this email, you can ignore it.',
    ].join('\r\n');
  }
}

class SmtpConnection {
  private buffer = '';
  private closedError: Error | null = null;
  private lineQueue: string[] = [];
  private waiter:
    | {
        reject(error: Error): void;
        resolve(line: string): void;
      }
    | null = null;

  private constructor(
    private socket: SmtpSocket,
    private readonly config: SmtpConfig,
  ) {
    this.attachSocket(socket);
  }

  static async open(config: SmtpConfig): Promise<SmtpConnection> {
    const socket = await connectSocket(config);
    const connection = new SmtpConnection(socket, config);
    await connection.expectResponse([220]);

    let ehloResponse = await connection.command(`EHLO ${localHostname()}`, [
      250,
    ]);

    if (!config.secure && config.tlsMode !== 'disabled') {
      const supportsStartTls = ehloResponse.lines.some((line) =>
        line.toUpperCase().includes('STARTTLS'),
      );

      if (supportsStartTls) {
        await connection.command('STARTTLS', [220]);
        await connection.upgradeToTls();
        ehloResponse = await connection.command(`EHLO ${localHostname()}`, [
          250,
        ]);
      } else if (config.tlsMode === 'required') {
        throw new Error('SMTP server does not advertise STARTTLS.');
      }
    }

    if (config.user && config.password) {
      await connection.command(
        `AUTH PLAIN ${Buffer.from(
          `\0${config.user}\0${config.password}`,
        ).toString('base64')}`,
        [235],
      );
    }

    return connection;
  }

  async sendMail(input: {
    body: string;
    from: string;
    subject: string;
    to: string;
  }): Promise<void> {
    await this.command(`MAIL FROM:<${extractEmailAddress(input.from)}>`, [250]);
    await this.command(`RCPT TO:<${input.to}>`, [250, 251]);
    await this.command('DATA', [354]);
    this.write(
      `${escapeSmtpData(
        [
          `From: ${sanitizeHeaderValue(input.from)}`,
          `To: ${sanitizeHeaderValue(input.to)}`,
          `Subject: ${sanitizeHeaderValue(input.subject)}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: 8bit',
          '',
          input.body,
        ].join('\r\n'),
      )}\r\n.\r\n`,
    );
    await this.expectResponse([250]);
  }

  async close(): Promise<void> {
    if (this.socket.destroyed) {
      return;
    }

    try {
      await this.command('QUIT', [221]);
    } catch {
      this.socket.destroy();
      return;
    }

    this.socket.end();
  }

  private async command(
    command: string,
    expectedCodes: number[],
  ): Promise<SmtpResponse> {
    this.write(`${command}\r\n`);
    return this.expectResponse(expectedCodes);
  }

  private async expectResponse(
    expectedCodes: number[],
  ): Promise<SmtpResponse> {
    const response = await this.readResponse();
    if (!expectedCodes.includes(response.code)) {
      throw new Error(
        `Unexpected SMTP response ${response.code}: ${response.lines.join(' ')}`,
      );
    }

    return response;
  }

  private async readResponse(): Promise<SmtpResponse> {
    const firstLine = await this.readLine();
    const code = Number(firstLine.slice(0, 3));
    const lines = [firstLine];

    if (!Number.isInteger(code)) {
      throw new Error(`Invalid SMTP response: ${firstLine}`);
    }

    while (firstLine.charAt(3) === '-') {
      const line = await this.readLine();
      lines.push(line);

      if (line.startsWith(`${code} `)) {
        break;
      }
    }

    return { code, lines };
  }

  private readLine(): Promise<string> {
    const line = this.lineQueue.shift();
    if (line !== undefined) {
      return Promise.resolve(line);
    }
    if (this.closedError) {
      return Promise.reject(this.closedError);
    }

    return new Promise((resolve, reject) => {
      this.waiter = { reject, resolve };
    });
  }

  private write(value: string): void {
    this.socket.write(value);
  }

  private async upgradeToTls(): Promise<void> {
    this.detachSocket(this.socket);
    this.buffer = '';
    this.lineQueue = [];

    const tlsSocket = await new Promise<TLSSocket>((resolve, reject) => {
      const socket = connectTls(
        {
          servername: this.config.host,
          socket: this.socket,
        },
        () => resolve(socket),
      );
      socket.once('error', reject);
    });

    this.socket = tlsSocket;
    this.attachSocket(tlsSocket);
  }

  private attachSocket(socket: SmtpSocket): void {
    socket.setEncoding('utf8');
    socket.on('data', this.handleData);
    socket.on('end', this.handleEnd);
    socket.on('error', this.handleError);
  }

  private detachSocket(socket: SmtpSocket): void {
    socket.off('data', this.handleData);
    socket.off('end', this.handleEnd);
    socket.off('error', this.handleError);
  }

  private readonly handleData = (chunk: string | Buffer): void => {
    this.buffer += chunk.toString();

    while (this.buffer.includes('\n')) {
      const index = this.buffer.indexOf('\n');
      const rawLine = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      this.pushLine(line);
    }
  };

  private readonly handleEnd = (): void => {
    this.fail(new Error('SMTP connection closed.'));
  };

  private readonly handleError = (error: Error): void => {
    this.fail(error);
  };

  private pushLine(line: string): void {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.resolve(line);
      return;
    }

    this.lineQueue.push(line);
  }

  private fail(error: Error): void {
    this.closedError = error;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.reject(error);
    }
  }
}

async function connectSocket(config: SmtpConfig): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? connectTls(
          {
            host: config.host,
            port: config.port,
            servername: config.host,
          },
          () => resolve(socket),
        )
      : connectTcp(
          {
            host: config.host,
            port: config.port,
          },
          () => resolve(socket),
        );

    socket.once('error', reject);
  });
}

function localHostname(): string {
  return 'localhost';
}

function extractEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return sanitizeHeaderValue(match?.[1] ?? value);
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function escapeSmtpData(value: string): string {
  return value
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}
