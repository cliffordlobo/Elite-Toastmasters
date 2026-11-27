import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface KeyframeItem {
  timestampSeconds: number;
  mimeType: string;
  base64Data: string;
}

export interface PreparedSpeechMedia {
  audioBuffer: Buffer;
  audioMimeType: string;
  keyframes: KeyframeItem[];
  detectedDurationSeconds: number | null;
  wasTranscoded: boolean;
}

interface FfprobeOutput {
  streams?: Array<{
    codec_type?: string;
    duration?: string;
  }>;
  format?: {
    duration?: string;
  };
}

const MAX_INLINE_AUDIO_BYTES = 12 * 1024 * 1024; // Re-encode audio files larger than 12 MB
const MAX_KEYFRAMES = 8;
const FFMPEG_TIMEOUT_MS = 120_000;

function safeExtension(filename: string, mimeType: string): string {
  const rawExt = path.extname(filename || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (rawExt && rawExt.length <= 6) {
    return rawExt;
  }
  if (mimeType.includes('mp4')) return '.mp4';
  if (mimeType.includes('quicktime')) return '.mov';
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('wav')) return '.wav';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return '.mp3';
  if (mimeType.includes('ogg')) return '.ogg';
  return '.bin';
}

function chooseSpeechBitrateKbps(durationSeconds: number): string {
  // Keep speech audio crisp while staying comfortably under Gemini's inline payload cap
  if (durationSeconds > 50 * 60) return '24k';
  if (durationSeconds > 25 * 60) return '32k';
  return '48k';
}

async function probeMedia(inputPath: string): Promise<{
  hasVideo: boolean;
  hasAudio: boolean;
  durationSeconds: number | null;
}> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,duration',
      '-of',
      'json',
      inputPath,
    ],
    { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 }
  );

  const parsed = JSON.parse(stdout || '{}') as FfprobeOutput;
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const hasVideo = streams.some((s) => s.codec_type === 'video');
  const hasAudio = streams.some((s) => s.codec_type === 'audio');

  const rawDuration =
    Number(parsed.format?.duration) ||
    streams.map((s) => Number(s.duration)).find((d) => Number.isFinite(d) && d > 0) ||
    0;

  const durationSeconds =
    Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : null;

  return { hasVideo, hasAudio, durationSeconds };
}

async function extractSpeechMp3(
  inputPath: string,
  outputPath: string,
  durationSeconds: number
): Promise<Buffer> {
  const bitrate = chooseSpeechBitrateKbps(durationSeconds);
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      bitrate,
      '-f',
      'mp3',
      outputPath,
    ],
    { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
  );

  return fs.readFile(outputPath);
}

async function extractEvenKeyframes(
  inputPath: string,
  tmpDir: string,
  durationSeconds: number,
  maxFrames: number
): Promise<KeyframeItem[]> {
  const count = Math.max(1, Math.min(maxFrames, durationSeconds >= 20 ? maxFrames : Math.max(2, Math.ceil(durationSeconds / 5))));
  const timestamps: number[] = [];

  if (durationSeconds <= 3) {
    timestamps.push(0);
  } else {
    // Sample evenly from 8% to 92% of the speech so opening, body, and closing are all visible
    for (let i = 0; i < count; i++) {
      const ratio = count === 1 ? 0.5 : 0.08 + (0.84 * i) / (count - 1);
      timestamps.push(Math.max(0, Math.round(durationSeconds * ratio)));
    }
  }

  const uniqueTimestamps = Array.from(new Set(timestamps));
  const frames: KeyframeItem[] = [];

  for (let i = 0; i < uniqueTimestamps.length; i++) {
    const ts = uniqueTimestamps[i];
    const framePath = path.join(tmpDir, `frame_${i}.jpg`);
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-ss',
          String(ts),
          '-i',
          inputPath,
          '-frames:v',
          '1',
          '-vf',
          "scale='min(640,iw)':-2",
          '-q:v',
          '6',
          framePath,
        ],
        { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 }
      );
      const buf = await fs.readFile(framePath);
      if (buf.length > 0) {
        frames.push({
          timestampSeconds: ts,
          mimeType: 'image/jpeg',
          base64Data: buf.toString('base64'),
        });
      }
    } catch {
      // Skip individual frame extraction errors without failing the evaluation
    }
  }

  return frames;
}

