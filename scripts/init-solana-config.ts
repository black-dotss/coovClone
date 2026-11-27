import "dotenv/config";
import { confirmSignatureViaPolling, getOracleKeypair, getSolanaCluster, getSolanaConnection } from "../lib/solana/config";
import { initializeProgramConfig, fetchOnChainConfig } from "../lib/solana/oracle";

async function main() {
  const connection = getSolanaConnection();
  const oracle = getOracleKeypair();
  const cluster = getSolanaCluster();
  console.log("Cluster:", cluster);
  console.log("Oracle Public Key:", oracle.publicKey.toBase58());

  const existing = await fetchOnChainConfig();
  if (existing.initialized && existing.config) {
    console.log("ProgramConfig already initialized:", JSON.stringify(existing, null, 2));
    return;
  }

  let balance = await connection.getBalance(oracle.publicKey, "confirmed");
  console.log("Oracle Devnet Balance:", balance / 1_000_000_000, "SOL");

  if (balance < 10_000_000 && cluster === "devnet") {
    console.log("Oracle wallet has low SOL; attempting Devnet faucet airdrop (0.5 SOL)...");
    try {
      const sig = await connection.requestAirdrop(oracle.publicKey, 500_000_000);
      await confirmSignatureViaPolling(connection, sig, 30_000);
      balance = await connection.getBalance(oracle.publicKey, "confirmed");
      console.log("Updated Oracle Devnet Balance:", balance / 1_000_000_000, "SOL");
    } catch (err) {
      console.warn(
        "Devnet faucet airdrop failed (rate-limited or unavailable). Fund the Oracle public key above manually:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  console.log("Initializing COOV Solana ProgramConfig...");
  const result = await initializeProgramConfig();
  console.log("Result:", JSON.stringify(result, null, 2));

  const verification = await fetchOnChainConfig();
  console.log("Verified On-Chain Config:", JSON.stringify(verification, null, 2));
}

main().catch((err) => {
  console.error("Failed to initialize COOV ProgramConfig:", err);
  process.exit(1);
});
