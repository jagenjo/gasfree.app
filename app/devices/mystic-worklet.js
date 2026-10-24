// devices/mystic-worklet.js
// MYSTIC DSP (a wave-scanning polyphonic synthesizer), hosted by the rack processor. Polyphonic:
// it gets the raw MIDI notes of its channel (POLY) and plays them on 8 voices (or one, in MONO).
// Per voice: OSC 1 and OSC 2 scan through 8 single cycle waves (WAVSCAN) and go through two mutators
// each (FM-LIN, WAVSTACK, SYNC, PW-ASYM, HARMONIC, PHAZDIST: transformations of the oscillator's phase
// or its wave), OSC 3 plays one wave; a mixer with ring modulation and noise; FILTER 1 (LP24 ladder,
// LP12, BP, HP, VOWEL, COMB) and FILTER 2 (state variable morphing LP -> BP -> HP), in series or
// parallel; five envelopes (delay, attack, hold, decay, sustain, release, loop): ENV 1 to the
// filters, ENV 2 the amp, ENV 3 to the mutators and WAVSCAN, ENV 4-5 free. Five LFOs for all voices
// (LFO 1 to pitch, WAVSCAN, cutoff and mutators, LFO 2 to the amp). A mod matrix of 16 slots and
// 8 macros (3 targets each) move any of those. Voices are spread in stereo (WIDTH), then
// PRE-FX -> DELAY -> REVERB -> POST-FX. The arpeggiator has 8 modes, ratchets and chance.
// The waves are band limited: each has 7 versions with fewer harmonics, picked by the pitch.

