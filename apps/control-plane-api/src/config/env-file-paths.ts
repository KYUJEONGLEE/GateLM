import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function controlPlaneEnvFilePaths(): string[] {
  return uniquePaths([
    resolve(findAncestorWithMarker(__dirname, 'nest-cli.json') ?? process.cwd(), '.env'),
    resolve(findAncestorWithMarker(__dirname, 'pnpm-workspace.yaml') ?? process.cwd(), '.env'),
    resolve(process.cwd(), '.env'),
  ]);
}

function findAncestorWithMarker(startDir: string, marker: string): string | undefined {
  let currentDir = startDir;

  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(resolve(currentDir, marker))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }

  return undefined;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}
