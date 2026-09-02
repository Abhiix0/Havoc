import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Target } from '../../../domain/target';
import { verifyTarget } from '../safety-controller';

describe('Safety Controller', () => {
  const target: Target = {
    tabId: 101,
    origin: 'https://example.com',
    url: 'https://example.com/app',
    frameId: 0,
  };

  beforeEach(() => {
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(),
      },
    });
  });

  it('returns TAB_NOT_FOUND when chrome.tabs.get rejects', async () => {
    vi.mocked(chrome.tabs.get).mockRejectedValueOnce(new Error('Tab does not exist'));

    const result = await verifyTarget(target);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('TAB_NOT_FOUND');
      expect(result.detail).toContain('Tab 101 no longer exists');
    }
  });

  it('returns TAB_LOADING when tab is still in loading status', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValueOnce({
      id: 101,
      status: 'loading',
      url: 'https://example.com/app',
    } as chrome.tabs.Tab);

    const result = await verifyTarget(target);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('TAB_LOADING');
      expect(result.detail).toContain('Tab 101 is still loading');
    }
  });

  it('returns ORIGIN_MISMATCH when tab has an unparseable URL', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValueOnce({
      id: 101,
      status: 'complete',
      url: 'not-a-valid-url',
    } as chrome.tabs.Tab);

    const result = await verifyTarget(target);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('ORIGIN_MISMATCH');
      expect(result.detail).toContain('has an unparseable URL: "not-a-valid-url"');
    }
  });

  it('returns ORIGIN_MISMATCH when tab navigated to a different origin', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValueOnce({
      id: 101,
      status: 'complete',
      url: 'https://malicious.com/phishing',
    } as chrome.tabs.Tab);

    const result = await verifyTarget(target);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('ORIGIN_MISMATCH');
      expect(result.detail).toContain('navigated from "https://example.com" to "https://malicious.com"');
    }
  });

  it('returns ok: true when tab is complete and on the same origin', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValueOnce({
      id: 101,
      status: 'complete',
      url: 'https://example.com/other-page',
    } as chrome.tabs.Tab);

    const result = await verifyTarget(target);

    expect(result).toEqual({ ok: true });
  });
});
