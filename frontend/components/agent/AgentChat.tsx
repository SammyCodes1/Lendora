"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  Activity,
  BookUser,
  Loader2,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { ActionConfirmCard } from "@/components/agent/ActionConfirmCard";
import { ContactBook } from "@/components/agent/ContactBook";
import { AgentTransactionReceiptCard } from "@/components/agent/AgentTransactionReceiptCard";
import { GlassCard } from "@/components/ui/GlassCard";
import { useAgent } from "@/hooks/useAgent";
import {
  DEFAULT_AGENT_NAME,
  useAgentName,
} from "@/hooks/useAgentName";
import { cn } from "@/lib/utils";

const suggestions = [
  "Supply 100 USDC",
  "Request 40 USDC",
  "Send 40 USDC to ada.lendora every Friday from my yield, keep health above 1.5",
];

function AgentMessageText({ content }: { content: string }) {
  const parts = content.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("http") ? (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="break-all text-emerald-100 underline decoration-emerald-200/40 underline-offset-2 hover:text-white"
          >
            {part}
          </a>
        ) : (
          <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>
        ),
      )}
    </>
  );
}

function AgentAvatarLetter({
  letter,
  className,
}: {
  letter: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative font-display font-semibold leading-none text-emerald-100",
        className,
      )}
    >
      {letter}
    </span>
  );
}

