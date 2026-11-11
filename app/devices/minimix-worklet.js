// devices/minimix-worklet.js
// MINIMIX DSP, hosted by the rack processor: 8 mono line inputs (rear), a level each, a master level,
// summed to MAIN L / MAIN R (the same mix on both). Levels are smoothed per sample. Line level (+-1).
(function(){

const CHANNELS = 8;
const IN_IDS = [], OUT_IDS = ["main_l", "main_r"];
for (let i = 1; i <= CHANNELS; i++) IN_IDS.push("in" + i);

// knob 0..1 -> gain: 0.75 is unity (0 dB), the top about +4.4 dB, the bottom silence
function knobGain(v) { const g = v / 0.75; return g * g; }

class MinimixDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.gain = new Float32Array(CHANNELS);  // smoothed
		this.target = new Float32Array(CHANNELS);
		this.master = 0;
		this.masterTarget = 0;
		this.smooth = 1 - Math.exp(-1 / (0.005 * sampleRate));
		this.peak = 0;
	}
	message() {}
	setSettings(s) {
		this.s = s;
		for (let i = 0; i < CHANNELS; i++) this.target[i] = knobGain(s.level[i]);
		this.masterTarget = knobGain(s.master);
	}
	setMidiConnected(c) { this.midiConnected = c; }
	beginBlock() {}
	tick() {
		const ins = this.ins, g = this.gain, t = this.target, k = this.smooth;
		let sum = 0;
		for (let i = 0; i < CHANNELS; i++) {
			g[i] += (t[i] - g[i]) * k;
			sum += ins[i] * g[i];
		}
		this.master += (this.masterTarget - this.master) * k;
		const y = sum * this.master;
		this.outs[0] = y;
		this.outs[1] = y;
		const a = y < 0 ? -y : y;
		if (a > this.peak) this.peak = a;
		return 0;
	}
	endBlock() {}
	state() {
		const st = { level: this.peak };
		this.peak = 0;
		return st;
	}
}
MinimixDSP.IN_IDS = IN_IDS;
MinimixDSP.OUT_IDS = OUT_IDS;
MinimixDSP.MIDI_IN = null;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.minimix = MinimixDSP;

})();
