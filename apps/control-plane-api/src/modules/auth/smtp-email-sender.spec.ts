import { createServer, Server, Socket } from 'node:net';

import { ConfigService } from '@nestjs/config';

import { SmtpEmailSender } from './smtp-email-sender';

describe('SmtpEmailSender', () => {
  let server: Server;
  let port: number;
  let receivedMessage = '';
  let authCommand = '';

  beforeEach(async () => {
    receivedMessage = '';
    authCommand = '';

    server = createServer((socket) => {
      handleSmtpSession(socket, {
        onAuth: (command) => {
          authCommand = command;
        },
        onMessage: (message) => {
          receivedMessage = message;
        },
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Test SMTP server did not bind to a TCP port.');
        }

        port = address.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  it('sends the verification code through SMTP without returning or storing provider credentials', async () => {
    const sender = new SmtpEmailSender(
      new ConfigService({
        SMTP_FROM: 'GateLM <no-reply@gatelm.test>',
        SMTP_HOST: '127.0.0.1',
        SMTP_PASSWORD: 'smtp-password',
        SMTP_PORT: String(port),
        SMTP_SECURE: 'false',
        SMTP_TLS_MODE: 'disabled',
        SMTP_USER: 'smtp-user',
      }),
    );

    await sender.sendVerificationEmail({
      code: '123456',
      email: 'owner@example.com',
      expiresAt: new Date('2026-07-05T12:15:00.000Z'),
    });

    expect(authCommand).toBe(
      `AUTH PLAIN ${Buffer.from('\0smtp-user\0smtp-password').toString(
        'base64',
      )}`,
    );
    expect(receivedMessage).toContain('To: owner@example.com');
    expect(receivedMessage).toContain('Subject: GateLM email verification code');
    expect(receivedMessage).toContain('123456');
    expect(receivedMessage).not.toContain('smtp-password');
  });
});

function handleSmtpSession(
  socket: Socket,
  callbacks: {
    onAuth(command: string): void;
    onMessage(message: string): void;
  },
): void {
  let buffer = '';
  let isCollectingData = false;
  let messageLines: string[] = [];

  socket.write('220 smtp.test ESMTP\r\n');

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');

    while (buffer.includes('\r\n')) {
      const index = buffer.indexOf('\r\n');
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);

      if (isCollectingData) {
        if (line === '.') {
          callbacks.onMessage(messageLines.join('\r\n'));
          messageLines = [];
          isCollectingData = false;
          socket.write('250 queued\r\n');
        } else {
          messageLines.push(line);
        }

        continue;
      }

      if (line.startsWith('EHLO')) {
        socket.write('250-smtp.test\r\n250 AUTH PLAIN\r\n');
      } else if (line.startsWith('AUTH PLAIN')) {
        callbacks.onAuth(line);
        socket.write('235 authenticated\r\n');
      } else if (line.startsWith('MAIL FROM')) {
        socket.write('250 sender ok\r\n');
      } else if (line.startsWith('RCPT TO')) {
        socket.write('250 recipient ok\r\n');
      } else if (line === 'DATA') {
        isCollectingData = true;
        socket.write('354 end with dot\r\n');
      } else if (line === 'QUIT') {
        socket.write('221 bye\r\n');
        socket.end();
      } else {
        socket.write('250 ok\r\n');
      }
    }
  });
}
