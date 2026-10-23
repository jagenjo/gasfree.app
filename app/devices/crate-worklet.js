// devices/crate-worklet.js
// CRATE 60 DSP, hosted by the rack processor: a pad sampler with a sequencer.
//   - 64 pads (4 banks of 16). Each plays a sample: TUNE, LEVEL, PAN, ATTACK, DECAY, ONE SHOT or
//     NOTE ON, MUTE GROUP (pads of a group cut each other), a low pass (CUTOFF, RESO), VELOCITY
//     SENSITIVITY, START / END (a slice of the sample) and REVERSE. 32 voices.
//   - Samples: the panel sends them ({ type: "sample" }): the factory kit (made there, once), files
//     dropped on the pads, saved recordings. The SAMPLE page records the rear IN L / R here.
//   - The sequencer: 16 sequences of 1-16 bars, 96 ticks a beat, events [tick, pad, velocity,
//     note variation]. Recording (REC / OVERDUB) rounds to TIMING CORRECT; SWING delays the even
//     sixteenths; NOTE REPEAT retriggers the held pads; ERASE, held while playing, removes the held
//     pads' events as they pass. What is recorded or erased goes back to the panel in state().
// Audio: OUT L / R on the back, IN L / R (for sampling, and MONITOR). MIDI: notes 36-99 play the pads.