(function(){

const C4 = 261.6255653005986;
const IN_IDS = ["pitch_in","gate_in","mod1_in","mod2_in","clock_in"];
const OUT_IDS = ["env1_out","menv_out","lfo_out","gate_out","audio","pitch_out","clock_out","audio_r"];
const I_PITCH = 0, I_GATE = 1, I_MOD1 = 2, I_MOD2 = 3, I_CLOCK = 4;
const O_ENV1 = 0, O_MENV = 1, O_LFO = 2, O_GATE = 3, O_AUDIO = 4, O_PITCH = 5, O_CLOCK = 6, O_AUDIO_R = 7;
const VOICES = 8;
const CTRL = 16; // samples between control updates of a voice (pitch, WAVSCAN, envelopes 1 and 3-5, mod matrix, filter coefficients)
const TABLE = 2048;
const LEVELS = 7; // band limited versions of each wave: up to 64, 32 ... 1 harmonics
const GATE_THRESHOLD = 1;
const DECAY_TC = Math.log(1 / 0.01);
const ATTACK_TARGET = 1.3, ATTACK_TC = Math.log(ATTACK_TARGET / (ATTACK_TARGET - 1));
const ARP_DIVS = [1, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 2 / 3, 1 / 12]; // beats: 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32, 1/4T, 1/32T
const VOICE_PAN = [-1, 1, -0.5, 0.5, -0.75, 0.75, -0.25, 0.25];

// the mod matrix: sources and destinations by id (mystic.js lists the same ids with their names)
const SOURCES = ["off", "env1", "env2", "env3", "env4", "env5", "lfo1", "lfo2", "lfo3", "lfo4", "lfo5",
	"vel", "key", "wheel", "press", "rand", "cv1", "cv2", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"];
const S_ENV = 1, S_LFO = 6, S_VEL = 11, S_KEY = 12, S_WHEEL = 13, S_PRESS = 14, S_RAND = 15, S_CV1 = 16, S_CV2 = 17, S_MACRO = 18;
const DESTS = ["off", "pitch", "pitch1", "pitch2", "pitch3", "scan1", "scan2", "mut1", "mut2", "mut3", "mut4",
	"vol1", "vol2", "vol3", "ring", "noise", "cut1", "res1", "drive1", "cut2", "res2", "morph", "amp", "pan",
	// global: the effects and the LFOs (a per voice source counts from the last note played)
	"premix", "postmix", "dlymix", "dlyfb", "revmix", "rate1", "rate2", "rate3", "rate4", "rate5"];
const D = {}; DESTS.forEach((d, i) => D[d] = i);
const NVD = D.premix; // destinations below it are per voice
const SRC_I = {}; SOURCES.forEach((s, i) => SRC_I[s] = i);

// DELAY and REVERB after the amp
class FxLine {
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
class FxReverb { // 4 line feedback delay network with damping; two outputs for L and R
	constructor() {
		const k = sampleRate / 44100;
		this.len = [1557, 1617, 1491, 1422].map(l => Math.round(l * k));
		this.lines = this.len.map(l => new FxLine(l + 2));
		this.lp = new Float64Array(4); this.o = new Float64Array(4);
		this.r = 0;
	}
	process(x, g, damp) {
		const L = this.lines, o = this.o;
		for (let k = 0; k < 4; k++) o[k] = L[k].read(this.len[k]);
		const sum = (o[0] + o[1] + o[2] + o[3]) * 0.5;
		for (let k = 0; k < 4; k++) { this.lp[k] += (sum - o[k] - this.lp[k]) * (1 - damp); L[k].write(x * 0.5 + this.lp[k] * g); }
		this.r = (o[0] + o[1] - o[2] - o[3]) * 0.5;
		return (o[0] - o[1] + o[2] - o[3]) * 0.5;
	}
}

// PRE-FX and POST-FX: one stereo effect each, by type. P1 / P2 are 0..1; mystic.js names them per type
const FX_TYPES = { off: 0, chorus: 1, flanger: 2, phaser: 3, tremolo: 4, lofi: 5, distort: 6, comp: 7 };
class FxUnit {
	constructor() {
		this.type = 0; this.ph = 0; this.l = 0; this.r = 0;
		this.dl = null; this.dr = null; this.fbl = 0; this.fbr = 0;
		this.ap = new Float64Array(16); this.apc = [0, 0]; this.cnt = 0;
		this.hl = 0; this.hr = 0; this.hold = 0; this.lpl = 0; this.lpr = 0; this.env = 0;
	}
	reset() { this.ap.fill(0); this.fbl = this.fbr = 0; this.hl = this.hr = 0; this.lpl = this.lpr = 0; this.env = 0; if (this.dl) { this.dl.b.fill(0); this.dr.b.fill(0); } }
	process(l, r, f, mix) {
		const t = FX_TYPES[f.type] || 0, sr = sampleRate, p1 = f.p1, p2 = f.p2;
		if (t !== this.type) { this.type = t; this.reset(); }
		if (!t || mix <= 0) { this.l = l; this.r = r; return; }
		let wl = l, wr = r;
		const rate = 0.05 * Math.pow(160, p1); // 0.05 .. 8 Hz
		if (t <= 4) { this.ph += rate / sr; if (this.ph >= 1) this.ph -= 1; }
		const s0 = Math.sin(2 * Math.PI * this.ph), s1 = Math.cos(2 * Math.PI * this.ph);
		if (t === 1 || t === 2) {
			if (!this.dl) { this.dl = new FxLine(Math.round(sr * 0.05)); this.dr = new FxLine(Math.round(sr * 0.05)); }
			if (t === 1) { // CHORUS: two voices a quarter turn apart, P2 depth
				const base = 0.012 * sr, dep = 0.007 * sr * p2;
				wl = this.dl.read(base + dep * s0); wr = this.dr.read(base + dep * s1);
				this.dl.write(l); this.dr.write(r);
			} else { // FLANGER: a short sweep with feedback (P2)
				const fb = p2 * 0.9;
				wl = this.dl.read(sr * (0.0008 + 0.004 * (0.5 + 0.5 * s0)));
				wr = this.dr.read(sr * (0.0008 + 0.004 * (0.5 + 0.5 * s1)));
				this.dl.write(l + wl * fb); this.dr.write(r + wr * fb);
			}
		}
		else if (t === 3) { // PHASER: 4 all-pass stages per side, swept 200 Hz .. 3 kHz, feedback P2
			if (this.cnt-- <= 0) {
				this.cnt = 15;
				for (let c = 0; c < 2; c++) {
					const fc = 200 * Math.pow(15, 0.5 + 0.5 * (c ? s1 : s0)), tn = Math.tan(Math.PI * fc / sr);
					this.apc[c] = (1 - tn) / (1 + tn);
				}
			}
			const fb = p2 * 0.85, A = this.ap;
			for (let c = 0; c < 2; c++) {
				const a = this.apc[c];
				let x = (c ? r + this.fbr * fb : l + this.fbl * fb);
				for (let k = 0; k < 4; k++) { const i = c * 8 + k * 2, y = -a * x + A[i]; A[i] = x + a * y; x = y; }
				if (c) { wr = x; this.fbr = x; } else { wl = x; this.fbl = x; }
			}
		}
		else if (t === 4) { // TREMOLO: P2 depth, the sides half a turn apart
			wl = l * (1 - p2 * (0.5 + 0.5 * s0)); wr = r * (1 - p2 * (0.5 - 0.5 * s0));
		}
		else if (t === 5) { // LO-FI: P1 bits (16 .. 3), P2 sample rate (down to 1/32)
			const steps = Math.pow(2, 16 - p1 * 13) / 2, n = 1 + Math.floor(p2 * p2 * 31);
			if (--this.hold <= 0) { this.hold = n; this.hl = Math.round(l * steps) / steps; this.hr = Math.round(r * steps) / steps; }
			wl = this.hl; wr = this.hr;
		}
		else if (t === 6) { // DISTORT: P1 drive, P2 tone (a low pass 500 Hz .. 12 kHz)
			const dr = 1 + p1 * p1 * 30, k = 1 - Math.exp(-2 * Math.PI * 500 * Math.pow(24, p2) / sr), norm = 1 / Math.min(dr, 2.5);
			this.lpl += (fastTanh(l * dr) * norm - this.lpl) * k; this.lpr += (fastTanh(r * dr) * norm - this.lpr) * k;
			wl = this.lpl; wr = this.lpr;
		}
		else { // COMP: P1 amount (threshold 0 .. -36 dB, 4:1, with make-up), P2 release (20 ms .. 1 s)
			const a = Math.max(Math.abs(l), Math.abs(r)), thr = Math.pow(10, -p1 * 36 / 20);
			const rel = Math.exp(-1 / (sr * (0.02 + p2 * p2))), att = Math.exp(-1 / (sr * 0.003));
			this.env = a > this.env ? a + (this.env - a) * att : a + (this.env - a) * rel;
			let g = this.env > thr ? Math.pow(thr / this.env, 0.75) : 1;
			g *= 1 + p1 * 2; // make-up
			wl = l * g; wr = r * g;
		}
		this.l = l + (wl - l) * mix; this.r = r + (wr - r) * mix;
	}
}

const MIDI_CLOCK_TIMEOUT = 0.5;
const VOWELS = [[800, 1150], [350, 2000], [270, 2300], [450, 800], [325, 700]]; // A E I O U formants

// ---- the 8 waves: SINE TRIANGLE SAW SQUARE PULSE ORGAN VOX DIGITAL, additive (64 harmonics), peak 1.
// Each in LEVELS versions: level L keeps the harmonics up to 64 >> L ----
const SIN = new Float64Array(TABLE);
for (let i = 0; i < TABLE; i++) SIN[i] = Math.sin(2 * Math.PI * i / TABLE);
function buildLevels(amp) {
	const acc = new Float64Array(TABLE), levels = new Array(LEVELS);
	let next = 1, L = LEVELS - 1;
	for (let k = 1; k <= 64; k++) {
		const a = amp(k);
		if (a) for (let i = 0, j = 0; i < TABLE; i++, j = (j + k) & (TABLE - 1)) acc[i] += a * SIN[j];
		if (k === next) { levels[L--] = Float32Array.from(acc); next *= 2; }
	}
	let peak = 0;
	for (let i = 0; i < TABLE; i++) peak = Math.max(peak, Math.abs(acc[i]));
	return levels.map(src => {
		const t = new Float32Array(TABLE + 1);
		let pk = 0;
		for (let i = 0; i < TABLE; i++) pk = Math.max(pk, Math.abs(src[i]));
		const g = 1 / Math.max(peak, pk) || 1; // the same loudness as the full wave, never over 1
		for (let i = 0; i < TABLE; i++) t[i] = src[i] * g;
		t[TABLE] = t[0];
		return t;
	});
}
const WAVES = [
	buildLevels(k => k === 1 ? 1 : 0),
	buildLevels(k => k % 2 ? (((k - 1) / 2) % 2 ? -1 : 1) / (k * k) : 0),
	buildLevels(k => 1 / k),
	buildLevels(k => k % 2 ? 1 / k : 0),
	buildLevels(k => Math.sin(Math.PI * k * 0.25) / k),                  // 25% pulse
	buildLevels(k => ({ 1: 1, 2: 0.8, 3: 0.6, 4: 0.5, 6: 0.4, 8: 0.35 })[k] || 0), // drawbars
	buildLevels(k => Math.exp(-Math.pow((k - 6) / 2, 2)) + 0.6 * Math.exp(-Math.pow((k - 14) / 3, 2)) + (k === 1 ? 0.5 : 0)),
	buildLevels(k => (k === 1 || k % 8 === 0) ? 1 / Math.sqrt(k) : 0)
];
const SINE = WAVES[0][0];
// the level for a phase increment dt: the highest harmonic left stays under 0.45 of the sample rate
function levelOf(dt) {
	const x = 64 * dt / 0.45;
	return x <= 1 ? 0 : Math.min(LEVELS - 1, Math.ceil(Math.log2(x)));
}

function lookup(t, p) {
	const x = p * TABLE, i = x | 0, f = x - i;
	return t[i] + (t[i + 1] - t[i]) * f;
}
function frac(x) { return x - Math.floor(x); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

function newVoice(index) {
	return {
		index: index, ctrl: 0, dt: new Float64Array(3), t0: [SINE, SINE, SINE], t1: [SINE, SINE, SINE], tf: new Float64Array(3),
		spr: new Float64Array(4), mdep: new Float64Array(4), k1: 0, k1b: 0, k2: 0, oct1: 0, combD: 2,
		lv: new Float64Array(5), fb: 0, res1: 0, q1: 2, q2: 2, drv: 1, dn: 1, wl: 1, wb: 0, wh: 0, gain: 1, gl: 1, gr: 1,
		note: -1, vel: 1, rnd: 0, gate: false, age: 0, pitch: 0, target: 0,
		ph: new Float64Array(3), mph: new Float64Array(4), sph: new Float64Array(8),
		e: new Float64Array(5), es: new Int8Array(5), et: new Float64Array(5), // envelopes: level, stage, delay / hold time left
		src: new Float64Array(SOURCES.length), md: new Float64Array(DESTS.length),
		lad: new Float64Array(4), svf1: new Float64Array(2), svf2: new Float64Array(2), vow: new Float64Array(4),
		comb: new Float32Array(2048), combPos: 0
	};
}

// envelope stages
const E_IDLE = 0, E_ATT = 1, E_DEC = 2, E_SUS = 3, E_REL = 4, E_DELAY = 5, E_HOLD = 6;

class MysticDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.gateHigh = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.voices = [];
		for (let i = 0; i < VOICES; i++) this.voices.push(newVoice(i));
		this.clock = 0;          // voice ages
		this.monoStack = [];
		this.lastPitch = 0;
		this.bend = 0; this.wheel = 0; this.press = 0;
		this.lfoPh = new Float64Array(5); this.lfoHold = new Float64Array(5); this.lfoPrev = new Float64Array(5); this.lfoV = new Float64Array(5);
		this.lfo = 0;
		this.lastVoice = this.voices[0];
		this.envP = [0, 1, 2, 3, 4].map(() => ({ ca: 0, cd: 0, cr: 0, dl: 0, h: 0, s: 0, loop: false }));
		this.routes = [];        // [source, destination, depth] from the matrix and the macros
		this.gsrc = new Float64Array(SOURCES.length); this.gm = new Float64Array(DESTS.length); this.gctrl = 0;
		this.sustained = new Set(); this.sustain = false;
		this.prefx = new FxUnit(); this.postfx = new FxUnit();
		// arpeggiator
		this.held = [];          // [note, velocity, still held] in the order they were pressed
		this.latched = false;
		this.phrase = [];
		this.arpPhase = 0; this.arpIndex = -1; this.arpNotes = []; this.arpOff = 0; this.arpDir = 1; this.arpOct = -1; this.arpRunning = false;
		this.ratchetLeft = 0; this.ratchetT = 0; this.ratchetLen = 0; this.ratchetNotes = null; this.stepLen = 0; this.sinceStep = 0;
		this.midiTicks = 0; this.midiCount = 0; this.lastMidiClock = -1e12; this.sampleCount = 0;
		this.preview = newVoice(0);
	}

	message(m) {
		switch (m.type) {
			case "note": m.on ? this.keyOn(m.note, m.vel === undefined ? 1 : m.vel) : this.keyOff(m.note); break;
			case "allNotesOff": this.held = []; this.monoStack = []; this.sustained.clear(); for (const v of this.voices) if (v.gate) this.release(v); break;
			case "bend": this.bend = m.value; break;
			case "modwheel": this.wheel = clamp(m.value, 0, 1); break;
			case "pressure": this.press = clamp(m.value, 0, 1); break;
			case "trigger": if (m.gate) this.keyOn(60, 1); else this.keyOff(60); break;
			case "midiClock": this.midiTicks++; this.lastMidiClock = this.sampleCount; break;
			case "midiStart": this.midiCount = 0; this.arpIndex = -1; break;
		}
	}

	// the envelopes' coefficients, per sample (ENV 2) or per control step (the others)
	envCoefs() {
		const s = this.s, sr = sampleRate;
		[s.env1, s.env2, s.env3, s.env4, s.env5].forEach((E, k) => {
			const P = this.envP[k], n = k === 1 ? 1 : CTRL;
			P.ca = 1 - Math.pow(Math.exp(-ATTACK_TC / (Math.max(E.a, 0.0005) * sr)), n);
			P.cd = Math.exp(-DECAY_TC * n / (Math.max(E.d, 0.002) * sr));
			P.cr = Math.exp(-DECAY_TC * n / (Math.max(E.r, 0.002) * sr));
			P.dl = (E.dl || 0) * sr; P.h = (E.h || 0) * sr; P.s = E.s; P.loop = !!E.loop;
		});
	}

	setSettings(s) {
		this.s = s;
		this.envCoefs(); // a note may come before the next block
		// SUSTAIN let go: the notes it kept end
		if (this.sustain && !s.sustain) { const n = Array.from(this.sustained); this.sustained.clear(); for (const k of n) this.keyOffNow(k); }
		this.sustain = !!s.sustain;
	}
	setMidiConnected(c) {
		if (!c && this.midiConnected) this.message({ type: "allNotesOff" });
		this.midiConnected = c;
	}

	// ---- keys: straight to the voices, or to the arpeggiator. SUSTAIN keeps released notes ----
	keyOn(note, vel) {
		this.sustained.delete(note);
		if (this.s.arp.on) {
			if (this.latched && !this.held.some(h => h[2])) this.held = []; // a new chord replaces a latched one
			this.held = this.held.filter(h => h[0] !== note);
			this.held.push([note, vel, true]);
			this.latched = false;
			if (this.held.length > 1) this.phrase = this.held.map(h => h[0]); // PHRASE: the notes as played
			return;
		}
		this.voiceOn(note, vel);
	}

	keyOff(note) {
		if (this.s.sustain) { this.sustained.add(note); return; }
		this.keyOffNow(note);
	}

	keyOffNow(note) {
		if (this.s.arp.on) {
			if (this.s.arp.latch) {
				const h = this.held.find(h => h[0] === note);
				if (h) h[2] = false; // still played, no longer held
				if (!this.held.some(h => h[2])) this.latched = true;
			}
			else this.held = this.held.filter(h => h[0] !== note);
			return;
		}
		this.voiceOff(note);
	}

	voiceOn(note, vel) {
		const s = this.s;
		const target = (note - 60) / 12;
		if (!this.voices.some(x => x.gate)) // the first note restarts the LFOs set to TRIG
			this.lfoSettings().forEach((l, k) => { if (l.trig) { this.lfoPh[k] = 0; this.lfoPrev[k] = this.lfoHold[k]; this.lfoHold[k] = Math.random() * 2 - 1; } });
		let v;
		if (s.voice_mode === "mono") {
			this.monoStack = this.monoStack.filter(n => n !== note);
			this.monoStack.push(note);
			v = this.voices[0];
			const legato = v.gate;
			v.note = note; v.target = target; v.vel = vel; v.gate = true;
			// legato: the envelopes go on and the pitch glides (or jumps, without GLIDE) to the new note
			if (!legato) { this.trigger(v); if (s.glide <= 0) v.pitch = target; }
		}
		else {
			v = this.voices.find(x => x.note === note && x.es[1]) ||
				this.voices.find(x => !x.es[1]) ||
				this.voices.filter(x => !x.gate).sort((a, b) => a.age - b.age)[0] ||
				this.voices.slice().sort((a, b) => a.age - b.age)[0];
			v.pitch = s.glide > 0 && this.lastPitch !== null ? this.lastPitch : target;
			v.note = note; v.target = target; v.vel = vel; v.gate = true;
			this.trigger(v);
		}
		v.age = ++this.clock;
		this.lastPitch = target;
		this.lastVoice = v;
	}

	voiceOff(note) {
		if (this.s.voice_mode === "mono") {
			this.monoStack = this.monoStack.filter(n => n !== note);
			const v = this.voices[0];
			if (this.monoStack.length) { const n = this.monoStack[this.monoStack.length - 1]; v.note = n; v.target = (n - 60) / 12; }
			else if (v.note === note) this.release(v);
			return;
		}
		for (const v of this.voices) if (v.note === note && v.gate) this.release(v);
	}

	trigger(v) {
		for (let k = 0; k < 5; k++) {
			const P = this.envP[k];
			v.es[k] = P.dl > 0 ? E_DELAY : E_ATT; v.et[k] = P.dl;
		}
		v.ctrl = 0; v.rnd = Math.random() * 2 - 1;
		if (v.e[1] < 1e-4) { v.ph.fill(0); v.mph.fill(0); v.sph.fill(0); } // a fresh note starts in phase
	}
	release(v) { v.gate = false; for (let k = 0; k < 5; k++) if (v.es[k]) v.es[k] = E_REL; }

	// one envelope of a voice over n samples (ENV 2, the amp, every sample; the others at control rate)
	envRun(v, k) {
		const P = this.envP[k], n = k === 1 ? 1 : CTRL;
		let st = v.es[k], e = v.e[k];
		switch (st) {
			case E_DELAY: if ((v.et[k] -= n) <= 0) st = E_ATT; break;
			case E_ATT: e += (ATTACK_TARGET - e) * P.ca; if (e >= 1) { e = 1; if (P.h > 0) { st = E_HOLD; v.et[k] = P.h; } else st = E_DEC; } break;
			case E_HOLD: if ((v.et[k] -= n) <= 0) st = E_DEC; break;
			case E_DEC: e = P.s + (e - P.s) * P.cd; if (Math.abs(e - P.s) < 1e-4) { e = P.s; st = E_SUS; } break;
			case E_SUS: e = P.s; break;
			case E_REL: e *= P.cr; if (e < 1e-5) { e = 0; st = E_IDLE; } break;
		}
		if (st === E_SUS) {
			if (!v.gate) st = E_REL;
			else if (P.loop) { st = P.dl > 0 ? E_DELAY : E_ATT; v.et[k] = P.dl; } // LOOP: around again while the note is held
		}
		v.es[k] = st; v.e[k] = e;
	}

	lfoSettings() { const s = this.s; return [s.lfo].concat(s.lfos); }

	// ---- arpeggiator: one step ----
	arpNotesOff() { for (const n of this.arpNotes) this.voiceOff(n); this.arpNotes = []; }
	arpStep() {
		const s = this.s, a = s.arp;
		this.clockPulse = Math.round(0.005 * sampleRate);
		this.stepLen = this.arpRunning && this.sinceStep < sampleRate * 4 ? this.sinceStep : this.arpStepSamples;
		this.sinceStep = 0;
		this.arpNotesOff();
		this.ratchetLeft = 0;
		if (!this.held.length) return;
		this.arpRunning = true;
		let notes = this.held.map(h => h[0]);
		// PHRASE: two or more keys make the phrase (keyOn); one key plays it from that note
		if (a.mode === "phrase") {
			if (notes.length === 1 && this.phrase.length > 1) { const d = notes[0] - this.phrase[0]; notes = this.phrase.map(n => n + d); }
		}
		else if (a.mode !== "order") notes = notes.slice().sort((x, y) => x - y);
		const seq = [];
		for (let o = 0; o < a.oct; o++) for (const n of notes) seq.push(n + 12 * o);
		const len = seq.length;
		let play;
		if (a.mode === "chord") { // every note at once, an octave higher each step
			this.arpOct = (this.arpOct + 1) % a.oct;
			play = notes.map(n => n + 12 * this.arpOct);
		}
		else {
			let i;
			if (a.mode === "random") i = Math.floor(Math.random() * len);
			else if (a.mode === "down") i = this.arpIndex = ((this.arpIndex < 0 ? len : this.arpIndex) - 1 + len) % len;
			else if (a.mode === "updown" && len > 1) {
				let n = this.arpIndex + this.arpDir;
				if (n >= len) { this.arpDir = -1; n = len - 2; }
				if (n < 0) { this.arpDir = 1; n = this.arpIndex < 0 ? 0 : 1; }
				i = this.arpIndex = n;
			}
			else if (a.mode === "upanddn") { // UP & DOWN: the top and bottom notes twice
				this.arpIndex = (this.arpIndex + 1) % (2 * len);
				i = this.arpIndex < len ? this.arpIndex : 2 * len - 1 - this.arpIndex;
			}
			else i = this.arpIndex = (this.arpIndex + 1) % len;
			play = [seq[i % len]];
		}
		if (Math.random() >= clamp(a.chance === undefined ? 1 : a.chance, 0, 1)) return; // CHANCE: this step rests
		const vel = this.held.find(x => x[0] === play[0]) ? this.held.find(x => x[0] === play[0])[1] : this.held[0][1];
		const r = clamp(a.ratchet | 0, 1, 4);
		this.ratchetLen = Math.max(1, Math.round(this.stepLen / r));
		this.ratchetLeft = r - 1; this.ratchetT = this.ratchetLen; this.ratchetNotes = play; this.ratchetVel = vel;
		this.arpPlay(play, vel);
	}
	arpPlay(play, vel) {
		for (const n of play) this.voiceOn(n, vel);
		this.arpNotes = play.slice();
		this.arpOff = Math.max(1, Math.round(this.ratchetLen * clamp(this.s.arp.gate, 0.05, 1)));
	}

	gateEdge(i) {
		const high = this.ins[i] > GATE_THRESHOLD ? 1 : 0;
		const rising = high && !this.gateHigh[i];
		const falling = !high && this.gateHigh[i];
		this.gateHigh[i] = high;
		return rising ? 1 : (falling ? -1 : 0);
	}

	// ---- an oscillator through its mutators (j: which of the two is next), at phase p. The tables
	// (with WAVSCAN) and the mutator settings are worked out at control rate ----
	base(v, o, p) {
		const a = lookup(v.t0[o], p), f = v.tf[o];
		return f > 0.001 ? a + (lookup(v.t1[o], p) - a) * f : a;
	}

	mut(v, o, j, p) {
		if (j === 2 || o === 2) return this.base(v, o, p);
		const mi = o * 2 + j, mode = this.mMode[mi];
		const d = v.mdep[mi], wet = this.mWet[mi];
		if (d <= 0.0005 || wet <= 0.0005 || mode === 0) return this.mut(v, o, j + 1, p);
		let w;
		switch (mode) {
			case 1: w = this.mut(v, o, j + 1, frac(p + d * 1.5 * lookup(SINE, v.mph[mi]))); break;   // FM-LIN
			case 2: w = (this.mut(v, o, j + 1, p) + this.mut(v, o, j + 1, v.sph[mi * 2]) + this.mut(v, o, j + 1, v.sph[mi * 2 + 1])) / 3; break; // WAVSTACK
			case 3: w = this.mut(v, o, j + 1, frac(p * (1 + d * this.mRatio[mi] * 2))); break;            // OSC SYNC
			case 4: {                                                                                       // PW-ASYM
				const pw = 0.5 - d * 0.47;
				w = this.mut(v, o, j + 1, p < pw ? p * 0.5 / pw : 0.5 + (p - pw) * 0.5 / (1 - pw));
				break;
			}
			case 5: {                                                                                       // HARMONIC
				const h = 1 + d * Math.min(15, this.mRatio[mi] * 2), h0 = h | 0, f = h - h0;
				const a = this.mut(v, o, j + 1, frac(p * h0));
				w = f > 0.001 ? a + (this.mut(v, o, j + 1, frac(p * (h0 + 1))) - a) * f : a;
				break;
			}
			default: w = this.mut(v, o, j + 1, frac(p + d * 0.155 * lookup(SINE, p)));                 // PHAZDIST
		}
		if (wet >= 0.9995) return w;
		const dry = this.mut(v, o, j + 1, p);
		return dry + (w - dry) * wet;
	}

	beginBlock(n) {
		const s = this.s, sr = sampleRate;
		const MODES = { off: 0, fm: 1, stack: 2, sync: 3, pw: 4, harmonic: 5, phazdist: 6 };
		this.mMode = this.mMode || new Int8Array(4); this.mRatio = this.mRatio || new Float64Array(4);
		this.mDepth = this.mDepth || new Float64Array(4); this.mWet = this.mWet || new Float64Array(4);
		for (let i = 0; i < 4; i++) {
			const m = s.mut[i];
			this.mMode[i] = MODES[m.mode] || 0; this.mRatio[i] = m.ratio; this.mDepth[i] = m.depth; this.mWet[i] = m.wet;
		}
		this.f1t = { lp24: 0, lp12: 1, bp: 2, hp: 3, vowel: 4, comb: 5 }[s.f1.type] || 0;
		this.envCoefs();
		// the mod matrix and the macros, as one list of routes
		const R = this.routes; R.length = 0;
		for (const m of s.matrix) {
			const si = SRC_I[m.src], di = D[m.dst];
			if (si > 0 && di > 0 && m.amt) R.push([si, di, m.amt]);
		}
		s.macros.forEach((m, k) => { for (const t of m.t) { const di = D[t.d]; if (di > 0 && t.a) R.push([S_MACRO + k, di, t.a]); } });
		this.glideK = s.glide > 0.0005 ? 1 - Math.exp(-CTRL / (s.glide * 0.3 * sr)) : 1; // per control step
		this.cut1 = Math.log2(clamp(s.f1.cutoff, 20, 20000) / 20);
		this.cut2 = Math.log2(clamp(s.f2.cutoff, 20, 20000) / 20);
		this.vol = s.volume * s.volume;
		if (s.delay) this.dTone = 1 - Math.exp(-2 * Math.PI * clamp(s.delay.tone, 200, 18000) / sr);
		if (s.reverb) { this.rG = 0.7 + clamp(s.reverb.time, 0, 1) * 0.28; this.rDamp = 0.1 + (1 - clamp(s.reverb.tone, 0, 1)) * 0.6; }
		const a = s.arp;
		this.arpStepSamples = 60 / Math.max(10, a.tempo) * ARP_DIVS[clamp(a.div | 0, 0, ARP_DIVS.length - 1)] * sr;
		// arpeggiator clock: CLOCK IN > MIDI clock > TEMPO
		this.midiClock = !this.patched[I_CLOCK] && (this.sampleCount - this.lastMidiClock) < MIDI_CLOCK_TIMEOUT * sr;
		if (this.midiClock) {
			const ticks = Math.max(1, Math.round(24 * ARP_DIVS[clamp(a.div | 0, 0, ARP_DIVS.length - 1)]));
			for (; this.midiTicks > 0; this.midiTicks--) {
				if (a.on && this.midiCount % ticks === 0) this.arpStep();
				this.midiCount++;
			}
		}
		this.midiTicks = 0;
		if (!a.on && this.held.length) { this.held = []; this.arpNotesOff(); this.ratchetLeft = 0; }
	}

	// the sources every voice shares: LFOs (with GAIN), wheel, pressure, CV, macros
	globalSources() {
		const g = this.gsrc, ls = this.lfoSettings(), ins = this.ins, p = this.patched;
		for (let k = 0; k < 5; k++) g[S_LFO + k] = this.lfoV[k] * ls[k].gain;
		g[S_WHEEL] = this.wheel; g[S_PRESS] = this.press;
		g[S_CV1] = p[I_MOD1] ? ins[I_MOD1] / 5 : 0; g[S_CV2] = p[I_MOD2] ? ins[I_MOD2] / 5 : 0;
		const m = this.s.macros;
		for (let k = 0; k < 8; k++) g[S_MACRO + k] = m[k].v;
	}
	voiceSources(v, src) {
		src.set(this.gsrc);
		for (let k = 0; k < 5; k++) src[S_ENV + k] = v.e[k];
		src[S_VEL] = v.vel; src[S_KEY] = v.target / 5; src[S_RAND] = v.rnd;
	}
	modulate(src, md, from, to) {
		md.fill(0);
		const R = this.routes;
		for (let i = 0; i < R.length; i++) { const r = R[i]; if (r[1] >= from && r[1] < to) md[r[1]] += src[r[0]] * r[2]; }
	}

	// control rate: envelopes 1 and 3-5, the mod matrix, pitch (glide), oscillator increments, WAVSCAN tables,
	// mutator depths and spread, mixer levels, filter and amp settings
	control(v, pitchCv, scanCv, cutCv) {
		const s = this.s, sr = sampleRate, l = s.lfo, f1 = s.f1, f2 = s.f2, mx = s.mix, lfo = this.lfoV[0] * l.gain;
		this.envRun(v, 0); for (let k = 2; k < 5; k++) this.envRun(v, k);
		const md = v.md;
		if (this.routes.length) { this.voiceSources(v, v.src); this.modulate(v.src, md, 1, NVD); }
		else md.fill(0);
		v.pitch += (v.target - v.pitch) * this.glideK;
		const mm = v.e[2] * s.menv.mut + lfo * l.mut;
		const scan = v.e[2] * s.menv.scan * 7 + scanCv;
		for (let k = 0; k < 3; k++) {
			const os = s.osc[k];
			v.dt[k] = clamp(C4 * Math.pow(2, v.pitch + pitchCv + md[D.pitch] + md[D.pitch1 + k] + os.semi / 12 + os.cent / 1200) / sr, 0, 0.45);
			const w = k < 2 ? clamp(os.wave + scan + md[D.scan1 + k] * 7, 0, 7) : clamp(os.wave | 0, 0, 7), i0 = w | 0, L = levelOf(v.dt[k]);
			v.t0[k] = WAVES[i0][L]; v.t1[k] = WAVES[Math.min(7, i0 + 1)][L]; v.tf[k] = i0 < 7 ? w - i0 : 0;
		}
		for (let mi = 0; mi < 4; mi++) {
			v.mdep[mi] = clamp(this.mDepth[mi] + mm + md[D.mut1 + mi], 0, 1);
			v.spr[mi] = (0.002 + v.mdep[mi] * 0.02) * this.mRatio[mi];
		}
		v.lv[0] = clamp(mx.osc1 + md[D.vol1], 0, 1); v.lv[1] = clamp(mx.osc2 + md[D.vol2], 0, 1); v.lv[2] = clamp(mx.osc3 + md[D.vol3], 0, 1);
		v.lv[3] = clamp(mx.ring + md[D.ring], 0, 1); v.lv[4] = clamp(mx.noise + md[D.noise], 0, 1);
		// filter 1
		const res1 = clamp(f1.res + md[D.res1], 0, 1), drive = clamp(f1.drive + md[D.drive1], 0, 1);
		v.fb = res1 * 4.2; v.q1 = 2 - res1 * 1.95; v.drv = 1 + drive * 6; v.dn = 1 / Math.min(v.drv, 2.5); v.res1 = res1;
		const oct1 = this.cut1 + v.e[0] * f1.env * 8 + v.target * f1.key + cutCv + lfo * l.cutoff * 4 + md[D.cut1] * 8;
		v.oct1 = oct1;
		const fc1 = clamp(20 * Math.pow(2, oct1), 20, sr * 0.45);
		if (this.f1t === 0) v.k1 = 1 - Math.exp(-2 * Math.PI * Math.min(fc1, sr * 0.3) / sr);
		else if (this.f1t === 4) {
			const pos = clamp((oct1 / 10) * 4, 0, 4), i0 = Math.min(3, pos | 0), fr = pos - i0;
			v.k1 = 2 * Math.sin(Math.PI * (VOWELS[i0][0] + (VOWELS[i0 + 1][0] - VOWELS[i0][0]) * fr) / sr);
			v.k1b = 2 * Math.sin(Math.PI * (VOWELS[i0][1] + (VOWELS[i0 + 1][1] - VOWELS[i0][1]) * fr) / sr);
		}
		else if (this.f1t === 5) v.combD = clamp(sr / fc1, 2, 2000);
		else v.k1 = 2 * Math.sin(Math.PI * Math.min(fc1, sr * 0.2) / (2 * sr));
		// filter 2: ENV 1 and LFO 1 reach it too (its own amounts)
		const oct2 = this.cut2 + cutCv + v.e[0] * (f2.env || 0) * 8 + lfo * (f2.lfo || 0) * 4 + md[D.cut2] * 8;
		v.k2 = 2 * Math.sin(Math.PI * clamp(20 * Math.pow(2, oct2), 20, sr * 0.2) / (2 * sr));
		v.q2 = 2 - clamp(f2.res + md[D.res2], 0, 1) * 1.95;
		const m2 = clamp(f2.morph + md[D.morph], 0, 1);
		v.wl = Math.max(0, 1 - 2 * m2); v.wb = 1 - Math.abs(2 * m2 - 1); v.wh = Math.max(0, 2 * m2 - 1);
		// amp: velocity, LFO 2 (tremolo), the matrix; the voice's place in the stereo field
		const lfo2 = this.lfoV[1] * s.lfos[0].gain;
		v.gain = (1 - s.vel + s.vel * v.vel) * (1 - (s.amp_lfo || 0) * (0.5 - 0.5 * lfo2)) * clamp(1 + md[D.amp], 0, 2);
		const pan = clamp((s.voice_mode === "mono" ? 0 : VOICE_PAN[v.index] * (s.width || 0)) + md[D.pan], -1, 1), pa = (pan + 1) * Math.PI / 4;
		v.gl = Math.cos(pa) * Math.SQRT2; v.gr = Math.sin(pa) * Math.SQRT2;
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, patched = this.patched, sr = sampleRate;

		// ---- CV gate input: a note at C4 (moved by PITCH CV) ----
		const ge = this.gateEdge(I_GATE);
		if (ge > 0) this.voiceOn(60, 1); else if (ge < 0) this.voiceOff(60);

		// ---- arpeggiator ----
		this.sinceStep++;
		if (s.arp.on) {
			if (this.arpOff > 0 && --this.arpOff === 0 && this.arpNotes.length) this.arpNotesOff();
			if (this.ratchetLeft > 0 && --this.ratchetT <= 0) { // RATCHET: the step's notes again
				this.arpNotesOff(); this.ratchetLeft--; this.ratchetT = this.ratchetLen;
				this.arpPlay(this.ratchetNotes, this.ratchetVel);
			}
			if (patched[I_CLOCK]) { if (this.gateEdge(I_CLOCK) > 0) this.arpStep(); }
			else if (!this.midiClock && this.held.length) {
				// SWING: the steps long and short in turn
				const sw = (clamp(s.arp.swing || 50, 50, 75) - 50) / 50;
				this.arpPhase += 1 / (this.arpStepSamples * (this.arpParity ? 1 - sw : 1 + sw));
				if (this.arpPhase >= 1 || !this.arpRunning) { this.arpPhase = this.arpPhase >= 1 ? this.arpPhase - 1 : 0; this.arpParity = !this.arpParity; this.arpStep(); }
			}
			if (!this.held.length) { this.arpIndex = -1; this.arpPhase = 0; this.arpOct = -1; this.arpRunning = false; }
		}

		// ---- LFOs (for all voices) and the global destinations, at control rate ----
		const gm = this.gm;
		if (this.gctrl-- <= 0) {
			this.gctrl = CTRL - 1;
			const ls = this.lfoSettings();
			for (let k = 0; k < 5; k++) {
				const l = ls[k];
				let ph = this.lfoPh[k] + clamp(l.rate * (gm[D.rate1 + k] ? Math.pow(2, gm[D.rate1 + k] * 3) : 1), 0.01, 50) * CTRL / sr;
				if (ph >= 1) { ph -= Math.floor(ph); this.lfoPrev[k] = this.lfoHold[k]; this.lfoHold[k] = Math.random() * 2 - 1; }
				this.lfoPh[k] = ph;
				let y;
				switch (l.shape) {
					case "tri": y = 1 - 4 * Math.abs(ph - 0.5); break;
					case "saw": y = 1 - 2 * ph; break;
					case "ramp": y = 2 * ph - 1; break;
					case "square": y = ph < 0.5 ? 1 : -1; break;
					case "sh": y = this.lfoHold[k]; break;
					case "smooth": y = this.lfoPrev[k] + (this.lfoHold[k] - this.lfoPrev[k]) * (0.5 - 0.5 * Math.cos(Math.PI * ph)); break;
					default: y = lookup(SINE, ph);
				}
				this.lfoV[k] = y;
			}
			this.lfo = this.lfoV[0] * s.lfo.gain;
			this.globalSources();
			if (this.routes.length) { this.voiceSources(this.lastVoice, this.lastVoice.src); this.modulate(this.lastVoice.src, gm, NVD, DESTS.length); }
			else gm.fill(0);
		}
		const lfo = this.lfo;

		const f1 = s.f1, f1t = this.f1t, parallel = s.route === "parallel";
		let outL = 0, outR = 0, anyGate = false, ctrlArgs = null;

		for (let vi = 0; vi < VOICES; vi++) {
			const v = this.voices[vi];
			if (!v.es[1] && !v.gate) continue;
			anyGate = anyGate || v.gate;
			this.envRun(v, 1);

			if (v.ctrl-- <= 0) {
				if (!ctrlArgs)
					ctrlArgs = [ (patched[I_PITCH] ? ins[I_PITCH] : 0) + this.bend + lfo * s.lfo.pitch * (2 / 12),
						(patched[I_MOD2] ? ins[I_MOD2] / 5 * 7 : 0) + lfo * s.lfo.scan * 3.5,
						(patched[I_MOD1] ? ins[I_MOD1] : 0) ];
				this.control(v, ctrlArgs[0], ctrlArgs[1], ctrlArgs[2]);
				v.ctrl = CTRL - 1;
			}

			// oscillators: phases, mutator phases, values
			const lv = v.lv;
			let o0 = 0, o1 = 0, o2 = 0;
			for (let k = 0; k < 2; k++) {
				const dt = v.dt[k];
				v.ph[k] = frac(v.ph[k] + dt);
				for (let j = 0; j < 2; j++) {
					const mi = k * 2 + j, mode = this.mMode[mi];
					if (mode === 1) v.mph[mi] = frac(v.mph[mi] + dt * this.mRatio[mi]);
					else if (mode === 2) {
						v.sph[mi * 2] = frac(v.sph[mi * 2] + dt * (1 + v.spr[mi]));
						v.sph[mi * 2 + 1] = frac(v.sph[mi * 2 + 1] + dt * (1 - v.spr[mi]));
					}
				}
			}
			v.ph[2] = frac(v.ph[2] + v.dt[2]);
			if (lv[0] > 0 || lv[3] > 0) o0 = this.mut(v, 0, 0, v.ph[0]);
			if (lv[1] > 0 || lv[3] > 0) o1 = this.mut(v, 1, 0, v.ph[1]);
			if (lv[2] > 0) o2 = this.base(v, 2, v.ph[2]);
			const noise = lv[4] > 0 ? Math.random() * 2 - 1 : 0;
			const mix = (o0 * lv[0] + o1 * lv[1] + o2 * lv[2] + o0 * o1 * lv[3] + noise * lv[4]) * 0.5;

			// filter 1
			const x = fastTanh(mix * v.drv) * v.dn, fb = v.fb;
			let y1;
			if (f1t === 0) { // LP ladder 24
				const g = v.k1, L = v.lad;
				const xin = fastTanh(x - fb * L[3]);
				L[0] += g * (xin - L[0]); L[1] += g * (L[0] - L[1]); L[2] += g * (L[1] - L[2]); L[3] += g * (L[2] - L[3]);
				y1 = L[3] * (1 + fb * 0.3);
			}
			else if (f1t === 4) { // VOWEL: two formant band passes
				const V = v.vow, q = 0.25 - v.res1 * 0.2;
				let hp = x - V[0] - q * V[1]; V[1] += v.k1 * hp; V[0] += v.k1 * V[1];
				hp = x - V[2] - q * V[3]; V[3] += v.k1b * hp; V[2] += v.k1b * V[3];
				y1 = (V[1] + V[3] * 0.7) * (q + 0.1) * 2.5;
			}
			else if (f1t === 5) { // COMB
				const C = v.comb, n = 2048;
				let rp = v.combPos - v.combD; if (rp < 0) rp += n;
				const i0 = rp | 0, fr = rp - i0, a = C[i0], b = C[(i0 + 1) % n];
				const yy = x + (a + (b - a) * fr) * v.res1 * 0.95;
				C[v.combPos] = fastTanh(yy);
				v.combPos = (v.combPos + 1) % n;
				y1 = yy * 0.6;
			}
			else { // LP 12 / BP / HP: state variable, 2x
				const f = v.k1, S = v.svf1, q1 = v.q1;
				let hp = x - S[0] - q1 * S[1]; S[1] += f * hp; S[0] += f * S[1]; S[1] = fastTanh(S[1]);
				hp = x - S[0] - q1 * S[1]; S[1] += f * hp; S[0] += f * S[1]; S[1] = fastTanh(S[1]);
				y1 = f1t === 2 ? S[1] : (f1t === 3 ? hp : S[0]);
			}
			// filter 2: LP -> BP -> HP
			const in2 = parallel ? x : y1, S2 = v.svf2, f2c = v.k2, q2 = v.q2;
			let hp2 = in2 - S2[0] - q2 * S2[1]; S2[1] += f2c * hp2; S2[0] += f2c * S2[1]; S2[1] = fastTanh(S2[1]);
			hp2 = in2 - S2[0] - q2 * S2[1]; S2[1] += f2c * hp2; S2[0] += f2c * S2[1]; S2[1] = fastTanh(S2[1]);
			const y2 = S2[0] * v.wl + S2[1] * v.wb + hp2 * v.wh;
			const filtered = parallel ? (y1 + y2) * 0.5 : y2;
			// amp, pan
			const a = filtered * v.e[1] * v.gain;
			outL += a * v.gl; outR += a * v.gr;
		}
		const lv = this.lastVoice;
		outs[O_ENV1] = lv.e[0] * 5;
		outs[O_MENV] = lv.e[2] * 5;
		outs[O_LFO] = lfo * 5;
		outs[O_GATE] = anyGate ? 5 : 0;
		outs[O_PITCH] = lv.pitch;                       // 1 V/oct, 0 V = C4
		outs[O_CLOCK] = this.clockPulse > 0 ? 5 : 0;    // a pulse on each arpeggiator step
		if (this.clockPulse > 0) this.clockPulse--;
		let L = fastTanh(outL * this.vol * 0.9), R = fastTanh(outR * this.vol * 0.9);
		// PRE-FX, DELAY, REVERB, POST-FX
		const pre = s.prefx, post = s.postfx;
		if (pre.type !== "off") { this.prefx.process(L, R, pre, clamp(pre.mix + gm[D.premix], 0, 1)); L = this.prefx.l; R = this.prefx.r; }
		const dl = s.delay, rv = s.reverb;
		if (dl && dl.on) {
			if (!this.dline) this.dline = new FxLine(Math.round(sampleRate * 2.1)), this.dlineR = new FxLine(Math.round(sampleRate * 2.1)), this.dlp = 0, this.dlpR = 0;
			const d = clamp(dl.time, 0.01, 2) * sampleRate, fbk = clamp(dl.feedback + gm[D.dlyfb] * 0.95, 0, 0.95), dm = clamp(dl.mix + gm[D.dlymix], 0, 1);
			this.dlp += (this.dline.read(d) - this.dlp) * this.dTone;
			this.dlpR += (this.dlineR.read(d) - this.dlpR) * this.dTone;
			this.dline.write(fastTanh(L + this.dlp * fbk)); this.dlineR.write(fastTanh(R + this.dlpR * fbk));
			L += this.dlp * dm; R += this.dlpR * dm;
		}
		if (rv && rv.on) {
			if (!this.rev) this.rev = new FxReverb();
			const rm = clamp(rv.mix + gm[D.revmix], 0, 1), wl = this.rev.process((L + R) * 0.5, this.rG, this.rDamp);
			L += wl * rm; R += this.rev.r * rm;
		}
		if (post.type !== "off") { this.postfx.process(L, R, post, clamp(post.mix + gm[D.postmix], 0, 1)); L = this.postfx.l; R = this.postfx.r; }
		outs[O_AUDIO] = L; outs[O_AUDIO_R] = R;
		return L;
	}

	endBlock(n) { this.sampleCount += n; }

	// a cycle of OSC 1 and OSC 2 through their mutators, for the panel's display
	waveform(o, n) {
		const v = this.preview, s = this.s, pts = new Array(n);
		const w = clamp(s.osc[o].wave, 0, 7), i0 = w | 0;
		v.t0[o] = WAVES[i0][0]; v.t1[o] = WAVES[Math.min(7, i0 + 1)][0]; v.tf[o] = i0 < 7 ? w - i0 : 0;
		for (let mi = 0; mi < 4; mi++) v.mdep[mi] = clamp(this.mDepth ? this.mDepth[mi] : 0, 0, 1);
		for (let i = 0; i < n; i++) {
			const p = i / n;
			for (let j = 0; j < 2; j++) {
				const mi = o * 2 + j;
				v.mph[mi] = frac(p * s.mut[mi].ratio);
				v.sph[mi * 2] = frac(p * 1.03); v.sph[mi * 2 + 1] = frac(p * 0.97);
			}
			pts[i] = Math.round(this.mut(v, o, 0, p) * 1000) / 1000;
		}
		return pts;
	}

	state() {
		return {
			voices: this.voices.filter(v => v.es[1] || v.gate).length,
			gates: this.voices.map(v => v.gate ? v.note : -1),
			lfo: this.lfo,
			lfos: Array.from(this.lfoV, x => Math.round(x * 100) / 100),
			arp: this.s.arp.on ? this.held.map(h => h[0]) : [],
			sustained: this.sustained.size,
			wave: this.mMode ? [this.waveform(0, 96), this.waveform(1, 96)] : null
		};
	}
}
MysticDSP.OUT_IDS = OUT_IDS;
MysticDSP.IN_IDS = IN_IDS;
MysticDSP.MIDI_IN = "midi_in";
MysticDSP.POLY = true; // gets the raw MIDI notes and plays them on its own voices

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.mystic = MysticDSP;

})();
