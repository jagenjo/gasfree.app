// devices/eq-worklet.js
// PRISM DSP, hosted by the rack processor: a stereo five band equalizer.
//   LOW CUT (12 dB/oct high pass) -> LOW shelf -> LO MID, MID, HI MID (bells with Q) -> HIGH shelf
//   -> HIGH CUT (12 dB/oct low pass) -> OUTPUT.
// The filters are the usual biquads (RBJ cookbook). The display's spectrum: 28 band-pass filters, a
// third of an octave apart (25 Hz to 16 kHz), on the output summed to mono; their levels go to the
// panel in state(). Audio on the back.

(function(){

const IN_IDS = ["in_l", "in_r"];
const OUT_IDS = ["out_l", "out_r"];
const NB = 28; // spectrum bands
const SPEC_F0 = 25;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// biquad coefficients [b0, b1, b2, a1, a2], normalized by a0
function coefs(type, f, gainDb, q, sr) {
	const w = 2 * Math.PI * clamp(f, 10, sr * 0.45) / sr, cw = Math.cos(w), sw = Math.sin(w);
	const A = Math.pow(10, gainDb / 40);
	let b0, b1, b2, a0, a1, a2;
	if (type == "peak") {
		const al = sw / (2 * q);
		b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
	} else if (type == "low" || type == "high") {
		const al = sw / 2 * Math.SQRT2, s = 2 * Math.sqrt(A) * al; // shelf slope 1
		if (type == "low") {
			b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
			a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
		} else {
			b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
			a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
		}
	} else if (type == "hp" || type == "lp") {
		const al = sw / (2 * Math.SQRT1_2);
		if (type == "hp") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
		else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
		a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
	} else { // band pass, 0 dB at the centre
		const al = sw / (2 * q);
		b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
	}
	return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

// one biquad, stereo (transposed direct form II)
class Biquad {
	constructor() { this.c = [1, 0, 0, 0, 0]; this.z = new Float64Array(4); this.on = false; }
	set(c, on) { this.c = c; this.on = on; }
	run(l, r) {
		const c = this.c, z = this.z;
		const yl = c[0] * l + z[0]; z[0] = c[1] * l - c[3] * yl + z[1]; z[1] = c[2] * l - c[4] * yl;
		const yr = c[0] * r + z[2]; z[2] = c[1] * r - c[3] * yr + z[3]; z[3] = c[2] * r - c[4] * yr;
		this.l = yl; this.r = yr;
	}
}

const BAND_TYPES = ["low", "peak", "peak", "peak", "high"];

class EqDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.filters = [];
		for (let i = 0; i < 7; i++) this.filters.push(new Biquad());
		this.key = "";
		// the spectrum: band-pass filters (mono), their smoothed levels
		this.spec = [];
		for (let i = 0; i < NB; i++) {
			const f = SPEC_F0 * Math.pow(2, i / 3);
			const c = coefs("bp", f, 0, 4.3, sampleRate);
			this.spec.push({ c: c, z1: 0, z2: 0, env: 0 });
		}
		this.levels = new Array(NB).fill(-90);
		this.release = Math.exp(-1 / (0.25 * sampleRate));
		this.peak = 0;
	}

	message() {}
	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	beginBlock() {
		const s = this.s, sr = sampleRate;
		const key = JSON.stringify([s.bands, s.lowcut, s.highcut]);
		if (key == this.key) return;
		this.key = key;
		const f = this.filters;
		f[0].set(coefs("hp", s.lowcut, 0, 0.707, sr), s.lowcut > 20.5);
		s.bands.forEach((b, i) => {
			f[1 + i].set(coefs(BAND_TYPES[i], b.f, b.g, b.q, sr), b.on && Math.abs(b.g) > 0.05);
		});
		f[6].set(coefs("lp", s.highcut, 0, 0.707, sr), s.highcut < 19900);
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs;
		let l = ins[0], r = this.patched[1] ? ins[1] : l;
		if (s.on) {
			const f = this.filters;
			for (let i = 0; i < 7; i++) {
				const q = f[i];
				if (!q.on) continue;
				q.run(l, r); l = q.l; r = q.r;
			}
			const g = Math.pow(10, s.output / 20);
			l *= g; r *= g;
		}
		outs[0] = l; outs[1] = r;

		// the spectrum of what comes out
		const m = (l + r) * 0.5, rel = this.release;
		for (let i = 0; i < NB; i++) {
			const b = this.spec[i], c = b.c;
			const y = c[0] * m + b.z1;
			b.z1 = c[1] * m - c[3] * y + b.z2;
			b.z2 = c[2] * m - c[4] * y;
			const a = y < 0 ? -y : y;
			b.env = a > b.env ? a : b.env * rel;
		}
		const a = m < 0 ? -m : m;
		this.peak = a > this.peak ? a : this.peak * rel;
		return 0;
	}

	endBlock() {}
	state() {
		const lv = this.levels;
		for (let i = 0; i < NB; i++) {
			const e = this.spec[i].env;
			lv[i] = e > 1e-5 ? Math.round(20 * Math.log10(e) * 10) / 10 : -100;
			if (!(lv[i] == lv[i])) lv[i] = -100; // a NaN after a blow-up
		}
		return { spec: lv.slice(), peak: this.peak };
	}
}
EqDSP.OUT_IDS = OUT_IDS;
EqDSP.IN_IDS = IN_IDS;
EqDSP.MIDI_IN = null;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.eq = EqDSP;

})();
