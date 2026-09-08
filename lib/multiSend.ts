import { getAddress, isAddress } from "viem";

export const MULTISEND_MAX_PER_TX = 200;
export const MULTISEND_MAX_RECIPIENTS = 1_000;

export type MultiSendRecipientInput = {
  recipient: string;
  usdcAmount?: string;
  eurcAmount?: string;
  recipientName?: string;
};

export type MultiSendRecipient = {
  recipient: string;
  usdcAmount: string;
  eurcAmount: string;
  recipientName?: string;
};

export type MultiSendParams = {
  recipients: MultiSendRecipient[];
  recipientCount: string;
  totalUsdc: string;
  totalEurc: string;
};

const AMOUNT_RE = /^(0|[1-9]\d*)(\.\d{1,6})?$/;

export function parseTokenAmount6(value: string | undefined): bigint | null {
  if (value === undefined) return 0n;
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed || trimmed === "0" || trimmed === "0.0" || trimmed === "0.00") {
    return 0n;
  }
  if (!AMOUNT_RE.test(trimmed) && !/^(?:\d+|\d*\.\d{1,6})$/.test(trimmed)) {
    return null;
  }
  try {
    const [whole = "0", frac = ""] = trimmed.split(".");
    if (!/^\d+$/.test(whole) || (frac && !/^\d{1,6}$/.test(frac))) {
      return null;
    }
    const parsed = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0").slice(0, 6));
    return parsed;
  } catch {
    return null;
  }
}

export function formatTokenAmount6(value: bigint): string {
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(6, "0")}`.replace(/0+$/, "");
}

function cell(record: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== "") {
      return record[key].trim();
    }
  }
  return "";
}

export function parseMultiSendCsvText(text: string): {
  rows?: MultiSendRecipientInput[];
  error?: string;
} {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return { error: "CSV needs a header row and at least one recipient." };
  }

  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const addrIdx = header.findIndex(
    (h) => h === "address" || h === "wallet" || h === "recipient",
  );
  const usdcIdx = header.findIndex(
    (h) => h === "usdc_amount" || h === "usdc" || h === "usdcamount",
  );
  const eurcIdx = header.findIndex(
    (h) => h === "eurc_amount" || h === "eurc" || h === "eurcamount",
  );
  if (addrIdx < 0) {
    return {
      error:
        'CSV must have an "address" column. Expected: address, usdc_amount, eurc_amount',
    };
  }
  if (usdcIdx < 0 && eurcIdx < 0) {
    return {
      error: 'CSV must have at least one amount column: "usdc_amount" or "eurc_amount".',
    };
  }

  const rows: MultiSendRecipientInput[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const address = (cols[addrIdx] ?? "").trim();
    const usdcAmount = usdcIdx >= 0 ? (cols[usdcIdx] ?? "").trim() : "0";
    const eurcAmount = eurcIdx >= 0 ? (cols[eurcIdx] ?? "").trim() : "0";
    if (!address && !usdcAmount && !eurcAmount) continue;
    rows.push({
      recipient: address,
      usdcAmount: usdcAmount || "0",
      eurcAmount: eurcAmount || "0",
    });
  }

  if (rows.length === 0) {
    return { error: "CSV file contains no data rows." };
  }
  if (rows.length > MULTISEND_MAX_RECIPIENTS) {
    return {
      error: `CSV has ${rows.length} rows. MultiSend supports at most ${MULTISEND_MAX_RECIPIENTS} recipients.`,
    };
  }
  return { rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

export function chunkRecipients<T>(items: T[], size = MULTISEND_MAX_PER_TX): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function isChecksumAddress(value: string) {
  return isAddress(value);
}

export function checksumOrRaw(value: string) {
  return isAddress(value) ? getAddress(value) : value.trim();
}

export function totalsFromRecipients(rows: MultiSendRecipient[]) {
  let usdc = 0n;
  let eurc = 0n;
  for (const row of rows) {
    usdc += parseTokenAmount6(row.usdcAmount) ?? 0n;
    eurc += parseTokenAmount6(row.eurcAmount) ?? 0n;
  }
  return {
    usdc,
    eurc,
    totalUsdc: formatTokenAmount6(usdc),
    totalEurc: formatTokenAmount6(eurc),
  };
}

export function csvTemplate() {
  return `address,usdc_amount,eurc_amount
0x0000000000000000000000000000000000000001,100.50,0
0x0000000000000000000000000000000000000002,0,25.00
`;
}

export { cell };
