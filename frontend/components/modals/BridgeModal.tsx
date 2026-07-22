"use client";

import { ArrowLeftRight } from "lucide-react";
import { BridgeWidget } from "@/components/features/BridgeWidget";
import { ModalShell } from "@/components/modals/ModalShell";

type BridgeModalProps = {
  open: boolean;
  onClose: () => void;
};

export function BridgeModal({ open, onClose }: BridgeModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      icon={<ArrowLeftRight className="h-5 w-5" />}
      title="Bridge USDC to Arc"
    >
      <div className="mt-5">
        <BridgeWidget embedded />
      </div>
    </ModalShell>
  );
}
