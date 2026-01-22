
import { SignalConfig, WaveformType, AudioBufferData } from '../types';

export const generateBurst = (configs: SignalConfig[], sampleRate: number = 44100): AudioBufferData => {
  const gapSeconds = 0.05;
  const gapSamples = Math.round(gapSeconds * sampleRate);
  
  let fullBuffer: number[] = [];
  
  const activeConfigs = configs.filter(c => c.active);
  
  activeConfigs.forEach((config, index) => {
    const { type, freq, bw, pw, amp } = config;
    const numSamples = Math.round(pw * sampleRate);
    const pulse = new Float32Array(numSamples);
    
    for (let n = 0; n < numSamples; n++) {
      const t = n / sampleRate;
      let phase = 0;
      
      if (type === WaveformType.CW) {
        phase = 2 * Math.PI * freq * t;
      } else {
        const fStart = type === WaveformType.LFM_UP ? freq - bw / 2 : freq + bw / 2;
        const k = (type === WaveformType.LFM_UP ? bw : -bw) / pw;
        phase = 2 * Math.PI * (fStart * t + 0.5 * k * t * t);
      }
      
      pulse[n] = amp * Math.cos(phase);
    }
    
    // Concatenate
    if (fullBuffer.length > 0) {
      fullBuffer.push(...new Array(gapSamples).fill(0));
    }
    fullBuffer.push(...Array.from(pulse));
  });
  
  if (fullBuffer.length === 0) {
      fullBuffer = new Array(1000).fill(0);
  }

  return {
    buffer: new Float32Array(fullBuffer),
    sampleRate
  };
};

export const createWavBlob = (data: Float32Array, sampleRate: number): Blob => {
  const buffer = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 32 + data.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, data.length * 2, true);

  // PCM data
  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
