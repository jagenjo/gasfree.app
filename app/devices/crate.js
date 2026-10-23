// devices/crate.js
// CRATE 60 module: a pad sampler and sequencer, laid out as a compact modern beat machine. A black
// strip on top: MAIN VOLUME, the bank letters, the colour screen with its three keys, the level LEDs
// and the speaker. The light grey body: the MODE keys (SAMPLE, SEQ, PROGRAM, TRIM, LOAD, PAD BANK),
// SHIFT, the NOTE VARIATION fader, ERASE and NOTE REPEAT on the left; the K1-K3 knobs over the 16
// lit pads in the middle; PAD PLAY (CHOP, MUTE, LOOP, 16 LEVELS), SAMPLE SELECT, TAP TEMPO, the DATA
// encoder, - / +, SAMPLE RECORD, SEQ RECORD, STOP and PLAY on the right; a palm rest along the front.
// SHIFT gives every key the function printed under it (pads 1-4 too). The pages of the screen hold
// the parameters: click a field (or move with the arrows by DATA) and turn DATA, or drag the field.
// Samples: the factory kit (made here once and sent to the DSP), audio files dropped on a pad, and
// recordings of the rear IN L / R (SAMPLE page). Files and recordings are kept in this browser
// (IndexedDB, "GASFREE_samples"); the patches only name them. DSP in crate-worklet.js.

