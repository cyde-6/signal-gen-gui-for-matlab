
export enum WaveformType {
  CW = 'CW',
  LFM_UP = 'LFM Up',
  LFM_DOWN = 'LFM Down'
}

export interface SignalConfig {
  id: number;
  active: boolean;
  type: WaveformType;
  freq: number;
  bw: number;
  pw: number;
  amp: number;
}

export interface TransmissionConfig {
  interval: number;
  totalDuration: number;
}

export interface AudioBufferData {
  buffer: Float32Array;
  sampleRate: number;
}
