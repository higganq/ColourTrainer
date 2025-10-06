import React, { useEffect, useRef, useState } from 'react';

// Frequency — Mobile-first React Web Audio App
// Fix: remove stray JSX fragment and ensure all <div> tags close correctly.
// Features: Web Audio engine, binaural mode, L/R oscilloscopes, 5D Wave, Cymatics, WAV save/share, Extended Solfeggio chart, self-tests.

export default function Frequency() {
  // ------- React state -------
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveform, setWaveform] = useState('sine'); // sine|square|sawtooth|triangle
  const [freq, setFreq] = useState(440);
  const [volume, setVolume] = useState(0.2);
  const [pan, setPan] = useState(0);
  const [binaural, setBinaural] = useState(false);
  const [beat, setBeat] = useState(4); // 0.1–40
  const [tab, setTab] = useState('controls'); // controls|visuals|extended|cymatics
  const [fileName, setFileName] = useState('frequency');

  // Harmonics for Cymatics + WAV render
  const [harmonicsEnabled, setHarmonicsEnabled] = useState(false);
  const [harmonicGains, setHarmonicGains] = useState([1,0,0,0,0,0,0,0]); // H1..H8

  // Self-tests
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState([]);

  // ------- Audio graph refs -------
  const ctxRef = useRef(null);
  const gainRef = useRef(null);
  const pannerRef = useRef(null);
  const splitterRef = useRef(null);
  const analyserLRef = useRef(null);
  const analyserRRef = useRef(null);
  const mergerRef = useRef(null);
  const oscRef = useRef(null); // mono
  const leftOscRef = useRef(null); // binaural
  const rightOscRef = useRef(null); // binaural
  const preMergerRef = useRef(null); // when binaural, merges L/R before main gain

  // ------- Visuals refs -------
  const scopeLCanvasRef = useRef(null);
  const scopeRCanvasRef = useRef(null);
  const wave5dCanvasRef = useRef(null);
  const rafScopeRef = useRef(0);
  const rafWave5dRef = useRef(0);
  const particlesRef = useRef([]);

  // Cymatics
  const cymaticsCanvasRef = useRef(null);
  const rafCymaticsRef = useRef(0);

  // ---------- helpers ----------
  const audioCtx = () => {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctxRef.current = new Ctx();
    }
    return ctxRef.current;
  };

  const ensureAnalysers = () => {
    if (!analyserLRef.current) {
      const ctx = audioCtx();
      analyserLRef.current = ctx.createAnalyser();
      analyserRRef.current = ctx.createAnalyser();
      analyserLRef.current.fftSize = 2048;
      analyserRRef.current.fftSize = 2048;
      analyserLRef.current.smoothingTimeConstant = 0.0;
      analyserRRef.current.smoothingTimeConstant = 0.0;
    }
  };

  const applyWaveToOsc = (osc, ctx) => {
    if (!osc) return;
    if (harmonicsEnabled) {
      const real = new Float32Array(harmonicGains.length + 1);
      const imag = new Float32Array(harmonicGains.length + 1);
      for (let i = 0; i < harmonicGains.length; i++) imag[i + 1] = harmonicGains[i];
      const pw = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
      try { osc.setPeriodicWave(pw); } catch { osc.type = waveform; }
    } else {
      osc.type = waveform;
    }
  };

  const buildGraph = () => {
    const ctx = audioCtx();

    // Clean previous
    stopOscillators();
    [gainRef, pannerRef, splitterRef, mergerRef, preMergerRef].forEach(r => { try { r.current?.disconnect(); } catch {} r.current = null; });

    ensureAnalysers();

    gainRef.current = ctx.createGain();
    pannerRef.current = ctx.createStereoPanner();
    splitterRef.current = ctx.createChannelSplitter(2);
    mergerRef.current = ctx.createChannelMerger(2);

    // Source
    if (binaural) {
      leftOscRef.current = ctx.createOscillator();
      rightOscRef.current = ctx.createOscillator();
      applyWaveToOsc(leftOscRef.current, ctx);
      applyWaveToOsc(rightOscRef.current, ctx);
      const leftGain = ctx.createGain();
      const rightGain = ctx.createGain();
      leftGain.gain.value = 1; rightGain.gain.value = 1;
      preMergerRef.current = ctx.createChannelMerger(2);
      leftOscRef.current.connect(leftGain).connect(preMergerRef.current, 0, 0);
      rightOscRef.current.connect(rightGain).connect(preMergerRef.current, 0, 1);
      preMergerRef.current.connect(gainRef.current);
    } else {
      oscRef.current = ctx.createOscillator();
      applyWaveToOsc(oscRef.current, ctx);
      oscRef.current.connect(gainRef.current);
    }

    gainRef.current.connect(pannerRef.current);
    pannerRef.current.connect(splitterRef.current);

    // Tap analysers per channel
    splitterRef.current.connect(analyserLRef.current, 0);
    splitterRef.current.connect(analyserRRef.current, 1);

    // Then re-merge to destination
    analyserLRef.current.connect(mergerRef.current, 0, 0);
    analyserRRef.current.connect(mergerRef.current, 0, 1);
    mergerRef.current.connect(ctx.destination);

    // Params
    gainRef.current.gain.setValueAtTime(volume, ctx.currentTime);
    pannerRef.current.pan.setValueAtTime(binaural ? 0 : pan, ctx.currentTime);

    if (binaural) {
      const fL = Math.max(20, Math.min(20000, freq - beat / 2));
      const fR = Math.max(20, Math.min(20000, freq + beat / 2));
      leftOscRef.current.frequency.setValueAtTime(fL, ctx.currentTime);
      rightOscRef.current.frequency.setValueAtTime(fR, ctx.currentTime);
    } else {
      oscRef.current.frequency.setValueAtTime(freq, ctx.currentTime);
    }
  };

  const startOscillators = () => {
    const ctx = audioCtx();
    try { if (ctx.state === 'suspended') ctx.resume(); } catch {}
    if (binaural) { leftOscRef.current?.start(); rightOscRef.current?.start(); }
    else { oscRef.current?.start(); }
  };

  const stopOscillators = () => {
    const stopNode = n => { try { n.stop(); } catch {} try { n.disconnect(); } catch {} };
    if (oscRef.current) { stopNode(oscRef.current); oscRef.current = null; }
    if (leftOscRef.current) { stopNode(leftOscRef.current); leftOscRef.current = null; }
    if (rightOscRef.current) { stopNode(rightOscRef.current); rightOscRef.current = null; }
    if (preMergerRef.current) { try { preMergerRef.current.disconnect(); } catch {} preMergerRef.current = null; }
  };

  // ---------- playback control ----------
  const play = () => { buildGraph(); startOscillators(); setIsPlaying(true); };
  const stop = () => { setIsPlaying(false); stopOscillators(); };

  // Live param updates
  useEffect(() => {
    const ctx = ctxRef.current; if (!ctx || !isPlaying) return;
    gainRef.current?.gain?.setValueAtTime(volume, ctx.currentTime);
    pannerRef.current?.pan?.setValueAtTime(binaural ? 0 : pan, ctx.currentTime);
    if (binaural) {
      if (leftOscRef.current && rightOscRef.current) {
        const fL = Math.max(20, Math.min(20000, freq - beat / 2));
        const fR = Math.max(20, Math.min(20000, freq + beat / 2));
        leftOscRef.current.frequency.setValueAtTime(fL, ctx.currentTime);
        rightOscRef.current.frequency.setValueAtTime(fR, ctx.currentTime);
      }
    } else if (oscRef.current) {
      oscRef.current.frequency.setValueAtTime(freq, ctx.currentTime);
    }
  }, [freq, beat, volume, pan, binaural, isPlaying]);

  // Restart only when waveform or binaural toggles
  useEffect(() => {
    if (!isPlaying) return;
    stopOscillators();
    buildGraph();
    startOscillators();
  }, [waveform, binaural]);

  // Live-apply harmonics without restart
  useEffect(() => {
    if (!isPlaying) return;
    const ctx = ctxRef.current; if (!ctx) return;
    const apply = (osc) => {
      if (!osc) return;
      if (harmonicsEnabled) {
        const real = new Float32Array(harmonicGains.length + 1);
        const imag = new Float32Array(harmonicGains.length + 1);
        for (let i = 0; i < harmonicGains.length; i++) imag[i + 1] = harmonicGains[i];
        const pw = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
        try { osc.setPeriodicWave(pw); } catch {}
      } else { try { osc.type = waveform; } catch {} }
    };
    if (binaural) { apply(leftOscRef.current); apply(rightOscRef.current); }
    else { apply(oscRef.current); }
  }, [harmonicsEnabled, harmonicGains]);

  // ---------- Visuals: Oscilloscopes ----------
  useEffect(() => {
    if (tab !== 'visuals') { cancelAnimationFrame(rafScopeRef.current); return; }
    ensureAnalysers();
    const draw = () => {
      const canvases = [scopeLCanvasRef.current, scopeRCanvasRef.current];
      const analysers = [analyserLRef.current, analyserRRef.current];
      canvases.forEach((canvas, i) => {
        if (!canvas) return;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== Math.floor(w*dpr) || canvas.height !== Math.floor(h*dpr)) { canvas.width = Math.floor(w*dpr); canvas.height = Math.floor(h*dpr); }
        const ctx2d = canvas.getContext('2d');
        ctx2d.setTransform(dpr,0,0,dpr,0,0);
        // clear
        ctx2d.clearRect(0,0,w,h);
        // midline
        ctx2d.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(0, h/2); ctx2d.lineTo(w, h/2); ctx2d.stroke();
        // waveform
        const analyser = analysers[i];
        const bufferLength = analyser.fftSize;
        const data = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(data);
        // compute amplitude for hint
        let maxDev = 0; for (let k=0;k<bufferLength;k++){ const dv = Math.abs(data[k]-128); if (dv>maxDev) maxDev = dv; }
        ctx2d.lineWidth = 2.5;
        ctx2d.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx2d.lineJoin = 'round';
        ctx2d.lineCap = 'round';
        ctx2d.beginPath();
        for (let x = 0; x < w; x++) {
          const idx = Math.floor(x / w * bufferLength);
          const v = (data[idx] - 128) / 128;
          const y = h/2 + v * h/2 * 0.9;
          if (x === 0) ctx2d.moveTo(0, y); else ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
        if (maxDev < 2) {
          ctx2d.fillStyle = 'rgba(255,255,255,0.5)';
          ctx2d.font = '10px ui-sans-serif, system-ui';
          ctx2d.fillText('no signal', 8, 14);
        }
      });
      rafScopeRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafScopeRef.current);
  }, [tab]);

  // ---------- Visuals: 5D Wave ----------
  const hueFromFreq = f => {
    const minF = 20, maxF = 20000;
    const t = (Math.log(f) - Math.log(minF)) / (Math.log(maxF) - Math.log(minF));
    return (t * 360) % 360;
  };

  useEffect(() => {
    if (tab !== 'visuals') { cancelAnimationFrame(rafWave5dRef.current); return; }
    const canvas = wave5dCanvasRef.current; if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    const resize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.floor(w*dpr); canvas.height = Math.floor(h*dpr);
      ctx2d.setTransform(dpr,0,0,dpr,0,0);
    };
    resize();

    if (!particlesRef.current || particlesRef.current.length !== 420) {
      const arr = [];
      for (let i = 0; i < 420; i++) arr.push({ x:(Math.random()-0.5)*2, y:(Math.random()-0.5)*2, z:Math.random(), vx:0, vy:0, vz:0, ph:Math.random()*Math.PI*2 });
      particlesRef.current = arr;
    }

    const data = new Uint8Array(analyserLRef.current ? analyserLRef.current.frequencyBinCount : 1024);
    let lastT = performance.now();
    const draw = (tNow) => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const cx = w/2, cy = h/2;
      const dt = Math.min(0.05, (tNow - lastT) / 1000); lastT = tNow;
      ctx2d.fillStyle = 'rgba(0,0,0,0.08)'; ctx2d.fillRect(0,0,w,h);
      let energy = 0.1; if (analyserLRef.current){ analyserLRef.current.getByteFrequencyData(data); let s=0; for(let i=0;i<data.length;i++) s+=data[i]; energy = s/(data.length*255); }
      const beatMod = binaural ? Math.min(1, beat / 40) : 0; const hue = hueFromFreq(freq);
      ctx2d.globalCompositeOperation = 'lighter';
      const parts = particlesRef.current;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const angle = p.ph + tNow * 0.0002 * (1 + beatMod * 2);
        const radius = 0.7 + 0.3 * Math.sin(p.ph + tNow * 0.0003);
        const tx = radius * Math.cos(angle), ty = radius * Math.sin(angle), tz = 0.5 + 0.5 * Math.sin(p.ph*2 + tNow*0.0005);
        const k = 1.5 + energy * 2; p.vx += (tx - p.x) * k * dt; p.vy += (ty - p.y) * k * dt; p.vz += (tz - p.z) * k * dt;
        const damp = 0.85 - energy * 0.2; p.vx *= damp; p.vy *= damp; p.vz *= damp;
        const pulse = 1 + beatMod * 0.2 * Math.sin(tNow * 0.002 * beat);
        p.x += p.vx * dt * pulse; p.y += p.vy * dt * pulse; p.z += p.vz * dt * pulse;
        const z = 0.5 + p.z * 0.8; const px = cx + p.x * 120 * (1/z); const py = cy + p.y * 120 * (1/z); const size = (1/z) * (1 + energy * 2);
        ctx2d.fillStyle = `hsla(${hue}, 90%, 60%, ${0.35 + energy*0.4})`; ctx2d.beginPath(); ctx2d.arc(px, py, size, 0, Math.PI*2); ctx2d.fill();
      }
      ctx2d.globalCompositeOperation = 'source-over';
      rafWave5dRef.current = requestAnimationFrame(draw);
    };
    rafWave5dRef.current = requestAnimationFrame(draw);

    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => { cancelAnimationFrame(rafWave5dRef.current); window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, [tab, freq, beat, binaural]);

  // ---------- Cymatics (sand-like nodes) ----------
  useEffect(() => {
    if (tab !== 'cymatics') { cancelAnimationFrame(rafCymaticsRef.current); return; }
    const canvas = cymaticsCanvasRef.current; if (!canvas) return;
    const ctx2d = canvas.getContext('2d');

    const resize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.floor(w*dpr); canvas.height = Math.floor(h*dpr);
      ctx2d.setTransform(dpr,0,0,dpr,0,0);
    };
    resize();

    const bufSize = 220; const off = document.createElement('canvas'); off.width = bufSize; off.height = bufSize; const octx = off.getContext('2d');
    const avgEnergy = () => { if (!analyserLRef.current) return 0.2; const arr = new Uint8Array(analyserLRef.current.frequencyBinCount); analyserLRef.current.getByteFrequencyData(arr); let s=0; for (let i=0;i<arr.length;i++) s+=arr[i]; return s/(arr.length*255); };
    let t0 = performance.now();

    const draw = (tnow) => {
      const t = (tnow - t0) * 0.001; const E = avgEnergy();
      const plateN = Math.max(1, Math.min(12, Math.floor(Math.log2(Math.max(40,freq)) - 4)));
      const plateM = Math.max(1, Math.min(12, Math.floor(plateN * (waveform==='square'?1.8: waveform==='sawtooth'?1.4: waveform==='triangle'?1.2:1))));
      const phase = t * (1.5 + E*3) * (binaural? (1+beat/20):1);
      const img = octx.createImageData(bufSize, bufSize); const data = img.data; let p=0;
      for(let y=0;y<bufSize;y++){
        const yy = y/(bufSize-1);
        for(let x=0;x<bufSize;x++){
          const xx = x/(bufSize-1);
          const s1 = Math.sin(Math.PI*plateN*xx + phase) * Math.sin(Math.PI*plateM*yy + phase*0.7);
          const s2 = Math.sin(Math.PI*plateM*xx + phase*0.6) * Math.sin(Math.PI*plateN*yy + phase*1.1);
          const s3 = Math.sin(Math.PI*(plateN+plateM)*Math.hypot(xx-0.5,yy-0.5) + phase*0.9);
          const s4 = Math.sin(Math.PI*plateN*xx + phase) + Math.sin(Math.PI*plateM*yy + phase*1.3);
          let A; switch(waveform){ case 'square': A = Math.sign(s1)+Math.sign(s2); break; case 'sawtooth': A = s4; break; case 'triangle': A = Math.asin(s1)/1.57 + Math.asin(s2)/1.57; break; default: A = 0.6*s1 + 0.4*s2 + 0.2*s3; }
          A *= (0.9 + 0.3*E);
          const node = Math.exp(-Math.pow(Math.abs(A)*6, 2));
          const a = Math.min(1, node * (0.4 + 0.6*E));
          data[p++] = 255; data[p++] = 240; data[p++] = 200; data[p++] = Math.floor(255*a);
        }
      }
      ctx2d.fillStyle = 'rgba(0,0,0,0.12)'; ctx2d.fillRect(0,0,canvas.clientWidth, canvas.clientHeight);
      octx.putImageData(img,0,0);
      ctx2d.globalCompositeOperation = 'lighter';
      ctx2d.drawImage(off, 0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx2d.globalCompositeOperation = 'source-over';
      rafCymaticsRef.current = requestAnimationFrame(draw);
    };

    const onResize = () => resize();
    window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize);
    rafCymaticsRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafCymaticsRef.current); window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, [tab, waveform, freq, beat, binaural]);

  // ---------- Canvas rescale on orientation/resize ----------
  useEffect(() => {
    const rescale = () => {
      [scopeLCanvasRef.current, scopeRCanvasRef.current, wave5dCanvasRef.current, cymaticsCanvasRef.current].forEach(c => {
        if (!c) return; const dpr = Math.max(1, window.devicePixelRatio || 1); c.width = Math.floor(c.clientWidth*dpr); c.height = Math.floor(c.clientHeight*dpr);
      });
    };
    const onResize = () => rescale();
    window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize);
    rescale();
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, [tab]);

  // ---------- WAV render (stereo 44.1kHz, int16) ----------
  const renderWav = async (seconds = 1.0) => {
    const sampleRate = 44100;
    const length = Math.floor(sampleRate * seconds);
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    const twoPi = Math.PI * 2;

    const baseWave = (i, f, type) => {
      const t = i / sampleRate; const ph = twoPi * f * t;
      switch (type) { case 'sine': return Math.sin(ph); case 'square': return Math.sign(Math.sin(ph)); case 'sawtooth': { const frac = (f * t) % 1; return 2*frac - 1; } case 'triangle': { const frac = (f * t) % 1; return 1 - 4*Math.abs(frac - 0.5); } default: return Math.sin(ph); }
    };

    const waveWithHarmonics = (i, f) => {
      if (!harmonicsEnabled) return baseWave(i, f, waveform);
      let s = 0, total = 0; const t = i / sampleRate;
      for (let k=1; k<=harmonicGains.length; k++) { const g = harmonicGains[k-1] || 0; if (!g) continue; s += g * Math.sin(twoPi * f * k * t); total += Math.abs(g); }
      return s / Math.max(1, total);
    };

    const vol = Math.max(0, Math.min(1, volume));
    const attack = Math.floor(0.01 * sampleRate); const release = Math.floor(0.01 * sampleRate);

    if (binaural) {
      const fL = Math.max(20, Math.min(20000, freq - beat/2));
      const fR = Math.max(20, Math.min(20000, freq + beat/2));
      for (let i=0;i<length;i++) { let a = vol; if (i<attack) a*=i/attack; else if (i>length-release) a*=(length-i)/release; left[i] = a * waveWithHarmonics(i, fL); right[i] = a * waveWithHarmonics(i, fR); }
    } else {
      const fC = Math.max(20, Math.min(20000, freq)); const panVal = Math.max(-1, Math.min(1, pan));
      const gL = Math.cos((panVal + 1) * Math.PI/4); const gR = Math.sin((panVal + 1) * Math.PI/4);
      for (let i=0;i<length;i++) { let a = vol; if (i<attack) a*=i/attack; else if (i>length-release) a*=(length-i)/release; const s = waveWithHarmonics(i, fC); left[i] = a*s*gL; right[i] = a*s*gR; }
    }

    const interleaved = new Int16Array(length * 2); let idx = 0;
    for (let i=0;i<length;i++) { interleaved[idx++] = Math.max(-1, Math.min(1, left[i])) * 0x7FFF; interleaved[idx++] = Math.max(-1, Math.min(1, right[i])) * 0x7FFF; }

    const bytesPerSample = 2; const blockAlign = 2 * bytesPerSample; const byteRate = sampleRate * blockAlign; const dataSize = interleaved.length * bytesPerSample;
    const header = new ArrayBuffer(44); const dv = new DataView(header); let p = 0;
    const w8 = v => dv.setUint8(p++, v); const w16 = v => { dv.setUint16(p, v, true); p+=2; }; const w32 = v => { dv.setUint32(p, v, true); p+=4; };
    'RIFF'.split('').forEach(c=>w8(c.charCodeAt(0))); w32(36 + dataSize); 'WAVEfmt '.split('').forEach(c=>w8(c.charCodeAt(0)));
    w32(16); w16(1); w16(2); w32(sampleRate); w32(byteRate); w16(blockAlign); w16(16); 'data'.split('').forEach(c=>w8(c.charCodeAt(0))); w32(dataSize);
    const riff = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)); if (riff !== 'RIFF') throw new Error('WAV header corrupt');
    if (dataSize !== interleaved.length * 2) throw new Error('Interleave length mismatch');

    return new Blob([header, new DataView(interleaved.buffer)], { type: 'audio/wav' });
  };

  const saveWav = async () => {
    const blob = await renderWav(1.0);
    const a = document.createElement('a'); const url = URL.createObjectURL(blob);
    a.href = url; a.download = `${fileName || 'frequency'}.wav`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const shareWav = async () => {
    try {
      const blob = await renderWav(1.0);
      const file = new File([blob], `${fileName || 'frequency'}.wav`, { type: 'audio/wav' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Frequency' });
      else if (navigator.share) { const url = URL.createObjectURL(blob); await navigator.share({ title: 'Frequency', text: 'Stereo WAV', url }); setTimeout(() => URL.revokeObjectURL(url), 4000); }
      else await saveWav();
    } catch { await saveWav(); }
  };

  // ---------- Presets ----------
  const quickPresets = [100,200,400,432,440,500,528,1000];
  const solfeggio = [174,285,396,417,528,639,741,852];

  // ---------- Extended actions ----------
  const actions = [
    {n:1,f:63,pair:[59,63]},
    {n:2,f:174,pair:[170,174]},
    {n:3,f:285,pair:[281,285]},
    {n:4,f:396,pair:[392,396]},
    {n:5,f:417,pair:[413,417]},
    {n:6,f:528,pair:[524,528]},
    {n:7,f:639,pair:[635,639]},
    {n:8,f:741,pair:[737,741]},
    {n:9,f:852,pair:[848,852]},
    {n:10,f:963,pair:[959,963]},
  ];

  // Extended Solfeggio frequency chart
  const solfeggioExtended = [
    {n:1,  f:63,  deriv:'174 – 111',   digit:9, note:'B2 (61.7)',    pair:[59,63],   beat:4, purpose:'Grounding / Earth vibration'},
    {n:2,  f:174, deriv:'base',         digit:3, note:'F3 (174.6)',   pair:[170,174], beat:4, purpose:'Pain relief, stability'},
    {n:3,  f:285, deriv:'174 + 111',    digit:6, note:'C♯4 (277)',    pair:[281,285], beat:4, purpose:'Tissue repair'},
    {n:4,  f:396, deriv:'285 + 111',    digit:9, note:'G4 (392)',     pair:[392,396], beat:4, purpose:'Release fear'},
    {n:5,  f:417, deriv:'reset cycle',  digit:3, note:'G♯4 (415)',    pair:[413,417], beat:4, purpose:'Facilitate change'},
    {n:6,  f:528, deriv:'417 + 111',    digit:6, note:'C5 (523)',     pair:[524,528], beat:4, purpose:'Transformation / “DNA”'},
    {n:7,  f:639, deriv:'528 + 111',    digit:9, note:'E♭5 (622)',    pair:[635,639], beat:4, purpose:'Relationships'},
    {n:8,  f:741, deriv:'639 + 102*',   digit:3, note:'F♯5 (740)',    pair:[737,741], beat:4, purpose:'Intuition / detox'},
    {n:9,  f:852, deriv:'741 + 111',    digit:6, note:'A♭5 (831)',    pair:[848,852], beat:4, purpose:'Awakening'},
    {n:10, f:963, deriv:'852 + 111',    digit:9, note:'B5 (988)',     pair:[959,963], beat:4, purpose:'Oneness / Crown chakra'},
    {n:11, f:1074,deriv:'963 + 111',    digit:3, note:'C6 (1046)',    pair:[1070,1074],beat:4, purpose:'Soul Star'},
    {n:12, f:1185,deriv:'1074 + 111',   digit:6, note:'D6 (1175)',    pair:[1181,1185],beat:4, purpose:'Higher intuition'},
    {n:13, f:1296,deriv:'1185 + 111',   digit:9, note:'E6 (1319)',    pair:[1292,1296],beat:4, purpose:'Stellar Gateway'},
    {n:14, f:1407,deriv:'1296 + 111',   digit:3, note:'F6 (1397)',    pair:[1403,1407],beat:4, purpose:'High overtone extension'},
    {n:15, f:1518,deriv:'1407 + 111',   digit:6, note:'G6 (1568)',    pair:[1514,1518],beat:4, purpose:'High overtone extension'},
    {n:16, f:1629,deriv:'1518 + 111',   digit:9, note:'A6 (1760)',    pair:[1625,1629],beat:4, purpose:'High overtone extension'},
    {n:17, f:1740,deriv:'1629 + 111',   digit:3, note:'A♯6 (1865)',   pair:[1736,1740],beat:4, purpose:'High overtone extension'},
    {n:18, f:1851,deriv:'1740 + 111',   digit:6, note:'B♭6 (1865)',   pair:[1847,1851],beat:4, purpose:'High overtone extension'},
  ];

  const setAction = (row, withBinaural) => {
    const delta = Math.abs(row.pair[1] - row.pair[0]);
    setFreq(row.f);
    if (withBinaural) { setBinaural(true); setBeat(delta); }
  };

  // ---------- Self-tests ----------
  const runTests = async () => {
    setTestRunning(true);
    const results = [];
    const pass = (name, detail='') => results.push({name, status:'PASS', detail});
    const fail = (name, detail) => results.push({name, status:'FAIL', detail});

    try {
      // T1: WAV header + size
      const blob = await renderWav(1.0); const buf = await blob.arrayBuffer(); const dv = new DataView(buf);
      const riff = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
      const wave = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
      const dataSize = dv.getUint32(40, true); const expected = 44100 * 1.0 * 2 * 2;
      if (riff==='RIFF' && wave==='WAVE' && Math.abs(dataSize-expected)<4) pass('WAV header + size', `dataSize=${dataSize}`); else fail('WAV header + size', `riff=${riff} wave=${wave} dataSize=${dataSize} expected=${expected}`);
    } catch (e) { fail('WAV header + size', e.message); }

    try {
      // T2: Binaural split frequencies
      const prev = { binaural, freq, beat }; setBinaural(true); setFreq(300); setBeat(10); play(); await new Promise(r=>setTimeout(r,120));
      const l = leftOscRef.current?.frequency?.value; const r = rightOscRef.current?.frequency?.value;
      if (Math.abs(l-295)<1 && Math.abs(r-305)<1) pass('Binaural split frequencies', `L=${l?.toFixed?.(2)} R=${r?.toFixed?.(2)}`); else fail('Binaural split frequencies', `L=${l} R=${r}`);
      stop(); setBinaural(prev.binaural); setFreq(prev.freq); setBeat(prev.beat);
    } catch (e) { fail('Binaural split frequencies', e.message); }

    try {
      // T3: Extended action beat Δ
      const row = actions[5]; setAction(row, true); await new Promise(r=>setTimeout(r,60));
      if (binaural===true && Math.abs(beat - Math.abs(row.pair[1]-row.pair[0])) < 1e-6) pass('Extended action beat Δ', `beat=${beat}`); else fail('Extended action beat Δ', `binaural=${binaural} beat=${beat}`);
    } catch (e) { fail('Extended action beat Δ', e.message); }

    try {
      // T4: Visuals particle count when visuals tab active
      const prevTab = tab; setTab('visuals'); await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>setTimeout(r,80));
      const count = particlesRef.current?.length || 0; if (count===420) pass('5D Wave particle count', '420'); else fail('5D Wave particle count', `count=${count}`); setTab(prevTab);
    } catch (e) { fail('5D Wave particle count', e.message); }

    try {
      // T5: Menu remains responsive after Set action
      setBinaural(false); play(); await new Promise(r=>setTimeout(r,80)); const before = oscRef.current; setAction(actions[0], false); await new Promise(r=>setTimeout(r,120));
      const sameNode = before === oscRef.current && before !== null; const playing = isPlaying; if (sameNode && playing) pass('Menu responsive after Set', 'osc not restarted'); else fail('Menu responsive after Set', `sameNode=${sameNode} playing=${playing}`); stop();
    } catch (e) { fail('Menu responsive after Set', e.message); }

    setTestResults(results);
    setTestRunning(false);
  };

  // ---------- UI ----------
  const Label = ({children}) => (<div className="text-xs font-medium opacity-80 mb-1">{children}</div>);
  const Slider = ({min, max, step, value, onChange, disabled}) => (
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e=>onChange(parseFloat(e.target.value))}
      disabled={disabled}
      className={`w-full accent-white ${disabled? 'opacity-40' : ''}`} />
  );

  const PlayControls = () => (
    <div className="flex gap-2 items-center">
      <button onClick={isPlaying? stop : play}
        className={`px-4 py-2 rounded-lg text-black ${isPlaying? 'bg-red-400' : 'bg-green-400'}`}>{isPlaying? 'Stop' : 'Play'}</button>
    </div>
  );

  const TabButton = ({id, children}) => (
    <button
      onClick={()=>setTab(id)}
      onTouchStart={()=>{ audioCtx().resume(); setTab(id); }}
      className={`px-3 py-2 touch-manipulation ${tab===id? 'border-b-2 border-white' : 'opacity-70'}`}>{children}</button>
  );

  return (
    <div className="w-full min-h-screen text-white bg-black">
      <div className="max-w-4xl mx-auto p-3 pb-24">
        <h1 className="text-xl font-semibold mb-2">frequency</h1>

        {/* Sticky Tabs */}
        <div className="sticky top-0 z-50 pointer-events-auto bg-black/80 backdrop-blur border-b border-neutral-800">
          <div className="flex gap-4 overflow-x-auto no-scrollbar">
            <TabButton id="controls">Controls</TabButton>
            <TabButton id="visuals">Visuals</TabButton>
            <TabButton id="extended">Extended</TabButton>
            <TabButton id="cymatics">Cymatics</TabButton>
          </div>
        </div>

        {tab === 'controls' && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div>
                <Label>Waveform</Label>
                <div className="flex gap-2 flex-wrap">
                  {['sine','square','sawtooth','triangle'].map(w => (
                    <button key={w} onClick={()=>setWaveform(w)} className={`px-3 py-1 rounded border ${waveform===w? 'bg-white text-black' : 'border-neutral-700'}`}>{w}</button>
                  ))}
                </div>
              </div>

              <div>
                <Label>Frequency {freq} Hz</Label>
                <Slider min={20} max={20000} step={1} value={freq} onChange={setFreq} />
              </div>

              <div>
                <Label>Beat {beat.toFixed(2)} Hz {binaural? '(binaural on)' : ''}</Label>
                <Slider min={0.1} max={40} step={0.1} value={beat} onChange={setBeat} disabled={!binaural} />
              </div>

              <div>
                <Label>Volume {volume.toFixed(2)}</Label>
                <Slider min={0} max={1} step={0.01} value={volume} onChange={setVolume} />
              </div>

              <div>
                <Label>Pan {binaural? '0 (locked)' : pan.toFixed(2)}</Label>
                <Slider min={-1} max={1} step={0.01} value={binaural? 0 : pan} onChange={setPan} disabled={binaural} />
              </div>

              <div className="flex items-center gap-4">
                <div>
                  <Label>Binaural</Label>
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={binaural} onChange={e=>setBinaural(e.target.checked)} />
                    <span>{binaural? 'On' : 'Off'}</span>
                  </label>
                </div>
              </div>

              <PlayControls />

              <div className="mt-2">
                <Label>Quick presets</Label>
                <div className="flex flex-wrap gap-2">
                  {quickPresets.map(p => (
                    <button key={p} onClick={()=>setFreq(p)} className="px-3 py-1 rounded border border-neutral-700 hover:bg-neutral-800">{p}</button>
                  ))}
                </div>
              </div>

              <div>
                <Label>Solfeggio</Label>
                <div className="flex flex-wrap gap-2">
                  {solfeggio.map(p => (
                    <button key={p} onClick={()=>setFreq(p)} className="px-3 py-1 rounded border border-neutral-700 hover:bg-neutral-800">{p}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="border border-neutral-800 rounded p-3">
                <Label>Save / Share</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  <input className="px-2 py-1 bg-neutral-900 border border-neutral-700 rounded" value={fileName}
                    onChange={e=>setFileName(e.target.value.slice(0,64))} />
                  <button onClick={saveWav} className="px-3 py-1 rounded bg-neutral-200 text-black">Save WAV</button>
                  <button onClick={shareWav} className="px-3 py-1 rounded bg-neutral-200 text-black">Share</button>
                </div>
                <div className="text-xs opacity-70 mt-2">Generates 1s 44.1 kHz stereo WAV. Filename editable. Web Share fallback to Save.</div>
              </div>

              <div className="border border-neutral-800 rounded p-3">
                <Label>Notes</Label>
                <ul className="list-disc ml-5 text-sm opacity-80 space-y-1">
                  <li>Live updates for frequency, beat, volume, pan.</li>
                  <li>Restart only on waveform change or binaural toggle.</li>
                  <li>Menu stays responsive during playback and after actions.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {tab === 'cymatics' && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={harmonicsEnabled} onChange={e=>setHarmonicsEnabled(e.target.checked)} />
                <span>Enable custom harmonics</span>
              </label>
              <button className="px-2 py-1 rounded border border-neutral-700" onClick={()=>setHarmonicGains([1,0,0,0,0,0,0,0])}>Pure</button>
              <button className="px-2 py-1 rounded border border-neutral-700" onClick={()=>setHarmonicGains([1,0.3,0.15,0.1,0.07,0.05,0.04,0.03])}>Warm</button>
              <button className="px-2 py-1 rounded border border-neutral-700" onClick={()=>setHarmonicGains([1,0.6,0.4,0.3,0.2,0.15,0.12,0.1])}>Bright</button>
              <button className="px-2 py-1 rounded border border-neutral-700" onClick={()=>setHarmonicGains([1,0,0.33,0,0.2,0,0.14,0])}>Odd-only</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({length:8}).map((_,i)=> (
                <div key={i} className="border border-neutral-800 rounded p-2">
                  <div className="text-xs opacity-80 mb-1">H{i+1} gain {harmonicGains[i]?.toFixed(2) ?? '0.00'}</div>
                  <input type="range" min={0} max={1} step={0.01}
                    value={harmonicGains[i] ?? 0}
                    onChange={e=>{ const g = [...harmonicGains]; g[i] = parseFloat(e.target.value); setHarmonicGains(g); }}
                    className="w-full accent-white"/>
                </div>
              ))}
            </div>
            <div className="h-72 sm:h-80 md:h-96 border border-neutral-800 rounded overflow-hidden">
              <canvas ref={cymaticsCanvasRef} className="w-full h-full pointer-events-none" style={{touchAction:'none'}}/>
            </div>
            <div className="text-xs opacity-70">Sand-like pattern reacts to waveform, frequency, volume, and binaural beat. Brighter lines indicate nodal ridges.</div>
          </div>
        )}

        {tab === 'visuals' && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="relative h-28 sm:h-36 md:h-44 border border-neutral-800 rounded">
                <div className="absolute top-1 left-2 text-[10px] uppercase tracking-wide opacity-70">Left Oscillation</div>
                <canvas aria-label="Left Oscilloscope" ref={scopeLCanvasRef} className="w-full h-full pointer-events-none" style={{touchAction:'none'}}/>
              </div>
              <div className="relative h-28 sm:h-36 md:h-44 border border-neutral-800 rounded">
                <div className="absolute top-1 left-2 text-[10px] uppercase tracking-wide opacity-70">Right Oscillation</div>
                <canvas aria-label="Right Oscilloscope" ref={scopeRCanvasRef} className="w-full h-full pointer-events-none" style={{touchAction:'none'}}/>
              </div>
            </div>
            <div className="h-72 sm:h-80 md:h-96 border border-neutral-800 rounded overflow-hidden"><canvas ref={wave5dCanvasRef} className="w-full h-full pointer-events-none" style={{touchAction:'none'}}/></div>
          </div>
        )}

        {tab === 'extended' && (
          <div className="mt-4 space-y-6">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left opacity-70">
                  <tr>
                    <th className="py-2 pr-4">#</th>
                    <th className="py-2 pr-4">Freq</th>
                    <th className="py-2 pr-4">Pair</th>
                    <th className="py-2 pr-4">Δ(Hz)</th>
                    <th className="py-2 pr-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map(row => {
                    const delta = Math.abs(row.pair[1]-row.pair[0]);
                    return (
                      <tr key={row.n} className="border-t border-neutral-800">
                        <td className="py-2 pr-4">{row.n}</td>
                        <td className="py-2 pr-4">{row.f}</td>
                        <td className="py-2 pr-4">[{row.pair[0]}, {row.pair[1]}]</td>
                        <td className="py-2 pr-4">{delta}</td>
                        <td className="py-2 pr-4 flex gap-2">
                          <button onClick={()=>setAction(row,false)} className="px-2 py-1 rounded border border-neutral-700">Set</button>
                          <button onClick={()=>setAction(row,true)} className="px-2 py-1 rounded bg-white text-black">Set + Binaural</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">Extended Solfeggio Chart</div>
              <div className="text-[11px] opacity-70">Includes numeric derivation (+111), digit-sum cycle, nearest note (A4=440), typical 4 Hz binaural pairs, and purpose.</div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="text-left opacity-70">
                    <tr>
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Frequency (Hz)</th>
                      <th className="py-2 pr-3">Derivation</th>
                      <th className="py-2 pr-3">Digit Sum</th>
                      <th className="py-2 pr-3">Nearest Note</th>
                      <th className="py-2 pr-3">Typical Pair</th>
                      <th className="py-2 pr-3">Δ</th>
                      <th className="py-2 pr-3">Purpose / Association</th>
                      <th className="py-2 pr-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solfeggioExtended.map(row => {
                      const delta = Math.abs(row.pair[1]-row.pair[0]);
                      return (
                        <tr key={row.n} className="border-t border-neutral-800">
                          <td className="py-2 pr-3">{row.n}</td>
                          <td className="py-2 pr-3">{row.f}</td>
                          <td className="py-2 pr-3">{row.deriv}</td>
                          <td className="py-2 pr-3">{row.digit}</td>
                          <td className="py-2 pr-3">{row.note}</td>
                          <td className="py-2 pr-3">[{row.pair[0]} / {row.pair[1]}] → {row.beat} Hz</td>
                          <td className="py-2 pr-3">{delta}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{row.purpose}</td>
                          <td className="py-2 pr-3 flex gap-2">
                            <button onClick={()=>{ setFreq(row.f); }} className="px-2 py-1 rounded border border-neutral-700">Set</button>
                            <button onClick={()=>{ setFreq(row.f); setBinaural(true); setBeat(delta); }} className="px-2 py-1 rounded bg-white text-black">Set + Binaural</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] opacity-60">* 741 row uses +102 to align to common published set; others follow +111 sequence.</div>
            </div>

            <div className="border border-neutral-800 rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <Label>Self-tests</Label>
                <button onClick={runTests} disabled={testRunning} className={`px-3 py-1 rounded ${testRunning? 'bg-neutral-700' : 'bg-white text-black'}`}>{testRunning? 'Running…' : 'Run tests'}</button>
              </div>
              <ul className="text-xs space-y-1 max-h-64 overflow-auto">
                {testResults.map((t, i) => (
                  <li key={i} className={`${t.status==='PASS'?'text-green-400':'text-red-400'}`}>
                    <span className="font-mono">[{t.status}]</span> {t.name} <span className="opacity-70">{t.detail}</span>
                  </li>
                ))}
                {testResults.length===0 && <li className="opacity-70">No results yet.</li>}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
