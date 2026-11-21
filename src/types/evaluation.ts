export interface SpeakerDetails {
  speakerName: string;
  speechTitle: string;
  targetDuration: string;
  minMinutes: number;
  maxMinutes: number;
  pathwayProject: string;
  speechPurpose?: string;
}

export interface RubricCriterion {
  id: string;
  category: string;
  question: string;
  maxRating: number;
  watchOuts: string;
}

export interface EvaluationRubric {
  formTitle: string;
  projectPurpose: string;
  criteria: RubricCriterion[];
  generalWatchOuts: string[];
}

export type TimingLampState = 'idle' | 'under' | 'green' | 'yellow' | 'red' | 'overtime';

export type QualificationStatus = 'QUALIFIED' | 'UNDER_TIME' | 'OVERTIME';

export interface TimingThresholds {
  minSeconds: number;
  midSeconds: number;
  maxSeconds: number;
  graceMinSeconds: number;
  graceMaxSeconds: number;
}

export interface EvaluationResult {
  timingReport: {
    speakerName: string;
    speechTitle: string;
    pathwayProject: string;
    actualDurationFormatted: string;
    actualSeconds: number;
    targetRangeFormatted: string;
    minSeconds: number;
    maxSeconds: number;
    gracePeriodSeconds: number;
    qualificationStatus: QualificationStatus;
    timingCommentary: string;
  };
  rubricBreakdown: Array<{
    criterionId: string;
    category: string;
    question: string;
    rating: number;
    maxRating: number;
    ratingLabel: string;
    evidenceAndFeedback: string;
  }>;
  crcFeedback: {
    commendations: Array<{
      title: string;
      detail: string;
      evidence: string;
    }>;
    recommendations: Array<{
      title: string;
      detail: string;
      actionableStep: string;
    }>;
    challenge: {
      title: string;
      detail: string;
    };
  };
  deliveryMetrics: {
    pacingWpmEstimate: string;
    pacingNotes: string;
    vocalVarietyNotes: string;
    fillerWords: {
      totalCount: number;
      breakdown: Array<{
        word: string;
        count: number;
      }>;
      notes: string;
    };
    visualPresenceNotes: string;
  };
  spokenEvaluationScript: string;
}

export interface CapturedKeyframe {
  timestampSeconds: number;
  mimeType: string;
  base64Data: string;
}
