import { useEffect, useRef, useState } from "react";
import jsPDF from "jspdf";

export default function AudioFileEditor({ file, onRemove }) {
    const canvasRef = useRef(null);
    const waveformScrollRef = useRef(null);
    const logBoxRef = useRef(null);
    const audioRef = useRef(null);
    const audioBufferRef = useRef(null);

    const [audioUrl, setAudioUrl] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [fileName, setFileName] = useState("");
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    // Detection constants
    const PIXELS_PER_SECOND = 200;
    const LOUD_CLICK_PEAK_THRESHOLD = 0.8;
    const LOUD_CLICK_DELTA_THRESHOLD = 0.9;
    const LOUD_CLICK_CLIP_THRESHOLD = 0.99;
    const LOUD_CLICK_RMS_MIN = 0.12;
    const LOUD_CLICK_MIN_SECS = 0.005;
    const LOUD_CLICK_WINDOW_MS = 8;
    const STATIC_CLICK_MULTIPLIER = 20.0;
    const STATIC_CLICK_MIN_SECS = 0.06;
    const STATIC_CLICK_AMPLITUDE_MIN = 0.035;
    const STATIC_CLICK_WINDOW_MS = 12;
    const STATIC_CLICK_ZCR_MULTIPLIER = 2.5;
    const BACKGROUND_NOISE_WINDOW_MS = 50;
    const BACKGROUND_NOISE_MIN_SECS = 1.2;
    const BACKGROUND_NOISE_RMS_THRESHOLD = 0.02;
    const BACKGROUND_NOISE_SPEECH_RMS_THRESHOLD = 0.06;

    useEffect(() => {
        setFileName(file.name);
        const url = URL.createObjectURL(file);
        setAudioUrl(url);

        return () => URL.revokeObjectURL(url);
    }, [file]);

    useEffect(() => {
        if (!audioUrl) return;

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const canvasContext = canvas.getContext('2d');

        const appendLogMessage = (message, typeClass = '') => {
            const box = logBoxRef.current;
            if (!box) return;
            const msgEl = document.createElement('div');
            msgEl.className = 'log-entry' + (typeClass ? ` ${typeClass}` : '');
            msgEl.textContent = message;
            box.appendChild(msgEl);
            box.scrollTop = box.scrollHeight;
        };

        const formatTime = (time) => {
            const totalSeconds = Math.floor(time || 0);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };

        const appendLogEntry = (startTime, endTime, reason) => {
            const formatted = `${formatTime(startTime)} to ${formatTime(endTime)} - ${reason}`;
            const typeClass = 'log-' + reason.toLowerCase().replace(/\s+/g, '-');
            appendLogMessage(formatted, typeClass);
        };

        fetch(audioUrl)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
            .then(audioBuffer => {
                audioBufferRef.current = audioBuffer;

                const silentRegions = findSilenceRegions(audioBuffer, 0.01, 1.2);
                audioBufferRef.current.silenceRegions = silentRegions;
                const loudRegions = findLoudRegions(audioBuffer, 0.6, 0.5);
                audioBufferRef.current.loudRegions = loudRegions;
                const clickRegions = findClickRegions(audioBuffer, 0.98, 0.75, 0.01);
                audioBufferRef.current.clickRegions = clickRegions;
                const loudClickRegions = findLoudClickRegions(audioBuffer, LOUD_CLICK_PEAK_THRESHOLD, LOUD_CLICK_DELTA_THRESHOLD, LOUD_CLICK_CLIP_THRESHOLD, LOUD_CLICK_RMS_MIN, LOUD_CLICK_MIN_SECS, LOUD_CLICK_WINDOW_MS);
                audioBufferRef.current.loudClickRegions = loudClickRegions;
                const staticClickRegions = findStaticClickRegions(audioBuffer, STATIC_CLICK_MULTIPLIER, STATIC_CLICK_MIN_SECS, STATIC_CLICK_AMPLITUDE_MIN, STATIC_CLICK_WINDOW_MS, STATIC_CLICK_ZCR_MULTIPLIER);
                const filteredStaticClickRegions = (staticClickRegions || []).filter(sc => {
                    const overlaps = (arr) => (arr || []).some(r => r.startTime < sc.endTime && r.endTime > sc.startTime);
                    return !(overlaps(clickRegions) || overlaps(loudRegions));
                });
                audioBufferRef.current.staticClickRegions = filteredStaticClickRegions;
                const backgroundNoiseRegions = findBackgroundNoiseRegions(audioBuffer, BACKGROUND_NOISE_RMS_THRESHOLD, BACKGROUND_NOISE_MIN_SECS, BACKGROUND_NOISE_WINDOW_MS, BACKGROUND_NOISE_SPEECH_RMS_THRESHOLD);
                audioBufferRef.current.backgroundNoiseRegions = backgroundNoiseRegions;

                if (logBoxRef.current) logBoxRef.current.innerHTML = '';

                if (silentRegions && silentRegions.length > 0) {
                    silentRegions.forEach(region => {
                        appendLogEntry(region.startTime, region.endTime, 'Silence');
                    });
                }

                if (loudRegions && loudRegions.length > 0) {
                    loudRegions.forEach(region => {
                        appendLogEntry(region.startTime, region.endTime, 'Too Loud');
                    });
                }

                if (audioBufferRef.current.clickRegionsFiltered && audioBufferRef.current.clickRegionsFiltered.length > 0) {
                    audioBufferRef.current.clickRegionsFiltered.forEach(region => {
                        appendLogEntry(region.startTime, region.endTime, 'Click');
                    });
                }

                if (loudClickRegions && loudClickRegions.length > 0) {
                    loudClickRegions.forEach(region => {
                        appendLogEntry(region.startTime, region.endTime, 'Loud Click');
                    });
                }

                if (clickRegions && loudClickRegions) {
                    const filteredClicks = clickRegions.filter(c => !loudClickRegions.some(l => c.startTime < l.endTime && c.endTime > l.startTime));
                    audioBufferRef.current.clickRegionsFiltered = filteredClicks;
                }

                if (audioBufferRef.current.staticClickRegions && audioBufferRef.current.staticClickRegions.length > 0) {
                    audioBufferRef.current.staticClickRegions.forEach(region => {
                        appendLogEntry(region.startTime, region.endTime, 'Static Click');
                    });
                }

                if (backgroundNoiseRegions && backgroundNoiseRegions.length > 0) {
                    backgroundNoiseRegions.forEach(region => {
                        appendLogEntry(region.startTime, region.endTime, 'Background Noise');
                    });
                }

                if ((!silentRegions || silentRegions.length === 0) && (!loudRegions || loudRegions.length === 0) && (!clickRegions || clickRegions.length === 0) && (!staticClickRegions || staticClickRegions.length === 0) && (!backgroundNoiseRegions || backgroundNoiseRegions.length === 0)) {
                    appendLogMessage('No warnings detected');
                }

                const MAX_CANVAS_WIDTH = 2400;
                const desiredWidth = Math.max(1200, Math.min(Math.ceil(audioBuffer.duration * PIXELS_PER_SECOND), MAX_CANVAS_WIDTH));
                canvas.width = desiredWidth;
                canvas.height = 300;
                canvas.style.width = `${desiredWidth}px`;
                canvas.style.height = `300px`;
                if (waveformScrollRef.current) waveformScrollRef.current.scrollLeft = 0;
                drawWaveform(audioBuffer, canvas, canvasContext);
            })
            .catch(error => console.error('Error loading audio:', error));

        return () => audioContext.close();
    }, [audioUrl]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleLoadedMetadata = () => {
            setDuration(audio.duration);
        };

        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
        };

        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('ended', handleEnded);

        return () => {
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('ended', handleEnded);
        };
    }, []);

    const drawWaveform = (audioBuffer, canvas, context) => {
        const data = audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / canvas.width);
        const amp = canvas.height / 2;

        // Light purple background (matching EditPage)
        context.fillStyle = '#f4f1ff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Light purple waveform
        context.strokeStyle = '#b4a5d6';
        context.lineWidth = 2;

        context.beginPath();
        context.moveTo(0, amp);

        for (let i = 0; i < canvas.width; i++) {
            let min = 1.0;
            let max = -1.0;

            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }

            context.lineTo(i, (1 + min) * amp);
        }

        for (let i = canvas.width - 1; i >= 0; i--) {
            let max = -1.0;

            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum > max) max = datum;
            }

            context.lineTo(i, (1 + max) * amp);
        }

        context.closePath();
        context.stroke();
        context.fillStyle = 'rgba(180, 165, 214, 0.2)';
        context.fill();

        if (audioBuffer.silenceRegions) {
            context.fillStyle = 'rgba(255, 0, 0, 0.35)';
            audioBuffer.silenceRegions.forEach(region => {
                const startX = (region.startTime / audioBuffer.duration) * canvas.width;
                const endX = (region.endTime / audioBuffer.duration) * canvas.width;
                const w = endX - startX;
                context.fillRect(startX, 0, w, canvas.height);
            });
        }

        if (audioBuffer.loudRegions) {
            context.fillStyle = 'rgba(255, 165, 0, 0.35)';
            audioBuffer.loudRegions.forEach(region => {
                const startX = (region.startTime / audioBuffer.duration) * canvas.width;
                const endX = (region.endTime / audioBuffer.duration) * canvas.width;
                const w = endX - startX;
                context.fillRect(startX, 0, w, canvas.height);
            });
        }

        if (audioBuffer.clickRegionsFiltered) {
            context.fillStyle = 'rgba(0, 0, 0, 0.6)';
            audioBuffer.clickRegionsFiltered.forEach(region => {
                const startX = (region.startTime / audioBuffer.duration) * canvas.width;
                const endX = (region.endTime / audioBuffer.duration) * canvas.width;
                const w = Math.max(2, endX - startX);
                context.fillRect(startX, 0, w, canvas.height);
            });
        }

        if (audioBuffer.loudClickRegions) {
            context.fillStyle = 'rgba(255, 20, 147, 0.65)';
            audioBuffer.loudClickRegions.forEach(region => {
                const startX = (region.startTime / audioBuffer.duration) * canvas.width;
                const endX = (region.endTime / audioBuffer.duration) * canvas.width;
                const w = Math.max(2, endX - startX);
                context.fillRect(startX, 0, w, canvas.height);
            });
        }

        if (audioBuffer.staticClickRegions) {
            context.fillStyle = 'rgba(30, 144, 255, 0.6)';
            audioBuffer.staticClickRegions.forEach(region => {
                const startX = (region.startTime / audioBuffer.duration) * canvas.width;
                const endX = (region.endTime / audioBuffer.duration) * canvas.width;
                const w = Math.max(2, endX - startX);
                context.fillRect(startX, 0, w, canvas.height);
            });
        }

        if (audioBuffer.backgroundNoiseRegions) {
            context.fillStyle = 'rgba(0, 255, 255, 0.25)';
            audioBuffer.backgroundNoiseRegions.forEach(region => {
                const startX = (region.startTime / audioBuffer.duration) * canvas.width;
                const endX = (region.endTime / audioBuffer.duration) * canvas.width;
                const w = Math.max(2, endX - startX);
                context.fillRect(startX, 0, w, canvas.height);
            });
        }
    };

    // All the detection functions...
    const findSilenceRegions = (audioBuffer, silenceThreshold = 0.01, minSilenceSecs = 1.2) => {
        const data = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const minSamples = Math.floor(minSilenceSecs * sampleRate);
        let silenceRegions = [];
        let idx = 0;

        while (idx < data.length) {
            if (Math.abs(data[idx]) < silenceThreshold) {
                const start = idx;
                while (idx < data.length && Math.abs(data[idx]) < silenceThreshold) {
                    idx++;
                }
                const duration = idx - start;
                if (duration >= minSamples) {
                    silenceRegions.push({
                        startTime: start / sampleRate,
                        endTime: idx / sampleRate,
                    });
                }
            }
            idx++;
        }

        return silenceRegions;
    };

    const findBackgroundNoiseRegions = (audioBuffer, noiseRmsThreshold = 0.02, minNoiseSecs = 1.2, windowMs = 50, speechRmsThreshold = 0.06) => {
        const data = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const windowSize = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
        const hop = Math.max(1, Math.floor(windowSize / 2));
        const len = data.length;

        const rmsPerWindow = [];
        const starts = [];
        for (let start = 0; start < len; start += hop) {
            let sum = 0;
            const end = Math.min(start + windowSize, len);
            for (let i = start; i < end; i++) {
                const v = data[i];
                sum += v * v;
            }
            const count = end - start;
            const rms = count > 0 ? Math.sqrt(sum / count) : 0;
            rmsPerWindow.push(rms);
            starts.push(start);
        }

        const regions = [];
        let inRegion = false;
        let regionStartIdx = 0;
        const minWindowCount = Math.max(1, Math.ceil((minNoiseSecs * sampleRate) / hop));

        for (let i = 0; i < rmsPerWindow.length; i++) {
            const rms = rmsPerWindow[i];
            const isQuiet = rms < speechRmsThreshold;
            const isNoisy = rms >= noiseRmsThreshold;
            if (isQuiet && isNoisy) {
                if (!inRegion) {
                    inRegion = true;
                    regionStartIdx = i;
                }
            } else {
                if (inRegion) {
                    const winCount = i - regionStartIdx;
                    if (winCount >= minWindowCount) {
                        const startSample = starts[regionStartIdx];
                        const endSample = Math.min(len, starts[i - 1] + windowSize);
                        regions.push({ startTime: startSample / sampleRate, endTime: endSample / sampleRate });
                    }
                    inRegion = false;
                }
            }
        }
        if (inRegion) {
            const winCount = rmsPerWindow.length - regionStartIdx;
            if (winCount >= minWindowCount) {
                const startSample = starts[regionStartIdx];
                const endSample = len - 1;
                regions.push({ startTime: startSample / sampleRate, endTime: endSample / sampleRate });
            }
        }

        return regions;
    };

    const findLoudRegions = (audioBuffer, rmsThreshold = 0.6, minLoudSecs = 0.5) => {
        const data = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const windowSize = Math.floor(0.05 * sampleRate);
        const hop = Math.floor(windowSize / 2);

        let loudRegions = [];
        const minWindows = Math.ceil((minLoudSecs * sampleRate) / hop);

        const makeWindowRMS = (start) => {
            let sum = 0;
            let count = 0;
            for (let i = start; i < Math.min(start + windowSize, data.length); i++) {
                const v = data[i];
                sum += v * v;
                count++;
            }
            if (count === 0) return 0;
            return Math.sqrt(sum / count);
        };

        let currentStart = null;
        let consecutiveWindows = 0;

        for (let start = 0; start < data.length; start += hop) {
            const rms = makeWindowRMS(start);
            if (rms >= rmsThreshold) {
                if (currentStart === null) currentStart = start;
                consecutiveWindows++;
            } else {
                if (currentStart !== null) {
                    if (consecutiveWindows >= minWindows) {
                        const startSample = currentStart;
                        const endSample = start + windowSize;
                        loudRegions.push({
                            startTime: startSample / sampleRate,
                            endTime: Math.min(endSample, data.length) / sampleRate,
                        });
                    }
                    currentStart = null;
                    consecutiveWindows = 0;
                }
            }
        }

        if (currentStart !== null && consecutiveWindows >= minWindows) {
            const startSample = currentStart;
            const endSample = data.length - 1;
            loudRegions.push({ startTime: startSample / sampleRate, endTime: endSample / sampleRate });
        }

        return loudRegions;
    };

    const findClickRegions = (audioBuffer, amplitudeThreshold = 0.98, deltaThreshold = 0.75, minClickSecs = 0.01) => {
        const data = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const len = data.length;
        const maxGapSamples = Math.floor(0.02 * sampleRate);
        const minClickSamples = Math.ceil(minClickSecs * sampleRate);

        let regions = [];
        let inRegion = false;
        let regionStart = 0;
        let lastTrigger = 0;

        for (let i = 1; i < len; i++) {
            const curr = data[i];
            const prev = data[i - 1];
            const absCurr = Math.abs(curr);
            const absDiff = Math.abs(curr - prev);

            const clipping = absCurr >= amplitudeThreshold;
            const abrupt = absDiff >= deltaThreshold;

            if (clipping || abrupt) {
                if (!inRegion) {
                    inRegion = true;
                    regionStart = i - 1;
                }
                lastTrigger = i;
            }

            if (inRegion && (i - lastTrigger) > maxGapSamples) {
                const regionEnd = lastTrigger;
                const durationSamples = regionEnd - regionStart;
                if (durationSamples >= minClickSamples) {
                    regions.push({ startTime: regionStart / sampleRate, endTime: regionEnd / sampleRate });
                }
                inRegion = false;
                regionStart = 0;
                lastTrigger = 0;
            }
        }

        if (inRegion) {
            const regionEnd = len - 1;
            const durationSamples = regionEnd - regionStart;
            if (durationSamples >= minClickSamples) {
                regions.push({ startTime: regionStart / sampleRate, endTime: regionEnd / sampleRate });
            }
        }

        return regions;
    };

    const findLoudClickRegions = (audioBuffer, peakThreshold = 0.8, deltaThreshold = 0.9, clipThreshold = 0.99, localRMSMin = 0.12, minClickSecs = 0.005, windowMs = 8) => {
        const data = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const len = data.length;
        const windowSize = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
        const maxGapSamples = Math.floor(0.02 * sampleRate);
        const minClickSamples = Math.ceil(minClickSecs * sampleRate);

        const regions = [];
        let inRegion = false;
        let regionStart = 0;
        let lastTrigger = 0;

        const localRMSAt = (idx) => {
            const start = Math.max(0, idx - Math.floor(windowSize / 2));
            const end = Math.min(len, start + windowSize);
            let sum = 0;
            let count = 0;
            for (let i = start; i < end; i++) {
                const v = data[i];
                sum += v * v;
                count++;
            }
            if (count === 0) return 0;
            return Math.sqrt(sum / count);
        };

        for (let i = 1; i < len; i++) {
            const curr = data[i];
            const prev = data[i - 1];
            const absCurr = Math.abs(curr);
            const absDiff = Math.abs(curr - prev);

            const isClip = absCurr >= clipThreshold;
            const isPeak = absCurr >= peakThreshold && absDiff >= deltaThreshold;

            if (isClip || isPeak) {
                if (localRMSAt(i) >= localRMSMin) {
                    if (!inRegion) {
                        regionStart = i - 1;
                        inRegion = true;
                    }
                    lastTrigger = i;
                }
            }

            if (inRegion && (i - lastTrigger) > maxGapSamples) {
                const regionEnd = lastTrigger;
                const durationSamples = regionEnd - regionStart;
                if (durationSamples >= minClickSamples) {
                    regions.push({ startTime: regionStart / sampleRate, endTime: regionEnd / sampleRate });
                }
                inRegion = false;
            }
        }

        if (inRegion) {
            const regionEnd = len - 1;
            const durationSamples = regionEnd - regionStart;
            if (durationSamples >= minClickSamples) {
                regions.push({ startTime: regionStart / sampleRate, endTime: regionEnd / sampleRate });
            }
        }

        return regions;
    };

    const findStaticClickRegions = (audioBuffer, multiplier = 8.0, minClickSecs = 0.02, amplitudeMin = 0.01, windowMs = 6, zcrMultiplier = 1.5) => {
        const data = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const len = data.length;

        const windowSize = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
        const hop = Math.max(1, Math.floor(windowSize / 2));
        const numWindows = Math.max(1, Math.ceil(Math.max(0, len - windowSize) / hop) + 1);

        const deriv = new Float32Array(len);
        deriv[0] = 0;
        for (let i = 1; i < len; i++) {
            deriv[i] = Math.abs(data[i] - data[i - 1]);
        }

        const rmsPerWindow = new Float32Array(numWindows);
        let wIdx = 0;
        if (windowSize >= len) {
            let sum = 0;
            for (let j = 0; j < len; j++) {
                const v = deriv[j];
                sum += v * v;
            }
            rmsPerWindow[wIdx++] = Math.sqrt(sum / len);
        } else {
            for (let start = 0; start <= len - windowSize; start += hop) {
                let sum = 0;
                for (let j = start; j < start + windowSize; j++) {
                    const v = deriv[j];
                    sum += v * v;
                }
                rmsPerWindow[wIdx++] = Math.sqrt(sum / windowSize);
            }
        }

        const rmsCopy = Array.from(rmsPerWindow).sort((a, b) => a - b);
        const median = rmsCopy[Math.floor(rmsCopy.length / 2)] || 0;
        const absDeviations = rmsPerWindow.map(v => Math.abs(v - median)).sort((a, b) => a - b);
        const mad = absDeviations[Math.floor(absDeviations.length / 2)] || 0;
        const threshold = Math.max(1e-9, median + multiplier * mad);

        const minWindowCount = Math.max(1, Math.ceil((minClickSecs * sampleRate) / hop));

        const zcrPerWindow = new Float32Array(numWindows);
        wIdx = 0;
        if (windowSize >= len) {
            let zc = 0;
            for (let j = 1; j < len; j++) if ((data[j] > 0) !== (data[j - 1] > 0)) zc++;
            zcrPerWindow[wIdx++] = zc / Math.max(1, len - 1);
        } else {
            for (let start = 0; start <= len - windowSize; start += hop) {
                let zc = 0;
                for (let j = start + 1; j < start + windowSize; j++) if ((data[j] > 0) !== (data[j - 1] > 0)) zc++;
                zcrPerWindow[wIdx++] = zc / Math.max(1, windowSize - 1);
            }
        }
        const zcrCopy = Array.from(zcrPerWindow).sort((a, b) => a - b);
        const medianZcr = zcrCopy[Math.floor(zcrCopy.length / 2)] || 0;

        let regions = [];
        let inRegion = false;
        let winStart = 0;
        for (let i = 0; i < rmsPerWindow.length; i++) {
            const winStartSample = Math.min(len - 1, i * hop);
            const winEndSample = Math.min(len, winStartSample + windowSize);
            let sumAbsAmp = 0;
            for (let s = winStartSample; s < winEndSample; s++) {
                sumAbsAmp += Math.abs(data[s]);
            }
            const meanAbsAmp = (winEndSample > winStartSample) ? (sumAbsAmp / (winEndSample - winStartSample)) : 0;

            const zcrRequirement = zcrPerWindow[i] >= Math.max(0, medianZcr * zcrMultiplier);
            if (rmsPerWindow[i] >= threshold && meanAbsAmp >= amplitudeMin && zcrRequirement) {
                if (!inRegion) {
                    inRegion = true;
                    winStart = i;
                }
            } else {
                if (inRegion) {
                    const winEnd = i - 1;
                    const winCount = winEnd - winStart + 1;
                    if (winCount >= minWindowCount) {
                        const startSample = Math.max(0, winStart * hop);
                        const endSample = Math.min(len - 1, winEnd * hop + windowSize);
                        regions.push({ startTime: startSample / sampleRate, endTime: endSample / sampleRate });
                    }
                    inRegion = false;
                }
            }
        }
        if (inRegion) {
            const winEnd = rmsPerWindow.length - 1;
            const winCount = winEnd - winStart + 1;
            if (winCount >= minWindowCount) {
                const startSample = Math.max(0, winStart * hop);
                const endSample = Math.min(len - 1, winEnd * hop + windowSize);
                regions.push({ startTime: startSample / sampleRate, endTime: endSample / sampleRate });
            }
        }

        return regions;
    };

    const togglePlayPause = () => {
        if (!audioRef.current) return;

        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const handleCanvasClick = (e) => {
        const canvas = canvasRef.current;
        const audio = audioRef.current;
        if (!canvas || !audio || !duration) return;
        const rect = canvas.getBoundingClientRect();
        const scrollContainer = waveformScrollRef.current;
        const xVisible = e.clientX - rect.left;
        const xAbsolute = xVisible + (scrollContainer ? scrollContainer.scrollLeft : 0);
        const progress = xAbsolute / (scrollContainer ? scrollContainer.scrollWidth : rect.width);
        audio.currentTime = progress * duration;
    };

    const formatTime = (time) => {
        const totalSeconds = Math.floor(time || 0);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const downloadLogAsPDF = () => {
        const logBox = logBoxRef.current;
        if (!logBox) return;

        const logEntries = logBox.querySelectorAll('.log-entry');
        const logText = Array.from(logEntries)
            .map(entry => entry.textContent)
            .join('\n');

        const doc = new jsPDF();

        doc.setFontSize(16);
        doc.text('Audio Analysis Report', 20, 15);

        doc.setFontSize(11);
        doc.text(`File: ${fileName}`, 20, 25);

        const timestamp = new Date().toLocaleString();
        doc.text(`Generated: ${timestamp}`, 20, 32);

        doc.setDrawColor(200, 200, 200);
        doc.line(20, 36, 190, 36);

        doc.setFontSize(10);
        const logLines = doc.splitTextToSize(logText, 170);
        doc.text(logLines, 20, 42);

        const date = new Date();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();

        const fileNameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
        const fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1) || 'audio';

        const pdfFileName = `audio_report_${fileNameWithoutExtension}_${fileExtension}_${month}_${day}_${year}.pdf`;
        doc.save(pdfFileName);
    };

    return (
        <div className="audio-file-editor">
            {/* File name with remove button */}
            <div className="file-name-header">
                <p className="file-name-text">{fileName}</p>
                {onRemove && (
                    <button className="remove-file-btn-editor" onClick={onRemove} title="Remove this file">
                        ✕
                    </button>
                )}
            </div>

            {/* Waveform Section */}
            <div className="waveform-section">
                <div className="waveform-layout">
                    <div className="waveform-container">
                        <div className="waveform-scroll" ref={waveformScrollRef}>
                            <canvas
                                ref={canvasRef}
                                className="waveform-canvas"
                                onClick={handleCanvasClick}
                            />
                        </div>

                        <div className="time-display">
                            <span>{formatTime(currentTime)}</span>
                            <span>{formatTime(duration)}</span>
                        </div>
                    </div>

                    <div className="log-container">
                        <h3>Log</h3>
                        <div ref={logBoxRef} className="log-box"></div>
                    </div>
                </div>
            </div>

            {/* Audio controls */}
            <div className="audio-controls">
                <audio ref={audioRef} src={audioUrl} />
                <button className="pause-button" onClick={togglePlayPause}>
                    {isPlaying ? 'PAUSE' : 'PLAY'}
                </button>
                <button className="download-button" onClick={downloadLogAsPDF}>
                    DOWNLOAD LOG
                </button>
            </div>
        </div>
    );
}
