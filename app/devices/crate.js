// devices/crate.js
// CRATE 60 module: a pad sampler and sequencer in the classic beat-machine layout. Light grey case:
// the LCD with its six soft keys (F1-F6) top left, the REC GAIN and MAIN VOLUME knobs beside it, the
// mode keys (MAIN, PROGRAM, SAMPLE, TRIM, LOAD, GRID), the DATA wheel and the CURSOR keys, TAP TEMPO,
// NOTE REPEAT, UNDO SEQ and ERASE, the LOCATE keys, the transport (REC, OVERDUB, STOP, PLAY,
// PLAY START), the NOTE VARIATION slider, PAD BANK, FULL LEVEL and 16 LEVELS, and the 16 pads.
// The pages of the LCD hold the parameters: click a field (or move with CURSOR) and turn the DATA
// wheel, or drag the field up and down.
// Samples: the factory kit (made here once and sent to the DSP), audio files dropped on a pad, and
// recordings of the rear IN L / R (SAMPLE page). Files and recordings are kept in this browser
// (IndexedDB, "GASFREE_samples"); the patches only name them. DSP in crate-worklet.js.

(function(){

var SIZE = [1568, 780];
var CASE = "#d7d6d0", INK = "#2a2a2a", DIM = "#6e6e6a", RED = "#c8332b", BLUE = "#7d93ab";
var LCD_BG = "#a9b79a", LCD_INK = "#1d2619", LCD_DIM = "#5f6c56";
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
	return { s: name ? "f:" + name : "", name: name || "", tune: 0, level: 0.8, pan: 0, attack: 0, decay: 1, mode: "oneshot", group: 0, cutoff: 1, reso: 0, vel: 0.8, start: 0, end: 1, rev: false };
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
	flash: new Float64Array( 64 ), down: {}, taps: [], rec: false, od: false, levels: false, levelsPad: 0, wheelAcc: 0, wheelAng: 0, last: null }); }
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

var LX = 172, LY = 86, LW = 516, LH = 202;    // the screen
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
	// bezel and screen
	ctx.fillStyle = "#2b2c2e"; ctx.beginPath(); ctx.roundRect( LX - 14, LY - 14, LW + 28, LH + 28, 6 ); ctx.fill();
	var g = ctx.createLinearGradient( 0, LY, 0, LY + LH );
	g.addColorStop( 0, "#b3c1a3" ); g.addColorStop( 1, LCD_BG );
	ctx.fillStyle = g; ctx.fillRect( LX, LY, LW, LH );
	ctx.save(); ctx.beginPath(); ctx.rect( LX, LY, LW, LH ); ctx.clip();
	var st = ST || {}, playing = st.playing;
	// the title line: page, transport, position
	var title = SCREENS.find(function(x){ return x[0] == u.screen; })[1];
	lcdText( " " + title + " ", 4, 9, true );
	var tr = playing ? (u.rec ? "REC" : (u.od ? "OVERDUB" : "PLAY")) : (u.rec ? "REC READY" : (u.od ? "ODUB READY" : "STOP"));
	lcdText( tr, 160, 9, false );
	lcdText( "BAR " + fmtPos( st.tick || 0 ), LW - 18 * CH, 9, false );
	ctx.fillStyle = LCD_INK; ctx.fillRect( LX, LY + 18, LW, 1 );

	var fs = fields( u );
	if(u.cur >= fs.length) u.cur = 0;
	fs.forEach(function(f, i){ drawField( f, i, u ); });

	if(u.screen == "main") drawTimeline( st );
	else if(u.screen == "sample") drawMeters( st );
	else if(u.screen == "trim") drawTrim( u );
	else if(u.screen == "load") drawLoad( u );
	else if(u.screen == "grid") drawGrid( u, st );

	// the soft keys' names
	var soft = softKeys( u );
	soft.forEach(function(k, i){
		if(!k) return;
		var x = 6 + i * 86, w = 80;
		ctx.fillStyle = LCD_INK; ctx.fillRect( LX + x, LY + LH - 17, w, 15 );
		ctx.font = "bold 12px 'Courier New', Courier, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.fillStyle = LCD_BG; ctx.fillText( k[0], LX + x + w / 2, LY + LH - 9 );
	});
	ctx.restore();
	// the F keys
	for(var i = 0; i < 6; ++i)
	{
		var k = soft[i];
		if(key( "f" + (i + 1), LX + 6 + i * 86 + 40, LY + LH + 26, 64, 18, "F" + (i + 1), { tip: k ? k[0] : "" } ).clicked && k) k[1]();
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
		"CABLE AUDIO TO IN L / R ON THE BACK, THEN F6");
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
	ctx.fillStyle = "rgba(169,183,154,0.7)";
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
			ctx.fillStyle = on ? LCD_INK : (c % 4 == 0 ? "rgba(29,38,25,0.18)" : "rgba(29,38,25,0.08)");
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
		ctx.fillStyle = "rgba(29,38,25,0.35)";
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

