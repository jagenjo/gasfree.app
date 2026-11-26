// devices/hammer-worklet.js
// HAMMER 88 DSP: an electric piano made by physical modelling, no samples. Each key has its own
// vibrating bar, struck by its own felt hammer, read by its own pickup:
//   the bar: TINE (a thin steel rod clamped at one end, under a tuned tone bar) or REED (a flat steel
//     reed with a lump of solder at its tip). Its motion is the sum of its bending modes (a clamped-free
//     beam: 1, 6.27, 17.55, 34.39 times the fundamental, stretched a little), each a damped oscillator
//     kept as a rotating phasor (exact at any frequency). High modes die fast, the fundamental rings.
//   the hammer: a mass thrown at the bar at the key's velocity, a felt spring between them
//     (F = K * compression ^ 2.5, the felt gets stiffer as it is squeezed). The contact lasts as long
//     as the physics says: a harder blow squeezes the felt more, the contact is shorter and the bar
//     gets more of its high modes, so loud notes are brighter by themselves. A key played again hits
//     the bar as it is still moving.
//   the TINE's tone bar: a second resonator, tuned near the tine, driven by it: it keeps the
//     fundamental going and, a little out of tune (AGE), beats against it.
//   the pickup: TINE: electromagnetic, a coil and a magnet: the voltage is the change of the flux,
//     the field's slope at the tine tip times its speed. The field falls off around the magnet's axis
//     (1 / (1 + u^2)), so a tine aimed at the centre gives mostly the octave (a bell), one aimed off
//     centre (ALIGN) more fundamental, and a big swing near the magnet (PICKUP) the bark.
//     REED: electrostatic: the reed moves past a charged plate, the voltage follows the capacitance,
//     the displacement itself through the same kind of curve: the nasal, buzzy growl when hit hard.
//   the dampers: felt on the bar while the key is up (RELEASE: how fast it stops the bar), lifted by
//     the sustain pedal or the SUS jack. The top keys of a tine piano have no dampers, as on the
//     instrument. MECH: the thump of the hammer and of the dampers falling, from the same forces.
//   then the amp: a preamp (DRIVE, a tube for TINE, a transistor stage for REED), BASS and TREBLE,
//   the TREMOLO (STEREO: the sound goes from side to side; else the level goes up and down) and VOLUME.
// One voice per key (24 at once); POLY: raw notes. PITCH / GATE / VEL jacks play one more note.

