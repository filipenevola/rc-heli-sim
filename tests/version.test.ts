import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Every release must bump package.json and have a matching entry at the top of CHANGELOG.md. */
describe('release bookkeeping', () => {
  it('CHANGELOG.md starts with the package.json version', () => {
    const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    const first = changelog.match(/^## (\S+)/m)?.[1];
    expect(first).toBe(version);
  });
});