(function(){

var SIZE = [1568, 1000];
var CASE = "#d7d6d0", INK = "#2a2a2a", DIM = "#6e6e6a", RED = "#c8332b", BLUE = "#7d93ab";
var LCD_BG = "#0e1726", LCD_INK = "#eef2f6", LCD_DIM = "#7d8aa0", LCD_HI = "#f5c542";
var BANKS = ["A", "B", "C", "D"];
var TCS = ["OFF", "1/8", "1/8T", "1/16", "1/16T", "1/32"];
var TC_TICKS = { "OFF": 1, "1/8": 48, "1/8T": 32, "1/16": 24, "1/16T": 16, "1/32": 12 };
var NV = ["OFF", "TUNE", "DECAY", "ATTACK", "FILTER"];
var PPQ = 96, BAR = PPQ * 4;
var SCREENS = [["main", "MAIN"], ["program", "PROGRAM"], ["sample", "SAMPLE"], ["trim", "TRIM"], ["load", "LOAD"], ["grid", "GRID"]];

// ---------------------------------------------------------------------------
// the factory kit: 20 sounds, made once (at the audio rate) and sent to every CRATE 60

var FACTORY = ["KICK 1", "SNARE 1", "HAT CLOSED", "HAT OPEN", "KICK 2", "SNARE 2", "CLAP", "RIM", "TOM LOW", "TOM HIGH", "RIDE", "CRASH",
	"COWBELL", "SHAKER", "BASS C", "STAB C MIN", "CONGA", "CLAVE", "SUB BOOM", "VINYL"];

function makeKit( sr )
{
	let seed = 12345;
	const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
	const buf = (sec) => new Float32Array(Math.floor(sec * sr));
	const norm = (a, peak) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= (peak || 0.9) / m; return a; };
	const fade = (a) => { const n = Math.min(a.length, Math.floor(sr * 0.004)); for (let i = 0; i < n; i++) a[a.length - 1 - i] *= i / n; return a; };
	// a two-pole state variable filter run over a buffer: "lp", "bp" or "hp"
	const svf = (a, f, q, type) => {
		const g = Math.tan(Math.PI * Math.min(f, sr * 0.45) / sr), k = 1 / q;
		let ic1 = 0, ic2 = 0;
		for (let i = 0; i < a.length; i++) {
			const v3 = a[i] - ic2, v1 = (g * v3 + ic1) / (1 + g * (g + k)), v2 = ic2 + g * v1;
			ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
			a[i] = type == "lp" ? v2 : (type == "bp" ? v1 : a[i] - k * v1 - v2);
		}
		return a;
	};
	const kick = (f0, f1, sweep, dec, click, drive) => {
		const a = buf(dec * 6); let ph = 0;
		for (let i = 0; i < a.length; i++) {
			const t = i / sr, f = f1 + (f0 - f1) * Math.exp(-t / sweep);
			ph += f / sr;
			let x = Math.sin(2 * Math.PI * ph) * Math.exp(-t / dec);
			if (t < 0.004) x += rnd() * click * (1 - t / 0.004);
			a[i] = Math.tanh(x * drive);
		}
		return fade(norm(a));
	};
	const metal = (sec, dec, hp, ratios, base) => {
		const a = buf(sec), ph = ratios.map(() => 0);
		for (let i = 0; i < a.length; i++) {
			let x = 0;
			for (let k = 0; k < ratios.length; k++) { ph[k] += base * ratios[k] / sr; x += (ph[k] % 1) < 0.5 ? 1 : -1; }
			a[i] = (x / ratios.length * 0.7 + rnd() * 0.3) * Math.exp(-i / sr / dec);
		}
		return fade(norm(svf(a, hp, 0.7, "hp")));
	};
	const HAT = [2, 3, 4.16, 5.43, 6.79, 8.21];
	const noiseHit = (sec, dec, f, q, type, att) => {
		const a = buf(sec);
		for (let i = 0; i < a.length; i++) { const t = i / sr; a[i] = rnd() * Math.exp(-t / dec) * (att ? Math.min(1, t / att) : 1); }
		return fade(norm(svf(a, f, q, type)));
	};
	const tone = (sec, f0, f1, sweep, dec, noise) => {
		const a = buf(sec); let ph = 0;
		for (let i = 0; i < a.length; i++) {
			const t = i / sr; ph += (f1 + (f0 - f1) * Math.exp(-t / sweep)) / sr;
			a[i] = (Math.sin(2 * Math.PI * ph) + (noise ? rnd() * noise * Math.exp(-t / 0.01) : 0)) * Math.exp(-t / dec);
		}
		return fade(norm(a));
	};
	const s = {};
	s["KICK 1"] = kick(150, 48, 0.03, 0.35, 0.6, 1.6);
	s["KICK 2"] = kick(220, 58, 0.018, 0.16, 1.0, 2.6);
	s["SUB BOOM"] = kick(90, 38, 0.06, 0.9, 0.2, 1.2);
	{ // snares: a tone and filtered noise
		const sn = (body, dec, nf, nd) => {
			const a = buf(0.5), b = noiseHit(0.5, nd, nf, 0.6, "hp"); let p1 = 0, p2 = 0;
			for (let i = 0; i < a.length; i++) { const t = i / sr; p1 += body / sr; p2 += body * 1.85 / sr; a[i] = (Math.sin(2 * Math.PI * p1) * 0.6 + Math.sin(2 * Math.PI * p2) * 0.3) * Math.exp(-t / dec) + b[i] * 0.8; }
			return fade(norm(a));
		};
		s["SNARE 1"] = sn(185, 0.06, 1800, 0.12);
		s["SNARE 2"] = sn(220, 0.04, 3200, 0.2);
	}
	{ // clap: three bursts and a tail
		const a = buf(0.6);
		for (let i = 0; i < a.length; i++) {
			const t = i / sr; let e = Math.exp(-t / 0.12) * 0.6;
			for (const o of [0, 0.011, 0.022]) if (t >= o && t < o + 0.008) e = Math.max(e, Math.exp(-(t - o) / 0.003));
			a[i] = rnd() * e;
		}
		s["CLAP"] = fade(norm(svf(a, 1200, 1.4, "bp")));
	}
	s["RIM"] = (() => { const a = tone(0.12, 1700, 1700, 1, 0.012, 2); return fade(norm(svf(a, 600, 0.7, "hp"))); })();
	s["HAT CLOSED"] = metal(0.25, 0.035, 7000, HAT, 380);
	s["HAT OPEN"] = metal(0.9, 0.28, 6500, HAT, 380);
	s["RIDE"] = metal(2.2, 0.9, 3500, [2, 2.76, 5.4, 8.93, 3.1], 430);
	s["CRASH"] = (() => { const a = metal(2.5, 0.9, 3000, HAT, 300), b = noiseHit(2.5, 0.7, 4000, 0.5, "hp"); for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.5 + b[i] * 0.6; return fade(norm(a)); })();
	s["TOM LOW"] = tone(0.8, 150, 92, 0.08, 0.22, 0.6);
	s["TOM HIGH"] = tone(0.6, 240, 165, 0.06, 0.16, 0.6);
	s["CONGA"] = tone(0.4, 360, 310, 0.02, 0.12, 0.4);
	s["CLAVE"] = tone(0.15, 2500, 2500, 1, 0.03, 0);
	s["COWBELL"] = (() => {
		const a = buf(0.6); let p1 = 0, p2 = 0;
		for (let i = 0; i < a.length; i++) { const t = i / sr; p1 += 540 / sr; p2 += 800 / sr; a[i] = ((p1 % 1 < 0.5 ? 1 : -1) + (p2 % 1 < 0.5 ? 1 : -1)) * (Math.exp(-t / 0.03) * 0.6 + Math.exp(-t / 0.18) * 0.4); }
		return fade(norm(svf(a, 900, 1.8, "bp")));
	})();
	s["SHAKER"] = noiseHit(0.2, 0.05, 6000, 0.7, "hp", 0.02);
	s["BASS C"] = (() => {
		const a = buf(1.2); let ph = 0;
		for (let i = 0; i < a.length; i++) { const t = i / sr; ph += 65.41 / sr; a[i] = (Math.sin(2 * Math.PI * ph) * 0.7 + ((ph % 1) * 2 - 1) * 0.35) * Math.exp(-t / 0.5); }
		return fade(norm(svf(a, 600, 0.9, "lp")));
	})();
	s["STAB C MIN"] = (() => {
		const a = buf(0.9), fs = [261.63, 311.13, 392.0, 523.25], ph = fs.map(() => 0);
		for (let i = 0; i < a.length; i++) { const t = i / sr; let x = 0; for (let k = 0; k < fs.length; k++) { ph[k] += fs[k] * (1 + (k - 1.5) * 0.002) / sr; x += (ph[k] % 1) * 2 - 1; } a[i] = x * Math.exp(-t / 0.22); }
		return fade(norm(svf(a, 2400, 1.2, "lp")));
	})();
	s["VINYL"] = (() => {
		const a = buf(3);
		for (let i = 0; i < a.length; i++) a[i] = rnd() * 0.04 + (rnd() > 0.9993 ? rnd() * 0.9 : 0);
		return fade(norm(svf(a, 5000, 0.7, "lp"), 0.5));
	})();
	return s;
}

// ---------------------------------------------------------------------------
// the samples on this side: id -> { l, r, sr, name }. "f:NAME" factory, "u:..." the user's (IndexedDB)

var SAMPLES = {};
var kit_sr = 0;
var USER = [];         // the user's samples: [{ id, name, len, sr, stereo }], for the LOAD page
var sent = {};         // module id -> sample id -> when it was sent to the DSP
var loading = {};      // sample id -> being read from IndexedDB

function factory( sr )
{
	if(kit_sr != sr)
	{
		var kit = makeKit( sr );
		FACTORY.forEach(function(n){ SAMPLES[ "f:" + n ] = { l: kit[n], r: null, sr: sr, name: n }; });
		kit_sr = sr;
	}
}

var DB = null;
function db()
{
	if(!DB)
		DB = new Promise(function(res, rej){
			if(typeof indexedDB == "undefined") { rej( new Error( "no IndexedDB" ) ); return; }
			var r = indexedDB.open( "GASFREE_samples", 1 );
			r.onupgradeneeded = function(){ r.result.createObjectStore( "meta", { keyPath: "id" } ); r.result.createObjectStore( "audio", { keyPath: "id" } ); };
			r.onsuccess = function(){ res( r.result ); };
			r.onerror = function(){ rej( r.error ); };
		});
	return DB;
}
function tx( stores, mode, fn )
{
	return db().then(function(d){ return new Promise(function(res, rej){
		var t = d.transaction( stores, mode ), out = fn( t );
		t.oncomplete = function(){ res( out && out.result !== undefined ? out.result : out ); };
		t.onerror = function(){ rej( t.error ); };
	}); });
}
function saveSample( id, smp )
{
	var meta = { id: id, name: smp.name, len: smp.l.length / smp.sr, sr: smp.sr, stereo: !!smp.r };
	USER.push( meta );
	return tx( ["meta", "audio"], "readwrite", function(t){ t.objectStore( "meta" ).put( meta ); t.objectStore( "audio" ).put({ id: id, l: smp.l, r: smp.r }); } )
		.catch(function(err){ if(window.setStatus) setStatus( "CRATE 60: the sample could not be kept in this browser (" + err.message + ")" ); });
}
function readSample( id )
{
	if(loading[id]) return;
	loading[id] = true;
	tx( ["meta", "audio"], "readonly", function(t){
		var out = {};
		t.objectStore( "meta" ).get( id ).onsuccess = function(e){ out.meta = e.target.result; };
		t.objectStore( "audio" ).get( id ).onsuccess = function(e){ out.audio = e.target.result; };
		return out;
	}).then(function(out){
		if(out.meta && out.audio) SAMPLES[id] = { l: out.audio.l, r: out.audio.r || null, sr: out.meta.sr, name: out.meta.name };
		else SAMPLES[id] = null; // not in this browser
	}).catch(function(){ SAMPLES[id] = null; });
}
function deleteSample( id )
{
	USER = USER.filter(function(u){ return u.id != id; });
	delete SAMPLES[id];
	tx( ["meta", "audio"], "readwrite", function(t){ t.objectStore( "meta" ).delete( id ); t.objectStore( "audio" ).delete( id ); } ).catch(function(){});
}
// the list of the user's samples, at start
tx( ["meta"], "readonly", function(t){ var out = {}; t.objectStore( "meta" ).getAll().onsuccess = function(e){ out.list = e.target.result; }; return out; } )
	.then(function(out){ USER = (out.list || []).sort(function(a, b){ return a.name < b.name ? -1 : 1; }); }).catch(function(){});

function newId() { return "u:" + Date.now().toString( 36 ) + Math.floor( Math.random() * 1e6 ).toString( 36 ); }

// what the DSP lacks (its state lists what it has): sent, again after a second if still missing
function syncSamples( M )
{
	var st = M.state, s = M.settings;
	if(!st || !st.have || !rack.context) return;
	factory( rack.context.sampleRate );
	var have = {}, now = performance.now(), mine = sent[ M.id ] = sent[ M.id ] || {};
	st.have.forEach(function(id){ have[id] = true; });
	var need = {};
	s.pads.forEach(function(p){ if(p.s) need[ p.s ] = true; });
	var u = uiOf( M );
	if(u.preview) need[ u.preview ] = true;
	Object.keys( need ).forEach(function(id){
		if(have[id] || (mine[id] && now - mine[id] < 1000)) return;
		var smp = SAMPLES[id];
		if(smp === undefined) { if(id.charAt( 0 ) == "u") readSample( id ); return; }
		if(!smp) return;
		mine[id] = now;
		rack.postModule( M.id, { type: "sample", id: id, l: smp.l, r: smp.r, sr: smp.sr, name: smp.name } );
	});
}

// an audio file onto a pad: decoded, kept, assigned
function loadFile( M, pad, file )
{
	file.arrayBuffer().then(function(buf){
		var ctx = new OfflineAudioContext( 2, 1, 44100 );
		return ctx.decodeAudioData( buf );
	}).then(function(ab){
		var n = Math.min( ab.length, ab.sampleRate * 60 );
		var smp = { l: ab.getChannelData( 0 ).slice( 0, n ), r: ab.numberOfChannels > 1 ? ab.getChannelData( 1 ).slice( 0, n ) : null, sr: ab.sampleRate,
			name: file.name.replace( /\.[^.]*$/, "" ).toUpperCase().substr( 0, 16 ) };
		var id = newId();
		SAMPLES[id] = smp;
		saveSample( id, smp );
		assign( M.settings, pad, id, smp.name );
		uiOf( M ).sel = pad;
		M.settings.sel = pad;
		if(window.setStatus) setStatus( "CRATE 60: " + smp.name + " on pad " + padName( pad ) + " (" + (n / ab.sampleRate).toFixed( 2 ) + " s)" );
	}).catch(function(err){ if(window.setStatus) setStatus( "CRATE 60: could not read " + file.name + " (" + (err && err.message || "not audio") + ")" ); });
}

function assign( s, pad, id, name )
{
	var p = s.pads[ pad ];
	p.s = id; p.name = name; p.start = 0; p.end = 1;
}

// ---------------------------------------------------------------------------
// settings

function padDefaults( name )
{
	return { s: name ? "f:" + name : "", name: name || "", tune: 0, level: 0.8, pan: 0, attack: 0, decay: 1, mode: "oneshot", group: 0, cutoff: 1, reso: 0, vel: 0.8, start: 0, end: 1, rev: false, mute: false, loop: false };
}

function defaults()
{
	var pads = [];
	for(var i = 0; i < 64; ++i) pads.push( padDefaults( FACTORY[i] ) );
	// the hats cut each other
	pads[2].group = 1; pads[3].group = 1;
	var seqs = [];
	for(var i = 0; i < 16; ++i) seqs.push({ bars: 2, ev: [] });
	return { pads: pads, seqs: seqs, seq: 0, sel: 0, bank: 0, tempo: 92, tc: "1/16", swing: 50, click: "REC", levels: "VELOCITY", nv: "OFF", nv_val: 0.5,
		full: false, rec_gain: 1, volume: 0.8, thresh: -40, max_time: 10, stereo: true, monitor: false, chop: 4 };
}

function validate( s, raw )
{
	s.pads.forEach(function(p){
		p.tune = Math.max( -24, Math.min( 24, p.tune ) );
		if(p.mode != "noteon") p.mode = "oneshot";
		p.group = Math.max( 0, Math.min( 8, Math.round( p.group ) ) );
		p.start = Math.max( 0, Math.min( 1, p.start ) ); p.end = Math.max( p.start, Math.min( 1, p.end ) );
	});
	// the events: the merge keeps arrays only when their length matches the defaults
	var rs = raw && Array.isArray( raw.seqs ) ? raw.seqs : [];
	s.seqs.forEach(function(q, i){
		var r = rs[i] && Array.isArray( rs[i].ev ) ? rs[i].ev : q.ev;
		q.bars = Math.max( 1, Math.min( 16, Math.round( q.bars ) ) );
		q.ev = r.filter(function(e){ return Array.isArray( e ) && e.length >= 3 && isFinite( e[0] ) && isFinite( e[1] ) && e[1] >= 0 && e[1] < 64; })
			.map(function(e){ return [ Math.max( 0, Math.round( e[0] ) ), e[1] | 0, Math.max( 0, Math.min( 1, +e[2] ) ), Array.isArray( e[3] ) ? [ String( e[3][0] ), +e[3][1] || 0 ] : null ]; })
			.filter(function(e){ return e[0] < q.bars * BAR; }).slice( 0, 4000 );
	});
	s.seq = Math.max( 0, Math.min( 15, s.seq | 0 ) );
	s.sel = Math.max( 0, Math.min( 63, s.sel | 0 ) );
	s.bank = Math.max( 0, Math.min( 3, s.bank | 0 ) );
	s.tempo = Math.max( 30, Math.min( 300, s.tempo ) );
	if(TCS.indexOf( s.tc ) < 0) s.tc = "1/16";
	s.swing = Math.max( 50, Math.min( 75, s.swing ) );
	if(["OFF", "REC", "ON"].indexOf( s.click ) < 0) s.click = "REC";
	if(NV.indexOf( s.nv ) < 0) s.nv = "OFF";
}

function randomize( s )
{
	for(var i = 0; i < 16; ++i)
	{
		var p = s.pads[i];
		p.tune = Math.round( (Math.random() - 0.5) * 8 );
		p.decay = Math.random() < 0.5 ? 1 : 0.3 + Math.random() * 0.6;
		p.cutoff = Math.random() < 0.6 ? 1 : 0.4 + Math.random() * 0.5;
		p.pan = Math.round( (Math.random() - 0.5) * 8 ) / 10;
	}
	s.swing = 50 + Math.round( Math.random() * 16 );
}

// ---------------------------------------------------------------------------
// panel state

var M = null, S = null, ST = null;
var uis = {};
function uiOf( m ) { m = m || M; return uis[ m.id ] || (uis[ m.id ] = { screen: "main", cur: 0, wave: null, list: 0, gridBar: 0, clip: null, undo: null,
	flash: new Float64Array( 64 ), down: {}, taps: [], rec: false, od: false, levels: false, levelsPad: 0, wheelAcc: 0, wheelAng: 0, last: null, shift: false }); }
function send( msg ) { var id = M.id; act(function(){ rack.postModule( id, msg ); }); }
function padName( p ) { return BANKS[ p >> 4 ] + String( (p & 15) + 1 ).padStart( 2, "0" ); }
function seq() { return S.seqs[ S.seq ]; }
function fmtPos( t ) { t = Math.floor( t ); return String( Math.floor( t / BAR ) + 1 ).padStart( 3, "0" ) + "." + (Math.floor( t / PPQ ) % 4 + 1) + "." + String( t % PPQ ).padStart( 2, "0" ); }

// the state from the DSP: recorded / erased events, the pads hit, a recording, a waveform
function takeState()
{
	var u = uiOf(), st = ST;
	if(!st || st === u.last) return;
	u.last = st;
	var now = performance.now();
	(st.hits || []).forEach(function(p){ if(p >= 0) u.flash[p] = now; });
	(st.add || []).forEach(function(a){
		var q = S.seqs[ a.seq ];
		if(q && !q.ev.some(function(e){ return e[0] == a.e[0] && e[1] == a.e[1]; })) q.ev.push( a.e );
	});
	(st.del || []).forEach(function(d){
		var q = S.seqs[ d.seq ];
		if(q) q.ev = q.ev.filter(function(e){ return !(e[0] == d.e[0] && e[1] == d.e[1]); });
	});
	if(st.recorded)
	{
		var r = st.recorded, n = USER.filter(function(x){ return /^SAMPLE \d+$/.test( x.name ); }).length + 1;
		var smp = { l: r.l, r: r.r, sr: r.sr, name: "SAMPLE " + String( n ).padStart( 2, "0" ) };
		SAMPLES[ r.id ] = smp;
		saveSample( r.id, smp );
		assign( S, S.sel, r.id, smp.name );
		u.screen = "trim"; u.cur = 1; u.wave = null;
	}
	if(st.wave) u.wave = st.wave;
}

// ---------------------------------------------------------------------------
// drawing helpers

function T( text, x, y, size, color, align, bold )
{
	ctx.font = (bold === false ? "" : "bold ") + (size || 10) + "px Arial, Helvetica, sans-serif";
	ctx.fillStyle = color || INK;
	ctx.textAlign = align || "center";
	ctx.textBaseline = "middle";
	ctx.fillText( text, x, y );
}

function hot( id, x, y, w, h )
{
	var full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x, y, w, h );
	if(hover) ui.hot = full;
	var clicked = false;
	if(hover && ui.pressed && ui.active === null) { ui.active = full; clicked = true; }
	var kb = keyButton( full, x, y, w, h );
	return { hover: hover, clicked: clicked || kb.pressed, held: (ui.active === full && ui.down) || kb.held, key: kb.pressed };
}