(function(){

const IN_IDS = ["pitch_in", "gate_in", "vel_in", "sus_in", "trem_in"];
const OUT_IDS = ["out_l", "out_r", "trem_out"];
const I_PITCH = 0, I_GATE = 1, I_VEL = 2, I_SUS = 3, I_TREM = 4;
const O_L = 0, O_R = 1, O_TREM = 2;
const VOICES = 24;
const MODES = 5;           // 4 bending modes + the tone bar (TINE) / a torsion mode (REED)
const SUB = 4;             // substeps while the hammer touches the bar
const P_FELT = 2.5;        // felt: F = K x^p
const BEAM = [1, 6.267, 17.55, 34.39];
const UNDAMPED = 96;       // TINE: the keys from this one up have no dampers

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function tanh(x) { if (x < -3) return -1; if (x > 3) return 1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
function sin1(t) { t -= Math.floor(t); const y = 1 - 2 * t, a = y < 0 ? -y : y, q = 4 * y * (1 - a); return q * (0.775 + 0.225 * (q < 0 ? -q : q)); }
// the same random numbers for a key every time: its little faults (AGE)
function keyRand(note, k) { let x = Math.sin(note * 12.9898 + k * 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

class Voice {
	constructor() {
		this.note = -1; this.gate = false; this.sleep = true; this.age = 0;
		this.re = new Float64Array(MODES); this.im = new Float64Array(MODES);  // the phasors: q + i v / w
		this.w = new Float64Array(MODES);        // rad / s
		this.cr = new Float64Array(MODES); this.ci = new Float64Array(MODES);   // one sample: r e^-iwt
		this.sr_ = new Float64Array(MODES); this.si = new Float64Array(MODES);  // one substep
		this.rFree = new Float64Array(MODES); this.rDamp = new Float64Array(MODES);
		this.fr = new Float64Array(MODES); this.fi = new Float64Array(MODES);   // one sample, free
		this.dr = new Float64Array(MODES); this.di = new Float64Array(MODES);   // one sample, damped
		this.on = new Uint8Array(MODES);         // the modes still moving
		this.strike = new Float64Array(MODES);   // the mode's share at the hammer's point
		this.tip = new Float64Array(MODES);      // ... at the tip, seen by the pickup
		this.mass = 1;
		this.hx = 0; this.hv = 0; this.hk = 0; this.hmass = 1; this.contact = false; // the hammer
		this.damped = true; this.thump = 0; this.level = 0; this.align = 0; this.wfield = 1;
		this.bar = 0;  // TINE: the tone bar's coupling
	}
}

class HammerDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.voices = []; for (let i = 0; i < VOICES; i++) this.voices.push(new Voice());
		this.clock = 0;
		this.pedal = false; this.sustained = new Set(); this.down = new Set();
		this.bend = 0; this.gateHigh = false; this.cvNote = -1;
		this.trPh = 0; this.trem = 0;
		this.dc = [0, 0]; this.lo = [0, 0]; this.hi = [0, 0]; this.mech = 0; this.mechLp = 0;
		this.peak = 0;
		this.dt = 1 / sampleRate;
	}
	setSettings(s) { this.s = s; this.prepared = false; }
	setMidiConnected(c) { if (!c && this.midiConnected) this.message({ type: "allNotesOff" }); this.midiConnected = c; }

	message(m) {
		switch (m.type) {
			case "note": m.on ? this.keyOn(m.note, m.vel === undefined ? 0.8 : m.vel) : this.keyOff(m.note); break;
			case "trigger": m.gate ? this.keyOn(60, 0.8) : this.keyOff(60); break;
			case "allNotesOff": this.down.clear(); this.sustained.clear(); for (const v of this.voices) if (v.note >= 0) { v.gate = false; this.damp(v); } break;
			case "bend": this.bend = m.value; for (const v of this.voices) if (!v.sleep) this.tune(v); break;
			case "sustain": this.setPedal(!!m.value); break;
		}
	}
	held() { return this.pedal || (this.patched[I_SUS] && this.ins[I_SUS] > 1); }
	setPedal(on) {
		this.pedal = on;
		const h = this.held();
		for (const v of this.voices) if (v.note >= 0 && !v.gate) { if (h) v.damped = false; else this.damp(v); }
	}
	damp(v) {
		if (this.s.mode === "tine" && v.note >= UNDAMPED) return;
		if (!v.damped && v.level > 0.01) v.thump -= 0.4 * Math.min(1, v.level); // the felt landing on the bar
		v.damped = true;
	}

	// the voice for a key: its own if it still rings, else a sleeping one, else the quietest
	voiceFor(note) {
		let v = this.voices.find(x => x.note === note);
		if (v) return { v, fresh: v.sleep };
		v = this.voices.find(x => x.sleep);
		if (!v) { v = this.voices[0]; for (const x of this.voices) if (!x.gate && (v.gate || x.level < v.level)) v = x; }
		return { v, fresh: true };
	}

	keyOn(note, vel) {
		note = clamp(Math.round(note), 0, 127);
		const r = this.voiceFor(note), v = r.v;
		this.down.add(note); this.sustained.delete(note);
		if (r.fresh || v.note !== note) {
			v.note = note;
			for (let k = 0; k < MODES; k++) { v.re[k] = 0; v.im[k] = 0; }
			this.build(v);
		}
		v.gate = true; v.damped = false; v.sleep = false; v.age = ++this.clock;
		// the hammer: thrown at the bar from just under it, at the key's speed
		const s = this.s, speed = 0.06 + 0.94 * Math.pow(clamp(vel, 0, 1), 1.25);
		for (let k = 0; k < MODES; k++) v.on[k] = v.w[k] ? 1 : 0;
		v.hx = this.strikePos(v) - 1e-9; v.hv = speed; v.contact = true; v.touched = false;
	}
	keyOff(note) {
		this.down.delete(note);
		for (const v of this.voices) if (v.note === note && v.gate) {
			v.gate = false;
			if (this.held()) { v.damped = false; this.sustained.add(note); } else this.damp(v);
		}
	}
	strikePos(v) { let x = 0; for (let k = 0; k < MODES; k++) x += v.strike[k] * v.re[k]; return x; }

	// a key's bar, hammer and pickup from the settings
	build(v) {
		const s = this.s, sr = sampleRate, n = v.note, reed = s.mode === "reed";
		const age = s.age;
		const f0 = 440 * Math.pow(2, (n - 69) / 12 + s.tune / 1200 + age * keyRand(n, 1) * 0.0008);
		const key = clamp((n - 21) / 87, 0, 1); // 0 the lowest key, 1 the highest
		v.f0 = f0;
		// the modes: frequency ratios, decay (T60), share at the hammer and at the tip
		const stretch = 1 + 0.03 * key;
		const t60 = (reed ? 5 : 7.5) * Math.pow(2, s.decay * 3 - 1.5) * Math.pow(110 / f0, reed ? 0.55 : 0.5) * (1 + age * keyRand(n, 2) * 0.2);
		v.ratio = new Float64Array(MODES);
		for (let k = 0; k < 4; k++) {
			// the TINE's tuning spring and the REED's solder lump lower the overtones a little
			const r = k === 0 ? 1 : BEAM[k] * (reed ? 1.08 : 1.0) * Math.pow(stretch, k);
			v.ratio[k] = r;
			const t = k === 0 ? t60 : t60 * (reed ? 0.12 : 0.05) / Math.pow(r, 0.7);
			v.t60 = v.t60 || []; v.t60[k] = t;
		}
		// the tone bar (TINE), tuned a little off the tine; a torsion mode (REED) between 2 and 3
		v.ratio[4] = reed ? 3.9 + 0.6 * key : 1 + (0.0012 + age * 0.006) * (keyRand(n, 3) + 1.2);
		v.t60[4] = reed ? t60 * 0.08 : t60 * 1.6;
		// the hammer meets the bar near its clamp: little of the fundamental there, more of the overtones
		const sh = reed ? [1, 0.75, 0.42, 0.2, 0.25] : [1, 0.55, 0.3, 0.16, 0];
		const tp = reed ? [1, 0.38, 0.17, 0.08, 0.12] : [1, 0.5, 0.26, 0.13, 0];
		for (let k = 0; k < MODES; k++) { v.strike[k] = sh[k]; v.tip[k] = tp[k]; }
		v.bar = reed ? 0 : 0.35 + 0.4 * (1 - key);
		// felt: harder (HAMMER) gives a shorter contact; the high keys have harder, smaller hammers
		const w0 = 2 * Math.PI * f0;
		v.mass = 1;                                   // the bar's modal mass
		v.hmass = reed ? 0.55 : 0.8;                  // the hammer's
		const tc = (reed ? 0.0011 : 0.0024) * Math.pow(0.18, s.hammer) * Math.pow(220 / f0, 0.35); // contact time for a medium blow
		const tcl = Math.min(tc, 0.45 / f0);
		// for F = K x^p: compression at a medium speed (0.5), then K from the energy
		const mEff = 1 / (1 / v.hmass + 1 / v.mass), vr = 0.5, xm = vr * tcl / 2.9;
		v.hk = (P_FELT + 1) * mEff * vr * vr / (2 * Math.pow(xm, P_FELT + 1));
		v.fscale = tcl / mEff * 0.6;                  // the force, scaled to about the key's speed (MECH)
		v.xscale = w0;                                // the tip's swing seen by the pickup, about the key's speed
		// the pickup: ALIGN (where the tip points) and PICKUP (how near: the field's width)
		v.align = clamp(s.align + age * keyRand(n, 4) * 0.25, -1, 1);
		v.wfield = (0.22 + 2.2 * Math.pow(1 - s.pickup, 1.5)) * (reed ? 0.5 : 1);
		v.gain = 1;
		this.tune(v);
	}
	// the rotations of each mode (the pitch bend moves them)
	tune(v) {
		const sr = sampleRate, b = Math.pow(2, this.bend), rel = 0.012 + Math.pow(this.s.release, 2) * 0.6;
		for (let k = 0; k < MODES; k++) {
			const f = Math.min(v.f0 * v.ratio[k] * b, sr * 0.45);
			const w = 2 * Math.PI * f, live = v.f0 * v.ratio[k] * b < sr * 0.45 && v.f0 * v.ratio[k] < 18000;
			v.w[k] = live ? w : 0;
			const r = Math.exp(-6.9078 / (v.t60[k] * sr));
			v.rFree[k] = r;
			v.rDamp[k] = Math.min(r, Math.exp(-6.9078 / (rel * Math.pow(Math.max(1, v.ratio[k]), 0.3) * sr)));
			v.cr[k] = Math.cos(w / sr); v.ci[k] = -Math.sin(w / sr);
			v.fr[k] = v.cr[k] * r; v.fi[k] = v.ci[k] * r; v.dr[k] = v.cr[k] * v.rDamp[k]; v.di[k] = v.ci[k] * v.rDamp[k];
			v.on[k] = live ? 1 : 0;
			v.sr_[k] = Math.cos(w / sr / SUB); v.si[k] = -Math.sin(w / sr / SUB);
			if (!live) { v.re[k] = 0; v.im[k] = 0; }
		}
	}

	prepare() {
		this.prepared = true;
		for (const v of this.voices) if (!v.sleep) { const re = v.re.slice(), im = v.im.slice(); this.build(v); v.re.set(re); v.im.set(im); }
		const s = this.s, sr = sampleRate;
		this.bassK = 1 - Math.exp(-2 * Math.PI * 250 / sr);
		this.trebK = 1 - Math.exp(-2 * Math.PI * 2500 / sr);
		this.dcK = 1 - Math.exp(-2 * Math.PI * 18 / sr);
	}

	beginBlock(n) {
		if (!this.prepared) this.prepare();
		const sh = this.patched[I_SUS] && this.ins[I_SUS] > 1;
		if (sh !== this.susHigh) { this.susHigh = sh; this.setPedal(this.pedal); }
		// PITCH / GATE / VEL: one more key
		if (this.patched[I_GATE]) {
			const g = this.ins[I_GATE] > 1;
			if (g && !this.gateHigh) {
				this.cvNote = clamp(Math.round(60 + (this.patched[I_PITCH] ? this.ins[I_PITCH] : 0) * 12), 0, 127);
				this.keyOn(this.cvNote, this.patched[I_VEL] ? clamp(this.ins[I_VEL] / 5, 0, 1) : 0.8);
			}
			else if (!g && this.gateHigh && this.cvNote >= 0) { this.keyOff(this.cvNote); this.cvNote = -1; }
			this.gateHigh = g;
		}
	}

	// one sample of one voice: the hammer (while it touches), the modes, the pickup
	voiceTick(v, reed) {
		const re = v.re, im = v.im, w = v.w;
		let thump = 0;
		if (v.contact) {
			// substeps: hammer and modes together (the force pushes the bar, the bar pushes back)
			const dt = this.dt / SUB;
			for (let j = 0; j < SUB; j++) {
				let xs = 0; for (let k = 0; k < MODES; k++) xs += v.strike[k] * re[k];
				const d = v.hx - xs;
				let F = 0;
				if (d > 0) F = v.hk * Math.pow(d, P_FELT);
				v.hv -= F / v.hmass * dt; v.hx += v.hv * dt;
				for (let k = 0; k < MODES; k++) {
					if (!w[k]) continue;
					// a push changes the velocity: v / w is the phasor's imaginary part
					im[k] += v.strike[k] * F / v.mass * dt / w[k];
					const a = re[k], b = im[k], c = v.sr_[k], s = v.si[k];
					re[k] = a * c - b * s; im[k] = a * s + b * c;
				}
				thump += F;
				if (d > 0) v.touched = true;
				// it has left the bar: the escapement lets it fall back, done
				if (d <= 0 && (v.touched || v.hv < 0)) { v.contact = false; for (; j + 1 < SUB; j++) for (let k = 0; k < MODES; k++) { if (!w[k]) continue; const a = re[k], b = im[k], c = v.sr_[k], s = v.si[k]; re[k] = a * c - b * s; im[k] = a * s + b * c; } break; }
			}
			// the decay, for the whole sample
			for (let k = 0; k < MODES; k++) { const r = v.rFree[k]; re[k] *= r; im[k] *= r; }
			thump /= SUB;
		}
		else {
			const CR = v.damped ? v.dr : v.fr, CI = v.damped ? v.di : v.fi, on = v.on;
			for (let k = 0; k < MODES; k++) {
				if (!on[k]) continue;
				const a = re[k], b = im[k], c = CR[k], s = CI[k];
				re[k] = a * c - b * s; im[k] = a * s + b * c;
			}
		}
		// TINE: the tone bar is driven by the tine's fundamental
		if (!reed && w[4]) im[4] += v.bar * 0.003 * re[0] * w[0] * w[0] * this.dt / w[4];
		// the tip: displacement and speed, scaled to about the key's speed
		let x = 0, xd = 0;
		for (let k = 0; k < MODES; k++) { if (!v.on[k]) continue; const t = v.tip[k]; x += t * re[k]; xd -= t * im[k] * w[k]; }
		if (!reed) { x += v.bar * re[4] * 0.6; xd -= v.bar * im[4] * w[4] * 0.6; }
		const xs = v.xscale; x *= xs; xd *= xs / w[0];
		const W = v.wfield, u = (x - v.align * W * 0.9) / W;
		let o;
		if (reed) {
			// electrostatic: the capacitance's change with the reed's place
			o = (1 / (1 + u * u) - 1 / (1 + 0.81 * v.align * v.align)) * W / 0.6495 * 0.5;
		}
		else {
			// electromagnetic: the field's slope at the tip times its speed
			const q = 1 + u * u;
			o = -2 * u / (q * q) / W * xd * W / 0.6495 * 0.5;
		}
		const lvl = Math.abs(x);
		v.level += (lvl - v.level) * 0.002;
		this.mech += thump * v.fscale + v.thump; v.thump = 0;
		return o;
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, reed = s.mode === "reed";
		let out = 0;
		for (let i = 0; i < VOICES; i++) {
			const v = this.voices[i];
			if (v.sleep) continue;
			out += this.voiceTick(v, reed);
			if ((++v.age & 255) === 0) {
				let e = 0;
				for (let k = 0; k < MODES; k++) {
					const ek = v.re[k] * v.re[k] + v.im[k] * v.im[k];
					if (v.on[k] && !v.contact && k && k < 4 && ek * v.xscale * v.xscale < 1e-12) { v.on[k] = 0; v.re[k] = 0; v.im[k] = 0; }
					e += ek;
				}
				if (!v.contact && e * v.xscale * v.xscale < 1e-9) {
					v.sleep = true; v.level = 0; if (!v.gate) v.note = -1;
					for (let k = 0; k < MODES; k++) { v.re[k] = 0; v.im[k] = 0; }
				}
			}
		}
		// MECH: the thumps, low passed
		this.mechLp += (this.mech - this.mechLp) * 0.05; this.mech = 0;
		out += this.mechLp * s.mech * 0.6;
		// the preamp
		const sr = sampleRate;
		out *= 2.5;
		this.dc[0] += (out - this.dc[0]) * this.dcK; out -= this.dc[0];
		const drv = 0.6 + s.drive * s.drive * 7;
		let y = out * drv;
		y = reed ? tanh(y + 0.25) - tanh(0.25) : tanh(y * (1 + 0.12 * y));
		y /= Math.min(drv, 1 + s.drive * 0.8);
		// BASS and TREBLE: shelves
		this.lo[0] += (y - this.lo[0]) * this.bassK;
		this.hi[0] += (y - this.hi[0]) * this.trebK;
		const low = this.lo[0], high = y - this.hi[0];
		y = y + low * (Math.pow(2, s.bass * 2 - 1) - 1) + high * (Math.pow(2, s.treble * 2 - 1) - 1); // +-6 dB
		// TREMOLO
		const rate = 0.4 * Math.pow(25, s.trem_rate);
		this.trPh += rate / sr; if (this.trPh >= 1) this.trPh -= 1;
		const tri = sin1(this.trPh);
		const depth = clamp(s.trem_depth + (this.patched[I_TREM] ? ins[I_TREM] / 5 : 0), 0, 1);
		let l, r;
		if (s.stereo) { l = y * (1 + depth * tri) * 0.8; r = y * (1 - depth * tri) * 0.8; }
		else { l = r = y * (1 - depth * 0.5 * (1 - tri)); }
		const vol = s.volume * s.volume * 1.4;
		outs[O_L] = tanh(l * vol); outs[O_R] = tanh(r * vol);
		outs[O_TREM] = tri * 5;
		const a = Math.abs(outs[O_L]); if (a > this.peak) this.peak = a;
		return outs[O_L];
	}
	endBlock(n) {}

	state() {
		const v = [];
		for (const x of this.voices) if (!x.sleep) v.push(x.note, Math.round(Math.min(1, x.level) * 100) / 100, x.gate || !x.damped ? 1 : 0);
		const st = { v: v, peak: Math.round(this.peak * 100) / 100, trem: Math.round((0.5 + 0.5 * sin1(this.trPh)) * 100) / 100 };
		this.peak *= 0.5;
		return st;
	}
}
HammerDSP.IN_IDS = IN_IDS;
HammerDSP.OUT_IDS = OUT_IDS;
HammerDSP.MIDI_IN = "midi_in";
HammerDSP.POLY = true;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.hammer = HammerDSP;

})();
