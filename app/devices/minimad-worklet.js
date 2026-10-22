// devices/minimad-worklet.js
// MINIMAD DSP: a small digital / analog hybrid. Four digital oscillator voices (paraphonic, or one
// voice with PARA off), each running one of the ENGINES with three controls (WAVE, TIMBRE, SHAPE), into
// one 12 dB state variable filter (LPF / BPF / HPF), a VCA per voice from the ENVELOPE (attack, decay /
// release, sustain; FILTER AMT sends it to the cutoff), a CYCLING ENVELOPE (rise, fall, hold, amount;
// ENV, RUN or LOOP), an LFO (six shapes, free or synced) and a modulation MATRIX: five sources (CYC ENV,
// ENVELOPE, LFO, PRESSURE, KEY/ARP) by seven destinations (PITCH, WAVE, TIMBRE, CUTOFF and three
// ASSIGN columns, each set to a knob). An arpeggiator (UP, ORDER, RAND, PATTERN) and a sequencer of up
// to 64 steps (4 notes a step, recorded from the keys), with SPICE / DICE (random octaves, gates, rests
// per step), at its own RATE, the rack's tempo (SYNC) or CLOCK IN. Glide.
// It gets the raw notes of its MIDI channel (POLY), and the notes of its own keyboard (with pressure).
// Loaded on the main thread too, for the tables (WR_DSP.minimad.TABLES).
(function(){

const IN_IDS = ["clock_in"];
const OUT_IDS = ["out_l", "out_r", "pitch_out", "gate_out", "press_out", "clock_out"];
const O_L = 0, O_R = 1, O_PITCH = 2, O_GATE = 3, O_PRESS = 4, O_CLK = 5;
const NV = 4, CTRL = 16, TAU = Math.PI * 2;

// the engines: [name, what WAVE does, what TIMBRE does, what SHAPE does]
const ENGINES = [
	["BASIC WAVES", "WAVE", "SYMMETRY", "SUB"], ["SUPERWAVE", "WAVE", "DETUNE", "VOLUME"], ["WAVETABLE", "TABLE", "POSITION", "CHORUS"],
	["HARMO", "CONTENT", "SCULPT", "CHORUS"], ["KARPLUS", "BOW", "POSITION", "DECAY"], ["V.ANALOG", "WAVE", "DETUNE", "SYNC"],
	["WAVESHAPER", "WAVE", "AMOUNT", "ASYMMETRY"], ["TWO OP FM", "RATIO", "AMOUNT", "FEEDBACK"], ["FORMANT", "INTERVAL", "FORMANT", "SHAPE"],
	["CHORDS", "TYPE", "INVERSION", "WAVE"], ["MODAL", "INHARMONIC", "TIMBRE", "DECAY"], ["NOISE", "TYPE", "FREQ", "RESONANCE"],
	["BASS", "SATURATION", "FOLD", "SUB"], ["SAWX", "DETUNE", "CHAOS", "NOISE MOD"]
];
const WT_NAMES = ["BASIC", "VOCAL", "BELL", "DIGITAL"];
const CHORDS = [["OCT", [0, 12, 24, 36]], ["5TH", [0, 7, 12, 19]], ["SUS4", [0, 5, 7, 12]], ["MINOR", [0, 3, 7, 12]], ["MIN7", [0, 3, 7, 10]],
	["MIN9", [0, 3, 10, 14]], ["MIN11", [0, 3, 10, 17]], ["6/9", [0, 4, 9, 14]], ["MAJ9", [0, 4, 11, 14]], ["MAJ7", [0, 4, 7, 11]], ["MAJOR", [0, 4, 7, 12]]];
const FTYPES = ["LPF", "BPF", "HPF"];
const CYC_MODES = ["ENV", "RUN", "LOOP"];
const LFO_SHAPES = ["SINE", "TRI", "SAW", "SQUARE", "S&H", "S&H GLIDE"];
const ARP_MODES = ["UP", "ORDER", "RAND", "PATTERN"];
const SOURCES = ["CYC ENV", "ENVELOPE", "LFO", "PRESSURE", "KEY/ARP"];
const DESTS = ["PITCH", "WAVE", "TIMBRE", "CUTOFF", "ASSIGN 1", "ASSIGN 2", "ASSIGN 3"];
// what an ASSIGN column can move: [settings key, name]
const ASSIGNABLE = [["shape", "SHAPE"], ["res", "RESONANCE"], ["lfo_rate", "LFO RATE"], ["cyc_rise", "CYC RISE"], ["cyc_fall", "CYC FALL"], ["cyc_hold", "CYC HOLD"],
	["cyc_amt", "CYC AMOUNT"], ["attack", "ATTACK"], ["decay", "DECAY"], ["sustain", "SUSTAIN"], ["famt", "FILTER AMT"], ["glide", "GLIDE"], ["volume", "VOLUME"], ["spice", "SPICE"]];
// LFO sync: slow to fast, in beats
const LFO_DIVS = [["4 BARS", 16], ["2 BARS", 8], ["1/1", 4], ["1/2", 2], ["1/4", 1], ["1/8", 0.5], ["1/8T", 1 / 3], ["1/16", 0.25], ["1/16T", 1 / 6], ["1/32", 0.125]];

// the knobs (0..1) and what they mean
const MAP = {
	cutoff: (n) => 30 * Math.pow(2, n * 9.3),          // 30 Hz .. 19 kHz
	envTime: (n) => 0.001 * Math.pow(10000, n),         // 1 ms .. 10 s
	cycTime: (n) => 0.002 * Math.pow(5000, n),          // 2 ms .. 10 s
	lfoHz: (n) => 0.05 * Math.pow(1000, n),             // 0.05 .. 50 Hz
	lfoDiv: (n) => Math.round(n * (LFO_DIVS.length - 1)),
	glide: (n) => n * n * 2,                            // 0 .. 2 s
	bpm: (n) => 30 + n * 210                            // 30 .. 240 BPM
};

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) { if (x < -3) return -1; if (x > 3) return 1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
function blep(t, dt) {
	if (t < dt) { t /= dt; return t + t - t * t - 1; }
	if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
	return 0;
}
// a sine table: sinp(x) = sin(2 pi x), x in cycles
const SN = 4096, SIN = new Float32Array(SN + 1);
for (let i = 0; i <= SN; i++) SIN[i] = Math.sin(TAU * i / SN);
function sinp(x) { x -= Math.floor(x); const f = x * SN, i = f | 0; return SIN[i] + (SIN[i + 1] - SIN[i]) * (f - i); }

// the wavetables: 4 tables of 8 frames, 2048 samples, two levels (32 and 8 harmonics), made once
const WT_LEN = 2048, WT_FRAMES = 8;
let WT = null;
function buildTables() {
	if (WT) return WT;
	let seed = 12345;
	const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
	const amps = [
		// BASIC: sine -> triangle -> saw -> square -> narrow pulse
		(f, k) => { const x = f / 7; const tri = k % 2 ? 1 / (k * k) * ((k - 1) / 2 % 2 ? -1 : 1) : 0, saw = 1 / k, sq = k % 2 ? 1 / k : 0, pul = 1 / Math.sqrt(k);
			const seg = x * 4, i = Math.min(3, seg | 0), u = seg - i, list = [k === 1 ? 1 : 0, tri, saw, sq, pul]; return list[i] * (1 - u) + list[i + 1] * u; },
		// VOCAL: a formant moving up through the harmonics
		(f, k) => { const c = 2 + f * 3.2; return Math.exp(-Math.pow((k - c) / (1.2 + f * 0.3), 2)) + 0.5 * Math.exp(-Math.pow((k - c * 2.6) / 2, 2)) + (k === 1 ? 0.4 : 0); },
		// BELL: sparse high partials growing
		(f, k) => ([1, 3, 5, 9, 13, 17, 23, 29].indexOf(k) >= 0 ? Math.pow(0.82 + f * 0.02, k) * (k === 1 ? 1 : 0.4 + f * 0.12) : 0),
		// DIGITAL: random spectra
		() => (rnd() < 0.45 ? rnd() : 0)
	];
	WT = [];
	for (let t = 0; t < 4; t++) {
		const frames = [];
		for (let f = 0; f < WT_FRAMES; f++) {
			const levels = [];
			const a = []; for (let k = 1; k <= 32; k++) a[k] = amps[t](f, k);
			for (const H of [32, 8]) {
				const buf = new Float32Array(WT_LEN + 1);
				let peak = 0;
				for (let i = 0; i < WT_LEN; i++) {
					let v = 0;
					for (let k = 1; k <= H; k++) if (a[k]) v += a[k] * SIN[(k * i * 2 + (t === 3 ? k * 651 : 0)) & (SN - 1)]; // exact: 2048 samples on the 4096 sine table
					buf[i] = v; peak = Math.max(peak, Math.abs(v));
				}
				for (let i = 0; i < WT_LEN; i++) buf[i] /= peak || 1;
				buf[WT_LEN] = buf[0];
				levels.push(buf);
			}
			frames.push(levels);
		}
		WT.push(frames);
	}
	return WT;
}
function wtRead(buf, ph) { const f = ph * WT_LEN, i = f | 0; return buf[i] + (buf[i + 1] - buf[i]) * (f - i); }

const MODAL_RATIOS = [[1, 2, 3, 4, 5, 6], [1, 2.76, 5.4, 8.93, 13.34, 18.64], [1, 1.59, 2.14, 2.3, 2.65, 2.92]];
// each engine's level, so that they all play about as loud
const GAIN = [0.7, 2.0, 1.1, 1.05, 3.0, 2.3, 0.85, 0.82, 1.15, 1.8, 1.8, 3.0, 1.25, 1.15];

class MiniMadDSP {
	constructor() {
		this.sr = sampleRate;
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.wt = buildTables();
		this.voices = [];
		for (let i = 0; i < NV; i++) this.voices.push(this.newVoice());
		this.order = 0;
		this.keys = [];          // keys held, in order: [{ note, vel }]
		this.bend = 0;
		this.ctrl = 0;
		// filter
		this.ic1 = 0; this.ic2 = 0; this.fa1 = 1; this.fa2 = 0; this.fa3 = 0; this.fk = 2; this.ftype = 0;
		// global envelopes and LFO
		this.fenv = 0; this.fstage = 0;
		this.cyc = 0; this.cstage = 0; this.ctime = 0;
		this.lfoPh = 0; this.lfo = 0; this.lfoSH = 0; this.lfoTarget = 0;
		this.last = this.voices[0];
		// arp / seq
		this.playing = false; this.stepLeft = 0; this.stepIdx = -1; this.arpIdx = -1; this.arpDir = 1;
		this.sounding = [];      // [{ note, left }] notes the arp / seq started, with samples to their end
		this.latched = [];
		this.dice = []; this.rollDice();
		this.pattern = []; this.patternFor = "";
		this.recChord = []; this.recEvents = [];
		this.lastClock = false; this.clockPulse = 0;
		this.sampleCount = 0; this.midiTicks = 0; this.lastMidiClock = -1e12;
		this.vol = 0.8;
	}
	newVoice() {
		return { note: 60, gate: false, vel: 1, press: 0, env: 0, stage: 0, age: 0, pitch: 0, target: 0, held: false, fresh: true,
			ph: new Float64Array(8), sub: 0, z: new Float64Array(16), c: new Float64Array(40), /* c: the engine's values, made at the control rate (prep) */ ks: new Float32Array(4096), ksPos: 0, ksLp: 0, excite: 0,
			w: 0, t: 0, sh: 0, freq: 261.6 };
	}

	rollDice() {
		this.dice = [];
		for (let i = 0; i < 64; i++) {
			const r = Math.random();
			this.dice.push({ oct: r < 0.15 ? 1 : (r < 0.25 ? -1 : 0), gate: 0.25 + Math.random() * 0.75, rest: Math.random() < 0.25, vel: 0.5 + Math.random() * 0.5, odds: Math.random() });
		}
		this.patternFor = "";
	}

	setSettings(s) {
		const was = this.s;
		this.s = s;
		if (was && was.para && !s.para) for (let i = 1; i < NV; i++) this.release(this.voices[i]);
		if (was && (was.arp_on !== s.arp_on || was.seq_on !== s.seq_on)) this.stopSounding();
		if (was && was.hold && !s.hold) { this.latched = []; if (!this.keys.length) this.stopSounding(); }
		if (was && was.rec && !s.rec) this.recChord = [];
	}
	setMidiConnected(c) { if (this.midiConnected && !c) this.allOff(); this.midiConnected = c; }

	message(m) {
		switch (m.type) {
			case "note": this.press = m.press || 0; m.on ? this.keyOn(m.note, m.vel === undefined ? 1 : m.vel) : this.keyOff(m.note); break; // press: from its own keyboard (MIDI has none: 0)
			case "press": this.press = clamp(m.value, 0, 1); for (const v of this.voices) if (v.note === m.note && v.gate) v.press = this.press; break; // the arp and the sequence take it too
			case "allNotesOff": this.allOff(); break;
			case "bend": this.bend = m.value; break;
			case "play": this.setPlay(m.value === undefined ? !this.playing : !!m.value); break;
			case "dice": this.rollDice(); break;
			case "trigger": if (m.gate) this.keyOn(60, 1); else this.keyOff(60); break;
			case "midiClock": this.midiTicks++; this.lastMidiClock = this.sampleCount; break;
			case "midiStart": this.midiTicks = 0; this.stepIdx = -1; this.lastMidiClock = this.sampleCount; this.setPlay(true); break;
			case "midiContinue": this.setPlay(true); break;
			case "midiStop": this.setPlay(false); break;
		}
	}
	allOff() { this.keys = []; this.latched = []; this.stopSounding(); for (const v of this.voices) this.release(v); }

	setPlay(on) {
		this.playing = on;
		if (on) { this.stepIdx = -1; this.stepLeft = 0; }
		else this.stopSounding();
	}

	// ---- keys: played, arpeggiated, or transposing the sequence ----
	keyOn(note, vel) {
		const s = this.s;
		if (!s) return;
		this.keys = this.keys.filter((k) => k.note !== note);
		if (s.hold && s.arp_on && !this.keys.length) this.latched = [];
		this.keys.push({ note, vel });
		if (s.hold && s.arp_on && this.latched.indexOf(note) < 0) this.latched.push(note);
		if (s.seq_on && s.rec) {
			if (this.playing) this.recEvents.push({ step: Math.max(0, this.stepIdx), note });
			else if (this.recChord.indexOf(note) < 0 && this.recChord.length < 4) this.recChord.push(note);
		}
		if (s.arp_on) { if (!this.sounding.length && this.keys.length === 1) this.stepLeft = 0; return; } // starts at once
		if (s.seq_on && this.playing) return; // the keys transpose the sequence
		this.noteOn(note, vel, true);
	}
	keyOff(note) {
		const s = this.s;
		const i = this.keys.findIndex((k) => k.note === note);
		if (i < 0) return;
		this.keys.splice(i, 1);
		if (s.seq_on && s.rec && !this.playing && !this.keys.length && this.recChord.length) {
			this.recEvents.push({ add: this.recChord.slice() });
			this.recChord = [];
		}
		if (s.arp_on) { if (!this.keys.length && !s.hold) this.stopSounding(); return; }
		if (s.seq_on && this.playing) return;
		this.noteOff(note);
	}

	// ---- voices ----
	noteOn(note, vel, fromKeys) {
		const s = this.s;
		let v;
		if (!s.para) {
			v = this.voices[0];
			const legato = v.gate && v.held;
			v.note = note; v.target = (note - 60) / 12; v.vel = vel; v.press = this.press || 0; v.gate = true; v.held = true;
			if (!legato || !fromKeys) this.trigger(v);
		}
		else {
			// a free voice (the quietest), else the oldest
			v = null;
			for (const u of this.voices) if (!u.gate && (!v || u.env < v.env)) v = u;
			if (!v) for (const u of this.voices) if (!v || u.age < v.age) v = u;
			v.note = note; v.target = (note - 60) / 12; v.vel = vel; v.press = this.press || 0; v.gate = true; v.held = true;
			this.trigger(v);
		}
		v.age = ++this.order;
		this.last = v;
		// the filter envelope and the cycling envelope start again
		this.fstage = 1;
		this.cstage = 1; this.ctime = 0; // in every mode (LOOP starts its cycle again)
	}
	trigger(v) {
		if (v.stage === 0 || v.fresh) { v.pitch = v.target; v.fresh = false; }
		if (v.stage === 0) { for (let k = 0; k < 8; k++) v.ph[k] = Math.random(); v.z.fill(0); }
		v.stage = 1;
		v.excite = 1;              // KARPLUS and MODAL: a pluck / a strike
		v.ksFill = true;
	}
	noteOff(note) {
		const s = this.s;
		if (!s.para) {
			// the last key still held takes over (legato), else release
			const v = this.voices[0];
			if (v.note !== note) return;
			const k = this.keys.length ? this.keys[this.keys.length - 1] : null;
			if (k && !s.arp_on && !(s.seq_on && this.playing)) { v.note = k.note; v.target = (k.note - 60) / 12; return; }
			this.release(v);
			return;
		}
		for (const v of this.voices) if (v.note === note && v.gate) this.release(v);
	}
	release(v) { if (v.gate) { v.gate = false; v.held = false; if (v.stage) v.stage = 3; } }
	stopSounding() { for (const x of this.sounding) this.noteOff(x.note); this.sounding = []; }

	// ---- the clock: steps of a 16th ----
	tempo() {
		const s = this.s;
		if (this.sampleCount - this.lastMidiClock < 0.5 * this.sr) return 0; // MIDI clock steps it
		return s.sync && this.host && this.host.tempo > 0 ? this.host.tempo : MAP.bpm(s.rate);
	}
	stepLen(idx) {
		const s = this.s, base = 60 * this.sr / (Math.max(20, this.tempo() || 120) * 4), sw = clamp(s.swing, 0, 1) * 0.5;
		return Math.max(1, Math.round(base * (idx % 2 ? 1 - sw : 1 + sw)));
	}
	arpNotes() {
		const s = this.s;
		const src = s.hold ? this.latched.slice() : this.keys.map((k) => k.note);
		return src;
	}
	advance() {
		const s = this.s;
		const spice = clamp(s.spice + (this.assign ? this.assign.spice || 0 : 0), 0, 1);
		this.stepIdx++;
		this.clockPulse = Math.round(0.005 * this.sr);
		const d = this.dice[this.stepIdx % 64], spiced = d.odds < spice;
		const len = this.stepLen(this.stepIdx);
		let notes = [];
		if (s.seq_on && this.playing) {
			const n = s.seq_len | 0;
			if (n <= 0) return;
			const st = s.seq[this.stepIdx % n] || [];
			let tr = 0;
			if (this.keys.length) { const first = s.seq.find((x) => x && x.length); if (first) tr = this.keys[this.keys.length - 1].note - first[0]; } // the keys transpose it from its first note
			notes = st.map((x) => x + tr);
			this.seqStep = this.stepIdx % n;
		}
		else if (s.arp_on) {
			let list = this.arpNotes();
			if (!list.length) return;
			const mode = s.arp_mode | 0;
			const sorted = list.slice().sort((a, b) => a - b);
			if (mode === 0) { this.arpIdx = (this.arpIdx + 1) % sorted.length; notes = [sorted[this.arpIdx]]; }
			else if (mode === 1) { this.arpIdx = (this.arpIdx + 1) % list.length; notes = [list[this.arpIdx]]; }
			else if (mode === 2) notes = [list[Math.floor(Math.random() * list.length)]];
			else {
				// PATTERN: a rhythm and an order of the notes, made again when the notes change
				const key = sorted.join(",");
				if (key !== this.patternFor) {
					this.patternFor = key; this.pattern = [];
					for (let i = 0; i < 16; i++) this.pattern.push(i === 0 || Math.random() < 0.7 ? sorted[Math.floor(Math.random() * sorted.length)] + (Math.random() < 0.2 ? 12 : 0) : -1);
				}
				const p = this.pattern[this.stepIdx % 16];
				if (p >= 0) notes = [p];
			}
		}
		else return;
		// SPICE: this step's dice (an octave, a shorter or longer gate, a rest)
		let gate = 0.5, vel = 0.9;
		if (spiced) { if (d.rest) notes = []; notes = notes.map((x) => x + d.oct * 12); gate = d.gate; vel = d.vel; }
		for (const x of this.sounding) this.noteOff(x.note);
		this.sounding = [];
		for (const x of notes) {
			if (x < 0 || x > 127) continue;
			this.noteOn(x, vel, false);
			this.sounding.push({ note: x, left: Math.max(1, Math.round(len * gate)) });
		}
	}

	// ---- control rate: the matrix, the envelopes' rates, the filter ----
	control() {
		const s = this.s, sr = this.sr, n = CTRL;
		const mx = s.matrix || [];
		// global sources
		const lfoRate = clamp(s.lfo_rate + this.asg("lfo_rate"), 0, 1);
		let hz;
		if (s.lfo_sync) { const t = this.tempo() || 120; hz = t / 60 / LFO_DIVS[MAP.lfoDiv(lfoRate)][1]; }
		else hz = MAP.lfoHz(lfoRate);
		const was = this.lfoPh;
		this.lfoPh += hz * n / sr;
		const wrapped = this.lfoPh >= 1;
		this.lfoPh -= Math.floor(this.lfoPh);
		const p = this.lfoPh, shp = s.lfo_shape | 0;
		if (wrapped || was === 0) this.lfoTarget = Math.random() * 2 - 1;
		switch (shp) {
			case 0: this.lfo = sinp(p); break;
			case 1: this.lfo = p < 0.5 ? p * 4 - 1 : 3 - p * 4; break;
			case 2: this.lfo = 1 - p * 2; break;
			case 3: this.lfo = p < 0.5 ? 1 : -1; break;
			case 4: this.lfo = this.lfoTarget; break;
			default: this.lfo += (this.lfoTarget - this.lfo) * Math.min(1, hz * n / sr * 6);
		}
		// the cycling envelope
		const rise = MAP.cycTime(clamp(s.cyc_rise + this.asg("cyc_rise"), 0, 1)), fall = MAP.cycTime(clamp(s.cyc_fall + this.asg("cyc_fall"), 0, 1));
		const hold = clamp(s.cyc_hold + this.asg("cyc_hold"), 0, 1), mode = s.cyc_mode | 0, gate = this.voices.some((v) => v.gate);
		const dt = n / sr;
		if (mode === 2 && this.cstage === 0) this.cstage = 1;
		if (this.cstage === 1) { this.cyc += dt / rise; if (this.cyc >= 1) { this.cyc = 1; this.cstage = 2; this.ctime = 0; } }
		else if (this.cstage === 2) {
			if (mode === 0) { this.cyc += (hold - this.cyc) * Math.min(1, dt / Math.max(0.002, fall) * 3); if (!gate) this.cstage = 3; }
			else { this.ctime += dt; if (this.ctime >= hold * hold * 4) this.cstage = 3; } // RUN, LOOP: HOLD is a time at the top (0 .. 4 s)
		}
		else if (this.cstage === 3) { this.cyc -= dt / fall; if (this.cyc <= 0) { this.cyc = 0; this.cstage = mode === 2 ? 1 : 0; } }
		const cycOut = this.cyc * clamp(s.cyc_amt + this.asg("cyc_amt"), 0, 1);
		this.cycOut = cycOut;
		// envelopes: rates
		const A = MAP.envTime(clamp(s.attack + this.asg("attack"), 0, 1)), D = MAP.envTime(clamp(s.decay + this.asg("decay"), 0, 1)) * 0.8;
		const Sus = clamp(s.sustain + this.asg("sustain"), 0, 1);
		this.envA = 1 / (A * sr); this.envD = 1 - Math.exp(-1 / (D * sr * 0.3)); this.envS = Sus; // per sample, for the voices
		const fA = n / (A * sr), fD = 1 - Math.exp(-n / (D * sr * 0.3));
		// the filter envelope (gated by any voice)
		if (this.fstage === 1) { this.fenv += fA; if (this.fenv >= 1) { this.fenv = 1; this.fstage = 2; } }
		else if (this.fstage === 2) { this.fenv += (Sus - this.fenv) * fD; if (!gate) this.fstage = 3; }
		else if (this.fstage === 3) { this.fenv += (0 - this.fenv) * fD; if (this.fenv < 1e-4) { this.fenv = 0; this.fstage = 0; } }
		// glide
		const g = MAP.glide(clamp(s.glide + this.asg("glide"), 0, 1));
		this.glideK = g > 0.001 ? 1 - Math.exp(-n / (g * sr * 0.35)) : 1;
		// per voice: the matrix into PITCH, WAVE, TIMBRE (and SHAPE when an ASSIGN column has it)
		for (const v of this.voices) {
			v.pitch += (v.target - v.pitch) * this.glideK;
			const src = [cycOut, v.env, this.lfo, v.press, (v.note - 60) / 24];
			let dp = 0, dw = 0, dtm = 0, dsh = 0;
			for (let r = 0; r < 5; r++) {
				const row = mx[r]; if (!row) continue;
				dp += src[r] * (row[0] || 0); dw += src[r] * (row[1] || 0); dtm += src[r] * (row[2] || 0);
				for (let c = 0; c < 3; c++) if ((s.assign || [])[c] === "shape") dsh += src[r] * (row[4 + c] || 0);
			}
			v.freq = 261.6255653 * Math.pow(2, v.pitch + this.bend + dp * 2);
			v.w = clamp(s.wave + dw, 0, 1); v.t = clamp(s.timbre + dtm, 0, 1); v.sh = clamp(s.shape + dsh, 0, 1);
			if (v.stage) this.prep(v, clamp(s.type | 0, 0, ENGINES.length - 1));
		}
		// the filter: CUTOFF, its envelope (FILTER AMT, from the middle), the matrix (the last voice's sources)
		const lv = this.last, srcL = [cycOut, this.fenv, this.lfo, lv.press, (lv.note - 60) / 24];
		let dc = 0;
		for (let r = 0; r < 5; r++) { const row = mx[r]; if (row) dc += srcL[r] * (row[3] || 0); }
		const famt = clamp(s.famt + this.asg("famt"), 0, 1) * 2 - 1;
		const cut = clamp(s.cutoff + dc + famt * this.fenv * 0.75, 0, 1);
		const fc = Math.min(MAP.cutoff(cut), sr * 0.45), res = clamp(s.res + this.asg("res"), 0, 1);
		const gg = Math.tan(Math.PI * fc / sr);
		this.fk = 2 - 1.97 * res;
		this.fa1 = 1 / (1 + gg * (gg + this.fk)); this.fa2 = gg * this.fa1; this.fa3 = gg * this.fa2;
		this.ftype = s.ftype | 0;
		this.vol = clamp(s.volume + this.asg("volume"), 0, 1);
		this.resGain = 1 - res * 0.35;
	}
	// the engine's values that change slowly, for voice v: at the control rate, not every sample
	prep(v, type) {
		const c = v.c, f = v.freq, sr = this.sr, w = v.w, t = v.t, sh = v.sh;
		if (type === 3) { // HARMO: the partials' levels (CONTENT: the slope, SCULPT: odd / even), their CHORUS drift
			const slope = 3 - w * 2.6;
			let nk = 0, norm = 0;
			for (let k = 1; k <= 12; k++) {
				if (k * f > sr * 0.45) break;
				let a = Math.pow(k, -slope);
				if (k > 1) a *= k % 2 ? (t > 0.5 ? 1 - (t - 0.5) * 1.8 : 1) : (t < 0.5 ? t * 2 : 1);
				c[k] = a; c[20 + k] = sh * 0.004 * ((k * 7) % 5 - 2) * f / sr * k; norm += Math.abs(a); nk = k;
			}
			for (let k = 1; k <= nk; k++) c[k] /= Math.max(0.3, norm);
			c[0] = nk;
		}
		else if (type === 9) { // CHORDS: the four notes' ratios
			const ch = CHORDS[Math.min(CHORDS.length - 1, (w * CHORDS.length) | 0)][1], inv = Math.min(3, (t * 4) | 0);
			for (let k = 0; k < 4; k++) c[k] = Math.pow(2, (ch[k] + (k < inv ? 12 : 0)) / 12);
		}
		else if (type === 10) { // MODAL: the resonators' coefficients, gains and levels
			const set = w * 2, si = Math.min(1, set | 0), u = set - si, A = MODAL_RATIOS[si], B = MODAL_RATIOS[si + 1];
			const t60 = 0.05 * Math.pow(100, sh), rr = Math.exp(-6.9 / (t60 * sr));
			c[0] = rr * rr;
			for (let k = 0; k < 6; k++) {
				const fk = f * (A[k] + (B[k] - A[k]) * u);
				if (fk > sr * 0.45) { c[1 + k] = 0; continue; }
				c[1 + k] = 2 * rr * Math.cos(TAU * fk / sr);
				c[7 + k] = Math.pow(0.25 + t * 0.7, k);
				c[13 + k] = Math.sin(TAU * fk / sr) * 2; // about 1 for each resonator
			}
		}
	}

	// the ASSIGN columns: how much the matrix moves a knob (computed once a control block)
	asg(key) { return this.assign ? this.assign[key] || 0 : 0; }
	assignments() {
		const s = this.s, mx = s.matrix || [], lv = this.last, a = {};
		const src = [this.cycOut || 0, this.fenv, this.lfo, lv.press, (lv.note - 60) / 24];
		for (let c = 0; c < 3; c++) {
			const key = (s.assign || [])[c];
			if (!key || key === "shape") continue;
			let d = 0;
			for (let r = 0; r < 5; r++) { const row = mx[r]; if (row) d += src[r] * (row[4 + c] || 0); }
			a[key] = (a[key] || 0) + d;
		}
		this.assign = a;
	}

	// ---- the engines: one sample of voice v ----
	osc(v, type) {
		const sr = this.sr, f = v.freq, dt = Math.min(0.45, f / sr), w = v.w, t = v.t, sh = v.sh, ph = v.ph, z = v.z;
		let out = 0;
		switch (type) {
			case 0: { // BASIC WAVES: saw -> square -> triangle, SYMMETRY, a SUB octave
				let p = ph[0] + dt; if (p >= 1) p -= 1; ph[0] = p;
				const pw = 0.5 + (t - 0.5) * 0.9;
				const saw = 2 * p - 1 - blep(p, dt);
				let p2 = p - pw; if (p2 < 0) p2 += 1;
				const sq = (p < pw ? 1 : -1) + blep(p, dt) - blep(p2, dt);
				const tri = p < pw ? -1 + 2 * p / pw : 1 - 2 * (p - pw) / (1 - pw);
				const o = w < 0.5 ? saw + (sq - saw) * w * 2 : sq + (tri - sq) * (w - 0.5) * 2;
				let q = ph[1] + dt * 0.5; if (q >= 1) q -= 1; ph[1] = q;
				const sub = (q < 0.5 ? 1 : -1) + blep(q, dt * 0.5) - blep(q < 0.5 ? q + 0.5 : q - 0.5, dt * 0.5);
				out = o * (1 - sh * 0.4) + sub * sh * 0.7;
				break;
			}
			case 1: { // SUPERWAVE: seven of one wave, DETUNE, the side ones' VOLUME
				const det = t * t * 0.08;
				for (let k = 0; k < 7; k++) {
					const r = 1 + det * (k - 3) / 3 * (k % 2 ? 1 : 0.83);
					const d = dt * r;
					let p = ph[k] + d; if (p >= 1) p -= 1; ph[k] = p;
					const saw = 2 * p - 1 - blep(p, d);
					let p2 = p + 0.5; if (p2 >= 1) p2 -= 1;
					const sq = (p < 0.5 ? 1 : -1) + blep(p, d) - blep(p2, d);
					const tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
					const seg = w * 3, u = seg - Math.min(2, seg | 0);
					const o = seg < 1 ? saw + (sq - saw) * u : (seg < 2 ? sq + (tri - sq) * u : tri + (sinp(p) - tri) * u);
					out += k === 3 ? o : o * sh;
				}
				out *= 1.4 / (1 + 6 * sh);
				break;
			}
			case 2: { // WAVETABLE: TABLE, POSITION in it, CHORUS (a detuned copy)
				const tab = this.wt[Math.min(3, (w * 4) | 0)], lvl = f > 700 ? 1 : 0;
				const pos = t * (WT_FRAMES - 1), fi = Math.min(WT_FRAMES - 2, pos | 0), u = pos - fi;
				let p = ph[0] + dt; if (p >= 1) p -= 1; ph[0] = p;
				let a = wtRead(tab[fi][lvl], p), b = wtRead(tab[fi + 1][lvl], p);
				out = a + (b - a) * u;
				if (sh > 0.01) {
					let q = ph[1] + dt * (1 + sh * 0.012); if (q >= 1) q -= 1; ph[1] = q;
					a = wtRead(tab[fi][lvl], q); b = wtRead(tab[fi + 1][lvl], q);
					out = (out + (a + (b - a) * u) * sh) / (1 + sh * 0.6);
				}
				break;
			}
			case 3: { // HARMO: 12 partials, CONTENT (the slope), SCULPT (odd / even), CHORUS
				let p = ph[0] + dt; if (p >= 1) p -= 1; ph[0] = p;
				const c = v.c, nk = c[0];
				let sum = 0;
				for (let k = 1; k <= nk; k++) { sum += c[k] * sinp(p * k + z[k]); z[k] += c[20 + k]; }
				out = sum * 1.3;
				break;
			}
			case 4: { // KARPLUS: a string, BOW (a constant noise into it), POSITION (brightness), DECAY
				const L = clamp(sr / f, 2, 4000), buf = v.ks;
				if (v.ksFill) { // a pluck: a burst of noise, darker with POSITION low
					let lp = 0;
					for (let i = 0; i < 4096; i++) { const nz = Math.random() * 2 - 1; lp += (nz - lp) * (0.2 + t * 0.8); buf[i] = lp * (1 - w * 0.7); }
					v.ksFill = false;
				}
				let rp = v.ksPos - L; if (rp < 0) rp += 4096;
				const i0 = rp | 0, fr = rp - i0, y = buf[i0 & 4095] + (buf[(i0 + 1) & 4095] - buf[i0 & 4095]) * fr;
				v.ksLp += (y - v.ksLp) * (0.25 + t * 0.7);
				const fb = 0.97 + sh * 0.0299;
				const bow = v.gate ? w * (Math.random() * 2 - 1) * 0.06 : 0;
				buf[v.ksPos] = clamp(v.ksLp * fb + bow, -1.5, 1.5);
				v.ksPos = (v.ksPos + 1) & 4095;
				out = y * 1.4;
				break;
			}
			case 5: { // V.ANALOG: two oscillators, WAVE, DETUNE, SYNC (the second synced to the first)
				let p = ph[0] + dt, wrap = false; if (p >= 1) { p -= 1; wrap = true; } ph[0] = p;
				const r = (1 + t * 0.02) * (1 + sh * 3), d2 = Math.min(0.45, dt * r);
				let q = ph[1] + d2; if (q >= 1) q -= 1; if (wrap && sh > 0.01) q = p * r - Math.floor(p * r); ph[1] = q;
				const one = (x, d) => { const saw = 2 * x - 1 - blep(x, d); let x2 = x + 0.5; if (x2 >= 1) x2 -= 1; const sq = (x < 0.5 ? 1 : -1) + blep(x, d) - blep(x2, d); return saw + (sq - saw) * w; };
				out = (one(p, dt) + one(q, d2)) * 0.6;
				break;
			}
			case 6: { // WAVESHAPER: sine -> triangle -> saw, folded (AMOUNT), with an offset (ASYMMETRY)
				let p = ph[0] + dt; if (p >= 1) p -= 1; ph[0] = p;
				const sn = sinp(p), tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p, saw = 2 * p - 1;
				const x = w < 0.5 ? sn + (tri - sn) * w * 2 : tri + (saw - tri) * (w - 0.5) * 2;
				const y = x * (1 + t * 7) + (sh - 0.5) * 2;
				out = sinp(y * 0.25);
				break;
			}
			case 7: { // TWO OP FM: RATIO of the modulator, AMOUNT (index), FEEDBACK
				const ratio = 0.25 + Math.round(w * 31) * 0.25;
				let pm = ph[1] + dt * ratio; if (pm >= 1) pm -= 1; ph[1] = pm;
				const m = sinp(pm + z[0] * sh * 0.25); z[0] = m;
				let p = ph[0] + dt; if (p >= 1) p -= 1; ph[0] = p;
				out = sinp(p + m * t * t * 2);
				break;
			}
			case 8: { // FORMANT: two formants in each period of the note: INTERVAL (the second's), FORMANT, SHAPE (window)
				let p = ph[0] + dt; if (p >= 1) p -= 1; ph[0] = p;
				const r1 = 1 + t * 14, r2 = r1 * (1.4 + w * 2.6);
				const win = Math.pow(0.5 - 0.5 * sinp(p + 0.25), 1 + sh * 5);
				out = win * (sinp(p * r1) + 0.6 * sinp(p * r2)) * 1.4;
				break;
			}
			case 9: { // CHORDS: four notes, TYPE, INVERSION (lowest notes up an octave), WAVE (saw -> square)
				for (let k = 0; k < 4; k++) {
					const d = Math.min(0.45, dt * v.c[k]);
					let p = ph[k] + d; if (p >= 1) p -= 1; ph[k] = p;
					const saw = 2 * p - 1 - blep(p, d);
					let p2 = p + 0.5; if (p2 >= 1) p2 -= 1;
					const sq = (p < 0.5 ? 1 : -1) + blep(p, d) - blep(p2, d);
					out += saw + (sq - saw) * sh;
				}
				out *= 0.42;
				break;
			}
			case 10: { // MODAL: six resonators struck by the note: INHARMONIC (from harmonic to bell to plate), TIMBRE, DECAY
				const c = v.c, rr2 = c[0];
				const ex = v.excite; v.excite = 0;
				const bowed = v.gate && t > 0.85 ? (Math.random() * 2 - 1) * (t - 0.85) * 0.05 : 0;
				for (let k = 0; k < 6; k++) {
					if (!c[1 + k]) continue; // above the Nyquist frequency
					const y = c[1 + k] * z[2 * k] - rr2 * z[2 * k + 1] + (ex + bowed) * c[7 + k];
					z[2 * k + 1] = z[2 * k]; z[2 * k] = y;
					out += y * c[13 + k];
				}
				out *= 0.5;
				break;
			}
			case 11: { // NOISE: white -> crackle (TYPE), a band pass at FREQ around the note, RESONANCE
				const nz = Math.random() * 2 - 1;
				const x = w < 0.5 ? nz : (Math.random() < 0.02 + (1 - w) * 0.2 ? nz * 3 : 0) * (w - 0.5) * 2 + nz * (1 - (w - 0.5) * 2);
				const fc = Math.min(sr * 0.45, f * Math.pow(2, (t - 0.5) * 6));
				const g = Math.tan(Math.PI * fc / sr), k = 2 - sh * 1.95;
				const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
				const v3 = x - z[1], v1 = a1 * z[0] + a2 * v3, v2 = z[1] + a2 * z[0] + a3 * v3;
				z[0] = 2 * v1 - z[0]; z[1] = 2 * v2 - z[1];
				out = v1 * k * 1.6; // the band, its peak at 1 whatever the RESONANCE
				break;
			}
			case 12: { // BASS: a saw and a square, SATURATION, FOLD, a SUB sine
				let p = ph[0] + dt; if (p >= 1) p -= 1; ph[0] = p;
				const saw = 2 * p - 1 - blep(p, dt);
				let x = fastTanh(saw * (1 + w * 8)) ;
				x = sinp(x * (0.25 + t * 1.5) * 0.5) ;
				let q = ph[1] + dt * 0.5; if (q >= 1) q -= 1; ph[1] = q;
				out = x * (1 - sh * 0.3) + sinp(q) * sh * 0.9;
				break;
			}
			default: { // SAWX: two saws, DETUNE, CHAOS (one bends the other's phase), NOISE MOD
				const d2 = dt * (1 + w * 0.03);
				let q = ph[1] + d2; if (q >= 1) q -= 1; ph[1] = q;
				const s2 = 2 * q - 1;
				let p = ph[0] + dt * (1 + (Math.random() * 2 - 1) * sh * 0.3); if (p >= 1) p -= 1; ph[0] = p;
				let pp = p + s2 * t * 0.35; pp -= Math.floor(pp);
				out = (2 * pp - 1) * 0.7 + (s2 - blep(q, d2)) * 0.5;
				break;
			}
		}
		return out;
	}

	beginBlock() {}
	tick() {
		const s = this.s, outs = this.outs;
		this.sampleCount++;
		if (!s) { outs[O_L] = outs[O_R] = 0; return; }
		// the clock: CLOCK IN (a step a pulse), MIDI clock (6 ticks a step), or the tempo
		const clk = this.patched[0] && this.ins[0] > 1, edge = clk && !this.lastClock;
		this.lastClock = clk;
		const midi = this.sampleCount - this.lastMidiClock < 0.5 * this.sr;
		const active = (s.arp_on && (this.keys.length || (s.hold && this.latched.length))) || (s.seq_on && this.playing);
		if (active) {
			if (this.patched[0]) { if (edge) this.advance(); }
			else if (midi) { if (this.midiTicks >= 6) { this.midiTicks -= 6; this.advance(); } }
			else if (--this.stepLeft <= 0) { this.advance(); this.stepLeft = this.stepLen(this.stepIdx); }
		}
		else if (this.stepIdx >= 0 && !s.seq_on) { this.stepIdx = -1; this.arpIdx = -1; }
		for (let i = this.sounding.length - 1; i >= 0; i--) {
			const x = this.sounding[i];
			if (--x.left <= 0) { this.noteOff(x.note); this.sounding.splice(i, 1); }
		}
		if (this.clockPulse > 0) this.clockPulse--;
		if (--this.ctrl <= 0) { this.ctrl = CTRL; this.assignments(); this.control(); }
		// the voices
		const type = clamp(s.type | 0, 0, ENGINES.length - 1);
		let sum = 0, anyGate = false;
		for (const v of this.voices) {
			if (v.stage === 0) continue;
			if (v.stage === 1) { v.env += this.envA; if (v.env >= 1) { v.env = 1; v.stage = 2; } }
			else if (v.stage === 2) v.env += (this.envS - v.env) * this.envD;
			else { v.env -= v.env * this.envD; if (v.env < 1e-4) { v.env = 0; v.stage = 0; continue; } }
			if (v.gate) anyGate = true;
			const amp = v.env * (0.6 + 0.4 * v.vel);
			sum += this.osc(v, type) * amp * GAIN[type];
		}
		// the filter (a little drive into it)
		const x = fastTanh(sum * 0.55) * 1.4;
		const v3 = x - this.ic2, v1 = this.fa1 * this.ic1 + this.fa2 * v3, v2 = this.ic2 + this.fa2 * this.ic1 + this.fa3 * v3;
		this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
		if (!(Math.abs(this.ic1) < 50)) { this.ic1 = 0; this.ic2 = 0; } // never lost to a blow up
		const y = this.ftype === 0 ? v2 : (this.ftype === 1 ? v1 : x - this.fk * v1 - v2);
		const o = fastTanh(y * this.resGain * this.vol * 0.9);
		outs[O_L] = o; outs[O_R] = o;
		// CV: the last note, any gate, its pressure, the clock
		outs[O_PITCH] = (this.last.note - 60) / 12;
		outs[O_GATE] = anyGate ? 5 : 0;
		outs[O_PRESS] = this.last.press * 5;
		outs[O_CLK] = this.clockPulse > 0 ? 5 : 0;
	}
	endBlock() {}

	state() {
		const st = { voices: this.voices.map((v) => v.stage ? [v.note, Math.round(v.env * 100) / 100, v.gate ? 1 : 0] : null),
			cyc: Math.round((this.cycOut || 0) * 100) / 100, lfo: Math.round(this.lfo * 100) / 100, env: Math.round(this.fenv * 100) / 100,
			playing: this.playing, step: this.s && this.s.seq_on ? (this.seqStep === undefined ? -1 : this.seqStep) : this.stepIdx, clk: this.clockPulse > 0,
			tempo: Math.round(this.tempo() || 0), rec: this.recEvents.length ? this.recEvents : undefined, chord: this.recChord.slice() };
		this.recEvents = [];
		return st;
	}
}
MiniMadDSP.IN_IDS = IN_IDS;
MiniMadDSP.OUT_IDS = OUT_IDS;
MiniMadDSP.MIDI_IN = "midi_in";
MiniMadDSP.POLY = true;
MiniMadDSP.TABLES = { ENGINES, WT_NAMES, CHORDS, FTYPES, CYC_MODES, LFO_SHAPES, ARP_MODES, SOURCES, DESTS, ASSIGNABLE, LFO_DIVS, MAP };

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.minimad = MiniMadDSP;

})();
