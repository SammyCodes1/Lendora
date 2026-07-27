"use client";

import { useCallback, useEffect, useState } from "react";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";

export const DEFAULT_AGENT_NAME = "ArcLend Assistant";

const STORAGE_PREFIX = "arclend:agent-name:v1";
const AGENT_NAME_CHANGED_EVENT = "arclend:agent-name-changed";
const MAX_LENGTH = 24;

function storageKey(owner: string) {
  return `${STORAGE_PREFIX}:${owner.toLowerCase()}`;
}

function ownerKey(address?: string | null) {
  return address ? address.toLowerCase() : "device";
}

function readStoredName(owner: string): string | null {
  try {
    const raw = window.localStorage.getItem(storageKey(owner));
    if (!raw) return null;
    const trimmed = raw.trim();
    return isValidAgentName(trimmed) ? trimmed : null;
  } catch {
    return null;
  }
}

export function isValidAgentName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,23}$/.test(name.trim());
}

export function normalizeAgentName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new Error("Enter a name for your agent.");
  }
  if (trimmed.length > MAX_LENGTH) {
    throw new Error(`Name must be ${MAX_LENGTH} characters or fewer.`);
  }
  if (!isValidAgentName(trimmed)) {
    throw new Error(
      "Name must start with a letter or number and use only letters, numbers, spaces, _ or -.",
    );
  }
  return trimmed;
}

export function useAgentName() {
  const { address } = useArcLendAccount();
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME);

  const refresh = useCallback(() => {
    const key = ownerKey(address);
    const stored = readStoredName(key);
    // Prefer wallet-scoped name; fall back to device-level name when wallet has none yet.
    if (stored) {
      setAgentName(stored);
      return;
    }
    if (address) {
      const deviceName = readStoredName("device");
      setAgentName(deviceName ?? DEFAULT_AGENT_NAME);
      return;
    }
    setAgentName(DEFAULT_AGENT_NAME);
  }, [address]);

  useEffect(() => {
    refresh();
    window.addEventListener(AGENT_NAME_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(AGENT_NAME_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const setName = useCallback(
    (nameInput: string) => {
      const name = normalizeAgentName(nameInput);
      const key = ownerKey(address);
      window.localStorage.setItem(storageKey(key), name);
      // Keep device copy in sync so reconnects still show a familiar name.
      if (address) {
        window.localStorage.setItem(storageKey("device"), name);
      }
      setAgentName(name);
      window.dispatchEvent(new Event(AGENT_NAME_CHANGED_EVENT));
      return name;
    },
    [address],
  );

  const resetName = useCallback(() => {
    const key = ownerKey(address);
    window.localStorage.removeItem(storageKey(key));
    if (address) {
      window.localStorage.removeItem(storageKey("device"));
    }
    setAgentName(DEFAULT_AGENT_NAME);
    window.dispatchEvent(new Event(AGENT_NAME_CHANGED_EVENT));
  }, [address]);

  const avatarLetter = (agentName.trim()[0] ?? "A").toUpperCase();

  return {
    agentName,
    avatarLetter,
    setName,
    resetName,
    isDefault: agentName === DEFAULT_AGENT_NAME,
    maxLength: MAX_LENGTH,
  };
}
