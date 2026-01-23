/**
 * @file ExperimentTab.tsx
 * @description A/B Testing experiment tab component
 */

import { h } from 'preact';
import { Text } from '@create-figma-plugin/ui';
import { tokens } from './design-system/tokens';
import { cardStyle, btnPrimaryStyle } from './styles';
import { TestSummary, PromptVariant } from '../../tests/promptTester';

export interface ExperimentTabProps {
  testRunning: boolean;
  testProgress: { variant: PromptVariant; current: number; total: number } | null;
  testSummaries: TestSummary[];
  onRunExperiment: (testType: 'prompt' | 'schema' | 'postprocessor') => void;
}

export function ExperimentTab({
  testRunning,
  testProgress,
  testSummaries,
  onRunExperiment,
}: ExperimentTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[4] }}>
      <div style={cardStyle}>
        <Text style={{ fontWeight: 600, fontSize: tokens.fontSize[1], marginBottom: tokens.space[2] }}>Prompt Structure A/B Test</Text>
        <Text style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary, marginBottom: tokens.space[4] }}>
          Compare 3 prompt variants × 10 iterations each
        </Text>
        <button
          onClick={() => onRunExperiment('prompt')}
          disabled={testRunning}
          style={{
            ...btnPrimaryStyle,
            opacity: testRunning ? 0.5 : 1,
            cursor: testRunning ? 'not-allowed' : 'pointer'
          }}
        >
          {testRunning ? 'Running...' : 'Start Test (30 generations)'}
        </button>
      </div>

      {testProgress && (
        <div style={cardStyle}>
          <Text style={{ fontSize: tokens.fontSize[1], marginBottom: tokens.space[2] }}>
            Testing: <span style={{ color: tokens.colors.accent }}>{testProgress.variant}</span>
          </Text>
          <div style={{
            background: tokens.colors.bg1, // Migrated from colors.background
            borderRadius: 'var(--radius-2)',
            height: tokens.space[2], // 8px
            overflow: 'hidden',
            marginBottom: tokens.space[1]
          }}>
            <div style={{
              height: '100%',
              width: `${(testProgress.current / testProgress.total) * 100}%`,
              background: tokens.colors.accent,
              transition: 'width 0.3s'
            }} />
          </div>
          <Text style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary }}>
            {testProgress.current} / {testProgress.total}
          </Text>
        </div>
      )}

      {testSummaries.length > 0 && (
        <div style={cardStyle}>
          <Text style={{ fontWeight: 600, fontSize: tokens.fontSize[1], marginBottom: tokens.space[4] }}>Results</Text>
          <table style={{ width: '100%', fontSize: tokens.fontSize[1], borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${tokens.colors.border}` }}>
                <th style={{ textAlign: 'left', padding: `${tokens.space[1]}px 0`, color: tokens.colors.textSecondary }}>Variant</th>
                <th style={{ textAlign: 'right', padding: `${tokens.space[1]}px 0`, color: tokens.colors.textSecondary }}>Button</th>
                <th style={{ textAlign: 'right', padding: `${tokens.space[1]}px 0`, color: tokens.colors.textSecondary }}>Stats</th>
                <th style={{ textAlign: 'right', padding: `${tokens.space[1]}px 0`, color: tokens.colors.textSecondary }}>Avatar</th>
                <th style={{ textAlign: 'right', padding: `${tokens.space[1]}px 0`, color: tokens.colors.textSecondary }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {testSummaries.map(summary => (
                <tr key={summary.variant} style={{ borderBottom: `1px solid ${tokens.colors.border}` }}>
                  <td style={{ padding: `${tokens.space[2]}px 0`, fontWeight: 600 }}>
                    {summary.variant === 'current' ? 'Current' : summary.variant === 'example-first' ? 'Example-First' : 'Constraint-First'}
                  </td>
                  <td style={{
                    textAlign: 'right',
                    color: summary.buttonHeightAccuracy > 0.7 ? tokens.colors.success : tokens.colors.destructive
                  }}>
                    {(summary.buttonHeightAccuracy * 100).toFixed(0)}%
                  </td>
                  <td style={{
                    textAlign: 'right',
                    color: summary.statsLayoutAccuracy > 0.7 ? tokens.colors.success : tokens.colors.destructive
                  }}>
                    {(summary.statsLayoutAccuracy * 100).toFixed(0)}%
                  </td>
                  <td style={{
                    textAlign: 'right',
                    color: summary.avatarCornerAccuracy > 0.7 ? tokens.colors.success : tokens.colors.destructive
                  }}>
                    {(summary.avatarCornerAccuracy * 100).toFixed(0)}%
                  </td>
                  <td style={{ textAlign: 'right', color: tokens.colors.textSecondary }}>
                    {(summary.avgGenerationTime / 1000).toFixed(1)}s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
