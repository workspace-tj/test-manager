import { describe, expect, it } from 'vitest';
import { executeCliCommand } from './cli-command.js';

describe('CLI command use cases', () => {
  it('executes a validated check command without process globals', async () => {
    const messages: string[] = [];
    const errors: string[] = [];

    const code = await executeCliCommand(
      { command: 'check', config: 'fixtures/valid/test-manager.yaml' },
      { log: (message) => messages.push(message), error: (message) => errors.push(message) },
    );

    expect(code).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^check passed: \d+ document\(s\), \d+ case\(s\)$/u);
    expect(errors).toEqual([]);
  });
});
