import { PaymentProvider, ReceivingAccount } from "./types";

export const SUPPORTED_RECEIVING_ACCOUNTS: Record<PaymentProvider, ReceivingAccount> = {
  telebirr: {
    provider: "telebirr",
    displayName: "Telebirr",
    accountName: "Esrael Ashenafi",
    accountNumber: "0992013392",
    instructions:
      "Send the exact amount via Telebirr to 0992013392 (Esrael Ashenafi). After transferring, paste your SMS confirmation into the field below and click Verify.",
  },
  cbe: {
    provider: "cbe",
    displayName: "Commercial Bank of Ethiopia (CBE)",
    accountName: "Esrael Ashenafi Bekele",
    accountNumber: "1000596935234",
    instructions:
      "Transfer the exact amount via CBE to account 1000596935234 (Esrael Ashenafi Bekele). After transferring, paste your confirmation SMS or receipt link into the field below and click Verify.",
  },
  awash: {
    provider: "awash",
    displayName: "Awash Bank",
    accountName: "Esrael Ashenafi",
    accountNumber: "0992013392",
    instructions:
      "Send the exact amount to 0992013392 or CBE account 1000596935234 (Esrael Ashenafi) and paste your SMS confirmation.",
  },
  boa: {
    provider: "boa",
    displayName: "Bank of Abyssinia",
    accountName: "Esrael Ashenafi Bekele",
    accountNumber: "1000596935234",
    instructions:
      "Send the exact amount to CBE account 1000596935234 or Telebirr 0992013392 (Esrael Ashenafi) and paste your SMS confirmation.",
  },
};

/**
 * Returns only the active receiving accounts (telebirr and CBE).
 */
export function getAllReceivingAccounts(): ReceivingAccount[] {
  return [
    SUPPORTED_RECEIVING_ACCOUNTS.telebirr,
    SUPPORTED_RECEIVING_ACCOUNTS.cbe,
  ];
}

export function getReceivingAccount(provider?: PaymentProvider): ReceivingAccount {
  if (provider === "cbe") {
    return SUPPORTED_RECEIVING_ACCOUNTS.cbe;
  }
  return SUPPORTED_RECEIVING_ACCOUNTS.telebirr;
}
