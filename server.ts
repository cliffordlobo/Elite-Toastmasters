import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const CUSTOM_DOMAIN = 'tm-speechevaluator.techmarketer.ca';
const ALLOWED_HOSTS = [CUSTOM_DOMAIN, '.run.app', 'localhost'];
const MODEL_TEXT_MULTIMODAL = 'gemini-4-hydrogen';
const MODEL_TTS = 'gemini-3.8-flash-lite-tts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please verify your API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeMimeType(rawMime: string, filename = ''): string {
  const clean = (rawMime || '').split(';')[0].trim().toLowerCase();
  const ext = path.extname(filename).toLowerCase();

  if (clean && clean !== 'application/octet-stream') {
    if (clean === 'audio/wave' || clean === 'audio/x-wav') return 'audio/wav';
    if (clean === 'audio/mp3') return 'audio/mpeg';
    return clean;
  }

  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.txt':
    case '.md':
      return 'text/plain';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.webm':
      return 'video/webm';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}

async function fileToGeminiParts(file: Express.Multer.File) {
  const mimeType = normalizeMimeType(file.mimetype, file.originalname);
  const ext = path.extname(file.originalname).toLowerCase();

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.docx'
  ) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    const extracted = result.value?.trim();
    if (!extracted) {
      throw new Error('Could not extract readable text from the uploaded .docx file.');
    }
    return [{ text: `Extracted document content (${file.originalname}):\n\n${extracted}` }];
  }

  if (mimeType.startsWith('text/') || ext === '.txt' || ext === '.md') {
    const textContent = file.buffer.toString('utf-8').trim();
    if (!textContent) {
      throw new Error('The uploaded text document appears to be empty.');
    }
    return [{ text: `Document content (${file.originalname}):\n\n${textContent}` }];
  }

  const supportedInline =
    mimeType === 'application/pdf' ||
    mimeType.startsWith('image/') ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/');

  if (!supportedInline) {
    throw new Error(
      `Unsupported file type (${mimeType || ext}). Please upload a PDF, DOCX, TXT, PNG, JPG, or media file.`
    );
  }

  return [
    {
      inlineData: {
        mimeType,
        data: file.buffer.toString('base64'),
      },
    },
  ];
}

function formatSecondsToMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function handleApiError(err: unknown, res: Response) {
  console.error('[API Error]', err);
  const message =
    err instanceof Error ? err.message : 'An unexpected server error occurred.';
  const status =
    message.includes('PERMISSION_DENIED') || message.includes('API_KEY_INVALID')
      ? 403
      : message.includes('RESOURCE_EXHAUSTED')
        ? 429
        : 500;
  res.status(status).json({ error: message });
}

let cachedDemoWavBase64: string | null = null;

