import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileAudio,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  Play,
  Sparkles,
  Square,
  SwitchCamera,
  Upload,
  Volume2,
} from 'lucide-react';
import type {
  CapturedKeyframe,
  EvaluationRubric,
  SpeakerDetails,
  TimingLampState,
} from '../types/evaluation';
import {
  computeTimingThresholds,
  formatDuration,
  getTimingLampState,
} from '../utils/timing';

interface StepTwoCaptureProps {
  speakerDetails: SpeakerDetails;
  rubric: EvaluationRubric;
  isAnalyzing: boolean;
  onEvaluateSpeech: (payload: {
    mediaBlob: Blob;
    filename: string;
    durationSeconds: number;
    keyframes: CapturedKeyframe[];
  }) => Promise<void>;
  onActivateDemoSession: () => void;
  demoTriggerCount: number;
}

type CaptureSourceType = 'none' | 'screen' | 'camera' | 'mic' | 'uploaded' | 'demo';

export const StepTwoCapture: React.FC<StepTwoCaptureProps> = ({
  speakerDetails,
  isAnalyzing,
  onEvaluateSpeech,
  onActivateDemoSession,
  demoTriggerCount,
}) => {
  const [sourceType, setSourceType] = useState<CaptureSourceType>('none');
  const [includeMicWithScreen, setIncludeMicWithScreen] = useState(true);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const [captureWarning, setCaptureWarning] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('user');
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [cameraLoading, setCameraLoading] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedFilename, setRecordedFilename] = useState('speech.webm');
  const [recordedDuration, setRecordedDuration] = useState(0);

  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [uploadedIsAudioOnly, setUploadedIsAudioOnly] = useState(false);
  const [demoAudioLoading, setDemoAudioLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const displayStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const keyframesRef = useRef<CapturedKeyframe[]>([]);

  const timerIntervalRef = useRef<number | null>(null);
  const keyframeIntervalRef = useRef<number | null>(null);
  const startTimestampRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);

  const thresholds = computeTimingThresholds(
    speakerDetails.minMinutes,
    speakerDetails.maxMinutes
  );

  const displaySeconds = isRecording
    ? elapsedSeconds
    : recordedDuration > 0
      ? recordedDuration
      : elapsedSeconds;

  const lampState: TimingLampState = getTimingLampState(
    displaySeconds,
    thresholds,
    isRecording || recordedDuration > 0
  );

  function stopAllStreams() {
    if (timerIntervalRef.current) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (keyframeIntervalRef.current) {
      window.clearInterval(keyframeIntervalRef.current);
      keyframeIntervalRef.current = null;
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  useEffect(() => {
    return () => {
      stopAllStreams();
      if (uploadedFileUrl) {
        URL.revokeObjectURL(uploadedFileUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger demo load if parent header button clicked
  useEffect(() => {
    if (demoTriggerCount > 0) {
      handleLoadDemoSampleSpeech(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoTriggerCount]);

  function captureSingleKeyframe(currentElapsed: number) {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }
    if (keyframesRef.current.length >= 10) return;

    const targetWidth = Math.min(640, video.videoWidth);
    const scale = targetWidth / video.videoWidth;
    const targetHeight = Math.round(video.videoHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    const base64Data = dataUrl.split(',')[1];
    if (base64Data) {
      keyframesRef.current.push({
        timestampSeconds: Math.round(currentElapsed),
        mimeType: 'image/jpeg',
        base64Data,
      });
    }
  }

  async function handleSelectScreen() {
    setCaptureError(null);
    setCaptureWarning(null);
    stopAllStreams();
    if (uploadedFileUrl) {
      URL.revokeObjectURL(uploadedFileUrl);
      setUploadedFileUrl(null);
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      setSourceType('none');
      setCaptureError(
        'Screen sharing is unavailable in this browser or iframe context. Use "Upload Recorded Speech" or "Demo Sample Speech" below to test the full evaluation workflow.'
      );
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: true,
      });
      displayStreamRef.current = displayStream;

      const displayAudioTracks = displayStream.getAudioTracks();

      let micStream: MediaStream | null = null;
      if (includeMicWithScreen && navigator.mediaDevices.getUserMedia) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStreamRef.current = micStream;
        } catch {
          setCaptureWarning(
            'Microphone access was declined; recording shared tab/system audio only.'
          );
        }
      }

      const hasAnyAudio =
        displayAudioTracks.length > 0 || (micStream ? micStream.getAudioTracks().length > 0 : false);
      setHasAudioTrack(hasAnyAudio);

      if (displayAudioTracks.length === 0 && !micStream) {
        setCaptureWarning(
          'No audio track detected! Please re-select your browser tab and check "Share tab audio", or enable Microphone capture.'
        );
      } else if (displayAudioTracks.length === 0 && micStream) {
        setCaptureWarning(
          'Tab audio was not shared — using Microphone audio. For clearest speaker audio, check "Share tab audio" in the browser prompt.'
        );
      }

      if (videoRef.current) {
        videoRef.current.srcObject = displayStream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => undefined);
      }

      displayStream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            handleStopEvaluation();
          } else {
            stopAllStreams();
            setSourceType('none');
          }
        });
      });

      setSourceType('screen');
      setRecordedBlob(null);
      setRecordedDuration(0);
      setElapsedSeconds(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('allowed') || msg.toLowerCase().includes('disallowed')) {
        setCaptureError(
          'Screen sharing was blocked by browser or iframe permissions. You can still test end-to-end using "Microphone Only", "Upload Recorded Video/Audio", or "Demo Sample Speech".'
        );
      } else {
        setCaptureError(`Screen selection cancelled or unavailable (${msg}).`);
      }
      setSourceType('none');
    }
  }

  async function refreshCameraDevices(activeTrack?: MediaStreamTrack) {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setAvailableCameras(videoInputs);
      const activeDeviceId = activeTrack?.getSettings?.().deviceId;
      if (activeDeviceId) {
        setSelectedCameraId(activeDeviceId);
      }
    } catch {
      // Ignore enumeration failures
    }
  }

  async function startLiveCamera(
    facing: 'user' | 'environment',
    deviceId?: string,
    preferExactFacing = false
  ) {
    setCaptureError(null);
    setCaptureWarning(null);
    setCameraLoading(true);
    stopAllStreams();
    if (uploadedFileUrl) {
      URL.revokeObjectURL(uploadedFileUrl);
      setUploadedFileUrl(null);
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setCameraLoading(false);
      setSourceType('none');
      setCaptureError(
        'Camera capture is unavailable in this browser or context. You can use "Upload Recorded File" or "Demo Sample Speech" instead.'
      );
      return;
    }

    const buildVideoConstraint = (exactFacing: boolean): MediaTrackConstraints => {
      if (deviceId) {
        return {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        };
      }
      return {
        facingMode: exactFacing ? { exact: facing } : { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      };
    };

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraint(preferExactFacing),
          audio: true,
        });
      } catch (primaryErr) {
        if (preferExactFacing && !deviceId) {
          // Device may only have a single webcam (e.g. laptop); fall back to ideal facingMode
          stream = await navigator.mediaDevices.getUserMedia({
            video: buildVideoConstraint(false),
            audio: true,
          });
          setCaptureWarning(
            facing === 'environment'
              ? 'No dedicated rear camera was detected on this device; using the default available camera.'
              : 'Could not lock front camera constraint; using the default available camera.'
          );
        } else {
          throw primaryErr;
        }
      }

      cameraStreamRef.current = stream;

      const audioTracks = stream.getAudioTracks();
      setHasAudioTrack(audioTracks.length > 0);
      if (audioTracks.length === 0) {
        setCaptureWarning('Camera connected without a microphone track. Check browser audio permissions.');
      }

      const activeVideoTrack = stream.getVideoTracks()[0];
      const detectedFacing = activeVideoTrack?.getSettings?.().facingMode;
      if (detectedFacing === 'environment' || detectedFacing === 'user') {
        setCameraFacingMode(detectedFacing);
      } else if (!deviceId) {
        setCameraFacingMode(facing);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => undefined);
      }

      activeVideoTrack?.addEventListener('ended', () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          handleStopEvaluation();
        } else {
          stopAllStreams();
          setSourceType('none');
        }
      });

      await refreshCameraDevices(activeVideoTrack);

      setSourceType('camera');
      setRecordedBlob(null);
      setRecordedDuration(0);
      setElapsedSeconds(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.toLowerCase().includes('permission') ||
        msg.toLowerCase().includes('denied') ||
        msg.toLowerCase().includes('notallowed')
      ) {
        setCaptureError(
          'Camera or microphone permission was denied. Allow camera access in your browser settings, or use "Upload Recorded File" or "Demo Sample Speech".'
        );
      } else {
        setCaptureError(`Unable to start live camera (${msg}).`);
      }
      setSourceType('none');
    } finally {
      setCameraLoading(false);
    }
  }

  async function handleSelectCamera() {
    await startLiveCamera(cameraFacingMode, undefined, false);
  }

  async function handleSwitchCameraFacing(nextFacing: 'user' | 'environment') {
    setCameraFacingMode(nextFacing);
    setSelectedCameraId('');
    await startLiveCamera(nextFacing, undefined, true);
  }

  async function handleFlipCamera() {
    const nextFacing = cameraFacingMode === 'user' ? 'environment' : 'user';
    // If multiple camera devices are known on desktop/mobile and facingMode toggle is used
    if (availableCameras.length > 1 && selectedCameraId) {
      const currentIdx = availableCameras.findIndex((c) => c.deviceId === selectedCameraId);
      const nextDevice = availableCameras[(currentIdx + 1) % availableCameras.length];
      if (nextDevice && !/front|back|rear|user|environment/i.test(nextDevice.label)) {
        setSelectedCameraId(nextDevice.deviceId);
        await startLiveCamera(nextFacing, nextDevice.deviceId, false);
        return;
      }
    }
    await handleSwitchCameraFacing(nextFacing);
  }

  async function handleSelectCameraDevice(deviceId: string) {
    setSelectedCameraId(deviceId);
    const chosen = availableCameras.find((c) => c.deviceId === deviceId);
    const inferredFacing =
      chosen && /back|rear|environment/i.test(chosen.label) ? 'environment' : 'user';
    setCameraFacingMode(inferredFacing);
    await startLiveCamera(inferredFacing, deviceId, false);
  }

  async function handleSelectMicOnly() {
    setCaptureError(null);
    setCaptureWarning(null);
    stopAllStreams();
    if (uploadedFileUrl) {
      URL.revokeObjectURL(uploadedFileUrl);
      setUploadedFileUrl(null);
    }

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      setHasAudioTrack(true);
      setSourceType('mic');
      setRecordedBlob(null);
      setRecordedDuration(0);
      setElapsedSeconds(0);
    } catch (err) {
      setCaptureError(
        err instanceof Error
          ? `Microphone access failed: ${err.message}`
          : 'Unable to access microphone.'
      );
    }
  }

  function handleUploadedMedia(file: File) {
    setCaptureError(null);
    setCaptureWarning(null);
    stopAllStreams();
    if (uploadedFileUrl) {
      URL.revokeObjectURL(uploadedFileUrl);
    }

    const url = URL.createObjectURL(file);
    const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg)$/i.test(file.name);
    setUploadedFileUrl(url);
    setUploadedIsAudioOnly(isAudio);
    setRecordedBlob(file);
    setRecordedFilename(file.name);
    setHasAudioTrack(true);
    setSourceType('uploaded');
    setElapsedSeconds(0);

    // Probe actual media duration
    const probe = document.createElement(isAudio ? 'audio' : 'video');
    probe.preload = 'metadata';
    probe.src = url;
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        setRecordedDuration(Math.round(probe.duration));
      }
    };
  }

  async function handleLoadDemoSampleSpeech(alsoNotifyParent = true) {
    setCaptureError(null);
    setCaptureWarning(null);
    setDemoAudioLoading(true);
    stopAllStreams();

    try {
      if (alsoNotifyParent) {
        onActivateDemoSession();
      }
      const res = await fetch('/api/demo-speech-audio', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to generate demo speech audio.');

      const byteChars = atob(data.audioBase64);
      const byteNumbers = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const wavBlob = new Blob([byteNumbers], { type: data.mimeType || 'audio/wav' });
      const url = URL.createObjectURL(wavBlob);

      if (uploadedFileUrl) URL.revokeObjectURL(uploadedFileUrl);
      setUploadedFileUrl(url);
      setUploadedIsAudioOnly(true);
      setRecordedBlob(wavBlob);
      setRecordedFilename('demo_toastmasters_speech.wav');
      setHasAudioTrack(true);
      setSourceType('demo');

      const probe = document.createElement('audio');
      probe.src = url;
      probe.onloadedmetadata = () => {
        const dur = Number.isFinite(probe.duration) && probe.duration > 0 ? Math.round(probe.duration) : 65;
        setRecordedDuration(dur);
        setElapsedSeconds(0);
      };
    } catch (err) {
      setCaptureError(
        err instanceof Error ? err.message : 'Could not load demo speech recording.'
      );
    } finally {
      setDemoAudioLoading(false);
    }
  }

  function buildCombinedStream(): MediaStream | null {
    const displayStream = displayStreamRef.current;
    const cameraStream = cameraStreamRef.current;
    const micStream = micStreamRef.current;

    if (sourceType === 'camera' && cameraStream) {
      return cameraStream;
    }

    if (sourceType === 'mic' && micStream) {
      return micStream;
    }

    if (sourceType === 'screen' && displayStream) {
      const videoTracks = displayStream.getVideoTracks();
      const displayAudio = displayStream.getAudioTracks();
      const micAudio = micStream ? micStream.getAudioTracks() : [];

      if (displayAudio.length > 0 && micAudio.length > 0) {
        const ctx = new AudioContext();
        audioContextRef.current = ctx;
        const dest = ctx.createMediaStreamDestination();
        const srcDisplay = ctx.createMediaStreamSource(new MediaStream(displayAudio));
        const srcMic = ctx.createMediaStreamSource(new MediaStream(micAudio));
        srcDisplay.connect(dest);
        srcMic.connect(dest);
        return new MediaStream([...videoTracks, ...dest.stream.getAudioTracks()]);
      }

      if (displayAudio.length > 0) {
        return new MediaStream([...videoTracks, ...displayAudio]);
      }

      if (micAudio.length > 0) {
        return new MediaStream([...videoTracks, ...micAudio]);
      }

      return new MediaStream([...videoTracks]);
    }

    return null;
  }

  function handleStartEvaluation() {
    setCaptureError(null);

    if (sourceType === 'none') {
      setCaptureError('Please select a Screen / Browser Tab, Live Camera, Microphone, Uploaded Recording, or Demo Speech first.');
      return;
    }

    // Uploaded or Demo file mode: play media with live timing light
    if (sourceType === 'uploaded' || sourceType === 'demo') {
      setIsRecording(true);
      setElapsedSeconds(0);
      elapsedRef.current = 0;
      startTimestampRef.current = Date.now();
      keyframesRef.current = [];

      const mediaEl = uploadedIsAudioOnly ? audioRef.current : videoRef.current;
      if (mediaEl) {
        mediaEl.currentTime = 0;
        mediaEl.muted = false;
        mediaEl.play().catch(() => undefined);
      }

      if (!uploadedIsAudioOnly) {
        window.setTimeout(() => captureSingleKeyframe(0), 300);
        keyframeIntervalRef.current = window.setInterval(() => {
          captureSingleKeyframe(elapsedRef.current);
        }, 7000);
      }

      timerIntervalRef.current = window.setInterval(() => {
        const secs = Math.floor((Date.now() - startTimestampRef.current) / 1000);
        elapsedRef.current = secs;
        setElapsedSeconds(secs);
      }, 250);
      return;
    }

    // Live Screen / Mic MediaRecorder capture
    const combinedStream = buildCombinedStream();
    if (!combinedStream) {
      setCaptureError('Active media stream not found. Please re-select your capture source.');
      return;
    }

    recordedChunksRef.current = [];
    keyframesRef.current = [];

    const preferredMime =
      sourceType === 'mic'
        ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        : ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

    const supportedMime = preferredMime.find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = supportedMime
      ? new MediaRecorder(combinedStream, { mimeType: supportedMime })
      : new MediaRecorder(combinedStream);

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        recordedChunksRef.current.push(ev.data);
      }
    };

    recorder.start(1000);
    setIsRecording(true);
    setElapsedSeconds(0);
    setRecordedDuration(0);
    elapsedRef.current = 0;
    startTimestampRef.current = Date.now();

    if (sourceType === 'screen' || sourceType === 'camera') {
      window.setTimeout(() => captureSingleKeyframe(0), 400);
      keyframeIntervalRef.current = window.setInterval(() => {
        captureSingleKeyframe(elapsedRef.current);
      }, 8000);
    }

    timerIntervalRef.current = window.setInterval(() => {
      const secs = Math.floor((Date.now() - startTimestampRef.current) / 1000);
      elapsedRef.current = secs;
      setElapsedSeconds(secs);
    }, 250);
  }

  async function handleStopEvaluation() {
    if (timerIntervalRef.current) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (keyframeIntervalRef.current) {
      window.clearInterval(keyframeIntervalRef.current);
      keyframeIntervalRef.current = null;
    }

    const finalElapsed = Math.max(
      1,
      Math.round((Date.now() - startTimestampRef.current) / 1000)
    );
    setIsRecording(false);

    if (sourceType === 'uploaded' || sourceType === 'demo') {
      const mediaEl = uploadedIsAudioOnly ? audioRef.current : videoRef.current;
      if (mediaEl) {
        mediaEl.pause();
      }
      // Use full media duration if user stopped early during preview OR exact watched duration
      const evalDuration = recordedDuration > 0 ? recordedDuration : finalElapsed;
      setElapsedSeconds(evalDuration);
      if (recordedBlob) {
        await onEvaluateSpeech({
          mediaBlob: recordedBlob,
          filename: recordedFilename,
          durationSeconds: evalDuration,
          keyframes: keyframesRef.current,
        });
      }
      return;
    }

    // Stop live MediaRecorder and submit captured blob
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    setRecordedDuration(finalElapsed);
    setElapsedSeconds(finalElapsed);

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        resolve();
      }
    });

    const mimeType = recorder.mimeType || (sourceType === 'mic' ? 'audio/webm' : 'video/webm');
    const blob = new Blob(recordedChunksRef.current, { type: mimeType });
    const capturedName =
      sourceType === 'mic'
        ? 'captured_speech.webm'
        : sourceType === 'camera'
          ? 'captured_camera_speech.webm'
          : 'captured_screen_speech.webm';
    setRecordedBlob(blob);
    setRecordedFilename(capturedName);

    await onEvaluateSpeech({
      mediaBlob: blob,
      filename: capturedName,
      durationSeconds: finalElapsed,
      keyframes: keyframesRef.current,
    });
  }

  async function handleAnalyzeLoadedMediaDirectly() {
    if (!recordedBlob) return;
    const duration = recordedDuration > 0 ? recordedDuration : Math.max(1, elapsedSeconds || 60);

    // Grab a frame from uploaded video if available
    if (!uploadedIsAudioOnly && videoRef.current && keyframesRef.current.length === 0) {
      captureSingleKeyframe(0);
    }

    await onEvaluateSpeech({
      mediaBlob: recordedBlob,
      filename: recordedFilename,
      durationSeconds: duration,
      keyframes: keyframesRef.current,
    });
  }

  const lampLabelMap: Record<TimingLampState, { text: string; badgeClass: string }> = {
    idle: {
      text: 'READY TO TIME',
      badgeClass: 'text-slate-600 bg-slate-100 border-slate-200',
    },
    under: {
      text: 'UNDER MINIMUM',
      badgeClass: 'text-[#004165] bg-[#004165]/10 border-[#004165]/25',
    },
    green: {
      text: 'GREEN · QUALIFIED',
      badgeClass: 'text-emerald-800 bg-emerald-50 border-emerald-200',
    },
    yellow: {
      text: 'YELLOW · WRAP UP',
      badgeClass: 'text-amber-900 bg-amber-50 border-amber-300',
    },
    red: {
      text: 'RED · STOP SOON',
      badgeClass: 'text-red-800 bg-red-50 border-red-200',
    },
    overtime: {
      text: 'OVERTIME · GRACE EXCEEDED',
      badgeClass: 'text-[#772432] bg-[#772432]/10 border-[#772432]/30',
    },
  };

  return (
    <section id="step-capture" className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-5">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#772432]">
            Step 02 · Live Capture &amp; Timing
          </p>
          <h2 className="text-2xl font-semibold text-[#004165] mt-1">
            Screen &amp; Audio Capture
          </h2>
        </div>
        <p className="text-sm text-slate-600 max-w-xl">
          Share a Zoom, Google Meet, or YouTube tab, record live from your laptop or phone camera
          (front/back), use microphone only, upload a recording, or test with a synthesized speech.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        {/* Source Selection Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={isRecording || isAnalyzing}
              onClick={handleSelectScreen}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                sourceType === 'screen'
                  ? 'bg-[#004165] text-white ring-2 ring-[#004165]/30'
                  : 'bg-[#004165] text-white hover:bg-[#002B45]'
              }`}
            >
              <Monitor className="w-4 h-4" />
              Select Screen / Browser Tab
            </button>

            <button
              type="button"
              disabled={isRecording || isAnalyzing || cameraLoading}
              onClick={handleSelectCamera}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                sourceType === 'camera'
                  ? 'bg-[#004165]/10 text-[#004165] border-[#004165]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cameraLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              {cameraLoading ? 'Starting Camera...' : 'Live Camera'}
            </button>

            <button
              type="button"
              disabled={isRecording || isAnalyzing}
              onClick={handleSelectMicOnly}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                sourceType === 'mic'
                  ? 'bg-[#004165]/10 text-[#004165] border-[#004165]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Mic className="w-4 h-4" />
              Microphone Only
            </button>

            <input
              ref={uploadInputRef}
              type="file"
              accept="video/*,audio/*,.mp4,.webm,.mov,.mp3,.wav,.m4a"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUploadedMedia(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={isRecording || isAnalyzing}
              onClick={() => uploadInputRef.current?.click()}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                sourceType === 'uploaded'
                  ? 'bg-[#004165]/10 text-[#004165] border-[#004165]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Upload className="w-4 h-4" />
              Upload Recorded File
            </button>

            <button
              type="button"
              disabled={isRecording || isAnalyzing || demoAudioLoading}
              onClick={() => handleLoadDemoSampleSpeech(true)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                sourceType === 'demo'
                  ? 'bg-[#F2DF74]/40 text-[#002B45] border-[#B8981C]'
                  : 'bg-[#F2DF74]/25 text-[#002B45] border-[#F2DF74] hover:bg-[#F2DF74]/45'
              }`}
            >
              {demoAudioLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {demoAudioLoading ? 'Preparing Demo Speech...' : 'Demo Sample Speech'}
            </button>
          </div>

          {sourceType === 'camera' ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  disabled={isRecording || cameraLoading}
                  onClick={() => handleSwitchCameraFacing('user')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                    cameraFacingMode === 'user'
                      ? 'bg-white text-[#004165] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Front Camera
                </button>
                <button
                  type="button"
                  disabled={isRecording || cameraLoading}
                  onClick={() => handleSwitchCameraFacing('environment')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                    cameraFacingMode === 'environment'
                      ? 'bg-white text-[#004165] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Back Camera
                </button>
              </div>

              {availableCameras.length > 1 && (
                <select
                  aria-label="Select camera device"
                  disabled={isRecording || cameraLoading}
                  value={selectedCameraId}
                  onChange={(e) => handleSelectCameraDevice(e.target.value)}
                  className="max-w-[200px] truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#004165]/25 disabled:opacity-50"
                >
                  {availableCameras.map((cam, idx) => (
                    <option key={cam.deviceId} value={cam.deviceId}>
                      {cam.label || `Camera ${idx + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeMicWithScreen}
                disabled={isRecording}
                onChange={(e) => setIncludeMicWithScreen(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-[#004165] focus:ring-[#004165]"
              />
              <span className="inline-flex items-center gap-1.5">
                {includeMicWithScreen ? (
                  <Mic className="w-3.5 h-3.5 text-[#004165]" />
                ) : (
                  <MicOff className="w-3.5 h-3.5 text-slate-400" />
                )}
                Mix Microphone with Screen Share
              </span>
            </label>
          )}
        </div>

        {/* Capture Notices / Errors */}
        {captureError && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
            <div>
              <p className="font-medium">Capture Notice</p>
              <p className="text-xs text-red-800 mt-0.5">{captureError}</p>
            </div>
          </div>
        )}

        {captureWarning && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
            <p className="text-xs leading-relaxed">{captureWarning}</p>
          </div>
        )}

        {/* Main 2-Column Capture + Timing Tower */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left 7 cols: Video / Audio Preview + Evaluation Controls */}
          <div className="lg:col-span-7 flex flex-col justify-between">
            <div>
              <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-[#002B45] border border-slate-200 flex items-center justify-center">
                {/* Live Screen, Live Camera, or Uploaded Video */}
                <video
                  ref={videoRef}
                  src={!uploadedIsAudioOnly && uploadedFileUrl ? uploadedFileUrl : undefined}
                  controls={sourceType === 'uploaded' && !uploadedIsAudioOnly}
                  playsInline
                  className={`w-full h-full object-contain ${
                    sourceType === 'camera' && cameraFacingMode === 'user' ? 'scale-x-[-1]' : ''
                  } ${
                    sourceType === 'screen' ||
                    sourceType === 'camera' ||
                    (sourceType === 'uploaded' && !uploadedIsAudioOnly)
                      ? 'block'
                      : 'hidden'
                  }`}
                />

                {/* Uploaded / Demo Audio-Only Stage */}
                {(sourceType === 'mic' ||
                  sourceType === 'demo' ||
                  (sourceType === 'uploaded' && uploadedIsAudioOnly)) && (
                  <div className="text-center px-6 py-8 max-w-md">
                    <div className="w-14 h-14 mx-auto rounded-full bg-white/10 text-[#F2DF74] flex items-center justify-center mb-3">
                      {sourceType === 'mic' ? (
                        <Mic className="w-7 h-7" />
                      ) : (
                        <FileAudio className="w-7 h-7" />
                      )}
                    </div>
                    <p className="text-base font-semibold text-white">
                      {sourceType === 'mic'
                        ? 'Microphone Audio Stream Active'
                        : sourceType === 'demo'
                          ? 'Demo Sample Speech Loaded'
                          : `Loaded Audio: ${recordedFilename}`}
                    </p>
                    <p className="text-xs text-slate-300 mt-1.5">
                      {sourceType === 'mic'
                        ? 'Click Start Evaluation below to record live speech audio and run the Toastmasters timing lights.'
                        : 'Click Start Evaluation to play with live timing lights, or Analyze Recording directly.'}
                    </p>

                    {(sourceType === 'demo' || (sourceType === 'uploaded' && uploadedIsAudioOnly)) &&
                      uploadedFileUrl && (
                        <audio
                          ref={audioRef}
                          src={uploadedFileUrl}
                          controls
                          className="mt-4 w-full max-w-sm mx-auto"
                        />
                      )}
                  </div>
                )}

                {/* Empty / Ready State */}
                {sourceType === 'none' && (
                  <div className="text-center px-6 py-8 max-w-md">
                    <div className="w-12 h-12 mx-auto rounded-xl bg-white/10 text-[#F2DF74] flex items-center justify-center mb-3">
                      <Monitor className="w-6 h-6" />
                    </div>
                    <p className="text-base font-semibold text-white">
                      No Screen, Camera, or Audio Source Selected
                    </p>
                    <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                      Choose <span className="text-white font-medium">Select Screen / Browser Tab</span>{' '}
                      for a Zoom/Meet/YouTube speaker, <span className="text-white font-medium">Live Camera</span>{' '}
                      to record with your laptop or phone camera, or <span className="text-white font-medium">Demo Sample Speech</span>{' '}
                      for an instant walkthrough.
                    </p>
                  </div>
                )}

                {/* Live Recording Indicator Badge (strictly for active MediaRecorder) */}
                {isRecording && (
                  <div className="absolute top-3 left-3 inline-flex items-center gap-2 px-3 py-1 rounded-md bg-black/75 text-white text-xs font-medium">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="font-mono tabular-nums">
                      CAPTURING · {formatDuration(elapsedSeconds)}
                    </span>
                  </div>
                )}

                {/* Quick Flip Camera overlay button for phones & multi-camera devices */}
                {sourceType === 'camera' && !isRecording && (
                  <button
                    type="button"
                    disabled={cameraLoading}
                    onClick={handleFlipCamera}
                    className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/70 hover:bg-black/85 text-white text-xs font-medium backdrop-blur-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <SwitchCamera className="w-3.5 h-3.5" />
                    <span>
                      {cameraFacingMode === 'user' ? 'Switch to Back' : 'Switch to Front'}
                    </span>
                  </button>
                )}
              </div>

              {/* Contextual Reminder Tip */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                {sourceType === 'camera' ? (
                  <p className="inline-flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-[#004165] shrink-0" />
                    <span>
                      <strong className="text-[#004165]">Tip:</strong> Frame yourself at eye level
                      with clear lighting so the AI can evaluate posture, gestures, and eye contact.
                    </span>
                  </p>
                ) : (
                  <p className="inline-flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#004165] shrink-0" />
                    <span>
                      <strong className="text-[#004165]">Tip:</strong> Check{' '}
                      <span className="font-semibold text-slate-800">&ldquo;Share tab audio&rdquo;</span>{' '}
                      in the browser prompt so the AI can hear the speaker.
                    </span>
                  </p>
                )}

                {(sourceType === 'screen' || sourceType === 'camera') && (
                  <span
                    className={`inline-flex items-center gap-1 font-medium ${
                      hasAudioTrack ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {hasAudioTrack ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {sourceType === 'camera'
                          ? `Camera (${cameraFacingMode === 'user' ? 'Front' : 'Back'}) & mic connected`
                          : 'Audio stream connected'}
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        No audio track detected
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* Controls directly below preview */}
            <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {!isRecording ? (
                  <button
                    type="button"
                    disabled={sourceType === 'none' || isAnalyzing}
                    onClick={handleStartEvaluation}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-[#772432] text-white rounded-lg hover:bg-[#5C1A25] transition-colors disabled:opacity-45 whitespace-nowrap cursor-pointer"
                  >
                    <Play className="w-4 h-4" />
                    Start Evaluation
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isAnalyzing}
                    onClick={handleStopEvaluation}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Stop Evaluation &amp; Analyze
                  </button>
                )}

                {(sourceType === 'uploaded' || sourceType === 'demo') &&
                  !isRecording &&
                  recordedBlob && (
                    <button
                      type="button"
                      disabled={isAnalyzing}
                      onClick={handleAnalyzeLoadedMediaDirectly}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#004165] text-white rounded-lg hover:bg-[#002B45] transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      {isAnalyzing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      Analyze Loaded Speech
                    </button>
                  )}
              </div>

              <div className="text-xs text-slate-500 font-mono tabular-nums">
                {recordedDuration > 0
                  ? `Duration: ${formatDuration(recordedDuration)}`
                  : `Target: ${speakerDetails.targetDuration}`}
              </div>
            </div>
          </div>

          {/* Right 5 cols: Live Toastmasters Timing Light Indicator */}
          <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-[#004165]">
                  Toastmasters Timing Signal
                </h3>
                <span
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border ${lampLabelMap[lampState].badgeClass}`}
                >
                  {lampLabelMap[lampState].text}
                </span>
              </div>

              {/* Big Digital Stopwatch */}
              <div className="my-5 text-center">
                <div className="text-5xl font-mono font-semibold tabular-nums tracking-tight text-[#002B45]">
                  {formatDuration(displaySeconds)}
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Target Window: <span className="font-medium text-slate-700">{speakerDetails.targetDuration}</span>
                  <span aria-hidden="true"> · </span>
                  <span>±30s Grace Period</span>
                </p>
              </div>

              {/* 3-Lamp Signal Tower */}
              <div className="grid grid-cols-3 gap-3">
                <div
                  className={`rounded-lg border p-3 text-center transition-colors ${
                    lampState === 'green'
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full mx-auto mb-1.5 ${
                      lampState === 'green' ? 'bg-white' : 'bg-emerald-500/35'
                    }`}
                  />
                  <p className="text-xs font-semibold">Green</p>
                  <p
                    className={`text-xs font-mono tabular-nums mt-0.5 ${
                      lampState === 'green' ? 'text-emerald-100' : 'text-slate-500'
                    }`}
                  >
                    {formatDuration(thresholds.minSeconds)}
                  </p>
                </div>

                <div
                  className={`rounded-lg border p-3 text-center transition-colors ${
                    lampState === 'yellow'
                      ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full mx-auto mb-1.5 ${
                      lampState === 'yellow' ? 'bg-slate-950' : 'bg-amber-400/45'
                    }`}
                  />
                  <p className="text-xs font-semibold">Yellow</p>
                  <p
                    className={`text-xs font-mono tabular-nums mt-0.5 ${
                      lampState === 'yellow' ? 'text-slate-900' : 'text-slate-500'
                    }`}
                  >
                    {formatDuration(thresholds.midSeconds)}
                  </p>
                </div>

                <div
                  className={`rounded-lg border p-3 text-center transition-colors ${
                    lampState === 'red' || lampState === 'overtime'
                      ? 'bg-red-600 text-white border-red-700 shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full mx-auto mb-1.5 ${
                      lampState === 'red' || lampState === 'overtime'
                        ? 'bg-white'
                        : 'bg-red-500/35'
                    }`}
                  />
                  <p className="text-xs font-semibold">Red</p>
                  <p
                    className={`text-xs font-mono tabular-nums mt-0.5 ${
                      lampState === 'red' || lampState === 'overtime'
                        ? 'text-red-100'
                        : 'text-slate-500'
                    }`}
                  >
                    {formatDuration(thresholds.maxSeconds)}
                  </p>
                </div>
              </div>
            </div>

            {/* Qualification Timeline Summary */}
            <div className="mt-5 pt-4 border-t border-slate-200 text-xs text-slate-600 space-y-1.5">
              <div className="flex justify-between">
                <span>Qualified Window (with 30s grace)</span>
                <span className="font-mono tabular-nums font-semibold text-slate-800">
                  {formatDuration(thresholds.graceMinSeconds)} – {formatDuration(thresholds.graceMaxSeconds)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Evaluating Speaker</span>
                <span className="font-medium text-slate-800 truncate max-w-[180px]">
                  {speakerDetails.speakerName || 'Unassigned Speaker'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