// the DATA wheel: drag it round (up / down), or the mouse wheel over it
function drawWheel( cx, cy, r )
{
	var u = uiOf(), id = "data", full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitCircle( cx, cy, r );
	if(hover) ui.hot = full;
	if(hover && ui.pressed && ui.active === null) { ui.active = full; u.wy = ui.y; }
	if(ui.active === full && ui.down)
	{
		var steps = Math.trunc( (u.wy - ui.y) / 6 );
		if(steps) { nudge( u, steps ); u.wy -= steps * 6; u.wheelAng += steps * 0.25; }
	}
	if(hover && ui.wheel && ui.active === null) { nudge( u, -ui.wheel ); u.wheelAng -= ui.wheel * 0.25; ui.wheel = 0; }
	ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc( cx + 2, cy + 5, r, 0, Math.PI * 2 ); ctx.fill();
	var g = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r );
	g.addColorStop( 0, "#ffffff" ); g.addColorStop( 0.7, hover ? "#e8e8e4" : "#dcdcd7" ); g.addColorStop( 1, "#a9a9a4" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy, r, 0, Math.PI * 2 ); ctx.fill();
	ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc( cx, cy, r * 0.82, 0, Math.PI * 2 ); ctx.stroke();
	// the finger dimple
	var a = u.wheelAng - Math.PI / 2, dx = cx + Math.cos( a ) * r * 0.6, dy = cy + Math.sin( a ) * r * 0.6;
	g = ctx.createRadialGradient( dx + 2, dy + 2, 1, dx, dy, r * 0.17 );
	g.addColorStop( 0, "#bdbdb8" ); g.addColorStop( 1, "#ececE8" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( dx, dy, r * 0.17, 0, Math.PI * 2 ); ctx.fill();
	T( "DATA", cx + r + 14, cy - r + 6, 9, INK, "left" );
}

function transport( u, st )
{
	var playing = st && st.playing;
	var startRec = function(fromStart){
		if(u.rec || u.od) { u.undo = { seq: S.seq, ev: seq().ev.slice() }; if(u.rec) seq().ev = []; }
		send({ type: "rec", rec: u.rec, od: u.od });
		send({ type: "play", from: fromStart ? "start" : "cont" });
	};
	if(key( "rec", 150, 690, 80, 34, "REC", { color: "#d8463c", led: u.rec, tip: "REC: ARM, THEN PLAY (THE SEQUENCE IS RECORDED AGAIN; UNDO SEQ BRINGS IT BACK)" } ).clicked)
	{ u.rec = !u.rec; u.od = false; if(playing) { if(u.rec) u.undo = { seq: S.seq, ev: seq().ev.slice() }; send({ type: "rec", rec: u.rec, od: false }); } }
	if(key( "overdub", 245, 690, 80, 34, "OVERDUB", { color: "#d8463c", led: u.od, tip: "OVERDUB: WHAT YOU PLAY IS ADDED" } ).clicked)
	{ u.od = !u.od; u.rec = false; if(playing) { if(u.od) u.undo = { seq: S.seq, ev: seq().ev.slice() }; send({ type: "rec", rec: false, od: u.od }); } }
	if(key( "stop", 340, 690, 80, 34, "STOP" ).clicked)
	{ if(!playing) send({ type: "locate", tick: 0 }); send({ type: "stop" }); u.rec = u.od = false; send({ type: "rec", rec: false, od: false }); }
	if(key( "play", 435, 690, 80, 34, "PLAY", { led: playing } ).clicked && !playing) startRec( false );
	if(key( "play_start", 530, 690, 80, 34, "PLAY START" ).clicked) { if(playing) send({ type: "stop" }); startRec( true ); }
}

