import React, { useEffect, useRef, useState } from 'react';
import {
  Award,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileDown,
  Loader2,
  MessageSquareQuote,
  Pause,
  Play,
  Sparkles,
  Square,
  Target,
  TrendingUp,
  Volume2,
  AlertTriangle,
} from 'lucide-react';
import type { EvaluationResult } from '../types/evaluation';
import { downloadEvaluationPdf } from '../utils/exportPdf';

interface StepThreeResultsProps {
  evaluation: EvaluationResult | null;
  isAnalyzing: boolean;
  analysisError: string | null;
}

function buildMarkdownReport(ev: EvaluationResult): string {
  const lines: string[] = [
    `# Toastmasters Speech Evaluation Report`,
    `**Speaker:** ${ev.timingReport.speakerName}`,
    `**Speech Title:** ${ev.timingReport.speechTitle}`,
    `**Pathway & Project:** ${ev.timingReport.pathwayProject}`,
    ``,
    `## Speech Summary & Timing Report`,
    `- **Actual Duration:** ${ev.timingReport.actualDurationFormatted} (${ev.timingReport.actualSeconds}s)`,
    `- **Target Duration:** ${ev.timingReport.targetRangeFormatted}`,
    `- **Qualification Status:** ${ev.timingReport.qualificationStatus.replace('_', ' ')} (±${ev.timingReport.gracePeriodSeconds}s Toastmasters grace window)`,
    `- **Timing Notes:** ${ev.timingReport.timingCommentary}`,
    ``,
    `## Toastmasters CRC Feedback`,
    `### Commendations (What Went Well)`,
    ...ev.crcFeedback.commendations.map(
      (c, i) => `${i + 1}. **${c.title}:** ${c.detail}\n   - *Evidence:* ${c.evidence}`
    ),
    ``,
    `### Recommendations (Actionable Growth)`,
    ...ev.crcFeedback.recommendations.map(
      (r, i) => `${i + 1}. **${r.title}:** ${r.detail}\n   - *Next Step:* ${r.actionableStep}`
    ),
    ``,
    `### Challenge`,
    `- **${ev.crcFeedback.challenge.title}:** ${ev.crcFeedback.challenge.detail}`,
    ``,
    `## Pathways Rubric Breakdown`,
    ...ev.rubricBreakdown.map(
      (item) =>
        `- **${item.category}** (${item.rating}/${item.maxRating} — ${item.ratingLabel}): ${item.question}\n  *Feedback:* ${item.evidenceAndFeedback}`
    ),
    ``,
    `## Delivery Metrics`,
    `- **Pacing:** ${ev.deliveryMetrics.pacingWpmEstimate} — ${ev.deliveryMetrics.pacingNotes}`,
    `- **Vocal Variety:** ${ev.deliveryMetrics.vocalVarietyNotes}`,
    `- **Filler Words (${ev.deliveryMetrics.fillerWords.totalCount} detected):** ${
      ev.deliveryMetrics.fillerWords.breakdown.length > 0
        ? ev.deliveryMetrics.fillerWords.breakdown.map((f) => `"${f.word}" (${f.count})`).join(', ')
        : 'None detected'
    } — ${ev.deliveryMetrics.fillerWords.notes}`,
    `- **Visual Presence & Body Language:** ${ev.deliveryMetrics.visualPresenceNotes}`,
    ``,
    `## Spoken Evaluation Script`,
    ev.spokenEvaluationScript,
  ];
  return lines.join('\n');
}

