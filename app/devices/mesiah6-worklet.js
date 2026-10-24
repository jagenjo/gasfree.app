// devices/mesiah6-worklet.js
// MESIAH-6 DSP (a six voice analog polysynth), hosted by the rack processor. Polyphonic: it gets the
// raw MIDI notes of its channel (POLY) and plays them on 6 voices, or stacks them (UNISON, with
// chord memory). Per voice: OSC 1 and OSC 2 morph triangle -> saw -> pulse (with PW), OSC 1 can be
// hard synced to OSC 2, OSC 2 has FINE, LOW FREQ and KEYBOARD off; a sub oscillator (a triangle an
// octave under OSC 1) and noise; SLOP (slow random drift of pitch and cutoff); a 2-pole resonant
// HIGH-PASS then a 4-pole resonant LOW-PASS sharing the filter envelope; the amp envelope.
// POLY MOD: the filter envelope and OSC 2 (at audio rate) to OSC 1's frequency, shape and pulse
// width and the filters. One LFO (5 shapes, tempo sync) to the frequencies, the pulse widths, the
// amp and the filters, its amount raised by the mod wheel; aftertouch to the frequencies, the LFO
// amount, the amp and the filters. Then stereo (PAN SPREAD), DISTORTION and two effects in series
// (A: delays, chorus, phasers, ring mod, flangers; B: the same and four reverbs).
// Clock (BPM, VALUE, MIDI clock or the SEQ jack) for the arpeggiator and the 64 step sequencer.