function drawControls()
{
	var u = uiOf(), st = ST || {}, q = seq();
	// REC GAIN, MAIN VOLUME
	T( "REC GAIN", 92, 96, 9 ); T( "MAIN VOLUME", 92, 204, 9 );
	S.rec_gain = knob( "rec_gain", 92, 130, 22, S.rec_gain, 0, 4, { def: 1, format: function(v){ return (20 * Math.log10( Math.max( v, 1e-4 ) )).toFixed( 1 ) + " dB"; } } );
	S.volume = knob( "volume", 92, 238, 22, S.volume, 0, 1.2, { def: 0.8, format: fmtPct } );

	// the mode keys
	T( "MODE", 240, 362, 9, DIM );
	SCREENS.forEach(function(sc, i){
		var cx = 150 + (i % 3) * 90, y = 378 + Math.floor( i / 3 ) * 56;
		if(key( "mode_" + sc[0], cx, y, 74, 24, sc[1], { color: BLUE, led: u.screen == sc[0] } ).clicked) { u.screen = sc[0]; u.cur = 0; }
	});

	// the DATA wheel and the CURSOR keys
	drawWheel( 520, 440, 62 );
	var cx = 690, cy = 440;
	T( "CURSOR", cx, cy - 58, 9, DIM );
	if(key( "cur_up", cx, cy - 46, 40, 26, "", { inside: "▲" } ).clicked) { var fs = fields( u ); u.cur = (u.cur + fs.length - 1) % Math.max( 1, fs.length ); }
	if(key( "cur_dn", cx, cy + 20, 40, 26, "", { inside: "▼" } ).clicked) { var fs2 = fields( u ); u.cur = (u.cur + 1) % Math.max( 1, fs2.length ); }
	if(key( "cur_l", cx - 46, cy - 13, 40, 26, "", { inside: "−", tip: "THE FIELD'S VALUE -1" } ).clicked) nudge( u, -1 );
	if(key( "cur_r", cx + 46, cy - 13, 40, 26, "", { inside: "+", tip: "THE FIELD'S VALUE +1" } ).clicked) nudge( u, 1 );

	// TAP TEMPO, NOTE REPEAT, UNDO SEQ, ERASE
	if(key( "tap", 150, 520, 74, 24, "TAP TEMPO", { tip: "TAP THE BEAT: THE TEMPO FOLLOWS" } ).clicked)
	{
		var now = performance.now();
		u.taps = u.taps.filter(function(t){ return now - t < 2500; }).concat([ now ]);
		if(u.taps.length >= 2) { var d = (u.taps[ u.taps.length - 1 ] - u.taps[0]) / (u.taps.length - 1); S.tempo = Math.max( 30, Math.min( 300, Math.round( 600000 / d ) / 10 ) ); }
	}
	var nr = key( "repeat", 240, 520, 74, 24, "NOTE REPEAT", { led: !!u.repeat, tip: "HOLD IT AND A PAD: THE PAD REPEATS AT TIMING CORRECT" } );
	if(!!nr.held != !!u.repeat) { u.repeat = !!nr.held; send({ type: "repeat", on: u.repeat }); }
	if(key( "undo", 330, 520, 74, 24, "UNDO SEQ", { tip: "BACK TO THE SEQUENCE BEFORE THE LAST RECORDING OR EDIT" } ).clicked && u.undo)
	{ var cur = S.seqs[ u.undo.seq ].ev; S.seqs[ u.undo.seq ].ev = u.undo.ev; u.undo = { seq: u.undo.seq, ev: cur }; }
	var er = key( "erase", 420, 520, 74, 24, "ERASE", { led: !!u.erase, tip: "HOLD IT AND PADS WHILE PLAYING: THEIR NOTES GO. STOPPED: CLEARS THE SELECTED PAD" } );
	if(!!er.held != !!u.erase) { u.erase = !!er.held; send({ type: "erase", on: u.erase }); if(u.erase && st.playing) u.undo = { seq: S.seq, ev: q.ev.slice() }; }
	if(er.clicked && !st.playing) { u.undo = { seq: S.seq, ev: q.ev }; q.ev = q.ev.filter(function(e){ return e[1] != S.sel; }); }

	// LOCATE
	ctx.fillStyle = DIM; ctx.fillRect( 112, 586, 380, 1 );
	T( "LOCATE", 300, 586, 9, DIM );
	var tick = st.tick || 0, g = TC_TICKS[ S.tc ] || 24, L = q.bars * BAR;
	var loc = function(t){ send({ type: "locate", tick: ((t % L) + L) % L }); };
	if(key( "bar_dn", 150, 600, 74, 22, "<< BAR" ).clicked) loc( Math.ceil( tick / BAR ) * BAR - BAR );
	if(key( "step_dn", 240, 600, 74, 22, "< STEP" ).clicked) loc( Math.ceil( tick / g ) * g - g );
	if(key( "step_up", 330, 600, 74, 22, "STEP >" ).clicked) loc( Math.floor( tick / g ) * g + g );
	if(key( "bar_up", 420, 600, 74, 22, "BAR >>" ).clicked) loc( Math.floor( tick / BAR ) * BAR + BAR );

	transport( u, st );

	// NOTE VARIATION: the slider and its ASSIGN key
	T( "NOTE", 50, 336, 8, INK ); T( "VARIATION", 50, 347, 8, INK );
	if(key( "nv_assign", 50, 366, 50, 18, "", { inside: S.nv == "OFF" ? "ASSIGN" : S.nv, size: 8, led: S.nv != "OFF", tip: "WHAT THE SLIDER CHANGES ON THE PADS: OFF, TUNE, DECAY, ATTACK, FILTER" } ).clicked)
		S.nv = NV[ (NV.indexOf( S.nv ) + 1) % NV.length ];
	ctx.fillStyle = "#c4c3bd"; ctx.fillRect( 22, 410, 56, 330 );
	S.nv_val = fader( "nv_val", 50, 424, 296, S.nv_val, { def: 0.5 } );
	T( nvText(), 50, 760, 8, INK );
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

// PAD BANK, FULL LEVEL, 16 LEVELS, and the pads
function drawPads()
{
	var u = uiOf(), now = performance.now();
	// the strip
	ctx.fillStyle = "#b6b8b8"; ctx.beginPath(); ctx.roundRect( 780, 330, 86, 430, 6 ); ctx.fill();
	BANKS.forEach(function(b, i){ var x = 808 + (i % 2) * 30, y = 350 + Math.floor( i / 2 ) * 18; led( x, y, S.bank == i ); T( b, x + 10, y, 9, INK, "left" ); });
	if(key( "bank", 823, 394, 56, 22, "PAD BANK", { tip: "BANK A, B, C, D: 16 PADS EACH" } ).clicked) S.bank = (S.bank + 1) % 4;
	if(key( "full", 823, 470, 56, 22, "FULL LEVEL", { led: S.full, tip: "EVERY HIT AT FULL VELOCITY" } ).clicked) S.full = !S.full;
	if(key( "levels", 823, 546, 56, 22, "16 LEVELS", { led: u.levels, tip: "THE SELECTED PAD ON ALL 16 PADS, BY " + S.levels + " (MAIN PAGE)" } ).clicked)
	{ u.levels = !u.levels; u.levelsPad = S.sel; }
	if(u.levels) T( padName( u.levelsPad ), 823, 590, 9, INK );

	// the plate, the pads: pad 1 at the bottom left
	ctx.fillStyle = "#b9bcbc"; ctx.beginPath(); ctx.roundRect( 896, 150, 648, 616, 8 ); ctx.fill();
	T( "PADS", 1220, 164, 9, DIM );
	var size = 128, gap = 22, x0 = 896 + (648 - 4 * size - 3 * gap) / 2, y0 = 186;
	u.padRects = [];
	for(var n = 0; n < 16; ++n)
	{
		var c = n % 4, row = 3 - Math.floor( n / 4 ), x = x0 + c * (size + gap), y = y0 + row * (size + gap);
		var p = (S.bank << 4) + n, pad = S.pads[p];
		u.padRects.push([ rackX( x ), rackY( y ), rackX( x + size ) , rackY( y + size ), p ]);
		T( "PAD " + (n + 1), x, y - 9, 8, INK, "left" );
		T( (u.levels ? (S.levels == "TUNE" ? "+" + n + " SEMI" : "VEL " + Math.round( (n + 1) / 16 * 127 )) : (pad.name || "")).substr( 0, 14 ), x + size, y - 9, 8, p == S.sel ? RED : DIM, "right" );
		var r = hot( "pad" + n, x, y, size, size );
		var f = Math.max( 0, 1 - (now - u.flash[p]) / 180 );
		ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.roundRect( x + 2, y + 4, size, size, 8 ); ctx.fill();
		var g = ctx.createLinearGradient( 0, y, 0, y + size );
		g.addColorStop( 0, shade( "#8f9193", 0.08 + f * 0.35 ) ); g.addColorStop( 1, shade( "#7f8183", f * 0.3 ) );
		ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect( x, y + (r.held ? 2 : 0), size, size, 8 ); ctx.fill();
		if(p == S.sel) { ctx.strokeStyle = "rgba(200,51,43,0.6)"; ctx.lineWidth = 2; ctx.stroke(); }
		// hit, let go
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
	var u = uiOf(), w = SIZE[0], h = SIZE[1];
	installDrop();
	takeState();
	syncSamples( M );
	u.box = [ rackX( 0 ), rackY( 0 ), rackX( w ), rackY( h ) ];
	drawCasing( 0, 0, w, h );
	var g = ctx.createLinearGradient( 0, 0, 0, h );
	g.addColorStop( 0, "#dfded8" ); g.addColorStop( 1, CASE );
	ctx.fillStyle = g; ctx.fillRect( 22, 0, w - 44, h );
	// the name and the print
	ctx.font = "bold italic 24px Arial, Helvetica, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
	ctx.fillStyle = RED; ctx.fillText( "CRATE", 44, 40 );
	T( "INTEGRATED RHYTHM MACHINE", 140, 34, 8, INK, "left", false );
	T( "16 BIT DRUM SAMPLER / MIDI SEQUENCER", 140, 46, 8, INK, "left", false );
	// the vents and the model name over the pads
	ctx.fillStyle = "#3b3b3b";
	for(var gi = 0; gi < 4; ++gi) for(var li = 0; li < 6; ++li) ctx.fillRect( 940 + gi * 150, 26 + li * 8, 110, 3 );
	ctx.font = "bold 46px Arial, Helvetica, sans-serif"; ctx.textAlign = "right";
	ctx.strokeStyle = "#555"; ctx.lineWidth = 1.5; ctx.strokeText( "CRATE", 1340, 104 );
	ctx.fillStyle = "#555"; ctx.fillText( "60", 1420, 104 );
	ctx.fillStyle = RED; ctx.fillRect( 1238, 128, 182, 2 );
	T( "SAMPLE PRODUCTION CENTER", 1420, 138, 11, INK, "right" );

	drawLcd();
	drawControls();
	drawPads();
	M = null; S = null; ST = null;
}

window.CRATE = { uis: uis, samples: SAMPLES }; // for the tests

WR.registerSynth( "crate", {
	title: "CRATE 60",
	description: "CRATE 60: pad sampler and sequencer",
	about: "A pad sampler and sequencer in the classic beat-machine layout: 64 pads in 4 banks, a factory kit, audio files dropped on the pads, sampling from the back, chops, 16 sequences with swing, note repeat and 16 levels.",
	// keys: the pads first, then the transport
	key_prio: [["^pad\\d+$", 3], ["^(play|stop|rec|overdub|play_start)$", 2], ["^(repeat|full|bank|levels|tap)$", 1], ["", 0]],
	category: "Synths",
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
