"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#070809", color: "#fff" }}>
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <section style={{ maxWidth: 520, textAlign: "center" }}>
            <h1>Lendora could not finish loading</h1>
            <p style={{ color: "rgba(255,255,255,.6)", lineHeight: 1.6 }}>
              No transaction was submitted. Retry the application.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 16,
                border: "1px solid rgba(110,231,183,.8)",
                borderRadius: 8,
                background: "#a7f3d0",
                color: "#07100c",
                padding: "10px 18px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Retry Lendora
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}

