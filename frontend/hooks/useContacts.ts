"use client";

import { useCallback, useEffect, useState } from "react";
import { getAddress, isAddress } from "viem";
import type { WalletContact } from "@/lib/agentTypes";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";

const STORAGE_PREFIX = "arclend:contacts:v1";
const CONTACTS_CHANGED_EVENT = "arclend:contacts-changed";

function storageKey(owner: string) {
  return `${STORAGE_PREFIX}:${owner.toLowerCase()}`;
}

function readContacts(owner: string): WalletContact[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey(owner)) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        !("name" in entry) ||
        !("address" in entry) ||
        typeof entry.name !== "string" ||
        typeof entry.address !== "string" ||
        !isAddress(entry.address)
      ) {
        return [];
      }
      return [{
        name: entry.name.trim(),
        address: getAddress(entry.address),
      }];
    });
  } catch {
    return [];
  }
}

export function useContacts() {
  const { address } = useArcLendAccount();
  const [contacts, setContacts] = useState<WalletContact[]>([]);

  const refresh = useCallback(() => {
    setContacts(address ? readContacts(address) : []);
  }, [address]);

  useEffect(() => {
    refresh();
    window.addEventListener(CONTACTS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CONTACTS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const persist = useCallback(
    (next: WalletContact[]) => {
      if (!address) {
        throw new Error("Connect your wallet before managing contacts.");
      }
      window.localStorage.setItem(storageKey(address), JSON.stringify(next));
      setContacts(next);
      window.dispatchEvent(new Event(CONTACTS_CHANGED_EVENT));
    },
    [address],
  );

  const addContact = useCallback(
    (nameInput: string, addressInput: string) => {
      const name = nameInput.trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,23}$/.test(name)) {
        throw new Error(
          "Nickname must be 1–24 characters using letters, numbers, spaces, _ or -.",
        );
      }
      if (!isAddress(addressInput.trim())) {
        throw new Error("Enter a valid EVM wallet address.");
      }
      const contactAddress = getAddress(addressInput.trim());
      if (address && contactAddress.toLowerCase() === address.toLowerCase()) {
        throw new Error("Use a different address from your connected wallet.");
      }
      const duplicate = contacts.some(
        (contact) =>
          contact.name.toLowerCase() === name.toLowerCase() ||
          contact.address.toLowerCase() === contactAddress.toLowerCase(),
      );
      if (duplicate) {
        throw new Error("That nickname or wallet address is already saved.");
      }
      persist([...contacts, { name, address: contactAddress }]);
    },
    [address, contacts, persist],
  );

  const removeContact = useCallback(
    (contactAddress: string) => {
      persist(
        contacts.filter(
          (contact) =>
            contact.address.toLowerCase() !== contactAddress.toLowerCase(),
        ),
      );
    },
    [contacts, persist],
  );

  return { contacts, addContact, removeContact };
}