// a key of the case (centre x, top y): grey, or blue, or red; its name under it, an LED over it
function key( id, cx, y, w, h, label, o )
{
	o = o || {};
	var x = cx - w / 2, r = hot( id, x, y, w, h );
	var col = o.color || "#ecebe6", down = r.held ? 2 : 0;
	ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.roundRect( x + 1, y + 3, w, h, 4 ); ctx.fill();
	var g = ctx.createLinearGradient( 0, y, 0, y + h );
	g.addColorStop( 0, shade( col, r.hover ? 0.12 : 0.05 ) ); g.addColorStop( 1, shade( col, -0.12 ) );
	ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect( x, y + down, w, h, 4 ); ctx.fill();
	ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 1; ctx.stroke();
	if(o.inside) T( o.inside, cx, y + h / 2 + down, o.size || 10, o.ink || INK );
	if(label) label.split( "\n" ).forEach(function(l, i){ T( l, cx, y + h + 10 + i * 11, 9, INK ); });
	if(o.led !== undefined) led( cx, y - 8, o.led );
	if(r.hover && o.tip) tip( o.tip, cx, y + h + (label ? 30 : 16) );
	return r;
}

function shade( hex, t )
{
	var n = parseInt( hex.slice( 1 ), 16 ), c = [ n >> 16, (n >> 8) & 255, n & 255 ];
	return "rgb(" + c.map(function(v){ return Math.round( t > 0 ? v + (255 - v) * t : v * (1 + t) ); }).join( "," ) + ")";
}

function led( x, y, on, color )
{
	ctx.fillStyle = on ? (color || "#ff3b2f") : "#7c3a33";
	ctx.beginPath(); ctx.arc( x, y, 3.2, 0, Math.PI * 2 ); ctx.fill();
	if(on) { ctx.fillStyle = "rgba(255,60,40,0.3)"; ctx.beginPath(); ctx.arc( x, y, 7, 0, Math.PI * 2 ); ctx.fill(); }
}

// ---------------------------------------------------------------------------
// the LCD: pages of fields. A field: { id, x, y (pixels in the LCD), label, get, set, fmt, min, max, step, w }

var LX = 520, LY = 62, LW = 520, LH = 196;    // the screen
var CH = 7.8, LINE = 16;                      // a character, a line (13 px monospace)

function lcdText( text, x, y, inv, dim )
{
	ctx.font = "bold 13px 'Courier New', Courier, monospace";
	ctx.textAlign = "left"; ctx.textBaseline = "middle";
	if(inv) { ctx.fillStyle = LCD_INK; ctx.fillRect( LX + x - 1, LY + y - 7, text.length * CH + 2, 14 ); }
	ctx.fillStyle = inv ? LCD_BG : (dim ? LCD_DIM : LCD_INK);
	ctx.fillText( text, LX + x, LY + y );
}

function num( id, label, x, y, get, set, min, max, step, fmt, w )
{
	return { id: id, label: label, x: x, y: y, get: get, set: set, min: min, max: max, step: step || 1, fmt: fmt || String, w: w || 6 };
}
function list( id, label, x, y, get, set, names, w )
{
	return { id: id, label: label, x: x, y: y, get: function(){ return Math.max( 0, names.indexOf( get() ) ); }, set: function(i){ set( names[i] ); },
		min: 0, max: names.length - 1, step: 1, fmt: function(i){ return names[i]; }, w: w || 8 };
}
function padField( x, y, label )
{
	return num( "pad", label || "PAD:", x, y, function(){ return S.sel; }, function(v){ S.sel = v; uiOf().wave = null; }, 0, 63, 1, function(v){ return padName( v ) + " " + (S.pads[v].name || "(EMPTY)").substr( 0, 14 ); }, 18 );
}
function pctField( id, label, x, y, obj, key, fmt )
{
	return num( id, label, x, y, function(){ return Math.round( obj[key] * 100 ); }, function(v){ obj[key] = v / 100; }, 0, 100, 1, fmt || function(v){ return String( v ).padStart( 3 ); }, 4 );
}

// the sample list for PROGRAM and LOAD: none, the factory kit, the user's
function sampleList() { return [""].concat( FACTORY.map(function(n){ return "f:" + n; }), USER.map(function(x){ return x.id; }) ); }
function sampleName( id )
{
	if(!id) return "(NONE)";
	if(id.charAt( 0 ) == "f") return id.substr( 2 );
	var x = USER.find(function(u){ return u.id == id; });
	return x ? x.name : "(NOT HERE)";
}

