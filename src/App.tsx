import { useState } from 'react';
import { Award } from 'lucide-react';
import { StepOneSetup } from './components/StepOneSetup';
import { StepTwoCapture } from './components/StepTwoCapture';
import { StepThreeResults } from './components/StepThreeResults';
import type {
  CapturedKeyframe,
  EvaluationResult,
  EvaluationRubric,
  SpeakerDetails,
} from './types/evaluation';
import { DEMO_RUBRIC, DEMO_SPEAKER_DETAILS } from './utils/demoData';

const INITIAL_SPEAKER: SpeakerDetails = {
  speakerName: '',
  speechTitle: '',
  targetDuration: '5–7 minutes',
  minMinutes: 5,
  maxMinutes: 7,
  pathwayProject: '',
  speechPurpose: '',
};

const INITIAL_RUBRIC: EvaluationRubric = {
  formTitle: 'Standard Pathways Speech Evaluation Checklist',
  projectPurpose:
    'Evaluate speech clarity, structure, vocal variety, audience engagement, and adherence to target time.',
  criteria: [
    {
      id: 'default-1',
      category: 'Clarity & Structure',
      question: 'Was the speech purpose clear with a strong opening, organized body, and memorable conclusion?',
      maxRating: 5,
      watchOuts: 'Look for smooth transitions and a decisive closing call to action.',
    },
    {
      id: 'default-2',
      category: 'Vocal Variety',
      question: 'Did the speaker modulate pace, pitch, volume, and purposeful pauses to enhance meaning?',
      maxRating: 5,
      watchOuts: 'Notice monotone stretches or rushed delivery near the conclusion.',
    },
    {
      id: 'default-3',
      category: 'Audience Engagement',
      question: 'Did the speaker maintain poise, eye contact/framing, and expressive body language?',
      maxRating: 5,
      watchOuts: 'Observe camera framing, posture, gestures, and distracting filler words.',
    },
  ],
  generalWatchOuts: [
    'Track filler words ("um", "ah", "so", "like") and habitual pauses.',
    'Confirm speaker finishes within the ±30 second Toastmasters grace period.',
  ],
};

export default function App() {
  const [speakerDetails, setSpeakerDetails] = useState<SpeakerDetails>(INITIAL_SPEAKER);
  const [rubric, setRubric] = useState<EvaluationRubric>(INITIAL_RUBRIC);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [demoTriggerCount, setDemoTriggerCount] = useState(0);
  const [logoError, setLogoError] = useState(false);

  function applyDemoMetadata() {
    setSpeakerDetails(DEMO_SPEAKER_DETAILS);
    setRubric(DEMO_RUBRIC);
    setEvaluation(null);
    setAnalysisError(null);
  }

  function handleHeaderDemoClick() {
    applyDemoMetadata();
    setDemoTriggerCount((c) => c + 1);
    const captureEl = document.getElementById('step-capture');
    if (captureEl) {
      captureEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function handleEvaluateSpeech(payload: {
    mediaBlob: Blob;
    filename: string;
    durationSeconds: number;
    keyframes: CapturedKeyframe[];
  }) {
    setIsAnalyzing(true);
    setAnalysisError(null);

    const resultsEl = document.getElementById('step-results');
    if (resultsEl) {
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    try {
      const formData = new FormData();
      formData.append('media', payload.mediaBlob, payload.filename);
      formData.append('actualDurationSeconds', String(payload.durationSeconds));
      formData.append('speakerDetails', JSON.stringify(speakerDetails));
      formData.append('rubric', JSON.stringify(rubric));
      if (payload.keyframes.length > 0) {
        formData.append('keyframes', JSON.stringify(payload.keyframes));
      }

      const res = await fetch('/api/evaluate-speech', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gemini speech analysis returned an error.');
      }

      setEvaluation(data as EvaluationResult);
    } catch (err) {
      setAnalysisError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while analyzing the speech.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F9FB] text-slate-900">
      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="inline-flex items-center gap-2.5 text-base font-display font-bold tracking-tight text-[#004165] whitespace-nowrap shrink-0"
          >
            {!logoError ? (
              <img
                src="/assets/aistudio/TM_logo_b9903d51.jpg"
                alt="Toastmasters International logo"
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
                className="h-9 w-auto object-contain shrink-0"
              />
            ) : (
              <span className="w-8 h-8 rounded-lg bg-[#004165] text-[#F2DF74] flex items-center justify-center shrink-0">
                <Award className="w-4 h-4" />
              </span>
            )}
            <span>Elite Toastmasters</span>
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#step-setup"
              className="hover:text-[#004165] transition-colors whitespace-nowrap shrink-0"
            >
              Setup &amp; Rubric
            </a>
            <a
              href="#step-capture"
              className="hover:text-[#004165] transition-colors whitespace-nowrap shrink-0"
            >
              Screen Capture
            </a>
            <a
              href="#step-results"
              className="hover:text-[#004165] transition-colors whitespace-nowrap shrink-0"
            >
              Evaluation Report
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleHeaderDemoClick}
              className="px-4 py-2 text-xs font-semibold bg-[#772432] text-white rounded-lg hover:bg-[#5C1A25] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Load Demo Session
            </button>
          </div>
        </div>
      </header>

      {/* Masthead Banner */}
      <div id="top" className="bg-[#004165] text-white border-b border-[#002B45]">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-white p-1.5 shadow-sm flex items-center justify-center shrink-0">
                {!logoError ? (
                  <img
                    src="/assets/aistudio/TM_logo_b9903d51.jpg"
                    alt="Toastmasters International emblem"
                    referrerPolicy="no-referrer"
                    onError={() => setLogoError(true)}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Award className="w-9 h-9 text-[#004165]" />
                )}
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-display font-bold tracking-tight text-white text-balance">
                  Elite Toastmasters Evaluation App
                </h1>
                <p className="text-base sm:text-lg text-[#F2DF74] font-medium mt-1">
                  AI-Powered Pathways Speech Evaluator
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm text-slate-200">
              <span>01. Upload Brief &amp; Rubric</span>
              <span aria-hidden="true" className="text-[#F2DF74]">·</span>
              <span>02. Capture Screen &amp; Timing</span>
              <span aria-hidden="true" className="text-[#F2DF74]">·</span>
              <span>03. CRC &amp; Voice Feedback</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-8 sm:py-10 space-y-12">
        <StepOneSetup
          speakerDetails={speakerDetails}
          onSpeakerChange={setSpeakerDetails}
          rubric={rubric}
          onRubricChange={setRubric}
          onLoadFullDemo={applyDemoMetadata}
        />

        <StepTwoCapture
          speakerDetails={speakerDetails}
          rubric={rubric}
          isAnalyzing={isAnalyzing}
          onEvaluateSpeech={handleEvaluateSpeech}
          onActivateDemoSession={applyDemoMetadata}
          demoTriggerCount={demoTriggerCount}
        />

        <StepThreeResults
          evaluation={evaluation}
          isAnalyzing={isAnalyzing}
          analysisError={analysisError}
        />
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>Elite Toastmasters Evaluation App · Pathways CRC &amp; Timing Workbench</span>
          <span>Standard 30-second Toastmasters qualification grace period applied</span>
        </div>
      </footer>
    </div>
  );
}
