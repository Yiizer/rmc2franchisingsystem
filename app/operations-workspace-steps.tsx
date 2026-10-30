'use client';
import { Check } from 'lucide-react';

const stages = ['Review form', 'Choose template', 'Preview & approval'];

// Step cards with a one-line status under each title (mockup layout).
export default function WorkspaceSteps({ step, disabled, complete, details, onStep }: {
  step: number; disabled: boolean[]; complete: boolean[]; details?: string[]; onStep: (step: number) => void;
}) {
  return <nav className="ops-workspace-steps ops-step-cards" aria-label="Proposal workflow">
    {stages.map((title, index) => <button
      key={title} type="button" aria-label={title} aria-current={step === index ? 'step' : undefined}
      disabled={disabled[index]} onClick={() => onStep(index)}
      className={(step === index ? 'active ' : '') + (complete[index] ? 'complete' : '')}>
      <span className="ops-step-symbol" aria-hidden="true">
        {complete[index] && step !== index ? <Check size={14}/> : index + 1}
      </span>
      <span className="ops-step-text"><span>{title}</span>{details?.[index]&&<small>{details[index]}</small>}</span>
    </button>)}
  </nav>;
}
