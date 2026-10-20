import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Mic,
    MicOff,
    Volume2,
    VolumeX,
    Settings,
    Lock,
    Unlock,
    CheckCircle2,
    RotateCcw,
    Sliders,
    Sparkles,
    Activity,
    ChevronUp,
    ChevronDown,
    Info,
    X,
    Radio
} from 'lucide-react';

// ==========================================
// MUSICAL CONSTANTS & STANDARD GUITAR TUNING
// ==========================================
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Base MIDI numbers for Standard Guitar Tuning (E2, A2, D3, G3, B3, E4)
const STANDARD_STRINGS = [
    { stringNum: 6, name: 'E2', note: 'E', octave: 2, midi: 40, label: '6th (Low E)', side: 'left', pos: 0 },
    { stringNum: 5, name: 'A2', note: 'A', octave: 2, midi: 45, label: '5th (A)', side: 'left', pos: 1 },
    { stringNum: 4, name: 'D3', note: 'D', octave: 3, midi: 50, label: '4th (D)', side: 'left', pos: 2 },
    { stringNum: 3, name: 'G3', note: 'G', octave: 3, midi: 55, label: '3rd (G)', side: 'right', pos: 2 },
    { stringNum: 2, name: 'B3', note: 'B', octave: 3, midi: 59, label: '2nd (B)', side: 'right', pos: 1 },
    { stringNum: 1, name: 'E4', note: 'E', octave: 4, midi: 64, label: '1st (High E)', side: 'right', pos: 0 },
];

// Calculate exact frequency in Hz from MIDI note and A4 calibration
const midiToFreq = (midi, a4 = 440) => {
    return a4 * Math.pow(2, (midi - 69) / 12);
};

// Calculate cents difference between detected frequency and target frequency
const getCentsDiff = (freq, targetFreq) => {
    return 1200 * Math.log2(freq / targetFreq);
};

// ==========================================
// MCLEOD PITCH METHOD (NSDF) + PARABOLIC INTERPOLATION
// ==========================================
/**
 * High-precision time-domain pitch detection using Normalized Square Difference Function (NSDF).
 * Specifically tuned for fundamental guitar frequencies (60 Hz to 1000 Hz) with parabolic peak interpolation.
 */
function detectPitchNSDF(buffer, sampleRate, rmsThreshold = 0.012) {
    const size = buffer.length;

    // 1. Calculate Root Mean Square (RMS) for Noise Gate
    let rms = 0;
    for (let i = 0; i < size; i++) {
        rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / size);

    if (rms < rmsThreshold) {
        return { freq: -1, clarity: 0, rms };
    }

    // 2. Restrict tau search range to valid guitar pitch range (55 Hz to 1100 Hz)
    // This boosts speed and prevents ultra-low sub-bass rumble or ultrasonic noise artifacts
    const minFreq = 55;   // Below B1/E2
    const maxFreq = 1100; // Well above high E4 & fret harmonics
    const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
    const maxTau = Math.min(Math.floor(size / 2), Math.ceil(sampleRate / minFreq));

    const nsdf = new Float32Array(maxTau + 1);

    // Compute NSDF for tau in [minTau, maxTau]
    // Using a window length W = size - maxTau for consistent normalization
    const W = size - maxTau;
    for (let tau = minTau; tau <= maxTau; tau++) {
        let acf = 0;
        let m = 0;
        for (let i = 0; i < W; i++) {
            const x1 = buffer[i];
            const x2 = buffer[i + tau];
            acf += x1 * x2;
            m += x1 * x1 + x2 * x2;
        }
        nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
    }

    // 3. Find the first positive-going zero crossing (or start from minTau if already dipped)
    let startTau = minTau;
    while (startTau < maxTau && nsdf[startTau] > 0) {
        startTau++;
    }
    while (startTau < maxTau && nsdf[startTau] <= 0) {
        startTau++;
    }

    if (startTau >= maxTau) {
        return { freq: -1, clarity: 0, rms };
    }

    // 4. Collect all local maxima in each positive region after the first zero-crossing
    const maxima = [];
    let currentMaxTau = -1;
    let currentMaxVal = -Infinity;
    let inPositiveRegion = false;

    for (let tau = startTau; tau < maxTau; tau++) {
        if (nsdf[tau] > 0) {
            inPositiveRegion = true;
            if (nsdf[tau] > currentMaxVal) {
                currentMaxVal = nsdf[tau];
                currentMaxTau = tau;
            }
        } else if (inPositiveRegion) {
            if (currentMaxTau !== -1) {
                maxima.push({ tau: currentMaxTau, val: currentMaxVal });
            }
            inPositiveRegion = false;
            currentMaxTau = -1;
            currentMaxVal = -Infinity;
        }
    }
    if (inPositiveRegion && currentMaxTau !== -1) {
        maxima.push({ tau: currentMaxTau, val: currentMaxVal });
    }

    if (maxima.length === 0) {
        return { freq: -1, clarity: 0, rms };
    }

    // 5. Find global maximum peak among all regions
    let globalMaxVal = 0;
    for (let i = 0; i < maxima.length; i++) {
        if (maxima[i].val > globalMaxVal) {
            globalMaxVal = maxima[i].val;
        }
    }

    // Require minimum clarity for reliable musical pitch detection
    if (globalMaxVal < 0.55) {
        return { freq: -1, clarity: globalMaxVal, rms };
    }

    // McLeod's k-threshold (0.88 of global max) selects the FIRST major peak,
    // preventing octave/sub-harmonic jumping common on wound guitar strings (E2, A2, D3)
    const threshold = 0.88 * globalMaxVal;
    let chosenPeak = maxima[0];
    for (let i = 0; i < maxima.length; i++) {
        if (maxima[i].val >= threshold) {
            chosenPeak = maxima[i];
            break;
        }
    }

    const bestTau = chosenPeak.tau;

    // 6. Parabolic Interpolation for sub-sample accuracy
    let refinedTau = bestTau;
    if (bestTau > minTau && bestTau < maxTau) {
        const y1 = nsdf[bestTau - 1];
        const y2 = nsdf[bestTau];
        const y3 = nsdf[bestTau + 1];
        const denom = y1 - 2 * y2 + y3;
        if (Math.abs(denom) > 1e-9) {
            const delta = (0.5 * (y1 - y3)) / denom;
            if (Math.abs(delta) < 1) {
                refinedTau = bestTau + delta;
            }
        }
    }

    const frequency = sampleRate / refinedTau;
    return {
        freq: frequency,
        clarity: chosenPeak.val,
        rms
    };
}