function fields( u )
{
	var p = S.pads[ S.sel ], q = seq();
	switch(u.screen)
	{
		case "main": return [
			num( "seq", "SEQ:", 8, 40, function(){ return S.seq; }, function(v){ S.seq = v; }, 0, 15, 1, function(v){ return String( v + 1 ).padStart( 2, "0" ) + (S.seqs[v].ev.length ? " (" + S.seqs[v].ev.length + " EV)" : " (EMPTY)"); }, 14 ),
			num( "bars", "BARS:", 280, 40, function(){ return q.bars; }, function(v){ q.bars = v; q.ev = q.ev.filter(function(e){ return e[0] < v * BAR; }); }, 1, 16, 1, function(v){ return String( v ).padStart( 2 ); }, 2 ),
			num( "tempo", "TEMPO:", 8, 58, function(){ return S.tempo; }, function(v){ S.tempo = v; }, 30, 300, 1, function(v){ return v.toFixed( 1 ).padStart( 5 ); }, 5 ),
			list( "tc", "TIMING CORRECT:", 8, 76, function(){ return S.tc; }, function(v){ S.tc = v; }, TCS, 5 ),
			num( "swing", "SWING:", 280, 76, function(){ return S.swing; }, function(v){ S.swing = v; }, 50, 75, 1, function(v){ return v + "%"; }, 3 ),
			list( "click", "CLICK:", 8, 94, function(){ return S.click; }, function(v){ S.click = v; }, ["OFF", "REC", "ON"], 3 ),
			list( "levels", "16 LEVELS:", 8, 112, function(){ return S.levels; }, function(v){ S.levels = v; }, ["VELOCITY", "TUNE"], 8 ),
			list( "nv", "NOTE VAR:", 280, 112, function(){ return S.nv; }, function(v){ S.nv = v; }, NV, 6 ),
			padField( 8, 130 )
		];
		case "program": return [
			padField( 8, 30 ),
			num( "smp", "SAMPLE:", 8, 48, function(){ return Math.max( 0, sampleList().indexOf( p.s ) ); }, function(i){ var id = sampleList()[i]; p.s = id; p.name = id ? sampleName( id ) : ""; p.start = 0; p.end = 1; u.wave = null; },
				0, sampleList().length - 1, 1, function(i){ return sampleName( sampleList()[i] ).substr( 0, 16 ); }, 16 ),
			num( "tune", "TUNE:", 8, 66, function(){ return Math.round( p.tune ); }, function(v){ p.tune = v + (p.tune - Math.round( p.tune )); }, -24, 24, 1, function(v){ return (v > 0 ? "+" : "") + v; }, 3 ),
			num( "fine", "FINE:", 150, 66, function(){ return Math.round( (p.tune - Math.round( p.tune )) * 100 ); }, function(v){ p.tune = Math.round( p.tune ) + v / 100; }, -50, 50, 1, function(v){ return (v > 0 ? "+" : "") + v; }, 3 ),
			pctField( "level", "LEVEL:", 280, 66, p, "level" ),
			num( "pan", "PAN:", 400, 66, function(){ return Math.round( p.pan * 50 ); }, function(v){ p.pan = v / 50; }, -50, 50, 1, function(v){ return v == 0 ? "MID" : (v < 0 ? "L" + (-v) : "R" + v); }, 3 ),
			pctField( "attack", "ATTACK:", 8, 84, p, "attack" ),
			pctField( "decay", "DECAY:", 150, 84, p, "decay", function(v){ return v >= 100 ? "FULL" : String( v ).padStart( 3 ); } ),
			list( "mode", "MODE:", 280, 84, function(){ return p.mode; }, function(v){ p.mode = v; }, ["oneshot", "noteon"], 8 ),
			pctField( "cutoff", "CUTOFF:", 8, 102, p, "cutoff", function(v){ return v >= 100 ? "OPEN" : String( v ).padStart( 3 ); } ),
			pctField( "reso", "RESO:", 150, 102, p, "reso" ),
			num( "group", "MUTE GRP:", 280, 102, function(){ return p.group; }, function(v){ p.group = v; }, 0, 8, 1, function(v){ return v ? String( v ) : "OFF"; }, 3 ),
			pctField( "vel", "VEL SENS:", 8, 120, p, "vel" ),
			list( "rev", "REVERSE:", 280, 120, function(){ return p.rev ? "ON" : "OFF"; }, function(v){ p.rev = v == "ON"; }, ["OFF", "ON"], 3 )
		];
		case "sample": return [
			padField( 8, 30, "TO PAD:" ),
			list( "stereo", "MODE:", 8, 48, function(){ return S.stereo ? "STEREO" : "MONO"; }, function(v){ S.stereo = v == "STEREO"; }, ["MONO", "STEREO"], 6 ),
			num( "thresh", "THRESHOLD:", 200, 48, function(){ return S.thresh; }, function(v){ S.thresh = v; }, -60, 0, 1, function(v){ return v + " dB"; }, 6 ),
			num( "max", "MAX TIME:", 8, 66, function(){ return S.max_time; }, function(v){ S.max_time = v; }, 1, 30, 1, function(v){ return v + " S"; }, 4 ),
			num( "gain", "GAIN:", 360, 66, function(){ return Math.round( 20 * Math.log10( Math.max( S.rec_gain, 1e-4 ) ) ); }, function(v){ S.rec_gain = Math.pow( 10, v / 20 ); }, -24, 12, 1, function(v){ return (v > 0 ? "+" : "") + v + " dB"; }, 6 ),
			list( "mon", "MONITOR:", 200, 66, function(){ return S.monitor ? "ON" : "OFF"; }, function(v){ S.monitor = v == "ON"; }, ["OFF", "ON"], 3 )
		];
		case "trim": return [
			padField( 8, 30 ),
			num( "start", "ST:", 8, 152, function(){ return Math.round( p.start * 1000 ); }, function(v){ p.start = Math.min( v / 1000, p.end - 0.001 ); }, 0, 999, 1, function(v){ return (v / 10).toFixed( 1 ).padStart( 5 ) + "%"; }, 6 ),
			num( "end", "END:", 130, 152, function(){ return Math.round( p.end * 1000 ); }, function(v){ p.end = Math.max( v / 1000, p.start + 0.001 ); }, 1, 1000, 1, function(v){ return (v / 10).toFixed( 1 ).padStart( 5 ) + "%"; }, 6 ),
			list( "rev", "REV:", 262, 152, function(){ return p.rev ? "ON" : "OFF"; }, function(v){ p.rev = v == "ON"; }, ["OFF", "ON"], 3 ),
			num( "chop", "CHOP:", 360, 152, function(){ return [2, 4, 8, 16].indexOf( S.chop ); }, function(i){ S.chop = [2, 4, 8, 16][i]; }, 0, 3, 1, function(i){ return String( [2, 4, 8, 16][i] ).padStart( 2 ); }, 2 )
		];
		case "load": return [
			num( "list", "", 8, 22, function(){ return u.list; }, function(v){ u.list = v; }, 0, sampleList().length - 1, 1, function(){ return ""; }, 0 )
		];
		case "grid": return [
			num( "gbar", "BAR:", 8, 30, function(){ return u.gridBar; }, function(v){ u.gridBar = v; }, 0, q.bars - 1, 1, function(v){ return String( v + 1 ).padStart( 2, "0" ) + "/" + String( q.bars ).padStart( 2, "0" ); }, 5 )
		];
	}
	return [];
}

// a field: drawn, selected with a click, changed by dragging it up and down
function drawField( f, i, u )
{
	var sel = u.cur == i, lw = f.label.length * CH + (f.label ? CH * 0.5 : 0), v = f.get(), txt = f.fmt( v );
	if(f.label) lcdText( f.label, f.x, f.y, false, false );
	lcdText( txt, f.x + lw, f.y, sel, false );
	var x = LX + f.x, w = lw + Math.max( txt.length, 2 ) * CH, id = "fld_" + u.screen + "_" + f.id, full = id_prefix + id;
	var r = hot( id, x - 2, LY + f.y - 8, w + 4, 16 );
	if(r.clicked) { u.cur = i; u.dragY = ui.y; u.dragV = v; }
	if(ui.active === full && ui.down)
	{
		var nv = Math.max( f.min, Math.min( f.max, u.dragV + Math.round( (u.dragY - ui.y) / 5 ) * f.step ) );
		if(nv != v) f.set( nv );
	}
}

function nudge( u, d )
{
	var fs = fields( u ), f = fs[ u.cur ];
	if(!f) return;
	var v = f.get(), nv = Math.max( f.min, Math.min( f.max, v + d * f.step ) );
	if(nv != v) f.set( nv );
}

function drawLcd()
{
	var u = uiOf();
	ctx.fillStyle = "#000"; ctx.beginPath(); ctx.roundRect( LX - 10, LY - 8, LW + 20, LH + 16, 6 ); ctx.fill();
	ctx.fillStyle = LCD_BG; ctx.fillRect( LX, LY, LW, LH );
	ctx.save(); ctx.beginPath(); ctx.rect( LX, LY, LW, LH ); ctx.clip();
	var st = ST || {}, playing = st.playing;
	// the title line: page, transport, position
	var title = SCREENS.find(function(x){ return x[0] == u.screen; })[1];
	ctx.fillStyle = LCD_HI; ctx.fillRect( LX + 3, LY + 2, title.length * CH + 10, 14 );
	ctx.font = "bold 13px 'Courier New', Courier, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
	ctx.fillStyle = LCD_BG; ctx.fillText( title, LX + 8, LY + 9 );
	var tr = playing ? (u.rec ? "● REC" : (u.od ? "● ODUB" : "▶ PLAY")) : (u.rec ? "REC READY" : (u.od ? "ODUB READY" : "■ STOP"));
	ctx.fillStyle = playing && (u.rec || u.od) ? "#ff5a4f" : (playing ? "#5fd36a" : LCD_INK); ctx.fillText( tr, LX + 170, LY + 9 );
	ctx.fillStyle = "#ff5a4f"; ctx.fillText( fmtPos( st.tick || 0 ), LX + LW - 13 * CH, LY + 9 );
	ctx.fillStyle = LCD_DIM; ctx.fillRect( LX, LY + 18, LW, 1 );

	var fs = fields( u );
	if(u.cur >= fs.length) u.cur = 0;
	fs.forEach(function(f, i){ drawField( f, i, u ); });

	if(u.screen == "main") drawTimeline( st );
	else if(u.screen == "sample") drawMeters( st );
	else if(u.screen == "trim") drawTrim( u );
	else if(u.screen == "load") drawLoad( u );
	else if(u.screen == "grid") drawGrid( u, st );

	// the three keys' names: F4-F6 with SHIFT
	var soft = softKeys( u ), off = u.shift ? 3 : 0;
	for(var i = 0; i < 3; ++i)
	{
		var k = soft[ i + off ], x = 10 + i * 172, w = 156;
		ctx.fillStyle = k ? "#22324a" : "rgba(255,255,255,0.04)"; ctx.fillRect( LX + x, LY + LH - 17, w, 15 );
		if(!k) continue;
		ctx.font = "bold 12px 'Courier New', Courier, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.fillStyle = LCD_INK; ctx.fillText( k[0], LX + x + w / 2, LY + LH - 9 );
	}
	ctx.restore();
	// the keys over the screen
	for(var i = 0; i < 3; ++i)
	{
		var k = soft[ i + off ];
		if(key( "f" + (i + 1), LX + 10 + i * 172 + 78, 16, 84, 26, "", { color: "#1b1b1c", tip: k ? k[0] : "(SHIFT: THE OTHER THREE)" } ).clicked && k) { k[1](); u.shift = false; }
	}
}

// MAIN: the sequence as a strip, its events, the playhead
function drawTimeline( st )
{
	var q = seq(), x0 = LX + 8, y0 = LY + 146, w = LW - 16, h = 26, L = q.bars * BAR;
	ctx.strokeStyle = LCD_INK; ctx.lineWidth = 1; ctx.strokeRect( x0 + 0.5, y0 + 0.5, w, h );
	ctx.fillStyle = LCD_DIM;
	for(var b = 1; b < q.bars; ++b) ctx.fillRect( x0 + b * BAR / L * w, y0, 1, h );
	ctx.fillStyle = LCD_INK;
	q.ev.forEach(function(e){ ctx.fillRect( x0 + e[0] / L * w, y0 + 3 + ((e[1] & 15) / 16) * (h - 6), 2, 2 ); });
	if(st.tick !== undefined) { ctx.fillRect( x0 + (st.tick % L) / L * w, y0 - 2, 2, h + 4 ); }
}

