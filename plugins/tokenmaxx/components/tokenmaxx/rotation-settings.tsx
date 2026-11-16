import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVIDER_LABEL } from "./format";
import type { ProviderId, ProviderState } from "./types";
import type { PolicyPatch } from "./use-tokenmaxx";

const DWELL_OPTIONS = [
  { label: "No hold", value: "0" },
  { label: "1 minute", value: "60000" },
  { label: "5 minutes", value: "300000" },
  { label: "15 minutes", value: "900000" },
];

const HYSTERESIS_OPTIONS = ["0", "5", "10", "15"];

const Field = ({
  children,
  hint,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  hint: string;
  htmlFor: string;
  label: string;
}) => (
  <div className="space-y-1.5">
    <label className="font-medium text-sm" htmlFor={htmlFor}>
      {label}
    </label>
    {children}
    <p className="text-muted-foreground text-xs">{hint}</p>
  </div>
);

type RotationSettingsProps = {
  provider: ProviderId;
  policy: ProviderState["policy"] | undefined;
  isBusy: boolean;
  onPolicy: (patch: PolicyPatch) => void;
};

export const RotationSettings = ({
  provider,
  policy,
  isBusy,
  onPolicy,
}: RotationSettingsProps) => {
  const [threshold, setThreshold] = useState(String(policy?.thresholdPercent ?? 90));

  useEffect(() => {
    if (policy !== undefined) setThreshold(String(policy.thresholdPercent));
  }, [policy]);

  const commitThreshold = () => {
    const parsed = Number(threshold);
    if (!Number.isFinite(parsed) || policy === undefined) return;
    const clamped = Math.min(99, Math.max(50, Math.round(parsed)));
    setThreshold(String(clamped));
    if (clamped !== policy.thresholdPercent) onPolicy({ provider, thresholdPercent: clamped });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Auto-rotation settings for ${PROVIDER_LABEL[provider]}`}
          disabled={policy === undefined}
        >
          <Icon name="SlidersHorizontal" className="size-3.5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{PROVIDER_LABEL[provider]} auto-rotation</DialogTitle>
          <DialogDescription>
            Auto-rotation moves traffic to the account with the most headroom once the active
            account's fullest window fills up.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field
            htmlFor={`threshold-${provider}`}
            label="Switch at"
            hint="Measured against the fullest rate-limit window, 50 to 99 percent."
          >
            <div className="flex items-center gap-2">
              <Input
                id={`threshold-${provider}`}
                name={`threshold-${provider}`}
                type="number"
                inputMode="numeric"
                min={50}
                max={99}
                step={1}
                className="w-24 tabular-nums"
                value={threshold}
                disabled={isBusy}
                onChange={(event) => setThreshold(event.target.value)}
                onBlur={commitThreshold}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitThreshold();
                  }
                }}
              />
              <span className="text-muted-foreground text-sm">percent used</span>
            </div>
          </Field>

          <Field
            htmlFor={`dwell-${provider}`}
            label="Hold after a switch"
            hint="Stops threshold switches from flapping between accounts."
          >
            <Select
              value={String(policy?.minimumDwellMilliseconds ?? 0)}
              disabled={isBusy}
              onValueChange={(value) =>
                onPolicy({ minimumDwellMilliseconds: Number(value), provider })
              }
            >
              <SelectTrigger id={`dwell-${provider}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DWELL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            htmlFor={`hysteresis-${provider}`}
            label="Hysteresis"
            hint="How far below the threshold an account must fall before it is used again."
          >
            <Select
              value={String(policy?.hysteresisPercent ?? 5)}
              disabled={isBusy}
              onValueChange={(value) => onPolicy({ hysteresisPercent: Number(value), provider })}
            >
              <SelectTrigger id={`hysteresis-${provider}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HYSTERESIS_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
