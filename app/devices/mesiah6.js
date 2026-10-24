// devices/mesiah6.js
// MESIAH-6 module, a six voice analog polysynth: settings, programs and the panel. The panel follows
// the classic layout of its kind in three rows: the performance row (POLY MOD, CLOCK, ARPEGGIATOR,
// SEQUENCER, the program display and selectors, AFTERTOUCH, MISC PARAMETERS), then DISTORTION,
// EFFECTS, OSCILLATOR 1, SLOP, MIXER, HIGH-PASS FILTER and FILTER ENVELOPE, then the LFO,
// OSCILLATOR 2, LOW-PASS FILTER and AMPLIFIER ENVELOPE; glide, unison, hold, transpose and the CV
// jacks on the left. Polyphonic (6 voices): the keys, a MIDI device or the song play it.
// DSP in mesiah6-worklet.js.

(function(){

var SIZE = [1568, 596];
var PANEL = "#111113", INK = "#ecebe6", DIM = "#8d8c88", LINE = "#4a4a4c", LED_ON = "#ff2a1e", LED_OFF = "#3a1512";
var FONT_UI = "Arial, Helvetica, sans-serif";

var FX_A = ["off", "bbd", "ddl", "cho", "ph1", "ph2", "ph3", "rin", "fl1", "fl2"];
var FX_B = FX_A.concat(["hal", "roo", "pla", "spr"]);
var FX_SHOW = { off: "OFF", bbd: "bbd", ddl: "ddL", cho: "CHO", ph1: "PH1", ph2: "PH2", ph3: "PH3", rin: "rin", fl1: "FL1", fl2: "FL2", hal: "HAL", roo: "rOO", pla: "PLA", spr: "SPr" };
var FX_NAME = { off: "OFF", bbd: "BUCKET BRIGADE DELAY", ddl: "DIGITAL DELAY", cho: "CHORUS", ph1: "PHASER 1 (HIGH RESONANCE)", ph2: "PHASER 2 (LOW RESONANCE)", ph3: "PHASER 3 (4 STAGES)",
	rin: "RING MODULATOR", fl1: "FLANGER 1 (HIGH RESONANCE)", fl2: "FLANGER 2 (LOW RESONANCE)", hal: "HALL REVERB", roo: "ROOM REVERB", pla: "PLATE REVERB", spr: "SPRING REVERB" };
var FX_PARAMS = { off: ["-", "-"], bbd: ["TIME", "FEEDBACK"], ddl: ["TIME", "FEEDBACK"], cho: ["RATE", "DEPTH"], ph1: ["RATE", "DEPTH"], ph2: ["RATE", "DEPTH"], ph3: ["RATE", "DEPTH"],
	rin: ["FREQUENCY", "TRACKING"], fl1: ["RATE", "DEPTH"], fl2: ["RATE", "DEPTH"], hal: ["TIME", "EARLY REFL"], roo: ["TIME", "EARLY REFL"], pla: ["TIME", "EARLY REFL"], spr: ["DECAY", "TONE"] };
var DLY_SYNC_N = ["1", "2d", "2", "4d", "4", "8d", "4t", "8", "16d", "8t", "16"];      // mesiah6-worklet.js: DLY_SYNC
var LFO_SYNC_N = ["16", "8", "6", "4", "3", "2", "1.5", "1", "3/4", "1/2", "1/3", "3/8", "1/4", "1/6", "1/8"]; // beats a cycle: LFO_SYNC
var VALUE_N = ["HALF", "QTR", "8TH", "8TH D", "8TH S", "8TH T", "16TH", "16TH S", "16TH T", "32ND"];
var VALUE_SHOW = ["HAF", "qtr", "8", "8d", "8S", "8t", "16", "16S", "16t", "32"];
var LFO_SHAPES = [["tri", "TRIANGLE"], ["saw", "SAWTOOTH"], ["rsaw", "REVERSE SAW"], ["square", "SQUARE"], ["random", "RANDOM"]];
var ARP_MODES = [["up", "UP", "UP"], ["down", "DOWN", "dn"], ["updown", "UP + DOWN", "UPd"], ["random", "RANDOM", "rnd"], ["assign", "ASSIGN", "ASn"]];
var KEY_MODES = [["lo", "LO", "LOW NOTE"], ["lor", "LOr", "LOW NOTE, RETRIGGER"], ["hi", "HI", "HIGH NOTE"], ["hir", "HIr", "HIGH NOTE, RETRIGGER"], ["las", "LAS", "LAST NOTE"], ["lar", "LAr", "LAST NOTE, RETRIGGER"]];
var GLIDE_MODES = [["Fr", "FIXED RATE"], ["FrA", "FIXED RATE, LEGATO ONLY"], ["Ft", "FIXED TIME"], ["FtA", "FIXED TIME, LEGATO ONLY"]];
var FILTER_DST = ["OFF", "LP", "HP", "LP + HP"];

var M = null, S = null, ST = null;
var uis = {}; // module id -> { show: [text, until], edit: [what, until], pend: "bank" / "tens" / "write" / null, bank, tens, taps, recVer }

function uiOf() { return uis[ M.id ] || (uis[ M.id ] = { show: null, edit: null, pend: null, bank: 0, tens: 0, taps: [], recVer: -1 }); }

// ---- settings ----
function fxDefault( type ) { return { type: type, mix: 0.3, p1: 0.4, p2: 0.35, sync: false }; }
function soundDefaults()
{
	return {
		osc1: { freq: 0, shape: 0.5, pw: 0.5, sync: false },
		osc2: { freq: 0, fine: 6, shape: 0.5, pw: 0.5, low: false, kbd: true },
		slop: 0.15,
		mix: { osc1: 0.8, osc2: 0.6, sub: 0, noise: 0 },
		hpf: { cutoff: 20, res: 0, env: 0, vel: false, kbd: 0 },
		lpf: { cutoff: 2500, res: 0.15, env: 0.35, vel: false, kbd: 1 },
		fenv: { a: 0.003, d: 0.6, s: 0.35, r: 0.5 },
		aenv: { a: 0.003, d: 0.5, s: 0.8, r: 0.4, amt: 1, vel: true },
		pmod: { fenv: 0, osc2: 0, freq1: false, shape1: false, pw1: false, filter: 0 },
		lfo: { rate: 0.45, shape: "tri", amt: 0, sync: false, freq1: false, freq2: false, pw: false, amp: false, filter: 0 },
		at: { amt: 0, freq1: false, freq2: false, lfo: false, amp: false, filter: 0 },
		dist: 0,
		fx: { on: true, edit: "a", a: fxDefault( "off" ), b: fxDefault( "roo" ) },
		clock: { bpm: 120, value: 6 },
		arp: { on: false, oct: 1, mode: "up" },
		hold: false,
		seq: [],
		glide: { rate: 0.2, on: false, mode: 0 },
		unison: { on: false, voices: 6, chord: [] },
		keymode: "las", pwheel: 2, pan: 0.4, pvol: 0.7
	};
}
function defaults()
{
	var s = soundDefaults();
	deepMerge( s, PROGRAMS[0][1] ); // a new MESIAH-6 starts on program 000
	s.volume = 0.75; s.tune = 0; s.transpose = 0;
	s.seq_play = false; s.seq_rec = false;
	s.prog = 0; s.name = PROGRAMS[0][0];
	s.user = [null, null, null, null, null, null, null, null, null, null];
	return s;
}
function enumOf( list, v, def ) { return list.some(function(o){ return (Array.isArray( o ) ? o[0] : o) === v; }) ? v : def; }
function int( v, a, b ) { return Math.max( a, Math.min( b, Math.round( +v || 0 ) ) ); }

// the variable length parts of a sound (WR.mergeValid keeps only arrays of the default's length)
function cleanSeq( q )
{
	if(!Array.isArray( q )) return [];
	return q.slice( 0, 64 ).filter( Array.isArray ).map(function(st){ return st.slice( 0, 6 ).map(function(n){ return int( n, -1, 127 ); }); });
}
function cleanChord( c ) { return Array.isArray( c ) ? c.slice( 0, 6 ).map(function(n){ return int( n, -24, 48 ); }) : []; }

function cleanSound( s, raw )
{
	if(raw && raw.seq) s.seq = cleanSeq( raw.seq );
	if(raw && raw.unison && raw.unison.chord) s.unison.chord = cleanChord( raw.unison.chord );
	s.lfo.shape = enumOf( LFO_SHAPES, s.lfo.shape, "tri" );
	s.arp.mode = enumOf( ARP_MODES, s.arp.mode, "up" );
	s.keymode = enumOf( KEY_MODES, s.keymode, "las" );
	s.fx.a.type = enumOf( FX_A, s.fx.a.type, "off" ); s.fx.b.type = enumOf( FX_B, s.fx.b.type, "off" );
	if(s.fx.edit != "a" && s.fx.edit != "b") s.fx.edit = "a";
	s.clock.value = int( s.clock.value, 0, VALUE_N.length - 1 ); s.clock.bpm = Math.max( 30, Math.min( 250, s.clock.bpm ) );
	s.arp.oct = int( s.arp.oct, 1, 3 );
	s.unison.voices = int( s.unison.voices, 1, 7 );
	s.lpf.kbd = int( s.lpf.kbd, 0, 2 ); s.hpf.kbd = int( s.hpf.kbd, 0, 2 );
	s.pmod.filter = int( s.pmod.filter, 0, 3 ); s.lfo.filter = int( s.lfo.filter, 0, 3 ); s.at.filter = int( s.at.filter, 0, 3 );
	s.glide.mode = int( s.glide.mode, 0, 3 ); s.pwheel = int( s.pwheel, 0, 12 );
	s.osc1.freq = int( s.osc1.freq, -24, 24 ); s.osc2.freq = int( s.osc2.freq, -24, 24 );
}
function validate( s, raw )
{
	cleanSound( s, raw );
	s.transpose = int( s.transpose, -2, 2 ); s.tune = Math.max( -50, Math.min( 50, s.tune ) );
	s.seq_rec = false; s.seq_play = false; // a loaded sound does not record or play by itself
	s.prog = int( s.prog, 0, 109 );
	var ru = raw && Array.isArray( raw.user ) ? raw.user : [];
	s.user = s.user.map(function(u, i){
		var r = ru[i];
		if(!r || typeof r != "object") return null;
		var c = WR.mergeValid( soundDefaults(), r );
		cleanSound( c, r );
		c.name = typeof r.name == "string" ? r.name.slice( 0, 24 ) : "USER " + (i + 1);
		return c;
	});
}

function randomize( s )
{
	var rnd = function(a, b){ return a + Math.random() * (b - a); };
	var exp = function(a, b){ return a * Math.pow( b / a, Math.random() ); };
	var pick = function(l){ return l[ Math.floor( Math.random() * l.length ) ]; };
	var chance = function(p){ return Math.random() < p; };
	s.osc1.shape = pick([0, 0.5, 0.5, 1, rnd( 0, 1 )]); s.osc1.pw = rnd( 0.2, 0.8 ); s.osc1.sync = chance( 0.2 );
	s.osc1.freq = s.osc1.sync ? pick([7, 12, 19]) : pick([0, 0, 0, 12, -12]);
	s.osc2.shape = pick([0, 0.5, 0.5, 1, rnd( 0, 1 )]); s.osc2.pw = rnd( 0.2, 0.8 ); s.osc2.freq = pick([0, 0, 7, 12, -12, 5]); s.osc2.fine = rnd( -12, 12 );
	s.mix.osc1 = rnd( 0.5, 1 ); s.mix.osc2 = rnd( 0, 0.9 ); s.mix.sub = chance( 0.3 ) ? rnd( 0, 0.7 ) : 0; s.mix.noise = chance( 0.2 ) ? rnd( 0, 0.3 ) : 0;
	s.slop = rnd( 0, 0.4 );
	s.lpf.cutoff = exp( 200, 8000 ); s.lpf.res = rnd( 0, 0.7 ); s.lpf.env = rnd( -0.2, 0.7 ); s.lpf.kbd = pick([0, 1, 2]);
	s.hpf.cutoff = chance( 0.7 ) ? 20 : exp( 40, 800 ); s.hpf.res = rnd( 0, 0.4 );
	s.fenv.a = exp( 0.001, 1 ); s.fenv.d = exp( 0.05, 2 ); s.fenv.s = rnd( 0, 0.8 ); s.fenv.r = exp( 0.05, 2 );
	s.aenv.a = chance( 0.6 ) ? exp( 0.001, 0.03 ) : exp( 0.05, 1.5 ); s.aenv.d = exp( 0.05, 2 ); s.aenv.s = rnd( 0.2, 1 ); s.aenv.r = exp( 0.05, 2.5 );
	s.pmod.fenv = chance( 0.3 ) ? rnd( -0.4, 0.4 ) : 0; s.pmod.osc2 = chance( 0.25 ) ? rnd( -0.3, 0.3 ) : 0;
	s.pmod.freq1 = chance( 0.3 ); s.pmod.shape1 = chance( 0.2 ); s.pmod.pw1 = chance( 0.2 ); s.pmod.filter = chance( 0.3 ) ? 1 : 0;
	s.lfo.rate = rnd( 0.2, 0.7 ); s.lfo.shape = pick( LFO_SHAPES )[0]; s.lfo.amt = chance( 0.4 ) ? rnd( 0, 0.3 ) : 0;
	s.lfo.freq1 = s.lfo.freq2 = chance( 0.3 ); s.lfo.pw = chance( 0.3 ); s.lfo.filter = chance( 0.3 ) ? 1 : 0;
	s.dist = chance( 0.25 ) ? rnd( 0, 0.5 ) : 0;
	s.fx.a.type = chance( 0.5 ) ? pick( FX_A.slice( 1 ) ) : "off"; s.fx.a.mix = rnd( 0.15, 0.5 ); s.fx.a.p1 = rnd( 0, 1 ); s.fx.a.p2 = rnd( 0, 0.7 );
	s.fx.b.type = pick([ "hal", "roo", "pla", "spr", "off", "ddl" ]); s.fx.b.mix = rnd( 0.1, 0.4 ); s.fx.b.p1 = rnd( 0.2, 0.8 ); s.fx.b.p2 = rnd( 0.2, 0.7 );
	s.pan = rnd( 0.2, 0.8 );
}

// ---- programs: 000-015 built in (settings over the defaults), 100-109 the user's (WRITE) ----
var PROGRAMS = [
	["POLY BRASS", {"osc2":{"fine":8},"lpf":{"cutoff":900,"res":0.1,"env":0.5,"kbd":1},"fenv":{"a":0.06,"d":0.7,"s":0.45,"r":0.4},"aenv":{"a":0.02,"d":0.6,"s":0.85,"r":0.35},"slop":0.25,"fx":{"b":{"type":"roo","mix":0.2,"p1":0.4,"p2":0.4}}}],
	["SYNC LEAD", {"osc1":{"freq":12,"sync":true},"osc2":{"fine":0},"mix":{"osc1":0.9,"osc2":0.3},"lpf":{"cutoff":5000,"res":0.2,"env":0.2},"pmod":{"fenv":0.35,"freq1":true},"fenv":{"a":0.001,"d":0.9,"s":0.2,"r":0.3},"unison":{"on":true,"voices":2},"keymode":"las","glide":{"rate":0.18,"on":true,"mode":1},"lfo":{"rate":0.5,"freq1":true,"freq2":true},"fx":{"a":{"type":"ddl","mix":0.25,"p1":0.55,"p2":0.35},"b":{"type":"hal","mix":0.18,"p1":0.5,"p2":0.3}}}],
	["STRING MACHINE", {"osc1":{"shape":1,"pw":0.3},"osc2":{"shape":1,"pw":0.65,"freq":12,"fine":10},"lpf":{"cutoff":3500,"res":0.05,"env":0.1},"aenv":{"a":0.45,"d":1,"s":0.9,"r":1.2},"lfo":{"rate":0.42,"pw":true,"amt":0.45},"fx":{"a":{"type":"cho","mix":0.55,"p1":0.35,"p2":0.7},"b":{"type":"hal","mix":0.25,"p1":0.6,"p2":0.4}},"pan":0.7}],
	["FAT BASS", {"osc1":{"shape":0.5},"osc2":{"shape":1,"freq":-12,"fine":4},"mix":{"osc1":0.8,"osc2":0.6,"sub":0.6},"lpf":{"cutoff":350,"res":0.35,"env":0.45,"kbd":1},"fenv":{"a":0.001,"d":0.35,"s":0.15,"r":0.15},"aenv":{"a":0.001,"d":0.4,"s":0.85,"r":0.12},"unison":{"on":true,"voices":4},"slop":0.3,"keymode":"lor","fx":{"b":{"type":"off"}},"dist":0.15}],
	["PWM PAD", {"osc1":{"shape":1,"pw":0.4},"osc2":{"shape":1,"pw":0.55,"fine":-9},"lpf":{"cutoff":1600,"res":0.15,"env":0.2},"fenv":{"a":1.2,"d":2,"s":0.5,"r":2},"aenv":{"a":0.9,"d":1.5,"s":0.9,"r":2.5},"lfo":{"rate":0.38,"amt":0.5,"pw":true},"fx":{"a":{"type":"ph2","mix":0.45,"p1":0.25,"p2":0.6},"b":{"type":"hal","mix":0.3,"p1":0.7,"p2":0.4}},"pan":0.8}],
	["FM BELL", {"osc1":{"shape":0,"freq":12},"osc2":{"shape":0,"freq":19,"fine":0},"mix":{"osc1":0.9,"osc2":0},"pmod":{"osc2":0.35,"fenv":0.1,"freq1":true},"lpf":{"cutoff":9000,"env":0,"res":0},"fenv":{"a":0.001,"d":1.2,"s":0,"r":1},"aenv":{"a":0.001,"d":2.2,"s":0,"r":1.8},"fx":{"b":{"type":"pla","mix":0.3,"p1":0.55,"p2":0.3}}}],
	["GATED CHORDS", {"osc1":{"shape":0.5},"osc2":{"shape":1,"freq":7},"lpf":{"cutoff":2200,"env":0.2},"aenv":{"amt":0,"a":0.001,"d":0.3,"s":1,"r":0.1},"lfo":{"shape":"square","sync":true,"rate":0.86,"amt":1,"amp":true},"fx":{"a":{"type":"bbd","mix":0.3,"p1":0.6,"p2":0.4,"sync":true},"b":{"type":"roo","mix":0.2}}}],
	["SPRING KEYS", {"osc1":{"shape":0.15},"osc2":{"shape":0.35,"freq":12,"fine":3},"mix":{"osc1":0.8,"osc2":0.4},"lpf":{"cutoff":2400,"res":0.1,"env":0.4,"vel":true},"fenv":{"a":0.001,"d":0.6,"s":0.2,"r":0.4},"aenv":{"a":0.001,"d":1.6,"s":0.3,"r":0.5},"fx":{"a":{"type":"ph3","mix":0.3,"p1":0.3,"p2":0.5},"b":{"type":"spr","mix":0.35,"p1":0.6,"p2":0.6}}}],
	["ARP PULSE", {"osc1":{"shape":1,"pw":0.25},"osc2":{"shape":0.5,"freq":-12},"lpf":{"cutoff":800,"res":0.45,"env":0.5,"kbd":2},"fenv":{"a":0.001,"d":0.2,"s":0,"r":0.15},"aenv":{"a":0.001,"d":0.25,"s":0.2,"r":0.15},"arp":{"on":true,"oct":2,"mode":"updown"},"hold":true,"clock":{"bpm":118,"value":6},"fx":{"a":{"type":"ddl","mix":0.3,"p1":0.5,"p2":0.45,"sync":true},"b":{"type":"hal","mix":0.2}}}],
	["SEQ BASS", {"osc1":{"shape":0.5},"osc2":{"shape":1,"freq":-12},"mix":{"sub":0.4},"lpf":{"cutoff":500,"res":0.5,"env":0.55},"fenv":{"a":0.001,"d":0.18,"s":0.05,"r":0.1},"aenv":{"a":0.001,"d":0.2,"s":0.6,"r":0.08},"clock":{"bpm":124,"value":6},"seq":[[36],[36],[48],[-1],[36],[],[43],[46],[36],[36],[48],[-1],[39],[],[41],[43]],"fx":{"b":{"type":"off"}}}],
	["HOLLOW FLUTE", {"osc1":{"shape":0},"osc2":{"shape":0,"freq":12},"mix":{"osc1":0.8,"osc2":0.25,"noise":0.06},"hpf":{"cutoff":300,"res":0.3},"lpf":{"cutoff":2800,"env":0.15},"aenv":{"a":0.08,"d":0.5,"s":0.85,"r":0.35},"lfo":{"rate":0.5,"amt":0},"fx":{"b":{"type":"hal","mix":0.3,"p1":0.6}}}],
	["NOISE SWEEP", {"mix":{"osc1":0.2,"osc2":0,"noise":0.8},"lpf":{"cutoff":600,"res":0.75,"env":0.1},"hpf":{"cutoff":120,"res":0.2},"aenv":{"a":0.6,"d":1,"s":0.9,"r":1.8},"lfo":{"rate":0.2,"amt":0.6,"filter":1},"fx":{"a":{"type":"fl1","mix":0.4,"p1":0.15,"p2":0.8},"b":{"type":"hal","mix":0.35,"p1":0.8}}}],
	["CHORD STAB", {"osc1":{"shape":0.5},"osc2":{"shape":0.5,"fine":12},"lpf":{"cutoff":1400,"res":0.25,"env":0.45},"fenv":{"a":0.001,"d":0.3,"s":0.1,"r":0.25},"aenv":{"a":0.001,"d":0.5,"s":0.3,"r":0.3},"unison":{"on":true,"voices":7,"chord":[0,3,7,10,14]},"fx":{"a":{"type":"ddl","mix":0.2,"p1":0.4,"p2":0.3},"b":{"type":"pla","mix":0.25}}}],
	["RING BELLS", {"osc1":{"shape":0.2},"osc2":{"shape":0,"freq":12},"lpf":{"cutoff":6000,"env":0.1},"aenv":{"a":0.001,"d":1.5,"s":0,"r":1.4},"fx":{"a":{"type":"rin","mix":0.6,"p1":0.7,"p2":0.8},"b":{"type":"hal","mix":0.3,"p1":0.6}}}],
	["LOW FREQ DRONE", {"osc1":{"shape":0.7,"pw":0.4},"osc2":{"low":true,"kbd":false,"shape":0,"freq":0},"pmod":{"osc2":0.25,"pw1":true,"shape1":true,"filter":1},"lpf":{"cutoff":1200,"res":0.4,"env":0},"aenv":{"a":1.5,"d":1,"s":1,"r":3},"slop":0.35,"fx":{"a":{"type":"cho","mix":0.4},"b":{"type":"hal","mix":0.4,"p1":0.85}}}],
	["HALL PAD", {"osc1":{"shape":0.35},"osc2":{"shape":0.6,"fine":-12},"mix":{"sub":0.2},"lpf":{"cutoff":1300,"res":0.1,"env":0.25},"hpf":{"cutoff":90},"fenv":{"a":1.5,"d":2.5,"s":0.6,"r":2.5},"aenv":{"a":1.2,"d":2,"s":0.9,"r":3},"lfo":{"rate":0.3,"amt":0.15,"filter":1},"at":{"amt":0.5,"filter":1},"fx":{"a":{"type":"cho","mix":0.35,"p1":0.2,"p2":0.5},"b":{"type":"hal","mix":0.45,"p1":0.85,"p2":0.5}},"pan":0.9}]
];
function deepMerge( a, b ) { Object.keys( b ).forEach(function(k){ if(b[k] && typeof b[k] == "object" && !Array.isArray( b[k] ) && a[k] && typeof a[k] == "object") deepMerge( a[k], b[k] ); else a[k] = JSON.parse( JSON.stringify( b[k] ) ); }); }
function sound( s ) { var d = soundDefaults(), c = {}; Object.keys( d ).forEach(function(k){ c[k] = JSON.parse( JSON.stringify( s[k] ) ); }); return c; }
function progName( s, p ) { return p < 100 ? (PROGRAMS[p] ? PROGRAMS[p][0] : null) : (s.user[ p - 100 ] ? s.user[ p - 100 ].name : null); }
function loadProgram( s, p )
{
	var snd;
	if(p < 100) { if(!PROGRAMS[p]) return false; snd = soundDefaults(); deepMerge( snd, PROGRAMS[p][1] ); }
	else { var u = s.user[ p - 100 ]; if(!u) return false; snd = JSON.parse( JSON.stringify( u ) ); delete snd.name; }
	Object.keys( snd ).forEach(function(k){ s[k] = snd[k]; });
	s.prog = p; s.name = progName( s, p ); s.seq_play = false; s.seq_rec = false;
	return true;
}

// ---------------------------------------------------------------------------
// drawing

function T( text, x, y, size, color, align, bold )
{
	ctx.font = (bold === false ? "" : "bold ") + (size || 9) + "px " + FONT_UI;
	ctx.fillStyle = color || INK; ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
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
	return { hover: hover, clicked: clicked || kb.pressed, held: (ui.active === full && ui.down) || kb.held };
}

// a section: its name between two lines along its top, a hairline frame
function section( name, x0, y0, x1, y1 )
{
	ctx.strokeStyle = LINE; ctx.lineWidth = 1;
	ctx.strokeRect( x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1 );
	if(!name) return;
	ctx.font = "bold 10.5px " + FONT_UI;
	var tw = ctx.measureText( name ).width, cx = (x0 + x1) / 2, ty = y0 + 13;
	ctx.fillStyle = INK; ctx.fillRect( x0 + 8, ty, cx - tw / 2 - 8 - (x0 + 8), 1 ); ctx.fillRect( cx + tw / 2 + 8, ty, x1 - 8 - (cx + tw / 2 + 8), 1 );
	T( name, cx, ty + 0.5, 10.5, INK );
}

function led( x, y, on, half )
{
	ctx.fillStyle = on ? LED_ON : LED_OFF;
	ctx.globalAlpha = on && half ? 0.55 : 1;
	ctx.beginPath(); ctx.roundRect( x - 3.5, y - 2, 7, 4, 1 ); ctx.fill();
	if(on && !half) { ctx.fillStyle = "rgba(255,40,20,0.25)"; ctx.beginPath(); ctx.arc( x, y, 6, 0, Math.PI * 2 ); ctx.fill(); }
	ctx.globalAlpha = 1;
}

// a dark rectangular button with its red LED above and its name under it
function btn( id, cx, cy, label, lit, tooltip, o )
{
	o = o || {};
	var w = o.w || 30, h = o.h || 13, x = cx - w / 2, y = cy - h / 2;
	var r = hot( id, x, y, w, h );
	ctx.fillStyle = "#000"; ctx.fillRect( x - 1, y - 1, w + 2, h + 3 );
	var g = ctx.createLinearGradient( 0, y, 0, y + h );
	g.addColorStop( 0, r.hover ? "#4c4c4f" : "#3c3c3f" ); g.addColorStop( 1, r.hover ? "#2e2e30" : "#232325" );
	ctx.fillStyle = g; ctx.fillRect( x, y + (r.held ? 1 : 0), w, h );
	if(!o.noLed) led( cx, y - 6, lit, o.half );
	if(label) label.split( "\n" ).forEach(function(l, i){ T( l, cx, y + h + 9 + i * 9, o.small ? 7 : 7.5 ); });
	if(r.hover && tooltip) tip( tooltip, cx, y + h + (label ? 30 : 16) );
	return r;
}

// a knob with its name under it; turning it shows its value on the display
function kn( id, cx, cy, r, value, min, max, label, o )
{
	o = o || {};
	var v = knob( id, cx, cy, r, value, min, max, o );
	label.split( "\n" ).forEach(function(l, i){ T( l, cx, cy + r + 19 + i * 10, 8 ); });
	var full = id_prefix + id;
	if(ui.active === full || (ui.hot === full && v !== value))
		uiOf().show = [ o.disp ? o.disp( v ) : String( Math.round( (v - min) / (max - min) * 127 ) ), performance.now() + 1500 ];
	return v;
}

// ---- the 3 digit, 7 segment display ----
// segments a b c d e f g, as bits 1 2 4 8 16 32 64
var SEG = { "0": 63, "1": 6, "2": 91, "3": 79, "4": 102, "5": 109, "6": 125, "7": 7, "8": 127, "9": 111, "A": 119, "b": 124, "C": 57, "c": 88, "d": 94, "E": 121, "F": 113,
	"G": 61, "H": 118, "h": 116, "I": 6, "i": 4, "J": 30, "L": 56, "n": 84, "O": 63, "o": 92, "P": 115, "q": 103, "r": 80, "S": 109, "t": 120, "U": 62, "u": 28, "y": 110, "-": 64, " ": 0, "_": 8 };
function segDigit( ch, x, y, w, h, dot )
{
	var b = SEG[ ch ] !== undefined ? SEG[ ch ] : (SEG[ ch.toUpperCase() ] !== undefined ? SEG[ ch.toUpperCase() ] : 0), t = w * 0.16, sk = w * 0.12;
	var seg = [ [0, 0, 1, 0], [1, 0, 1, 0.5], [1, 0.5, 1, 1], [0, 1, 1, 1], [0, 0.5, 0, 1], [0, 0, 0, 0.5], [0, 0.5, 1, 0.5] ];
	seg.forEach(function(s, i){
		var on = b & (1 << i);
		ctx.strokeStyle = on ? "#ff3322" : "rgba(255,40,20,0.07)"; ctx.lineWidth = t; ctx.lineCap = "round";
		var px = function(u, v){ return x + u * w + (1 - v) * sk; };
		ctx.beginPath(); ctx.moveTo( px( s[0], s[1] ) + (s[0] == s[2] ? 0 : t * 0.7), y + s[1] * h + (s[1] == s[3] ? 0 : t * 0.7) );
		ctx.lineTo( px( s[2], s[3] ) - (s[0] == s[2] ? 0 : t * 0.7), y + s[3] * h - (s[1] == s[3] ? 0 : t * 0.7) ); ctx.stroke();
	});
	if(dot) { ctx.fillStyle = "#ff3322"; ctx.beginPath(); ctx.arc( x + w + t * 1.2, y + h, t * 0.6, 0, Math.PI * 2 ); ctx.fill(); }
}
function display( text, x, y )
{
	ctx.fillStyle = "#050404"; ctx.beginPath(); ctx.roundRect( x, y, 104, 54, 4 ); ctx.fill();
	ctx.fillStyle = "#1a0605"; ctx.fillRect( x + 6, y + 6, 92, 42 );
	var t = String( text ); while(t.length < 3) t = " " + t;
	ctx.save(); ctx.shadowColor = "rgba(255,40,20,0.7)"; ctx.shadowBlur = 6;
	for(var i = 0; i < 3; ++i) segDigit( t[i], x + 14 + i * 27, y + 11, 18, 32 );
	ctx.restore();
}

// what the display shows: a value being edited, a knob being turned, the step while recording, the program
function displayText()
{
	var u = uiOf(), now = performance.now();
	if(u.edit && u.edit[1] > now) return editShow( u.edit[0] );
	if(u.show && u.show[1] > now) return u.show[0];
	if(u.pend) return (now % 500 < 250) ? (u.pend == "bank" ? "b--" : (u.pend == "tens" ? "t--" : "Wr-")) : "   ";
	if(S.seq_rec) return "r" + String( Math.max( 0, ST.step || 0 ) + 1 ).padStart( 2, "0" );
	return String( S.prog ).padStart( 3, "0" );
}

// the values BANK (down) and TENS (up) step while one is being edited
var EDITS = {
	keymode: { show: function(){ return KEY_MODES.find(function(k){ return k[0] == S.keymode; })[1]; }, step: function(d){ var i = KEY_MODES.findIndex(function(k){ return k[0] == S.keymode; }); S.keymode = KEY_MODES[ Math.max( 0, Math.min( KEY_MODES.length - 1, i + d ) ) ][0]; }, name: function(){ return "KEY MODE: " + KEY_MODES.find(function(k){ return k[0] == S.keymode; })[2]; } },
	pwheel: { show: function(){ return String( S.pwheel ); }, step: function(d){ S.pwheel = int( S.pwheel + d, 0, 12 ); }, name: function(){ return "PITCH WHEEL RANGE: " + S.pwheel + " SEMITONES"; } },
	glide: { show: function(){ return GLIDE_MODES[ S.glide.mode ][0]; }, step: function(d){ S.glide.mode = int( S.glide.mode + d, 0, 3 ); }, name: function(){ return "GLIDE MODE: " + GLIDE_MODES[ S.glide.mode ][1]; } },
	unison: { show: function(){ return S.unison.voices > 6 ? "CHd" : "U " + S.unison.voices; }, step: function(d){ S.unison.voices = int( S.unison.voices + d, 1, S.unison.chord.length ? 7 : 6 ); }, name: function(){ return "UNISON: " + (S.unison.voices > 6 ? "THE CHORD MEMORY (" + S.unison.chord.length + " NOTES)" : S.unison.voices + " VOICES"); } },
	tune: { show: function(){ return (S.tune > 0 ? "" : "") + Math.round( S.tune ); }, step: function(d){ S.tune = Math.max( -50, Math.min( 50, Math.round( S.tune ) + d ) ); }, name: function(){ return "MASTER TUNE: " + Math.round( S.tune ) + " CENTS"; } }
};
function editShow( k ) { return EDITS[k].show(); }
function startEdit( k ) { var u = uiOf(); u.edit = [ k, performance.now() + 4000 ]; u.pend = null; setStatus( "MESIAH-6 " + EDITS[k].name() + " (BANK / TENS: down / up)" ); }

var pct = function(v){ return String( Math.round( v * 127 ) ); };
var bip = function(v){ return String( Math.round( v * 63 ) ); };
var tm = function(v){ return v < 1 ? Math.round( v * 1000 ) + " MS" : v.toFixed( 2 ) + " S"; };
var tmD = function(v){ return v < 1 ? String( Math.round( v * 100 ) ) : v.toFixed( 1 ); };

// ---------------------------------------------------------------------------
// the rows

function drawLeft()
{
	var u = uiOf();
	section( "", 22, 8, 176, 172 );
	S.volume = kn( "volume", 99, 78, 26, S.volume, 0, 1, "MASTER VOL", { def: 0.75, format: function(v){ return "MASTER VOLUME " + Math.round( v * 100 ) + "%"; } } );
	// GLIDE, UNISON, HOLD
	section( "", 22, 178, 176, 380 );
	S.glide.rate = kn( "glide_rate", 62, 235, 19, S.glide.rate, 0, 1, "GLIDE RATE", { def: 0.2, format: function(v){ return "GLIDE RATE " + tm( 0.005 + v * v * 4 ); } } );
	if(btn( "glide", 135, 235, "GLIDE", S.glide.on, "GLIDE ON / OFF; THEN BANK / TENS: THE GLIDE MODE (" + GLIDE_MODES[ S.glide.mode ][1] + ")" ).clicked) { S.glide.on = !S.glide.on; startEdit( "glide" ); }
	var keys = ST.keys || [];
	if(btn( "unison", 62, 320, "UNISON", S.unison.on, "UNISON: THE VOICES ON ONE NOTE (HOLD A CHORD AND PRESS IT: CHORD MEMORY). BANK / TENS: HOW MANY" ).clicked)
	{
		if(keys.length > 1 && !S.unison.on) // chord memory: the held chord, from its lowest note
		{
			var lo = Math.min.apply( null, keys );
			S.unison.chord = keys.slice().sort(function(a, b){ return a - b; }).slice( 0, 6 ).map(function(n){ return n - lo; });
			S.unison.voices = 7; S.unison.on = true;
			setStatus( "MESIAH-6: chord memory, " + S.unison.chord.length + " notes" );
		}
		else if(keys.length == 1 && !S.unison.on) { S.unison.chord = []; if(S.unison.voices > 6) S.unison.voices = 6; setStatus( "MESIAH-6: chord memory cleared" ); }
		else S.unison.on = !S.unison.on;
		startEdit( "unison" );
	}
	if(btn( "hold", 135, 320, "HOLD", S.hold, "HOLD: THE NOTES PLAYED GO ON (WITH THE ARPEGGIATOR: LATCH)" ).clicked) S.hold = !S.hold;
	// TRANSPOSE, the CV jacks
	section( "", 22, 386, 176, 588 );
	T( "TRANSPOSE", 99, 400, 8.5 );
	[-2, -1, 0, 1, 2].forEach(function(t, i){ led( 63 + i * 18, 414, S.transpose == t, Math.abs( t ) == 2 ); });
	if(btn( "tr_down", 62, 436, "DOWN", false, "TRANSPOSE THE KEYS AN OCTAVE DOWN", { noLed: true } ).clicked) S.transpose = Math.max( -2, S.transpose - 1 );
	if(btn( "tr_up", 135, 436, "UP", false, "TRANSPOSE THE KEYS AN OCTAVE UP", { noLed: true } ).clicked) S.transpose = Math.min( 2, S.transpose + 1 );
	var J = [["lpf_in", "in", "LPF", "LP FILTER IN: THE LOW-PASS CUTOFF, 1 V/OCT"], ["vol_in", "in", "VOL", "VOLUME IN: 0..5 V (UNPLUGGED: FULL)"], ["sus_in", "in", "SUS", "SUSTAIN IN: A GATE HOLDS THE NOTES"], ["seq_in", "in", "SEQ", "SEQ IN: A CLOCK, A STEP OF THE ARPEGGIATOR OR SEQUENCER EACH PULSE"],
		["pitch_out", "out", "PITCH", "PITCH OUT: THE LAST NOTE, 1 V/OCT"], ["gate_out", "out", "GATE", "GATE OUT"], ["fenv_out", "out", "F.ENV", "FILTER ENVELOPE OUT, 0..5 V"], ["lfo_out", "out", "LFO", "LFO OUT, +-5 V"]];
	T( "IN", 30, 492, 7, DIM, "left" ); T( "OUT", 30, 552, 7, DIM, "left" );
	J.forEach(function(j, i){ var x = 54 + (i % 4) * 34, y = i < 4 ? 492 : 552; jack( j[0], x, y - 10, j[1], j[2], j[3] ); T( j[2], x, y + 8, 6.5, j[1] == "out" ? INK : DIM ); });
}

// a jack, registered for the cables
function jack( id, cx, cy, type, label, tooltip )
{
	var full = id_prefix + id;
	jacks[ full ] = { x: rackX( cx ), y: rackY( cy ), type: type, label: label };
	var hover = hitCircle( cx, cy, 11 );
	if(cable_drag && cable_drag.from != full && jackCompatible( cable_drag, jacks[ full ] )) { ctx.strokeStyle = hover ? "#fff" : "rgba(255,255,255,0.3)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc( cx, cy, 12, 0, Math.PI * 2 ); ctx.stroke(); }
	ctx.fillStyle = type == "out" ? "#d8d6cf" : "#9c9a94"; ctx.beginPath(); ctx.arc( cx, cy, 9, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = hover && !cable_drag ? "#333" : "#060606"; ctx.beginPath(); ctx.arc( cx, cy, 5.5, 0, Math.PI * 2 ); ctx.fill();
	if(hover && !cable_drag) tip( tooltip, cx, cy + 24 );
}

// a destination that cycles OFF, LP, HP, LP + HP: a button with two LEDs
function filterDst( id, cx, cy, value, title )
{
	var r = btn( id, cx, cy, "FILTER", false, title + ": " + FILTER_DST[ value ], { noLed: true } );
	led( cx - 8, cy - 12, value & 1 ); led( cx + 8, cy - 12, value & 2 );
	T( "LP", cx - 8, cy - 19, 6, DIM ); T( "HP", cx + 8, cy - 19, 6, DIM );
	return r.clicked ? (value + 1) % 4 : value;
}

function drawTop()
{
	var u = uiOf(), pm = S.pmod;
	// POLY MOD
	section( "POLY MOD", 176, 8, 410, 172 );
	pm.fenv = kn( "pm_fenv", 225, 72, 19, pm.fenv, -1, 1, "FILTER ENV", { def: 0, bipolar: true, disp: bip, format: function(v){ return "POLY MOD FROM THE FILTER ENVELOPE " + Math.round( v * 100 ) + "%"; } } );
	pm.osc2 = kn( "pm_osc2", 300, 72, 19, pm.osc2, -1, 1, "OSC 2", { def: 0, bipolar: true, disp: bip, format: function(v){ return "POLY MOD FROM OSC 2 " + Math.round( v * 100 ) + "%"; } } );
	if(btn( "pm_freq1", 208, 140, "FREQ 1", pm.freq1, "POLY MOD TO OSC 1 FREQUENCY (OSC 2: FM)" ).clicked) pm.freq1 = !pm.freq1;
	if(btn( "pm_shape1", 255, 140, "SHAPE 1", pm.shape1, "POLY MOD TO OSC 1 SHAPE" ).clicked) pm.shape1 = !pm.shape1;
	if(btn( "pm_pw1", 302, 140, "PW 1", pm.pw1, "POLY MOD TO OSC 1 PULSE WIDTH" ).clicked) pm.pw1 = !pm.pw1;
	pm.filter = filterDst( "pm_filter", 365, 140, pm.filter, "POLY MOD TO THE FILTERS" );
	// CLOCK
	section( "CLOCK", 410, 8, 545, 172 );
	S.clock.bpm = kn( "bpm", 445, 72, 19, S.clock.bpm, 30, 250, "BPM", { step: 1, ticks: 12, def: 120, disp: function(v){ return String( Math.round( v ) ); }, format: function(v){ return Math.round( v ) + " BPM (MIDI CLOCK, OR A CABLE IN SEQ, WINS)"; } } );
	S.clock.value = kn( "value", 510, 72, 19, S.clock.value, 0, VALUE_N.length - 1, "VALUE", { step: 1, def: 6, disp: function(v){ return VALUE_SHOW[v]; }, format: function(v){ return "A STEP: " + VALUE_N[v]; } } );
	var tp = btn( "tap", 477, 140, "TAP TEMPO", !!ST.beat, "TAP TEMPO (" + Math.round( S.clock.bpm ) + " BPM)" );
	if(tp.clicked)
	{
		var now = performance.now();
		u.taps = u.taps.filter(function(x){ return now - x < 2500; }); u.taps.push( now );
		if(u.taps.length >= 2) { S.clock.bpm = Math.max( 30, Math.min( 250, Math.round( 60000 / ((now - u.taps[0]) / (u.taps.length - 1)) ) ) ); u.show = [ String( S.clock.bpm ), now + 1500 ]; }
	}
	// ARPEGGIATOR
	section( "ARPEGGIATOR", 545, 8, 700, 172 );
	S.arp.oct = kn( "arp_oct", 582, 72, 19, S.arp.oct, 1, 3, "OCTAVES", { step: 1, def: 1, disp: function(v){ return String( v ); }, format: function(v){ return "ARP OCTAVES " + v; } } );
	var mi = Math.max( 0, ARP_MODES.findIndex(function(m){ return m[0] == S.arp.mode; }) );
	mi = kn( "arp_mode", 660, 72, 19, mi, 0, ARP_MODES.length - 1, "MODE", { step: 1, def: 0, disp: function(v){ return ARP_MODES[v][2]; }, format: function(v){ return "ARP MODE " + ARP_MODES[v][1]; } } );
	S.arp.mode = ARP_MODES[ mi ][0];
	if(btn( "arp_on", 622, 140, "ON/OFF", S.arp.on, "THE ARPEGGIATOR ON / OFF (THE SEQUENCER PLAYING WINS)" ).clicked) S.arp.on = !S.arp.on;
	// SEQUENCER
	section( "SEQUENCER", 700, 8, 800, 172 );
	T( (S.seq || []).length + " STEPS", 750, 62, 8, DIM );
	if(S.seq_play && ST.trans) T( "TRANSPOSE " + (ST.trans > 0 ? "+" : "") + ST.trans, 750, 78, 7.5, DIM );
	if(btn( "seq_rec", 725, 140, "RECORD", S.seq_rec, S.seq_play ? "RECORD WHILE PLAYING: A KEY TRANSPOSES THE SEQUENCE (FROM C4)" : "RECORD: PLAY STEPS ON THE KEYS (A CHORD IS A STEP); TENS: A REST, OR A TIE WITH KEYS DOWN; BANK: A STEP BACK" ).clicked) S.seq_rec = !S.seq_rec;
	if(btn( "seq_play", 775, 140, "PLAY", S.seq_play, "PLAY THE SEQUENCE (" + (S.seq || []).length + " STEPS)" ).clicked)
	{
		if(!S.seq_play && !(S.seq || []).length) setStatus( "MESIAH-6: no sequence, press RECORD and play some notes" );
		else { S.seq_play = !S.seq_play; if(S.seq_play && S.seq_rec && !(S.seq || []).length) S.seq_rec = false; }
	}
	drawProgram();
	// AFTERTOUCH
	var at = S.at;
	section( "AFTERTOUCH", 1150, 8, 1350, 172 );
	at.amt = kn( "at_amt", 1250, 72, 19, at.amt, -1, 1, "AMOUNT", { def: 0, bipolar: true, disp: bip, format: function(v){ return "AFTERTOUCH AMOUNT " + Math.round( v * 100 ) + "% (MIDI CHANNEL PRESSURE)"; } } );
	if(btn( "at_freq1", 1172, 140, "FREQ 1", at.freq1, "AFTERTOUCH TO OSC 1 FREQUENCY" ).clicked) at.freq1 = !at.freq1;
	if(btn( "at_freq2", 1211, 140, "FREQ 2", at.freq2, "AFTERTOUCH TO OSC 2 FREQUENCY" ).clicked) at.freq2 = !at.freq2;
	if(btn( "at_lfo", 1250, 140, "LFO\nAMT", at.lfo, "AFTERTOUCH TO THE LFO AMOUNT" ).clicked) at.lfo = !at.lfo;
	if(btn( "at_amp", 1289, 140, "AMP", at.amp, "AFTERTOUCH TO THE AMP" ).clicked) at.amp = !at.amp;
	at.filter = filterDst( "at_filter", 1328, 140, at.filter, "AFTERTOUCH TO THE FILTERS" );
	// MISC PARAMETERS
	section( "MISC PARAMETERS", 1350, 8, 1546, 172 );
	S.pan = kn( "pan", 1400, 72, 19, S.pan, 0, 1, "PAN SPREAD", { def: 0.4, disp: pct, format: function(v){ return "PAN SPREAD " + Math.round( v * 100 ) + "%"; } } );
	S.pvol = kn( "pvol", 1494, 72, 19, S.pvol, 0, 1, "PRGM VOL", { def: 0.7, disp: pct, format: function(v){ return "PROGRAM VOLUME " + Math.round( v * 100 ) + "%"; } } );
	if(btn( "keymode", 1400, 140, "KEY MODE", u.edit && u.edit[0] == "keymode" && u.edit[1] > performance.now(), "KEY MODE (UNISON NOTE PRIORITY): " + KEY_MODES.find(function(k){ return k[0] == S.keymode; })[2] + ". THEN BANK / TENS" ).clicked) startEdit( "keymode" );
	if(btn( "pwheel", 1494, 140, "P WHL RANGE", u.edit && u.edit[0] == "pwheel" && u.edit[1] > performance.now(), "PITCH WHEEL RANGE: " + S.pwheel + " SEMITONES. THEN BANK / TENS" ).clicked) startEdit( "pwheel" );
}

// the program section: the display, BANK, TENS, 0-9, WRITE, GLOBALS
function drawProgram()
{
	var u = uiOf(), now = performance.now();
	section( "", 800, 8, 1150, 172 );
	display( displayText(), 828, 22 );
	var name = progName( S, S.prog ) || S.name || "";
	T( name, 828, 88, 8.5, INK, "left" );
	T( S.prog >= 100 ? "USER" : "FACTORY", 932, 30, 7.5, DIM, "left" );
	if(btn( "write", 1030, 46, "WRITE", u.pend == "write" && now % 500 < 250, "WRITE: SAVE THIS SOUND IN A USER PROGRAM (100-109): PRESS WRITE, THEN A NUMBER" ).clicked) u.pend = u.pend == "write" ? null : "write";
	if(btn( "globals", 1100, 46, "GLOBALS", u.edit && u.edit[0] == "tune" && u.edit[1] > now, "GLOBALS: MASTER TUNE (BANK / TENS); THE OTHER SETTINGS ARE THE RACK'S" ).clicked) startEdit( "tune" );
	T( "SELECT", 848, 112, 7, DIM ); T( "PROGRAM SELECT", 1010, 112, 7, DIM );
	ctx.fillStyle = DIM; ctx.fillRect( 880, 112, 50, 1 ); ctx.fillRect( 1052, 112, 80, 1 );
	var editing = u.edit && u.edit[1] > now;
	var bk = btn( "bank", 830, 140, "BANK", u.pend == "bank" && now % 500 < 250, editing ? "DECREMENT" : "BANK: THEN A NUMBER (0: FACTORY, 1: USER)" );
	var tn = btn( "tens", 866, 140, "TENS", u.pend == "tens" && now % 500 < 250, editing ? "INCREMENT" : "TENS: THEN A NUMBER" );
	if(bk.clicked || tn.clicked)
	{
		var d = bk.clicked ? -1 : 1;
		if(editing) { EDITS[ u.edit[0] ].step( d ); u.edit[1] = now + 4000; setStatus( "MESIAH-6 " + EDITS[ u.edit[0] ].name() ); }
		else if(S.seq_rec && !S.seq_play) send({ type: bk.clicked ? "seqBack" : "seqAdvance" });
		else u.pend = u.pend == (bk.clicked ? "bank" : "tens") ? null : (bk.clicked ? "bank" : "tens");
	}
	for(var k = 0; k < 10; ++k)
	{
		var cur = S.prog % 10 == k;
		if(btn( "p" + k, 904 + k * 23.5, 140, String( k ), cur, null, { w: 18 } ).clicked) digit( k );
	}
	if(u.edit && u.edit[1] <= now) u.edit = null;
}

function digit( k )
{
	var u = uiOf();
	if(u.pend == "write")
	{
		var snd = sound( S ); snd.name = (S.name || "SOUND").replace( / \(EDITED\)$/, "" );
		S.user[k] = snd; S.prog = 100 + k; u.pend = null;
		setStatus( "MESIAH-6: written to " + (100 + k) + " (saved with the rack)" );
		return;
	}
	if(u.pend == "bank") { u.bank = k; u.pend = null; u.show = [ k + "--", performance.now() + 1200 ]; return; }
	if(u.pend == "tens") { u.tens = k; u.pend = null; u.show = [ u.bank + "" + k + "-", performance.now() + 1200 ]; return; }
	var p = u.bank * 100 + u.tens * 10 + k;
	if(loadProgram( S, p )) setStatus( "MESIAH-6: " + String( p ).padStart( 3, "0" ) + " " + S.name );
	else setStatus( "MESIAH-6: " + String( p ).padStart( 3, "0" ) + " is empty" + (u.bank == 1 ? " (WRITE saves a sound there)" : "") );
}

function drawMid()
{
	// DISTORTION
	section( "DISTORT", 176, 178, 262, 380 );
	S.dist = kn( "dist", 219, 250, 19, S.dist, 0, 1, "AMOUNT", { def: 0, disp: pct, format: function(v){ return "DISTORTION " + Math.round( v * 100 ) + "%"; } } );
	// EFFECTS
	var fx = S.fx, ed = fx[ fx.edit ], list = fx.edit == "a" ? FX_A : FX_B;
	section( "EFFECTS", 262, 178, 580, 380 );
	if(btn( "fx_on", 297, 226, "ON/OFF", fx.on, "THE EFFECTS ON / OFF" ).clicked) fx.on = !fx.on;
	var eb = btn( "fx_edit", 297, 282, "EFFECT", false, "EDIT EFFECT A OR B (A, THEN B, IN SERIES; THE REVERBS ARE ONLY IN B)", { noLed: true } );
	led( 289, 270, fx.edit == "a" ); led( 305, 270, fx.edit == "b" ); T( "A", 289, 263, 6.5, DIM ); T( "B", 305, 263, 6.5, DIM );
	if(eb.clicked) fx.edit = fx.edit == "a" ? "b" : "a";
	var delay = ed.type == "bbd" || ed.type == "ddl";
	if(btn( "fx_sync", 297, 338, "CLOCK\nSYNC", ed.sync, "CLOCK SYNC: THE DELAY TIME IN BEATS OF THE BPM" ).clicked) ed.sync = !ed.sync;
	var ti = Math.max( 0, list.indexOf( ed.type ) );
	ti = kn( "fx_type", 360, 250, 19, ti, 0, list.length - 1, "TYPE", { step: 1, def: 0, disp: function(v){ return FX_SHOW[ list[v] ]; }, format: function(v){ return "EFFECT " + fx.edit.toUpperCase() + ": " + FX_NAME[ list[v] ]; } } );
	ed.type = list[ ti ];
	var pn = FX_PARAMS[ ed.type ];
	ed.mix = kn( "fx_mix", 420, 250, 19, ed.mix, 0, 1, "MIX", { def: 0.3, disp: pct, format: function(v){ return "MIX " + Math.round( v * 100 ) + "% WET"; } } );
	ed.p1 = kn( "fx_p1", 480, 250, 19, ed.p1, 0, 1, "1", { def: 0.4, disp: function(v){ return delay && ed.sync ? DLY_SYNC_N[ Math.round( v * (DLY_SYNC_N.length - 1) ) ] : pct( v ); }, format: function(v){ return pn[0] + " " + (delay && ed.sync ? DLY_SYNC_N[ Math.round( v * (DLY_SYNC_N.length - 1) ) ] : Math.round( v * 100 ) + "%"); } } );
	ed.p2 = kn( "fx_p2", 540, 250, 19, ed.p2, 0, 1, "2", { def: 0.35, disp: pct, format: function(v){ return pn[1] + " " + Math.round( v * 100 ) + "%"; } } );
	T( fx.edit.toUpperCase() + ": " + FX_NAME[ ed.type ], 450, 312, 7.5, DIM );
	if(ed.type != "off") { T( pn[0], 480, 330, 7, DIM ); T( pn[1], 540, 330, 7, DIM ); }
	T( "A: " + FX_SHOW[ fx.a.type ].toUpperCase() + "   B: " + FX_SHOW[ fx.b.type ].toUpperCase(), 450, 356, 7.5, fx.on ? INK : DIM );
	// OSCILLATOR 1
	var o1 = S.osc1;
	section( "OSCILLATOR 1", 580, 178, 800, 380 );
	o1.freq = kn( "o1_freq", 622, 250, 19, o1.freq, -24, 24, "FREQUENCY", { step: 1, ticks: 9, def: 0, bipolar: true, disp: function(v){ return String( v ); }, format: function(v){ return "OSC 1 " + (v > 0 ? "+" : "") + v + " SEMITONES"; } } );
	o1.shape = kn( "o1_shape", 690, 250, 19, o1.shape, 0, 1, "SHAPE", { def: 0.5, disp: pct, format: shapeName } );
	shapeMarks( 690, 250 );
	o1.pw = kn( "o1_pw", 758, 250, 19, o1.pw, 0, 1, "PULSE WIDTH", { def: 0.5, disp: pct, format: function(v){ return "OSC 1 PULSE WIDTH " + Math.round( (0.5 + (v - 0.5) * 0.92) * 100 ) + "%"; } } );
	if(btn( "o1_sync", 622, 338, "SYNC", o1.sync, "OSC 1 HARD SYNCED TO OSC 2" ).clicked) o1.sync = !o1.sync;
	// SLOP
	section( "SLOP", 800, 178, 880, 380 );
	S.slop = kn( "slop", 840, 250, 19, S.slop, 0, 1, "AMOUNT", { def: 0.15, disp: pct, format: function(v){ return "SLOP: THE OSCILLATORS AND FILTERS DRIFT, " + Math.round( v * 100 ) + "%"; } } );
	// MIXER (both rows)
	section( "MIXER", 880, 178, 1040, 588 );
	S.mix.osc1 = kn( "mx_osc1", 920, 250, 19, S.mix.osc1, 0, 1, "OSC 1", { def: 0.8, disp: pct, format: function(v){ return "OSC 1 LEVEL " + Math.round( v * 100 ) + "%"; } } );
	S.mix.osc2 = kn( "mx_osc2", 1000, 250, 19, S.mix.osc2, 0, 1, "OSC 2", { def: 0.6, disp: pct, format: function(v){ return "OSC 2 LEVEL " + Math.round( v * 100 ) + "%"; } } );
	S.mix.sub = kn( "mx_sub", 920, 460, 19, S.mix.sub, 0, 1, "SUB OCTAVE", { def: 0, disp: pct, format: function(v){ return "SUB OCTAVE (A TRIANGLE AN OCTAVE UNDER OSC 1) " + Math.round( v * 100 ) + "%"; } } );
	S.mix.noise = kn( "mx_noise", 1000, 460, 19, S.mix.noise, 0, 1, "NOISE", { def: 0, disp: pct, format: function(v){ return "NOISE " + Math.round( v * 100 ) + "%"; } } );
	// HIGH-PASS FILTER
	filterSection( "HIGH-PASS FILTER", "hp", S.hpf, 178, 20 );
	// FILTER ENVELOPE
	section( "FILTER ENVELOPE", 1270, 178, 1546, 380 );
	envKnobs( "fe", S.fenv, 1310, 250, 64 );
}

function shapeName( v ) { return "SHAPE: " + (v < 0.03 ? "TRIANGLE" : v < 0.47 ? "TRIANGLE > SAW" : v < 0.53 ? "SAWTOOTH" : v < 0.97 ? "SAW > PULSE" : "PULSE"); }
// the three wave pictures around a SHAPE knob
function shapeMarks( cx, cy )
{
	ctx.strokeStyle = DIM; ctx.lineWidth = 1.2;
	var w = function(pts, ox, oy){ ctx.beginPath(); pts.forEach(function(p, i){ i ? ctx.lineTo( ox + p[0], oy + p[1] ) : ctx.moveTo( ox + p[0], oy + p[1] ); }); ctx.stroke(); };
	w([[0, 4], [3, -4], [6, 4]], cx - 33, cy + 14);
	w([[0, 4], [6, -4], [6, 4]], cx - 3, cy - 36);
	w([[0, 4], [0, -4], [3, -4], [3, 4], [6, 4]], cx + 27, cy + 14);
}

function envKnobs( p, e, x0, y, dx, r )
{
	r = r || 19;
	var lab = ["ATTACK", "DECAY", "SUSTAIN", "RELEASE"], keys = ["a", "d", "s", "r"];
	keys.forEach(function(k, i){
		if(k == "s") e.s = kn( p + "_s", x0 + i * dx, y, r, e.s, 0, 1, lab[i], { def: 0.5, disp: pct, format: function(v){ return "SUSTAIN " + Math.round( v * 100 ) + "%"; } } );
		else e[k] = kn( p + "_" + k, x0 + i * dx, y, r, e[k], k == "a" ? 0.001 : 0.002, 10, lab[i], { exp: true, def: k == "a" ? 0.003 : 0.5, disp: tmD, format: function(v){ return lab[i] + " " + tm( v ); } } );
	});
}

function filterSection( name, id, f, y0, defCut )
{
	section( name, 1040, y0, 1270, y0 + 202 );
	var ky = y0 + 72, by = y0 + 160;
	f.cutoff = kn( id + "_cut", 1080, ky, 19, f.cutoff, 20, 20000, "CUTOFF", { exp: true, def: defCut, disp: function(v){ return v >= 1000 ? (v / 1000).toFixed( v >= 10000 ? 0 : 1 ) : String( Math.round( v ) ); }, format: function(v){ return name + " " + (v >= 1000 ? (v / 1000).toFixed( 2 ) + " KHZ" : Math.round( v ) + " HZ"); } } );
	f.res = kn( id + "_res", 1155, ky, 19, f.res, 0, 1, "RESONANCE", { def: 0, disp: pct, format: function(v){ return "RESONANCE " + Math.round( v * 100 ) + "%"; } } );
	f.env = kn( id + "_env", 1230, ky, 19, f.env, -1, 1, "ENV AMOUNT", { def: 0, bipolar: true, disp: bip, format: function(v){ return "FILTER ENVELOPE AMOUNT " + Math.round( v * 100 ) + "%"; } } );
	if(btn( id + "_vel", 1100, by, "VELOCITY", f.vel, "VELOCITY SCALES THE ENVELOPE AMOUNT" ).clicked) f.vel = !f.vel;
	var kb = btn( id + "_kbd", 1200, by, "KEYBOARD", false, "KEYBOARD TRACKING: " + ["OFF", "HALF", "FULL"][ f.kbd ], { noLed: true } );
	led( 1190, by - 12, f.kbd == 1 ); led( 1210, by - 12, f.kbd == 2 ); T( "HALF", 1190, by - 19, 6, DIM ); T( "FULL", 1210, by - 19, 6, DIM );
	if(kb.clicked) f.kbd = (f.kbd + 1) % 3;
}

function drawLow()
{
	// LOW FREQUENCY OSCILLATOR
	var L = S.lfo;
	section( "LOW FREQUENCY OSCILLATOR", 176, 386, 580, 588 );
	L.rate = kn( "lfo_rate", 222, 460, 19, L.rate, 0, 1, "FREQUENCY", { def: 0.45, disp: function(v){ return L.sync ? LFO_SYNC_N[ Math.round( v * (LFO_SYNC_N.length - 1) ) ] : (lfoHz( v ) < 10 ? lfoHz( v ).toFixed( 1 ) : String( Math.round( lfoHz( v ) ) )); },
		format: function(v){ return "LFO " + (L.sync ? LFO_SYNC_N[ Math.round( v * (LFO_SYNC_N.length - 1) ) ] + " BEATS A CYCLE" : (L.shape == "random" && v > 0.995 ? "NOISE" : lfoHz( v ).toFixed( 2 ) + " HZ")); } } );
	L.amt = kn( "lfo_amt", 292, 460, 19, L.amt, 0, 1, "INITIAL AMT", { def: 0, disp: pct, format: function(v){ return "LFO AMOUNT " + Math.round( v * 100 ) + "% (THE MOD WHEEL ADDS TO IT)"; } } );
	var si = Math.max( 0, LFO_SHAPES.findIndex(function(s){ return s[0] == L.shape; }) );
	if(btn( "lfo_shape", 445, 460, "SHAPE", false, "LFO SHAPE: " + LFO_SHAPES[ si ][1], { noLed: true } ).clicked) L.shape = LFO_SHAPES[ (si + 1) % LFO_SHAPES.length ][0];
	LFO_SHAPES.forEach(function(s, i){ var y = 418 + i * 13; led( 352, y, i == si ); T( s[1], 362, y + 0.5, 7, i == si ? INK : DIM, "left" ); });
	led( 520, 418, false ); ctx.fillStyle = "rgba(255,42,30," + (ST.lfo || 0) + ")"; ctx.beginPath(); ctx.roundRect( 516.5, 416, 7, 4, 1 ); ctx.fill(); // follows the LFO
	T( "RATE", 530, 418.5, 6.5, DIM, "left" );
	if(btn( "lfo_sync", 515, 460, "LFO SYNC", L.sync, "LFO SYNC: ITS CYCLE IN BEATS OF THE BPM (THE FIRST KEY RESTARTS IT)" ).clicked) L.sync = !L.sync;
	if(btn( "lfo_freq1", 222, 545, "FREQ 1", L.freq1, "LFO TO OSC 1 FREQUENCY" ).clicked) L.freq1 = !L.freq1;
	if(btn( "lfo_freq2", 286, 545, "FREQ 2", L.freq2, "LFO TO OSC 2 FREQUENCY" ).clicked) L.freq2 = !L.freq2;
	if(btn( "lfo_pw", 350, 545, "PW 1+2", L.pw, "LFO TO BOTH PULSE WIDTHS" ).clicked) L.pw = !L.pw;
	if(btn( "lfo_amp", 414, 545, "AMP", L.amp, "LFO TO THE AMP (TREMOLO; ENV AMOUNT AT 0: THE LFO GATES IT)" ).clicked) L.amp = !L.amp;
	L.filter = filterDst( "lfo_filter", 478, 545, L.filter, "LFO TO THE FILTERS" );
	// OSCILLATOR 2
	var o2 = S.osc2;
	section( "OSCILLATOR 2", 580, 386, 880, 588 );
	o2.freq = kn( "o2_freq", 622, 460, 19, o2.freq, -24, 24, "FREQUENCY", { step: 1, ticks: 9, def: 0, bipolar: true, disp: function(v){ return String( v ); }, format: function(v){ return "OSC 2 " + (v > 0 ? "+" : "") + v + " SEMITONES"; } } );
	o2.fine = kn( "o2_fine", 690, 460, 19, o2.fine, -50, 50, "FINE", { def: 0, bipolar: true, disp: function(v){ return String( Math.round( v ) ); }, format: function(v){ return "OSC 2 FINE " + Math.round( v ) + " CENTS"; } } );
	o2.shape = kn( "o2_shape", 758, 460, 19, o2.shape, 0, 1, "SHAPE", { def: 0.5, disp: pct, format: shapeName } );
	shapeMarks( 758, 460 );
	o2.pw = kn( "o2_pw", 830, 460, 19, o2.pw, 0, 1, "PULSE WIDTH", { def: 0.5, disp: pct, format: function(v){ return "OSC 2 PULSE WIDTH " + Math.round( (0.5 + (v - 0.5) * 0.92) * 100 ) + "%"; } } );
	if(btn( "o2_low", 640, 545, "LOW FREQ", o2.low, "LOW FREQ: OSC 2 AS A SLOW SOURCE FOR POLY MOD (IT LEAVES THE MIX)" ).clicked) o2.low = !o2.low;
	if(btn( "o2_kbd", 730, 545, "KEYBOARD", o2.kbd, "KEYBOARD: OSC 2 FOLLOWS THE NOTES (OFF: A FIXED PITCH)" ).clicked) o2.kbd = !o2.kbd;
	// LOW-PASS FILTER
	filterSection( "LOW-PASS FILTER", "lp", S.lpf, 386, 2500 );
	// AMPLIFIER ENVELOPE
	section( "AMPLIFIER ENVELOPE", 1270, 386, 1546, 588 );
	S.aenv.amt = kn( "ae_amt", 1302, 460, 17, S.aenv.amt, 0, 1, "ENV AMOUNT", { def: 1, disp: pct, format: function(v){ return "AMP ENVELOPE AMOUNT " + Math.round( v * 100 ) + "%"; } } );
	envKnobs( "ae", S.aenv, 1358, 460, 55, 17 );
	if(btn( "ae_vel", 1305, 545, "VELOCITY", S.aenv.vel, "VELOCITY SCALES THE AMP ENVELOPE AMOUNT" ).clicked) S.aenv.vel = !S.aenv.vel;
}
function lfoHz( v ) { return 0.05 * Math.pow( 5000, v ); }

function draw( mod )
{
	M = mod; S = mod.settings;
	ST = M.state = M.state || { keys: [], step: -1 };
	var u = uiOf();
	// a recording in the DSP: its steps become the sequence
	if(ST.rec && ST.rec.ver !== u.recVer) { u.recVer = ST.rec.ver; if(S.seq_rec) S.seq = cleanSeq( ST.rec.steps ); }
	var w = SIZE[0], h = SIZE[1];
	drawCasing( 0, 0, w, h );
	ctx.fillStyle = PANEL; ctx.fillRect( 22, 0, w - 44, h );
	drawLeft();
	drawTop();
	drawMid();
	drawLow();
	// the name along the front edge
	ctx.font = "bold 13px " + FONT_UI;
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "4px";
	ctx.fillStyle = INK; ctx.textAlign = "right"; ctx.textBaseline = "middle";
	ctx.fillText( "MESIAH-6", 1540, 591 );
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
	M = null; S = null; ST = null;
}

function send( msg ) { var m = M; act(function(){ m.post( msg ); }); }

WR.registerSynth( "mesiah6", {
	title: "MESIAH-6",
	description: "MESIAH-6: six voice analog polysynth with poly mod, effects, an arpeggiator and a step sequencer",
	about: "6 voices of 2 morphing oscillators, sub and noise, slop, high-pass and low-pass filters, poly mod, an LFO, distortion, two effects, unison with chord memory, an arpeggiator and a 64 step sequencer.",
	key_prio: [["^(arp_on|seq_play|seq_rec|hold|unison|tap)$", 2], ["^p\\d$", 1], ["^(bank|tens|glide|fx_on|tr_up|tr_down)$", 1], ["", 0]],
	knob_jacks: [["^lp_cut$", ["lpf_in"]], ["^volume$", ["vol_in"]]],
	category: "Synths",
	worklet: "devices/mesiah6-worklet.js",
	jacks: [[["LP FILTER", "in", "lpf_in"], ["VOLUME", "in", "vol_in"], ["SUSTAIN", "in", "sus_in"], ["SEQ", "in", "seq_in"]],
		[["PITCH", "out", "pitch_out"], ["GATE", "out", "gate_out"], ["F.ENV", "out", "fenv_out"], ["LFO", "out", "lfo_out"]]],
	rear_jacks: [["OUT L", "aout", "out_l"], ["OUT R", "aout", "out_r"]],
	audio_out: "out_l",
	audio_out_r: "out_r",
	midi_in: "midi_in",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function() { return SIZE; },
	draw: draw,
	tempo: function( s ) { return s.arp.on || s.seq_play ? s.clock.bpm : 0; },
	transport: function( mod, action, value ) {
		if(action == "trigger") mod.post({ type: "trigger", gate: value }); // T plays C4
		else if(action == "play" && (mod.settings.seq || []).length) { mod.settings.seq_play = value !== false; mod.settings.seq_rec = false; }
	},
	rear_note: function( s ) { return String( s.prog ).padStart( 3, "0" ) + " " + (s.name || "") + (s.unison.on ? " · UNISON" : "") + " · " + (s.seq || []).length + " STEPS"; }
});

})();