// SAMPLE: the input level, and the recording
function drawMeters( st )
{
	var pk = st.peak || [0, 0];
	["L", "R"].forEach(function(c, i){
		var y = LY + 92 + i * 18, x0 = LX + 30, w = LW - 60;
		lcdText( c, 10, 92 + i * 18, false );
		ctx.strokeStyle = LCD_INK; ctx.strokeRect( x0 + 0.5, y - 6.5, w, 12 );
		var db = 20 * Math.log10( Math.max( 1e-5, pk[i] ) ), n = Math.max( 0, Math.min( 1, (db + 60) / 60 ) );
		ctx.fillStyle = LCD_INK; ctx.fillRect( x0 + 2, y - 4, (w - 4) * n, 8 );
		var tx = x0 + (S.thresh + 60) / 60 * w;
		ctx.fillRect( tx, y - 9, 2, 18 );
	});
	var msg = st.rec == "armed" ? "WAITING FOR THE SIGNAL (OVER THE THRESHOLD)..." : (st.rec == "recording" ? "RECORDING " + (st.recT || 0).toFixed( 1 ) + " S" :
		"CABLE AUDIO TO IN L / R ON THE BACK, THEN SAMPLE RECORD");
	lcdText( msg, 8, 136, st.rec == "recording" );
}

// TRIM: the sample's shape, the slice played
function drawTrim( u )
{
	var p = S.pads[ S.sel ], x0 = LX + 8, y0 = LY + 42, w = LW - 16, h = 98;
	ctx.strokeStyle = LCD_INK; ctx.lineWidth = 1; ctx.strokeRect( x0 + 0.5, y0 + 0.5, w, h );
	if(!p.s) { lcdText( "NO SAMPLE ON THIS PAD", 150, 86, false ); return; }
	if(!u.wave || u.wave.id != p.s) { if(!u.waveAsked || u.waveAsked != p.s || performance.now() - u.waveT > 1000) { u.waveAsked = p.s; u.waveT = performance.now(); send({ type: "wave", id: p.s }); } return; }
	var pk = u.wave.peaks, N = pk ? pk.length / 2 : 0, cy = y0 + h / 2;
	if(pk)
	{
		ctx.fillStyle = LCD_INK;
		for(var c = 0; c < N; ++c) { var x = x0 + c / N * w, a = pk[c * 2], b = pk[c * 2 + 1]; ctx.fillRect( x, cy - b * h / 2, Math.max( 1, w / N ), Math.max( 1, (b - a) * h / 2 ) ); }
	}
	// outside the slice: dimmed
	ctx.fillStyle = "rgba(14,23,38,0.72)";
	ctx.fillRect( x0, y0, p.start * w, h ); ctx.fillRect( x0 + p.end * w, y0, (1 - p.end) * w, h );
	ctx.fillStyle = LCD_INK; ctx.fillRect( x0 + p.start * w, y0, 2, h ); ctx.fillRect( x0 + p.end * w - 2, y0, 2, h );
	if(u.wave.len) lcdText( (u.wave.len * (p.end - p.start)).toFixed( 3 ) + " S", LW - 90, 30, false );
	// click or drag in the shape: the nearest marker follows
	var r = hot( "trimwave", x0, y0, w, h ), full = id_prefix + "trimwave";
	if(r.clicked) u.trimEnd = Math.abs( (ui.x - x0) / w - p.end ) < Math.abs( (ui.x - x0) / w - p.start );
	if(ui.active === full && ui.down)
	{
		var f = Math.max( 0, Math.min( 1, (ui.x - x0) / w ) );
		if(u.trimEnd) p.end = Math.max( p.start + 0.001, f ); else p.start = Math.min( p.end - 0.001, f );
	}
}

// LOAD: the samples, the factory kit then the user's
function drawLoad( u )
{
	var ids = sampleList(), rows = 7, top = Math.max( 0, Math.min( u.list - 3, ids.length - rows ) );
	for(var i = 0; i < rows && top + i < ids.length; ++i)
	{
		var id = ids[ top + i ], y = 36 + i * 16;
		var tag = !id ? "" : (id.charAt( 0 ) == "f" ? "FACTORY" : "USER " + (USER.find(function(x){ return x.id == id; }) || { len: 0 }).len.toFixed( 1 ) + "S");
		lcdText( (" " + sampleName( id )).padEnd( 22 ) + tag.padEnd( 12 ), 8, y, u.list == top + i );
		var r = hot( "loadrow" + i, LX + 6, LY + y - 8, LW - 12, 16 );
		if(r.clicked) u.list = top + i;
	}
	lcdText( "TO PAD " + padName( S.sel ) + "   DROP AUDIO FILES ON THE PADS", 8, 160, false, true );
}

// GRID: the bank's 16 pads by the 16 steps of a bar
function drawGrid( u, st )
{
	var q = seq(), bar = Math.min( u.gridBar, q.bars - 1 ), x0 = LX + 40, y0 = LY + 40, cw = (LW - 48) / 16, rh = 8;
	var bank = S.bank << 4;
	for(var r = 0; r < 16; ++r)
	{
		var p = bank + r, y = y0 + (15 - r) * rh;
		ctx.font = "bold 8px 'Courier New', monospace"; ctx.textAlign = "right"; ctx.fillStyle = p == S.sel ? LCD_INK : LCD_DIM;
		ctx.fillText( padName( p ), x0 - 3, y + rh / 2 );
		for(var c = 0; c < 16; ++c)
		{
			var t0 = bar * BAR + c * 24;
			var on = q.ev.some(function(e){ return e[1] == p && e[0] >= t0 && e[0] < t0 + 24; });
			var x = x0 + c * cw;
			ctx.fillStyle = on ? LCD_HI : (c % 4 == 0 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.07)");
			ctx.fillRect( x + 1, y + 1, cw - 2, rh - 2 );
			var hr = hot( "grid_" + r + "_" + c, x, y, cw, rh );
			if(hr.clicked)
			{
				u.undo = { seq: S.seq, ev: q.ev.slice() };
				if(on) q.ev = q.ev.filter(function(e){ return !(e[1] == p && e[0] >= t0 && e[0] < t0 + 24); });
				else q.ev.push([ t0, p, 0.8, null ]);
				S.sel = p;
			}
		}
	}
	if(st.tick !== undefined && Math.floor( st.tick / BAR ) == bar)
	{
		ctx.fillStyle = "rgba(255,255,255,0.5)";
		ctx.fillRect( x0 + (st.tick % BAR) / BAR * (LW - 48), y0, 2, 16 * rh );
	}
}

function softKeys( u )
{
	var p = S.pads[ S.sel ], q = seq();
	switch(u.screen)
	{
		case "main": return [
			["SEQ -", function(){ S.seq = (S.seq + 15) % 16; }], ["SEQ +", function(){ S.seq = (S.seq + 1) % 16; }], null,
			["CLR SEQ", function(){ if(!q.ev.length || W_confirm( "Clear sequence " + (S.seq + 1) + " (" + q.ev.length + " events)?" )) { u.undo = { seq: S.seq, ev: q.ev }; q.ev = []; } }],
			["COPY", function(){ var n = S.seqs.findIndex(function(x, i){ return i > S.seq && !x.ev.length; }); if(n < 0) return; S.seqs[n] = JSON.parse( JSON.stringify( q ) ); S.seq = n; }],
			["CLR PAD", function(){ u.undo = { seq: S.seq, ev: q.ev }; q.ev = q.ev.filter(function(e){ return e[1] != S.sel; }); }]
		];
		case "program": return [
			["PLAY", function(){ audition( S.sel ); }], ["PAD -", function(){ S.sel = (S.sel + 63) % 64; }], ["PAD +", function(){ S.sel = (S.sel + 1) % 64; }],
			["COPY", function(){ u.clip = JSON.parse( JSON.stringify( p ) ); }],
			["PASTE", function(){ if(u.clip) S.pads[ S.sel ] = JSON.parse( JSON.stringify( u.clip ) ); }],
			["CLEAR", function(){ S.pads[ S.sel ] = padDefaults( "" ); }]
		];
		case "sample": return [
			["MONITOR", function(){ S.monitor = !S.monitor; }], null, null, null,
			["STOP", function(){ send({ type: "recStop" }); }],
			[(ST && ST.rec != "idle" ? "ARMED" : "REC"), function(){ send({ type: "recArm", id: newId(), max: S.max_time, stereo: S.stereo }); }]
		];
		case "trim": return [
			["PLAY", function(){ audition( S.sel ); }], null, null,
			["FULL", function(){ p.start = 0; p.end = 1; }], null,
			["CHOP", function(){ chop( u ); }]
		];
		case "load": return [
			["PLAY", function(){ var id = sampleList()[ u.list ]; if(id) { u.preview = id; send({ type: "preview", id: id }); } }], null, null,
			["DELETE", function(){ var id = sampleList()[ u.list ]; if(id && id.charAt( 0 ) == "u" && W_confirm( "Delete " + sampleName( id ) + " from this browser?" )) deleteSample( id ); }], null,
			["ASSIGN", function(){ var id = sampleList()[ u.list ]; assign( S, S.sel, id, id ? sampleName( id ) : "" ); }]
		];
		case "grid": return [
			["< BAR", function(){ u.gridBar = Math.max( 0, u.gridBar - 1 ); }], ["BAR >", function(){ u.gridBar = Math.min( q.bars - 1, u.gridBar + 1 ); }], null,
			["CLR BAR", function(){ var b = u.gridBar; u.undo = { seq: S.seq, ev: q.ev }; q.ev = q.ev.filter(function(e){ return e[0] < b * BAR || e[0] >= (b + 1) * BAR; }); }], null, null
		];
	}
	return [];
}
function W_confirm( text ) { return window.confirm( text ); }

