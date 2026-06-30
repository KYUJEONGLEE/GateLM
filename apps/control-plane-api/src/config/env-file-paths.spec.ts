import { resolve } from 'node:path';

import { controlPlaneEnvFilePaths } from './env-file-paths';

describe('controlPlaneEnvFilePaths', () => {
  it('includes the current working directory env file', () => {
    expect(controlPlaneEnvFilePaths()).toContain(resolve(process.cwd(), '.env'));
  });

  it('includes the repository root env file when loaded from source', () => {
    expect(controlPlaneEnvFilePaths()).toContain(
      resolve(__dirname, '../../../../.env'),
    );
  });

  it('keeps the app-local env file as a fallback', () => {
    expect(controlPlaneEnvFilePaths()).toContain(resolve(__dirname, '../../.env'));
  });
});