export function AgentChat() {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [showSafety, setShowSafety] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(DEFAULT_AGENT_NAME);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hasOpened, setHasOpened] = useState(false);
  const assistantRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const {
    agentName,
    avatarLetter,
    setName,
    resetName,
    isDefault,
    maxLength,
  } = useAgentName();
  const {
    messages,
    sendMessage,
    isPending,
    pendingAction,
    clearPendingAction,
    completePendingAction,
    blockPendingAction,
    contacts,
    addContact,
    removeContact,
  } = useAgent();

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [isPending, messages, pendingAction]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !assistantRef.current?.contains(target) &&
        !(target instanceof Element &&
          target.closest("[data-agent-transaction-portal]"))
      ) {
        setOpen(false);
        setShowContacts(false);
        setRenaming(false);
        setNameError(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!renaming) return;
    setNameDraft(agentName);
    setNameError(null);
    const id = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [renaming, agentName]);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next && !hasOpened) {
        setHasOpened(true);
        setShowSafety(true);
      }
      if (!next) {
        setRenaming(false);
        setNameError(null);
      }
      return next;
    });
  };

  const startRename = () => {
    setShowContacts(false);
    setRenaming(true);
  };

  const cancelRename = () => {
    setRenaming(false);
    setNameDraft(agentName);
    setNameError(null);
  };

  const saveRename = (event?: FormEvent) => {
    event?.preventDefault();
    setNameError(null);
    try {
      setName(nameDraft);
      setRenaming(false);
    } catch (caught) {
      setNameError(
        caught instanceof Error ? caught.message : "Unable to save that name.",
      );
    }
  };

  const handleResetName = () => {
    resetName();
    setNameDraft(DEFAULT_AGENT_NAME);
    setNameError(null);
    setRenaming(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || isPending) {
      return;
    }
    setInput("");
    await sendMessage(message);
  };

  return (
    <div
      ref={assistantRef}
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] z-[130] sm:bottom-6 sm:right-6"
    >
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 18 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed inset-x-0 bottom-0 sm:absolute sm:inset-auto sm:bottom-16 sm:right-0"
          >
            <GlassCard className="relative flex h-[min(78dvh,calc(100dvh-5.5rem-env(safe-area-inset-top,0px)))] w-full flex-col overflow-hidden rounded-b-none border-emerald-200/[0.12] bg-[#090c0e]/96 p-0 shadow-[0_28px_100px_rgba(0,0,0,0.72),0_0_45px_rgba(52,211,153,0.08)] backdrop-blur-xl sm:h-[min(520px,calc(100vh-10.5rem))] sm:w-[min(380px,calc(100vw-2rem))] sm:rounded-2xl">
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute -left-24 -top-20 h-52 w-52 rounded-full bg-emerald-300/[0.08] blur-3xl"
                animate={
                  reduceMotion
                    ? undefined
                    : { x: [0, 300, 120, 0], y: [0, 130, 420, 0] }
                }
                transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute -right-20 bottom-8 h-44 w-44 rounded-full bg-cyan-300/[0.06] blur-3xl"
                animate={
                  reduceMotion
                    ? undefined
                    : { x: [0, -250, -80, 0], y: [0, -180, -380, 0] }
                }
                transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }}
              />

              <header className="relative z-10 flex items-center justify-between border-b border-white/[0.08] bg-black/10 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <motion.span
                    className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-200/25 bg-emerald-200/[0.09] text-emerald-100"
                    animate={
                      reduceMotion
                        ? undefined
                        : {
                            boxShadow: [
                              "0 0 0 rgba(110,231,183,0)",
                              "0 0 22px rgba(110,231,183,0.23)",
                              "0 0 0 rgba(110,231,183,0)",
                            ],
                          }
                    }
                    transition={{ duration: 2.4, repeat: Infinity }}
                  >
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-[-4px] rounded-[14px] border border-dashed border-emerald-200/15"
                      animate={reduceMotion ? undefined : { rotate: 360 }}
                      transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
                    />
                    <AgentAvatarLetter letter={avatarLetter} className="text-lg" />
                    <motion.span
                      className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#090c0e] bg-emerald-300"
                      animate={
                        reduceMotion
                          ? undefined
                          : { scale: [0.75, 1.25, 0.75], opacity: [0.55, 1, 0.55] }
                      }
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                  </motion.span>
                  <div className="min-w-0">
                    {renaming ? (
                      <form onSubmit={saveRename} className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <input
                            ref={nameInputRef}
                            value={nameDraft}
                            onChange={(event) => {
                              setNameDraft(event.target.value);
                              setNameError(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelRename();
                              }
                            }}
                            maxLength={maxLength}
                            aria-label="Agent name"
                            placeholder={DEFAULT_AGENT_NAME}
                            className="w-[min(11rem,42vw)] rounded-md border border-emerald-200/30 bg-white/[0.06] px-2 py-1 text-sm font-semibold text-white outline-none focus:border-emerald-200/55"
                          />
                          <button
                            type="submit"
                            className="rounded-md bg-emerald-200 px-2 py-1 text-[10px] font-semibold text-[#07100c] hover:bg-emerald-100"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelRename}
                            className="rounded-md px-1.5 py-1 text-[10px] text-white/45 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                        {nameError ? (
                          <p className="max-w-[14rem] text-[10px] leading-4 text-red-300">
                            {nameError}
                          </p>
                        ) : (
                          <p className="text-[10px] text-white/35">
                            Saved in this browser · Esc to cancel
                          </p>
                        )}
                      </form>
                    ) : (
                      <>
                        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-white">
                          <button
                            type="button"
                            onClick={startRename}
                            title="Rename your agent"
                            aria-label={`Rename agent (currently ${agentName})`}
                            className="truncate text-left transition hover:text-emerald-100"
                          >
                            {agentName}
                          </button>
                          <Zap className="h-3 w-3 shrink-0 text-emerald-300" />
                        </h2>
                        <p className="flex items-center gap-1.5 text-[10px] text-white/40">
                          <Activity className="h-3 w-3 text-cyan-200/65" />
                          Live non-custodial agent
                        </p>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!renaming ? (
                    <button
                      type="button"
                      aria-label="Rename agent"
                      onClick={startRename}
                      className="rounded-lg p-2 text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  ) : !isDefault ? (
                    <button
                      type="button"
                      aria-label={`Reset name to ${DEFAULT_AGENT_NAME}`}
                      title={`Reset to ${DEFAULT_AGENT_NAME}`}
                      onClick={handleResetName}
                      className="rounded-lg p-2 text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Manage wallet contacts"
                    onClick={() => {
                      setRenaming(false);
                      setShowContacts(true);
                    }}
                    className="rounded-lg p-2 text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    <BookUser className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${agentName}`}
                    onClick={() => setOpen(false)}
                    className="rounded-lg p-2 text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </header>

              {showContacts ? (
                <ContactBook
                  contacts={contacts}
                  onAdd={addContact}
                  onRemove={removeContact}
                  onClose={() => setShowContacts(false)}
                />
              ) : null}

              <div
                ref={scrollRef}
                className="relative z-10 flex-1 overflow-y-auto px-4 py-4"
              >
                <AnimatePresence>
                  {showSafety ? (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="mb-4 rounded-xl border border-cyan-200/15 bg-cyan-200/[0.06] p-3 text-xs leading-5 text-cyan-50/75"
                    >
                      <div className="flex items-start gap-2">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
                        <p>
                          I prepare transactions for your review — I never
                          execute anything without your wallet signature, and I
                          never have access to your funds or private keys.
                        </p>
                        <button
                          type="button"
                          aria-label="Dismiss safety notice"
                          onClick={() => setShowSafety(false)}
                          className="text-white/40 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {messages.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center text-center">
                    <motion.span
                      className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] text-emerald-100"
                      animate={
                        reduceMotion
                          ? undefined
                          : { y: [0, -6, 0], rotate: [0, 2, -2, 0] }
                      }
                      transition={{ duration: 3.2, repeat: Infinity }}
                    >
                      <motion.span
                        aria-hidden="true"
                        className="absolute inset-[-10px] rounded-full border border-dashed border-emerald-200/15"
                        animate={reduceMotion ? undefined : { rotate: 360 }}
                        transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                      />
                      <AgentAvatarLetter letter={avatarLetter} className="text-2xl" />
                    </motion.span>
                    <p className="mt-4 text-sm font-medium text-white">
                      What would you like to do?
                    </p>
                    <p className="mt-1 max-w-64 text-xs leading-5 text-white/40">
                      I’m {agentName}. I’ll interpret your request and prepare an
                      action for your review.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => setInput(suggestion)}
                          className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[10px] text-white/55 transition hover:bg-white/[0.07] hover:text-white"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((message) => (
                      <motion.div
                        key={message.id}
                        layout
                        initial={{
                          opacity: 0,
                          x: message.role === "user" ? 18 : -18,
                          y: 6,
                        }}
                        animate={{ opacity: 1, x: 0, y: 0 }}
                        transition={{ type: "spring", stiffness: 280, damping: 24 }}
                      >
                        <motion.div
                          whileHover={reduceMotion ? undefined : { scale: 1.012 }}
                          className={cn(
                            "relative max-w-[88%] overflow-hidden whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                            message.role === "user"
                              ? "ml-auto border border-white/[0.08] bg-white/10 text-white"
                              : "border border-emerald-200/[0.09] bg-white/[0.05] text-white/70",
                          )}
                        >
                          {message.role === "agent" && !reduceMotion ? (
                            <motion.span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-y-0 w-12 -skew-x-12 bg-gradient-to-r from-transparent via-emerald-100/[0.06] to-transparent"
                              animate={{ x: [-80, 360] }}
                              transition={{
                                duration: 3.8,
                                delay: 0.7,
                                repeat: Infinity,
                                repeatDelay: 4,
                              }}
                            />
                          ) : null}
                          <AgentMessageText content={message.content} />
                        </motion.div>
                        {message.receipt ? (
                          <AgentTransactionReceiptCard
                            receipt={message.receipt}
                          />
                        ) : null}
                        {message.action &&
                        pendingAction === message.action ? (
                          <ActionConfirmCard
                            validatedAction={message.action}
                            onCancel={() => clearPendingAction(true)}
                            onComplete={completePendingAction}
                            onBlocked={blockPendingAction}
                          />
                        ) : null}
                      </motion.div>
                    ))}
                  </div>
                )}

                {isPending ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 flex w-fit items-center gap-2 rounded-2xl border border-emerald-200/[0.1] bg-white/[0.05] px-3 py-2.5 text-xs text-white/40"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
                    Interpreting
                    <span className="flex gap-1">
                      {[0, 1, 2].map((dot) => (
                        <motion.span
                          key={dot}
                          className="h-1 w-1 rounded-full bg-emerald-200"
                          animate={
                            reduceMotion
                              ? undefined
                              : { y: [0, -3, 0], opacity: [0.35, 1, 0.35] }
                          }
                          transition={{
                            duration: 0.8,
                            delay: dot * 0.14,
                            repeat: Infinity,
                          }}
                        />
                      ))}
                    </span>
                  </motion.div>
                ) : null}
              </div>

              <form
                onSubmit={submit}
                className="relative z-10 border-t border-white/[0.08] bg-black/15 p-3"
              >
                <motion.div
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-2 transition-[border-color,box-shadow,transform] duration-200 focus-within:scale-[1.006] focus-within:border-emerald-200/35 focus-within:shadow-[0_0_24px_rgba(110,231,183,0.1)] motion-reduce:focus-within:scale-100"
                >
                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    maxLength={2_000}
                    placeholder="Supply 100 USDC…"
                    aria-label="Transaction command"
                    className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-white/25"
                  />
                  <button
                    type="submit"
                    aria-label="Send command"
                    disabled={!input.trim() || isPending}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-200 text-[#07100c] transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </motion.div>
              </form>
            </GlassCard>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.button
        type="button"
        aria-label={open ? `Close ${agentName}` : `Open ${agentName}`}
        aria-expanded={open}
        onClick={toggle}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className={cn(
          "relative flex h-14 w-14 items-center justify-center rounded-full border border-emerald-100/30 bg-[#0c1513] text-emerald-100 shadow-[0_12px_45px_rgba(0,0,0,0.55),0_0_28px_rgba(110,231,183,0.2)]",
          open && "hidden sm:flex",
        )}
      >
        <motion.span
          aria-hidden="true"
          className="absolute inset-[-6px] rounded-full border border-dashed border-emerald-200/25"
          animate={reduceMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 9, repeat: Infinity, ease: "linear" }}
        />
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-emerald-200/20"
          animate={
            reduceMotion
              ? undefined
              : { scale: [1, 1.42, 1.42], opacity: [0.5, 0, 0] }
          }
          transition={{ duration: 2.2, repeat: Infinity }}
        />
        {open ? (
          <X className="relative h-5 w-5" />
        ) : (
          <AgentAvatarLetter letter={avatarLetter} className="text-2xl" />
        )}
      </motion.button>
    </div>
  );
}