// ==========================================
// MAIN COMPONENT
// ==========================================
export default function App() {
    // --- App Configuration State ---
    const [isListening, setIsListening] = useState(false);
    const [micError, setMicError] = useState(null);
    const [tuningMode, setTuningMode] = useState('AUTO'); // 'AUTO' | 'MANUAL' | 'CHROMATIC'
    const [lockedStringNum, setLockedStringNum] = useState(6); // 6 = E2 default when locked
    const [a4Calibration, setA4Calibration] = useState(440);
    const [noiseGateRms, setNoiseGateRms] = useState(0.012);
    const [showSettings, setShowSettings] = useState(false);
    const [showInfo, setShowInfo] = useState(false);

    // --- Real-Time Pitch Detection State ---
    const [detectedFreq, setDetectedFreq] = useState(null);
    const [signalClarity, setSignalClarity] = useState(0);
    const [signalRms, setSignalRms] = useState(0);
    const [activeStringNum, setActiveStringNum] = useState(6);
    const [chromaticNote, setChromaticNote] = useState({ name: 'E2', note: 'E', octave: 2, midi: 40, targetFreq: 82.41 });
    const [centsOffset, setCentsOffset] = useState(0);
    const [inTuneStreak, setInTuneStreak] = useState(0);
    const [tunedStrings, setTunedStrings] = useState({}); // { 6: true, 5: true, ... }

    // --- Reference Tone Synth State ---
    const [playingToneString, setPlayingToneString] = useState(null); // stringNum or null
    const [sustainReference, setSustainReference] = useState(false);

    // --- Web Audio & Animation Refs ---
    const audioCtxRef = useRef(null);
    const analyserRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const rafIdRef = useRef(null);
    const timeDomainBufferRef = useRef(null);

    // Smoothing & Tracking Refs
    const freqHistoryRef = useRef([]);
    const smoothedFreqRef = useRef(null);
    const smoothedCentsRef = useRef(0);
    const lastValidTimeRef = useRef(0);
    const inTuneTimerRef = useRef(0);
    const strobePhaseRef = useRef(0);
    const strobeCanvasRef = useRef(null);

    // Reference Tone Oscillator Refs
    const toneAudioCtxRef = useRef(null);
    const activeToneNodesRef = useRef(null);

    // Compute dynamic frequencies for the 6 standard strings based on current A4 calibration
    const calibratedStrings = useMemo(() => {
        return STANDARD_STRINGS.map((str) => ({
            ...str,
            targetFreq: midiToFreq(str.midi, a4Calibration),
        }));
    }, [a4Calibration]);

    // ==========================================
    // REFERENCE TONE GENERATOR (GUITAR SYNTH)
    // ==========================================
    const stopReferenceTone = useCallback(() => {
        if (activeToneNodesRef.current) {
            const { osc1, osc2, osc3, masterGain, intervalId } = activeToneNodesRef.current;
            if (intervalId) clearInterval(intervalId);
            try {
                const ctx = toneAudioCtxRef.current;
                if (ctx) {
                    masterGain.gain.cancelScheduledValues(ctx.currentTime);
                    masterGain.gain.setValueAtTime(masterGain.gain.value, ctx.currentTime);
                    masterGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
                }
                setTimeout(() => {
                    try {
                        osc1.stop();
                        osc2.stop();
                        osc3.stop();
                    } catch (e) {
                        // Ignore already stopped oscillators
                    }
                }, 90);
            } catch (e) {
                // Ignore cleanup errors
            }
            activeToneNodesRef.current = null;
        }
        setPlayingToneString(null);
    }, []);

    const triggerGuitarPluck = useCallback((ctx, freq, destination, duration = 3.2) => {
        const now = ctx.currentTime;

        // Master envelope for the pluck
        const pluckGain = ctx.createGain();
        pluckGain.gain.setValueAtTime(0.001, now);
        pluckGain.gain.linearRampToValueAtTime(0.35, now + 0.015);
        pluckGain.gain.exponentialRampToValueAtTime(0.12, now + 0.35);
        pluckGain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

        // Warm low-pass filter that mellows out after the initial string attack
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(freq * 7, now);
        filter.frequency.exponentialRampToValueAtTime(freq * 2.2, now + 0.6);

        // Fundamental + 2nd harmonic + 3rd harmonic for realistic acoustic/electric guitar timbre
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const osc3 = ctx.createOscillator();

        osc1.type = 'triangle';
        osc2.type = 'sawtooth';
        osc3.type = 'sine';

        osc1.frequency.setValueAtTime(freq, now);
        osc2.frequency.setValueAtTime(freq * 2, now);
        osc3.frequency.setValueAtTime(freq * 3, now);

        const g1 = ctx.createGain();
        const g2 = ctx.createGain();
        const g3 = ctx.createGain();
        g1.gain.value = 0.7;
        g2.gain.value = 0.22;
        g3.gain.value = 0.08;

        osc1.connect(g1);
        osc2.connect(g2);
        osc3.connect(g3);

        g1.connect(filter);
        g2.connect(filter);
        g3.connect(filter);
        filter.connect(pluckGain);
        pluckGain.connect(destination);

        osc1.start(now);
        osc2.start(now);
        osc3.start(now);

        osc1.stop(now + duration);
        osc2.stop(now + duration);
        osc3.stop(now + duration);

        return { osc1, osc2, osc3, masterGain: pluckGain };
    }, []);

    const playReferenceString = useCallback(
        (stringObj) => {
            // If tapping the currently playing string, toggle it off
            if (playingToneString === stringObj.stringNum) {
                stopReferenceTone();
                return;
            }

            stopReferenceTone();

            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!toneAudioCtxRef.current) {
                toneAudioCtxRef.current = new AudioContextClass();
            }
            const ctx = toneAudioCtxRef.current;
            if (ctx.state === 'suspended') {
                ctx.resume();
            }

            setPlayingToneString(stringObj.stringNum);

            // Pluck immediately
            const nodes = triggerGuitarPluck(ctx, stringObj.targetFreq, ctx.destination, 3.0);

            // If sustain loop is active, re-pluck every 2.4 seconds
            let intervalId = null;
            if (sustainReference) {
                intervalId = setInterval(() => {
                    if (toneAudioCtxRef.current) {
                        triggerGuitarPluck(toneAudioCtxRef.current, stringObj.targetFreq, toneAudioCtxRef.current.destination, 2.6);
                    }
                }, 2400);
            } else {
                // Automatically clear playing state when single pluck finishes
                intervalId = setTimeout(() => {
                    setPlayingToneString((prev) => (prev === stringObj.stringNum ? null : prev));
                }, 2800);
            }

            activeToneNodesRef.current = { ...nodes, intervalId };
        },
        [playingToneString, stopReferenceTone, sustainReference, triggerGuitarPluck]
    );

    // ==========================================
    // MICROPHONE & PITCH DETECTION ENGINE
    // ==========================================
    const stopListening = useCallback(() => {
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
        }
        if (audioCtxRef.current) {
            audioCtxRef.current.close().catch(() => { });
            audioCtxRef.current = null;
        }
        setIsListening(false);
        setDetectedFreq(null);
        setSignalClarity(0);
        setSignalRms(0);
        setCentsOffset(0);
        smoothedFreqRef.current = null;
        freqHistoryRef.current = [];
    }, []);

    const startListening = async () => {
        setMicError(null);
        try {
            // Request raw musical audio stream without browser voice filters
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                    channelCount: 1,
                },
            });

            mediaStreamRef.current = stream;
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioContextClass();
            audioCtxRef.current = audioCtx;

            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }

            const source = audioCtx.createMediaStreamSource(stream);

            // Gentle high-pass at 50Hz to remove handling thumps/AC hum without affecting E2 (82.41Hz)
            const highpass = audioCtx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.value = 50;

            // High-resolution AnalyserNode with 4096 samples for accurate low-E2 period detection
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 4096;
            analyser.smoothingTimeConstant = 0;

            source.connect(highpass);
            highpass.connect(analyser);

            analyserRef.current = analyser;
            timeDomainBufferRef.current = new Float32Array(analyser.fftSize);

            setIsListening(true);
        } catch (err) {
            console.error('Microphone access error:', err);
            setMicError(
                err.name === 'NotAllowedError'
                    ? 'Microphone permission was denied. Please allow microphone access in your browser to tune your guitar.'
                    : 'Could not access microphone. Please check your audio input device.'
            );
            setIsListening(false);
        }
    };

    // Main real-time analysis & Strobe canvas loop
    useEffect(() => {
        if (!isListening) return;

        let animationFrameId;

        const updatePitch = (timestamp) => {
            const analyser = analyserRef.current;
            const audioCtx = audioCtxRef.current;
            const buffer = timeDomainBufferRef.current;

            if (analyser && audioCtx && buffer) {
                analyser.getFloatTimeDomainData(buffer);

                const { freq, clarity, rms } = detectPitchNSDF(
                    buffer,
                    audioCtx.sampleRate,
                    noiseGateRms
                );

                setSignalRms(Math.min(1, rms * 12));

                if (freq !== -1 && clarity >= 0.58) {
                    lastValidTimeRef.current = timestamp;

                    // Median filter of last 5 frames to reject sudden harmonic spikes
                    const history = freqHistoryRef.current;
                    history.push(freq);
                    if (history.length > 5) history.shift();

                    const sorted = [...history].sort((a, b) => a - b);
                    const medianFreq = sorted[Math.floor(sorted.length / 2)];

                    // Exponential moving average (EMA) smoothing
                    // If the jump is large (> 8%), snap quickly (new string plucked); otherwise smooth gently
                    if (
                        smoothedFreqRef.current === null ||
                        Math.abs(medianFreq - smoothedFreqRef.current) / smoothedFreqRef.current > 0.08
                    ) {
                        smoothedFreqRef.current = medianFreq;
                    } else {
                        smoothedFreqRef.current =
                            smoothedFreqRef.current * 0.72 + medianFreq * 0.28;
                    }

                    const currentFreq = smoothedFreqRef.current;
                    setDetectedFreq(currentFreq);
                    setSignalClarity(clarity);

                    // Determine Target Note & Target Frequency based on mode
                    let targetFreq = 82.41;
                    let matchedStringNum = lockedStringNum;

                    // Also compute exact Chromatic Note for full readout
                    const rawMidi = Math.round(12 * Math.log2(currentFreq / a4Calibration) + 69);
                    const clampedMidi = Math.max(24, Math.min(108, rawMidi));
                    const noteIndex = ((clampedMidi % 12) + 12) % 12;
                    const noteLetter = NOTE_NAMES[noteIndex];
                    const noteOctave = Math.floor(clampedMidi / 12) - 1;
                    const chromaticTargetFreq = midiToFreq(clampedMidi, a4Calibration);

                    setChromaticNote({
                        name: `${noteLetter}${noteOctave}`,
                        note: noteLetter,
                        octave: noteOctave,
                        midi: clampedMidi,
                        targetFreq: chromaticTargetFreq,
                    });

                    if (tuningMode === 'MANUAL') {
                        const lockedStr =
                            calibratedStrings.find((s) => s.stringNum === lockedStringNum) ||
                            calibratedStrings[0];
                        targetFreq = lockedStr.targetFreq;
                        matchedStringNum = lockedStr.stringNum;
                    } else if (tuningMode === 'AUTO') {
                        // Find closest of the 6 standard guitar strings using log-frequency (cents) distance
                        let closestStr = calibratedStrings[0];
                        let minAbsCents = Infinity;
                        for (const s of calibratedStrings) {
                            const cDiff = Math.abs(getCentsDiff(currentFreq, s.targetFreq));
                            if (cDiff < minAbsCents) {
                                minAbsCents = cDiff;
                                closestStr = s;
                            }
                        }
                        targetFreq = closestStr.targetFreq;
                        matchedStringNum = closestStr.stringNum;
                        setActiveStringNum(matchedStringNum);
                    } else {
                        // CHROMATIC mode
                        targetFreq = chromaticTargetFreq;
                    }

                    // Calculate Cents Deviation (-50 to +50 clamped for gauge, raw kept for readout)
                    const rawCents = getCentsDiff(currentFreq, targetFreq);
                    smoothedCentsRef.current =
                        smoothedCentsRef.current * 0.68 + rawCents * 0.32;
                    setCentsOffset(smoothedCentsRef.current);

                    // Check if In-Tune (within ±2.0 cents) to mark string as tuned after brief hold
                    if (Math.abs(smoothedCentsRef.current) <= 2.0) {
                        inTuneTimerRef.current += 1;
                        setInTuneStreak(inTuneTimerRef.current);
                        if (inTuneTimerRef.current >= 18 && tuningMode !== 'CHROMATIC') {
                            setTunedStrings((prev) =>
                                prev[matchedStringNum] ? prev : { ...prev, [matchedStringNum]: true }
                            );
                        }
                    } else {
                        inTuneTimerRef.current = Math.max(0, inTuneTimerRef.current - 2);
                        setInTuneStreak(inTuneTimerRef.current);
                    }
                } else {
                    // Hold last reading briefly (650ms) while string sustains out, then decay to idle
                    if (timestamp - lastValidTimeRef.current > 650) {
                        setDetectedFreq(null);
                        setSignalClarity(0);
                        smoothedFreqRef.current = null;
                        freqHistoryRef.current = [];
                        inTuneTimerRef.current = 0;
                        setInTuneStreak(0);
                    }
                }
            }

            // Render Strobe Visualizer Canvas
            const canvas = strobeCanvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                const width = canvas.width;
                const height = canvas.height;
                ctx.clearRect(0, 0, width, height);

                const activeSignal = smoothedFreqRef.current !== null;
                const cents = smoothedCentsRef.current;

                // Advance strobe phase proportional to cents error (stops moving when in tune!)
                if (activeSignal) {
                    const speed = Math.max(-15, Math.min(15, cents * 0.18));
                    strobePhaseRef.current = (strobePhaseRef.current + speed) % 48;
                }

                const barWidth = 24;
                const totalPitch = barWidth * 2;
                const isInTune = activeSignal && Math.abs(cents) <= 2.0;
                const isClose = activeSignal && Math.abs(cents) <= 10.0;

                const strokeColor = !activeSignal
                    ? 'rgba(148, 163, 184, 0.12)'
                    : isInTune
                        ? 'rgba(16, 185, 129, 0.65)'
                        : isClose
                            ? 'rgba(245, 158, 11, 0.55)'
                            : 'rgba(239, 68, 68, 0.55)';

                ctx.fillStyle = strokeColor;
                for (let x = -totalPitch; x < width + totalPitch; x += totalPitch) {
                    const drawX = x + strobePhaseRef.current;
                    ctx.beginPath();
                    ctx.roundRect(drawX, 4, barWidth, height - 8, 4);
                    ctx.fill();
                }
            }

            animationFrameId = requestAnimationFrame(updatePitch);
        };

        animationFrameId = requestAnimationFrame(updatePitch);
        rafIdRef.current = animationFrameId;

        return () => {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        };
    }, [isListening, noiseGateRms, tuningMode, lockedStringNum, calibratedStrings, a4Calibration]);

    // Clean up audio on unmount
    useEffect(() => {
        return () => {
            stopListening();
            stopReferenceTone();
        };
    }, [stopListening, stopReferenceTone]);

    // ==========================================
    // DERIVED UI TARGETS & VISUAL STATUS
    // ==========================================
    const currentTargetString = useMemo(() => {
        const targetNum = tuningMode === 'MANUAL' ? lockedStringNum : activeStringNum;
        return (
            calibratedStrings.find((s) => s.stringNum === targetNum) || calibratedStrings[0]
        );
    }, [tuningMode, lockedStringNum, activeStringNum, calibratedStrings]);

    const activeTarget = useMemo(() => {
        if (tuningMode === 'CHROMATIC') {
            return {
                name: chromaticNote.name,
                note: chromaticNote.note,
                octave: chromaticNote.octave,
                targetFreq: chromaticNote.targetFreq,
                label: 'Chromatic Target',
            };
        }
        return currentTargetString;
    }, [tuningMode, chromaticNote, currentTargetString]);

    const hasSignal = detectedFreq !== null;
    const clampedCents = Math.max(-50, Math.min(50, centsOffset));
    const absCents = Math.abs(centsOffset);

    // Determine tuning precision status
    const tuningStatus = useMemo(() => {
        if (!hasSignal) {
            return {
                state: 'IDLE',
                label: isListening ? 'Pluck a string...' : 'Tap Mic to Start Tuning',
                subLabel: isListening ? 'Listening for guitar pitch' : 'High-precision McLeod NSDF engine ready',
                color: 'text-slate-400',
                badgeBg: 'bg-slate-800/80 border-slate-700 text-slate-300',
                glow: 'shadow-none',
                hex: '#64748b',
            };
        }
        if (absCents <= 2.0) {
            return {
                state: 'IN_TUNE',
                label: 'PERFECT • IN TUNE',
                subLabel: 'Hold steady to lock string',
                color: 'text-emerald-400',
                badgeBg: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300',
                glow: 'shadow-[0_0_35px_rgba(16,185,129,0.35)]',
                hex: '#10b981',
            };
        }
        if (absCents <= 10.0) {
            return {
                state: centsOffset < 0 ? 'SLIGHTLY_FLAT' : 'SLIGHTLY_SHARP',
                label: centsOffset < 0 ? 'Slightly Flat • Tune Up ↑' : 'Slightly Sharp • Tune Down ↓',
                subLabel: `${centsOffset > 0 ? '+' : ''}${centsOffset.toFixed(1)} cents`,
                color: 'text-amber-400',
                badgeBg: 'bg-amber-500/20 border-amber-500/50 text-amber-300',
                glow: 'shadow-[0_0_25px_rgba(245,158,11,0.2)]',
                hex: '#f59e0b',
            };
        }
        return {
            state: centsOffset < 0 ? 'FAR_FLAT' : 'FAR_SHARP',
            label: centsOffset < 0 ? 'Too Flat • Tune Up ↑↑' : 'Too Sharp • Tune Down ↓↓',
            subLabel: `${centsOffset > 0 ? '+' : ''}${centsOffset.toFixed(1)} cents deviation`,
            color: 'text-rose-400',
            badgeBg: 'bg-rose-500/20 border-rose-500/50 text-rose-300',
            glow: 'shadow-[0_0_25px_rgba(244,63,94,0.25)]',
            hex: '#f43f5e',
        };
    }, [hasSignal, isListening, absCents, centsOffset]);

    // Select a string on the headstock/pegbar
    const handleSelectString = (stringObj) => {
        setLockedStringNum(stringObj.stringNum);
        setActiveStringNum(stringObj.stringNum);
        setTuningMode('MANUAL');
    };

    // Needle angle calculation (-50 cents = -75 deg, +50 cents = +75 deg)
    const needleAngle = hasSignal ? (clampedCents / 50) * 75 : 0;

    const tunedCount = Object.keys(tunedStrings).length;

    return (
        <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col items-center justify-start sm:justify-center sm:py-6 select-none font-sans overflow-x-hidden">
            {/* ANDROID MOBILE VIEWPORT CONTAINER */}
            <div className="w-full max-w-[440px] min-h-screen sm:min-h-[840px] sm:max-h-[900px] bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 sm:rounded-[42px] sm:border-[6px] sm:border-slate-800 sm:shadow-[0_25px_70px_rgba(0,0,0,0.85)] flex flex-col justify-between relative overflow-hidden">

                {/* ANDROID STATUS BAR & TOP APP BAR */}
                <header className="px-5 pt-4 pb-3 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 z-20">
                    {/* Android Simulated Status Bar */}
                    <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 mb-3 px-1">
                        <span className="tracking-wider font-mono">9:41</span>
                        <div className="w-16 h-1.5 bg-slate-800 rounded-full mx-auto" />
                        <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1 text-emerald-400">
                                <span className={`w-1.5 h-1.5 rounded-full ${isListening ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`} />
                                {isListening ? 'MIC ON' : 'IDLE'}
                            </span>
                            <span>A4={a4Calibration}Hz</span>
                        </div>
                    </div>

                    {/* App Title & Quick Actions */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-950/60">
                                <Activity className="w-5 h-5 text-slate-950 stroke-[2.5]" />
                            </div>
                            <div>
                                <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                                    FretPulse <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">PRO</span>
                                </h1>
                                <p className="text-[11px] text-slate-400">Standard Guitar Tuner • E A D G B E</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => setShowInfo(true)}
                                className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/60 transition active:scale-95"
                                title="Tuning Guide & Specs"
                            >
                                <Info className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setShowSettings(true)}
                                className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/60 transition active:scale-95 relative"
                                title="Calibration & Audio Settings"
                            >
                                <Settings className="w-4 h-4" />
                                {a4Calibration !== 440 && (
                                    <span className="w-2 h-2 rounded-full bg-amber-400 absolute top-1.5 right-1.5" />
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Mode Selector Segmented Pill Bar */}
                    <div className="grid grid-cols-3 gap-1 p-1 mt-3 bg-slate-950/90 rounded-2xl border border-slate-800/80 text-xs font-semibold">
                        <button
                            onClick={() => setTuningMode('AUTO')}
                            className={`py-1.5 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all ${tuningMode === 'AUTO'
                                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-950/50'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            <Sparkles className="w-3.5 h-3.5" />
                            Auto String
                        </button>
                        <button
                            onClick={() => setTuningMode('MANUAL')}
                            className={`py-1.5 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all ${tuningMode === 'MANUAL'
                                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950/50'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            <Lock className="w-3.5 h-3.5" />
                            String Lock
                        </button>
                        <button
                            onClick={() => setTuningMode('CHROMATIC')}
                            className={`py-1.5 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all ${tuningMode === 'CHROMATIC'
                                    ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-950/50'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            <Radio className="w-3.5 h-3.5" />
                            Chromatic
                        </button>
                    </div>
                </header>

                {/* MICROPHONE ERROR BANNER */}
                {micError && (
                    <div className="mx-4 mt-3 p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2.5">
                        <MicOff className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-semibold text-rose-300">Microphone Access Needed</p>
                            <p className="text-rose-200/80 mt-0.5 leading-relaxed">{micError}</p>
                        </div>
                    </div>
                )}

                {/* MAIN PRECISION GAUGE & STROBE SECTION */}
                <main className="flex-1 flex flex-col items-center justify-between px-4 py-2 relative">
                    {/* Strobe Bar + Cents Scale Header */}
                    <div className="w-full">
                        <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 px-2 mb-1">
                            <span className={hasSignal && centsOffset < -2 ? 'text-rose-400 font-bold' : ''}>-50c FLAT ♭</span>
                            <span className={hasSignal && absCents <= 2 ? 'text-emerald-400 font-bold' : ''}>0c CENTER</span>
                            <span className={hasSignal && centsOffset > 2 ? 'text-rose-400 font-bold' : ''}>♯ SHARP +50c</span>
                        </div>

                        {/* Strobe Drift Canvas */}
                        <div className="w-full h-5 bg-slate-950 rounded-xl border border-slate-800/90 overflow-hidden relative shadow-inner">
                            <canvas
                                ref={strobeCanvasRef}
                                width={380}
                                height={20}
                                className="w-full h-full block"
                            />
                            {/* Center Lock Hairline */}
                            <div className="w-0.5 h-full bg-emerald-400/80 absolute left-1/2 -translate-x-1/2 top-0 shadow-[0_0_8px_#10b981]" />
                        </div>
                    </div>

                    {/* PRECISION ARC NEEDLE GAUGE */}
                    <div className="relative w-full flex flex-col items-center my-1">
                        <svg
                            viewBox="0 0 320 175"
                            className="w-full max-w-[340px] overflow-visible drop-shadow-lg"
                        >
                            <defs>
                                <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="#f43f5e" />
                                    <stop offset="35%" stopColor="#f59e0b" />
                                    <stop offset="47%" stopColor="#10b981" />
                                    <stop offset="53%" stopColor="#10b981" />
                                    <stop offset="65%" stopColor="#f59e0b" />
                                    <stop offset="100%" stopColor="#f43f5e" />
                                </linearGradient>
                                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                </filter>
                            </defs>

                            {/* Outer Track Background */}
                            <path
                                d="M 28 155 A 132 132 0 0 1 292 155"
                                fill="none"
                                stroke="#1e293b"
                                strokeWidth="12"
                                strokeLinecap="round"
                            />

                            {/* Color-Coded Precision Scale Arc */}
                            <path
                                d="M 28 155 A 132 132 0 0 1 292 155"
                                fill="none"
                                stroke="url(#arcGrad)"
                                strokeWidth="6"
                                strokeLinecap="round"
                                strokeDasharray="3 5"
                                opacity={hasSignal ? 0.95 : 0.35}
                            />

                            {/* Fine Tick Marks (-50 to +50 cents mapped across -75deg to +75deg) */}
                            {Array.from({ length: 21 }).map((_, idx) => {
                                const centVal = (idx - 10) * 5; // -50, -45, ... 0 ... +50
                                const deg = (centVal / 50) * 75;
                                const rad = ((deg - 90) * Math.PI) / 180;
                                const isMajor = centVal % 25 === 0;
                                const isZero = centVal === 0;
                                const rInner = isZero ? 106 : isMajor ? 112 : 117;
                                const rOuter = isZero ? 128 : 124;

                                const x1 = 160 + rInner * Math.cos(rad);
                                const y1 = 155 + rInner * Math.sin(rad);
                                const x2 = 160 + rOuter * Math.cos(rad);
                                const y2 = 155 + rOuter * Math.sin(rad);

                                // Label coordinates for major ticks
                                const rLabel = 96;
                                const lx = 160 + rLabel * Math.cos(rad);
                                const ly = 155 + rLabel * Math.sin(rad);

                                return (
                                    <g key={centVal}>
                                        <line
                                            x1={x1}
                                            y1={y1}
                                            x2={x2}
                                            y2={y2}
                                            stroke={
                                                isZero
                                                    ? '#10b981'
                                                    : isMajor
                                                        ? '#94a3b8'
                                                        : '#475569'
                                            }
                                            strokeWidth={isZero ? '3' : isMajor ? '2' : '1.2'}
                                            strokeLinecap="round"
                                        />
                                        {isMajor && (
                                            <text
                                                x={lx}
                                                y={ly + 3}
                                                textAnchor="middle"
                                                className="fill-slate-400 text-[9px] font-mono font-semibold"
                                            >
                                                {centVal > 0 ? `+${centVal}` : centVal}
                                            </text>
                                        )}
                                    </g>
                                );
                            })}

                            {/* Center In-Tune Sweet Spot Notch */}
                            <polygon
                                points="160,20 155,10 165,10"
                                fill={hasSignal && absCents <= 2 ? '#10b981' : '#475569'}
                            />

                            {/* Dynamic Needle Group */}
                            <g
                                transform={`translate(160, 155) rotate(${needleAngle})`}
                                style={{
                                    transition: hasSignal
                                        ? 'transform 65ms cubic-bezier(0.22, 1, 0.36, 1)'
                                        : 'transform 400ms ease-out',
                                }}
                            >
                                {/* Needle Shadow/Glow */}
                                <line
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="-122"
                                    stroke={tuningStatus.hex}
                                    strokeWidth="4"
                                    strokeLinecap="round"
                                    filter={hasSignal ? 'url(#glow)' : undefined}
                                />
                                {/* Needle Core */}
                                <line
                                    x1="0"
                                    y1="10"
                                    x2="0"
                                    y2="-122"
                                    stroke="#f8fafc"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                />
                                {/* Pivot Cap */}
                                <circle
                                    cx="0"
                                    cy="0"
                                    r="9"
                                    fill="#0f172a"
                                    stroke={tuningStatus.hex}
                                    strokeWidth="3.5"
                                />
                            </g>
                        </svg>

                        {/* CENTRAL DETECTED NOTE BADGE & READOUTS */}
                        <div className="flex flex-col items-center -mt-6 z-10">
                            <div
                                className={`relative w-24 h-24 rounded-3xl flex flex-col items-center justify-center border-2 transition-all duration-200 ${!hasSignal
                                        ? 'bg-slate-900/90 border-slate-800 text-slate-300'
                                        : absCents <= 2
                                            ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300 shadow-[0_0_35px_rgba(16,185,129,0.4)] scale-105'
                                            : absCents <= 10
                                                ? 'bg-amber-950/60 border-amber-400/80 text-amber-200'
                                                : 'bg-rose-950/60 border-rose-500/80 text-rose-200'
                                    }`}
                            >
                                {/* In-tune checkmark corner badge */}
                                {hasSignal && absCents <= 2 && (
                                    <span className="absolute -top-2 -right-2 bg-emerald-500 text-slate-950 rounded-full p-1 shadow-md">
                                        <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                                    </span>
                                )}

                                {/* Lock Indicator when in Manual Mode */}
                                {tuningMode === 'MANUAL' && (
                                    <span className="absolute -top-2 -left-2 bg-amber-500 text-slate-950 rounded-full px-1.5 py-0.5 text-[9px] font-bold flex items-center gap-0.5 shadow">
                                        <Lock className="w-2.5 h-2.5" /> S{lockedStringNum}
                                    </span>
                                )}

                                <div className="flex items-baseline">
                                    <span className="text-4xl font-black tracking-tighter">
                                        {activeTarget.note}
                                    </span>
                                    <span className="text-xl font-bold text-emerald-400 ml-0.5">
                                        {activeTarget.octave}
                                    </span>
                                </div>

                                <span className="text-[10px] font-mono text-slate-400 mt-0.5">
                                    Target {activeTarget.targetFreq.toFixed(1)} Hz
                                </span>
                            </div>

                            {/* Status Feedback Pill */}
                            <div
                                className={`mt-2.5 px-4 py-1 rounded-full border text-xs font-bold tracking-wide flex items-center gap-1.5 transition-all ${tuningStatus.badgeBg}`}
                            >
                                {hasSignal && centsOffset < -2 && <ChevronUp className="w-4 h-4 animate-bounce" />}
                                {hasSignal && centsOffset > 2 && <ChevronDown className="w-4 h-4 animate-bounce" />}
                                <span>{tuningStatus.label}</span>
                            </div>

                            {/* Live Digital Readout Row: Detected Hz | Cents | Clarity */}
                            <div className="grid grid-cols-3 gap-2 w-full max-w-[350px] mt-2.5 bg-slate-900/90 border border-slate-800/90 rounded-2xl p-2 text-center">
                                <div className="flex flex-col">
                                    <span className="text-[10px] uppercase tracking-wider text-slate-400">Detected</span>
                                    <span className="text-sm font-mono font-bold text-white">
                                        {hasSignal ? `${detectedFreq.toFixed(1)} Hz` : '--.- Hz'}
                                    </span>
                                </div>
                                <div className="flex flex-col border-x border-slate-800">
                                    <span className="text-[10px] uppercase tracking-wider text-slate-400">Deviation</span>
                                    <span
                                        className={`text-sm font-mono font-bold ${!hasSignal
                                                ? 'text-slate-500'
                                                : absCents <= 2
                                                    ? 'text-emerald-400'
                                                    : absCents <= 10
                                                        ? 'text-amber-400'
                                                        : 'text-rose-400'
                                            }`}
                                    >
                                        {hasSignal
                                            ? `${centsOffset > 0 ? '+' : ''}${centsOffset.toFixed(1)} c`
                                            : '0.0 c'}
                                    </span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] uppercase tracking-wider text-slate-400">Chromatic</span>
                                    <span className="text-sm font-mono font-bold text-sky-400">
                                        {hasSignal ? chromaticNote.name : '--'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* INTERACTIVE GUITAR HEADSTOCK & 6-STRING SELECTOR */}
                    <div className="w-full mt-2 bg-slate-900/70 border border-slate-800/90 rounded-3xl p-3">
                        <div className="flex items-center justify-between mb-2 px-1">
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-slate-200">
                                    Standard 6-String Headstock
                                </span>
                                {tuningMode === 'MANUAL' && (
                                    <button
                                        onClick={() => setTuningMode('AUTO')}
                                        className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 hover:bg-amber-500/30"
                                    >
                                        <Unlock className="w-2.5 h-2.5" /> Unlock Auto
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="text-[11px] font-mono text-emerald-400">
                                    {tunedCount}/6 Tuned
                                </span>
                                {tunedCount > 0 && (
                                    <button
                                        onClick={() => setTunedStrings({})}
                                        className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                                        title="Reset tuned string badges"
                                    >
                                        <RotateCcw className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Headstock Layout: Left Pegs (6, 5, 4) | Visual Fretboard Nut | Right Pegs (3, 2, 1) */}
                        <div className="grid grid-cols-11 gap-1.5 items-center">
                            {/* Left Side Strings: D3 (4), A2 (5), E2 (6) ordered top-to-bottom like a 3x3 headstock */}
                            <div className="col-span-4 flex flex-col gap-2">
                                {[calibratedStrings[2], calibratedStrings[1], calibratedStrings[0]].map((str) => {
                                    const isTarget =
                                        tuningMode !== 'CHROMATIC' &&
                                        currentTargetString.stringNum === str.stringNum;
                                    const isLocked =
                                        tuningMode === 'MANUAL' && lockedStringNum === str.stringNum;
                                    const isTuned = !!tunedStrings[str.stringNum];
                                    const isPlayingTone = playingToneString === str.stringNum;

                                    return (
                                        <div
                                            key={str.stringNum}
                                            className={`group relative rounded-2xl border p-2 transition-all flex items-center justify-between ${isTarget
                                                    ? 'bg-emerald-500/15 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                                                    : isTuned
                                                        ? 'bg-slate-800/90 border-emerald-500/40'
                                                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                                                }`}
                                        >
                                            <button
                                                onClick={() => handleSelectString(str)}
                                                className="flex items-center gap-2 flex-1 text-left"
                                            >
                                                <span
                                                    className={`w-6 h-6 rounded-xl text-xs font-black flex items-center justify-center ${isTarget
                                                            ? 'bg-emerald-400 text-slate-950'
                                                            : isTuned
                                                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                                                : 'bg-slate-800 text-slate-300'
                                                        }`}
                                                >
                                                    {str.stringNum}
                                                </span>
                                                <div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-sm font-extrabold text-white">
                                                            {str.name}
                                                        </span>
                                                        {isLocked && <Lock className="w-3 h-3 text-amber-400" />}
                                                        {isTuned && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                                                    </div>
                                                    <span className="text-[10px] font-mono text-slate-400 block">
                                                        {str.targetFreq.toFixed(1)}Hz
                                                    </span>
                                                </div>
                                            </button>

                                            {/* Reference Tone Speaker Button */}
                                            <button
                                                onClick={() => playReferenceString(str)}
                                                className={`p-1.5 rounded-xl border transition ${isPlayingTone
                                                        ? 'bg-amber-500 text-slate-950 border-amber-400 animate-pulse'
                                                        : 'bg-slate-800/80 text-slate-400 border-slate-700/60 hover:text-white'
                                                    }`}
                                                title={`Play ${str.name} reference guitar tone`}
                                            >
                                                {isPlayingTone ? (
                                                    <Volume2 className="w-3.5 h-3.5" />
                                                ) : (
                                                    <Volume2 className="w-3.5 h-3.5 opacity-75" />
                                                )}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Center Visual Guitar Headstock & Strings SVG */}
                            <div className="col-span-3 h-full flex items-center justify-center">
                                <svg viewBox="0 0 90 170" className="w-full h-40">
                                    {/* Headstock Silhouette */}
                                    <path
                                        d="M 18 14 Q 45 4 72 14 L 78 130 L 66 148 L 66 168 L 24 168 L 24 148 L 12 130 Z"
                                        fill="#0f172a"
                                        stroke="#334155"
                                        strokeWidth="2"
                                    />
                                    {/* Guitar Nut */}
                                    <rect x="23" y="145" width="44" height="5" rx="2" fill="#e2e8f0" />

                                    {/* Left Tuning Posts (4, 5, 6) */}
                                    {[32, 74, 114].map((cy, i) => (
                                        <circle
                                            key={`l-${i}`}
                                            cx="24"
                                            cy={cy}
                                            r="4.5"
                                            fill="#475569"
                                            stroke="#94a3b8"
                                            strokeWidth="1.5"
                                        />
                                    ))}
                                    {/* Right Tuning Posts (3, 2, 1) */}
                                    {[32, 74, 114].map((cy, i) => (
                                        <circle
                                            key={`r-${i}`}
                                            cx="66"
                                            cy={cy}
                                            r="4.5"
                                            fill="#475569"
                                            stroke="#94a3b8"
                                            strokeWidth="1.5"
                                        />
                                    ))}

                                    {/* 6 Guitar Strings with active highlight */}
                                    {[
                                        { num: 6, xNut: 27, xPost: 24, yPost: 114, width: 2.3 },
                                        { num: 5, xNut: 34, xPost: 24, yPost: 74, width: 1.9 },
                                        { num: 4, xNut: 41, xPost: 24, yPost: 32, width: 1.6 },
                                        { num: 3, xNut: 49, xPost: 66, yPost: 32, width: 1.3 },
                                        { num: 2, xNut: 56, xPost: 66, yPost: 74, width: 1.1 },
                                        { num: 1, xNut: 63, xPost: 66, yPost: 114, width: 0.9 },
                                    ].map((s) => {
                                        const isActive =
                                            tuningMode !== 'CHROMATIC' &&
                                            currentTargetString.stringNum === s.num;
                                        const isPlaying = playingToneString === s.num;
                                        const stroke =
                                            isActive || isPlaying
                                                ? '#10b981'
                                                : tunedStrings[s.num]
                                                    ? '#38bdf8'
                                                    : '#64748b';
                                        return (
                                            <g key={s.num}>
                                                {/* String from nut to tuning post */}
                                                <line
                                                    x1={s.xNut}
                                                    y1="146"
                                                    x2={s.xPost}
                                                    y2={s.yPost}
                                                    stroke={stroke}
                                                    strokeWidth={isActive ? s.width + 0.8 : s.width}
                                                />
                                                {/* String down neck */}
                                                <line
                                                    x1={s.xNut}
                                                    y1="148"
                                                    x2={s.xNut}
                                                    y2="168"
                                                    stroke={stroke}
                                                    strokeWidth={isActive ? s.width + 0.8 : s.width}
                                                />
                                            </g>
                                        );
                                    })}
                                </svg>
                            </div>

                            {/* Right Side Strings: G3 (3), B3 (2), E4 (1) ordered top-to-bottom */}
                            <div className="col-span-4 flex flex-col gap-2">
                                {[calibratedStrings[3], calibratedStrings[4], calibratedStrings[5]].map((str) => {
                                    const isTarget =
                                        tuningMode !== 'CHROMATIC' &&
                                        currentTargetString.stringNum === str.stringNum;
                                    const isLocked =
                                        tuningMode === 'MANUAL' && lockedStringNum === str.stringNum;
                                    const isTuned = !!tunedStrings[str.stringNum];
                                    const isPlayingTone = playingToneString === str.stringNum;

                                    return (
                                        <div
                                            key={str.stringNum}
                                            className={`group relative rounded-2xl border p-2 transition-all flex items-center justify-between ${isTarget
                                                    ? 'bg-emerald-500/15 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                                                    : isTuned
                                                        ? 'bg-slate-800/90 border-emerald-500/40'
                                                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                                                }`}
                                        >
                                            {/* Reference Tone Speaker Button */}
                                            <button
                                                onClick={() => playReferenceString(str)}
                                                className={`p-1.5 rounded-xl border transition ${isPlayingTone
                                                        ? 'bg-amber-500 text-slate-950 border-amber-400 animate-pulse'
                                                        : 'bg-slate-800/80 text-slate-400 border-slate-700/60 hover:text-white'
                                                    }`}
                                                title={`Play ${str.name} reference guitar tone`}
                                            >
                                                <Volume2 className="w-3.5 h-3.5 opacity-75" />
                                            </button>

                                            <button
                                                onClick={() => handleSelectString(str)}
                                                className="flex items-center justify-end gap-2 flex-1 text-right"
                                            >
                                                <div>
                                                    <div className="flex items-center justify-end gap-1">
                                                        {isTuned && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                                                        {isLocked && <Lock className="w-3 h-3 text-amber-400" />}
                                                        <span className="text-sm font-extrabold text-white">
                                                            {str.name}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] font-mono text-slate-400 block">
                                                        {str.targetFreq.toFixed(1)}Hz
                                                    </span>
                                                </div>
                                                <span
                                                    className={`w-6 h-6 rounded-xl text-xs font-black flex items-center justify-center ${isTarget
                                                            ? 'bg-emerald-400 text-slate-950'
                                                            : isTuned
                                                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                                                : 'bg-slate-800 text-slate-300'
                                                        }`}
                                                >
                                                    {str.stringNum}
                                                </span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 px-1">
                            <span>Tap note to lock string • Tap <Volume2 className="w-3 h-3 inline mx-0.5" /> for ear tone</span>
                            <button
                                onClick={() => setSustainReference(!sustainReference)}
                                className={`px-2 py-0.5 rounded-lg font-medium transition ${sustainReference
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                        : 'bg-slate-800 text-slate-400'
                                    }`}
                            >
                                {sustainReference ? 'Loop Tone: ON' : 'Loop Tone: OFF'}
                            </button>
                        </div>
                    </div>
                </main>

                {/* BOTTOM ANDROID CONTROL DOCK (MIC BUTTON + INPUT LEVEL METER) */}
                <footer className="px-5 pt-2 pb-5 bg-slate-900/95 border-t border-slate-800/80 z-20">
                    <div className="flex items-center justify-between gap-3">
                        {/* Input Signal Meter */}
                        <div className="flex-1 bg-slate-950 rounded-2xl p-2.5 border border-slate-800/80">
                            <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                                <span>INPUT SIGNAL</span>
                                <span>{isListening ? `${Math.round(signalClarity * 100)}% CLARITY` : 'OFF'}</span>
                            </div>
                            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-400 transition-all duration-75"
                                    style={{ width: `${isListening ? Math.max(4, signalRms * 100) : 0}%` }}
                                />
                            </div>
                        </div>

                        {/* Primary Start/Stop Microphone FAB */}
                        <button
                            onClick={isListening ? stopListening : startListening}
                            className={`px-5 py-3.5 rounded-2xl font-bold text-sm flex items-center gap-2 shadow-lg transition-all active:scale-95 ${isListening
                                    ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-950/60'
                                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-950/60'
                                }`}
                        >
                            {isListening ? (
                                <>
                                    <MicOff className="w-4 h-4 stroke-[2.5]" />
                                    Stop Mic
                                </>
                            ) : (
                                <>
                                    <Mic className="w-4 h-4 stroke-[2.5]" />
                                    Start Tuner
                                </>
                            )}
                        </button>

                        {/* Stop Reference Tone Quick Button if playing */}
                        {playingToneString !== null && (
                            <button
                                onClick={stopReferenceTone}
                                className="p-3.5 rounded-2xl bg-amber-500 text-slate-950 font-bold shadow-lg active:scale-95"
                                title="Stop Reference Tone"
                            >
                                <VolumeX className="w-4 h-4 stroke-[2.5]" />
                            </button>
                        )}
                    </div>

                    {/* Android Gesture Navigation Pill */}
                    <div className="w-28 h-1 bg-slate-700/80 rounded-full mx-auto mt-4" />
                </footer>

                {/* ==========================================
            SETTINGS DRAWER MODAL (CALIBRATION & NOISE GATE)
           ========================================== */}
                {showSettings && (
                    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-40 flex items-end justify-center">
                        <div className="w-full bg-slate-900 border-t border-slate-800 rounded-t-3xl p-5 shadow-2xl animate-in slide-in-from-bottom">
                            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                                <div className="flex items-center gap-2">
                                    <Sliders className="w-4 h-4 text-emerald-400" />
                                    <h2 className="text-base font-bold text-white">Tuner Calibration & Audio</h2>
                                </div>
                                <button
                                    onClick={() => setShowSettings(false)}
                                    className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="space-y-5 py-4">
                                {/* A4 Reference Pitch Calibration */}
                                <div>
                                    <div className="flex justify-between text-xs mb-1.5">
                                        <span className="text-slate-300 font-semibold">A4 Reference Pitch</span>
                                        <span className="font-mono font-bold text-emerald-400">{a4Calibration} Hz</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setA4Calibration((v) => Math.max(432, v - 1))}
                                            className="px-3 py-1.5 rounded-xl bg-slate-800 text-white font-bold text-sm"
                                        >
                                            -
                                        </button>
                                        <input
                                            type="range"
                                            min="432"
                                            max="448"
                                            step="1"
                                            value={a4Calibration}
                                            onChange={(e) => setA4Calibration(Number(e.target.value))}
                                            className="flex-1 accent-emerald-500"
                                        />
                                        <button
                                            onClick={() => setA4Calibration((v) => Math.min(448, v + 1))}
                                            className="px-3 py-1.5 rounded-xl bg-slate-800 text-white font-bold text-sm"
                                        >
                                            +
                                        </button>
                                    </div>
                                    <div className="flex justify-between mt-2 gap-2">
                                        {[432, 440, 442, 444].map((preset) => (
                                            <button
                                                key={preset}
                                                onClick={() => setA4Calibration(preset)}
                                                className={`flex-1 py-1 rounded-lg text-xs font-mono border ${a4Calibration === preset
                                                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                                                        : 'bg-slate-800/70 border-slate-700 text-slate-400'
                                                    }`}
                                            >
                                                {preset} Hz
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Microphone Noise Gate Sensitivity */}
                                <div>
                                    <div className="flex justify-between text-xs mb-1.5">
                                        <span className="text-slate-300 font-semibold">Room Noise Gate Threshold</span>
                                        <span className="font-mono text-sky-400">
                                            {noiseGateRms <= 0.006
                                                ? 'High Sensitivity (Quiet Room)'
                                                : noiseGateRms <= 0.015
                                                    ? 'Balanced'
                                                    : 'Strict (Noisy Room)'}
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.004"
                                        max="0.035"
                                        step="0.002"
                                        value={noiseGateRms}
                                        onChange={(e) => setNoiseGateRms(Number(e.target.value))}
                                        className="w-full accent-sky-500"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1">
                                        Filters out background chatter or amp hum before locking onto your guitar string.
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => setShowSettings(false)}
                                className="w-full py-3 rounded-2xl bg-emerald-500 text-slate-950 font-bold text-sm shadow-lg"
                            >
                                Save & Return to Tuner
                            </button>
                        </div>
                    </div>
                )}

                {/* ==========================================
            TUNING GUIDE & SPECS MODAL
           ========================================== */}
                {showInfo && (
                    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-40 flex items-end justify-center">
                        <div className="w-full bg-slate-900 border-t border-slate-800 rounded-t-3xl p-5 shadow-2xl">
                            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                                <div className="flex items-center gap-2">
                                    <Info className="w-4 h-4 text-emerald-400" />
                                    <h2 className="text-base font-bold text-white">Standard Guitar Tuning Reference</h2>
                                </div>
                                <button
                                    onClick={() => setShowInfo(false)}
                                    className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="py-3 space-y-3 text-xs text-slate-300">
                                <p className="leading-relaxed text-slate-400">
                                    Uses the <strong className="text-white">McLeod Pitch Method (NSDF)</strong> with parabolic peak interpolation and raw studio audio capture (<code className="text-emerald-400">fftSize: 4096</code>) for ±0.1 Hz accuracy.
                                </p>

                                <div className="bg-slate-950 rounded-2xl p-3 border border-slate-800 space-y-1.5 font-mono text-[11px]">
                                    {calibratedStrings.map((s) => (
                                        <div key={s.stringNum} className="flex justify-between items-center py-0.5 border-b border-slate-900 last:border-0">
                                            <span className="text-slate-400">String {s.stringNum} ({s.label})</span>
                                            <span className="text-emerald-400 font-bold">{s.name} — {s.targetFreq.toFixed(2)} Hz</span>
                                        </div>
                                    ))}
                                </div>

                                <ul className="space-y-1 text-[11px] text-slate-400 list-disc pl-4">
                                    <li><strong className="text-slate-200">Auto String:</strong> Automatically detects which of the 6 strings you plucked.</li>
                                    <li><strong className="text-slate-200">String Lock:</strong> Tap any string card on the headstock to lock the target when restringing a very flat/sharp guitar.</li>
                                    <li><strong className="text-slate-200">Strobe Bar:</strong> Drifts left when flat, right when sharp, and freezes when dead-on in tune.</li>
                                </ul>
                            </div>

                            <button
                                onClick={() => setShowInfo(false)}
                                className="w-full py-3 mt-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm"
                            >
                                Got It
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}