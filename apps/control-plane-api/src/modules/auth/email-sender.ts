import { Injectable } from '@nestjs/common';

export interface VerificationEmailMessage {
  code: string;
  email: string;
  expiresAt: Date;
}

export interface EmailSender {
  sendVerificationEmail(message: VerificationEmailMessage): Promise<void>;
}

@Injectable()
export class InMemoryEmailSender implements EmailSender {
  readonly sent: VerificationEmailMessage[] = [];

  async sendVerificationEmail(
    message: VerificationEmailMessage,
  ): Promise<void> {
    this.sent.push(message);
  }
}