(function(){

const IN_IDS = ["in_l", "in_r"];
const OUT_IDS = ["out_l", "out_r"];
const PPQ = 96, BAR = PPQ * 4;
const NVOICES = 32;
const TC = { "OFF": 1, "1/8": 48, "1/8T": 32, "1/16": 24, "1/16T": 16, "1/32": 12 };

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// ---------------------------------------------------------------------------

class CrateDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		// the samples: id -> { l, r (or null), sr, name }. The panel sends them, the factory kit too
		this.samples = {};
		this.voices = [];
		for (let i = 0; i < NVOICES; i++) this.voices.push({ on: false, age: 0 });
		this.age = 0;
		// the sequencer
		this.playing = false; this.rec = false; this.od = false;
		this.ppos = 0;          // the position, in ticks (float)
		this.loopN = 0;         // loops played: events recorded in this pass are skipped
		this.events = [];       // the current sequence's events, sorted: { t, p, v, nv, f }
		this.evKey = "";
		this.next = 0;          // index of the next event to play
		this.add = []; this.del = [];
		this.sentAdd = []; this.sentDel = []; // reported in the last state(), maybe not in the settings yet
		this.held = new Map();  // pad -> [vel, nv] held (for NOTE REPEAT and ERASE)
		this.repeat = false; this.erase = false;
		this.repeatTick = -1;
		this.freeTick = 0;      // a clock running while stopped (NOTE REPEAT)
		this.click = 0; this.clickF = 1000;
		this.hits = [];
		// sampling
		this.recState = "idle"; this.recId = null; this.recL = null; this.recR = null; this.recN = 0;
		this.inPeak = [0, 0]; this.recorded = null;
		this.wave = null;
	}

	setMidiConnected(c) { this.midiConnected = c; }

	setSettings(s) {
		this.s = s;
		const seq = s.seqs[s.seq] || { bars: 1, ev: [] };
		const key = s.seq + ":" + JSON.stringify(seq.ev);
		if (key != this.evKey) {
			this.evKey = key;
			// the panel's events, plus what was recorded or erased here and not reported yet
			const list = seq.ev.map(e => ({ t: e[0], p: e[1], v: e[2], nv: e[3] || null, f: -1 }));
			for (const a of this.add.concat(this.sentAdd)) if (a.seq == s.seq && !list.some(e => e.t == a.e[0] && e.p == a.e[1])) list.push({ t: a.e[0], p: a.e[1], v: a.e[2], nv: a.e[3] || null, f: -1 });
			const dels = this.del.concat(this.sentDel);
			this.events = list.filter(e => !dels.some(d => d.seq == s.seq && d.e[0] == e.t && d.e[1] == e.p)).sort((a, b) => a.t - b.t);
			this.seekNext();
		}
	}

	len() { const s = this.s, seq = s.seqs[s.seq]; return (seq ? seq.bars : 1) * BAR; }
	swingT(t) { // where an event plays: the even sixteenths later with SWING
		const sw = this.s.swing;
		return (sw > 50 && t % 48 == 24) ? t + (sw - 50) / 50 * 24 : t;
	}
	seekNext() { let i = 0; while (i < this.events.length && this.swingT(this.events[i].t) < this.ppos) i++; this.next = i; }

	message(m) {
		switch (m.type) {
			case "pad": m.on ? this.padOn(m.pad, m.vel, m.nv || null, true) : this.padOff(m.pad); break;
			case "note": {
				const p = m.note - 36;
				if (p < 0 || p > 63) break;
				m.on ? this.padOn(p, m.vel === undefined ? 1 : m.vel, null, true) : this.padOff(p);
				break;
			}
			case "allNotesOff": this.held.clear(); for (const v of this.voices) if (v.on && v.mode == 1) v.rel = true; break;
			case "play": this.play(m.from == "start"); break;
			case "stop": this.stop(); break;
			case "rec": this.rec = !!m.rec; this.od = !!m.od; break;
			case "locate": if (!this.playing) { this.ppos = clamp(m.tick, 0, this.len() - 1); this.seekNext(); } break;
			case "repeat": this.repeat = !!m.on; this.repeatTick = -1; break;
			case "erase": this.erase = !!m.on; break;
			case "sample": this.samples[m.id] = { l: m.l, r: m.r || null, sr: m.sr, name: m.name || "" }; break;
			case "unload": delete this.samples[m.id]; break;
			case "preview": this.trigger(-1, 0.9, null, m.id); break;
			case "recArm":
				this.recId = m.id; this.recState = "armed"; this.recN = 0;
				this.recL = new Float32Array(Math.floor(clamp(m.max || 10, 1, 30) * sampleRate));
				this.recR = m.stereo ? new Float32Array(this.recL.length) : null;
				break;
			case "recStop": if (this.recState == "recording") this.finishRec(); else this.recState = "idle"; break;
			case "wave": this.makeWave(m.id); break;
		}
	}

	play(fromStart) {
		if (fromStart) this.ppos = 0;
		this.playing = true;
		this.clickNow = this.ppos % PPQ == 0;
		this.seekNext();
	}
	stop() {
		this.playing = false;
		for (const v of this.voices) if (v.on && v.mode == 1) v.rel = true;
	}

	// a pad pressed: it sounds, and is recorded while recording
	padOn(p, vel, nv, live) {
		const s = this.s;
		this.held.set(p, [vel, nv]);
		this.trigger(p, vel, nv, null);
		if (live && this.playing && (this.rec || this.od) && !this.repeat) this.record(p, vel, nv);
	}
	padOff(p) {
		this.held.delete(p);
		for (const v of this.voices) if (v.on && v.pad == p && v.mode == 1) v.rel = true;
	}

	record(p, vel, nv) {
		const s = this.s, L = this.len(), g = TC[s.tc] || 1;
		let t = Math.round(this.ppos / g) * g;
		if (t >= L) t -= L;
		const e = [t, p, Math.round(vel * 100) / 100, nv];
		// rounded to a point ahead of the playhead: it already sounded, so it waits for the next pass
		this.events.push({ t: t, p: p, v: e[2], nv: nv, f: t >= this.ppos ? this.loopN : -1 });
		this.events.sort((a, b) => a.t - b.t);
		this.seekNext();
		this.add.push({ seq: s.seq, e: e });
	}

	trigger(p, vel, nv, sampleId) {
		const s = this.s, pad = p >= 0 ? s.pads[p] : null;
		const id = pad ? pad.s : sampleId, smp = id && this.samples[id];
		this.hits.push(p);
		if (!smp) return;
		const pd = pad || { tune: 0, level: 0.8, pan: 0, attack: 0, decay: 1, mode: "oneshot", group: 0, cutoff: 1, reso: 0, vel: 0.8, start: 0, end: 1, rev: false };
		let tune = pd.tune, attack = pd.attack, decay = pd.decay, cutoff = pd.cutoff;
		if (nv) {
			if (nv[0] == "tune") tune += nv[1];
			else if (nv[0] == "attack") attack = nv[1];
			else if (nv[0] == "decay") decay = nv[1];
			else if (nv[0] == "filter") cutoff = nv[1];
		}
		// a mute group: the other voices of the group stop
		if (pd.group) for (const v of this.voices) if (v.on && v.group == pd.group) v.choke = true;
		// a free voice, or the oldest
		let voice = null, oldest = null;
		for (const v of this.voices) { if (!v.on) { voice = v; break; } if (!oldest || v.age < oldest.age) oldest = v; }
		if (!voice) voice = oldest;
		const n = smp.l.length;
		const a = Math.floor(clamp(pd.start, 0, 1) * n), b = Math.max(a + 1, Math.floor(clamp(pd.end, 0, 1) * n));
		voice.on = true; voice.age = ++this.age; voice.pad = p; voice.group = pd.group || 0;
		voice.smp = smp; voice.a = a; voice.b = b;
		voice.dir = pd.rev ? -1 : 1;
		voice.pos = pd.rev ? b - 1 : a;
		voice.rate = Math.pow(2, tune / 12) * smp.sr / sampleRate;
		const amp = pd.level * (1 - pd.vel + pd.vel * vel);
		const pan = clamp(pd.pan, -1, 1);
		voice.gl = amp * Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2;
		voice.gr = amp * Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
		voice.env = 0;
		voice.att = attack > 0.001 ? 1 / (Math.pow(attack, 2) * 2 * sampleRate) : 1;
		voice.dec = decay >= 0.999 ? 1 : Math.exp(-1 / ((0.02 * Math.pow(500, decay)) * sampleRate));
		voice.relC = Math.exp(-1 / (Math.max(0.01, 0.02 * Math.pow(500, Math.min(decay, 0.9))) * sampleRate));
		voice.mode = pd.mode == "noteon" ? 1 : 0;
		voice.stage = 0; voice.rel = false; voice.choke = false;
		// the low pass
		voice.filt = cutoff < 0.995;
		if (voice.filt) {
			const f = 20 * Math.pow(1000, cutoff);
			voice.g = Math.tan(Math.PI * Math.min(f, sampleRate * 0.45) / sampleRate);
			voice.k = 2 - 1.9 * clamp(pd.reso, 0, 1);
			voice.l1 = voice.l2 = voice.r1 = voice.r2 = 0;
		}
	}

	// the sequencer, one sample
	clock() {
		const s = this.s, L = this.len();
		const step = s.tempo / 60 * PPQ / sampleRate;
		if (this.playing) {
			const t0 = this.ppos;
			let t1 = t0 + step;
			// the events up to here
			while (this.next < this.events.length) {
				const e = this.events[this.next], et = this.swingT(e.t);
				if (et >= t1) break;
				this.next++;
				if (e.f == this.loopN) continue; // just recorded
				if (this.erase && this.held.has(e.p)) { this.removeEvent(e); this.next--; continue; }
				this.trigger(e.p, e.v, e.nv, null);
			}
			// the click, on the beats
			const beat = Math.floor(t1 / PPQ);
			if (beat != Math.floor(t0 / PPQ) || this.clickNow) {
				this.clickNow = false;
				if (s.click == "ON" || (s.click == "REC" && (this.rec || this.od))) { this.click = 1; this.clickF = beat % 4 == 0 ? 1600 : 1000; this.clickPh = 0; }
			}
			// NOTE REPEAT: the held pads on the TIMING CORRECT grid
			if (this.repeat && this.held.size) this.repeatStep(t0, t1);
			if (t1 >= L) {
				t1 -= L; this.loopN++; this.next = 0;
			}
			this.ppos = t1;
		} else {
			const t0 = this.freeTick, t1 = t0 + step;
			if (this.repeat && this.held.size) this.repeatStep(t0, t1);
			this.freeTick = t1 % (PPQ * 64);
		}
	}

	repeatStep(t0, t1) {
		const g = TC[this.s.tc] || 24, k = Math.floor(t1 / g);
		if (k == Math.floor(t0 / g)) return;
		for (const [p, hv] of this.held) {
			this.trigger(p, hv[0], hv[1], null);
			if (this.playing && (this.rec || this.od)) {
				const t = (k * g) % this.len();
				if (!this.events.some(e => e.t == t && e.p == p)) {
					this.events.push({ t: t, p: p, v: hv[0], nv: hv[1], f: this.loopN });
					this.events.sort((a, b) => a.t - b.t); this.seekNext();
					this.add.push({ seq: this.s.seq, e: [t, p, Math.round(hv[0] * 100) / 100, hv[1]] });
				}
			}
		}
	}

	removeEvent(e) {
		const i = this.events.indexOf(e);
		if (i >= 0) this.events.splice(i, 1);
		this.add = this.add.filter(a => !(a.seq == this.s.seq && a.e[0] == e.t && a.e[1] == e.p));
		this.del.push({ seq: this.s.seq, e: [e.t, e.p] });
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs;
		this.clock();
		let L = 0, R = 0;
		for (const v of this.voices) {
			if (!v.on) continue;
			// the envelope: attack, then hold (NOTE ON, until let go) or decay
			if (v.choke) { v.env *= 0.995; if (v.env < 1e-4) { v.on = false; continue; } }
			else if (v.stage == 0) { v.env += v.att; if (v.env >= 1) { v.env = 1; v.stage = 1; } }
			else if (v.mode == 1) { if (v.rel) { v.env *= v.relC; if (v.env < 1e-4) { v.on = false; continue; } } }
			else if (v.dec < 1) { v.env *= v.dec; if (v.env < 1e-4) { v.on = false; continue; } }
			const smp = v.smp, i = v.pos | 0, f = v.pos - i;
			let j = i + v.dir;
			if (j < v.a || j >= v.b) j = i;
			let xl = smp.l[i] + (smp.l[j] - smp.l[i]) * f;
			let xr = smp.r ? smp.r[i] + (smp.r[j] - smp.r[i]) * f : xl;
			if (v.filt) {
				const g = v.g, k = v.k, d = 1 / (1 + g * (g + k));
				let v3 = xl - v.l2, v1 = (g * v3 + v.l1) * d, v2 = v.l2 + g * v1;
				v.l1 = 2 * v1 - v.l1; v.l2 = 2 * v2 - v.l2; xl = v2;
				v3 = xr - v.r2; v1 = (g * v3 + v.r1) * d; v2 = v.r2 + g * v1;
				v.r1 = 2 * v1 - v.r1; v.r2 = 2 * v2 - v.r2; xr = v2;
			}
			L += xl * v.gl * v.env; R += xr * v.gr * v.env;
			v.pos += v.rate * v.dir;
			if (v.pos >= v.b || v.pos < v.a) v.on = false;
		}
		// the click
		if (this.click > 0.001) {
			this.clickPh += this.clickF / sampleRate;
			const c = Math.sin(2 * Math.PI * this.clickPh) * this.click * 0.25;
			L += c; R += c; this.click *= 0.9985;
		}
		// the inputs: sampling, MONITOR
		const gain = s.rec_gain;
		const il = ins[0] * gain, ir = (this.patched[1] ? ins[1] : ins[0]) * gain;
		const al = il < 0 ? -il : il, ar = ir < 0 ? -ir : ir;
		if (al > this.inPeak[0]) this.inPeak[0] = al;
		if (ar > this.inPeak[1]) this.inPeak[1] = ar;
		if (this.recState == "armed" && Math.max(al, ar) >= Math.pow(10, s.thresh / 20)) this.recState = "recording";
		if (this.recState == "recording") {
			this.recL[this.recN] = this.recR ? il : (il + ir) * 0.5;
			if (this.recR) this.recR[this.recN] = ir;
			if (++this.recN >= this.recL.length) this.finishRec();
		}
		if (s.monitor) { L += il; R += ir; }
		const vol = s.volume;
		outs[0] = L * vol; outs[1] = R * vol;
		return 0;
	}

	finishRec() {
		const n = Math.max(1, this.recN);
		const l = this.recL.slice(0, n), r = this.recR ? this.recR.slice(0, n) : null;
		this.samples[this.recId] = { l: l, r: r, sr: sampleRate, name: "" };
		this.recorded = { id: this.recId, l: l, r: r, sr: sampleRate };
		this.recState = "idle"; this.recL = this.recR = null;
	}

	// an overview of a sample for the TRIM page: 400 columns of [min, max]
	makeWave(id) {
		const smp = this.samples[id];
		if (!smp) { this.wave = { id: id, peaks: null }; return; }
		const N = 400, n = smp.l.length, peaks = new Float32Array(N * 2);
		for (let c = 0; c < N; c++) {
			let lo = 0, hi = 0;
			const a = Math.floor(c * n / N), b = Math.max(a + 1, Math.floor((c + 1) * n / N));
			for (let i = a; i < b && i < n; i += Math.max(1, ((b - a) / 64) | 0)) { const x = smp.l[i]; if (x < lo) lo = x; if (x > hi) hi = x; }
			peaks[c * 2] = lo; peaks[c * 2 + 1] = hi;
		}
		this.wave = { id: id, peaks: peaks, len: n / smp.sr };
	}

	beginBlock() {}
	endBlock() {}

	state() {
		const have = [];
		for (const id in this.samples) have.push(id);
		const st = { tick: this.ppos, playing: this.playing, have: have, hits: this.hits,
			rec: this.recState, recT: this.recN / sampleRate, peak: this.inPeak.slice(), add: this.add, del: this.del };
		this.hits = []; this.sentAdd = this.add; this.sentDel = this.del; this.add = []; this.del = [];
		this.inPeak[0] *= 0.5; this.inPeak[1] *= 0.5;
		if (this.recorded) { st.recorded = this.recorded; this.recorded = null; }
		if (this.wave) { st.wave = this.wave; this.wave = null; }
		return st;
	}
}
CrateDSP.OUT_IDS = OUT_IDS;
CrateDSP.IN_IDS = IN_IDS;
CrateDSP.MIDI_IN = "midi_in";
CrateDSP.POLY = true;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.crate = CrateDSP;

})();