// the selected pad's slice, cut in CHOP parts onto it and the pads after it
function chop( u )
{
	var p = S.pads[ S.sel ], n = S.chop, a = p.start, len = (p.end - p.start) / n;
	if(!p.s) return;
	for(var i = 0; i < n && S.sel + i < 64; ++i)
	{
		var q = JSON.parse( JSON.stringify( p ) );
		q.start = a + i * len; q.end = a + (i + 1) * len;
		q.name = (p.name.substr( 0, 12 ) + " " + (i + 1));
		S.pads[ S.sel + i ] = q;
	}
	if(window.setStatus) setStatus( "CRATE 60: " + n + " slices on pads " + padName( S.sel ) + " to " + padName( Math.min( 63, S.sel + n - 1 ) ) );
}

function audition( p ) { send({ type: "pad", pad: p, vel: 0.9, on: true }); var id = M.id; setTimeout(function(){ rack.postModule( id, { type: "pad", pad: p, on: false } ); }, 300); }

// ---------------------------------------------------------------------------
// the controls

// the DATA encoder: drag it (up / down), or the mouse wheel over it. SHIFT + DATA: the field
function drawWheel( cx, cy, r )
{
	var u = uiOf(), id = "data", full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitCircle( cx, cy, r );
	if(hover) ui.hot = full;
	if(hover && ui.pressed && ui.active === null) { ui.active = full; u.wy = ui.y; }
	var turn = function(d){
		if(u.shift) { var n = Math.max( 1, fields( u ).length ); u.cur = ((u.cur + d) % n + n) % n; }
		else nudge( u, d );
		u.wheelAng += d * 0.25;
	};
	if(ui.active === full && ui.down)
	{
		var steps = Math.trunc( (u.wy - ui.y) / 6 );
		if(steps) { turn( steps ); u.wy -= steps * 6; }
	}
	if(hover && ui.wheel && ui.active === null) { turn( -ui.wheel ); ui.wheel = 0; }
	if(hover) tip( "DATA: TURN THE FIELD (DRAG OR WHEEL). SHIFT + DATA: ANOTHER FIELD", cx, cy + r + 18 );
	ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc( cx + 2, cy + 5, r, 0, Math.PI * 2 ); ctx.fill();
	// a ribbed skirt, a smooth cap
	ctx.fillStyle = "#cfcfca"; ctx.beginPath(); ctx.arc( cx, cy, r, 0, Math.PI * 2 ); ctx.fill();
	ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 1.5;
	for(var i = 0; i < 40; ++i) { var a = u.wheelAng + i * Math.PI / 20; ctx.beginPath(); ctx.moveTo( cx + Math.cos( a ) * r * 0.8, cy + Math.sin( a ) * r * 0.8 ); ctx.lineTo( cx + Math.cos( a ) * r, cy + Math.sin( a ) * r ); ctx.stroke(); }
	var g = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 0.78 );
	g.addColorStop( 0, "#ffffff" ); g.addColorStop( 1, hover ? "#deded9" : "#d2d2cd" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy, r * 0.76, 0, Math.PI * 2 ); ctx.fill();
	var a = u.wheelAng - Math.PI / 2;
	ctx.fillStyle = "#8a8a86"; ctx.beginPath(); ctx.arc( cx + Math.cos( a ) * r * 0.55, cy + Math.sin( a ) * r * 0.55, r * 0.08, 0, Math.PI * 2 ); ctx.fill();
	T( "DATA", cx, cy + r + 12, 9, INK );
}

// a key with its SHIFT function printed under it (centre x, top y)
function skey( id, cx, y, w, h, label, sub, o )
{
	o = o || {};
	var r = key( id, cx, y, w, h, "", { color: o.color || "#5b5c5f", inside: label, ink: o.ink || "#f2f2ef", size: o.size || 9, tip: o.tip } );
	if(o.stripe) { ctx.fillStyle = o.stripe; ctx.fillRect( cx - w / 2 + 8, y + h - 7 + (r.held ? 2 : 0), w - 16, 3 ); }
	if(o.led !== undefined) led( cx + w / 2 - 7, y + 6 + (r.held ? 2 : 0), o.led, o.ledColor );
	if(sub) T( sub, cx, y + h + 10, 8, uiOf().shift ? RED : INK );
	return r;
}

