import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config.js";
import { localDateString, localTimeString } from "../lib/time.js";
import type { DailyService } from "./service.js";

/**
 * Sends today's pair once per local day at DAILY_SEND_TIME. Retries failed
 * sends after DAILY_SEND_RETRY_SECONDS. Previous days are intentionally skipped.
 */
export class DailyScheduler {
	private timer: NodeJS.Timeout | null = null;
	private running = false;

	constructor(
		private readonly daily: DailyService,
		private readonly config: AppConfig,
		private readonly logger: FastifyBaseLogger,
	) {}

	start(): void {
		if (!this.config.telegram.enabled || this.timer) return;
		// Catch up on boot when today's send time has already passed.
		void this.tick();
		this.timer = setInterval(
			() => void this.tick(),
			this.config.telegram.checkIntervalSeconds * 1000,
		);
		this.timer.unref?.();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	async tick(now = new Date()): Promise<void> {
		if (this.running || !this.config.telegram.enabled) return;
		const date = localDateString(now, this.config.appTimezone);
		if (localTimeString(now, this.config.appTimezone) < this.config.telegram.sendTime) return;

		const batch = this.daily.get(date);
		if (batch?.sendState === "sent") return;
		if (batch && batch.attempts > 0 && batch.lastAttemptAt) {
			const elapsed = now.getTime() - new Date(batch.lastAttemptAt).getTime();
			if (elapsed < this.config.telegram.retrySeconds * 1000) return;
		}

		this.running = true;
		try {
			const result = await this.daily.send(date);
			if (result.batch) {
				this.logger.info(
					{ date, alreadySent: result.alreadySent, channel: "telegram" },
					"Daily quotes sent",
				);
			}
		} catch (error) {
			// The message is already sanitised by TelegramService; never log the token.
			this.logger.warn(
				{ date, message: error instanceof Error ? error.message : "Daily send failed" },
				"Daily send failed; will retry",
			);
		} finally {
			this.running = false;
		}
	}
}
