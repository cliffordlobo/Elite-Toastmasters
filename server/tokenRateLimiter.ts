import type { GenerateContentParameters, GenerateContentResponse, GoogleGenAI } from '@google/genai';

export interface TokenRateLimiterOptions {
  /** Maximum input tokens allowed in any rolling window (must stay < 2,000,000 TPM). */
  maxTokensPerMinute?: number;
  /** Rolling window duration in milliseconds. Defaults to 60,000 ms (60 seconds). */
  windowMs?: number;
  /** Maximum number of requests allowed to wait in the FIFO queue simultaneously. */
  maxQueueSize?: number;
  /** Maximum time a request may wait in the queue before failing with 429. */
  maxWaitMs?: number;
}

export interface TokenLease {
  id: number;
  estimatedTokens: number;
  waitedMs: number;
  /** Update the rolling ledger entry once exact usageMetadata.promptTokenCount is known. */
  reconcile: (actualInputTokens?: number) => void;
  /** Release reservation if the upstream API call was never dispatched. */
  release: () => void;
}

export interface RateLimiterStats {
  maxTokensPerMinute: number;
  windowMs: number;
  usedTokensInWindow: number;
  availableTokens: number;
  queuedRequests: number;
  activeLedgerEntries: number;
  retryAfterSeconds: number;
}

export class RateLimitQueueError extends Error {
  readonly statusCode: number;
  readonly retryAfterSeconds: number;

  constructor(message: string, statusCode: number, retryAfterSeconds = 5) {
    super(message);
    this.name = 'RateLimitQueueError';
    this.statusCode = statusCode;
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

interface LedgerEntry {
  id: number;
  timestamp: number;
  tokens: number;
}

interface QueuedWaiter {
  id: number;
  tokens: number;
  enqueuedAt: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (lease: TokenLease) => void;
  reject: (err: Error) => void;
}

const HARD_TPM_CEILING = 1_999_999; // Strictly below 2,000,000 TPM
const DEFAULT_MAX_INPUT_TPM = 1_950_000; // 50k safety headroom below 2,000,000 TPM
export const MAX_SINGLE_REQUEST_TOKENS = 980_000; // Safe margin under Gemini's 1,048,576 context limit
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_QUEUE_SIZE = 50;
const DEFAULT_MAX_WAIT_MS = 90_000;

/**
 * Rolling 60-second sliding-window token-bucket rate limiter with a FIFO queue.
 * Ensures the sum of input tokens across any 60-second rolling window stays strictly
 * below 2,000,000 TPM while smoothly queueing bursts instead of dropping traffic.
 */
export class RollingTpmRateLimiter {
  readonly maxTokensPerMinute: number;
  readonly windowMs: number;
  readonly maxQueueSize: number;
  readonly maxWaitMs: number;

  private ledger: LedgerEntry[] = [];
  private queue: QueuedWaiter[] = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;

  constructor(options: TokenRateLimiterOptions = {}) {
    const requestedMax = options.maxTokensPerMinute ?? DEFAULT_MAX_INPUT_TPM;
    this.maxTokensPerMinute = Math.max(
      1_000,
      Math.min(HARD_TPM_CEILING, Math.floor(requestedMax))
    );
    this.windowMs = Math.max(1_000, options.windowMs ?? DEFAULT_WINDOW_MS);
    this.maxQueueSize = Math.max(1, options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE);
    this.maxWaitMs = Math.max(1_000, options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
  }

  private pruneLedger(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.ledger.length > 0 && this.ledger[0].timestamp <= cutoff) {
      this.ledger.shift();
    }
  }

  private getUsedTokens(now: number): number {
    this.pruneLedger(now);
    let total = 0;
    for (const entry of this.ledger) {
      total += entry.tokens;
    }
    return total;
  }

  private computeWaitMsForTokens(neededTokens: number, now: number): number {
    this.pruneLedger(now);
    let used = 0;
    for (const entry of this.ledger) {
      used += entry.tokens;
    }
    if (used + neededTokens <= this.maxTokensPerMinute) {
      return 0;
    }

    let tokensToFree = used + neededTokens - this.maxTokensPerMinute;
    let freed = 0;
    for (const entry of this.ledger) {
      freed += entry.tokens;
      if (freed >= tokensToFree) {
        return Math.max(15, entry.timestamp + this.windowMs - now + 15);
      }
    }

    return this.windowMs;
  }

  private createLease(entry: LedgerEntry, waitedMs: number): TokenLease {
    let finalized = false;

    return {
      id: entry.id,
      estimatedTokens: entry.tokens,
      waitedMs,
      reconcile: (actualInputTokens?: number) => {
        if (finalized) return;
        finalized = true;
        if (
          typeof actualInputTokens === 'number' &&
          Number.isFinite(actualInputTokens) &&
          actualInputTokens >= 0
        ) {
          const previous = entry.tokens;
          entry.tokens = Math.round(actualInputTokens);
          if (entry.tokens < previous) {
            // Actual tokens were lower than estimated — wake queued requests immediately
            this.drainQueue();
          }
        }
      },
      release: () => {
        if (finalized) return;
        finalized = true;
        const idx = this.ledger.findIndex((e) => e.id === entry.id);
        if (idx !== -1) {
          this.ledger.splice(idx, 1);
          this.drainQueue();
        }
      },
    };
  }

  private scheduleNextDrain(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    if (this.queue.length === 0) return;

    const now = Date.now();
    const head = this.queue[0];
    const waitMs = this.computeWaitMsForTokens(head.tokens, now);

    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drainQueue();
    }, Math.max(15, waitMs));

    if (typeof this.drainTimer.unref === 'function') {
      this.drainTimer.unref();
    }
  }

