import { Resend } from "resend";

// BEFORE EMAILS WILL DELIVER:
// 1. Go to resend.com -> Domains -> Add Domain
// 2. Add your domain (e.g. yourdomain.com)
// 3. Add the DNS records Resend gives you to your domain registrar
// 4. Wait for verification (usually under 5 minutes)
// 5. Replace 'noreply@yourdomain.com' in the from field with your verified address
//
// If you don't have a domain yet, Resend lets you send to your OWN email only
// using their shared domain (onboarding@resend.dev) while in development.
// Change the `from` field to: 'Lendora <onboarding@resend.dev>'
// This only works for sending to the email address you signed up to Resend with.

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendBetaAccessEmail({
  to,
  code,
  tier,
  walletAddress,
}: {
  to: string;
  code: string;
  tier: "EARLY_ACCESS" | "STANDARD";
  walletAddress: string;
}) {
  const tierLabel = tier === "EARLY_ACCESS" ? "Early Access" : "Standard";
  const features =
    tier === "EARLY_ACCESS"
      ? "Supply, Withdraw, Borrow, Swap, Bridge, and AI Agent"
      : "Supply and Withdraw";

  const { data, error } = await resend.emails.send({
    from: "Lendora <noreply@arclend.cv>",
    to,
    subject: `Your Lendora ${tierLabel} Code`,
    html: `
        <div style="background:#000;color:#fff;font-family:Inter,sans-serif;
                    max-width:480px;margin:0 auto;padding:40px;
                    border-radius:16px;border:1px solid rgba(255,255,255,0.1)">
          <h1 style="font-size:24px;font-weight:700;margin-bottom:8px">
            Lendora
          </h1>
          <p style="color:rgba(255,255,255,0.5);margin-bottom:32px;font-size:14px">
            The first lending protocol on Arc Network
          </p>
          <p style="margin-bottom:16px">You've been approved for ${tierLabel} access.</p>
          <div style="background:rgba(255,255,255,0.06);border:1px solid 
                      rgba(255,255,255,0.1);border-radius:12px;
                      padding:24px;text-align:center;margin-bottom:24px">
            <p style="color:rgba(255,255,255,0.5);font-size:12px;
                      margin-bottom:8px;letter-spacing:2px">
              YOUR ACCESS CODE
            </p>
            <p style="font-size:28px;font-weight:700;letter-spacing:4px;
                      font-family:monospace">
              ${code}
            </p>
          </div>
          <p style="color:rgba(255,255,255,0.7);font-size:14px;margin-bottom:8px">
            This code is unique to your wallet:
          </p>
          <p style="font-family:monospace;font-size:12px;
                    color:rgba(255,255,255,0.4);margin-bottom:24px">
            ${walletAddress}
          </p>
          <p style="font-size:14px;margin-bottom:24px">
            <strong>${tierLabel}</strong> gives you access to: ${features}.
          </p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}"
             style="display:inline-block;background:#fff;color:#000;
                    padding:12px 24px;border-radius:10px;
                    font-weight:600;text-decoration:none;font-size:14px">
            Open Lendora →
          </a>
          <p style="color:rgba(255,255,255,0.3);font-size:11px;margin-top:32px">
            This code cannot be transferred — it will only work when redeemed
            from the wallet address above.
          </p>
        </div>
      `,
  });

  if (error) throw new Error(`Email failed: ${error.message}`);
  return data;
}