/**
 * Prepares uploaded or recorded speech media for Gemini multimodal evaluation.
 *
 * Video files are converted into a compact speech-optimized audio track (~32 tokens/sec)
 * plus up to 8 evenly spaced JPEG keyframes (~258 tokens each), preventing video-frame
 * tokenization from exceeding Gemini's 1,048,576 input token context window.
 */
export async function prepareSpeechMediaForGemini(options: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  durationSecondsHint: number;
  existingKeyframes: KeyframeItem[];
}): Promise<PreparedSpeechMedia> {
  const { buffer, mimeType, filename, durationSecondsHint, existingKeyframes } = options;
  const sanitizedExisting = Array.isArray(existingKeyframes)
    ? existingKeyframes.filter((k) => Boolean(k?.base64Data)).slice(0, MAX_KEYFRAMES)
    : [];

  const isVideoMime = mimeType.startsWith('video/');
  const isAudioMime = mimeType.startsWith('audio/');
  const needsOptimization = isVideoMime || (isAudioMime && buffer.length > MAX_INLINE_AUDIO_BYTES);

  // Fast path for already-compact audio recordings (e.g. live audio/webm or small MP3/WAV)
  if (!needsOptimization && isAudioMime) {
    return {
      audioBuffer: buffer,
      audioMimeType: mimeType,
      keyframes: sanitizedExisting,
      detectedDurationSeconds: null,
      wasTranscoded: false,
    };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-speech-'));
  try {
    const ext = safeExtension(filename, mimeType);
    const inputPath = path.join(tmpDir, `input${ext}`);
    const outputMp3Path = path.join(tmpDir, 'speech.mp3');
    await fs.writeFile(inputPath, buffer);

    let probeResult: { hasVideo: boolean; hasAudio: boolean; durationSeconds: number | null };
    try {
      probeResult = await probeMedia(inputPath);
    } catch {
      // If ffprobe cannot inspect the container, attempt direct audio extraction for video
      probeResult = {
        hasVideo: isVideoMime,
        hasAudio: true,
        durationSeconds: durationSecondsHint > 0 ? durationSecondsHint : null,
      };
    }

    const effectiveDuration =
      probeResult.durationSeconds || (durationSecondsHint > 0 ? durationSecondsHint : 300);

    // If a .webm container was labeled video/webm by extension but actually contains audio only
    if (!probeResult.hasVideo && probeResult.hasAudio) {
      if (buffer.length <= MAX_INLINE_AUDIO_BYTES && mimeType === 'video/webm') {
        return {
          audioBuffer: buffer,
          audioMimeType: 'audio/webm',
          keyframes: sanitizedExisting,
          detectedDurationSeconds: probeResult.durationSeconds,
          wasTranscoded: false,
        };
      }
      const mp3Buffer = await extractSpeechMp3(inputPath, outputMp3Path, effectiveDuration);
      return {
        audioBuffer: mp3Buffer,
        audioMimeType: 'audio/mpeg',
        keyframes: sanitizedExisting,
        detectedDurationSeconds: probeResult.durationSeconds,
        wasTranscoded: true,
      };
    }

    if (probeResult.hasVideo && !probeResult.hasAudio) {
      throw new Error(
        'The recorded or uploaded video does not contain an audio track. Please share tab audio, enable your microphone, or upload a recording with spoken audio.'
      );
    }

    // Video with audio (or large audio file): extract compact speech MP3 + visual keyframes
    const mp3Buffer = await extractSpeechMp3(inputPath, outputMp3Path, effectiveDuration);

    let keyframes = sanitizedExisting;
    if (probeResult.hasVideo && keyframes.length < 3) {
      const extractedFrames = await extractEvenKeyframes(
        inputPath,
        tmpDir,
        effectiveDuration,
        MAX_KEYFRAMES
      );
      if (extractedFrames.length > 0) {
        keyframes = extractedFrames;
      }
    }

    return {
      audioBuffer: mp3Buffer,
      audioMimeType: 'audio/mpeg',
      keyframes,
      detectedDurationSeconds: probeResult.durationSeconds,
      wasTranscoded: true,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
