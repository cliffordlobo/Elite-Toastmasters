import { jsPDF } from 'jspdf';
import type { EvaluationResult } from '../types/evaluation';

const NAVY: [number, number, number] = [0, 65, 101]; // #004165
const NAVY_DARK: [number, number, number] = [0, 43, 69]; // #002B45
const MAROON: [number, number, number] = [119, 36, 50]; // #772432
const GOLD: [number, number, number] = [242, 223, 116]; // #F2DF74
const SLATE_900: [number, number, number] = [15, 23, 42];
const SLATE_700: [number, number, number] = [51, 65, 85];
const SLATE_500: [number, number, number] = [100, 116, 139];
const SLATE_200: [number, number, number] = [226, 232, 240];
const SLATE_50: [number, number, number] = [248, 250, 252];
const EMERALD: [number, number, number] = [5, 150, 105];
const AMBER: [number, number, number] = [180, 83, 9];
const RED: [number, number, number] = [185, 28, 28];

/**
 * Normalizes punctuation outside standard WinAnsi/Latin-1 so jsPDF's built-in
 * Helvetica font renders cleanly without garbled glyphs.
 */
function sanitizePdfText(input: string | undefined | null): string {
  if (!input) return '';
  return String(input)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '-')
    .replace(/\u00A0/g, ' ')
    .trim();
}

async function loadLogoDataUrl(url: string): Promise<{ dataUrl: string; aspect: number } | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load logo'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 200;
    canvas.height = img.naturalHeight || 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.92),
      aspect: canvas.width / canvas.height,
    };
  } catch {
    return null;
  }
}