function drawControls()
{
	var u = uiOf(), st = ST || {}, q = seq(), sh = u.shift;
	var go = function(screen){ u.screen = screen; u.cur = 0; };

	// MODE
	T( "MODE", 180, 290, 9, DIM );
	var modes = [
		["k_sample", 120, 300, "SAMPLE", "LOAD", null, function(){ go( sh ? "load" : "sample" ); }],
		["k_seq", 245, 300, "SEQ", "STEP EDIT", null, function(){ go( sh ? "grid" : "main" ); }],
		["k_program", 120, 368, "PROGRAM", "COPY PAD", "#ef7b2d", function(){ if(sh) u.clip = JSON.parse( JSON.stringify( S.pads[ S.sel ] ) ); else go( "program" ); }],
		["k_trim", 245, 368, "TRIM", "PASTE PAD", "#ef7b2d", function(){ if(sh) { if(u.clip) S.pads[ S.sel ] = JSON.parse( JSON.stringify( u.clip ) ); } else go( "trim" ); }],
		["k_load", 120, 436, "SAMPLE\nSELECT", "SAVE AS NEW", null, function(){ go( "load" ); }],
		["k_bank", 245, 436, "PAD BANK", "BANK -", null, function(){ S.bank = (S.bank + (sh ? 3 : 1)) % 4; }]
	];
	modes.forEach(function(m){
		var on = (m[0] == "k_sample" && (u.screen == "sample" || u.screen == "load")) || (m[0] == "k_seq" && (u.screen == "main" || u.screen == "grid")) ||
			(m[0] == "k_program" && u.screen == "program") || (m[0] == "k_trim" && u.screen == "trim");
		if(m[0] == "k_load") return;
		if(skey( m[0], m[1], m[2], 104, 32, m[3], m[4], { color: m[5] || "#5b5c5f", led: m[0] == "k_bank" ? undefined : on, ledColor: "#7dff8a" } ).clicked) { m[6](); u.shift = false; }
	});
	if(skey( "shift", 120, 436, 104, 32, "SHIFT", "", { color: "#2e2f31", led: sh, ledColor: "#ffffff", tip: "SHIFT: CLICK IT, THEN A KEY FOR THE FUNCTION UNDER IT (OR HOLD IT)" } ).clicked) u.shift = !u.shift;

	// the NOTE VARIATION fader in its recess, its ASSIGN key and LED
	ctx.fillStyle = "#c2c1bb"; ctx.beginPath(); ctx.roundRect( 140, 512, 84, 236, 8 ); ctx.fill();
	ctx.fillStyle = "#b3b2ac"; ctx.fillRect( 150, 522, 64, 216 );
	S.nv_val = fader( "nv_val", 182, 540, 180, S.nv_val, { def: 0.5 } );
	led( 236, 540, S.nv != "OFF", "#ffffff" );
	if(key( "nv_assign", 280, 530, 64, 20, "", { inside: S.nv == "OFF" ? "ASSIGN" : S.nv, size: 8, color: "#5b5c5f", ink: "#f2f2ef", tip: "WHAT THE FADER CHANGES ON THE PADS: OFF, TUNE, DECAY, ATTACK, FILTER" } ).clicked)
		S.nv = NV[ (NV.indexOf( S.nv ) + 1) % NV.length ];
	T( "NOTE VAR", 280, 566, 8, INK ); T( nvText(), 280, 580, 8, RED );

	// ERASE, NOTE REPEAT
	var er = skey( "erase", 120, 800, 104, 32, "ERASE", "COPY SEQ", { tip: "HOLD IT AND PADS WHILE PLAYING: THEIR NOTES GO. STOPPED: CLEARS THE SELECTED PAD. SHIFT: COPY THE SEQUENCE TO THE NEXT EMPTY ONE" } );
	if(sh && er.clicked) { var n = S.seqs.findIndex(function(x, i){ return i > S.seq && !x.ev.length; }); if(n >= 0) { S.seqs[n] = JSON.parse( JSON.stringify( q ) ); S.seq = n; } u.shift = false; }
	else
	{
		if(!!er.held != !!u.erase) { u.erase = !!er.held; send({ type: "erase", on: u.erase }); if(u.erase && st.playing) u.undo = { seq: S.seq, ev: q.ev.slice() }; }
		if(er.clicked && !st.playing) { u.undo = { seq: S.seq, ev: q.ev }; q.ev = q.ev.filter(function(e){ return e[1] != S.sel; }); }
	}
	var triplet = /T$/.test( S.tc );
	var nr = skey( "repeat", 245, 800, 104, 32, "NOTE\nREPEAT", "TRIPLET", { led: !!u.repeat || triplet, ledColor: triplet ? "#ffb02f" : undefined, tip: "HOLD IT AND A PAD: THE PAD REPEATS AT TIMING CORRECT. SHIFT: TRIPLETS ON / OFF" } );
	if(sh && nr.clicked) { var tri = { "1/8": "1/8T", "1/8T": "1/8", "1/16": "1/16T", "1/16T": "1/16", "1/32": "1/16T", "OFF": "1/16T" }; S.tc = tri[ S.tc ]; u.shift = false; }
	else if(!!nr.held != !!u.repeat) { u.repeat = !!nr.held; send({ type: "repeat", on: u.repeat }); }

	// K1-K3: the selected pad's TUNE, CUTOFF, DECAY
	var p = S.pads[ S.sel ];
	[["k1", "K1 TUNE", 640], ["k2", "K2 CUTOFF", 802], ["k3", "K3 DECAY", 964]].forEach(function(k, i){
		ctx.fillStyle = "#c9c8c2"; ctx.beginPath(); ctx.arc( k[2], 304, 34, 0, Math.PI * 2 ); ctx.fill();
		if(i == 0) p.tune = knob( k[0], k[2], 304, 24, p.tune, -24, 24, { bipolar: true, def: 0, format: function(v){ return padName( S.sel ) + " TUNE " + (v > 0 ? "+" : "") + v.toFixed( 2 ); } } );
		else if(i == 1) p.cutoff = knob( k[0], k[2], 304, 24, p.cutoff, 0, 1, { def: 1, format: function(v){ return padName( S.sel ) + " CUTOFF " + (v >= 0.995 ? "OPEN" : Math.round( v * 100 )); } } );
		else p.decay = knob( k[0], k[2], 304, 24, p.decay, 0, 1, { def: 1, format: function(v){ return padName( S.sel ) + " DECAY " + (v >= 0.999 ? "FULL" : Math.round( v * 100 )); } } );
		T( k[1], k[2], 350, 9, INK );
	});

	// PAD PLAY
	ctx.fillStyle = INK; ctx.fillRect( 1100, 290, 300, 1 );
	T( "PAD PLAY", 1250, 290, 9, INK );
	ctx.fillStyle = CASE; ctx.fillRect( 1218, 284, 64, 12 ); T( "PAD PLAY", 1250, 290, 9, INK );
	var BL = "#3d8fd6";
	var c = skey( "chop", 1165, 302, 120, 32, "CHOP", "NOTE ON", { color: BL, led: p.mode == "noteon", tip: "CHOP: THE TRIM PAGE, TO CUT THE PAD'S SAMPLE. SHIFT: NOTE ON (THE PAD PLAYS WHILE HELD)" } );
	if(c.clicked) { if(sh) p.mode = p.mode == "noteon" ? "oneshot" : "noteon"; else go( "trim" ); u.shift = false; }
	var mu = skey( "mute", 1325, 302, 120, 32, "MUTE", "UNMUTE ALL", { color: BL, led: !!p.mute, tip: "MUTE: THE SELECTED PAD STAYS SILENT. SHIFT: EVERY PAD BACK" } );
	if(mu.clicked) { if(sh) S.pads.forEach(function(x){ x.mute = false; }); else p.mute = !p.mute; u.shift = false; }
	var lp = skey( "loop", 1165, 368, 120, 32, "LOOP", "REVERSE", { color: BL, led: sh ? !!p.rev : !!p.loop, tip: "LOOP: THE PAD LOOPS ITS PART WHILE HELD (NOTE ON). SHIFT: REVERSE" } );
	if(lp.clicked) { if(sh) p.rev = !p.rev; else { p.loop = !p.loop; if(p.loop) p.mode = "noteon"; } u.shift = false; }
	var lv = skey( "levels", 1325, 368, 120, 32, "16 LEVELS", "TYPE: " + S.levels, { color: BL, led: u.levels, tip: "16 LEVELS: THE SELECTED PAD ON ALL 16 PADS. SHIFT: BY VELOCITY OR BY TUNE" } );
	if(lv.clicked) { if(sh) S.levels = S.levels == "TUNE" ? "VELOCITY" : "TUNE"; else { u.levels = !u.levels; u.levelsPad = S.sel; } u.shift = false; }

	// SAMPLE SELECT, TAP TEMPO
	if(skey( "k_select", 1165, 442, 120, 32, "SAMPLE\nSELECT", "SAVE SAMPLE", { tip: "THE LOAD PAGE: THE SAMPLES TO PUT ON THE PAD" } ).clicked) { go( "load" ); u.shift = false; }
	var tp = skey( "tap", 1325, 442, 120, 32, "TAP TEMPO", "METRO: " + S.click, { tip: "TAP THE BEAT: THE TEMPO FOLLOWS. SHIFT: THE CLICK (OFF, WHILE RECORDING, ALWAYS)" } );
	if(tp.clicked)
	{
		if(sh) { S.click = { "OFF": "REC", "REC": "ON", "ON": "OFF" }[ S.click ]; u.shift = false; }
		else
		{
			var now = performance.now();
			u.taps = u.taps.filter(function(t){ return now - t < 2500; }).concat([ now ]);
			if(u.taps.length >= 2) { var d = (u.taps[ u.taps.length - 1 ] - u.taps[0]) / (u.taps.length - 1); S.tempo = Math.max( 30, Math.min( 300, Math.round( 600000 / d ) / 10 ) ); }
		}
	}

	// DATA, the field arrows, - / +
	drawWheel( 1470, 470, 54 );
	if(key( "cur_up", 1440, 550, 28, 20, "", { inside: "▲", size: 9, tip: "THE FIELD BEFORE" } ).clicked) { var n1 = Math.max( 1, fields( u ).length ); u.cur = (u.cur + n1 - 1) % n1; }
	if(key( "cur_dn", 1500, 550, 28, 20, "", { inside: "▼", size: 9, tip: "THE NEXT FIELD" } ).clicked) { var n2 = Math.max( 1, fields( u ).length ); u.cur = (u.cur + 1) % n2; }
	var undo = function(){ if(u.undo) { var cur = S.seqs[ u.undo.seq ].ev; S.seqs[ u.undo.seq ].ev = u.undo.ev; u.undo = { seq: u.undo.seq, ev: cur }; } };
	if(skey( "minus", 1165, 520, 120, 32, "−", "UNDO", { size: 16, tip: "THE FIELD -1. SHIFT: UNDO (THE SEQUENCE BEFORE THE LAST RECORDING OR EDIT)" } ).clicked) { if(sh) undo(); else nudge( u, -1 ); u.shift = false; }
	if(skey( "plus", 1325, 520, 120, 32, "+", "REDO", { size: 16, tip: "THE FIELD +1. SHIFT: REDO" } ).clicked) { if(sh) undo(); else nudge( u, 1 ); u.shift = false; }

	// SAMPLE RECORD, SEQ RECORD, STOP, PLAY
	var playing = st.playing;
	var sr = skey( "sample_rec", 1165, 610, 120, 40, "SAMPLE\nRECORD", "MONITOR", { stripe: "#e2392f", led: st.rec && st.rec != "idle", tip: "SAMPLE RECORD: THE SAMPLE PAGE, ARMED: IT RECORDS THE REAR IN L / R ONTO THE SELECTED PAD (AGAIN: STOP). SHIFT: MONITOR" } );
	if(sr.clicked)
	{
		if(sh) S.monitor = !S.monitor;
		else if(st.rec && st.rec != "idle") send({ type: "recStop" });
		else { go( "sample" ); send({ type: "recArm", id: newId(), max: S.max_time, stereo: S.stereo }); }
		u.shift = false;
	}
	var qr = skey( "seq_rec", 1325, 610, 120, 40, "SEQ\nRECORD", "REPLACE", { stripe: "#e2392f", led: u.od || u.rec, tip: "SEQ RECORD: WHAT YOU PLAY IS ADDED (ARM IT, THEN PLAY; OR WHILE PLAYING). SHIFT: RECORD AGAIN FROM EMPTY (UNDO BRINGS IT BACK)" } );
	if(qr.clicked)
	{
		if(sh) { u.rec = !u.rec; u.od = false; } else { u.od = !(u.od || u.rec); u.rec = false; }
		if(playing) { if(u.rec || u.od) u.undo = { seq: S.seq, ev: q.ev.slice() }; send({ type: "rec", rec: u.rec, od: u.od }); }
		u.shift = false;
	}
	if(skey( "stop", 1165, 692, 120, 40, "■", "TO START", { size: 16, stripe: "#ffffff", tip: "STOP (STOPPED: BACK TO THE START)" } ).clicked)
	{ if(!playing || sh) send({ type: "locate", tick: 0 }); send({ type: "stop" }); u.rec = u.od = false; send({ type: "rec", rec: false, od: false }); u.shift = false; }
	if(skey( "play", 1325, 692, 120, 40, "▶", "CONTINUE", { size: 16, stripe: "#5fd36a", led: playing, ledColor: "#5fd36a", tip: "PLAY FROM THE START. SHIFT: FROM WHERE IT STOPPED" } ).clicked && !playing)
	{
		if(u.rec || u.od) { u.undo = { seq: S.seq, ev: q.ev.slice() }; if(u.rec) q.ev = []; }
		send({ type: "rec", rec: u.rec, od: u.od });
		send({ type: "play", from: sh ? "cont" : "start" });
		u.shift = false;
	}
}

function nvText()
{
	var v = S.nv_val;
	switch(S.nv)
	{
		case "TUNE": var t = Math.round( (v * 2 - 1) * 12 ); return (t > 0 ? "+" : "") + t + " SEMI";
		case "OFF": return "OFF";
		default: return Math.round( v * 100 ) + "%";
	}
}
function nvOf()
{
	var v = S.nv_val;
	switch(S.nv)
	{
		case "TUNE": return [ "tune", Math.round( (v * 2 - 1) * 12 ) ];
		case "DECAY": return [ "decay", v ];
		case "ATTACK": return [ "attack", v ];
		case "FILTER": return [ "filter", v ];
	}
	return null;
}

