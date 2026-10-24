// devices/css90-worklet.js
// CSS 90 DSP (an eight voice polysynth with two complete channels a voice), hosted by the rack
// processor. Polyphonic: it gets the raw MIDI notes of its channel (POLY) and plays them on 8 voices.
// Each voice has CHANNEL I and CHANNEL II, the same chain twice: a VCO (sawtooth and / or square
// with PW and its own PWM, noise; FEET 16' 8' 4'), a 12 dB high-pass then a 12 dB low-pass filter
// with resonance, the filter envelope (IL initial level, AL attack level, A, D, R), a sine that
// skips the filters, the VCA envelope (A, D, S, R) and LEVEL; velocity (INITIAL) and per note
// pressure (AFTER) to the brilliance and the level of each channel. Shared: the SUB OSCILLATOR (6
// functions, with FADE) to pitch, filters and level; KEYBOARD CONTROL (brilliance and level scaled
// across the keys); AFTER TOUCH to pitch and vibrato; the RING MODULATOR (with its own attack and
// decay); PORTAMENTO or GLISSANDO; DETUNE of channel II; BRILLIANCE and RESONANCE offsets; the
// ribbon; then CHORUS or TREMOLO in stereo.

(function(){

const IN_IDS = ["brill_in", "vol_in", "sus_in"];
const OUT_IDS = ["out_l", "out_r", "pitch_out", "gate_out", "sub_out", "ribbon_out"];
const I_BRILL = 0, I_VOL = 1, I_SUS = 2;
const O_L = 0, O_R = 1, O_PITCH = 2, O_GATE = 3, O_SUB = 4, O_RIB = 5;
const VOICES = 8;
const CTRL = 16; // samples between control updates
const C4 = 261.6255653005986;
const DECAY_TC = Math.log(1 / 0.01);
const ATTACK_TARGET = 1.3, ATTACK_TC = Math.log(ATTACK_TARGET / (ATTACK_TARGET - 1));
const FEET = { 16: -1, 8: 0, 4: 1 };

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}
function polyblep(t, dt) {
	if (t < dt) { t /= dt; return t + t - t * t - 1; }
	if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
	return 0;
}
// sin(2 pi t) for a phase t in 0..1, a polynomial (0.1% off)
function sin1(t) {
	t -= Math.floor(t);
	const y = 1 - 2 * t, a = y < 0 ? -y : y, q = 4 * y * (1 - a);
	return q * (0.775 + 0.225 * (q < 0 ? -q : q));
}
// a time slider 0..1: 2 ms .. 10 s (css90.js: the same)
function tm(v) { return 0.002 * Math.pow(5000, clamp(v, 0, 1)); }

class Line {
	constructor(n) { this.b = new Float32Array(n); this.n = n; this.w = 0; }
	write(x) { this.b[this.w] = x; if (++this.w >= this.n) this.w = 0; }
	read(d) {
		d = d < 1 ? 1 : (d > this.n - 2 ? this.n - 2 : d);
		let p = this.w - d; if (p < 0) p += this.n;
		let i = p | 0; if (i >= this.n) i -= this.n;
		const f = p - Math.floor(p), a = this.b[i], b = this.b[i + 1 < this.n ? i + 1 : 0];
		return a + (b - a) * f;
	}
}

function newChannel() {
	return {
		t: Math.random(), dt: 0, pwmPh: Math.random(), pw: 0.5,
		h1: 0, h2: 0, l1: 0, l2: 0,                // the filters' states
		ha1: 0, ha2: 0, ha3: 0, hk: 2, hpOn: false,  // high-pass coefficients
		la1: 0, la2: 0, la3: 0, lk: 2,               // low-pass coefficients
		fe: 0, fs: 0, fp: 0, f0: 0,                  // filter envelope: value, stage, progress, start
		ae: 0, as: 0, amp: 0, ainc: 0                // VCA envelope, the gain now and its step
	};
}
function newVoice(i) {
	return {
		index: i, note: 60, vel: 1, gate: false, age: 0, pitch: 0, target: 0, from: 0, glideT: 1,
		pp: 0, fade: 1, ring: 0, rs: 0, ringPh: 0, ringDt: 0,
		drift: (Math.random() * 2 - 1) * 0.0025,     // each voice card a little out of tune
		ch: [newChannel(), newChannel()]
	};
}

class CSS90DSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.voices = []; for (let i = 0; i < VOICES; i++) this.voices.push(newVoice(i));
		this.clock = 0; this.next = 0; this.ctrl = 0;
		this.keys = [];
		this.sustained = new Set(); this.pedal = false; this.susHigh = false;
		this.lastPitch = null; this.lastVoice = null;
		this.bend = 0; this.wheel = 0; this.press = 0; this.ribbon = 0;
		this.subPh = 0; this.subHold = 0; this.sub = 0; this.subU = 0;
		this.chL = new Line(Math.round(sampleRate * 0.04)); this.chR = new Line(Math.round(sampleRate * 0.04));
		this.chPh = 0; this.trPh = 0;
	}

	message(m) {
		switch (m.type) {
			case "note": m.on ? this.keyOn(m.note, m.vel === undefined ? 1 : m.vel) : this.keyOff(m.note); break;
			case "trigger": m.gate ? this.keyOn(60, 1) : this.keyOff(60); break;
			case "allNotesOff": this.keys = []; this.sustained.clear(); for (const v of this.voices) if (v.gate) this.release(v); break;
			case "bend": this.bend = m.value; break;
			case "modwheel": this.wheel = clamp(m.value, 0, 1); break;
			case "pressure": this.press = clamp(m.value, 0, 1); break;
			case "polypressure": for (const v of this.voices) if (v.gate && v.note === m.note) v.pp = clamp(m.value, 0, 1); break;
			case "sustain": this.setPedal(!!m.value); break;
			case "ribbon": this.ribbon = clamp(+m.value || 0, -2, 2); break; // octaves
		}
	}

	setSettings(s) { const first = !this.s; this.s = s; if (first) this.coefs(); }
	setMidiConnected(c) {
		if (!c && this.midiConnected) this.message({ type: "allNotesOff" });
		this.midiConnected = c;
	}

	keyOn(note, vel) {
		this.sustained.delete(note);
		this.keys = this.keys.filter(k => k !== note); this.keys.push(note);
		// the same note again, else the next free voice in turn, else the one released longest ago, else the oldest
		let v = this.voices.find(x => x.note === note && (x.gate || x.ch[0].as || x.ch[1].as));
		if (!v) {
			for (let k = 0; k < VOICES && !v; k++) { const c = this.voices[(this.next + k) % VOICES]; if (!c.gate && !c.ch[0].as && !c.ch[1].as) v = c; }
			if (!v) v = this.voices.filter(x => !x.gate).sort((a, b) => a.age - b.age)[0] || this.voices.slice().sort((a, b) => a.age - b.age)[0];
			this.next = (v.index + 1) % VOICES;
		}
		const s = this.s, target = (note - 60) / 12;
		// PORTAMENTO / GLISSANDO: from the last note played
		const glide = s.porta.time > 0.005 && this.lastPitch !== null;
		if (glide) { v.from = (v.gate || v.ch[0].as || v.ch[1].as) ? v.pitch : this.lastPitch; v.pitch = v.from; v.glideT = 0; }
		else { v.pitch = target; v.glideT = 1; }
		v.target = target; v.note = note; v.vel = vel; v.gate = true; v.age = ++this.clock; v.pp = 0;
		v.fade = s.sub.fade > 0.01 ? 0 : 1;
		v.rs = 1; if (v.ring < 1e-4) v.ring = 0;
		for (const c of v.ch) {
			const idle = !c.as || c.ae < 1e-4;
			if (!c.as) { c.ae = 0; c.amp = 0; }
			c.as = 1; c.fs = 1; c.fp = 0; c.f0 = idle ? null : c.fe; // null: from IL
		}
		this.lastPitch = target; this.lastVoice = v;
		this.ctrlVoice(v);
	}
	keyOff(note) {
		this.keys = this.keys.filter(k => k !== note);
		if (this.held()) { this.sustained.add(note); return; }
		for (const v of this.voices) if (v.note === note && v.gate) this.release(v);
	}
	release(v) {
		v.gate = false;
		for (const c of v.ch) { if (c.as) c.as = 4; if (c.fs) { c.fs = 4; c.fp = 0; c.f0 = c.fe; } }
		v.rs = v.rs ? 3 : 0;
	}
	held() { return this.pedal || (this.patched[I_SUS] && this.ins[I_SUS] > 1); }
	setPedal(on) {
		this.pedal = on;
		if (!this.held() && this.sustained.size) {
			const n = Array.from(this.sustained); this.sustained.clear();
			for (const k of n) for (const v of this.voices) if (v.note === k && v.gate) this.release(v);
		}
	}

	coefs() {
		const s = this.s, sr = sampleRate;
		// the VCA envelopes advanced by a control step
		this.ac = s.ch.map(c => [
			1 - Math.pow(1 - (1 - Math.exp(-ATTACK_TC / (tm(c.a) * sr))), CTRL),
			Math.pow(Math.exp(-DECAY_TC / (tm(c.d) * sr)), CTRL),
			Math.pow(Math.exp(-DECAY_TC / (tm(c.r) * sr)), CTRL)
		]);
	}

	beginBlock(n) {
		const s = this.s;
		this.coefs();
		this.vol = s.volume * s.volume * 1.6;
		// the SUS jack let go
		const sh = this.patched[I_SUS] && this.ins[I_SUS] > 1;
		if (sh !== this.susHigh) { this.susHigh = sh; this.setPedal(this.pedal); }
	}

	// the SUB OSCILLATOR, at control rate: bipolar sub, unipolar subU
	subStep() {
		const S = this.s.sub, rate = 0.1 * Math.pow(500, S.speed); // 0.1 .. 50 Hz
		this.subPh += rate * CTRL / sampleRate;
		if (this.subPh >= 1) { this.subPh -= Math.floor(this.subPh); this.subHold = Math.random() * 2 - 1; }
		const ph = this.subPh;
		switch (S.func) {
			case "square": this.sub = ph < 0.5 ? 1 : -1; break;
			case "sawup": this.sub = 2 * ph - 1; break;
			case "sawdn": this.sub = 1 - 2 * ph; break;
			case "random": this.sub = this.subHold; break;
			case "noise": this.sub += (Math.random() * 2 - 1 - this.sub) * 0.5; break;
			default: this.sub = Math.sin(2 * Math.PI * ph);
		}
		this.subU = 0.5 + 0.5 * this.sub;
	}

	// control rate: pitch, the filter envelopes and cutoffs, the VCA envelopes and gains
	ctrlVoice(v) {
		const s = this.s, sr = sampleRate, P = s.porta;
		if (v.glideT < 1) {
			const time = 0.01 + P.time * P.time * 3;
			v.glideT = Math.min(1, v.glideT + CTRL / (time * sr));
			v.pitch = v.from + (v.target - v.from) * v.glideT;
		}
		else v.pitch = v.target;
		let pitch = P.mode === 1 && v.glideT < 1 ? Math.round(v.pitch * 12) / 12 : v.pitch; // GLISSANDO: in semitones
		if (v.fade < 1) v.fade = Math.min(1, v.fade + CTRL / (s.sub.fade * s.sub.fade * 4 * sr));
		const press = Math.max(v.pp, this.press), T = s.touch, S = s.sub;
		// vibrato: the SUB OSC's VCO depth, the mod wheel, AFTER TOUCH VIBRATO; AFTER TOUCH PITCH bends
		const vib = (S.vco * S.vco * 2 + this.wheel * 0.6 + press * T.vib * 0.8) / 12 * v.fade;
		pitch += this.sub * vib + press * T.pitch * 2 / 12 + this.bend + this.ribbon + v.drift + s.tune / 1200;
		// KEYBOARD CONTROL: low and high halves of the keys scale brilliance and level
		const key = clamp((v.note - 60) / 30, -1, 1), K = s.kbd;
		const kBr = key < 0 ? -key * K.blo * 3 : key * K.bhi * 3;
		const kLv = Math.max(0, 1 + (key < 0 ? -key * K.llo : key * K.lhi));
		const cv = this.patched[I_BRILL] ? this.ins[I_BRILL] : 0;
		const common = s.brill * 3 + kBr + v.target * 0.6 + this.sub * S.vcf * S.vcf * 3 * v.fade + cv;
		const trem = 1 - S.vca * (1 - this.subU) * v.fade;
		const bal = clamp(s.balance, 0, 1), resAdd = s.res * 0.5;
		for (let ci = 0; ci < 2; ci++) {
			const c = v.ch[ci], C = s.ch[ci];
			// VCO
			const p = pitch + FEET[C.feet] + (ci === 1 ? s.detune * 0.3 / 12 : 0);
			c.dt = clamp(C4 * Math.pow(2, p) / sr, 0, 0.45);
			if (C.pwm > 0.005) { c.pwmPh += 0.1 * Math.pow(100, C.pwm) * CTRL / sr; if (c.pwmPh >= 1) c.pwmPh -= 1; }
			c.pw = clamp(C.pw + (C.pwm > 0.005 ? Math.sin(2 * Math.PI * c.pwmPh) * 0.35 * Math.min(1, C.pwm * 4) : 0), 0.04, 0.96);
			// filter envelope: IL -> AL in A, -> 0 in D, sustain 0, -> IL in R
			if (c.fs === 1) {
				if (c.f0 === null) c.f0 = C.il;
				c.fp += CTRL / (tm(C.fa) * sr);
				if (c.fp >= 1) { c.fe = C.al; c.fs = 2; c.fp = 0; c.f0 = C.al; } else c.fe = c.f0 + (C.al - c.f0) * c.fp;
			}
			else if (c.fs === 2) {
				c.fp += CTRL / (tm(C.fd) * sr);
				if (c.fp >= 1) { c.fe = 0; c.fs = 3; } else c.fe = c.f0 * (1 - c.fp);
			}
			else if (c.fs === 3) c.fe = 0;
			else if (c.fs === 4) {
				c.fp += CTRL / (tm(C.fr) * sr);
				if (c.fp >= 1) { c.fe = C.il; c.fs = 0; } else c.fe = c.f0 + (C.il - c.f0) * c.fp;
			}
			else c.fe = C.il;
			// the filters: slider, envelope, INITIAL and AFTER brilliance, the shared offsets
			const off = common + c.fe * 5 + (v.vel - 0.6) * C.ibr * 4 + press * C.abr * 4;
			c.hpOn = C.hpf > 0.01 || C.hres > 0.05;
			if (c.hpOn) {
				const f = clamp(20 * Math.pow(2, C.hpf * 10 + off), 20, sr * 0.42), g = Math.tan(Math.PI * f / sr);
				c.hk = 2 - 1.9 * clamp(C.hres + resAdd, 0, 1);
				c.ha1 = 1 / (1 + g * (g + c.hk)); c.ha2 = g * c.ha1; c.ha3 = g * c.ha2;
			}
			const f = clamp(20 * Math.pow(2, C.lpf * 10 + off), 20, sr * 0.42), g = Math.tan(Math.PI * f / sr);
			c.lk = 2 - 1.96 * clamp(C.lres + resAdd, 0, 1);
			c.la1 = 1 / (1 + g * (g + c.lk)); c.la2 = g * c.la1; c.la3 = g * c.la2;
			// VCA envelope (stages: 0 idle, 1 attack, 2 decay, 3 sustain, 4 release)
			const ac = this.ac[ci];
			if (c.as === 1) { c.ae += (ATTACK_TARGET - c.ae) * ac[0]; if (c.ae >= 1) { c.ae = 1; c.as = 2; } }
			else if (c.as === 2) { c.ae = C.s + (c.ae - C.s) * ac[1]; if (Math.abs(c.ae - C.s) < 1e-4) c.as = 3; }
			else if (c.as === 3) { c.ae = C.s; if (!v.gate) c.as = 4; }
			else if (c.as === 4) { c.ae *= ac[2]; if (c.ae < 1e-5) { c.ae = 0; c.as = 0; } }
			let gain = C.level * C.level * (1 - C.ilv * (1 - v.vel)) * (1 + C.alv * (press * 1.5 - 0.5)) * kLv * trem;
			gain *= ci === 0 ? Math.min(1, 2 - 2 * bal) : Math.min(1, 2 * bal);
			c.ainc = (c.ae * gain - c.amp) / CTRL;
		}
		// RING MODULATOR: its depth rises in ATTACK, then falls in DECAY (DECAY at the top: it stays)
		const R = s.ring;
		if (R.depth > 0.005) {
			if (v.rs === 1) { v.ring += CTRL / (tm(R.a) * 0.5 * sr); if (v.ring >= 1) { v.ring = 1; v.rs = 2; } }
			else if (v.rs >= 2 && R.d < 0.99) v.ring *= Math.exp(-DECAY_TC * CTRL / (tm(R.d) * sr));
			v.ringDt = 0.5 * Math.pow(4000, R.speed) / sr;
		}
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs;
		if (--this.ctrl < 0) {
			this.ctrl = CTRL - 1;
			this.subStep();
			for (const v of this.voices) if (v.gate || v.ch[0].as || v.ch[1].as) this.ctrlVoice(v);
		}
		const C0 = s.ch[0], C1 = s.ch[1], R = s.ring, ringOn = R.depth > 0.005;
		let out = 0, anyGate = false;
		for (let vi = 0; vi < VOICES; vi++) {
			const v = this.voices[vi];
			if (!v.ch[0].as && !v.ch[1].as) continue;
			anyGate = anyGate || v.gate;
			let y = 0;
			for (let ci = 0; ci < 2; ci++) {
				const c = v.ch[ci], C = ci ? C1 : C0;
				if (!c.as) continue;
				c.amp += c.ainc;
				const dt = c.dt;
				c.t += dt; if (c.t >= 1) c.t -= 1;
				const t = c.t;
				let x = 0;
				if (C.saw) x += 2 * t - 1 - polyblep(t, dt);
				if (C.sqr) {
					const w = c.pw;
					let t2 = t + 1 - w; if (t2 >= 1) t2 -= 1;
					x += (t < w ? 1 : -1) + polyblep(t, dt) - polyblep(t2, dt);
				}
				if (C.noise > 0.002) x += (Math.random() * 2 - 1) * C.noise * 1.4;
				x = fastTanh(x * 0.6);
				// 12 dB HIGH-PASS, then 12 dB LOW-PASS (TPT state variable)
				if (c.hpOn) {
					const v3 = x - c.h2, v1 = c.ha1 * c.h1 + c.ha2 * v3, v2 = c.h2 + c.ha2 * c.h1 + c.ha3 * v3;
					c.h1 = 2 * v1 - c.h1; c.h2 = 2 * v2 - c.h2;
					x = x - c.hk * v1 - v2;
				}
				const v3 = x - c.l2, v1 = c.la1 * c.l1 + c.la2 * v3, v2 = c.l2 + c.la2 * c.l1 + c.la3 * v3;
				c.l1 = 2 * v1 - c.l1; c.l2 = fastTanh(2 * v2 - c.l2);
				let o = v2;
				// SINE: straight to the VCA
				if (C.sine > 0.002) o += sin1(t) * C.sine;
				y += o * c.amp;
			}
			if (ringOn) {
				v.ringPh += v.ringDt; if (v.ringPh >= 1) v.ringPh -= 1;
				const d = R.depth * v.ring;
				y *= 1 - d + d * sin1(v.ringPh);
			}
			out += y;
		}
		const lv = this.lastVoice || this.voices[0];
		outs[O_PITCH] = lv.target;
		outs[O_GATE] = anyGate ? 5 : 0;
		outs[O_SUB] = this.sub * 5;
		outs[O_RIB] = this.ribbon * 5;
		let l = out * 0.3, r = l;
		// CHORUS (two moving taps a side) or TREMOLO (the sides in turn)
		const CH = s.chorus;
		if (CH.mode === 1) {
			const sr = sampleRate;
			this.chPh += (0.1 * Math.pow(60, CH.speed)) / sr; if (this.chPh >= 1) this.chPh -= 1;
			const a = this.chPh, dep = 0.0035 * sr * CH.depth, base = 0.009 * sr;
			this.chL.write(l); this.chR.write(l);
			const wl = this.chL.read(base + dep * sin1(a)) + this.chL.read(base * 1.4 + dep * sin1(a + 0.33)) * 0.7;
			const wr = this.chR.read(base + dep * sin1(a + 0.25)) + this.chR.read(base * 1.4 + dep * sin1(a + 0.58)) * 0.7;
			l = l * 0.6 + wl * 0.5; r = r * 0.6 + wr * 0.5;
		}
		else if (CH.mode === 2) {
			this.trPh += (0.5 * Math.pow(30, CH.speed)) / sampleRate; if (this.trPh >= 1) this.trPh -= 1;
			const m = sin1(this.trPh) * CH.depth;
			l *= 1 - 0.5 * CH.depth + 0.5 * m; r *= 1 - 0.5 * CH.depth - 0.5 * m;
		}
		const vol = this.vol * (this.patched[I_VOL] ? clamp(ins[I_VOL] / 5, 0, 1) : 1);
		outs[O_L] = fastTanh(l * vol); outs[O_R] = fastTanh(r * vol);
		return outs[O_L];
	}

	endBlock(n) {}

	state() {
		return {
			gates: this.voices.map(v => v.gate ? v.note : -1),
			voices: this.voices.filter(v => v.ch[0].as || v.ch[1].as).length,
			sub: Math.round(this.subU * 100) / 100
		};
	}
}
CSS90DSP.OUT_IDS = OUT_IDS;
CSS90DSP.IN_IDS = IN_IDS;
CSS90DSP.MIDI_IN = "midi_in";
CSS90DSP.POLY = true;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.css90 = CSS90DSP;

})();
