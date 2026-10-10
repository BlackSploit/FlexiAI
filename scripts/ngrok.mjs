// npm runs scripts through cmd.exe on Windows, which does not expand $VAR, so read the domain here.
import "dotenv/config";
import { spawn } from "node:child_process";

const domain = process.env.NGROK_DOMAIN;
if (!domain) {
  console.error("NGROK_DOMAIN is not set in .env (static ngrok domain, no scheme).");
  process.exit(1);
}

const child = spawn("ngrok", ["http", `--url=${domain}`, "3000"], { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
