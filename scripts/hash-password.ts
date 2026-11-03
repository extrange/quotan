import { createInterface } from "node:readline/promises";
import { hashPassword } from "../apps/api/src/auth/password.js";

async function readPassword(): Promise<string> {
	const fromEnv = process.env.AUTH_HASH_PASSWORD;
	if (fromEnv) return fromEnv;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const mutable = rl as unknown as { _writeToOutput?: (value: string) => void };
	mutable._writeToOutput = () => {};
	const answer = await rl.question("Password: ");
	rl.close();
	process.stdout.write("\n");
	return answer;
}

const password = await readPassword();
if (password.length < 8) {
	console.error("Use at least 8 characters.");
	process.exit(1);
}
console.log(`AUTH_PASSWORD_HASH=${hashPassword(password)}`);
