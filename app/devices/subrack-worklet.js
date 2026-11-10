// devices/subrack-worklet.js
// SUBRACK DSP: the gateway between the device's own jacks and the rack inside it (its top row, the
// SUBRACK I/O). The devices inside run in the rack processor like any other (webrack.js: WR.flatten);
// this passes the signals across, one sample late as a cable:
//   front CV IN 1-4 -> inside CV IN 1-4 (i1..i4)       inside CV OUT 1-4 (o1..o4) -> front CV OUT 1-4
//   rear IN L / R -> inside IN L / R (src_l / src_r)    inside OUT L / R (ret_l / ret_r) -> rear OUT L / R
//   the 4 MACRO knobs -> inside MACRO 1-4 (k1..k4), 0..+5 V, smoothed
//   MIDI IN -> inside MIDI IN (midi_thru, to the devices cabled from it or with MASTER MIDI on)
// An unpatched R takes its L, on both sides.
(function(){

const N = 4;
const IN_IDS = ["cv1", "cv2", "cv3", "cv4", "o1", "o2", "o3", "o4", "in_l", "in_r", "ret_l", "ret_r"];
const OUT_IDS = ["out1", "out2", "out3", "out4", "i1", "i2", "i3", "i4", "k1", "k2", "k3", "k4", "out_l", "out_r", "src_l", "src_r"];
const I_CV = 0, I_O = 4, I_IN_L = 8, I_IN_R = 9, I_RET_L = 10, I_RET_R = 11;
const O_OUT = 0, O_I = 4, O_K = 8, O_OUT_L = 12, O_OUT_R = 13, O_SRC_L = 14, O_SRC_R = 15;

class SubrackDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.macro = new Float32Array(N);   // targets, volts
		this.macroZ = new Float32Array(N);  // smoothed
		this.smooth = 1 - Math.exp(-1 / (0.01 * sampleRate));
		this.peak = 0;
		this.activity = 0;
	}
	setSettings(s) {
		this.s = s;
		const m = s && Array.isArray(s.macros) ? s.macros : [];
		for (let k = 0; k < N; k++) this.macro[k] = Math.max(0, Math.min(1, +m[k] || 0)) * 5;
	}
	setMidiConnected(c) {
		if (this.midiConnected && !c) this.forward({ type: "allNotesOff" });
		this.midiConnected = c;
	}
	forward(m) {
		if (this.host && this.host.midiFrom) this.host.midiFrom(this, m);
	}
	// the MIDI goes on inside: notes as they are (the rack keeps a note stack for the mono devices),
	// bends, wheels, pressure, sustain. The clock and ALL NOTES OFF reach the devices inside from the
	// rack itself
	message(m) {
		switch (m.type) {
			case "note": this.activity = 4; this.forward(m); break;
			case "bend": case "modwheel": case "pressure": case "polypressure": case "sustain":
				this.forward(m); break;
		}
	}
	beginBlock() {}
	tick() {
		const ins = this.ins, outs = this.outs, p = this.patched;
		for (let k = 0; k < N; k++) {
			outs[O_I + k] = ins[I_CV + k];
			outs[O_OUT + k] = ins[I_O + k];
			this.macroZ[k] += (this.macro[k] - this.macroZ[k]) * this.smooth;
			outs[O_K + k] = this.macroZ[k];
		}
		const l = ins[I_RET_L], r = p[I_RET_R] ? ins[I_RET_R] : l;
		outs[O_OUT_L] = l;
		outs[O_OUT_R] = r;
		outs[O_SRC_L] = ins[I_IN_L];
		outs[O_SRC_R] = p[I_IN_R] ? ins[I_IN_R] : ins[I_IN_L];
		const a = Math.max(l < 0 ? -l : l, r < 0 ? -r : r);
		if (a > this.peak) this.peak = a;
		return 0;
	}
	endBlock() {}
	state() {
		const st = { level: this.peak, midi: this.activity > 0 };
		this.peak *= 0.5;
		if (this.activity > 0) this.activity--;
		return st;
	}
}
SubrackDSP.IN_IDS = IN_IDS;
SubrackDSP.OUT_IDS = OUT_IDS;
SubrackDSP.MIDI_IN = "midi";
SubrackDSP.MIDI_OUT = "midi_thru";
SubrackDSP.POLY = true; // the notes as they come, for the devices inside

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.subrack = SubrackDSP;

})();
