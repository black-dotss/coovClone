import { execSync } from "node:child_process";

const isVercel = Boolean(process.env.VERCEL);
const command = isVercel ? "npx next build" : "npx opennextjs-cloudflare build";

console.log(`[build] Target environment: ${isVercel ? "Vercel" : "Cloudflare / Standard"}`);
console.log(`[build] Executing: ${command}`);

execSync(command, { stdio: "inherit" });