  private drainQueue(): void {
    const now = Date.now();
    this.pruneLedger(now);

    while (this.queue.length > 0) {
      const head = this.queue[0];
      const used = this.getUsedTokens(now);

      if (used + head.tokens <= this.maxTokensPerMinute) {
        this.queue.shift();
        clearTimeout(head.timeoutHandle);
        if (head.signal && head.onAbort) {
          head.signal.removeEventListener('abort', head.onAbort);
        }

        const entry: LedgerEntry = {
          id: head.id,
          timestamp: now,
          tokens: head.tokens,
        };
        this.ledger.push(entry);
        head.resolve(this.createLease(entry, now - head.enqueuedAt));
      } else {
        break;
      }
    }

    this.scheduleNextDrain();
  }

  /**
   * Acquires input-token budget for an upcoming Gemini request.
   * Immediately admits if budget is available; otherwise waits in FIFO order
   * until the rolling 60-second window has capacity.
   */
  acquire(estimatedTokens: number, signal?: AbortSignal): Promise<TokenLease> {
    const tokens = Math.max(1, Math.ceil(estimatedTokens));

    if (tokens > this.maxTokensPerMinute) {
      return Promise.reject(
        new RateLimitQueueError(
          `Request estimated at ${tokens.toLocaleString()} input tokens exceeds the ${this.maxTokensPerMinute.toLocaleString()} TPM rolling window ceiling. Please shorten the recording or reduce attachments.`,
          413,
          60
        )
      );
    }

    if (signal?.aborted) {
      return Promise.reject(new RateLimitQueueError('Request was cancelled before processing.', 499, 1));
    }

    const now = Date.now();
    const used = this.getUsedTokens(now);

    // Admit immediately if no earlier requests are queued and budget is available
    if (this.queue.length === 0 && used + tokens <= this.maxTokensPerMinute) {
      const entry: LedgerEntry = {
        id: this.nextId++,
        timestamp: now,
        tokens,
      };
      this.ledger.push(entry);
      return Promise.resolve(this.createLease(entry, 0));
    }

    if (this.queue.length >= this.maxQueueSize) {
      const retryAfterSec = Math.ceil(this.computeWaitMsForTokens(tokens, now) / 1000);
      return Promise.reject(
        new RateLimitQueueError(
          'Evaluation server is currently at peak token capacity. Please retry shortly.',
          429,
          retryAfterSec
        )
      );
    }

    return new Promise<TokenLease>((resolve, reject) => {
      const id = this.nextId++;
      const waiter: QueuedWaiter = {
        id,
        tokens,
        enqueuedAt: now,
        signal,
        resolve,
        reject,
        timeoutHandle: setTimeout(() => {
          const idx = this.queue.findIndex((q) => q.id === id);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            if (waiter.signal && waiter.onAbort) {
              waiter.signal.removeEventListener('abort', waiter.onAbort);
            }
            const retrySec = Math.ceil(this.computeWaitMsForTokens(tokens, Date.now()) / 1000);
            this.scheduleNextDrain();
            reject(
              new RateLimitQueueError(
                'Timed out waiting for Gemini input token capacity (2,000,000 TPM limit). Please retry in a moment.',
                429,
                retrySec
              )
            );
          }
        }, this.maxWaitMs),
      };

      if (signal) {
        const onAbort = () => {
          const idx = this.queue.findIndex((q) => q.id === id);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            clearTimeout(waiter.timeoutHandle);
            this.scheduleNextDrain();
            reject(new RateLimitQueueError('Client disconnected while waiting in rate-limit queue.', 499, 1));
          }
        };
        waiter.onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.queue.push(waiter);
      this.scheduleNextDrain();
    });
  }

  getStats(): RateLimiterStats {
    const now = Date.now();
    const used = this.getUsedTokens(now);
    const available = Math.max(0, this.maxTokensPerMinute - used);
    const headTokens = this.queue.length > 0 ? this.queue[0].tokens : 1;
    const retryAfterMs = this.queue.length > 0 || available === 0
      ? this.computeWaitMsForTokens(headTokens, now)
      : 0;

    return {
      maxTokensPerMinute: this.maxTokensPerMinute,
      windowMs: this.windowMs,
      usedTokensInWindow: used,
      availableTokens: available,
      queuedRequests: this.queue.length,
      activeLedgerEntries: this.ledger.length,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }
}

