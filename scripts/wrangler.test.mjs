import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyOverrides, envOverrides, stripJsonc } from './wrangler.mjs';

describe('stripJsonc', () => {
  it('drops comments and trailing commas but leaves strings alone', () => {
    const text = `// head
    {
      /* block */ "url": "https://example.com/a//b", // trailing
      "esc": "quote \\" // not a comment",
      "list": [1, 2,],
    }`;
    expect(JSON.parse(stripJsonc(text))).toEqual({
      url: 'https://example.com/a//b',
      esc: 'quote " // not a comment',
      list: [1, 2],
    });
  });

  it('parses the real template', () => {
    const cfg = JSON.parse(stripJsonc(readFileSync('wrangler.jsonc', 'utf8')));
    expect(cfg.name).toBe('dombot');
    expect(cfg.d1_databases[0].binding).toBe('DB');
    expect(cfg.triggers.crons).toEqual(['0 * * * *']);
  });
});

describe('applyOverrides', () => {
  const template = JSON.parse(
    stripJsonc(readFileSync('wrangler.jsonc', 'utf8')),
  );

  it('sets the name and database without touching the template', () => {
    const out = applyOverrides(template, {
      name: 'dombot-me',
      database_id: 'abc',
      vars: { CF_ACCESS_AUD: 'x' },
      routes: [{ pattern: 'd.example.com', custom_domain: true }],
    });
    expect(out.name).toBe('dombot-me');
    expect(out.d1_databases[0].database_id).toBe('abc');
    expect(out.d1_databases[0].binding).toBe('DB');
    expect(out.vars).toEqual({ DOMBOT_AUTH: 'password', CF_ACCESS_AUD: 'x' });
    expect(out.routes).toHaveLength(1);
    expect(out.assets).toEqual(template.assets);
    expect(template.name).toBe('dombot');
    expect(template.d1_databases[0].database_id).toMatch(/^0+-/);
  });

  it('reads overrides from the environment', () => {
    expect(envOverrides({})).toEqual({});
    expect(
      envOverrides({
        DOMBOT_WORKER_NAME: 'dombot-ci',
        DOMBOT_D1_DATABASE_ID: 'id-1',
        DOMBOT_D1_DATABASE_NAME: 'db',
        UNRELATED: 'x',
      }),
    ).toEqual({ name: 'dombot-ci', database_id: 'id-1', database_name: 'db' });
  });

  it('passes unknown keys through as top-level wrangler settings', () => {
    expect(applyOverrides(template, { workers_dev: false }).workers_dev).toBe(
      false,
    );
  });
});
