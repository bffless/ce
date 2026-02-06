import { CheckCircle } from 'lucide-react';

interface SetupProgressProps {
  currentStep: number;
  totalSteps: number;
}

const steps = [
  { id: 1, name: 'Admin Account' },
  { id: 2, name: 'Storage' },
  { id: 3, name: 'Email' },
  { id: 4, name: 'Complete' },
];

export function SetupProgress({ currentStep }: SetupProgressProps) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center justify-center space-x-5">
        {steps.map((step) => (
          <li key={step.name} className="flex items-center">
            {step.id < currentStep ? (
              // Completed step
              <span className="flex items-center">
                <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-primary rounded-full">
                  <CheckCircle className="w-6 h-6 text-primary-foreground" />
                </span>
                <span className="ml-3 text-sm font-medium text-muted-foreground hidden sm:block">
                  {step.name}
                </span>
              </span>
            ) : step.id === currentStep ? (
              // Current step
              <span className="flex items-center">
                <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center border-2 border-primary rounded-full">
                  <span className="text-primary font-bold">{step.id}</span>
                </span>
                <span className="ml-3 text-sm font-medium text-primary hidden sm:block">
                  {step.name}
                </span>
              </span>
            ) : (
              // Future step
              <span className="flex items-center">
                <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center border-2 border-muted-foreground/30 rounded-full">
                  <span className="text-muted-foreground">{step.id}</span>
                </span>
                <span className="ml-3 text-sm font-medium text-muted-foreground hidden sm:block">
                  {step.name}
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}