export const StepThreeResults: React.FC<StepThreeResultsProps> = ({
  evaluation,
  isAnalyzing,
  analysisError,
}) => {
  const [speechState, setSpeechState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [aiAudioLoading, setAiAudioLoading] = useState(false);
  const [aiAudioUrl, setAiAudioUrl] = useState<string | null>(null);
  const [aiAudioPlaying, setAiAudioPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const aiAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (aiAudioUrl) {
        URL.revokeObjectURL(aiAudioUrl);
      }
    };
  }, [aiAudioUrl]);

  // Reset TTS when new evaluation arrives
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeechState('idle');
    if (aiAudioRef.current) {
      aiAudioRef.current.pause();
      setAiAudioPlaying(false);
    }
    setAiAudioUrl(null);
  }, [evaluation]);

  function handleWebSpeechPlay() {
    if (!evaluation) return;
    if (!('speechSynthesis' in window)) {
      handlePlayGeminiTts();
      return;
    }

    if (speechState === 'paused') {
      window.speechSynthesis.resume();
      setSpeechState('playing');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(evaluation.spokenEvaluationScript);
    utterance.rate = speechRate;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('natural')) ||
      voices.find((v) => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => setSpeechState('idle');
    utterance.onerror = () => setSpeechState('idle');

    window.speechSynthesis.speak(utterance);
    setSpeechState('playing');
  }

  function handleWebSpeechPause() {
    if ('speechSynthesis' in window && speechState === 'playing') {
      window.speechSynthesis.pause();
      setSpeechState('paused');
    }
  }

  function handleWebSpeechStop() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeechState('idle');
  }

  async function handlePlayGeminiTts() {
    if (!evaluation) return;

    if (aiAudioUrl && aiAudioRef.current) {
      if (aiAudioPlaying) {
        aiAudioRef.current.pause();
        setAiAudioPlaying(false);
      } else {
        await aiAudioRef.current.play();
        setAiAudioPlaying(true);
      }
      return;
    }

    setAiAudioLoading(true);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: evaluation.spokenEvaluationScript }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate AI voice.');

      const byteChars = atob(data.audioBase64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: data.mimeType || 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setAiAudioUrl(url);

      const audio = new Audio(url);
      aiAudioRef.current = audio;
      audio.onended = () => setAiAudioPlaying(false);
      await audio.play();
      setAiAudioPlaying(true);
    } catch {
      // Fall back to Web Speech API if TTS endpoint fails
      handleWebSpeechPlay();
    } finally {
      setAiAudioLoading(false);
    }
  }

  async function handleCopyEvaluation() {
    if (!evaluation) return;
    const text = buildMarkdownReport(evaluation);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadReport() {
    if (!evaluation) return;
    const markdown = buildMarkdownReport(evaluation);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const safeName = (evaluation.timingReport.speakerName || 'speaker')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `toastmasters_evaluation_${safeName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleDownloadPdf() {
    if (!evaluation || pdfGenerating) return;
    setPdfGenerating(true);
    try {
      await downloadEvaluationPdf(evaluation);
    } finally {
      setPdfGenerating(false);
    }
  }

  return (
    <section id="step-results" className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-5">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#772432]">
            Step 03 · Evaluation Output
          </p>
          <h2 className="text-2xl font-semibold text-[#004165] mt-1">
            AI Speech Analysis &amp; Pathways Feedback
          </h2>
        </div>
      </div>

      {/* Loading State */}
      {isAnalyzing && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <Loader2 className="w-9 h-9 animate-spin text-[#004165] mx-auto" />
          <p className="text-lg font-semibold text-[#004165] mt-4">
            Analyzing speech against Pathway rubric...
          </p>
          <p className="text-sm text-slate-600 mt-1.5 max-w-md mx-auto">
            Reviewing audio pacing, filler words, visual framing, and every criterion from your
            uploaded evaluation form.
          </p>
        </div>
      )}

      {/* Error State */}
      {!isAnalyzing && analysisError && (
        <div className="bg-white border border-red-200 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-900">Speech Analysis Failed</p>
            <p className="text-sm text-red-700 mt-1">{analysisError}</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isAnalyzing && !analysisError && !evaluation && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <Award className="w-9 h-9 text-slate-300 mx-auto" />
          <p className="text-base font-semibold text-slate-800 mt-3">
            Evaluation Report Will Appear Here
          </p>
          <p className="text-sm text-slate-500 mt-1 max-w-lg mx-auto">
            Complete Step 01 and capture or load a speech in Step 02. When you click Stop
            Evaluation or Analyze Loaded Speech, your full Toastmasters CRC evaluation and rubric
            breakdown will generate here.
          </p>
        </div>
      )}

      {/* Populated Evaluation Report */}
      {!isAnalyzing && evaluation && (
        <div className="space-y-6">
          {/* Voice & Text Output Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#004165] mr-1">
                <Volume2 className="w-4 h-4" />
                Read Feedback Aloud:
              </span>

              {speechState !== 'playing' ? (
                <button
                  type="button"
                  onClick={handleWebSpeechPlay}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#004165] text-white rounded-lg hover:bg-[#002B45] transition-colors cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  {speechState === 'paused' ? 'Resume Voice' : 'Play Voice'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleWebSpeechPause}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#F2DF74] text-[#002B45] rounded-lg hover:bg-[#e7d155] transition-colors cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Pause
                </button>
              )}

              {speechState !== 'idle' && (
                <button
                  type="button"
                  onClick={handleWebSpeechStop}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  Stop
                </button>
              )}

              <select
                aria-label="Speech playback speed"
                value={speechRate}
                onChange={(e) => setSpeechRate(Number(e.target.value))}
                className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#004165]/25"
              >
                <option value={0.9}>0.9x Pace</option>
                <option value={1}>1.0x Normal</option>
                <option value={1.15}>1.15x Brisk</option>
              </select>

              <button
                type="button"
                disabled={aiAudioLoading}
                onClick={handlePlayGeminiTts}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-200 bg-slate-50 text-[#004165] rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {aiAudioLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {aiAudioPlaying ? 'Pause AI Voice' : 'Natural AI Voice'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleCopyEvaluation}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-200 bg-white text-slate-700 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Evaluation
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownloadReport}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-200 bg-white text-slate-700 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download Markdown
              </button>
              <button
                type="button"
                disabled={pdfGenerating}
                onClick={handleDownloadPdf}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#772432] text-white rounded-lg hover:bg-[#5C1A25] transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {pdfGenerating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileDown className="w-3.5 h-3.5" />
                )}
                {pdfGenerating ? 'Generating PDF...' : 'Download PDF'}
              </button>
            </div>
          </div>

          {/* 1. Speech Summary & Timing Report */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-100">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{evaluation.timingReport.speakerName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{evaluation.timingReport.pathwayProject}</span>
                </div>
                <h3 className="text-xl font-semibold text-[#004165] mt-1">
                  &ldquo;{evaluation.timingReport.speechTitle}&rdquo;
                </h3>
              </div>

              <div
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-semibold ${
                  evaluation.timingReport.qualificationStatus === 'QUALIFIED'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : evaluation.timingReport.qualificationStatus === 'UNDER_TIME'
                      ? 'bg-amber-50 text-amber-900 border-amber-200'
                      : 'bg-red-50 text-red-800 border-red-200'
                }`}
              >
                {evaluation.timingReport.qualificationStatus === 'QUALIFIED' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                ) : (
                  <Clock className="w-4 h-4" />
                )}
                <span>
                  {evaluation.timingReport.qualificationStatus === 'QUALIFIED'
                    ? 'QUALIFIED (WITHIN 30s GRACE)'
                    : evaluation.timingReport.qualificationStatus === 'UNDER_TIME'
                      ? 'UNDER MINIMUM TIME'
                      : 'OVERTIME (EXCEEDED 30s GRACE)'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-5">
              <div>
                <p className="text-xs text-slate-500">Actual Recorded Duration</p>
                <p className="text-2xl font-mono font-semibold tabular-nums text-[#004165] mt-1">
                  {evaluation.timingReport.actualDurationFormatted}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Target Project Window</p>
                <p className="text-2xl font-mono font-semibold tabular-nums text-slate-800 mt-1">
                  {evaluation.timingReport.targetRangeFormatted}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Timing Assessment</p>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                  {evaluation.timingReport.timingCommentary}
                </p>
              </div>
            </div>
          </div>

          {/* 2. Toastmasters CRC Feedback */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {/* Commendations */}
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                <h3 className="text-lg font-semibold text-[#004165]">Commendations</h3>
              </div>
              <div className="mt-4 space-y-4">
                {evaluation.crcFeedback.commendations.map((item, idx) => (
                  <div key={idx} className="pb-4 border-b border-slate-100 last:border-b-0 last:pb-0">
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="text-sm text-slate-700 mt-1 leading-relaxed">{item.detail}</p>
                    <p className="text-xs text-slate-500 mt-1.5 italic">
                      Evidence: {item.evidence}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Recommendations */}
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                <TrendingUp className="w-5 h-5 text-[#004165]" />
                <h3 className="text-lg font-semibold text-[#004165]">Recommendations</h3>
              </div>
              <div className="mt-4 space-y-4">
                {evaluation.crcFeedback.recommendations.map((item, idx) => (
                  <div key={idx} className="pb-4 border-b border-slate-100 last:border-b-0 last:pb-0">
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="text-sm text-slate-700 mt-1 leading-relaxed">{item.detail}</p>
                    <p className="text-xs font-medium text-[#772432] mt-1.5">
                      Action step: {item.actionableStep}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Challenge & Oral Script */}
            <div className="bg-[#004165] text-white rounded-xl p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 pb-3 border-b border-white/15">
                  <Target className="w-5 h-5 text-[#F2DF74]" />
                  <h3 className="text-lg font-semibold text-white">Your Next-Speech Challenge</h3>
                </div>
                <p className="text-base font-semibold text-[#F2DF74] mt-4">
                  {evaluation.crcFeedback.challenge.title}
                </p>
                <p className="text-sm text-slate-100 mt-2 leading-relaxed">
                  {evaluation.crcFeedback.challenge.detail}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-white/15">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F2DF74] mb-1.5">
                  <MessageSquareQuote className="w-4 h-4" />
                  <span>Spoken Evaluation Script</span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed max-h-44 overflow-y-auto pr-1">
                  {evaluation.spokenEvaluationScript}
                </p>
              </div>
            </div>
          </div>

          {/* 3. Delivery Metrics & Pathways Rubric Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Delivery Metrics (5 cols) */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="pb-3 border-b border-slate-100">
                <h3 className="text-lg font-semibold text-[#004165]">Delivery Metrics</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Vocal delivery, filler word audit, and visual screen presence
                </p>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-600">Speaking Pacing</span>
                  <span className="text-sm font-mono font-semibold tabular-nums text-[#004165]">
                    {evaluation.deliveryMetrics.pacingWpmEstimate}
                  </span>
                </div>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                  {evaluation.deliveryMetrics.pacingNotes}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <span className="text-xs font-semibold text-slate-600">Vocal Variety</span>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                  {evaluation.deliveryMetrics.vocalVarietyNotes}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-600">
                    Filler Words (&ldquo;um&rdquo;, &ldquo;ah&rdquo;, &ldquo;so&rdquo;)
                  </span>
                  <span className="text-sm font-mono font-semibold tabular-nums text-[#772432]">
                    {evaluation.deliveryMetrics.fillerWords.totalCount} total
                  </span>
                </div>
                {evaluation.deliveryMetrics.fillerWords.breakdown.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs font-mono tabular-nums text-slate-700">
                    {evaluation.deliveryMetrics.fillerWords.breakdown.map((fw, idx) => (
                      <span key={idx}>
                        &ldquo;{fw.word}&rdquo;: {fw.count}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-sm text-slate-700 mt-1.5 leading-relaxed">
                  {evaluation.deliveryMetrics.fillerWords.notes}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <span className="text-xs font-semibold text-slate-600">
                  Visual Presence &amp; Body Language
                </span>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                  {evaluation.deliveryMetrics.visualPresenceNotes}
                </p>
              </div>
            </div>

            {/* Rubric Breakdown (7 cols) */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-baseline justify-between gap-4 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-lg font-semibold text-[#004165]">
                    Pathways Rubric Breakdown
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Criterion-by-criterion assessment grounded in your uploaded evaluation form
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {evaluation.rubricBreakdown.length} items rated
                </span>
              </div>

              <div className="divide-y divide-slate-100 mt-2">
                {evaluation.rubricBreakdown.map((row, idx) => {
                  const pct = Math.min(100, Math.max(0, (row.rating / (row.maxRating || 5)) * 100));
                  return (
                    <div key={row.criterionId || idx} className="py-4 first:pt-3 last:pb-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono tabular-nums font-semibold text-[#004165]">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-slate-800">{row.category}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                          <span className="font-semibold text-[#772432]">{row.ratingLabel}</span>
                          <span className="text-slate-400">/</span>
                          <span className="font-semibold text-[#004165]">
                            {row.rating} of {row.maxRating || 5}
                          </span>
                        </div>
                      </div>

                      <p className="text-sm font-medium text-slate-900 mt-1">{row.question}</p>

                      {/* Rating Progress Bar */}
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden my-2">
                        <div
                          className="h-full bg-[#004165] rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <p className="text-sm text-slate-600 leading-relaxed">
                        {row.evidenceAndFeedback}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
