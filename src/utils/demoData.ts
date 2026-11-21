import type { EvaluationRubric, SpeakerDetails } from '../types/evaluation';

export const DEMO_SPEAKER_TEXT = `Toastmasters Club #4821 — Weekly Meeting Agenda & Speaker Introduction
Speaker Name: Maya Lin
Speech Title: Designing Decisions Under Pressure
Target Duration: 1–2 minutes (Demo Express Evaluation)
Pathway & Project: Presentation Mastery — Level 2: Understanding Your Leadership Style
Purpose: To share a concrete personal leadership story demonstrating adaptive decision-making and inspiring the audience with one clear takeaway.`;

export const DEMO_SPEAKER_DETAILS: SpeakerDetails = {
  speakerName: 'Maya Lin',
  speechTitle: 'Designing Decisions Under Pressure',
  targetDuration: '1–2 minutes',
  minMinutes: 1,
  maxMinutes: 2,
  pathwayProject: 'Presentation Mastery — Level 2: Understanding Your Leadership Style',
  speechPurpose:
    'Share a concise personal leadership story demonstrating adaptive decision-making with clear vocal variety and a memorable takeaway.',
};

export const DEMO_RUBRIC_TEXT = `Toastmasters Pathways Evaluation Resource — Understanding Your Leadership Style
Project Purpose: Identify your primary leadership style and examine how it impacts team decisions under real-world pressure.

Evaluation Criteria (Rate 1 = Developing to 5 = Exemplary):
1. Clarity & Structure: Did the speech open with an engaging hook, develop a clear central story, and end with a decisive conclusion?
2. Vocal Variety & Pacing: Did the speaker vary tone, volume, and pauses to emphasize key emotional turning points?
3. Leadership Insight & Relevance: Did the speaker connect their personal experience to an actionable leadership principle for the audience?
4. Audience Connection & Presence: Did the speaker maintain poise, conversational warmth, and minimize filler words ("um", "ah", "so")?
5. Time Management: Did the speaker deliver their message cleanly within the allotted target duration?

Evaluator Watch-Outs:
- Watch for rushed transitions between the problem setup and the lesson learned.
- Note any habitual filler words during reflective pauses.`;

export const DEMO_RUBRIC: EvaluationRubric = {
  formTitle: 'Pathways Evaluation Resource — Understanding Your Leadership Style',
  projectPurpose:
    'Identify primary leadership strengths in action and demonstrate clear, engaging delivery within the target timing window.',
  criteria: [
    {
      id: 'crit-1',
      category: 'Structure & Clarity',
      question: 'Did the speech open with an engaging hook, develop a clear central story, and end with a decisive conclusion?',
      maxRating: 5,
      watchOuts: 'Check that the transition from anecdote to core takeaway feels earned and distinct.',
    },
    {
      id: 'crit-2',
      category: 'Vocal Variety & Pacing',
      question: 'Did the speaker vary tone, volume, and purposeful pauses to emphasize key turning points?',
      maxRating: 5,
      watchOuts: 'Listen for flat cadence or rushing through the climax of the story.',
    },
    {
      id: 'crit-3',
      category: 'Leadership Insight',
      question: 'Did the speaker connect their personal leadership style to an actionable principle for the audience?',
      maxRating: 5,
      watchOuts: 'Ensure the leadership lesson is concrete rather than abstract.',
    },
    {
      id: 'crit-4',
      category: 'Presence & Fluency',
      question: 'Did the speaker maintain poise, warmth, and minimize distracting filler words ("um", "ah", "so")?',
      maxRating: 5,
      watchOuts: 'Track filler words during transitions and note posture/framing if video is present.',
    },
  ],
  generalWatchOuts: [
    'Watch for rushed transitions between the problem setup and the lesson learned.',
    'Note habitual filler words ("um", "uh", "so") during reflective pauses.',
  ],
};
