"use client";

import { motion, useReducedMotion } from "framer-motion";

function ArcLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 31 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M0 32C.26 24.17 1.59 16.85 3.82 11.17 6.64 3.97 10.73 0 15.32 0s8.68 3.97 11.5 11.17c1.47 3.75 2.55 8.2 3.19 13.04.06.43.11.87.16 1.31.02.03.03.05.02.07 0 0 .38 2.34.46 6.41h-.04c-.56-.46-7.14-5.61-18.04-4.12.16-1.84.39-3.63.68-5.34l.05-.26c4.28-.13 8.02.37 10.89 1.02l-.03-.21c-.59-3.66-1.46-7.01-2.58-9.88-1.84-4.68-4.23-7.59-6.25-7.59s-4.41 2.91-6.25 7.59c-.44 1.13-.85 2.34-1.21 3.62-.51 1.79-.94 3.7-1.28 5.71-.51 2.97-.82 6.16-.94 9.46H0Z"
        fill="currentColor"
      />
    </svg>
  );
}

const letters = "rcLend".split("");

export function AnimatedArcLend() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative mt-6 w-fit py-3">
      <h1 className="sr-only">Lendora</h1>

      <svg
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-8 -inset-y-7 h-[calc(100%+3.5rem)] w-[calc(100%+4rem)] overflow-visible"
        viewBox="0 0 620 150"
        preserveAspectRatio="none"
      >
        <motion.ellipse
          cx="310"
          cy="75"
          rx="296"
          ry="62"
          fill="none"
          stroke="url(#arc-title-orbit)"
          strokeWidth="1"
          strokeDasharray="7 13"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: [0.15, 0.65, 0.15] }}
          transition={{
            pathLength: { duration: 1.8, ease: "easeOut" },
            opacity: { duration: 3.2, repeat: Infinity },
          }}
        />
        <defs>
          <linearGradient id="arc-title-orbit" x1="0" y1="0" x2="620" y2="0">
            <stop stopColor="#6ee7b7" stopOpacity="0" />
            <stop offset="0.5" stopColor="#67e8f9" />
            <stop offset="1" stopColor="#6ee7b7" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      <div
        aria-hidden="true"
        className="relative flex items-center font-display text-6xl font-semibold leading-[0.92] text-white sm:text-8xl lg:text-9xl"
      >
        <motion.span
          className="relative mr-[0.015em] inline-flex h-[0.8em] w-[0.8em] shrink-0 items-center justify-center text-white"
          initial={{ opacity: 0, scale: 0.2, rotate: -160 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ delay: 1.65, duration: 0.75, type: "spring", bounce: 0.48 }}
        >
          <motion.span
            className="absolute inset-[-12%] rounded-full border border-white/20"
            animate={
              reduceMotion
                ? undefined
                : { rotate: 360, scale: [0.9, 1.14, 0.9] }
            }
            transition={{
              rotate: { duration: 7, repeat: Infinity, ease: "linear" },
              scale: { duration: 2.4, repeat: Infinity, ease: "easeInOut" },
            }}
          />
          <motion.span
            className="relative z-10 flex h-full w-full items-center justify-center"
            animate={
              reduceMotion
                ? undefined
                : {
                    x: [0, 0, 0, -7, 5, 0],
                    scale: [1, 1, 1, 0.82, 1.18, 1],
                    rotate: [0, 0, 0, -5, 3, 0],
                    filter: [
                      "drop-shadow(0 0 8px rgba(103,232,249,.35))",
                      "drop-shadow(0 0 12px rgba(103,232,249,.45))",
                      "drop-shadow(0 0 16px rgba(103,232,249,.55))",
                      "drop-shadow(0 0 35px rgba(255,255,255,1))",
                      "drop-shadow(0 0 30px rgba(110,231,183,.95))",
                      "drop-shadow(0 0 8px rgba(103,232,249,.35))",
                    ],
                  }
            }
            transition={{
              duration: 5.4,
              delay: 0.2,
              repeat: Infinity,
              repeatDelay: 1.4,
              ease: "easeInOut",
              times: [0, 0.72, 0.88, 0.93, 0.97, 1],
            }}
          >
            <ArcLogo className="h-[84%] w-[84%]" />
          </motion.span>
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-20%] rounded-full border-2 border-white/80"
            animate={
              reduceMotion
                ? { opacity: 0 }
                : {
                    scale: [0.35, 0.35, 0.35, 0.5, 1.8, 2.5],
                    opacity: [0, 0, 0, 1, 0.35, 0],
                  }
            }
            transition={{
              duration: 5.4,
              delay: 0.2,
              repeat: Infinity,
              repeatDelay: 1.4,
              times: [0, 0.72, 0.88, 0.93, 0.97, 1],
            }}
          />
        </motion.span>

        {letters.map((letter, index) => (
          <motion.span
            key={`${letter}-${index}`}
            className="relative inline-block"
            initial={{ opacity: 0, y: 42, rotateX: -70, filter: "blur(10px)" }}
            animate={{
              opacity: 1,
              y: reduceMotion ? 0 : [0, -2, 0],
              rotateX: 0,
              filter: [
                "blur(0px) drop-shadow(0 0 0 rgba(103,232,249,0))",
                "blur(0px) drop-shadow(0 0 12px rgba(103,232,249,.28))",
                "blur(0px) drop-shadow(0 0 0 rgba(103,232,249,0))",
              ],
            }}
            transition={{
              opacity: { delay: 0.7 + index * 0.09, duration: 0.4 },
              rotateX: { delay: 0.7 + index * 0.09, duration: 0.6 },
              filter: {
                delay: 1.6 + index * 0.15,
                duration: 3.2,
                repeat: Infinity,
              },
              y: {
                delay: 1.7 + index * 0.12,
                duration: 2.7,
                repeat: Infinity,
                ease: "easeInOut",
              },
            }}
          >
            {letter}
          </motion.span>
        ))}

        <motion.span
          className="pointer-events-none absolute inset-y-0 left-0 w-20 skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/35 to-transparent blur-sm"
          initial={{ x: "-180%", opacity: 0 }}
          animate={
            reduceMotion
              ? { opacity: 0 }
              : { x: ["-180%", "760%"], opacity: [0, 0.8, 0] }
          }
          transition={{
            duration: 2.2,
            delay: 2.1,
            repeat: Infinity,
            repeatDelay: 2.8,
            ease: "easeInOut",
          }}
        />
      </div>

      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/85 text-white shadow-[0_0_28px_rgba(255,255,255,0.28)] backdrop-blur-md sm:h-14 sm:w-14"
        initial={{ left: "-12%", top: "65%", opacity: 0, scale: 0.5 }}
        animate={
          reduceMotion
            ? { opacity: 0 }
            : {
                left: ["-12%", "42%", "104%", "66%", "-12%", "-5%", "0%"],
                top: ["65%", "-38%", "38%", "118%", "12%", "38%", "50%"],
                opacity: [0, 1, 1, 1, 1, 1, 0],
                scale: [0.55, 0.8, 1.1, 0.75, 0.95, 1.15, 0.15],
                rotate: [-80, 30, 180, 280, 340, 355, 360],
              }
        }
        transition={{
          duration: 5.4,
          delay: 0.2,
          repeat: Infinity,
          repeatDelay: 1.4,
          ease: "easeInOut",
          times: [0, 0.2, 0.42, 0.62, 0.78, 0.9, 1],
        }}
        style={{ translateY: "-50%" }}
      >
        <ArcLogo className="h-7 w-7 sm:h-9 sm:w-9" />
      </motion.div>
    </div>
  );
}
