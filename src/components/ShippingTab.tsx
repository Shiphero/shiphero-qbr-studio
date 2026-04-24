import { useState } from 'react';
import AccountHealthTab from './AccountHealthTab';
import ThreePLTab from './ThreePLTab';

type SubTab = 'health' | '3pl';

type StepState = 'done' | 'active' | 'pending';

interface WorkflowStep {
  key: string;
  label: string;
  sub: string;
  state: StepState;
  onClick?: () => void;
}

function WorkflowProgressBar({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div style={{
      background: '#fff',
      borderBottom: '0.5px solid rgba(0,0,0,0.08)',
      padding: '0 24px',
      display: 'flex',
      alignItems: 'center',
      gap: 0,
    }}>
      {steps.map((step, i) => {
        const isActive = step.state === 'active';
        const isDone = step.state === 'done';
        const isPending = step.state === 'pending';

        const dotBg = isDone ? '#22C55E' : isActive ? '#4472E8' : '#E5E7EB';
        const dotBorder = isDone ? '#22C55E' : isActive ? '#4472E8' : '#D1D5DB';
        const labelColor = isActive ? '#252F3E' : isDone ? '#374151' : '#9CA3AF';
        const subColor = isActive ? '#6B7280' : isDone ? '#9CA3AF' : '#D1D5DB';

        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            {/* Step */}
            <button
              onClick={step.onClick}
              disabled={!step.onClick}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '14px 16px',
                background: 'none', border: 'none',
                cursor: step.onClick ? 'pointer' : 'default',
                borderBottom: isActive ? '2px solid #4472E8' : '2px solid transparent',
                transition: 'border-color 0.15s',
                fontFamily: "'Metropolis', sans-serif",
              }}
            >
              {/* Circle indicator */}
              <div style={{
                width: 20, height: 20, borderRadius: '50%',
                background: dotBg,
                border: `1.5px solid ${dotBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {isDone ? (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <polyline points="2 6 5 9 10 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : isActive ? (
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                ) : (
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#D1D5DB' }} />
                )}
              </div>
              {/* Labels */}
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 12, fontWeight: isActive ? 500 : 400, color: labelColor, lineHeight: 1.3 }}>{step.label}</div>
                <div style={{ fontSize: 10, fontWeight: 400, color: subColor, lineHeight: 1.3 }}>{step.sub}</div>
              </div>
            </button>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div style={{
                width: 24, height: 1,
                background: isDone ? 'rgba(34,197,94,0.3)' : 'rgba(0,0,0,0.08)',
                flexShrink: 0,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ShippingTab() {
  const [active, setActive] = useState<SubTab>('health');

  const steps: WorkflowStep[] = [
    {
      key: 'setup',
      label: 'Setup',
      sub: 'Client + data files',
      state: 'done',
    },
    {
      key: 'health',
      label: 'Account health',
      sub: 'Stats CSV · trends',
      state: active === 'health' ? 'active' : 'done',
      onClick: () => setActive('health'),
    },
    {
      key: '3pl',
      label: '3PL accounts',
      sub: 'Shipping performance',
      state: active === '3pl' ? 'active' : active === 'health' ? 'pending' : 'done',
      onClick: () => setActive('3pl'),
    },
    {
      key: 'deck',
      label: 'Generate deck',
      sub: 'QBR deck builder',
      state: 'pending',
    },
  ];

  return (
    <div>
      <WorkflowProgressBar steps={steps} />

      {/* Content */}
      <div style={{ display: active === 'health' ? 'block' : 'none' }}><AccountHealthTab /></div>
      <div style={{ display: active === '3pl'    ? 'block' : 'none' }}><ThreePLTab /></div>
    </div>
  );
}
