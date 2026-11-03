import { randomBytes } from "node:crypto";

console.log(`API_KEY=${randomBytes(32).toString("base64url")}`);
