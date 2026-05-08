/**
 * @file ValidationBanner.tsx
 * @description Inline banner that renders the result of a VALIDATE_PROVIDER
 * probe (or the in-flight pending state). Six visual states matching the
 * tools/ui-preview/settings-ab-v2-protocol.html mock §3.
 */
import { h, Fragment } from 'preact';
import type { ProviderProbeResult } from '../../types/provider';

export type ProbeState =
  | { kind: 'idle' }
  | { kind: 'pending'; probeUrl?: string }
  | { kind: 'result'; result: ProviderProbeResult; keyUrl?: string };

interface Props {
  state: ProbeState;
}

export function ValidationBanner({ state }: Props) {
  if (state.kind === 'idle') return null;

  if (state.kind === 'pending') {
    return (
      <div className="vbanner pending" role="status" aria-live="polite">
        <div className="pulse" />
        <div className="vbanner-body">
          <strong>Probing endpoint…</strong>
          {state.probeUrl && <div className="vbanner-caption">{state.probeUrl}</div>}
        </div>
      </div>
    );
  }

  const { result, keyUrl } = state;

  switch (result.kind) {
    case 'ok':
      return (
        <div className="vbanner success" role="status">
          <span className="ico">✓</span>
          <div className="vbanner-body">
            <strong>Connected</strong>
            {result.models && result.models.length > 0 ? (
              <div className="vbanner-caption">
                {result.models.length} model{result.models.length === 1 ? '' : 's'} available
              </div>
            ) : null}
          </div>
        </div>
      );

    case 'auth-error':
      return (
        <div className="vbanner error" role="alert">
          <span className="ico">✕</span>
          <div className="vbanner-body">
            <strong>Invalid API key</strong>
            <div className="vbanner-caption">
              {result.message}
              {keyUrl && (
                <Fragment>
                  {' '}
                  <a href={keyUrl} target="_blank" rel="noopener noreferrer">Get a new key</a>
                </Fragment>
              )}
            </div>
          </div>
        </div>
      );

    case 'credits-error':
      return (
        <div className="vbanner warn" role="alert">
          <span className="ico">⚠</span>
          <div className="vbanner-body">
            <strong>Key valid · billing required</strong>
            <div className="vbanner-caption">
              {result.message}
              {result.billingUrl && (
                <Fragment>
                  {' '}
                  <a href={result.billingUrl} target="_blank" rel="noopener noreferrer">
                    Open billing page
                  </a>
                </Fragment>
              )}
            </div>
          </div>
        </div>
      );

    case 'not-found':
      return (
        <div className="vbanner error" role="alert">
          <span className="ico">✕</span>
          <div className="vbanner-body">
            <strong>Endpoint not found</strong>
            <div className="vbanner-caption">{result.message}</div>
          </div>
        </div>
      );

    case 'rate-limited':
      return (
        <div className="vbanner warn" role="alert">
          <span className="ico">⏳</span>
          <div className="vbanner-body">
            <strong>Rate limited</strong>
            <div className="vbanner-caption">{result.message}</div>
          </div>
        </div>
      );

    case 'network-error':
      return (
        <div className="vbanner warn" role="alert">
          <span className="ico">🟡</span>
          <div className="vbanner-body">
            <strong>Endpoint unreachable</strong>
            <div className="vbanner-caption">{result.message}</div>
          </div>
        </div>
      );

    case 'unknown':
      return (
        <div className="vbanner error" role="alert">
          <span className="ico">✕</span>
          <div className="vbanner-body">
            <strong>HTTP {result.status}</strong>
            <div className="vbanner-caption">{result.message}</div>
          </div>
        </div>
      );
  }
}
