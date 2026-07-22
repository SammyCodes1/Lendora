"use client";

import { FormEvent, useState } from "react";
import { BookUser, Trash2, X } from "lucide-react";
import type { WalletContact } from "@/lib/agentTypes";

type ContactBookProps = {
  contacts: WalletContact[];
  onAdd: (name: string, address: string) => void;
  onRemove: (address: string) => void;
  onClose: () => void;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ContactBook({
  contacts,
  onAdd,
  onRemove,
  onClose,
}: ContactBookProps) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      onAdd(name, address);
      setName("");
      setAddress("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save contact.",
      );
    }
  };

  return (
    <div className="absolute inset-0 z-[60] isolate flex flex-col overflow-hidden bg-[#090c0e]">
      <header className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3.5">
        <div className="flex items-center gap-2">
          <BookUser className="h-4 w-4 text-emerald-200" />
          <div>
            <h3 className="text-sm font-semibold text-white">Wallet contacts</h3>
            <p className="text-[10px] text-white/40">Saved only in this browser</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close wallet contacts"
          onClick={onClose}
          className="rounded-lg p-2 text-white/45 hover:bg-white/[0.06] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <form onSubmit={submit} className="space-y-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nickname, e.g. Alice"
            maxLength={24}
            className="w-full rounded-lg border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-white outline-none focus:border-emerald-200/35"
          />
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="0x wallet address"
            className="w-full rounded-lg border border-white/10 bg-white/[0.045] px-3 py-2 font-mono text-xs text-white outline-none focus:border-emerald-200/35"
          />
          {error ? <p className="text-xs text-red-300">{error}</p> : null}
          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-200 px-3 py-2 text-sm font-semibold text-[#07100c] hover:bg-emerald-100"
          >
            Save contact
          </button>
        </form>

        <div className="mt-5 space-y-2">
          {contacts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-white/35">
              No saved contacts yet.
            </p>
          ) : (
            contacts.map((contact) => (
              <div
                key={contact.address}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {contact.name}
                  </p>
                  <p className="font-mono text-[10px] text-white/40">
                    {shortAddress(contact.address)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${contact.name}`}
                  onClick={() => onRemove(contact.address)}
                  className="rounded-md p-2 text-white/35 hover:bg-red-400/10 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
