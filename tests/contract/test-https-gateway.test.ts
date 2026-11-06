import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = () => readFileSync(new URL('../../deploy/test-idp/workbench-https.nginx.conf', import.meta.url), 'utf8');

describe('isolated TEST Workbench HTTPS gateway template', () => {
  it('terminates TLS, forwards only auth paths to loopback, and forwards an allowlist of headers', () => {
    const text = template();
    expect(text).toContain('listen 443 ssl');
    expect(text).toContain('server_name workbench.example.invalid');
    expect(text).toContain('location = /auth');
    expect(text).toContain('location ^~ /auth/');
    expect(text).toContain('proxy_pass http://127.0.0.1:3411');
    expect(text).toContain('proxy_pass_request_headers off');
    expect(text).toContain('proxy_set_header Host workbench.example.invalid');
    expect(text).toContain('proxy_set_header Cookie $http_cookie');
    expect(text).toContain('proxy_set_header Origin $http_origin');
    expect(text).toContain('proxy_set_header X-Workbench-CSRF $http_x_workbench_csrf');
    expect(text).toContain('proxy_set_header Sec-Fetch-Mode $http_sec_fetch_mode');
    expect(text).toContain('proxy_set_header Sec-Fetch-Site $http_sec_fetch_site');
    expect(text).toContain('proxy_set_header Sec-Fetch-Dest $http_sec_fetch_dest');
    expect(text).toContain('return 404');
    expect(text).toContain('return 421');
    expect(text).not.toMatch(/proxy_set_header\s+(?:Forwarded|X-Forwarded-)/i);
    expect(text).not.toMatch(/ssl_certificate\s+\/[^<]/);
  });
});
