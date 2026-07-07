import { Injectable } from '@nestjs/common';

export interface VerificationEmailMessage {
  code: string;
  email: string;
  expiresAt: Date;
}

export interface ProjectAdminInvitationEmailMessage {
  email: string;
  expiresAt: Date;
  name: string;
  projectName: string;
  signupUrl: string;
  tenantName: string;
}

export interface EmailSender {
  sendProjectAdminInvitationEmail(
    message: ProjectAdminInvitationEmailMessage,
  ): Promise<void>;
  sendVerificationEmail(message: VerificationEmailMessage): Promise<void>;
}

@Injectable()
export class InMemoryEmailSender implements EmailSender {
  readonly projectAdminInvitationsSent: ProjectAdminInvitationEmailMessage[] = [];
  readonly sent: VerificationEmailMessage[] = [];

  async sendProjectAdminInvitationEmail(
    message: ProjectAdminInvitationEmailMessage,
  ): Promise<void> {
    this.projectAdminInvitationsSent.push(message);
  }

  async sendVerificationEmail(
    message: VerificationEmailMessage,
  ): Promise<void> {
    this.sent.push(message);
  }
}