async function startServer() {
  const app = express();
  app.set('trust proxy', true);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  // Accept traffic and API requests from the registered custom subdomain & app URL
  const allowedOrigins = new Set<string>([
    `https://${CUSTOM_DOMAIN}`,
    `http://${CUSTOM_DOMAIN}`,
    'http://localhost:3000',
  ]);
  if (process.env.APP_URL) {
    allowedOrigins.add(process.env.APP_URL.replace(/\/$/, ''));
  }

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      (allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.run\.app$/i.test(origin))
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, allowedHosts: ALLOWED_HOSTS });
  });

  // 1. Extract Speaker & Speech Details from Document or Pasted Text
  app.post(
    '/api/extract-speaker',
    upload.single('file'),
    async (req: Request, res: Response) => {
      try {
        const ai = getAiClient();
        const pastedText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

        if (!req.file && !pastedText) {
          res.status(400).json({ error: 'Please upload a file or paste speaker details.' });
          return;
        }

        const inputParts = req.file
          ? await fileToGeminiParts(req.file)
          : [{ text: `Speaker & speech text:\n\n${pastedText}` }];

        const promptText = `Extract the Toastmasters speaker and speech setup details from the provided document or text.
If any field is missing or implicit, infer the most reasonable Toastmasters value (for example, default targetDuration to "5–7 minutes" with minMinutes: 5, maxMinutes: 7 if no timing is mentioned, or parse exact ranges like "4–6 minutes" or "1–2 minutes").`;

        const response = await ai.models.generateContent({
          model: MODEL_TEXT_MULTIMODAL,
          contents: {
            parts: [...inputParts, { text: promptText }],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                speakerName: {
                  type: Type.STRING,
                  description: 'Full name of the speaker.',
                },
                speechTitle: {
                  type: Type.STRING,
                  description: 'Title of the speech.',
                },
                targetDuration: {
                  type: Type.STRING,
                  description: 'Human-readable target speech duration, e.g. "5–7 minutes".',
                },
                minMinutes: {
                  type: Type.NUMBER,
                  description: 'Minimum target speech duration in minutes (e.g. 5).',
                },
                maxMinutes: {
                  type: Type.NUMBER,
                  description: 'Maximum target speech duration in minutes (e.g. 7).',
                },
                pathwayProject: {
                  type: Type.STRING,
                  description: 'Toastmasters Pathway and project name.',
                },
                speechPurpose: {
                  type: Type.STRING,
                  description: 'Brief summary of the speech purpose or context.',
                },
              },
              required: [
                'speakerName',
                'speechTitle',
                'targetDuration',
                'minMinutes',
                'maxMinutes',
                'pathwayProject',
              ],
            },
          },
        });

        const parsed = JSON.parse((response.text ?? '{}').trim());
        res.json(parsed);
      } catch (err) {
        handleApiError(err, res);
      }
    }
  );

  // 2. Extract Pathways Evaluation Rubric Criteria from Document or Pasted Text
  app.post(
    '/api/extract-rubric',
    upload.single('file'),
    async (req: Request, res: Response) => {
      try {
        const ai = getAiClient();
        const pastedText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

        if (!req.file && !pastedText) {
          res.status(400).json({ error: 'Please upload an evaluation form or paste rubric text.' });
          return;
        }

        const inputParts = req.file
          ? await fileToGeminiParts(req.file)
          : [{ text: `Evaluation rubric text:\n\n${pastedText}` }];

        const promptText = `Analyze this Toastmasters Pathways Evaluation Form or rubric.
Extract the form title, project purpose, every specific evaluation criterion / rubric question / rating item found in the form, and general evaluator watch-outs.
Ensure each criterion has a unique id (like "crit-1", "crit-2", ...), a short category name, the full rubric question/prompt, maxRating (usually 5), and specific watchOuts for the evaluator.`;

        const response = await ai.models.generateContent({
          model: MODEL_TEXT_MULTIMODAL,
          contents: {
            parts: [...inputParts, { text: promptText }],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                formTitle: { type: Type.STRING },
                projectPurpose: { type: Type.STRING },
                criteria: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      category: { type: Type.STRING },
                      question: { type: Type.STRING },
                      maxRating: { type: Type.NUMBER },
                      watchOuts: { type: Type.STRING },
                    },
                    required: ['id', 'category', 'question', 'maxRating', 'watchOuts'],
                  },
                },
                generalWatchOuts: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['formTitle', 'projectPurpose', 'criteria', 'generalWatchOuts'],
            },
          },
        });

        const parsed = JSON.parse((response.text ?? '{}').trim());
        res.json(parsed);
      } catch (err) {
        handleApiError(err, res);
      }
    }
  );

  // 3. Generate a Real Demo Speech Audio Clip (cached in memory for Demo Sample Speech mode)
  app.post('/api/demo-speech-audio', async (_req: Request, res: Response) => {
    try {
      if (cachedDemoWavBase64) {
        res.json({ audioBase64: cachedDemoWavBase64, mimeType: 'audio/wav' });
        return;
      }

      const ai = getAiClient();
      const demoScript = `Good evening fellow Toastmasters and guests. Have you ever had sixty seconds to make a decision that could either save a project or sink an entire team?
Last October, um, our engineering launch hit a sudden server outage just two hours before our keynote demo. My natural instinct as a methodical planner was to pause, gather every log, and hold a thirty-minute post-mortem.
Instead, I looked around the room at my teammates' tense faces and realized they didn't need more spreadsheets. They needed clarity.
So I took a breath, asked two focused questions — what is broken right now, and who owns the rollback — and, uh, within ten minutes we restored the live environment.
That night taught me something crucial about my leadership style: planning builds the runway, but decisive calm in the storm is what keeps the plane in the air.
When pressure rises, don't wait for perfect information. Ask two clear questions, trust your team, and take the next right step. Thank you, Mister or Madam Toastmaster.`;

      const response = await ai.models.generateContent({
        model: MODEL_TTS,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: demoScript,
                speechMetadata: {
                  style: 'Warm, articulate Toastmasters speaker delivering a short keynote story with natural pacing and brief pauses',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        throw new Error('Gemini TTS did not return audio bytes for the demo speech.');
      }

      cachedDemoWavBase64 = base64Audio;
      res.json({ audioBase64: base64Audio, mimeType: 'audio/wav' });
    } catch (err) {
      handleApiError(err, res);
    }
  });

  // 4. Multimodal Speech Analysis & Toastmasters CRC Evaluation
  app.post(
    '/api/evaluate-speech',
    upload.single('media'),
    async (req: Request, res: Response) => {
      try {
        const ai = getAiClient();

        const speakerDetails = JSON.parse(req.body.speakerDetails || '{}');
        const rubric = JSON.parse(req.body.rubric || '{}');
        const actualSeconds = Math.max(1, Number(req.body.actualDurationSeconds || 0));
        const keyframes = req.body.keyframes
          ? (JSON.parse(req.body.keyframes) as Array<{
              timestampSeconds: number;
              mimeType: string;
              base64Data: string;
            }>)
          : [];

        if (!req.file) {
          res.status(400).json({
            error:
              'No recorded audio or video speech was received. Please record a screen/mic session, upload a recording, or run the Demo Sample Speech.',
          });
          return;
        }

        const minMinutes = Number(speakerDetails.minMinutes || 5);
        const maxMinutes = Number(speakerDetails.maxMinutes || 7);
        const minSeconds = Math.round(minMinutes * 60);
        const maxSeconds = Math.round(maxMinutes * 60);
        const graceMinSeconds = Math.max(0, minSeconds - 30);
        const graceMaxSeconds = maxSeconds + 30;

        let qualificationStatus: 'QUALIFIED' | 'UNDER_TIME' | 'OVERTIME' = 'QUALIFIED';
        if (actualSeconds < graceMinSeconds) {
          qualificationStatus = 'UNDER_TIME';
        } else if (actualSeconds > graceMaxSeconds) {
          qualificationStatus = 'OVERTIME';
        }

        const actualFormatted = formatSecondsToMMSS(actualSeconds);
        const targetFormatted =
          speakerDetails.targetDuration || `${minMinutes}–${maxMinutes} minutes`;

        const mediaMime = normalizeMimeType(req.file.mimetype, req.file.originalname);

        const parts: Array<Record<string, unknown>> = [
          {
            inlineData: {
              mimeType: mediaMime,
              data: req.file.buffer.toString('base64'),
            },
          },
        ];

        // Attach visual keyframes sampled from shared screen / video if provided
        const limitedKeyframes = Array.isArray(keyframes) ? keyframes.slice(0, 10) : [];
        for (const frame of limitedKeyframes) {
          if (frame?.base64Data) {
            parts.push({
              inlineData: {
                mimeType: frame.mimeType || 'image/jpeg',
                data: frame.base64Data,
              },
            });
          }
        }

        const evaluationPrompt = `You are an Elite Toastmasters Speech Evaluator — encouraging, specific, perceptive, and deeply grounded in Toastmasters Pathways standards.

Analyze the attached speech recording (audio/video${
          limitedKeyframes.length > 0
            ? ` plus ${limitedKeyframes.length} visual screen/camera frames captured during the delivery`
            : ''
        }) using the Speaker Details and Evaluation Rubric below.

### Speaker & Speech Context
- Speaker Name: ${speakerDetails.speakerName || 'Toastmasters Speaker'}
- Speech Title: ${speakerDetails.speechTitle || 'Untitled Speech'}
- Pathway & Project: ${speakerDetails.pathwayProject || 'Pathways Speech Project'}
- Target Duration: ${targetFormatted} (${minSeconds}s to ${maxSeconds}s; Toastmasters +/-30s grace window is ${formatSecondsToMMSS(graceMinSeconds)} to ${formatSecondsToMMSS(graceMaxSeconds)})
- Actual Recorded Duration: ${actualFormatted} (${actualSeconds} seconds)
- Official Timing Qualification: ${qualificationStatus}

### Evaluation Rubric Criteria
${JSON.stringify(rubric, null, 2)}

### Instructions
1. Listen carefully to the actual spoken content, vocal tone, pacing, pauses, and filler words ("um", "uh", "ah", "so", "like", "you know") in the recording. Quote specific phrases the speaker actually said as evidence!
2. If video or screen frames are present, evaluate visual presence, framing, slides/screen clarity, gestures, and eye contact. If audio-only, explicitly state in visualPresenceNotes that the capture was audio-only and give constructive posture/camera framing reminders for virtual delivery.
3. For rubricBreakdown, evaluate EVERY criterion provided in the Evaluation Rubric above using its exact criterionId, category, and question, with a rating from 1 to maxRating and grounded evidence.
4. For crcFeedback:
   - Commendations (3 concrete strengths with real examples/quotes from the speech)
   - Recommendations (2–3 specific, constructive, actionable improvements)
   - Challenge (1 inspiring, focused challenge to elevate their very next speech)
5. For spokenEvaluationScript, write a natural, warm, encouraging 120–180 word oral evaluation addressed directly to the speaker (starting with "Mister/Madam Toastmaster, fellow Toastmasters, and especially ${speakerDetails.speakerName || 'our speaker'}...") following the Toastmasters Commend-Recommend-Challenge arc so it sounds great when read aloud.
6. Ensure timingReport uses exact values: actualDurationFormatted="${actualFormatted}", actualSeconds=${actualSeconds}, targetRangeFormatted="${targetFormatted}", minSeconds=${minSeconds}, maxSeconds=${maxSeconds}, gracePeriodSeconds=30, qualificationStatus="${qualificationStatus}".`;

        parts.push({ text: evaluationPrompt });

        const response = await ai.models.generateContent({
          model: MODEL_TEXT_MULTIMODAL,
          contents: { parts },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                timingReport: {
                  type: Type.OBJECT,
                  properties: {
                    speakerName: { type: Type.STRING },
                    speechTitle: { type: Type.STRING },
                    pathwayProject: { type: Type.STRING },
                    actualDurationFormatted: { type: Type.STRING },
                    actualSeconds: { type: Type.NUMBER },
                    targetRangeFormatted: { type: Type.STRING },
                    minSeconds: { type: Type.NUMBER },
                    maxSeconds: { type: Type.NUMBER },
                    gracePeriodSeconds: { type: Type.NUMBER },
                    qualificationStatus: {
                      type: Type.STRING,
                      enum: ['QUALIFIED', 'UNDER_TIME', 'OVERTIME'],
                    },
                    timingCommentary: { type: Type.STRING },
                  },
                  required: [
                    'speakerName',
                    'speechTitle',
                    'pathwayProject',
                    'actualDurationFormatted',
                    'actualSeconds',
                    'targetRangeFormatted',
                    'minSeconds',
                    'maxSeconds',
                    'gracePeriodSeconds',
                    'qualificationStatus',
                    'timingCommentary',
                  ],
                },
                rubricBreakdown: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      criterionId: { type: Type.STRING },
                      category: { type: Type.STRING },
                      question: { type: Type.STRING },
                      rating: { type: Type.NUMBER },
                      maxRating: { type: Type.NUMBER },
                      ratingLabel: { type: Type.STRING },
                      evidenceAndFeedback: { type: Type.STRING },
                    },
                    required: [
                      'criterionId',
                      'category',
                      'question',
                      'rating',
                      'maxRating',
                      'ratingLabel',
                      'evidenceAndFeedback',
                    ],
                  },
                },
                crcFeedback: {
                  type: Type.OBJECT,
                  properties: {
                    commendations: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          title: { type: Type.STRING },
                          detail: { type: Type.STRING },
                          evidence: { type: Type.STRING },
                        },
                        required: ['title', 'detail', 'evidence'],
                      },
                    },
                    recommendations: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          title: { type: Type.STRING },
                          detail: { type: Type.STRING },
                          actionableStep: { type: Type.STRING },
                        },
                        required: ['title', 'detail', 'actionableStep'],
                      },
                    },
                    challenge: {
                      type: Type.OBJECT,
                      properties: {
                        title: { type: Type.STRING },
                        detail: { type: Type.STRING },
                      },
                      required: ['title', 'detail'],
                    },
                  },
                  required: ['commendations', 'recommendations', 'challenge'],
                },
                deliveryMetrics: {
                  type: Type.OBJECT,
                  properties: {
                    pacingWpmEstimate: { type: Type.STRING },
                    pacingNotes: { type: Type.STRING },
                    vocalVarietyNotes: { type: Type.STRING },
                    fillerWords: {
                      type: Type.OBJECT,
                      properties: {
                        totalCount: { type: Type.NUMBER },
                        breakdown: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              word: { type: Type.STRING },
                              count: { type: Type.NUMBER },
                            },
                            required: ['word', 'count'],
                          },
                        },
                        notes: { type: Type.STRING },
                      },
                      required: ['totalCount', 'breakdown', 'notes'],
                    },
                    visualPresenceNotes: { type: Type.STRING },
                  },
                  required: [
                    'pacingWpmEstimate',
                    'pacingNotes',
                    'vocalVarietyNotes',
                    'fillerWords',
                    'visualPresenceNotes',
                  ],
                },
                spokenEvaluationScript: { type: Type.STRING },
              },
              required: [
                'timingReport',
                'rubricBreakdown',
                'crcFeedback',
                'deliveryMetrics',
                'spokenEvaluationScript',
              ],
            },
          },
        });

        const parsed = JSON.parse((response.text ?? '{}').trim());
        // Enforce deterministic server-verified timing values
        if (parsed.timingReport) {
          parsed.timingReport.actualDurationFormatted = actualFormatted;
          parsed.timingReport.actualSeconds = actualSeconds;
          parsed.timingReport.minSeconds = minSeconds;
          parsed.timingReport.maxSeconds = maxSeconds;
          parsed.timingReport.gracePeriodSeconds = 30;
          parsed.timingReport.qualificationStatus = qualificationStatus;
        }
        res.json(parsed);
      } catch (err) {
        handleApiError(err, res);
      }
    }
  );

  // 5. Optional Gemini TTS endpoint for high-quality spoken evaluation playback
  app.post('/api/tts', async (req: Request, res: Response) => {
    try {
      const ai = getAiClient();
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text) {
        res.status(400).json({ error: 'Text is required for speech synthesis.' });
        return;
      }

      const response = await ai.models.generateContent({
        model: MODEL_TTS,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text,
                speechMetadata: {
                  style: 'Warm, encouraging, articulate Toastmasters speech evaluator',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Charon' },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error('Failed to generate spoken evaluation audio.');
      }

      res.json({ audioBase64: base64Audio, mimeType: 'audio/wav' });
    } catch (err) {
      handleApiError(err, res);
    }
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: ALLOWED_HOSTS,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('/{*path}', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Elite Toastmasters Evaluation App running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