function estimateBase64Bytes(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function estimatePartTokens(
  part: unknown,
  durationSecondsHint?: number
): number {
  if (!part || typeof part !== 'object') {
    if (typeof part === 'string') {
      return Math.ceil(part.length / 3.5);
    }
    return 0;
  }

  const p = part as {
    text?: unknown;
    inlineData?: { mimeType?: string; data?: string };
  };

  let tokens = 0;

  if (typeof p.text === 'string') {
    tokens += Math.ceil(p.text.length / 3.5);
  }

  if (p.inlineData && typeof p.inlineData.data === 'string') {
    const mime = (p.inlineData.mimeType || '').toLowerCase();
    const bytes = estimateBase64Bytes(p.inlineData.data);

    if (mime.startsWith('image/')) {
      // Conservative upper bound for Gemini image tokenization (258–1290 tokens)
      tokens += 1_290;
    } else if (mime.startsWith('video/')) {
      // Video frames + audio can consume 300–1,200+ tok/s depending on resolution
      const byDuration =
        durationSecondsHint && durationSecondsHint > 0
          ? Math.ceil(durationSecondsHint * 1_200)
          : 0;
      const bySize = Math.ceil(bytes / 80);
      tokens += Math.max(2_000, byDuration, bySize);
    } else if (mime.startsWith('audio/')) {
      // Gemini audio ≈ 32 tok/s; add modest buffer (38 tok/s)
      const byDuration =
        durationSecondsHint && durationSecondsHint > 0
          ? Math.ceil(durationSecondsHint * 38)
          : 0;
      const bySize = Math.ceil(bytes / 450);
      tokens += Math.max(256, byDuration || bySize);
    } else if (mime === 'application/pdf') {
      // Estimate PDF page count conservatively (~25 KB/page, ~512 tokens/page)
      const estPages = Math.max(1, Math.ceil(bytes / 25_000));
      tokens += estPages * 512;
    } else {
      tokens += Math.max(256, Math.ceil(bytes / 4));
    }
  }

  return tokens;
}

function hasHeavyBinaryPart(contents: GenerateContentParameters['contents']): boolean {
  const inspectPart = (part: unknown): boolean => {
    if (!part || typeof part !== 'object') return false;
    const inlineData = (part as { inlineData?: { mimeType?: string } }).inlineData;
    const mime = (inlineData?.mimeType || '').toLowerCase();
    return mime.startsWith('video/') || mime === 'application/pdf';
  };

  if (Array.isArray(contents)) {
    return contents.some((item) => {
      if (item && typeof item === 'object' && 'parts' in item && Array.isArray(item.parts)) {
        return item.parts.some(inspectPart);
      }
      return inspectPart(item);
    });
  }
  if (contents && typeof contents === 'object' && 'parts' in contents && Array.isArray(contents.parts)) {
    return contents.parts.some(inspectPart);
  }
  return inspectPart(contents);
}

/**
 * Conservatively estimates total input tokens for a Gemini `generateContent` request
 * across text, structured schemas, images, PDFs, audio, and video parts.
 */
export function estimateGeminiInputTokens(
  params: GenerateContentParameters,
  durationSecondsHint?: number
): number {
  let total = 256; // Base prompt framing overhead

  const contents = params.contents;
  if (typeof contents === 'string') {
    total += Math.ceil(contents.length / 3.5);
  } else if (Array.isArray(contents)) {
    for (const item of contents) {
      if (item && typeof item === 'object' && 'parts' in item && Array.isArray(item.parts)) {
        for (const part of item.parts) {
          total += estimatePartTokens(part, durationSecondsHint);
        }
      } else {
        total += estimatePartTokens(item, durationSecondsHint);
      }
    }
  } else if (contents && typeof contents === 'object') {
    if ('parts' in contents && Array.isArray(contents.parts)) {
      for (const part of contents.parts) {
        total += estimatePartTokens(part, durationSecondsHint);
      }
    } else {
      total += estimatePartTokens(contents, durationSecondsHint);
    }
  }

  // Include systemInstruction and responseSchema token overhead
  if (params.config) {
    if (params.config.systemInstruction) {
      const sysStr =
        typeof params.config.systemInstruction === 'string'
          ? params.config.systemInstruction
          : JSON.stringify(params.config.systemInstruction);
      total += Math.ceil(sysStr.length / 3.5);
    }
    if (params.config.responseSchema) {
      total += Math.ceil(JSON.stringify(params.config.responseSchema).length / 3.5);
    }
  }

  return total;
}

const configuredMaxTpm = process.env.GEMINI_MAX_INPUT_TPM
  ? Number(process.env.GEMINI_MAX_INPUT_TPM)
  : DEFAULT_MAX_INPUT_TPM;

export const geminiTpmLimiter = new RollingTpmRateLimiter({
  maxTokensPerMinute:
    Number.isFinite(configuredMaxTpm) && configuredMaxTpm > 0
      ? configuredMaxTpm
      : DEFAULT_MAX_INPUT_TPM,
  windowMs: DEFAULT_WINDOW_MS,
  maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
  maxWaitMs: DEFAULT_MAX_WAIT_MS,
});

/**
 * Executes `ai.models.generateContent` through the rolling 60-second TPM queue
 * and reconciles the ledger entry with exact `usageMetadata.promptTokenCount`.
 */
export async function generateContentRateLimited(
  ai: GoogleGenAI,
  params: GenerateContentParameters,
  options?: {
    durationSecondsHint?: number;
    signal?: AbortSignal;
    label?: string;
  }
): Promise<GenerateContentResponse> {
  let estimatedTokens = estimateGeminiInputTokens(params, options?.durationSecondsHint);

  // For large or binary-heavy payloads (video/PDF), verify exact token count via countTokens
  if (
    params.model !== 'gemini-3.8-flash-lite-tts' &&
    (estimatedTokens > 120_000 || hasHeavyBinaryPart(params.contents))
  ) {
    try {
      const counted = await ai.models.countTokens({
        model: params.model,
        contents: params.contents,
      });
      if (typeof counted.totalTokens === 'number' && Number.isFinite(counted.totalTokens)) {
        estimatedTokens = counted.totalTokens;
      }
    } catch (countErr) {
      const countMsg = countErr instanceof Error ? countErr.message : String(countErr);
      if (countMsg.includes('exceeds the maximum number of tokens')) {
        throw new RateLimitQueueError(
          'This file exceeds Gemini’s 1,048,576 input token context limit. Please upload a shorter recording or smaller document.',
          413,
          5
        );
      }
      // Otherwise keep heuristic estimate and proceed
    }
  }

  if (estimatedTokens > MAX_SINGLE_REQUEST_TOKENS) {
    throw new RateLimitQueueError(
      `This input (${estimatedTokens.toLocaleString()} tokens) exceeds Gemini’s 1,048,576 token context window. Please shorten the recording or upload a smaller document.`,
      413,
      5
    );
  }

  const lease = await geminiTpmLimiter.acquire(estimatedTokens, options?.signal);

  if (lease.waitedMs > 0) {
    console.info(
      `[TPM Limiter] Dispatched ${options?.label || 'gemini'} after ${lease.waitedMs}ms queue wait (est. ${estimatedTokens.toLocaleString()} input tokens)`
    );
  }

  try {
    const response = await ai.models.generateContent(params);
    const actualPromptTokens = response.usageMetadata?.promptTokenCount;
    lease.reconcile(actualPromptTokens);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Keep the reservation if upstream reported quota exhaustion; otherwise release if rejected pre-billing
    if (!message.includes('RESOURCE_EXHAUSTED') && !message.includes('429')) {
      lease.release();
    }
    throw err;
  }
}
