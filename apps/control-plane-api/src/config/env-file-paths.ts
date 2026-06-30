import { resolve } from 'node:path';

export function controlPlaneEnvFilePaths(): string[] {
  return [
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../../../../.env'),
    resolve(__dirname, '../../.env'),
  ];
}