(function(){

const IN_IDS = ["lpf_in", "vol_in", "sus_in", "seq_in"];
const OUT_IDS = ["out_l", "out_r", "pitch_out", "gate_out", "fenv_out", "lfo_out"];
const I_LPF = 0, I_VOL = 1, I_SUS = 2, I_SEQ = 3;
const O_L = 0, O_R = 1, O_PITCH = 2, O_GATE = 3, O_FENV = 4, O_LFO = 5;
const VOICES = 6;
const CTRL = 16; // samples between control updates of a voice
const C4 = 261.6255653005986;
const DECAY_TC = Math.log(1 / 0.01);
const ATTACK_TARGET = 1.3, ATTACK_TC = Math.log(ATTACK_TARGET / (ATTACK_TARGET - 1));
const MIDI_CLOCK_TIMEOUT = 0.5;
// VALUE: the length of a step in beats; swing values alternate long and short
const VALUES = [[2], [1], [0.5], [0.75], [2 / 3, 1 / 3], [1 / 3], [0.25], [1 / 3, 1 / 6], [1 / 6], [0.125]];
// LFO SYNC: beats per LFO cycle, picked by FREQUENCY (mesiah6.js: their names)
const LFO_SYNC = [16, 8, 6, 4, 3, 2, 1.5, 1, 0.75, 0.5, 1 / 3, 0.375, 0.25, 1 / 6, 0.125];
// delay CLOCK SYNC: beats, picked by parameter 1 (mesiah6.js: their names)
const DLY_SYNC = [4, 3, 2, 1.5, 1, 0.75, 2 / 3, 0.5, 0.375, 1 / 3, 0.25];
const PAN_POS = [-1, 1, -0.6, 0.6, -0.25, 0.25];

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function frac(x) { return x - Math.floor(x); }
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
// an oscillator at phase t: SHAPE 0 triangle, 0.5 saw, 1 pulse (in between: a crossfade), PW 0..1
function oscWave(t, dt, shape, pw) {
	let tri = 0, saw = 0, pul = 0;
	if (shape < 0.5) {
		tri = 1 - 4 * Math.abs(t - 0.5);
		if (shape < 0.005) return tri;
		saw = 2 * t - 1 - polyblep(t, dt);
		const a = shape * 2;
		return tri + (saw - tri) * a;
	}
	saw = 2 * t - 1 - polyblep(t, dt);
	if (shape < 0.505) return saw;
	const w = clamp(0.5 + (pw - 0.5) * 0.92, 0.04, 0.96);
	let t2 = t + 1 - w; if (t2 >= 1) t2 -= 1;
	pul = (t < w ? 1 : -1) + polyblep(t, dt) - polyblep(t2, dt);
	const a = (shape - 0.5) * 2;
	return saw + (pul - saw) * a;
}

// ---- effects ----
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
// a feedback delay network of 4 lines per side, sized and damped by the reverb type
class Reverb {
	constructor() {
		const k = sampleRate / 44100;
		this.base = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map(l => Math.round(l * k));
		this.lines = this.base.map(l => new Line(Math.round(l * 2.2) + 4));
		this.lp = new Float64Array(8); this.o = new Float64Array(8);
		this.er = new Line(Math.round(sampleRate * 0.12));
		this.ap = [new Line(Math.round(347 * k)), new Line(Math.round(113 * k)), new Line(Math.round(241 * k)), new Line(Math.round(83 * k))];
		this.size = 1; this.l = 0; this.r = 0;
	}
	clear() { for (const L of this.lines) L.b.fill(0); this.lp.fill(0); this.er.b.fill(0); for (const A of this.ap) A.b.fill(0); }
	// size: line length scale, g: feedback, damp: 0..1, er: early reflections 0..1, spring: allpass chirps
	process(l, r, size, g, damp, er, spring) {
		const L = this.lines, o = this.o, B = this.base;
		const x = (l + r) * 0.5;
		this.er.write(x);
		const e = er > 0 ? (this.er.read(sampleRate * 0.013) * 0.6 + this.er.read(sampleRate * 0.029) * 0.45 - this.er.read(sampleRate * 0.047) * 0.35 + this.er.read(sampleRate * 0.071) * 0.25) * er : 0;
		let inp = x;
		if (spring) { // dispersion: the drip of a spring
			for (let k = 0; k < 4; k++) { const A = this.ap[k], d = A.read(A.n - 2), y = -0.6 * inp + d; A.write(inp + 0.6 * y); inp = y; }
		}
		for (let k = 0; k < 8; k++) o[k] = L[k].read(B[k] * size);
		const sa = (o[0] + o[1] + o[2] + o[3]) * 0.5, sb = (o[4] + o[5] + o[6] + o[7]) * 0.5;
		for (let k = 0; k < 8; k++) {
			const s = k < 4 ? sa : sb;
			this.lp[k] += (s - o[k] - this.lp[k]) * (1 - damp);
			L[k].write((k < 4 ? inp : -inp) * 0.35 + this.lp[k] * g + (k < 4 ? o[k + 4] : o[k - 4]) * 0.0);
		}
		this.l = (o[0] - o[1] + o[2] - o[3]) * 0.5 + (o[4] - o[6]) * 0.2 + e;
		this.r = (o[4] - o[5] + o[6] - o[7]) * 0.5 + (o[1] - o[3]) * 0.2 + e * 0.8;
	}
}
// FX TYPES (mesiah6.js: the same ids, A has the first ten, B all)
const FX_IDS = ["off", "bbd", "ddl", "cho", "ph1", "ph2", "ph3", "rin", "fl1", "fl2", "hal", "roo", "pla", "spr"];
class Effect {
	constructor() { this.type = 0; this.l = 0; this.r = 0; this.ph = 0; this.dl = null; this.dr = null; this.lpl = 0; this.lpr = 0; this.ap = new Float64Array(24); this.apc = [0, 0]; this.cnt = 0; this.fbl = 0; this.fbr = 0; this.rev = null; this.ring = 0; this.dTime = 0; }
	reset() {
		if (this.dl) { this.dl.b.fill(0); this.dr.b.fill(0); }
		this.ap.fill(0); this.fbl = this.fbr = 0; this.lpl = this.lpr = 0;
		if (this.rev) this.rev.clear();
		this.dTime = 0;
	}
	process(l, r, f, ctx) {
		const t = FX_IDS.indexOf(f.type), sr = sampleRate, p1 = f.p1, p2 = f.p2, mix = f.mix;
		if (t !== this.type) { this.type = t; this.reset(); }
		if (t <= 0 || mix <= 0) { this.l = l; this.r = r; return; }
		let wl = l, wr = r;
		if (t === 1 || t === 2) { // BBD / DDL: P1 time (or CLOCK SYNC value), P2 feedback
			if (!this.dl) { this.dl = new Line(Math.round(sr * 1.05)); this.dr = new Line(Math.round(sr * 1.05)); }
			let time;
			if (f.sync) {
				time = DLY_SYNC[clamp(Math.round(p1 * (DLY_SYNC.length - 1)), 0, DLY_SYNC.length - 1)] * 60 / ctx.bpm;
				while (time > 1) time /= 2;
			}
			else time = 0.01 + p1 * p1 * 0.99;
			// the time glides to its new value (a BBD bends the pitch while it moves)
			this.dTime = this.dTime ? this.dTime + (time * sr - this.dTime) * 0.0005 : time * sr;
			const fb = p2 * 0.95;
			if (t === 1) {
				this.ph += 0.6 / sr; if (this.ph >= 1) this.ph -= 1;
				const m = 1 + 0.002 * Math.sin(2 * Math.PI * this.ph);
				wl = this.dl.read(this.dTime * m); wr = this.dr.read(this.dTime * m);
				this.lpl += (wl - this.lpl) * 0.25; this.lpr += (wr - this.lpr) * 0.25; // the dark repeats
				wl = this.lpl; wr = this.lpr;
				this.dl.write(fastTanh(l + wl * fb)); this.dr.write(fastTanh(r + wr * fb));
			} else {
				wl = this.dl.read(this.dTime); wr = this.dr.read(this.dTime);
				this.dl.write(l + wl * fb); this.dr.write(r + wr * fb);
			}
		}
		else if (t === 3 || t === 8 || t === 9) { // CHORUS (P1 rate, P2 depth), FLANGER 1 / 2 (high / low resonance)
			if (!this.dl) { this.dl = new Line(Math.round(sr * 0.05)); this.dr = new Line(Math.round(sr * 0.05)); }
			const rate = 0.05 * Math.pow(160, p1);
			this.ph += rate / sr; if (this.ph >= 1) this.ph -= 1;
			const s0 = Math.sin(2 * Math.PI * this.ph), s1 = Math.cos(2 * Math.PI * this.ph);
			if (t === 3) {
				const base = 0.011 * sr, dep = 0.006 * sr * p2;
				wl = this.dl.read(base + dep * s0); wr = this.dr.read(base + dep * s1);
				this.dl.write(l); this.dr.write(r);
			} else {
				const fb = t === 8 ? 0.85 : 0.4, dep = 0.0045 * sr * p2;
				wl = this.dl.read(sr * 0.0007 + dep * (0.5 + 0.5 * s0)); wr = this.dr.read(sr * 0.0007 + dep * (0.5 + 0.5 * s1));
				this.dl.write(l + wl * fb); this.dr.write(r + wr * fb);
			}
		}
		else if (t >= 4 && t <= 6) { // PHASER 1 / 2: 6 stages, high / lower resonance; PHASER 3: 4 stages, a slower sweep
			const rate = 0.03 * Math.pow(200, p1);
			this.ph += rate / sr; if (this.ph >= 1) this.ph -= 1;
			const stages = t === 6 ? 4 : 6, fbk = t === 4 ? 0.75 : (t === 5 ? 0.35 : 0.55);
			if (this.cnt-- <= 0) {
				this.cnt = 15;
				for (let c = 0; c < 2; c++) {
					const s = Math.sin(2 * Math.PI * (this.ph + c * 0.25));
					const fc = 160 * Math.pow(t === 6 ? 12 : 20, 0.5 + 0.5 * s * p2), tn = Math.tan(Math.PI * Math.min(fc, sr * 0.4) / sr);
					this.apc[c] = (1 - tn) / (1 + tn);
				}
			}
			const A = this.ap;
			for (let c = 0; c < 2; c++) {
				const a = this.apc[c];
				let x = (c ? r + this.fbr * fbk : l + this.fbl * fbk);
				for (let k = 0; k < stages; k++) { const i = c * 12 + k * 2, y = -a * x + A[i]; A[i] = x + a * y; x = y; }
				if (c) { wr = (r + x) * 0.5; this.fbr = x; } else { wl = (l + x) * 0.5; this.fbl = x; }
			}
		}
		else if (t === 7) { // RING MOD: P1 frequency; P2 over half: it follows the lowest note
			const fq = p2 >= 0.5 ? ctx.lowHz * Math.pow(2, (p1 - 0.5) * 4) : 20 * Math.pow(2, p1 * 7);
			this.ring += fq / sr; if (this.ring >= 1) this.ring -= 1;
			const c = Math.sin(2 * Math.PI * this.ring);
			wl = l * c; wr = r * c;
		}
		else { // reverbs: HALL, ROOM, PLATE (P1 time, P2 early reflections), SPRING (P1 decay, P2 tone)
			if (!this.rev) this.rev = new Reverb();
			const R = this.rev;
			if (t === 10) R.process(l, r, 1.6, 0.8 + p1 * 0.18, 0.25, p2, false);
			else if (t === 11) R.process(l, r, 0.6, 0.6 + p1 * 0.3, 0.35, p2 * 1.2, false);
			else if (t === 12) R.process(l, r, 0.9, 0.75 + p1 * 0.23, 0.08, p2 * 0.5, false);
			else R.process(l, r, 0.45, 0.65 + p1 * 0.3, 0.9 - p2 * 0.8, 0, true);
			wl = R.l; wr = R.r;
		}
		this.l = l + (wl - l) * mix; this.r = r + (wr - r) * mix;
	}
}

// envelope stages: 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
function newVoice(i) {
	return {
		index: i, note: 60, vel: 1, gate: false, age: 0, ctrl: 0, pitch: 0, target: 0, from: 0, glideT: 1, detune: 0,
		t1: 0, t2: 0, ts: 0, fe: 0, fs: 0, ae: 0, as: 0, lad: new Float64Array(4), hp: new Float64Array(2),
		slop: new Float64Array(3), slopT: new Float64Array(3), lpOct: 0, hpOct: 0, g: 0.1, hg: 0.1, fb: 0, hk: 2,
		p1: 0, p2: 0, gl: 1, gr: 1, amp: 0, lpPm: 0, hpPm: 0, ampTarget: 0, ampNow: 0
	};
}

class Mesiah6DSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.gateHigh = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.voices = []; for (let i = 0; i < VOICES; i++) this.voices.push(newVoice(i));
		this.clock = 0; this.next = 0;
		this.keys = [];          // the keys down, in order: [note, velocity]
		this.sustained = new Set();
		this.lastPitch = null;
		this.bend = 0; this.wheel = 0; this.press = 0;
		this.lfoPh = 0; this.lfoHold = 0; this.lfo = 0; this.lfoUni = 0;
		this.fxA = new Effect(); this.fxB = new Effect();
		// clock, arpeggiator, sequencer
		this.stepPhase = 0; this.stepParity = 0; this.running = false;
		this.midiTicks = 0; this.midiCount = 0; this.lastMidiClock = -1e12; this.sampleCount = 0;
		this.arpHeld = []; this.arpIndex = -1; this.arpDir = 1; this.arpNotes = []; this.gateLeft = 0; this.latched = false;
		this.seqPos = -1; this.seqNotes = []; this.seqTrans = 0; this.wasPlay = false; this.wasRec = false;
		this.rec = []; this.recChord = []; this.recCommitted = false; this.recVer = 0; this.sentVer = 0;
		this.beat = 0; // for the TAP TEMPO light
		this.uniNotes = [];
	}

	message(m) {
		switch (m.type) {
			case "note": m.on ? this.keyOn(m.note, m.vel === undefined ? 1 : m.vel) : this.keyOff(m.note); break;
			case "trigger": m.gate ? this.keyOn(60, 1) : this.keyOff(60); break;
			case "allNotesOff": this.keys = []; this.sustained.clear(); this.arpHeld = []; this.allOff(); break;
			case "bend": this.bend = m.value; break;
			case "modwheel": this.wheel = clamp(m.value, 0, 1); break;
			case "pressure": this.press = clamp(m.value, 0, 1); break;
			case "midiClock": this.midiTicks++; this.lastMidiClock = this.sampleCount; break;
			case "midiStart": this.midiCount = 0; this.seqPos = -1; this.arpIndex = -1; break;
			case "seqAdvance": this.recAdvance(); break;   // TENS while recording: a rest, or a tie while keys are down
			case "seqBack": if (this.rec.length) { this.rec.pop(); this.recVer++; } break; // BANK while recording
		}
	}

	setSettings(s) {
		const first = !this.s;
		this.s = s;
		// sequencer RECORD / PLAY switched
		if (s.seq_rec && !this.wasRec) { this.rec = []; this.recChord = []; this.recCommitted = false; this.recVer++; }
		if (!s.seq_play && this.wasPlay) { this.seqNotesOff(); this.seqPos = -1; this.seqTrans = 0; }
		if (s.seq_play && !this.wasPlay) { this.seqPos = -1; this.stepPhase = 0; this.stepParity = 0; this.running = false; }
		this.wasRec = !!s.seq_rec; this.wasPlay = !!s.seq_play;
		if (!s.hold && this.latched) { this.latched = false; this.arpHeld = this.arpHeld.filter(h => h[2]); }
		if (first) this.coefs();
	}
	setMidiConnected(c) {
		if (!c && this.midiConnected) this.message({ type: "allNotesOff" });
		this.midiConnected = c;
	}

	// ---- keys: to the sequencer (recording, transposing), the arpeggiator, or the voices ----
	keyOn(note, vel) {
		const s = this.s;
		note += 12 * (s.transpose | 0);
		this.sustained.delete(note);
		this.keys = this.keys.filter(k => k[0] !== note); this.keys.push([note, vel]);
		if (s.seq_play && s.seq_rec) { this.seqTrans = note - 60; return; }           // a key transposes the sequence
		if (s.seq_rec && !s.seq_play) { this.recChord.push(note); this.recCommitted = false; }
		if (s.arp.on && !s.seq_play) {
			if (this.latched && !this.arpHeld.some(h => h[2])) this.arpHeld = []; // HOLD: a new chord replaces the latched one
			this.arpHeld = this.arpHeld.filter(h => h[0] !== note);
			this.arpHeld.push([note, vel, true]);
			this.latched = false;
			return;
		}
		this.play();
		if (!s.unison.on) this.voiceOn(note, vel);
	}

	keyOff(note) {
		const s = this.s;
		note += 12 * (s.transpose | 0);
		const sus = s.hold || (this.patched[I_SUS] && this.ins[I_SUS] > 1);
		if (s.seq_rec && !s.seq_play && this.keys.length === 1 && this.keys[0][0] === note) this.recCommit();
		this.keys = this.keys.filter(k => k[0] !== note);
		if (s.arp.on && !s.seq_play) {
			if (s.hold) {
				const h = this.arpHeld.find(h => h[0] === note);
				if (h) h[2] = false;
				if (!this.arpHeld.some(h => h[2])) this.latched = true;
			}
			else this.arpHeld = this.arpHeld.filter(h => h[0] !== note);
			return;
		}
		if (sus) { this.sustained.add(note); return; }
		if (s.unison.on) this.play();
		else this.voiceOff(note);
	}

	// ---- sequencer recording: the chord held is a step when every key is up ----
	recCommit() {
		if (!this.recCommitted && this.recChord.length && this.rec.length < 64) { this.rec.push(this.recChord.slice(0, 6)); this.recVer++; }
		this.recChord = []; this.recCommitted = false;
	}
	recAdvance() {
		if (!this.s.seq_rec || this.rec.length >= 64) return;
		if (this.keys.length) {
			if (!this.recCommitted && this.recChord.length) { this.rec.push(this.recChord.slice(0, 6)); this.recCommitted = true; }
			this.rec.push([-1]);   // a tie: the step before goes on
		}
		else this.rec.push([]);    // a rest
		this.recVer++;
	}

	// ---- UNISON: the voices stacked on one note (priority by KEY MODE), or on the memorized chord ----
	play() {
		const s = this.s;
		if (!s.unison.on) return;
		const pool = this.keys.concat(Array.from(this.sustained).map(n => [n, 1]));
		if (!pool.length) { for (const v of this.voices) if (v.gate) this.release(v); this.uniNote = null; return; }
		const mode = s.keymode;
		let k = pool[pool.length - 1];
		if (mode === "lo" || mode === "lor") k = pool.reduce((a, b) => b[0] < a[0] ? b : a);
		else if (mode === "hi" || mode === "hir") k = pool.reduce((a, b) => b[0] > a[0] ? b : a);
		const retrig = mode === "lor" || mode === "hir" || mode === "lar" || this.uniNote == null;
		if (k[0] === this.uniNote && !retrig) return;
		const legato = this.uniNote != null;
		this.uniNote = k[0];
		this.uniStack(k[0], k[1], retrig || !legato);
	}
	uniStack(note, vel, trigger) {
		// UNISON 1-6 voices; 7 (CHD): one voice for each note of the memorized chord
		const s = this.s, useChord = s.unison.voices > 6 && s.unison.chord && s.unison.chord.length;
		const chord = useChord ? s.unison.chord : [0], n = useChord ? Math.min(VOICES, chord.length) : clamp(s.unison.voices | 0, 1, VOICES);
		for (let i = 0; i < VOICES; i++) {
			const v = this.voices[i];
			if (i >= n) { if (v.gate) this.release(v); continue; }
			const nt = note + chord[i % chord.length];
			// the stacked voices spread around the note (SLOP widens it)
			v.detune = n > 1 ? ((i / (n - 1)) - 0.5) * (0.04 + s.slop * 0.3) / 12 : 0;
			this.start(v, nt, vel, trigger);
		}
	}

	allOff() { for (const v of this.voices) if (v.gate) this.release(v); this.uniNote = null; this.arpNotes = []; this.seqNotes = []; }

	voiceOn(note, vel) {
		// the same note again, else the next free voice in turn, else the one released longest ago, else the oldest
		let v = this.voices.find(x => x.note === note && x.gate);
		if (!v) {
			for (let k = 0; k < VOICES && !v; k++) { const c = this.voices[(this.next + k) % VOICES]; if (!c.gate && !c.as) v = c; }
			if (!v) v = this.voices.filter(x => !x.gate).sort((a, b) => a.age - b.age)[0] || this.voices.slice().sort((a, b) => a.age - b.age)[0];
			this.next = (v.index + 1) % VOICES;
		}
		v.detune = 0;
		this.start(v, note, vel, true);
	}
	voiceOff(note) { for (const v of this.voices) if (v.note === note && v.gate) this.release(v); }

	start(v, note, vel, trigger) {
		const s = this.s, target = (note - 60) / 12;
		// GLIDE: from the last note played (A modes: only when another key is still down)
		const g = s.glide, legatoOnly = g.mode === 1 || g.mode === 3;
		const glide = g.on && g.rate > 0.001 && this.lastPitch !== null && (!legatoOnly || this.keys.length > 1 || (s.unison.on && v.gate));
		if (glide) { v.from = v.gate || v.as ? v.pitch : this.lastPitch; v.pitch = v.from; v.glideT = 0; }
		else { v.pitch = target; v.glideT = 1; }
		v.target = target; v.note = note; v.vel = vel; v.gate = true; v.age = ++this.clock;
		if (trigger) { v.fs = 1; v.as = 1; v.ctrl = 0; if (v.ae < 1e-4) { v.t1 = 0; v.t2 = 0; v.ts = 0; } }
		this.lastPitch = target;
		this.lastVoice = v;
		// LFO SYNC: the first key starts the LFO's cycle
		if (s.lfo.sync && !this.voices.some(x => x !== v && x.gate)) { this.lfoPh = 0; }
	}
	release(v) { v.gate = false; if (v.fs) v.fs = 4; if (v.as) v.as = 4; }

	gateEdge(i) {
		const high = this.ins[i] > 1 ? 1 : 0;
		const r = high && !this.gateHigh[i] ? 1 : (!high && this.gateHigh[i] ? -1 : 0);
		this.gateHigh[i] = high;
		return r;
	}

	// ---- a step of the clock: the arpeggiator or the sequencer ----
	step() {
		const s = this.s;
		this.beat = 0;
		if (s.seq_play && s.seq && s.seq.length) return this.seqStep();
		if (s.arp.on) return this.arpStep();
	}
	stepLen() { // samples, from BPM and VALUE
		const v = VALUES[clamp(this.s.clock.value | 0, 0, VALUES.length - 1)];
		return v[this.stepParity % v.length] * 60 / clamp(this.s.clock.bpm, 30, 250) * sampleRate;
	}
	seqNotesOff() { for (const n of this.seqNotes) this.voiceOff(n); this.seqNotes = []; }
	seqStep() {
		const seq = this.s.seq;
		this.seqPos = (this.seqPos + 1) % seq.length;
		const st = seq[this.seqPos];
		if (st.length === 1 && st[0] === -1) { this.gateLeft = 0; return; } // a tie: the notes go on
		this.seqNotesOff();
		const next = seq[(this.seqPos + 1) % seq.length];
		for (const n of st) { const nt = clamp(n + this.seqTrans, 0, 127); this.voiceOn(nt, 0.85); this.seqNotes.push(nt); }
		this.gateLeft = next.length === 1 && next[0] === -1 ? 0 : Math.max(1, Math.round(this.lastStep * 0.6));
	}
	arpStep() {
		const s = this.s, a = s.arp;
		for (const n of this.arpNotes) this.voiceOff(n); this.arpNotes = [];
		if (!this.arpHeld.length) return;
		let notes = this.arpHeld.map(h => h[0]);
		if (a.mode !== "assign") notes = notes.slice().sort((x, y) => x - y);
		const seq = [];
		for (let o = 0; o < clamp(a.oct | 0, 1, 3); o++) for (const n of notes) seq.push(n + 12 * o);
		const len = seq.length;
		let i;
		if (a.mode === "random") i = Math.floor(Math.random() * len);
		else if (a.mode === "down") i = this.arpIndex = ((this.arpIndex < 0 ? len : this.arpIndex) - 1 + len) % len;
		else if (a.mode === "updown" && len > 1) {
			let n = this.arpIndex + this.arpDir;
			if (n >= len) { this.arpDir = -1; n = len - 2; }
			if (n < 0) { this.arpDir = 1; n = this.arpIndex < 0 ? 0 : 1; }
			i = this.arpIndex = n;
		}
		else i = this.arpIndex = (this.arpIndex + 1) % len;
		const note = seq[i % len], h = this.arpHeld.find(x => x[0] === note) || this.arpHeld[0];
		this.voiceOn(note, h[1]);
		this.arpNotes = [note];
		this.gateLeft = Math.max(1, Math.round(this.lastStep * 0.5));
	}

	coefs() {
		const s = this.s, sr = sampleRate;
		const ad = (e) => [1 - Math.exp(-ATTACK_TC / (Math.max(e.a, 0.0005) * sr)), Math.exp(-DECAY_TC / (Math.max(e.d, 0.002) * sr)), Math.exp(-DECAY_TC / (Math.max(e.r, 0.002) * sr))];
		this.fc = ad(s.fenv); this.ac = ad(s.aenv);
	}

	beginBlock(n) {
		const s = this.s, sr = sampleRate;
		this.coefs();
		this.hpBase = Math.log2(clamp(s.hpf.cutoff, 20, 20000) / 20);
		this.lpBase = Math.log2(clamp(s.lpf.cutoff, 20, 20000) / 20);
		this.pv = s.volume * s.volume * s.pvol * 2;
		// the clock: the SEQ jack > MIDI clock > BPM
		this.midiClock = !this.patched[I_SEQ] && (this.sampleCount - this.lastMidiClock) < MIDI_CLOCK_TIMEOUT * sr;
		const want = (s.seq_play && s.seq && s.seq.length) || (s.arp.on && this.arpHeld.length);
		if (this.midiClock) {
			for (; this.midiTicks > 0; this.midiTicks--) {
				const v = VALUES[clamp(s.clock.value | 0, 0, VALUES.length - 1)];
				const ticks = Math.max(1, Math.round(24 * v[this.stepParity % v.length]));
				if (want && this.midiCount % ticks === 0) { this.lastStep = ticks * (this.clockGap || sr / 48); this.step(); this.stepParity++; this.midiCount = 0; }
				this.midiCount++;
			}
		}
		this.midiTicks = 0;
		if (!s.arp.on && (this.arpHeld.length || this.arpNotes.length)) { this.arpHeld = []; for (const x of this.arpNotes) this.voiceOff(x); this.arpNotes = []; }
		// RECORD stopped with a chord still down
		if (s.seq_rec !== this.recOn) { if (!s.seq_rec && this.recChord.length) this.recCommit(); this.recOn = s.seq_rec; }
	}

	// control rate: glide, slop, the pitches, the filters' cutoffs, the amp level, the pan
	control(v) {
		const s = this.s, sr = sampleRate, g = s.glide;
		// GLIDE: FIXED RATE (time per octave) or FIXED TIME
		if (v.glideT < 1) {
			const time = 0.005 + g.rate * g.rate * 4;
			if (g.mode >= 2) { v.glideT = Math.min(1, v.glideT + CTRL / (time * sr)); v.pitch = v.from + (v.target - v.from) * v.glideT; }
			else {
				const d = v.target - v.pitch, stp = CTRL / (time * sr);
				if (Math.abs(d) <= stp) { v.pitch = v.target; v.glideT = 1; } else v.pitch += d > 0 ? stp : -stp;
			}
		}
		else v.pitch = v.target;
		// SLOP: each oscillator and the cutoff drift on their own
		const sl = s.slop;
		for (let k = 0; k < 3; k++) {
			if (--v.slopT[k] <= 0) { v.slopT[k] = 40 + Math.random() * 200; v.slopTo = v.slopTo || new Float64Array(3); v.slopTo[k] = Math.random() * 2 - 1; }
			v.slop[k] += ((v.slopTo ? v.slopTo[k] : 0) - v.slop[k]) * 0.004;
		}
		const lfo = this.lfo, lfoUni = this.lfoUni, L = s.lfo, at = s.at, press = this.press * at.amt;
		const lfoAmt = clamp(L.amt + this.wheel + (at.lfo ? press : 0), 0, 1);
		const bend = this.bend * (s.pwheel / 2);
		const vib1 = (L.freq1 ? lfo * lfoAmt : 0) + (at.freq1 ? press : 0), vib2 = (L.freq2 ? lfo * lfoAmt : 0) + (at.freq2 ? press : 0);
		const tune = s.tune / 1200;
		const p = v.pitch + v.detune + bend + tune;
		const o1 = s.osc1, o2 = s.osc2;
		v.p1 = p + o1.freq / 12 + vib1 + v.slop[0] * sl * 0.02;
		const p2base = o2.kbd ? p : tune;
		v.p2 = (o2.low ? -7 : 0) + p2base + o2.freq / 12 + o2.fine / 1200 + vib2 + v.slop[1] * sl * 0.02;
		// the filters: base, envelope (VELOCITY: scaled by it), keyboard (HALF / FULL), LFO, aftertouch, SLOP, CV
		const fenv = v.fe, key = v.target;
		const lpEnv = s.lpf.env * (s.lpf.vel ? v.vel : 1), hpEnv = s.hpf.env * (s.hpf.vel ? v.vel : 1);
		const lfoF = lfo * lfoAmt * 4, atF = press * 4, cv = this.patched[I_LPF] ? this.ins[I_LPF] : 0;
		v.lpOct = this.lpBase + fenv * lpEnv * 9 + key * s.lpf.kbd * 0.5 + ((L.filter & 1) ? lfoF : 0) + ((at.filter & 1) ? atF : 0) + v.slop[2] * sl * 0.25 + cv;
		v.hpOct = this.hpBase + fenv * hpEnv * 9 + key * s.hpf.kbd * 0.5 + ((L.filter & 2) ? lfoF : 0) + ((at.filter & 2) ? atF : 0) + v.slop[2] * sl * 0.15;
		v.fb = s.lpf.res * 4.3;
		v.hk = 2 - s.hpf.res * 1.85;
		// amp: ENV AMOUNT (VELOCITY scales it), the LFO (from full down by its amount), aftertouch
		const vel = s.aenv.vel ? 0.25 + 0.75 * v.vel : 1;
		v.ampEnv = s.aenv.amt * vel;
		v.ampLfo = L.amp ? lfoAmt : 0;
		v.ampAt = at.amp ? press : 0;
		// PAN SPREAD
		const pan = s.unison.on ? PAN_POS[v.index] * s.pan * 0.8 : PAN_POS[v.index] * s.pan, a = (pan + 1) * Math.PI / 4;
		v.gl = Math.cos(a) * Math.SQRT2; v.gr = Math.sin(a) * Math.SQRT2;
		v.pw = clamp(o1.pw + (L.pw ? lfo * lfoAmt * 0.45 : 0), 0, 1); v.pw2 = clamp(o2.pw + (L.pw ? lfo * lfoAmt * 0.45 : 0), 0, 1);
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, patched = this.patched, sr = sampleRate;
		// ---- the clock ----
		const want = (s.seq_play && s.seq && s.seq.length) || (s.arp.on && this.arpHeld.length);
		if (patched[I_SEQ]) { if (this.gateEdge(I_SEQ) > 0 && want) { this.lastStep = this.sinceSeq || this.stepLen(); this.sinceSeq = 0; this.step(); } this.sinceSeq = (this.sinceSeq || 0) + 1; }
		else if (!this.midiClock) {
			if (want) {
				if (!this.running) { this.running = true; this.stepPhase = 0; this.stepParity = 0; this.lastStep = this.stepLen(); this.step(); }
				this.stepPhase++;
				const len = this.stepLen();
				if (this.stepPhase >= len) { this.stepPhase -= len; this.stepParity++; this.lastStep = this.stepLen(); this.step(); }
			}
			else if (this.running) { this.running = false; for (const n of this.arpNotes) this.voiceOff(n); this.arpNotes = []; this.arpIndex = -1; }
		}
		if (this.gateLeft > 0 && --this.gateLeft === 0) {
			for (const n of this.arpNotes) this.voiceOff(n); this.arpNotes = [];
			this.seqNotesOff();
		}
		if (this.clockGapCount !== undefined) this.clockGapCount++;
		this.beat += 1 / (60 / clamp(s.clock.bpm, 30, 250) * sr);
		// SUSTAIN jack let go
		if (patched[I_SUS] && this.gateEdge(I_SUS) < 0 && !s.hold) { const n = Array.from(this.sustained); this.sustained.clear(); if (s.unison.on) this.play(); else for (const k of n) this.voiceOff(k); }
		if (!s.hold && !(patched[I_SUS] && ins[I_SUS] > 1) && this.sustained.size) { const n = Array.from(this.sustained); this.sustained.clear(); if (s.unison.on) this.play(); else for (const k of n) this.voiceOff(k); }

		// ---- LFO: TRIANGLE and RANDOM bipolar, SAW, REVERSE SAW and SQUARE from 0 up; RANDOM at the top: noise ----
		const L = s.lfo;
		let rate;
		if (L.sync) rate = 1 / (LFO_SYNC[clamp(Math.round(L.rate * (LFO_SYNC.length - 1)), 0, LFO_SYNC.length - 1)] * 60 / clamp(s.clock.bpm, 30, 250));
		else rate = 0.05 * Math.pow(5000, L.rate); // 0.05 .. 250 Hz
		this.lfoPh += rate / sr;
		if (this.lfoPh >= 1) { this.lfoPh -= Math.floor(this.lfoPh); this.lfoHold = Math.random() * 2 - 1; }
		const ph = this.lfoPh;
		switch (L.shape) {
			case "saw": this.lfo = ph; break;
			case "rsaw": this.lfo = 1 - ph; break;
			case "square": this.lfo = ph < 0.5 ? 1 : 0; break;
			case "random": this.lfo = !L.sync && L.rate > 0.995 ? Math.random() * 2 - 1 : this.lfoHold; break;
			default: this.lfo = 1 - 4 * Math.abs(ph - 0.5);
		}
		this.lfoUni = L.shape === "tri" || L.shape === "random" ? 0.5 + 0.5 * this.lfo : this.lfo;

		// ---- voices ----
		const pm = s.pmod, o1 = s.osc1, o2 = s.osc2, mx = s.mix, fc = this.fc, ac = this.ac;
		const fsus = s.fenv.s, asus = s.aenv.s, pmF = pm.fenv, pmO = pm.osc2;
		const pmAudioFilter = pmO !== 0 && pm.filter;
		let outL = 0, outR = 0, anyGate = false;
		for (let vi = 0; vi < VOICES; vi++) {
			const v = this.voices[vi];
			if (!v.as && !v.gate) continue;
			anyGate = anyGate || v.gate;
			// envelopes
			if (v.fs === 1) { v.fe += (ATTACK_TARGET - v.fe) * fc[0]; if (v.fe >= 1) { v.fe = 1; v.fs = 2; } }
			else if (v.fs === 2) { v.fe = fsus + (v.fe - fsus) * fc[1]; if (Math.abs(v.fe - fsus) < 1e-4) v.fs = 3; }
			else if (v.fs === 3) { v.fe = fsus; if (!v.gate) v.fs = 4; }
			else if (v.fs === 4) { v.fe *= fc[2]; if (v.fe < 1e-5) { v.fe = 0; v.fs = 0; } }
			if (v.as === 1) { v.ae += (ATTACK_TARGET - v.ae) * ac[0]; if (v.ae >= 1) { v.ae = 1; v.as = 2; } }
			else if (v.as === 2) { v.ae = asus + (v.ae - asus) * ac[1]; if (Math.abs(v.ae - asus) < 1e-4) v.as = 3; }
			else if (v.as === 3) { v.ae = asus; if (!v.gate) v.as = 4; }
			else if (v.as === 4) { v.ae *= ac[2]; if (v.ae < 1e-5) { v.ae = 0; v.as = 0; } }
			if (v.ctrl-- <= 0) { this.control(v); v.ctrl = CTRL - 1; }

			// OSC 2 first: it can sync OSC 1, and it is a POLY MOD source
			const dt2 = clamp(C4 * Math.pow(2, v.p2) / sr, 0, 0.45);
			v.t2 += dt2;
			let wrapped = false;
			if (v.t2 >= 1) { v.t2 -= 1; wrapped = true; }
			const w2 = oscWave(v.t2, dt2, o2.shape, v.pw2);
			// POLY MOD: filter envelope and OSC 2 into OSC 1's frequency, shape, pulse width and the filters
			const pmv = v.fe * pmF + w2 * pmO;
			let p1 = v.p1, sh1 = o1.shape, pw1 = v.pw;
			if (pm.freq1) p1 += v.fe * pmF * 5 + w2 * pmO * 2;
			if (pm.shape1) sh1 = clamp(sh1 + pmv, 0, 1);
			if (pm.pw1) pw1 = clamp(pw1 + pmv * 0.5, 0, 1);
			const dt1 = clamp(C4 * Math.pow(2, p1) / sr, 0, 0.45);
			v.t1 += dt1;
			if (v.t1 >= 1) v.t1 -= 1;
			if (o1.sync && wrapped) v.t1 = v.t2 * dt1 / Math.max(dt2, 1e-9); // hard sync: restart with OSC 2
			v.ts += dt1 * 0.5; if (v.ts >= 1) v.ts -= 1;
			const w1 = oscWave(v.t1, dt1, sh1, pw1);
			const sub = 1 - 4 * Math.abs(v.ts - 0.5);
			let x = w1 * mx.osc1 + w2 * mx.osc2 * (o2.low ? 0 : 1) + sub * mx.sub + (mx.noise > 0 ? (Math.random() * 2 - 1) * mx.noise : 0);
			x *= 0.6;
			// filters: HIGH-PASS (2 pole, TPT state variable) then LOW-PASS (4 pole ladder)
			let lpOct = v.lpOct, hpOct = v.hpOct;
			if (pm.filter) { const f = pmAudioFilter ? pmv * 5 : v.fe * pmF * 5; if (pm.filter & 1) lpOct += f; if (pm.filter & 2) hpOct += f; }
			if (hpOct > 0.05 || s.hpf.res > 0.02) {
				const fch = clamp(20 * Math.pow(2, hpOct), 20, sr * 0.45), gh = Math.tan(Math.PI * fch / sr), H = v.hp, k = v.hk;
				const a1 = 1 / (1 + gh * (gh + k)), v3 = x - H[1], v1 = a1 * H[0] + gh * a1 * v3, v2 = H[1] + gh * v1;
				H[0] = 2 * v1 - H[0]; H[1] = 2 * v2 - H[1];
				x = x - k * v1 - v2;
			}
			const fcl = clamp(20 * Math.pow(2, lpOct), 20, sr * 0.3), g = 1 - Math.exp(-2 * Math.PI * fcl / sr), Ld = v.lad, fb = v.fb;
			const xin = fastTanh(x - fb * Ld[3]);
			Ld[0] += g * (xin - Ld[0]); Ld[1] += g * (Ld[0] - Ld[1]); Ld[2] += g * (Ld[1] - Ld[2]); Ld[3] += g * (Ld[2] - Ld[3]);
			const y = Ld[3] * (1 + fb * 0.35);
			// amp
			let amp = v.ae * v.ampEnv;
			if (v.ampLfo) amp = s.aenv.amt > 0.001 ? amp * (1 - v.ampLfo * (1 - this.lfoUni)) : (v.gate || v.as ? v.ampLfo * this.lfoUni : 0); // the gated VCA: no envelope, the LFO opens it
			amp = clamp(amp + v.ampAt * v.ae, 0, 1.5);
			const a = y * amp;
			outL += a * v.gl; outR += a * v.gr;
		}
		const lv = this.lastVoice || this.voices[0];
		outs[O_PITCH] = lv.target;
		outs[O_GATE] = anyGate ? 5 : 0;
		outs[O_FENV] = lv.fe * 5;
		outs[O_LFO] = this.lfo * 5;
		let l = outL * 0.5, r = outR * 0.5;
		// DISTORTION
		const d = s.dist;
		if (d > 0.002) { const k = 1 + d * d * 30, n = 1 / Math.min(k, 1 + d * 3); l = fastTanh(l * k) * n; r = fastTanh(r * k) * n; }
		// EFFECTS A then B
		if (s.fx.on) {
			const ctx = { bpm: clamp(s.clock.bpm, 30, 250), lowHz: this.lowHz() };
			this.fxA.process(l, r, s.fx.a, ctx); this.fxB.process(this.fxA.l, this.fxA.r, s.fx.b, ctx);
			l = this.fxB.l; r = this.fxB.r;
		}
		const vol = this.pv * (patched[I_VOL] ? clamp(ins[I_VOL] / 5, 0, 1) : 1);
		outs[O_L] = fastTanh(l * vol); outs[O_R] = fastTanh(r * vol);
		return outs[O_L];
	}

	lowHz() {
		let lo = 999;
		for (const v of this.voices) if (v.gate && v.note < lo) lo = v.note;
		return lo === 999 ? 130 : C4 * Math.pow(2, (lo - 60) / 12);
	}

	endBlock(n) { this.sampleCount += n; }

	state() {
		const st = {
			gates: this.voices.map(v => v.gate ? v.note : -1),
			voices: this.voices.filter(v => v.as || v.gate).length,
			keys: this.keys.map(k => k[0]),
			lfo: Math.round(this.lfoUni * 100) / 100,
			beat: this.beat < 0.12,
			step: this.s && this.s.seq_play ? this.seqPos : (this.s && this.s.seq_rec ? this.rec.length : -1),
			trans: this.seqTrans
		};
		if (this.recVer !== this.sentVer) { st.rec = { ver: this.recVer, steps: this.rec.map(x => x.slice()) }; this.sentVer = this.recVer; }
		return st;
	}
}
Mesiah6DSP.OUT_IDS = OUT_IDS;
Mesiah6DSP.IN_IDS = IN_IDS;
Mesiah6DSP.MIDI_IN = "midi_in";
Mesiah6DSP.POLY = true;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.mesiah6 = Mesiah6DSP;

})();
