"use client";

import type { ReactNode } from "react";
import { Modal } from "@/components/ui/modal";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  description?: string;
}

/** Older name for Modal, kept so existing imports keep working. */
export function Dialog({ open, onClose, children, title, description }: DialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      {children}
    </Modal>
  );
}
