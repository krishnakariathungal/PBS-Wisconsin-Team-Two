// pages/EditPage.jsx
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import "./EditPage.css";
import HomeButton from "../components/HomeButton";

export default function EditPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const waveformScrollRef = useRef(null);
  const logBoxRef = useRef(null);
  const audioRef = useRef(null);
  const animationRef = useRef(null);
  const audioBufferRef = useRef(null); // Store the audio buffer
  const [audioUrl, setAudioUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fileName, setFileName] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const file = location.state?.file;

    if (!file) {
      navigate('/');
      return;
    }

    setFileName(file.name);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [location, navigate]);

  const PIXELS_PER_SECOND = 200; // canvas width scale - tuneable
  // Loud, distorted click detection tuning constants
  const LOUD_CLICK_PEAK_THRESHOLD = 0.8; // absolute sample amplitude for a loud click
  const LOUD_CLICK_DELTA_THRESHOLD = 0.9; // sample-to-sample abrupt change
  const LOUD_CLICK_CLIP_THRESHOLD = 0.99; // clipping-level to always consider a click
  const LOUD_CLICK_RMS_MIN = 0.12; // nearby RMS minimum to assert loudness
  const LOUD_CLICK_MIN_SECS = 0.005; // minimum duration to consider a loud click (short transient)
  const LOUD_CLICK_WINDOW_MS = 8; // window to compute local RMS around candidate
  // Detection tuning constants — tweak these to adjust sensitivity
  // Static click tuning: make detection less sensitive by increasing thresholds
  // - larger MAD multiplier reduces false positives
  // - longer min duration requires clicks to be more sustained
  // - larger amplitude and zcr multiplier avoid flagging low-level/ambient noise
  const STATIC_CLICK_MULTIPLIER = 20.0; // MAD multiplier for static click detector (higher => less sensitive)
  const STATIC_CLICK_MIN_SECS = 0.06; // minimum duration (s) to report static detections (increased to reduce brief transients)
  const STATIC_CLICK_AMPLITUDE_MIN = 0.035; // minimum mean amplitude to avoid flagging very low-level (background) noise
  const STATIC_CLICK_WINDOW_MS = 12; // window size in ms for derivative RMS (larger window smooths short spikes)
  const STATIC_CLICK_ZCR_MULTIPLIER = 2.5; // require higher zero-crossing rate vs baseline
  // Background noise detection tuning constants
  const BACKGROUND_NOISE_WINDOW_MS = 50; // window used to compute RMS for noise detection
  const BACKGROUND_NOISE_MIN_SECS = 1.2; // min continuous seconds to consider noisy background
  const BACKGROUND_NOISE_RMS_THRESHOLD = 0.02; // RMS threshold to consider as background noise
  const BACKGROUND_NOISE_SPEECH_RMS_THRESHOLD = 0.06; // RMS above this is considered foreground (speech/loud)

  useEffect(() => {
    if (!audioUrl) return;

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const canvas = canvasRef.current;
    const canvasContext = canvas.getContext('2d');

    fetch(audioUrl)
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
      .then(audioBuffer => {
        audioBufferRef.current = audioBuffer; // Store for later use

        // detect long-silence regions
        const silentRegions = findSilenceRegions(audioBuffer, 0.01, 1.2);
        audioBufferRef.current.silenceRegions = silentRegions;
        // detect loud regions (RMS > threshold) — based on audio standards
        const loudRegions = findLoudRegions(audioBuffer, 0.6, 0.5);
        audioBufferRef.current.loudRegions = loudRegions;
        // detect click/distortion regions (clipping or abrupt sample jumps)
        const clickRegions = findClickRegions(audioBuffer, 0.98, 0.75, 0.01);
        audioBufferRef.current.clickRegions = clickRegions;
        // detect loud distorted clicks (strict: peak amplitude + high delta + local RMS)
        const loudClickRegions = findLoudClickRegions(audioBuffer, LOUD_CLICK_PEAK_THRESHOLD, LOUD_CLICK_DELTA_THRESHOLD, LOUD_CLICK_CLIP_THRESHOLD, LOUD_CLICK_RMS_MIN, LOUD_CLICK_MIN_SECS, LOUD_CLICK_WINDOW_MS);
        audioBufferRef.current.loudClickRegions = loudClickRegions;
        // detect static (high-frequency) clicks — staticky clicks may have small amplitude but high derivative
        // use conservative defaults: multiplier 8 (less sensitive), minClickSecs=0.02 (longer), amplitudeMin=0.01
        const staticClickRegions = findStaticClickRegions(audioBuffer, STATIC_CLICK_MULTIPLIER, STATIC_CLICK_MIN_SECS, STATIC_CLICK_AMPLITUDE_MIN, STATIC_CLICK_WINDOW_MS, STATIC_CLICK_ZCR_MULTIPLIER);
        // remove static regions that overlap with previously-detected click or loud regions to reduce duplication
        const filteredStaticClickRegions = (staticClickRegions || []).filter(sc => {
          const overlaps = (arr) => (arr || []).some(r => r.startTime < sc.endTime && r.endTime > sc.startTime);
          return !(overlaps(clickRegions) || overlaps(loudRegions));
        });
        audioBufferRef.current.staticClickRegions = filteredStaticClickRegions;
        // detect background noise regions (quiet but high noise floor that persists)
        const backgroundNoiseRegions = findBackgroundNoiseRegions(audioBuffer, BACKGROUND_NOISE_RMS_THRESHOLD, BACKGROUND_NOISE_MIN_SECS, BACKGROUND_NOISE_WINDOW_MS, BACKGROUND_NOISE_SPEECH_RMS_THRESHOLD);
        audioBufferRef.current.backgroundNoiseRegions = backgroundNoiseRegions;
        // Clear any existing logs for a fresh file
        if (logBoxRef.current) logBoxRef.current.innerHTML = '';
        // Add log entries for detected silence regions
        if (silentRegions && silentRegions.length > 0) {
          silentRegions.forEach(region => {
            appendLogEntry(region.startTime, region.endTime, 'Silence');
          });
        }

        // Add log entries for detected loud regions
        if (loudRegions && loudRegions.length > 0) {
          loudRegions.forEach(region => {
            appendLogEntry(region.startTime, region.endTime, 'Too Loud');
          });
        }
        // Add log entries for detected click/distortion regions (non-loud)
        if (audioBufferRef.current.clickRegionsFiltered && audioBufferRef.current.clickRegionsFiltered.length > 0) {
          audioBufferRef.current.clickRegionsFiltered.forEach(region => {
            appendLogEntry(region.startTime, region.endTime, 'Click');
          });
        }
        // Add log entries for detected loud distorted clicks
        if (loudClickRegions && loudClickRegions.length > 0) {
          loudClickRegions.forEach(region => {
            appendLogEntry(region.startTime, region.endTime, 'Loud Click');
          });
        }
        // Remove overlapping non-loud generic clickRegions that overlap with loud clicks to avoid duplicate logs
        if (clickRegions && loudClickRegions) {
          const filteredClicks = clickRegions.filter(c => !loudClickRegions.some(l => c.startTime < l.endTime && c.endTime > l.startTime));
          audioBufferRef.current.clickRegionsFiltered = filteredClicks;
        }
        // Add log entries for detected static click regions
        if (audioBufferRef.current.staticClickRegions && audioBufferRef.current.staticClickRegions.length > 0) {
          audioBufferRef.current.staticClickRegions.forEach(region => {
            appendLogEntry(region.startTime, region.endTime, 'Static Click');
          });
        }
        // Add log entries for background noise regions
        if (backgroundNoiseRegions && backgroundNoiseRegions.length > 0) {
          backgroundNoiseRegions.forEach(region => {
            appendLogEntry(region.startTime, region.endTime, 'Background Noise');
          });
        }
        // If no silence nor loudness warnings were detected, output a simple message
        if ((!silentRegions || silentRegions.length === 0) && (!loudRegions || loudRegions.length === 0) && (!clickRegions || clickRegions.length === 0) && (!staticClickRegions || staticClickRegions.length === 0) && (!backgroundNoiseRegions || backgroundNoiseRegions.length === 0)) {
          appendLogMessage('No warnings detected');
        }

        // compute proportional canvas width based on audio duration and clamp it
        const MAX_CANVAS_WIDTH = 2400; // prevents extremely wide canvases that push layout
        const desiredWidth = Math.max(1200, Math.min(Math.ceil(audioBuffer.duration * PIXELS_PER_SECOND), MAX_CANVAS_WIDTH));
        canvas.width = desiredWidth;
        canvas.height = 300;
        // Make the canvas virtual drawing buffer big, but set the CSS width to the DOM to desiredWidth
        // so that the `.waveform-scroll` can contain it and show a horizontal scrollbar.
        canvas.style.width = `${desiredWidth}px`;
        canvas.style.height = `300px`;
        // ensure we start scrolled to the beginning
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
  }, [audioUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const audioBuffer = audioBufferRef.current;
    if (!canvas || !duration || !audioBuffer) return;

    const drawFrame = () => {
      const context = canvas.getContext('2d');

      // Redraw the entire waveform first
      drawWaveform(audioBuffer, canvas, context);

      // Then draw the progress line on top
      const progress = currentTime / duration;
      const lineX = canvas.width * progress;

      // Draw progress line
      context.strokeStyle = '#7c3aed';
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(lineX, 0);
      context.lineTo(lineX, canvas.height);
      context.stroke();

      // Draw playhead circle
      context.fillStyle = '#7c3aed';
      context.beginPath();
      context.arc(lineX, canvas.height / 2, 8, 0, Math.PI * 2);
      context.fill();
    };

    if (isPlaying) {
      const animate = () => {
        drawFrame();
        animationRef.current = requestAnimationFrame(animate);
      };
      animate();
    } else {
      drawFrame();
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };

    // AUTO-SCROLL: keep playhead centered (or as close as possible) while playing
    if (isPlaying) {
      const container = waveformScrollRef.current;
      if (container) {
        const visibleWidth = container.clientWidth;
        const maxScrollLeft = container.scrollWidth - visibleWidth;
        let targetScrollLeft = lineX - (visibleWidth / 2);
        if (targetScrollLeft < 0) targetScrollLeft = 0;
        if (targetScrollLeft > maxScrollLeft) targetScrollLeft = maxScrollLeft;
        // update only if it's noticeably different to avoid janky small updates
        if (Math.abs(container.scrollLeft - targetScrollLeft) > 1) {
          container.scrollLeft = targetScrollLeft;
        }
      }
    }
  }, [currentTime, duration, isPlaying]);

  const drawWaveform = (audioBuffer, canvas, context) => {
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;

    // Light purple background
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
        // draw a narrow vertical bar to highlight short clicks
        context.fillRect(startX, 0, w, canvas.height);
      });
    }

    if (audioBuffer.loudClickRegions) {
      context.fillStyle = 'rgba(255, 20, 147, 0.65)'; // DeepPink for loud clicks
      audioBuffer.loudClickRegions.forEach(region => {
        const startX = (region.startTime / audioBuffer.duration) * canvas.width;
        const endX = (region.endTime / audioBuffer.duration) * canvas.width;
        const w = Math.max(2, endX - startX);
        // narrow bar overlay for loud click
        context.fillRect(startX, 0, w, canvas.height);
      });
    }
    if (audioBuffer.staticClickRegions) {
      context.fillStyle = 'rgba(30, 144, 255, 0.6)'; // DodgerBlue
      audioBuffer.staticClickRegions.forEach(region => {
        const startX = (region.startTime / audioBuffer.duration) * canvas.width;
        const endX = (region.endTime / audioBuffer.duration) * canvas.width;
        const w = Math.max(2, endX - startX);
        context.fillRect(startX, 0, w, canvas.height);
      });
    }
    if (audioBuffer.backgroundNoiseRegions) {
      context.fillStyle = 'rgba(0, 255, 255, 0.25)'; // cyan-ish for background noise
      audioBuffer.backgroundNoiseRegions.forEach(region => {
        const startX = (region.startTime / audioBuffer.duration) * canvas.width;
        const endX = (region.endTime / audioBuffer.duration) * canvas.width;
        const w = Math.max(2, endX - startX);
        context.fillRect(startX, 0, w, canvas.height);
      });
    }
  };

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

  // Detect persistent background noise in otherwise quiet regions
  // Approach: Compute windowed RMS across the track. If a window's RMS is below the
  // speechRmsThreshold (so it is not foreground speech/loud audio) yet the RMS exceeds
  // the noiseRmsThreshold for a contiguous sequence longer than minNoiseSecs, mark
  // it as a background noise region.
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
      // Window is considered 'quiet' (not speech foreground) if rms < speechRmsThreshold
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

  // Detect regions where RMS volume exceeds threshold for at least minLoudSecs
  // - rmsThreshold is in amplitude (0.0 - 1.0), adjust to fit the audio standard
  const findLoudRegions = (audioBuffer, rmsThreshold = 0.6, minLoudSecs = 0.5) => {
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const windowSize = Math.floor(0.05 * sampleRate); // 50ms windows
    const hop = Math.floor(windowSize / 2);

    let loudRegions = [];
    let idx = 0;
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
          // only save if region was long enough
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

    // flush open region at end
    if (currentStart !== null && consecutiveWindows >= minWindows) {
      const startSample = currentStart;
      const endSample = data.length - 1;
      loudRegions.push({ startTime: startSample / sampleRate, endTime: endSample / sampleRate });
    }

    return loudRegions;
  };

  // Detect short clicks or distortion from clipping/abrupt sample jumps
  const findClickRegions = (audioBuffer, amplitudeThreshold = 0.98, deltaThreshold = 0.75, minClickSecs = 0.01) => {
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const len = data.length;
    const maxGapSamples = Math.floor(0.02 * sampleRate); // 20ms gap to join impulses
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

  // Detect loud distorted clicks by requiring peak amplitude + abrupt delta + local loudness
  const findLoudClickRegions = (audioBuffer, peakThreshold = 0.8, deltaThreshold = 0.9, clipThreshold = 0.99, localRMSMin = 0.12, minClickSecs = 0.005, windowMs = 8) => {
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const len = data.length;
    const windowSize = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
    const hop = Math.max(1, Math.floor(windowSize / 2));
    const maxGapSamples = Math.floor(0.02 * sampleRate); // 20ms gap to join impulses
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
        // validate local RMS to ensure this is loud
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

  // Detect static clicks: high derivative (high-freq) content in short windows
  const findStaticClickRegions = (audioBuffer, multiplier = 8.0, minClickSecs = 0.02, amplitudeMin = 0.01, windowMs = 6, zcrMultiplier = 1.5) => {
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const len = data.length;

    // Use windowed derivative RMS as a proxy for high-frequency energy
    const windowSize = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
    const hop = Math.max(1, Math.floor(windowSize / 2));
    const numWindows = Math.max(1, Math.ceil(Math.max(0, len - windowSize) / hop) + 1);

    // Compute derivative array
    const deriv = new Float32Array(len);
    deriv[0] = 0;
    for (let i = 1; i < len; i++) {
      deriv[i] = Math.abs(data[i] - data[i - 1]);
    }

    // Compute derivative RMS per window
    const rmsPerWindow = new Float32Array(numWindows);
    let wIdx = 0;
    // If windowSize >= len, compute a single RMS using the whole deriv array
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


    // Baseline deriv RMS: median of rmsPerWindow
    const rmsCopy = Array.from(rmsPerWindow).sort((a, b) => a - b);
    const median = rmsCopy[Math.floor(rmsCopy.length / 2)] || 0;
    // compute MAD (median absolute deviation)
    const absDeviations = rmsPerWindow.map(v => Math.abs(v - median)).sort((a, b) => a - b);
    const mad = absDeviations[Math.floor(absDeviations.length / 2)] || 0;
    // set threshold as median + multiplier * MAD (robust to outliers)
    const threshold = Math.max(1e-9, median + multiplier * mad);

    const minWindowCount = Math.max(1, Math.ceil((minClickSecs * sampleRate) / hop));

    // Compute baseline ZCR (zero-crossing rate) per window and median baseline
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

    // Find windows with rms exceeding threshold; merge contiguous windows
    let regions = [];
    let inRegion = false;
    let winStart = 0;
    for (let i = 0; i < rmsPerWindow.length; i++) {
      // require both deriv RMS above threshold and mean amplitude for the window > amplitudeMin
      const winStartSample = Math.min(len - 1, i * hop);
      const winEndSample = Math.min(len, winStartSample + windowSize);
      let sumAbsAmp = 0;
      for (let s = winStartSample; s < winEndSample; s++) {
        sumAbsAmp += Math.abs(data[s]);
      }
      const meanAbsAmp = (winEndSample > winStartSample) ? (sumAbsAmp / (winEndSample - winStartSample)) : 0;

      // require also a higher zero-crossing rate vs baseline (static clicks have high ZCR)
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
    // get scroll container so we can account for horizontal scrolling
    const scrollContainer = waveformScrollRef.current;
    const xVisible = e.clientX - rect.left; // position inside visible viewport
    const xAbsolute = xVisible + (scrollContainer ? scrollContainer.scrollLeft : 0);
    // Use scrollWidth to compute progress (both in DOM pixels)
    const progress = xAbsolute / (scrollContainer ? scrollContainer.scrollWidth : rect.width);
    audio.currentTime = progress * duration;
  };

  const formatTime = (time) => {
    // Format as H:MM:SS (hours optional) – match example 0:00:00
    const totalSeconds = Math.floor(time || 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Append a formatted message to the log box DOM element
  const appendLogMessage = (message, typeClass = '') => {
    const box = logBoxRef.current || document.getElementById('logBox');
    if (!box) return;
    const msgEl = document.createElement('div');
    msgEl.className = 'log-entry' + (typeClass ? ` ${typeClass}` : '');
    msgEl.textContent = message;
    box.appendChild(msgEl);
    // Auto-scroll to bottom
    box.scrollTop = box.scrollHeight;
  };

  const appendLogEntry = (startTime, endTime, reason) => {
    const formatted = `${formatTime(startTime)} to ${formatTime(endTime)} - ${reason}`;
    // Add type-based class so we can style messages (e.g. Silence vs Too Loud)
    const typeClass = 'log-' + reason.toLowerCase().replace(/\s+/g, '-');
    appendLogMessage(formatted, typeClass);
  };

  const downloadLogAsPDF = () => {
    const logBox = logBoxRef.current;
    if (!logBox) return;

    // Get all log entries
    const logEntries = logBox.querySelectorAll('.log-entry');
    const logText = Array.from(logEntries)
      .map(entry => entry.textContent)
      .join('\n');

    // Create a new PDF document
    const doc = new jsPDF();

    // Set up the PDF with title and metadata
    doc.setFontSize(16);
    doc.text('Audio Analysis Report', 20, 15);

    // Add file name
    doc.setFontSize(11);
    doc.text(`File: ${fileName}`, 20, 25);

    // Add timestamp
    const timestamp = new Date().toLocaleString();
    doc.text(`Generated: ${timestamp}`, 20, 32);

    // Add a separator line
    doc.setDrawColor(200, 200, 200);
    doc.line(20, 36, 190, 36);

    // Add log content with word wrapping
    doc.setFontSize(10);
    const logLines = doc.splitTextToSize(logText, 170);
    doc.text(logLines, 20, 42);

    // Generate filename with month/day/year format
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();

    // Extract filename and filetype
    const fileNameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
    const fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1) || 'audio';

    const pdfFileName = `audio_report_${fileNameWithoutExtension}_${fileExtension}_${month}_${day}_${year}.pdf`;
    doc.save(pdfFileName);
  };

  return (
    <div className="edit-page">

      <HomeButton />

      {/* Header with Audio Editor title */}
      <header className="edit-header">
        <h1 className="edit-title">Audio Editor</h1>
      </header>

      {/* File name */}
      <div className="file-name-display">
        <p className="file-name-text">{fileName}</p>
      </div>

      {/* Waveform */}
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
            <div ref={logBoxRef} className="log-box" id="logBox"></div>
          </div>

        </div>
      </div>


      {/* Pause button */}
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