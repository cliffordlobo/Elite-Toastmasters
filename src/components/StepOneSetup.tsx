import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  ClipboardPaste,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  AlertCircle,
} from 'lucide-react';
import type { EvaluationRubric, RubricCriterion, SpeakerDetails } from '../types/evaluation';
import {
  DEMO_RUBRIC,
  DEMO_RUBRIC_TEXT,
  DEMO_SPEAKER_DETAILS,
  DEMO_SPEAKER_TEXT,
} from '../utils/demoData';
import { parseTargetDuration } from '../utils/timing';

interface StepOneSetupProps {
  speakerDetails: SpeakerDetails;
  onSpeakerChange: (next: SpeakerDetails) => void;
  rubric: EvaluationRubric;
  onRubricChange: (next: EvaluationRubric) => void;
  onLoadFullDemo: () => void;
}

export const StepOneSetup: React.FC<StepOneSetupProps> = ({
  speakerDetails,
  onSpeakerChange,
  rubric,
  onRubricChange,
}) => {
  const [speakerMode, setSpeakerMode] = useState<'upload' | 'paste'>('upload');
  const [speakerPaste, setSpeakerPaste] = useState('');
  const [speakerLoading, setSpeakerLoading] = useState(false);
  const [speakerError, setSpeakerError] = useState<string | null>(null);
  const [speakerExtractedName, setSpeakerExtractedName] = useState<string | null>(null);

  const [rubricMode, setRubricMode] = useState<'upload' | 'paste'>('upload');
  const [rubricPaste, setRubricPaste] = useState('');
  const [rubricLoading, setRubricLoading] = useState(false);
  const [rubricError, setRubricError] = useState<string | null>(null);
  const [rubricExtractedName, setRubricExtractedName] = useState<string | null>(null);

  const [newCriterionText, setNewCriterionText] = useState('');
  const [newCriterionCategory, setNewCriterionCategory] = useState('');

  const speakerFileRef = useRef<HTMLInputElement>(null);
  const rubricFileRef = useRef<HTMLInputElement>(null);

  async function extractSpeakerFromFile(file: File) {
    setSpeakerLoading(true);
    setSpeakerError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/extract-speaker', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extract speaker details.');
      const parsedDuration = parseTargetDuration(
        data.targetDuration || '',
        data.minMinutes || 5,
        data.maxMinutes || 7
      );
      onSpeakerChange({
        speakerName: data.speakerName || '',
        speechTitle: data.speechTitle || '',
        targetDuration: data.targetDuration || `${parsedDuration.minMinutes}–${parsedDuration.maxMinutes} minutes`,
        minMinutes: Number(data.minMinutes) || parsedDuration.minMinutes,
        maxMinutes: Number(data.maxMinutes) || parsedDuration.maxMinutes,
        pathwayProject: data.pathwayProject || '',
        speechPurpose: data.speechPurpose || '',
      });
      setSpeakerExtractedName(file.name);
    } catch (err) {
      setSpeakerError(err instanceof Error ? err.message : 'Unable to parse speaker document.');
    } finally {
      setSpeakerLoading(false);
    }
  }

  async function extractSpeakerFromText(textToParse: string) {
    if (!textToParse.trim()) {
      setSpeakerError('Please paste speaker details before extracting.');
      return;
    }
    setSpeakerLoading(true);
    setSpeakerError(null);
    try {
      const res = await fetch('/api/extract-speaker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToParse }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extract speaker details.');
      const parsedDuration = parseTargetDuration(
        data.targetDuration || '',
        data.minMinutes || 5,
        data.maxMinutes || 7
      );
      onSpeakerChange({
        speakerName: data.speakerName || '',
        speechTitle: data.speechTitle || '',
        targetDuration: data.targetDuration || `${parsedDuration.minMinutes}–${parsedDuration.maxMinutes} minutes`,
        minMinutes: Number(data.minMinutes) || parsedDuration.minMinutes,
        maxMinutes: Number(data.maxMinutes) || parsedDuration.maxMinutes,
        pathwayProject: data.pathwayProject || '',
        speechPurpose: data.speechPurpose || '',
      });
      setSpeakerExtractedName('Pasted brief');
    } catch (err) {
      setSpeakerError(err instanceof Error ? err.message : 'Unable to parse pasted text.');
    } finally {
      setSpeakerLoading(false);
    }
  }

  async function extractRubricFromFile(file: File) {
    setRubricLoading(true);
    setRubricError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/extract-rubric', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extract evaluation rubric.');
      onRubricChange({
        formTitle: data.formTitle || file.name,
        projectPurpose: data.projectPurpose || '',
        criteria: Array.isArray(data.criteria) ? data.criteria : [],
        generalWatchOuts: Array.isArray(data.generalWatchOuts) ? data.generalWatchOuts : [],
      });
      setRubricExtractedName(file.name);
    } catch (err) {
      setRubricError(err instanceof Error ? err.message : 'Unable to parse evaluation form.');
    } finally {
      setRubricLoading(false);
    }
  }

  async function extractRubricFromText(textToParse: string) {
    if (!textToParse.trim()) {
      setRubricError('Please paste evaluation criteria before extracting.');
      return;
    }
    setRubricLoading(true);
    setRubricError(null);
    try {
      const res = await fetch('/api/extract-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToParse }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extract evaluation rubric.');
      onRubricChange({
        formTitle: data.formTitle || 'Pathways Evaluation Rubric',
        projectPurpose: data.projectPurpose || '',
        criteria: Array.isArray(data.criteria) ? data.criteria : [],
        generalWatchOuts: Array.isArray(data.generalWatchOuts) ? data.generalWatchOuts : [],
      });
      setRubricExtractedName('Pasted rubric');
    } catch (err) {
      setRubricError(err instanceof Error ? err.message : 'Unable to parse pasted rubric.');
    } finally {
      setRubricLoading(false);
    }
  }

  function handleDurationTextChange(value: string) {
    const { minMinutes, maxMinutes } = parseTargetDuration(
      value,
      speakerDetails.minMinutes,
      speakerDetails.maxMinutes
    );
    onSpeakerChange({
      ...speakerDetails,
      targetDuration: value,
      minMinutes,
      maxMinutes,
    });
  }

  function handleAddCriterion() {
    if (!newCriterionText.trim()) return;
    const nextItem: RubricCriterion = {
      id: `crit-${Date.now()}`,
      category: newCriterionCategory.trim() || 'Custom Criterion',
      question: newCriterionText.trim(),
      maxRating: 5,
      watchOuts: 'Evaluator custom observation',
    };
    onRubricChange({
      ...rubric,
      criteria: [...rubric.criteria, nextItem],
    });
    setNewCriterionText('');
    setNewCriterionCategory('');
  }

  function handleRemoveCriterion(id: string) {
    onRubricChange({
      ...rubric,
      criteria: rubric.criteria.filter((c) => c.id !== id),
    });
  }

  return (
    <section id="step-setup" className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-5">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#772432]">
            Step 01 · Preparation
          </p>
          <h2 className="text-2xl font-semibold text-[#004165] mt-1">
            Speech &amp; Pathways Rubric Setup
          </h2>
        </div>
        <p className="text-sm text-slate-600 max-w-xl">
          Upload or paste your meeting brief and Pathways evaluation form. Fields are automatically
          extracted and remain editable before recording.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Card A — Speaker & Speech Details */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-semibold text-[#004165]">
                  Speaker &amp; Speech Details
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Card A · PDF, DOCX, TXT, image, or pasted introduction
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
                <button
                  type="button"
                  onClick={() => setSpeakerMode('upload')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    speakerMode === 'upload'
                      ? 'bg-white text-[#004165] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Upload File
                </button>
                <button
                  type="button"
                  onClick={() => setSpeakerMode('paste')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    speakerMode === 'paste'
                      ? 'bg-white text-[#004165] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Paste Text
                </button>
              </div>
            </div>

            {/* Upload or Paste Input Area */}
            <div className="mt-4">
              {speakerMode === 'upload' ? (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) extractSpeakerFromFile(file);
                  }}
                  className="border border-dashed border-slate-300 rounded-lg p-4 bg-slate-50/70 hover:border-[#004165]/50 transition-colors"
                >
                  <input
                    ref={speakerFileRef}
                    type="file"
                    accept=".pdf,.txt,.docx,.md,.png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) extractSpeakerFromFile(file);
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#004165]/10 text-[#004165] flex items-center justify-center shrink-0">
                        {speakerLoading ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Upload className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {speakerLoading
                            ? 'Extracting speaker details with AI...'
                            : speakerExtractedName
                              ? `Loaded: ${speakerExtractedName}`
                              : 'Drop agenda, intro sheet, or screenshot'}
                        </p>
                        <p className="text-xs text-slate-500">
                          Supports PDF, DOCX, TXT, PNG, JPG
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={speakerLoading}
                        onClick={() => speakerFileRef.current?.click()}
                        className="px-3.5 py-2 text-xs font-medium bg-[#004165] text-white rounded-lg hover:bg-[#002B45] transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
                      >
                        Choose File
                      </button>
                      <button
                        type="button"
                        disabled={speakerLoading}
                        onClick={() => {
                          setSpeakerPaste(DEMO_SPEAKER_TEXT);
                          onSpeakerChange(DEMO_SPEAKER_DETAILS);
                          setSpeakerExtractedName('Sample Speaker Brief');
                          setSpeakerError(null);
                        }}
                        className="px-3 py-2 text-xs font-medium text-[#004165] bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Sample Brief
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <textarea
                    rows={4}
                    value={speakerPaste}
                    onChange={(e) => setSpeakerPaste(e.target.value)}
                    placeholder="Paste speaker introduction, agenda snippet, speech title, target duration (e.g., 5–7 minutes), and Pathways project..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#004165]/25 focus:border-[#004165]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSpeakerPaste(DEMO_SPEAKER_TEXT)}
                      className="text-xs font-medium text-[#004165] hover:underline cursor-pointer"
                    >
                      Insert sample speaker text
                    </button>
                    <button
                      type="button"
                      disabled={speakerLoading}
                      onClick={() => extractSpeakerFromText(speakerPaste)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#004165] text-white rounded-lg hover:bg-[#002B45] transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {speakerLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      Extract Details
                    </button>
                  </div>
                </div>
              )}

              {speakerError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{speakerError}</span>
                </div>
              )}
            </div>

            {/* Editable Verified Fields */}
            <div className="mt-5 pt-5 border-t border-slate-100 space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Verified Speech Profile
                </span>
                {speakerDetails.speakerName && speakerDetails.speechTitle && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Ready for timing &amp; evaluation
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Speaker Name
                  </label>
                  <input
                    type="text"
                    value={speakerDetails.speakerName}
                    onChange={(e) =>
                      onSpeakerChange({ ...speakerDetails, speakerName: e.target.value })
                    }
                    placeholder="e.g., Maya Lin"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#004165]/25 focus:border-[#004165]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Speech Title
                  </label>
                  <input
                    type="text"
                    value={speakerDetails.speechTitle}
                    onChange={(e) =>
                      onSpeakerChange({ ...speakerDetails, speechTitle: e.target.value })
                    }
                    placeholder="e.g., Designing Decisions Under Pressure"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#004165]/25 focus:border-[#004165]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-6">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Target Duration Label
                  </label>
                  <input
                    type="text"
                    value={speakerDetails.targetDuration}
                    onChange={(e) => handleDurationTextChange(e.target.value)}
                    placeholder="e.g., 5–7 minutes"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#004165]/25 focus:border-[#004165]"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Min (min)
                  </label>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={speakerDetails.minMinutes}
                    onChange={(e) => {
                      const val = Math.max(0.5, Number(e.target.value) || 0.5);
                      onSpeakerChange({
                        ...speakerDetails,
                        minMinutes: val,
                        targetDuration: `${val}–${Math.max(val, speakerDetails.maxMinutes)} minutes`,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#004165]/25 focus:border-[#004165]"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Max (min)
                  </label>
                  <input
                    type="number"
                    min={speakerDetails.minMinutes}
                    step={0.5}
                    value={speakerDetails.maxMinutes}
                    onChange={(e) => {
                      const val = Math.max(
                        speakerDetails.minMinutes,
                        Number(e.target.value) || speakerDetails.minMinutes
                      );
                      onSpeakerChange({
                        ...speakerDetails,
                        maxMinutes: val,
                        targetDuration: `${speakerDetails.minMinutes}–${val} minutes`,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#004165]/25 focus:border-[#004165]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Pathway &amp; Project Details
                </label>
                <input
                  type="text"
                  value={speakerDetails.pathwayProject}
                  onChange={(e) =>
                    onSpeakerChange({ ...speakerDetails, pathwayProject: e.target.value })
                  }
                  placeholder="e.g., Presentation Mastery — Level 2: Understanding Your Leadership Style"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#004165]/25 focus:border-[#004165]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Card B — Evaluation Form / Rubric Upload */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-semibold text-[#004165]">
                  Pathways Evaluation Form / Rubric
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Card B · Upload form to extract grading criteria &amp; watch-outs
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
                <button
                  type="button"
                  onClick={() => setRubricMode('upload')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    rubricMode === 'upload'
                      ? 'bg-white text-[#004165] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Upload Form
                </button>
                <button
                  type="button"
                  onClick={() => setRubricMode('paste')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    rubricMode === 'paste'
                      ? 'bg-white text-[#004165] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Paste Rubric
                </button>
              </div>
            </div>

            <div className="mt-4">
              {rubricMode === 'upload' ? (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) extractRubricFromFile(file);
                  }}
                  className="border border-dashed border-slate-300 rounded-lg p-4 bg-slate-50/70 hover:border-[#772432]/50 transition-colors"
                >
                  <input
                    ref={rubricFileRef}
                    type="file"
                    accept=".pdf,.txt,.docx,.md,.png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) extractRubricFromFile(file);
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#772432]/10 text-[#772432] flex items-center justify-center shrink-0">
                        {rubricLoading ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <FileText className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {rubricLoading
                            ? 'Parsing Pathways rubric criteria...'
                            : rubricExtractedName
                              ? `Loaded: ${rubricExtractedName}`
                              : 'Drop Toastmasters Pathways Evaluation PDF'}
                        </p>
                        <p className="text-xs text-slate-500">
                          Supports PDF, DOCX, TXT, PNG, JPG
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={rubricLoading}
                        onClick={() => rubricFileRef.current?.click()}
                        className="px-3.5 py-2 text-xs font-medium bg-[#772432] text-white rounded-lg hover:bg-[#5C1A25] transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
                      >
                        Choose Form
                      </button>
                      <button
                        type="button"
                        disabled={rubricLoading}
                        onClick={() => {
                          setRubricPaste(DEMO_RUBRIC_TEXT);
                          onRubricChange(DEMO_RUBRIC);
                          setRubricExtractedName('Sample Pathways Rubric');
                          setRubricError(null);
                        }}
                        className="px-3 py-2 text-xs font-medium text-[#772432] bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Sample Rubric
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <textarea
                    rows={4}
                    value={rubricPaste}
                    onChange={(e) => setRubricPaste(e.target.value)}
                    placeholder="Paste the Toastmasters Pathways Evaluation Resource criteria, questions, or project watch-outs..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#772432]/25 focus:border-[#772432]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setRubricPaste(DEMO_RUBRIC_TEXT)}
                      className="text-xs font-medium text-[#772432] hover:underline cursor-pointer"
                    >
                      Insert sample rubric text
                    </button>
                    <button
                      type="button"
                      disabled={rubricLoading}
                      onClick={() => extractRubricFromText(rubricPaste)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#772432] text-white rounded-lg hover:bg-[#5C1A25] transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {rubricLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ClipboardPaste className="w-3.5 h-3.5" />
                      )}
                      Parse Criteria
                    </button>
                  </div>
                </div>
              )}

              {rubricError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{rubricError}</span>
                </div>
              )}
            </div>

            {/* Extracted Rubric Checklist */}
            <div className="mt-5 pt-5 border-t border-slate-100">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">
                    {rubric.formTitle || 'Active Evaluation Checklist'}
                  </p>
                  {rubric.projectPurpose && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                      {rubric.projectPurpose}
                    </p>
                  )}
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                  {rubric.criteria.length} criteria
                </span>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {rubric.criteria.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 py-2.5 border-b border-slate-100 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono tabular-nums text-[#004165] font-semibold">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-slate-700">{item.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">1–{item.maxRating} scale</span>
                      </div>
                      <p className="text-sm text-slate-800 mt-0.5">{item.question}</p>
                      {item.watchOuts && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          Watch-out: {item.watchOuts}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      title="Remove criterion"
                      onClick={() => handleRemoveCriterion(item.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-md transition-colors shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {rubric.criteria.length === 0 && (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    No rubric criteria loaded yet. Upload a Pathways PDF or add custom criteria below.
                  </p>
                )}
              </div>

              {/* Add custom criterion */}
              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newCriterionCategory}
                  onChange={(e) => setNewCriterionCategory(e.target.value)}
                  placeholder="Category (e.g. Eye Contact)"
                  className="sm:w-40 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#004165]/25"
                />
                <input
                  type="text"
                  value={newCriterionText}
                  onChange={(e) => setNewCriterionText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCriterion();
                    }
                  }}
                  placeholder="Add custom evaluation question..."
                  className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#004165]/25"
                />
                <button
                  type="button"
                  onClick={handleAddCriterion}
                  className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