export async function downloadEvaluationPdf(evaluation: EvaluationResult): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 18;
  let y = 0;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > bottomLimit) {
      doc.addPage();
      y = 18;
    }
  };

  const drawSectionHeading = (kicker: string, title: string) => {
    ensureSpace(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...MAROON);
    doc.text(sanitizePdfText(kicker).toUpperCase(), margin, y);
    y += 4.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...NAVY);
    doc.text(sanitizePdfText(title), margin, y);
    y += 2.2;

    doc.setDrawColor(...SLATE_200);
    doc.setLineWidth(0.35);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5.5;
  };

  const drawWrappedText = (
    text: string,
    x: number,
    maxWidth: number,
    options?: {
      fontSize?: number;
      fontStyle?: 'normal' | 'bold' | 'italic' | 'bolditalic';
      color?: [number, number, number];
      lineHeight?: number;
    }
  ) => {
    const fontSize = options?.fontSize ?? 9.5;
    const fontStyle = options?.fontStyle ?? 'normal';
    const color = options?.color ?? SLATE_700;
    const lineHeight = options?.lineHeight ?? fontSize * 0.45;

    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);

    const lines = doc.splitTextToSize(sanitizePdfText(text), maxWidth) as string[];
    for (const line of lines) {
      ensureSpace(lineHeight + 1);
      doc.text(line, x, y);
      y += lineHeight;
    }
  };

  // --- Header Banner ---
  const headerHeight = 32;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, headerHeight, 'F');
  // Gold bottom stripe
  doc.setFillColor(...GOLD);
  doc.rect(0, headerHeight, pageWidth, 1.5, 'F');

  const logo = await loadLogoDataUrl('/assets/aistudio/TM_logo_b9903d51.jpg');
  let headerTextX = margin;

  if (logo) {
    const boxSize = 18;
    const boxY = 7;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, boxY, boxSize, boxSize, 2, 2, 'F');

    const pad = 1.5;
    const innerSize = boxSize - pad * 2;
    let drawW = innerSize;
    let drawH = innerSize;
    if (logo.aspect > 1) {
      drawH = innerSize / logo.aspect;
    } else {
      drawW = innerSize * logo.aspect;
    }
    const imgX = margin + pad + (innerSize - drawW) / 2;
    const imgY = boxY + pad + (innerSize - drawH) / 2;
    doc.addImage(logo.dataUrl, 'JPEG', imgX, imgY, drawW, drawH);
    headerTextX = margin + boxSize + 5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text('Elite Toastmasters Evaluation Report', headerTextX, 15.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...GOLD);
  doc.text('AI-Powered Pathways Speech Evaluation', headerTextX, 21.5);

  const reportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.setFontSize(8.5);
  doc.setTextColor(226, 232, 240);
  doc.text(`Generated ${reportDate}`, pageWidth - margin, 15.5, { align: 'right' });

  y = headerHeight + 9;

  // --- Speech Metadata & Timing Card ---
  const { timingReport } = evaluation;
  const statusLabel =
    timingReport.qualificationStatus === 'QUALIFIED'
      ? 'QUALIFIED (WITHIN 30s GRACE)'
      : timingReport.qualificationStatus === 'UNDER_TIME'
        ? 'UNDER MINIMUM TIME'
        : 'OVERTIME (EXCEEDED 30s GRACE)';
  const statusColor: [number, number, number] =
    timingReport.qualificationStatus === 'QUALIFIED'
      ? EMERALD
      : timingReport.qualificationStatus === 'UNDER_TIME'
        ? AMBER
        : RED;

  const speechTitleLines = doc.splitTextToSize(
    `"${sanitizePdfText(timingReport.speechTitle || 'Untitled Speech')}"`,
    contentWidth - 10
  ) as string[];
  const timingNotesLines = doc.splitTextToSize(
    sanitizePdfText(timingReport.timingCommentary),
    contentWidth - 10
  ) as string[];

  const summaryCardHeight =
    26 + speechTitleLines.length * 5.2 + timingNotesLines.length * 4.2 + 12;

  ensureSpace(summaryCardHeight + 4);
  doc.setFillColor(...SLATE_50);
  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentWidth, summaryCardHeight, 2.5, 2.5, 'FD');

  let cardY = y + 6.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_500);
  doc.text(
    sanitizePdfText(`${timingReport.speakerName || 'Speaker'}  |  ${timingReport.pathwayProject || 'Pathways Project'}`),
    margin + 5,
    cardY
  );
  cardY += 5.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...NAVY);
  for (const line of speechTitleLines) {
    doc.text(line, margin + 5, cardY);
    cardY += 5.2;
  }

  cardY += 1.5;
  doc.setDrawColor(...SLATE_200);
  doc.line(margin + 5, cardY, pageWidth - margin - 5, cardY);
  cardY += 5.5;

  // 3 Timing Columns
  const colW = (contentWidth - 10) / 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_500);
  doc.text('Actual Recorded Duration', margin + 5, cardY);
  doc.text('Target Project Window', margin + 5 + colW, cardY);
  doc.text('Timing Qualification', margin + 5 + colW * 2, cardY);
  cardY += 4.8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...NAVY_DARK);
  doc.text(sanitizePdfText(timingReport.actualDurationFormatted), margin + 5, cardY);
  doc.text(sanitizePdfText(timingReport.targetRangeFormatted), margin + 5 + colW, cardY);

  doc.setFontSize(8.5);
  doc.setTextColor(...statusColor);
  doc.text(statusLabel, margin + 5 + colW * 2, cardY);
  cardY += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_700);
  for (const line of timingNotesLines) {
    doc.text(line, margin + 5, cardY);
    cardY += 4.2;
  }

  y += summaryCardHeight + 8;

  // --- Toastmasters CRC Feedback ---
  drawSectionHeading('Section 01 · Toastmasters CRC Method', 'Commendations, Recommendations & Challenge');

  // Commendations
  ensureSpace(12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...EMERALD);
  doc.text('Commendations (What Went Well)', margin, y);
  y += 5;

  evaluation.crcFeedback.commendations.forEach((item, idx) => {
    ensureSpace(16);
    drawWrappedText(`${idx + 1}. ${item.title}`, margin + 2, contentWidth - 2, {
      fontSize: 9.8,
      fontStyle: 'bold',
      color: SLATE_900,
      lineHeight: 4.5,
    });
    drawWrappedText(item.detail, margin + 5, contentWidth - 5, {
      fontSize: 9.2,
      color: SLATE_700,
      lineHeight: 4.3,
    });
    if (item.evidence) {
      drawWrappedText(`Evidence: ${item.evidence}`, margin + 5, contentWidth - 5, {
        fontSize: 8.5,
        fontStyle: 'italic',
        color: SLATE_500,
        lineHeight: 4,
      });
    }
    y += 2.5;
  });

  y += 2;

  // Recommendations
  ensureSpace(12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...NAVY);
  doc.text('Recommendations (Actionable Areas for Growth)', margin, y);
  y += 5;

  evaluation.crcFeedback.recommendations.forEach((item, idx) => {
    ensureSpace(16);
    drawWrappedText(`${idx + 1}. ${item.title}`, margin + 2, contentWidth - 2, {
      fontSize: 9.8,
      fontStyle: 'bold',
      color: SLATE_900,
      lineHeight: 4.5,
    });
    drawWrappedText(item.detail, margin + 5, contentWidth - 5, {
      fontSize: 9.2,
      color: SLATE_700,
      lineHeight: 4.3,
    });
    if (item.actionableStep) {
      drawWrappedText(`Action step: ${item.actionableStep}`, margin + 5, contentWidth - 5, {
        fontSize: 8.8,
        fontStyle: 'bold',
        color: MAROON,
        lineHeight: 4.1,
      });
    }
    y += 2.5;
  });

  y += 2;

  // Challenge Highlight Box
  const challengeTitleLines = doc.splitTextToSize(
    sanitizePdfText(evaluation.crcFeedback.challenge.title),
    contentWidth - 10
  ) as string[];
  const challengeDetailLines = doc.splitTextToSize(
    sanitizePdfText(evaluation.crcFeedback.challenge.detail),
    contentWidth - 10
  ) as string[];
  const challengeBoxHeight =
    11 + challengeTitleLines.length * 4.6 + challengeDetailLines.length * 4.2 + 5;

  ensureSpace(challengeBoxHeight + 4);
  doc.setFillColor(...NAVY);
  doc.roundedRect(margin, y, contentWidth, challengeBoxHeight, 2.5, 2.5, 'F');

  let cY = y + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GOLD);
  doc.text('NEXT-SPEECH CHALLENGE', margin + 5, cY);
  cY += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  for (const line of challengeTitleLines) {
    doc.text(line, margin + 5, cY);
    cY += 4.6;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.2);
  doc.setTextColor(226, 232, 240);
  for (const line of challengeDetailLines) {
    doc.text(line, margin + 5, cY);
    cY += 4.2;
  }

  y += challengeBoxHeight + 8;

  // --- Pathways Rubric Breakdown ---
  drawSectionHeading('Section 02 · Pathways Criteria', 'Pathways Rubric Breakdown');

  evaluation.rubricBreakdown.forEach((row, idx) => {
    const maxRating = row.maxRating || 5;
    const pct = Math.min(1, Math.max(0, row.rating / maxRating));

    const qLines = doc.splitTextToSize(sanitizePdfText(row.question), contentWidth - 4) as string[];
    const fbLines = doc.splitTextToSize(
      sanitizePdfText(row.evidenceAndFeedback),
      contentWidth - 4
    ) as string[];
    const blockHeight = 8 + qLines.length * 4.3 + 4.5 + fbLines.length * 4.1 + 4;

    ensureSpace(blockHeight);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...NAVY);
    doc.text(
      `${String(idx + 1).padStart(2, '0')}. ${sanitizePdfText(row.category)}`,
      margin,
      y
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...MAROON);
    doc.text(
      `${sanitizePdfText(row.ratingLabel)}  (${row.rating} / ${maxRating})`,
      pageWidth - margin,
      y,
      { align: 'right' }
    );
    y += 4.5;

    drawWrappedText(row.question, margin + 2, contentWidth - 4, {
      fontSize: 9.2,
      fontStyle: 'bold',
      color: SLATE_900,
      lineHeight: 4.3,
    });

    // Vector rating bar
    y += 0.5;
    doc.setFillColor(...SLATE_200);
    doc.roundedRect(margin + 2, y, contentWidth - 4, 2, 1, 1, 'F');
    if (pct > 0) {
      doc.setFillColor(...NAVY);
      doc.roundedRect(margin + 2, y, Math.max(2, (contentWidth - 4) * pct), 2, 1, 1, 'F');
    }
    y += 5;

    drawWrappedText(row.evidenceAndFeedback, margin + 2, contentWidth - 4, {
      fontSize: 9,
      color: SLATE_700,
      lineHeight: 4.1,
    });

    y += 2.5;
    if (idx < evaluation.rubricBreakdown.length - 1) {
      doc.setDrawColor(...SLATE_200);
      doc.setLineWidth(0.2);
      doc.line(margin, y, pageWidth - margin, y);
      y += 4.5;
    }
  });

  y += 5;

  // --- Delivery Metrics ---
  drawSectionHeading('Section 03 · Delivery Audit', 'Vocal, Fluency & Visual Presence Metrics');

  const { deliveryMetrics } = evaluation;
  const fillerBreakdownText =
    deliveryMetrics.fillerWords.breakdown.length > 0
      ? deliveryMetrics.fillerWords.breakdown
          .map((fw) => `"${fw.word}": ${fw.count}`)
          .join('   |   ')
      : 'No recurring filler words detected';

  const metricsItems = [
    {
      label: 'Speaking Pacing',
      value: deliveryMetrics.pacingWpmEstimate,
      body: deliveryMetrics.pacingNotes,
    },
    {
      label: 'Vocal Variety',
      value: '',
      body: deliveryMetrics.vocalVarietyNotes,
    },
    {
      label: 'Filler Words Audit',
      value: `${deliveryMetrics.fillerWords.totalCount} total`,
      body: `${fillerBreakdownText}\n${deliveryMetrics.fillerWords.notes}`,
    },
    {
      label: 'Visual Presence & Body Language',
      value: '',
      body: deliveryMetrics.visualPresenceNotes,
    },
  ];

  for (const metric of metricsItems) {
    ensureSpace(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...NAVY);
    doc.text(sanitizePdfText(metric.label), margin, y);

    if (metric.value) {
      doc.setTextColor(...MAROON);
      doc.text(sanitizePdfText(metric.value), pageWidth - margin, y, { align: 'right' });
    }
    y += 4.5;

    const paragraphs = metric.body.split('\n');
    for (const para of paragraphs) {
      drawWrappedText(para, margin + 2, contentWidth - 2, {
        fontSize: 9.2,
        color: SLATE_700,
        lineHeight: 4.3,
      });
    }
    y += 3;
  }

  // --- Spoken Evaluation Script ---
  if (evaluation.spokenEvaluationScript) {
    y += 2;
    drawSectionHeading('Section 04 · Oral Delivery Reference', 'Spoken Evaluation Script');
    drawWrappedText(evaluation.spokenEvaluationScript, margin, contentWidth, {
      fontSize: 9.3,
      fontStyle: 'italic',
      color: SLATE_700,
      lineHeight: 4.6,
    });
  }

  // --- Consistent Footers on Every Page ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...SLATE_200);
    doc.setLineWidth(0.25);
    doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...SLATE_500);
    doc.text(
      'Elite Toastmasters Evaluation App  |  Pathways CRC & Timing Report',
      margin,
      pageHeight - 8.5
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 8.5, {
      align: 'right',
    });
  }

  const safeName = (timingReport.speakerName || 'speaker')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  doc.save(`toastmasters_evaluation_${safeName || 'report'}.pdf`);
}