// the 16 pads on their black plate, lit round the edge: dim with a sample, bright when hit, white
// selected, red muted. SHIFT + pads 1-4: FULL LEVEL, HALF SEQ, DOUBLE SEQ, the CLICK
var PAD_SHIFT = ["FULL LEVEL", "HALF SEQ", "DOUBLE SEQ", "CLICK"];
function drawPads()
{
	var u = uiOf(), now = performance.now(), sh = u.shift;
	var size = 108, gap = 18, x0 = 559, y0 = 392;
	ctx.fillStyle = "#111213"; ctx.beginPath(); ctx.roundRect( x0 - 22, y0 - 22, 4 * size + 3 * gap + 44, 4 * size + 3 * gap + 52, 8 ); ctx.fill();
	u.padRects = [];
	for(var n = 0; n < 16; ++n)
	{
		var c = n % 4, row = 3 - Math.floor( n / 4 ), x = x0 + c * (size + gap), y = y0 + row * (size + gap);
		var p = (S.bank << 4) + n, pad = S.pads[p];
		u.padRects.push([ rackX( x ), rackY( y ), rackX( x + size ), rackY( y + size ), p ]);
		var r = hot( "pad" + n, x, y, size, size );
		var f = Math.max( 0, 1 - (now - u.flash[p]) / 200 );
		// the light round the pad
		var lc = pad.mute ? "255,70,60" : (p == S.sel ? "235,245,255" : "120,230,90");
		var la = pad.mute ? 0.5 : (pad.s ? 0.35 + f * 0.65 : f * 0.6);
		if(p == S.sel && !pad.mute) la = Math.max( la, 0.75 );
		if(la > 0.01)
		{
			ctx.fillStyle = "rgba(" + lc + "," + (la * 0.35) + ")"; ctx.beginPath(); ctx.roundRect( x - 7, y - 7, size + 14, size + 14, 10 ); ctx.fill();
			ctx.fillStyle = "rgba(" + lc + "," + la + ")"; ctx.beginPath(); ctx.roundRect( x - 3, y - 3, size + 6, size + 6, 8 ); ctx.fill();
		}
		var g = ctx.createLinearGradient( 0, y, 0, y + size );
		g.addColorStop( 0, shade( "#8e9092", 0.06 + f * 0.25 ) ); g.addColorStop( 1, shade( "#7b7d7f", f * 0.2 ) );
		ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect( x, y + (r.held ? 2 : 0), size, size, 6 ); ctx.fill();
		T( String( n + 1 ), x + 4, y + size + 8, 8, "#d8d8d4", "left" );
		var sub = n < 4 ? PAD_SHIFT[n] : "";
		if(sub) T( sub, x + size, y + size + 8, 8, sh ? "#ff6a5f" : "#d8d8d4", "right" );
		var name = u.levels ? (S.levels == "TUNE" ? "+" + n + " SEMI" : "VEL " + Math.round( (n + 1) / 16 * 127 )) : (pad.name || "");
		T( name.substr( 0, 15 ), x + size / 2, y + size - 12 + (r.held ? 2 : 0), 8, "#3a3b3c" );
		if(r.clicked && sh && n < 4)
		{
			var q = seq();
			if(n == 0) S.full = !S.full;
			else if(n == 1 && q.bars > 1) { q.bars = Math.ceil( q.bars / 2 ); q.ev = q.ev.filter(function(e){ return e[0] < q.bars * BAR; }); }
			else if(n == 2 && q.bars <= 8) { var L = q.bars * BAR; q.ev = q.ev.concat( q.ev.map(function(e){ return [ e[0] + L, e[1], e[2], e[3] ]; }) ); q.bars *= 2; }
			else if(n == 3) S.click = { "OFF": "REC", "REC": "ON", "ON": "OFF" }[ S.click ];
			u.shift = false;
			continue;
		}
		if(r.clicked)
		{
			var vel = S.full ? 1 : (r.key ? 0.85 : Math.max( 0.3, Math.min( 1, 1 - (ui.y - y) / size * 0.7 ) ));
			var hp = p, nv = nvOf();
			if(u.levels) { hp = u.levelsPad; if(S.levels == "TUNE") nv = [ "tune", n ]; else vel = (n + 1) / 16; }
			else S.sel = p;
			u.down[n] = hp;
			send({ type: "pad", pad: hp, vel: vel, on: true, nv: nv });
		}
		else if(u.down[n] !== undefined && !r.held) { send({ type: "pad", pad: u.down[n], on: false }); delete u.down[n]; }
	}
	if(S.full) T( "FULL LEVEL", x0 + 2 * size + 1.5 * gap, y0 - 11, 8, "#7dff8a" );
}

// files dropped on the pads (or on the panel: the selected pad)
var drop_ready = false;
function installDrop()
{
	if(drop_ready || typeof window == "undefined") return;
	drop_ready = true;
	var isAudio = function(f){ return /^audio\//.test( f.type ) && !/midi/.test( f.type ) || /\.(wav|wave|mp3|ogg|oga|flac|aif|aiff|m4a|aac|webm)$/i.test( f.name ); };
	var target = function(e){
		var c = document.querySelector( "canvas" ), r = c && c.getBoundingClientRect();
		if(!r) return null;
		var x = (e.clientX - r.left - view.ox) / view.scale, y = (e.clientY - r.top - view.oy) / view.scale;
		var found = null;
		rack.modules().forEach(function(m){
			var u = uis[ m.id ];
			if(m.type != "crate" || !u || !u.padRects || !u.box) return;
			u.padRects.forEach(function(pr){ if(x >= pr[0] && x <= pr[2] && y >= pr[1] && y <= pr[3]) found = { m: m, pad: pr[4] }; });
			if(!found && x >= u.box[0] && x <= u.box[2] && y >= u.box[1] && y <= u.box[3]) found = { m: m, pad: m.settings.sel };
		});
		return found;
	};
	window.addEventListener( "dragover", function(e){ if(target( e )) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } } );
	window.addEventListener( "drop", function(e){
		var files = Array.prototype.filter.call( e.dataTransfer && e.dataTransfer.files || [], isAudio );
		var t = files.length && target( e );
		if(!t) return;
		e.preventDefault();
		// several files: onto the pads from the one dropped on
		files.slice( 0, 64 - t.pad ).forEach(function(f, i){ loadFile( t.m, t.pad + i, f ); });
	} );
}

// ---------------------------------------------------------------------------

function draw( mod )
{
	M = mod; S = mod.settings; ST = mod.state;
	var u = uiOf(), w = SIZE[0], h = SIZE[1], st = ST || {};
	installDrop();
	takeState();
	syncSamples( M );
	u.box = [ rackX( 0 ), rackY( 0 ), rackX( w ), rackY( h ) ];
	drawCasing( 0, 0, w, h );
	var g = ctx.createLinearGradient( 0, 0, 0, h );
	g.addColorStop( 0, "#dddcd6" ); g.addColorStop( 1, CASE );
	ctx.fillStyle = g; ctx.fillRect( 22, 0, w - 44, h );

	// the black strip
	ctx.fillStyle = "#161617"; ctx.beginPath(); ctx.roundRect( 30, 6, w - 60, 262, 6 ); ctx.fill();
	ctx.font = "bold italic 30px Arial, Helvetica, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
	ctx.fillStyle = RED; ctx.fillText( "CRATE", 70, 50 );
	ctx.fillStyle = "#2a2a2c"; ctx.beginPath(); ctx.arc( 150, 160, 50, 0, Math.PI * 2 ); ctx.fill();
	S.volume = knob( "volume", 150, 160, 34, S.volume, 0, 1.2, { def: 0.8, format: fmtPct } );
	T( "MAIN VOLUME", 150, 232, 9, "#e8e8e4" );
	// the bank letters
	BANKS.forEach(function(b, i){ T( b, 270 + i * 40, 150, 26, S.bank == i ? "#ffffff" : "#3a3a3c" ); });
	T( "PAD BANK", 330, 186, 8, "#8a8a86" );
	led( 300, 222, st.playing, "#5fd36a" );
	T( "PLAY", 318, 222, 8, "#8a8a86", "left" );
	drawLcd();
	// the level LEDs: two columns, green to red
	var pk = st.out || [0, 0];
	for(var c = 0; c < 2; ++c)
		for(var k = 0; k < 5; ++k)
		{
			var db = 20 * Math.log10( Math.max( 1e-5, pk[c] ) ), lit = db > -36 + k * 9;
			var col = k >= 4 ? "#ff3b2f" : (k == 3 ? "#ffa52f" : "#5fd36a");
			ctx.fillStyle = lit ? col : shade( col, -0.75 );
			ctx.fillRect( 1074 + c * 24, 222 - k * 34, 16, 24 );
		}
	// the speaker and the name over it
	ctx.font = "bold italic 34px Arial, Helvetica, sans-serif"; ctx.textAlign = "center";
	ctx.strokeStyle = RED; ctx.lineWidth = 1.5; ctx.strokeText( "CRATE 60", 1320, 40 );
	ctx.fillStyle = "#0b0b0c"; ctx.beginPath(); ctx.roundRect( 1170, 66, 300, 190, 10 ); ctx.fill();
	ctx.fillStyle = "#232325";
	for(var yy = 76; yy < 248; yy += 7) for(var xx = 1180 + ((yy / 7) & 1) * 3.5; xx < 1462; xx += 7) { ctx.beginPath(); ctx.arc( xx, yy, 2, 0, Math.PI * 2 ); ctx.fill(); }

	drawControls();
	drawPads();

	// the palm rest
	ctx.fillStyle = "#6c6d6f"; ctx.beginPath(); ctx.roundRect( 470, 918, w - 520, 72, 10 ); ctx.fill();
	ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect( 480, 922, w - 540, 2 );
	ctx.font = "bold italic 30px Arial, Helvetica, sans-serif"; ctx.textAlign = "right";
	ctx.strokeStyle = "#3e3f41"; ctx.lineWidth = 1.5; ctx.strokeText( "CRATE 60", w - 80, 958 );
	M = null; S = null; ST = null;
}

window.CRATE = { uis: uis, samples: SAMPLES }; // for the tests

WR.registerSynth( "crate", {
	title: "CRATE 60",
	description: "CRATE 60: pad sampler and sequencer",
	about: "A pad sampler and sequencer laid out as a compact modern beat machine: 64 pads in 4 banks, a factory kit, audio files dropped on the pads, sampling from the back, chops, 16 sequences with swing, note repeat and 16 levels.",
	// keys: the pads first, then the transport
	key_prio: [["^pad\\d+$", 3], ["^(play|stop|seq_rec|shift)$", 2], ["^(repeat|k_bank|levels|tap|mute|erase)$", 1], ["", 0]],
	category: "Synths",
	knob_skin: "greycap",
	worklet: "devices/crate-worklet.js",
	jacks: [[]],
	rear_jacks: [["IN L", "ain", "in_l"], ["IN R", "ain", "in_r"], ["OUT L", "aout", "out_l"], ["OUT R", "aout", "out_r"]],
	audio_out: "out_l",
	audio_out_r: "out_r",
	midi_in: "midi_in",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function() { return SIZE; },
	draw: draw,
	tempo: function( s ) { return s.tempo; },
	transport: function( mod, action, value ) {
		if(action == "play") rack.postModule( mod.id, value === false ? { type: "stop" } : { type: "play", from: "start" } );
	},
	rear_note: function( s ) { return "SEQ " + String( s.seq + 1 ).padStart( 2, "0" ) + " · " + s.tempo.toFixed( 1 ) + " BPM · IN L / R: SAMPLING"; }
});

})();
