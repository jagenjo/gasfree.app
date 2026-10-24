// devices/midifx-worklet.js
// MIDI FX DSP, hosted by the rack processor: effects on MIDI notes. The notes come in
// through its MIDI IN (the keys, the song, a GRID 32, on its channel) and leave through its MIDI OUT,
// to the devices cabled from it (rack-worklet.js: midiFrom). In this order:
//   TIMING (note-ons moved to the next step of the grid, the note keeps its length) -> CHANCE (a note
//   plays or not) -> TRANSPOSE (+ the TRANSPOSE CV, 1 V/oct) -> HARMONY (a chord on each note: fixed
//   intervals, or steps of the scale) -> SCALE (every note moved into the scale) -> ARP (the notes held
//   played one at a time; LATCH keeps them) -> ECHO (each note repeated, quieter, maybe higher or
//   lower) -> VELOCITY (scaled, randomized).
// The steps follow the rack's tempo, or CLOCK IN (a step a pulse) when it is patched. The last note
// out is also on the front: PITCH (1 V/oct), GATE, VELOCITY (0..5 V).
// Loaded on the main thread too, for the tables (WR_DSP.midifx.TABLES).

(function(){

const IN_IDS = ["clock_in", "trans_in"];
const OUT_IDS = ["pitch_out", "gate_out", "vel_out"];
const I_CLOCK = 0, I_TRANS = 1, O_PITCH = 0, O_GATE = 1, O_VEL = 2;

// note values, in beats
const DIVS = [["1/2", 2], ["1/4", 1], ["1/8", 0.5], ["1/8T", 1 / 3], ["1/16", 0.25], ["1/16T", 1 / 6], ["1/32", 0.125]];
const SCALES = [["MAJOR", [0, 2, 4, 5, 7, 9, 11]], ["MINOR", [0, 2, 3, 5, 7, 8, 10]], ["DORIAN", [0, 2, 3, 5, 7, 9, 10]],
	["PHRYGIAN", [0, 1, 3, 5, 7, 8, 10]], ["LYDIAN", [0, 2, 4, 6, 7, 9, 11]], ["MIXOLYDIAN", [0, 2, 4, 5, 7, 9, 10]],
	["HARM MINOR", [0, 2, 3, 5, 7, 8, 11]], ["MAJ PENTA", [0, 2, 4, 7, 9]], ["MIN PENTA", [0, 3, 5, 7, 10]],
	["BLUES", [0, 3, 5, 6, 7, 10]], ["WHOLE TONE", [0, 2, 4, 6, 8, 10]], ["CHROMATIC", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]];
// [name, semitones] or [name, null, scale steps]: the scale's own chords (the SCALE's, or MAJOR when it is off)
const CHORDS = [["OFF", []], ["OCTAVE", [12]], ["OCT DOWN", [-12]], ["FIFTH", [7]], ["POWER", [7, 12]], ["MAJOR", [4, 7]], ["MINOR", [3, 7]],
	["SUS2", [2, 7]], ["SUS4", [5, 7]], ["MAJ7", [4, 7, 11]], ["MIN7", [3, 7, 10]], ["DOM7", [4, 7, 10]], ["ADD9", [4, 7, 14]],
	["3RD IN SCALE", null, [2]], ["TRIAD IN SCALE", null, [2, 4]], ["7TH IN SCALE", null, [2, 4, 6]], ["6TH BELOW", null, [-2]]];
const ARP_MODES = ["UP", "DOWN", "UP DOWN", "RANDOM", "AS PLAYED", "CHORD"];
const NOTE_N = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// a note moved to the nearest note of the scale (a tie goes down)
function inScale(n, root, sc) {
	const pc = ((n - root) % 12 + 12) % 12;
	let best = 0, bd = 99;
	for (const d of sc) for (const o of [-12, 0, 12]) { const dist = Math.abs(d + o - pc); if (dist < bd || (dist === bd && d + o < best)) { bd = dist; best = d + o; } }
	return n - pc + best;
}
// a note moved by `steps` steps of the scale (the note first put into it)
function scaleStep(n, steps, root, sc) {
	n = inScale(n, root, sc);
	const pc = ((n - root) % 12 + 12) % 12, base = n - pc;
	let i = sc.indexOf(pc); if (i < 0) i = 0;
	const k = i + steps, oct = Math.floor(k / sc.length);
	return base + oct * 12 + sc[((k % sc.length) + sc.length) % sc.length];
}

class MidiFxDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.t = 0;              // samples since the start
		this.events = [];        // [{ at, fn }] sorted by time
		this.qdelay = {};        // input note -> how much TIMING moved its note-on
		this.held = {};          // input note -> { outs, vel } after CHANCE / PITCH, or { drop: true }
		this.down = 0;           // input notes held
		this.pool = [];          // the arpeggiator's notes: [{ note, vel, order }]
		this.order = 0;
		this.arpIdx = -1; this.arpDir = 1; this.arpOn = []; this.arpNext = 0; this.arpWasOn = false;
		this.bypass = {};        // input note -> played while OFF (it goes out as it is)
		this.count = new Int32Array(128);   // how many times each note is on at the output
		this.stack = [];         // notes on at the output, for PITCH / GATE
		this.lastClock = false; this.clockAt = -1; this.clockPeriod = 0;
		this.actIn = 0; this.actOut = 0;
	}

	setSettings(s) {
		const was = this.s;
		this.s = s;
		if (was && was.arp_on && !s.arp_on) { this.arpRelease(); this.pool = []; }
		if (was && was.arp_latch && !s.arp_latch) this.prune();
	}
	setMidiConnected(c) { if (this.midiConnected && !c) this.panic(); this.midiConnected = c; }

	message(m) {
		switch (m.type) {
			case "note": if (!this.sending) this.input(m.note, m.on, m.vel === undefined ? 1 : m.vel); break;
			case "bend": case "modwheel": case "pressure": case "polypressure": case "sustain": if (!this.sending && this.host && this.host.midiFrom) this.host.midiFrom(this, m); break;
			case "allNotesOff": this.panic(); break;
		}
	}

	tempo() { return this.host && this.host.tempo > 0 ? this.host.tempo : 120; }
	// one step of a division, in samples: the clock's period when CLOCK IN is patched
	stepLen(div) {
		if (this.patched[I_CLOCK] && this.clockPeriod > 0) return this.clockPeriod;
		return Math.max(1, Math.round(60 / this.tempo() * DIVS[clamp(div | 0, 0, DIVS.length - 1)][1] * sampleRate));
	}
	at(time, fn) {
		const e = this.events;
		let i = e.length;
		while (i > 0 && e[i - 1].at > time) i--;
		e.splice(i, 0, { at: time, fn });
	}

	// ---- in: TIMING, then the rest ----
	input(note, on, vel) {
		const s = this.s;
		if (!s) return;
		this.actIn = 1;
		if (on) {
			if (this.bypass[note]) { this.out(note, 0, false); delete this.bypass[note]; }
			if (!s.on) { this.bypass[note] = true; this.out(note, vel, true); return; }
			let d = 0;
			if (s.tq_on) {
				const L = this.stepLen(s.tq_div), ref = this.patched[I_CLOCK] && this.clockAt >= 0 ? this.clockAt : 0;
				const k = Math.ceil((this.t - ref) / L);
				d = ref + k * L - this.t;
				if (d > L - 64) d = 0; // played just after the step: it stays there
			}
			this.qdelay[note] = d;
			if (d > 0) this.at(this.t + d, () => this.noteOn(note, vel)); else this.noteOn(note, vel);
		}
		else {
			if (this.bypass[note]) { delete this.bypass[note]; this.out(note, 0, false); return; }
			const d = this.qdelay[note] || 0;
			delete this.qdelay[note];
			if (d > 0) this.at(this.t + d, () => this.noteOff(note)); else this.noteOff(note);
		}
	}

	// CHANCE, TRANSPOSE, HARMONY, SCALE: the notes a note-on becomes
	noteOn(note, vel) {
		const s = this.s;
		if (this.held[note]) this.noteOff(note);
		if (s.chance < 1 && Math.random() >= s.chance) { this.held[note] = { drop: true }; return; }
		const sc = SCALES[clamp(s.scale | 0, 0, SCALES.length - 1)][1], root = s.root | 0;
		let n = note + (s.transpose | 0) + (this.patched[I_TRANS] ? Math.round(this.ins[I_TRANS] * 12) : 0);
		const ch = CHORDS[clamp(s.harm | 0, 0, CHORDS.length - 1)];
		const hs = s.sc_on ? sc : SCALES[0][1];
		let notes = [n].concat(ch[1] ? ch[1].map((i) => n + i) : ch[2].map((k) => scaleStep(n, k, s.sc_on ? root : (n % 12 + 12) % 12, hs)));
		if (s.sc_on) notes = notes.map((x) => inScale(x, root, sc));
		notes = notes.filter((x, i) => x >= 0 && x <= 127 && notes.indexOf(x) === i);
		vel = clamp(vel * s.velocity * (1 + (Math.random() * 2 - 1) * s.vel_rand * 0.6), 0.02, 1);
		if (this.down === 0 && s.arp_on && s.arp_latch) { this.arpRelease(); this.pool = []; } // a new chord after letting go
		this.down++;
		const h = this.held[note] = { outs: notes, vel, arp: !!s.arp_on, plans: [] }; // released the way it was played
		if (s.arp_on) {
			const first = !this.pool.length;
			for (const x of notes) if (!this.pool.some((p) => p.note === x)) this.pool.push({ note: x, vel, order: this.order++ });
			if (first && !this.patched[I_CLOCK]) this.arpNext = this.t; // starts at once
		}
		else for (const x of notes) h.plans.push(this.echo(x, vel));
	}

	noteOff(note) {
		const h = this.held[note];
		if (!h) return;
		delete this.held[note];
		if (h.drop) return;
		this.down = Math.max(0, this.down - 1);
		if (!h.arp) for (const p of h.plans) this.echoOff(p);
		this.prune();
	}
	// without LATCH, the arpeggiator keeps only the notes of the keys held
	prune() {
		if (this.s.arp_latch && this.s.arp_on) return;
		this.pool = this.pool.filter((p) => this.stillHeld(p.note));
		if (!this.pool.length) this.arpRelease();
	}
	stillHeld(n) { for (const k in this.held) { const h = this.held[k]; if (h.arp && h.outs.indexOf(n) >= 0) return true; } return false; }

	// ---- ARP ----
	arpRelease() {
		for (const p of this.arpOn) this.echoOff(p);
		this.arpOn = []; this.arpIdx = -1; this.arpDir = 1;
	}
	arpStep() {
		const s = this.s;
		for (const p of this.arpOn) this.echoOff(p);
		this.arpOn = [];
		if (!this.pool.length) return;
		const mode = ARP_MODES[clamp(s.arp_mode | 0, 0, ARP_MODES.length - 1)], oct = clamp(s.arp_oct | 0, 1, 4);
		let base = this.pool.slice();
		if (mode === "AS PLAYED") base.sort((a, b) => a.order - b.order); else base.sort((a, b) => a.note - b.note);
		let seq = [];
		for (let o = 0; o < oct; o++) for (const p of base) if (p.note + o * 12 <= 127) seq.push({ note: p.note + o * 12, vel: p.vel });
		let play;
		if (mode === "CHORD") play = base;
		else {
			const n = seq.length;
			if (mode === "DOWN") seq.reverse();
			if (mode === "RANDOM") this.arpIdx = Math.floor(Math.random() * n);
			else if (mode === "UP DOWN" && n > 1) {
				let i = this.arpIdx + this.arpDir;
				if (i >= n) { this.arpDir = -1; i = n - 2; } else if (i < 0) { this.arpDir = 1; i = 1; }
				this.arpIdx = clamp(i, 0, n - 1);
			}
			else this.arpIdx = (this.arpIdx + 1) % n;
			play = [seq[clamp(this.arpIdx, 0, n - 1)]];
		}
		const len = Math.max(1, Math.round(this.stepLen(s.arp_div) * clamp(s.arp_gate, 0.05, 1)));
		const plans = play.map((p) => this.echo(p.note, p.vel));
		this.arpOn = plans;
		if (s.arp_gate < 1) this.at(this.t + len, () => {
			if (this.arpOn === plans) { for (const p of plans) this.echoOff(p); this.arpOn = []; }
		});
	}

	// ---- ECHO: the note now, and its repeats. The plan it returns ends them (echoOff) ----
	echo(note, vel) {
		const s = this.s, plan = { note, reps: [] };
		if (s.on && s.echo_on) {
			const T = this.stepLen(s.echo_div), rep = clamp(s.echo_rep | 0, 1, 8);
			for (let k = 1; k <= rep; k++) {
				const g = Math.pow(s.echo_fb, k), n = note + (s.echo_pitch | 0) * k;
				if (g < 0.03 || n < 0 || n > 127) break;
				plan.reps.push({ dt: k * T, note: n });
				this.at(this.t + k * T, () => this.out(n, clamp(vel * g, 0.02, 1), true));
			}
		}
		this.out(note, vel, true);
		return plan;
	}
	echoOff(plan) {
		this.out(plan.note, 0, false);
		for (const e of plan.reps) this.at(this.t + e.dt, () => this.out(e.note, 0, false));
	}

	// ---- out: to the devices cabled from MIDI OUT, and the front jacks ----
	out(note, vel, on) {
		const c = this.count;
		if (on) {
			if (c[note] > 0) this.emit(note, 0, false); // played again while on: a new note
			c[note]++;
			this.emit(note, vel, true);
			const i = this.stack.indexOf(note); if (i >= 0) this.stack.splice(i, 1);
			this.stack.push(note);
			this.outs[O_VEL] = vel * 5;
		}
		else {
			if (c[note] <= 0) return;
			if (--c[note] > 0) return;
			this.emit(note, 0, false);
			const i = this.stack.indexOf(note); if (i >= 0) this.stack.splice(i, 1);
		}
		if (this.stack.length) this.outs[O_PITCH] = (this.stack[this.stack.length - 1] - 60) / 12;
		this.outs[O_GATE] = this.stack.length ? 5 : 0;
	}
	emit(note, vel, on) {
		this.actOut = 1;
		if (!this.host || !this.host.midiFrom) return;
		this.sending = true;
		this.host.midiFrom(this, { type: "note", note, on, vel });
		this.sending = false;
	}

	panic() {
		this.events = []; this.qdelay = {}; this.held = {}; this.down = 0; this.pool = []; this.arpOn = []; this.arpIdx = -1; this.bypass = {};
		for (let n = 0; n < 128; n++) if (this.count[n] > 0) { this.count[n] = 0; this.emit(n, 0, false); }
		this.stack = []; this.outs[O_GATE] = 0;
	}

	beginBlock() {}
	tick() {
		const s = this.s;
		this.t++;
		// CLOCK IN: its pulses, their period
		const clk = this.patched[I_CLOCK] && this.ins[I_CLOCK] > 1;
		const edge = clk && !this.lastClock;
		this.lastClock = clk;
		if (edge) { if (this.clockAt >= 0) this.clockPeriod = this.t - this.clockAt; this.clockAt = this.t; }
		const e = this.events;
		while (e.length && e[0].at <= this.t) e.shift().fn();
		if (!s) return;
		if (s.arp_on && this.pool.length) {
			if (this.patched[I_CLOCK] ? edge : this.t >= this.arpNext) {
				this.arpStep();
				if (!this.patched[I_CLOCK]) this.arpNext = this.t + this.stepLen(s.arp_div);
			}
		}
	}
	endBlock() {}

	state() {
		const ins = Object.keys(this.held).filter((k) => !this.held[k].drop).map(Number).sort((a, b) => a - b).slice(0, 8);
		const outs = [];
		for (let n = 0; n < 128 && outs.length < 10; n++) if (this.count[n] > 0) outs.push(n);
		const st = { ins, outs, act: [this.actIn, this.actOut], tempo: this.tempo(), clock: !!this.patched[I_CLOCK] };
		this.actIn = this.actOut = 0;
		return st;
	}
}
MidiFxDSP.IN_IDS = IN_IDS;
MidiFxDSP.OUT_IDS = OUT_IDS;
MidiFxDSP.MIDI_IN = "midi_in";
MidiFxDSP.MIDI_OUT = "midi_out";
MidiFxDSP.POLY = true; // gets every note, not a mono voice
MidiFxDSP.TABLES = { DIVS, SCALES, CHORDS, ARP_MODES, NOTE_N };

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.midifx = MidiFxDSP;

})();
