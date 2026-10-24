// devices/mystic.js
// MYSTIC module, a wave-scanning polyphonic synthesizer: settings and a panel laid out in sections: CV / GATE jacks, ARPEGGIATOR, MAIN SYSTEMS (the waves after the mutants), MASTER
// CONTROL (8 LED ring encoders around an OLED, editing the module chosen in MODULE SELECT) and FILTER
// CONTROLS. Polyphonic (8 voices): it plays every note of its MIDI channel, so it has no
// sequencer of its own; the song or the keys play it. DSP in mystic-worklet.js.

(function(){

var SIZE = [1568, Math.round( 16 + (760 - 30) * (1568 - 44) / (1470 - 40) )];
var WAVE_NAMES = ["SINE", "TRIANGLE", "SAW", "SQUARE", "PULSE", "ORGAN", "VOX", "DIGITAL"];
var MUT_MODES = [["off", "OFF"], ["fm", "FM-LIN"], ["stack", "WAVSTACK"], ["sync", "OSC SYNC"], ["pw", "PW-ASYM"], ["harmonic", "HARMONIC"], ["phazdist", "PHAZDIST"]];
var F1_TYPES = [["lp24", "LP LADDER 24"], ["lp12", "LP 12"], ["bp", "BAND PASS"], ["hp", "HIGH PASS"], ["vowel", "VOWEL"], ["comb", "COMB"]];
var LFO_SHAPES = [["sine", "SINE"], ["tri", "TRIANGLE"], ["saw", "SAW DOWN"], ["ramp", "SAW UP"], ["square", "SQUARE"], ["sh", "S&H"], ["smooth", "SMOOTH"]];
var ARP_MODES = [["up", "UP"], ["down", "DOWN"], ["updown", "UP/DOWN"], ["upanddn", "UP & DOWN"], ["order", "AS PLAYED"], ["random", "RANDOM"], ["chord", "CHORD"], ["phrase", "PHRASE"]];
var ARP_DIVS = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/4T", "1/32T"]; // mystic-worklet.js: the same order
var SWINGS = [50, 52, 54, 58, 62, 66, 70, 75]; // the SWING knob's detents
// the mod matrix (mystic-worklet.js: SOURCES / DESTS, the same ids): [id, OLED name, long name]
var MOD_SRC = [["off", "OFF", "OFF"], ["env1", "ENV 1", "ENV 1"], ["env2", "ENV 2", "ENV 2"], ["env3", "ENV 3", "ENV 3"], ["env4", "ENV 4", "ENV 4"], ["env5", "ENV 5", "ENV 5"],
	["lfo1", "LFO 1", "LFO 1"], ["lfo2", "LFO 2", "LFO 2"], ["lfo3", "LFO 3", "LFO 3"], ["lfo4", "LFO 4", "LFO 4"], ["lfo5", "LFO 5", "LFO 5"],
	["vel", "VELO", "VELOCITY"], ["key", "KEYTRK", "KEYTRACK (NOTE)"], ["wheel", "MODWHL", "MOD WHEEL (CC 1)"], ["press", "PRESS", "AFTERTOUCH"], ["rand", "RANDOM", "RANDOM PER NOTE"],
	["cv1", "CV 1", "CV MOD 1 IN"], ["cv2", "CV 2", "CV MOD 2 IN"],
	["m1", "MACRO 1", "MACRO 1"], ["m2", "MACRO 2", "MACRO 2"], ["m3", "MACRO 3", "MACRO 3"], ["m4", "MACRO 4", "MACRO 4"], ["m5", "MACRO 5", "MACRO 5"], ["m6", "MACRO 6", "MACRO 6"], ["m7", "MACRO 7", "MACRO 7"], ["m8", "MACRO 8", "MACRO 8"]];
var MOD_DST = [["off", "OFF", "OFF"], ["pitch", "PITCH", "PITCH, ALL OSCS"], ["pitch1", "PITCH 1", "OSC 1 PITCH"], ["pitch2", "PITCH 2", "OSC 2 PITCH"], ["pitch3", "PITCH 3", "OSC 3 PITCH"],
	["scan1", "SCAN 1", "OSC 1 WAVSCAN"], ["scan2", "SCAN 2", "OSC 2 WAVSCAN"], ["mut1", "MUT 1", "MUTANT 1 DEPTH"], ["mut2", "MUT 2", "MUTANT 2 DEPTH"], ["mut3", "MUT 3", "MUTANT 3 DEPTH"], ["mut4", "MUT 4", "MUTANT 4 DEPTH"],
	["vol1", "VOL 1", "OSC 1 VOLUME"], ["vol2", "VOL 2", "OSC 2 VOLUME"], ["vol3", "VOL 3", "OSC 3 VOLUME"], ["ring", "RING", "RING MOD VOLUME"], ["noise", "NOISE", "NOISE VOLUME"],
	["cut1", "CUT 1", "FILTER 1 CUTOFF"], ["res1", "RES 1", "FILTER 1 RESONANCE"], ["drive1", "DRIVE", "FILTER 1 DRIVE"], ["cut2", "CUT 2", "FILTER 2 CUTOFF"], ["res2", "RES 2", "FILTER 2 RESONANCE"], ["morph", "MORPH", "FILTER 2 MORPH"],
	["amp", "AMP", "AMP LEVEL"], ["pan", "PAN", "PAN"], ["premix", "PRE MIX", "PRE-FX DRY/WET"], ["postmix", "POSTMIX", "POST-FX DRY/WET"], ["dlymix", "DLY MIX", "DELAY DRY/WET"],
	["dlyfb", "DLY FB", "DELAY FEEDBACK"], ["revmix", "REV MIX", "REVERB DRY/WET"],
	["rate1", "RATE 1", "LFO 1 RATE"], ["rate2", "RATE 2", "LFO 2 RATE"], ["rate3", "RATE 3", "LFO 3 RATE"], ["rate4", "RATE 4", "LFO 4 RATE"], ["rate5", "RATE 5", "LFO 5 RATE"]];
// PRE-FX and POST-FX: [id, name, P1 name, P2 name]
var FX_TYPES = [["off", "OFF", "PARAM 1", "PARAM 2"], ["chorus", "CHORUS", "RATE", "DEPTH"], ["flanger", "FLANGER", "RATE", "FEEDBACK"], ["phaser", "PHASER", "RATE", "FEEDBACK"],
	["tremolo", "TREMOLO", "RATE", "DEPTH"], ["lofi", "LO-FI", "BITS", "DOWNSAMPLE"], ["distort", "DISTORT", "DRIVE", "TONE"], ["comp", "COMPRESS", "AMOUNT", "RELEASE"]];
var MATRIX_SLOTS = 16, MACRO_TARGETS = 3;

var JACKS = [
	[["MOD 1","in","mod1_in"], ["MOD 2","in","mod2_in"], ["PITCH","in","pitch_in"], ["GATE","in","gate_in"], ["CLOCK","in","clock_in"]],
	[["PITCH","out","pitch_out"], ["GATE","out","gate_out"], ["MOD 1","out","env1_out"], ["MOD 2","out","lfo_out"], ["ENV 3","out","menv_out"], ["CLOCK","out","clock_out"]]
];

var M = null;

function env( a, d, s, r ) { return { dl: 0, a: a, h: 0, d: d, s: s, r: r, loop: false }; }
// the macros' first targets in a new patch: [destination, depth] (each macro has MACRO_TARGETS)
var MACRO_DEFAULTS = [["cut1", 0.5], ["res1", 0.6], ["scan1", 1], ["scan2", 1], ["mut1", 1], ["mut3", 1], ["dlymix", 0.6], ["revmix", 0.6]];

function defaults()
{
	var lfo = function(rate){ return { rate: rate, shape: "sine", gain: 1, trig: false }; };
	var fx = function(){ return { type: "off", p1: 0.5, p2: 0.5, mix: 0.5 }; };
	var matrix = [], macros = [];
	for(var i = 0; i < MATRIX_SLOTS; ++i) matrix.push({ src: "off", dst: "off", amt: 0 });
	MACRO_DEFAULTS.forEach(function(m){
		var t = [{ d: m[0], a: m[1] }];
		while(t.length < MACRO_TARGETS) t.push({ d: "off", a: 0 });
		macros.push({ v: 0, t: t });
	});
	return {
		osc: [{ wave: 2, semi: 0, cent: 0 }, { wave: 3, semi: 0, cent: 7 }, { wave: 0, semi: -12, cent: 0 }], // OSC 3: wave index
		mut: [{ mode: "fm", ratio: 2, depth: 0, wet: 1 }, { mode: "pw", ratio: 1, depth: 0, wet: 1 },     // OSC 1
		      { mode: "stack", ratio: 1, depth: 0, wet: 1 }, { mode: "sync", ratio: 2, depth: 0, wet: 1 }], // OSC 2
		mix: { osc1: 0.7, osc2: 0.5, osc3: 0, ring: 0, noise: 0 },
		f1: { type: "lp24", cutoff: 2500, res: 0.25, drive: 0.1, env: 0.35, key: 0.5 },
		f2: { morph: 0, cutoff: 16000, res: 0.1, env: 0, lfo: 0 },
		route: "series",
		env1: env( 0.005, 0.4, 0.3, 0.4 ),   // filters
		env2: env( 0.005, 0.3, 0.8, 0.5 ),   // amp
		env3: env( 0.001, 0.5, 0, 0.5 ),     // mutators and WAVSCAN
		env4: env( 0.01, 0.5, 0.5, 0.5 ),    // free (mod matrix)
		env5: env( 0.01, 0.5, 0.5, 0.5 ),
		menv: { mut: 0, scan: 0 },
		lfo: { rate: 5, shape: "sine", gain: 1, trig: false, pitch: 0, scan: 0, cutoff: 0, mut: 0 }, // LFO 1
		lfos: [lfo( 4 ), lfo( 0.5 ), lfo( 2 ), lfo( 0.2 )],                                         // LFO 2-5
		amp_lfo: 0, width: 0,
		matrix: matrix, macros: macros,
		prefx: fx(), postfx: fx(),
		vel: 0.5, volume: 0.7, voice_mode: "poly", glide: 0, sustain: false,
		arp: { on: false, mode: "up", div: 3, oct: 1, gate: 0.5, latch: false, tempo: 120, swing: 50, ratchet: 1, chance: 1 },
		delay: { on: false, time: 0.375, feedback: 0.35, tone: 5000, mix: 0.3 },
		reverb: { on: false, time: 0.6, tone: 0.5, mix: 0.25 },
		pads: { oct: 0, key: 0, scale: 1, mode: 0 },
		patch: 0,
		ui_module: "home", ui_page: 0, ui_filter: 1, ui_browse: false, shift: false // what MASTER CONTROL and FILTER CONTROLS show
	};
}

function enumOf( list, v, def ) { return list.some(function(o){ return o[0] === v; }) ? v : def; }

function validate( s, raw )
{
	var d = defaults();
	// a patch may list fewer matrix slots than there are (WR.mergeValid keeps only full arrays)
	if(raw && Array.isArray( raw.matrix ) && raw.matrix.length != MATRIX_SLOTS)
		raw.matrix.slice( 0, MATRIX_SLOTS ).forEach(function(m, i){
			if(m && typeof m == "object") s.matrix[i] = { src: String( m.src ), dst: String( m.dst ), amt: +m.amt || 0 };
		});
	s.mut.forEach(function(m){ m.mode = enumOf( MUT_MODES, m.mode, "fm" ); m.ratio = Math.min( 8, Math.max( 0.25, m.ratio ) ); });
	s.f1.type = enumOf( F1_TYPES, s.f1.type, "lp24" );
	[s.lfo].concat( s.lfos ).forEach(function(l){ l.shape = enumOf( LFO_SHAPES, l.shape, "sine" ); l.gain = Math.min( 1, Math.max( 0, l.gain ) ); l.trig = !!l.trig; });
	s.matrix.forEach(function(m){ m.src = enumOf( MOD_SRC, m.src, "off" ); m.dst = enumOf( MOD_DST, m.dst, "off" ); m.amt = Math.min( 1, Math.max( -1, m.amt ) ); });
	s.macros.forEach(function(m){ m.v = Math.min( 1, Math.max( 0, m.v ) ); m.t.forEach(function(t){ t.d = enumOf( MOD_DST, t.d, "off" ); t.a = Math.min( 1, Math.max( -1, t.a ) ); }); });
	[s.prefx, s.postfx].forEach(function(f){ f.type = enumOf( FX_TYPES, f.type, "off" ); });
	[s.env1, s.env2, s.env3, s.env4, s.env5].forEach(function(e){ e.dl = Math.max( 0, e.dl ); e.h = Math.max( 0, e.h ); e.loop = !!e.loop; });
	s.arp.mode = enumOf( ARP_MODES, s.arp.mode, "up" );
	s.arp.div = Math.min( ARP_DIVS.length - 1, Math.max( 0, Math.round( s.arp.div ) ) );
	s.arp.swing = Math.min( 75, Math.max( 50, s.arp.swing ) );
	s.arp.ratchet = Math.min( 4, Math.max( 1, Math.round( s.arp.ratchet ) ) ); s.arp.chance = Math.min( 1, Math.max( 0, s.arp.chance ) );
	s.pads.oct = Math.min( 3, Math.max( -3, Math.round( s.pads.oct ) ) ); s.pads.key = ((Math.round( s.pads.key ) % 12) + 12) % 12;
	s.pads.scale = Math.min( 15, Math.max( 0, Math.round( s.pads.scale ) ) ); s.pads.mode = s.pads.mode ? 1 : 0;
	s.patch = Math.min( PATCHES.length - 1, Math.max( 0, Math.round( s.patch ) ) );
	s.arp.oct = Math.min( 4, Math.max( 1, Math.round( s.arp.oct ) ) );
	if(s.route != "series" && s.route != "parallel") s.route = "series";
	if(s.voice_mode != "poly" && s.voice_mode != "mono") s.voice_mode = "poly";
	if(MODULE_ORDER.indexOf( s.ui_module ) < 0) s.ui_module = "home";
	s.ui_page = Math.max( 0, Math.min( pageCount( s.ui_module ) - 1, Math.round( s.ui_page ) || 0 ) );
	s.ui_filter = s.ui_filter == 2 ? 2 : 1;
	s.osc.forEach(function(o, i){ o.wave = Math.min( 7, Math.max( 0, i == 2 ? Math.round( o.wave ) : o.wave ) ); });
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	var expRnd = function(a, b) { return a * Math.pow( b / a, Math.random() ); };
	var pick = function(l) { return l[ Math.floor( Math.random() * l.length ) ]; };
	var chance = function(p) { return Math.random() < p; };
	s.osc[0].wave = rnd( 0, 7 ); s.osc[1].wave = rnd( 0, 7 ); s.osc[2].wave = Math.floor( rnd( 0, 8 ) );
	s.osc[1].semi = pick([0, 0, 7, 12, -12, 5]); s.osc[1].cent = rnd( -12, 12 );
	s.mut.forEach(function(m){
		m.mode = pick( MUT_MODES.slice( 1 ) )[0];
		m.ratio = pick([0.5, 1, 1.5, 2, 3, 4, 5, 7]);
		m.depth = chance(0.7) ? rnd( 0, 0.7 ) : 0;
		m.wet = rnd( 0.5, 1 );
	});
	s.mix.osc1 = rnd( 0.4, 0.9 ); s.mix.osc2 = rnd( 0, 0.7 ); s.mix.osc3 = chance(0.3) ? rnd( 0, 0.5 ) : 0;
	s.mix.ring = chance(0.25) ? rnd( 0, 0.5 ) : 0; s.mix.noise = chance(0.2) ? rnd( 0, 0.3 ) : 0;
	s.f1.type = pick( F1_TYPES )[0]; s.f1.cutoff = expRnd( 300, 8000 ); s.f1.res = rnd( 0, 0.7 ); s.f1.env = rnd( -0.2, 0.7 );
	s.f2.morph = chance(0.6) ? 0 : rnd( 0, 1 ); s.f2.cutoff = expRnd( 2000, 20000 );
	s.env2.a = chance(0.7) ? expRnd( 0.001, 0.02 ) : expRnd( 0.05, 1 ); s.env2.d = expRnd( 0.1, 1.5 ); s.env2.s = rnd( 0, 1 ); s.env2.r = expRnd( 0.05, 1.5 );
	s.env1.a = expRnd( 0.001, 0.3 ); s.env1.d = expRnd( 0.05, 1.5 ); s.env1.s = rnd( 0, 0.7 ); s.env1.r = expRnd( 0.05, 1 );
	s.env3.d = expRnd( 0.05, 2 ); s.menv.mut = chance(0.5) ? rnd( -0.5, 0.7 ) : 0; s.menv.scan = chance(0.4) ? rnd( -0.5, 0.5 ) : 0;
	s.lfo.rate = expRnd( 0.1, 8 ); s.lfo.shape = pick( LFO_SHAPES )[0];
	s.lfo.pitch = chance(0.2) ? rnd( 0, 0.3 ) : 0; s.lfo.scan = chance(0.4) ? rnd( 0, 0.5 ) : 0; s.lfo.mut = chance(0.3) ? rnd( 0, 0.4 ) : 0;
	// ENV 4 and LFO 3 into the mod matrix, now and then; an effect or two
	s.matrix.forEach(function(m){ m.src = "off"; m.dst = "off"; m.amt = 0; });
	s.env4.a = expRnd( 0.001, 1 ); s.env4.d = expRnd( 0.05, 1 ); s.env4.s = rnd( 0, 1 ); s.env4.loop = chance(0.3);
	s.lfos[1].rate = expRnd( 0.1, 6 ); s.lfos[1].shape = pick( LFO_SHAPES )[0];
	if(chance(0.5)) s.matrix[0] = { src: "env4", dst: pick([ "cut1", "scan1", "scan2", "mut2", "morph" ]), amt: rnd( -0.5, 0.6 ) };
	if(chance(0.5)) s.matrix[1] = { src: "lfo3", dst: pick([ "scan1", "scan2", "mut1", "mut4", "pan", "cut2" ]), amt: rnd( 0.1, 0.5 ) };
	s.prefx.type = chance(0.4) ? pick( FX_TYPES.slice( 1 ) )[0] : "off"; s.prefx.p1 = rnd( 0, 1 ); s.prefx.p2 = rnd( 0, 1 ); s.prefx.mix = rnd( 0.2, 0.7 );
	s.postfx.type = chance(0.3) ? pick([ "chorus", "phaser", "flanger", "comp" ]) : "off"; s.postfx.p1 = rnd( 0, 0.6 ); s.postfx.p2 = rnd( 0, 0.8 ); s.postfx.mix = rnd( 0.2, 0.6 );
	s.width = rnd( 0, 0.8 );
}

// ---------------------------------------------------------------------------
// the panel: CV / GATE,
// ARPEGGIATOR and FILTER CONTROLS on the left, MAIN SYSTEMS (patch encoder, left OLED), MASTER
// CONTROL (8 LED ring encoders around four OLED windows) on the right, MODULE SELECT and the 24
// pads below. The OLEDs use a 5x7 dot matrix font. Coordinates are the drawing's, scaled by X() / Y()

var KX = (1568 - 44 - 28) / (1470 - 40);
var X = function(x){ return 36 + (x - 40) * KX; }, Y = function(y){ return 8 + (y - 30) * KX; }, Sz = function(v){ return v * KX; };
var RED = "#ff4b1f", ORANGE = "#ff6a2a", WHITE = "#e9e9e9", SECTION = "#151517", TITLEBAR = "#202024", PANEL_BG = "#09090a";
var OLED = "#eaf3ff", UI_FONT = "Arial, Helvetica, sans-serif";

function t( text, x, y, size, color, align, bold )
{
	ctx.font = (bold ? "bold " : "") + Math.round( size * KX ) + "px " + UI_FONT;
	ctx.textAlign = align || "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = color || WHITE;
	ctx.fillText( text, X(x), Y(y) );
}

// a section: lighter than the panel, its name on a dark title bar
function section( title, x1, y1, x2, y2 )
{
	ctx.fillStyle = SECTION;
	ctx.beginPath(); ctx.roundRect( X(x1), Y(y1), Sz(x2 - x1), Sz(y2 - y1), 5 ); ctx.fill();
	ctx.fillStyle = TITLEBAR;
	ctx.beginPath(); ctx.roundRect( X(x1), Y(y1), Sz(x2 - x1), Sz(24), [5, 5, 0, 0] ); ctx.fill();
	t( title, (x1 + x2) / 2, y1 + 12.5, 13, RED, "center", true );
}

function hot( id, x, y, w, h )
{
	var full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x, y, w, h );
	if(hover) ui.hot = full;
	var clicked = false;
	if(hover && ui.pressed && ui.active === null) { ui.active = full; clicked = true; }
	if(padSlide( full, id_prefix + "pad", x, y, w, h )) { hover = true; clicked = true; ui.hot = full; } // sliding over from another pad
	var kb = keyButton( full, x, y, w, h ); // its key on the computer keyboard
	return { hover: hover, clicked: clicked || kb.pressed, held: (ui.active === full && ui.down) || kb.held };
}

// a black square-edged button with a bevel; access buttons have orange letters (lit: glowing),
// function buttons white; "white" is the backlit kind under the encoders
function hyButton( id, cx, cy, w, h, text, lit, kind, tooltip, disabled )
{
	var x = X(cx) - Sz(w) / 2, y = Y(cy) - Sz(h) / 2, W = Sz(w), H = Sz(h);
	var r = disabled ? { hover: !cable_drag && hitRect( x, y, W, H ) } : hot( id, x, y, W, H ), dy = r.held ? 1 : 0;
	ctx.fillStyle = "#000";
	ctx.fillRect( x - 2, y - 2, W + 4, H + 4 );
	if(kind == "white")
	{
		if(lit) { ctx.fillStyle = "rgba(230,240,255,0.16)"; ctx.fillRect( x - 5, y - 5, W + 10, H + 10 ); }
		var g = ctx.createLinearGradient( 0, y, 0, y + H );
		g.addColorStop( 0, lit ? "#ffffff" : "#7a7c80" ); g.addColorStop( 1, lit ? "#dfe6ee" : "#56585b" );
		ctx.fillStyle = g; ctx.fillRect( x, y + dy, W, H );
	}
	else
	{
		ctx.fillStyle = r.hover && !disabled ? "#2a2a2c" : "#1c1c1e";
		ctx.fillRect( x, y + dy, W, H );
		ctx.strokeStyle = lit ? (kind == "access" ? ORANGE : "#ffffff") : "#4a4a4e"; ctx.lineWidth = lit ? 1.6 : 1;
		ctx.strokeRect( x + 1.5, y + 1.5 + dy, W - 3, H - 3 );
		if(lit && kind == "access") { ctx.fillStyle = "rgba(255,106,42,0.12)"; ctx.fillRect( x, y + dy, W, H ); }
		var col = disabled ? "#5a3a30" : (kind == "access" ? (lit ? "#ffb08a" : ORANGE) : (lit ? "#ffffff" : "#d6d6d6"));
		var lines = String( text ).split( "\n" );
		ctx.font = "bold " + Math.round( (lines.length > 1 ? 8.5 : 10) * KX ) + "px " + UI_FONT;
		ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = col;
		lines.forEach(function(l, i){ ctx.fillText( l, x + W / 2, y + H / 2 + dy + (i - (lines.length - 1) / 2) * Sz(9) ); });
	}
	if(r.hover && tooltip) tip( tooltip, x + W / 2, y + H + 12 );
	return r;
}

// ---- the OLEDs: a 5x7 dot matrix font (rows, 5 bits each) ----
var FONT5 = {
	"0":[14,17,19,21,25,17,14], "1":[4,12,4,4,4,4,14], "2":[14,17,1,2,4,8,31], "3":[31,2,4,2,1,17,14], "4":[2,6,10,18,31,2,2],
	"5":[31,16,30,1,1,17,14], "6":[6,8,16,30,17,17,14], "7":[31,1,2,4,8,8,8], "8":[14,17,17,14,17,17,14], "9":[14,17,17,15,1,2,12],
	"A":[14,17,17,17,31,17,17], "B":[30,17,17,30,17,17,30], "C":[14,17,16,16,16,17,14], "D":[28,18,17,17,17,18,28], "E":[31,16,16,30,16,16,31],
	"F":[31,16,16,30,16,16,16], "G":[14,17,16,23,17,17,15], "H":[17,17,17,31,17,17,17], "I":[14,4,4,4,4,4,14], "J":[7,2,2,2,2,18,12],
	"K":[17,18,20,24,20,18,17], "L":[16,16,16,16,16,16,31], "M":[17,27,21,21,17,17,17], "N":[17,17,25,21,19,17,17], "O":[14,17,17,17,17,17,14],
	"P":[30,17,17,30,16,16,16], "Q":[14,17,17,17,21,18,13], "R":[30,17,17,30,20,18,17], "S":[15,16,16,14,1,1,30], "T":[31,4,4,4,4,4,4],
	"U":[17,17,17,17,17,17,14], "V":[17,17,17,17,17,10,4], "W":[17,17,17,21,21,21,10], "X":[17,17,10,4,10,17,17], "Y":[17,17,17,10,4,4,4],
	"Z":[31,1,2,4,8,16,31], " ":[0,0,0,0,0,0,0], ".":[0,0,0,0,0,12,12], ",":[0,0,0,0,12,4,8], "-":[0,0,0,31,0,0,0], "+":[0,4,4,31,4,4,0],
	"%":[24,25,2,4,8,19,3], "/":[0,1,2,4,8,16,0], ":":[0,12,12,0,12,12,0], ">":[8,4,2,1,2,4,8], "<":[2,4,8,16,8,4,2], "(":[2,4,8,8,8,4,2],
	")":[8,4,2,2,2,4,8], "'":[12,4,8,0,0,0,0], "&":[12,18,20,8,21,18,13], "!":[4,4,4,4,4,0,4], "?":[14,17,1,2,4,0,4], "=":[0,0,31,0,31,0,0],
	"#":[10,10,31,10,31,10,10], "*":[0,4,21,14,21,4,0], "▶":[16,24,28,30,28,24,16], "◀":[1,3,7,15,7,3,1], "|":[4,4,4,4,4,4,4],
	"_":[0,0,0,0,0,0,31], "·":[0,0,0,4,0,0,0]
};
// text in dots of size d (device px) from x, y (device px, top left); returns the width
function oledText( text, x, y, d, color, align )
{
	text = String( text ).toUpperCase();
	var w = text.length * 6 * d - d;
	if(align == "center") x -= w / 2; else if(align == "right") x -= w;
	ctx.fillStyle = color || OLED;
	var s = d * 0.86;
	for(var i = 0; i < text.length; ++i)
	{
		var g = FONT5[ text[i] ];
		if(!g) continue;
		for(var r = 0; r < 7; ++r)
		{
			var bits = g[r];
			if(!bits) continue;
			for(var c = 0; c < 5; ++c)
				if(bits & (16 >> c)) ctx.fillRect( x + (i * 6 + c) * d, y + r * d, s, s );
		}
	}
	return w;
}
function fitText( text, maxChars ) { text = String( text ); return text.length > maxChars ? text.substr( 0, maxChars ) : text; }

// ---- the modules, and the up to 8 parameters each one shows on MASTER CONTROL ----
// a parameter: [label, get(s), set(s, v), min, max, knob options]
function P( label, path, min, max, o )
{
	var keys = path.split( "." );
	var get = function(s) { var v = s; keys.forEach(function(k){ v = v[k]; }); return v; };
	var set = function(s, v) { var o2 = s; keys.slice( 0, -1 ).forEach(function(k){ o2 = o2[k]; }); o2[ keys[ keys.length - 1 ] ] = v; };
	return { label: label, get: get, set: set, min: min, max: max, o: o || {} };
}
// a parameter choosing from a list [[value, NAME], ...]
function PL( label, path, list, def )
{
	var p = P( label, path, 0, list.length - 1, { step: 1, def: def } );
	var get = p.get, set = p.set;
	p.get = function(s) { return Math.max( 0, list.findIndex(function(o){ return o[0] === get( s ); }) ); };
	p.set = function(s, v) { set( s, list[ Math.round( v ) ][0] ); };
	p.o.format = function(v){ return list[ Math.round( v ) ][1]; };
	return p;
}
var ONOFF = [[false, "OFF"], [true, "ON"]];
var fP = function(v){ return Math.round( v * 100 ) + "%"; };
var fS = function(v){ return (v > 0 ? "+" : "") + Math.round( v * 100 ); };
var fT = function(v){ return v >= 1 ? v.toFixed(2) + "S" : Math.round( v * 1000 ) + "MS"; };
var fHz = function(v){ return v >= 1000 ? (v / 1000).toFixed(1) + "K" : Math.round( v ) + "HZ"; };
var wave = function(v){ var i = Math.floor( v ), f = v - i; return f < 0.03 || i >= 7 ? WAVE_NAMES[ Math.min( 7, i ) ] : WAVE_NAMES[i].substr( 0, 3 ) + ">" + WAVE_NAMES[i + 1].substr( 0, 3 ); };
var oscParams = function(k) {
	var lv = ["mix.osc1", "mix.osc2", "mix.osc3"][k];
	var list = [
		k < 2 ? P( "WAVSCAN", "osc." + k + ".wave", 0, 7, { def: k ? 3 : 2, format: wave } ) : P( "WAVE", "osc.2.wave", 0, 7, { step: 1, def: 0, format: function(v){ return WAVE_NAMES[ v | 0 ]; } } ),
		P( "SEMITONES", "osc." + k + ".semi", -24, 24, { step: 1, def: 0, bipolar: true, format: function(v){ return (v > 0 ? "+" : "") + v; } } ),
		P( "CENTS", "osc." + k + ".cent", -50, 50, { def: 0, bipolar: true, format: function(v){ return (v > 0 ? "+" : "") + Math.round( v ); } } ),
		P( "LEVEL", lv, 0, 1, { def: [0.7, 0.5, 0][k], format: fP } )
	];
	if(k < 2) list.push( P( "ENV3>SCAN", "menv.scan", -1, 1, { def: 0, bipolar: true, format: fS } ), P( "LFO1>SCAN", "lfo.scan", 0, 1, { def: 0, format: fP } ) );
	return list;
};
var mutParams = function(i) {
	return [
		PL( "MODE", "mut." + i + ".mode", MUT_MODES ),
		P( "RATIO", "mut." + i + ".ratio", 0.25, 8, { exp: true, def: 2, format: function(v){ return v.toFixed(2); } } ),
		P( "DEPTH", "mut." + i + ".depth", 0, 1, { def: 0, format: fP } ),
		P( "DRY/WET", "mut." + i + ".wet", 0, 1, { def: 1, format: fP } ),
		P( "ENV3>MUT", "menv.mut", -1, 1, { def: 0, bipolar: true, format: fS } ),
		P( "LFO1>MUT", "lfo.mut", 0, 1, { def: 0, format: fP } )
	];
};
var fOff = function(v){ return v < 0.001 ? "OFF" : fT( v ); };
var fRate = function(v){ return v < 10 ? v.toFixed(2) + "HZ" : Math.round( v ) + "HZ"; };
// an envelope: DELAY, ATTACK, HOLD, DECAY, SUSTAIN, RELEASE, LOOP
var envParams = function(e) {
	return [ P( "DELAY", e + ".dl", 0, 4, { def: 0, format: fOff } ), P( "ATTACK", e + ".a", 0.001, 10, { exp: true, def: 0.005, format: fT } ),
		P( "HOLD", e + ".h", 0, 4, { def: 0, format: fOff } ), P( "DECAY", e + ".d", 0.002, 10, { exp: true, def: 0.4, format: fT } ),
		P( "SUSTAIN", e + ".s", 0, 1, { def: 0.5, format: fP } ), P( "RELEASE", e + ".r", 0.002, 10, { exp: true, def: 0.4, format: fT } ),
		PL( "LOOP", e + ".loop", ONOFF, 0 ) ];
};
var lfoParams = function(path, def) {
	return [ P( "RATE", path + ".rate", 0.01, 50, { exp: true, def: def, format: fRate } ), PL( "WAVE", path + ".shape", LFO_SHAPES, 0 ),
		P( "GAIN", path + ".gain", 0, 1, { def: 1, format: fP } ), PL( "TRIG", path + ".trig", [[false, "FREE"], [true, "NOTE"]], 0 ) ];
};
var fxParams = function(path) {
	var f = function(){ var x = M && M.settings[ path ]; return FX_TYPES.find(function(t){ return x && t[0] == x.type; }) || FX_TYPES[0]; };
	return [ PL( "TYPE", path + ".type", FX_TYPES, 0 ), P( f()[2], path + ".p1", 0, 1, { def: 0.5, format: fP } ),
		P( f()[3], path + ".p2", 0, 1, { def: 0.5, format: fP } ), P( "DRY/WET", path + ".mix", 0, 1, { def: 0.5, format: fP } ) ];
};
var dstName = function(id){ var d = MOD_DST.find(function(o){ return o[0] == id; }); return d ? d[1] : "OFF"; };
// MOD MATRIX: two slots a page (SOURCE, DESTINATION, DEPTH); MACRO ASSIGN: one macro a page
var matrixParams = function() {
	var list = [];
	for(var i = 0; i < MATRIX_SLOTS; ++i)
		list.push( PL( "SOURCE " + (i + 1), "matrix." + i + ".src", MOD_SRC, 0 ), PL( "DEST " + (i + 1), "matrix." + i + ".dst", MOD_DST, 0 ),
			P( "DEPTH " + (i + 1), "matrix." + i + ".amt", -1, 1, { def: 0, bipolar: true, format: fS } ), null );
	return list;
};
var macroParams = function() {
	var list = [];
	for(var i = 0; i < 8; ++i)
	{
		list.push( P( "MACRO " + (i + 1), "macros." + i + ".v", 0, 1, { def: 0, format: fP } ) );
		for(var k = 0; k < MACRO_TARGETS; ++k)
		{
			if(k == 1) list.push( null ); // the second target starts the lower row
			list.push( PL( "TARGET " + (k + 1), "macros." + i + ".t." + k + ".d", MOD_DST, k ? 0 : MOD_DST.findIndex(function(o){ return o[0] == MACRO_DEFAULTS[i][0]; }) ),
				P( "DEPTH " + (k + 1), "macros." + i + ".t." + k + ".a", -1, 1, { def: k ? 0 : MACRO_DEFAULTS[i][1], bipolar: true, format: fS } ) );
		}
	}
	return list;
};
var ARP_DIV_UI = [["1/4", 0, 6], ["1/8", 1, 2], ["1/16", 3, 4], ["1/32", 5, 7]]; // the DIVISION knob, [straight, triplet] arp.div
var MODULES = {
	// HOME: the 8 macros, named after their first target
	home: { name: "HOME", params: function(){
		var m = M ? M.settings.macros : [];
		return [0, 1, 2, 3, 4, 5, 6, 7].map(function(i){
			var d = m[i] && m[i].t[0].d != "off" ? dstName( m[i].t[0].d ) : "";
			return P( "M" + (i + 1) + " " + d, "macros." + i + ".v", 0, 1, { def: 0, format: fP } );
		}); } },
	osc1: { name: "OSC 1", params: function(){ return oscParams( 0 ); } },
	osc2: { name: "OSC 2", params: function(){ return oscParams( 1 ); } },
	osc3: { name: "OSC 3", params: function(){ return oscParams( 2 ); } },
	mut1: { name: "MUTANT 1", params: function(){ return mutParams( 0 ); } },
	mut2: { name: "MUTANT 2", params: function(){ return mutParams( 1 ); } },
	mut3: { name: "MUTANT 3", params: function(){ return mutParams( 2 ); } },
	mut4: { name: "MUTANT 4", params: function(){ return mutParams( 3 ); } },
	ring: { name: "RING-NOISE", params: function(){ return [ P( "RING MOD", "mix.ring", 0, 1, { def: 0, format: fP } ), P( "NOISE", "mix.noise", 0, 1, { def: 0, format: fP } ) ]; } },
	mixer: { name: "MIXER", params: function(){ return [ P( "OSC1 VOL", "mix.osc1", 0, 1, { def: 0.7, format: fP } ), P( "OSC2 VOL", "mix.osc2", 0, 1, { def: 0.5, format: fP } ),
		P( "OSC3 VOL", "mix.osc3", 0, 1, { def: 0, format: fP } ), P( "RING VOL", "mix.ring", 0, 1, { def: 0, format: fP } ), P( "NOISE VOL", "mix.noise", 0, 1, { def: 0, format: fP } ),
		P( "WIDTH", "width", 0, 1, { def: 0, format: fP } ) ]; } },
	filter1: { name: "FILTER 1", params: function(){ return [ PL( "TYPE", "f1.type", F1_TYPES ), P( "CUTOFF", "f1.cutoff", 20, 20000, { exp: true, def: 2500, format: fHz } ),
		P( "RESONANCE", "f1.res", 0, 1, { def: 0.25, format: fP } ), P( "DRIVE", "f1.drive", 0, 1, { def: 0.1, format: fP } ),
		P( "ENV1 AMT", "f1.env", -1, 1, { def: 0.35, bipolar: true, format: fS } ), P( "KEYTRACK", "f1.key", 0, 1, { def: 0.5, format: fP } ),
		P( "LFO1 AMT", "lfo.cutoff", 0, 1, { def: 0, format: fP } ), PL( "ROUTING", "route", [["series", "SERIES"], ["parallel", "PARALLEL"]] ) ]; } },
	filter2: { name: "FILTER 2", params: function(){ return [ P( "MORPH", "f2.morph", 0, 1, { def: 0, format: function(v){ return v < 0.25 ? "LP" : (v < 0.75 ? "BP" : "HP") + " " + Math.round( v * 100 ); } } ),
		P( "CUTOFF", "f2.cutoff", 20, 20000, { exp: true, def: 16000, format: fHz } ), P( "RESONANCE", "f2.res", 0, 1, { def: 0.1, format: fP } ),
		PL( "ROUTING", "route", [["series", "SERIES"], ["parallel", "PARALLEL"]] ),
		P( "ENV1 AMT", "f2.env", -1, 1, { def: 0, bipolar: true, format: fS } ), P( "LFO1 AMT", "f2.lfo", 0, 1, { def: 0, format: fP } ) ]; } },
	amp: { name: "AMP", params: function(){ return [ P( "ATTACK", "env2.a", 0.001, 10, { exp: true, def: 0.005, format: fT } ), P( "DECAY", "env2.d", 0.002, 10, { exp: true, def: 0.3, format: fT } ),
		P( "SUSTAIN", "env2.s", 0, 1, { def: 0.8, format: fP } ), P( "RELEASE", "env2.r", 0.002, 10, { exp: true, def: 0.5, format: fT } ),
		P( "VOLUME", "volume", 0, 1, { def: 0.7, format: fP } ), P( "VELOCITY", "vel", 0, 1, { def: 0.5, format: fP } ),
		P( "LFO2 AMT", "amp_lfo", 0, 1, { def: 0, format: fP } ), P( "WIDTH", "width", 0, 1, { def: 0, format: fP } ) ]; } },
	prefx: { name: "PRE-FX", params: function(){ return fxParams( "prefx" ); } },
	postfx: { name: "POST-FX", params: function(){ return fxParams( "postfx" ); } },
	voice: { name: "VOICE", params: function(){ return [ PL( "POLYPHONY", "voice_mode", [["poly", "POLY 8"], ["mono", "MONO"]] ), P( "GLIDE", "glide", 0, 2, { def: 0, format: function(v){ return v < 0.001 ? "OFF" : fT( v ); } } ),
		P( "VELOCITY", "vel", 0, 1, { def: 0.5, format: fP } ), P( "VOLUME", "volume", 0, 1, { def: 0.7, format: fP } ),
		P( "WIDTH", "width", 0, 1, { def: 0, format: fP } ), PL( "SUSTAIN", "sustain", ONOFF, 0 ) ]; } },
	env1: { name: "ENV 1", params: function(){ return envParams( "env1" ).concat([ P( ">FILTER 1", "f1.env", -1, 1, { def: 0.35, bipolar: true, format: fS } ), P( ">FILTER 2", "f2.env", -1, 1, { def: 0, bipolar: true, format: fS } ) ]); } },
	env2: { name: "ENV 2", params: function(){ return envParams( "env2" ).concat([ P( "VELOCITY", "vel", 0, 1, { def: 0.5, format: fP } ) ]); } },
	env3: { name: "ENV 3", params: function(){ return envParams( "env3" ).concat([ P( ">MUTANTS", "menv.mut", -1, 1, { def: 0, bipolar: true, format: fS } ), P( ">WAVSCAN", "menv.scan", -1, 1, { def: 0, bipolar: true, format: fS } ) ]); } },
	env4: { name: "ENV 4", params: function(){ return envParams( "env4" ); } },
	env5: { name: "ENV 5", params: function(){ return envParams( "env5" ); } },
	lfo1: { name: "LFO 1", params: function(){ return lfoParams( "lfo", 5 ).concat([ P( ">PITCH", "lfo.pitch", 0, 1, { def: 0, format: fP } ), P( ">WAVSCAN", "lfo.scan", 0, 1, { def: 0, format: fP } ),
		P( ">FILTER 1", "lfo.cutoff", 0, 1, { def: 0, format: fP } ), P( ">MUTANTS", "lfo.mut", 0, 1, { def: 0, format: fP } ), P( ">FILTER 2", "f2.lfo", 0, 1, { def: 0, format: fP } ) ]); } },
	lfo2: { name: "LFO 2", params: function(){ return lfoParams( "lfos.0", 4 ).concat([ P( ">AMP", "amp_lfo", 0, 1, { def: 0, format: fP } ) ]); } },
	lfo3: { name: "LFO 3", params: function(){ return lfoParams( "lfos.1", 0.5 ); } },
	lfo4: { name: "LFO 4", params: function(){ return lfoParams( "lfos.2", 2 ); } },
	lfo5: { name: "LFO 5", params: function(){ return lfoParams( "lfos.3", 0.2 ); } },
	delay: { name: "DELAY", params: function(){ return [ PL( "DELAY", "delay.on", ONOFF ), P( "TIME", "delay.time", 0.01, 2, { exp: true, def: 0.375, format: fT } ),
		P( "FEEDBACK", "delay.feedback", 0, 0.95, { def: 0.35, format: fP } ), P( "WET TONE", "delay.tone", 200, 18000, { exp: true, def: 5000, format: fHz } ), P( "DRY/WET", "delay.mix", 0, 1, { def: 0.3, format: fP } ) ]; } },
	reverb: { name: "REVERB", params: function(){ return [ PL( "REVERB", "reverb.on", ONOFF ), P( "TIME", "reverb.time", 0, 1, { def: 0.6, format: fP } ),
		P( "TONE", "reverb.tone", 0, 1, { def: 0.5, format: fP } ), P( "DRY/WET", "reverb.mix", 0, 1, { def: 0.25, format: fP } ) ]; } },
	arp: { name: "ARPEGGIATOR", params: function(){ return [ PL( "ARP", "arp.on", ONOFF ), P( "TEMPO", "arp.tempo", 30, 300, { exp: true, def: 120, format: function(v){ return Math.round( v ) + " BPM"; } } ),
		PL( "MODE", "arp.mode", ARP_MODES ), P( "OCTAVE", "arp.oct", 1, 4, { step: 1, def: 1, format: function(v){ return String( v ); } } ),
		P( "GATE", "arp.gate", 0.05, 1, { def: 0.5, format: fP } ), P( "SWING", "arp.swing", 50, 75, { def: 50, format: function(v){ return v < 50.5 ? "OFF" : Math.round( v ) + "%"; } } ),
		PL( "LATCH", "arp.latch", ONOFF ), P( "DIVISION", "arp.div", 0, 7, { step: 1, def: 3, format: function(v){ return ARP_DIVS[v]; } } ),
		P( "RATCHET", "arp.ratchet", 1, 4, { step: 1, def: 1, format: function(v){ return v + "X"; } } ), P( "CHANCE", "arp.chance", 0, 1, { def: 1, format: fP } ) ]; } },
	modmatrix: { name: "MOD MATRIX", params: matrixParams },
	macro: { name: "MACRO ASSIGN", params: macroParams }
};
var MODULE_ORDER = ["home", "osc1", "mut1", "mut2", "osc2", "mut3", "mut4", "osc3", "ring", "mixer", "filter1", "filter2", "amp", "prefx", "delay", "reverb", "postfx",
	"env1", "env2", "env3", "env4", "env5", "lfo1", "lfo2", "lfo3", "lfo4", "lfo5", "arp", "voice", "modmatrix", "macro"];
function pageCount( k ) { return Math.max( 1, Math.ceil( (MODULES[k] || MODULES.home).params().length / 8 ) ); }
function setModule( s, k, page ) { s.ui_module = k; s.ui_page = page || 0; s.ui_browse = false; }

// the patches MAIN SYSTEMS browses: settings over the defaults
var PATCHES = [
	["INIT", "INIT", {}],
	["GLASS PAD", "PAD", {"osc":[{"wave":1.6,"semi":0,"cent":-6},{"wave":4.3,"semi":12,"cent":6},{"wave":0,"semi":-12,"cent":0}],"mut":[{"mode":"stack","ratio":1.5,"depth":0.55,"wet":1},{"mode":"phazdist","ratio":1,"depth":0.3,"wet":0.7},{"mode":"stack","ratio":2,"depth":0.4,"wet":1},{"mode":"harmonic","ratio":2,"depth":0.15,"wet":0.6}],"mix":{"osc1":0.6,"osc2":0.45,"osc3":0.25,"ring":0,"noise":0.03},"f1":{"type":"lp12","cutoff":1800,"res":0.2,"drive":0,"env":0.25,"key":0.4},"f2":{"morph":0.15,"cutoff":9000,"res":0.1},"env1":{"a":1.2,"d":2,"s":0.5,"r":2},"env2":{"a":0.8,"d":1.5,"s":0.85,"r":2.5},"env3":{"a":2,"d":4},"menv":{"mut":0.3,"scan":0.25},"lfo":{"rate":0.25,"shape":"tri","pitch":0.05,"scan":0.3,"cutoff":0.1,"mut":0},"reverb":{"on":true,"time":0.8,"tone":0.5,"mix":0.4}}],
	["FM BELLS", "KEYS", {"osc":[{"wave":0,"semi":0,"cent":0},{"wave":0,"semi":12,"cent":3},{"wave":0,"semi":0,"cent":0}],"mut":[{"mode":"fm","ratio":3.5,"depth":0.55,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1},{"mode":"fm","ratio":7,"depth":0.35,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1}],"mix":{"osc1":0.7,"osc2":0.35,"osc3":0,"ring":0.1,"noise":0},"f1":{"type":"lp12","cutoff":12000,"res":0,"drive":0,"env":0,"key":0},"f2":{"morph":0,"cutoff":16000,"res":0},"env1":{"a":0.001,"d":0.5,"s":0,"r":0.5},"env2":{"a":0.001,"d":2.5,"s":0,"r":2},"env3":{"a":0.001,"d":1.2},"menv":{"mut":0.45,"scan":0},"lfo":{"rate":5,"shape":"sine","pitch":0,"scan":0,"cutoff":0,"mut":0},"vel":0.8,"reverb":{"on":true,"time":0.5,"tone":0.7,"mix":0.25}}],
	["MUTANT ARP", "ARP", {"osc":[{"wave":2,"semi":0,"cent":0},{"wave":3.5,"semi":-12,"cent":4},{"wave":0,"semi":-12,"cent":0}],"mut":[{"mode":"sync","ratio":2,"depth":0.3,"wet":1},{"mode":"pw","ratio":1,"depth":0.2,"wet":1},{"mode":"fm","ratio":2,"depth":0.15,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1}],"mix":{"osc1":0.7,"osc2":0.45,"osc3":0.3,"ring":0,"noise":0},"f1":{"type":"lp24","cutoff":900,"res":0.45,"drive":0.3,"env":0.55,"key":0.5},"f2":{"morph":0,"cutoff":16000,"res":0.1},"env1":{"a":0.001,"d":0.25,"s":0.1,"r":0.2},"env2":{"a":0.001,"d":0.3,"s":0.3,"r":0.2},"env3":{"a":0.001,"d":0.25},"menv":{"mut":0.5,"scan":0},"lfo":{"rate":0.15,"shape":"tri","pitch":0,"scan":0,"cutoff":0.3,"mut":0.2},"arp":{"on":true,"mode":"updown","div":3,"oct":2,"gate":0.45,"latch":true,"tempo":124,"swing":56},"delay":{"on":true,"time":0.36,"feedback":0.35,"tone":4000,"mix":0.25}}],
	["SUPERSAW STACK", "LEAD", {"osc":[{"wave":2,"semi":0,"cent":-5},{"wave":2,"semi":0,"cent":5},{"wave":2,"semi":-12,"cent":0}],"mut":[{"mode":"stack","ratio":2.5,"depth":0.7,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1},{"mode":"stack","ratio":3,"depth":0.6,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1}],"mix":{"osc1":0.6,"osc2":0.6,"osc3":0.3,"ring":0,"noise":0},"f1":{"type":"lp24","cutoff":4000,"res":0.15,"drive":0.2,"env":0.2,"key":0.5},"env2":{"a":0.01,"d":0.5,"s":0.8,"r":0.6},"voice_mode":"mono","glide":0.08,"delay":{"on":true,"time":0.3,"feedback":0.3,"tone":6000,"mix":0.2},"reverb":{"on":true,"time":0.5,"tone":0.6,"mix":0.2}}],
	["VOWEL CHOIR", "PAD", {"osc":[{"wave":6,"semi":0,"cent":0},{"wave":5.5,"semi":7,"cent":4},{"wave":0,"semi":-12,"cent":0}],"mut":[{"mode":"harmonic","ratio":2,"depth":0.25,"wet":0.8},{"mode":"off","ratio":1,"depth":0,"wet":1},{"mode":"stack","ratio":1.5,"depth":0.4,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1}],"mix":{"osc1":0.6,"osc2":0.5,"osc3":0.2,"ring":0,"noise":0.05},"f1":{"type":"vowel","cutoff":1200,"res":0.5,"drive":0,"env":0.3,"key":0.3},"env1":{"a":1.5,"d":3,"s":0.6,"r":2},"env2":{"a":0.6,"d":1,"s":0.9,"r":2},"lfo":{"rate":0.2,"shape":"tri","pitch":0.04,"scan":0,"cutoff":0.25,"mut":0},"reverb":{"on":true,"time":0.85,"tone":0.4,"mix":0.45}}],
	["SUB BASS", "BASS", {"osc":[{"wave":0,"semi":-12,"cent":0},{"wave":3,"semi":-12,"cent":0},{"wave":0,"semi":-24,"cent":0}],"mix":{"osc1":0.8,"osc2":0.3,"osc3":0.5,"ring":0,"noise":0},"f1":{"type":"lp24","cutoff":500,"res":0.3,"drive":0.5,"env":0.4,"key":0.3},"env1":{"a":0.001,"d":0.3,"s":0.2,"r":0.2},"env2":{"a":0.002,"d":0.4,"s":0.8,"r":0.15},"voice_mode":"mono","glide":0.03}],
	["COMB PLUCK", "PLUCK", {"osc":[{"wave":4,"semi":0,"cent":0},{"wave":2,"semi":12,"cent":0},{"wave":0,"semi":0,"cent":0}],"mut":[{"mode":"pw","ratio":1,"depth":0.4,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1}],"mix":{"osc1":0.7,"osc2":0.3,"osc3":0,"ring":0,"noise":0.2},"f1":{"type":"comb","cutoff":800,"res":0.85,"drive":0.1,"env":0.5,"key":1},"env1":{"a":0.001,"d":0.15,"s":0,"r":0.1},"env2":{"a":0.001,"d":0.9,"s":0,"r":0.6},"delay":{"on":true,"time":0.25,"feedback":0.4,"tone":3000,"mix":0.3}}]
,
	// these use the five envelopes and LFOs, the mod matrix and the effects
	["LOOP PULSE", "ARP", {"osc":[{"wave":2,"semi":0,"cent":-4},{"wave":3.4,"semi":-12,"cent":4},{"wave":0,"semi":-12,"cent":0}],"mix":{"osc1":0.7,"osc2":0.5,"osc3":0.3,"ring":0,"noise":0},"f1":{"type":"lp24","cutoff":350,"res":0.55,"drive":0.35,"env":0.1,"key":0.4},"env2":{"dl":0,"a":0.01,"h":0,"d":0.5,"s":0.9,"r":0.8,"loop":false},"env4":{"dl":0,"a":0.002,"h":0.02,"d":0.16,"s":0,"r":0.2,"loop":true},"lfos":[{"rate":4,"shape":"sine","gain":1,"trig":false},{"rate":0.15,"shape":"tri","gain":1,"trig":false},{"rate":2,"shape":"sine","gain":1,"trig":false},{"rate":0.2,"shape":"sine","gain":1,"trig":false}],"matrix":[{"src":"env4","dst":"cut1","amt":0.55},{"src":"lfo3","dst":"scan2","amt":0.4},{"src":"wheel","dst":"res1","amt":0.4}],"width":0.6,"delay":{"on":true,"time":0.3,"feedback":0.4,"tone":3500,"mix":0.25},"reverb":{"on":true,"time":0.6,"tone":0.5,"mix":0.2}}],
	["CHORUS STRINGS", "PAD", {"osc":[{"wave":2,"semi":0,"cent":-7},{"wave":2,"semi":0,"cent":7},{"wave":1,"semi":12,"cent":0}],"mut":[{"mode":"stack","ratio":2,"depth":0.5,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1},{"mode":"stack","ratio":2.5,"depth":0.5,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1}],"mix":{"osc1":0.6,"osc2":0.6,"osc3":0.15,"ring":0,"noise":0},"f1":{"type":"lp12","cutoff":3000,"res":0.1,"drive":0,"env":0.15,"key":0.5},"env1":{"dl":0,"a":0.9,"h":0,"d":2,"s":0.6,"r":1.5,"loop":false},"env2":{"dl":0,"a":0.6,"h":0,"d":1,"s":0.9,"r":1.8,"loop":false},"lfos":[{"rate":4,"shape":"sine","gain":1,"trig":false},{"rate":5.5,"shape":"tri","gain":1,"trig":false},{"rate":2,"shape":"sine","gain":1,"trig":false},{"rate":0.2,"shape":"sine","gain":1,"trig":false}],"matrix":[{"src":"lfo3","dst":"pitch","amt":0.006},{"src":"vel","dst":"cut1","amt":0.25},{"src":"wheel","dst":"pitch","amt":0.02}],"prefx":{"type":"chorus","p1":0.35,"p2":0.6,"mix":0.6},"width":0.9,"reverb":{"on":true,"time":0.75,"tone":0.5,"mix":0.3}}],
	["PHASE KEYS", "KEYS", {"osc":[{"wave":5,"semi":0,"cent":0},{"wave":0,"semi":12,"cent":2},{"wave":0,"semi":0,"cent":0}],"mix":{"osc1":0.7,"osc2":0.3,"osc3":0,"ring":0,"noise":0},"f1":{"type":"lp12","cutoff":7000,"res":0,"drive":0.2,"env":0.1,"key":0.3},"env2":{"dl":0,"a":0.003,"h":0,"d":1.2,"s":0.6,"r":0.3,"loop":false},"lfos":[{"rate":6,"shape":"sine","gain":1,"trig":false},{"rate":0.5,"shape":"sine","gain":1,"trig":false},{"rate":2,"shape":"sine","gain":1,"trig":false},{"rate":0.2,"shape":"sine","gain":1,"trig":false}],"amp_lfo":0.15,"postfx":{"type":"phaser","p1":0.3,"p2":0.5,"mix":0.6},"width":0.5,"reverb":{"on":true,"time":0.5,"tone":0.6,"mix":0.2}}],
	["WOBBLE BASS", "BASS", {"osc":[{"wave":2,"semi":-12,"cent":0},{"wave":3,"semi":-12,"cent":5},{"wave":0,"semi":-24,"cent":0}],"mut":[{"mode":"sync","ratio":1.5,"depth":0.2,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1},{"mode":"off","ratio":1,"depth":0,"wet":1}],"mix":{"osc1":0.7,"osc2":0.5,"osc3":0.5,"ring":0,"noise":0},"f1":{"type":"lp24","cutoff":300,"res":0.5,"drive":0.5,"env":0.15,"key":0.3},"env2":{"dl":0,"a":0.003,"h":0,"d":0.4,"s":0.9,"r":0.15,"loop":false},"lfos":[{"rate":4,"shape":"sine","gain":1,"trig":false},{"rate":3,"shape":"sine","gain":1,"trig":true},{"rate":2,"shape":"sine","gain":1,"trig":false},{"rate":0.2,"shape":"sine","gain":1,"trig":false}],"matrix":[{"src":"lfo3","dst":"cut1","amt":0.45},{"src":"wheel","dst":"rate3","amt":0.6},{"src":"lfo3","dst":"mut1","amt":0.3}],"voice_mode":"mono","glide":0.04,"postfx":{"type":"distort","p1":0.35,"p2":0.6,"mix":0.4}}],
	["RATCHET CHORDS", "ARP", {"osc":[{"wave":4,"semi":0,"cent":0},{"wave":2,"semi":7,"cent":5},{"wave":0,"semi":-12,"cent":0}],"mix":{"osc1":0.6,"osc2":0.4,"osc3":0.3,"ring":0,"noise":0.05},"f1":{"type":"lp24","cutoff":1500,"res":0.35,"drive":0.2,"env":0.45,"key":0.5},"env1":{"dl":0,"a":0.001,"h":0,"d":0.18,"s":0.05,"r":0.15,"loop":false},"env2":{"dl":0,"a":0.001,"h":0,"d":0.25,"s":0.2,"r":0.15,"loop":false},"lfos":[{"rate":4,"shape":"sine","gain":1,"trig":false},{"rate":0.1,"shape":"tri","gain":1,"trig":false},{"rate":2,"shape":"sine","gain":1,"trig":false},{"rate":0.2,"shape":"sine","gain":1,"trig":false}],"matrix":[{"src":"lfo3","dst":"cut1","amt":0.3},{"src":"rand","dst":"pan","amt":0.6}],"arp":{"on":true,"mode":"chord","div":3,"oct":2,"gate":0.6,"latch":true,"tempo":118,"swing":54,"ratchet":2,"chance":0.8},"postfx":{"type":"lofi","p1":0.6,"p2":0.25,"mix":0.5},"delay":{"on":true,"time":0.38,"feedback":0.4,"tone":3000,"mix":0.25}}]
];
function deepMerge( a, b ) { Object.keys( b ).forEach(function(k){ if(b[k] && typeof b[k] == "object" && !Array.isArray( b[k] ) && a[k] && typeof a[k] == "object") deepMerge( a[k], b[k] ); else if(Array.isArray( b[k] )) b[k].forEach(function(x, i){ if(x && typeof x == "object" && a[k][i]) deepMerge( a[k][i], x ); else a[k][i] = x; }); else a[k] = b[k]; }); }
function loadPatch( s, i )
{
	var d = defaults(), keep = {};
	["ui_module", "ui_page", "ui_filter", "ui_browse", "shift", "pads", "midi_channel", "midi_master", "knob_skin"].forEach(function(k){ if(s[k] !== undefined) keep[k] = s[k]; });
	deepMerge( d, JSON.parse( JSON.stringify( PATCHES[i][2] ) ) );
	Object.keys( s ).forEach(function(k){ delete s[k]; });
	Object.assign( s, d, keep );
	s.patch = i;
}

// ---- the pads: notes of a scale (SHIFT: octave, mode, key and scale, as printed under them) ----
var SCALES = [["CHROMATIC", [0,1,2,3,4,5,6,7,8,9,10,11]], ["MAJOR", [0,2,4,5,7,9,11]], ["MAJ PENT", [0,2,4,7,9]], ["MIN PENT", [0,3,5,7,10]], ["BLUES", [0,3,5,6,7,10]],
	["BEBOP", [0,2,4,5,7,9,10,11]], ["WHOLE TONE", [0,2,4,6,8,10]], ["DIM WHOLE", [0,1,3,4,6,8,10]], ["DORIAN", [0,2,3,5,7,9,10]], ["PHRYGIAN", [0,1,3,5,7,8,10]],
	["LYDIAN", [0,2,4,6,7,9,11]], ["MIXOLYDIAN", [0,2,4,5,7,9,10]], ["MINOR", [0,2,3,5,7,8,10]], ["LOCRIAN", [0,1,3,5,6,8,10]], ["HARMONIC MIN", [0,2,3,5,7,8,11]], ["MELODIC MIN", [0,2,3,5,7,9,11]]];
var PAD_LABELS = [["OCT -", "OCT +", "PAD MODE -", "PAD MODE +", "KEY", "", "", ""],
	["Dorian", "Phrygian", "Lydian", "Mixolydian", "Minor", "Locrian", "Harmonic Min", "Melodic Min"],
	["Chromatic", "Major", "Maj Pent", "Min Pent", "Blues", "Bebop", "Whole Tone", "Dim Whole"]];
var PAD_MODES = ["NOTES", "CHORDS"];
var NOTE_N = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// pad (row 0 top .. 2 bottom, col) -> its notes
function padNotes( pd, row, col )
{
	var sc = SCALES[ pd.scale ][1], idx = (2 - row) * 8 + col;
	var note = function(i){ return 48 + pd.oct * 12 + pd.key + Math.floor( i / sc.length ) * 12 + sc[ i % sc.length ]; };
	return pd.mode == 1 ? [ note( idx ), note( idx + 2 ), note( idx + 4 ) ] : [ note( idx ) ];
}

// the patch ring's colour, by category
var CAT_COLORS = { INIT: "#dfe6ee", PAD: "#4a7dff", KEYS: "#ffc83a", ARP: "#3adf7a", LEAD: "#ff4b3a", BASS: "#a855ff", PLUCK: "#ff8a2a" };

var held = {}; // module id -> pads held (their notes) / encoder drag

function drawBackground( w, h )
{
	// aluminium end cheeks, matte black panel
	[0, w - 22].forEach(function(x){
		var g = ctx.createLinearGradient( x, 0, x + 22, 0 );
		g.addColorStop( 0, "#6d7074" ); g.addColorStop( 0.45, "#d9dcdf" ); g.addColorStop( 1, "#8a8d91" );
		ctx.fillStyle = g;
		ctx.fillRect( x, 0, 22, h );
	});
	ctx.fillStyle = PANEL_BG;
	ctx.fillRect( 22, 0, w - 44, h );
	// the name: an orange wave emblem and the name in white
	var x = X(98), y = Y(58);
	ctx.fillStyle = "#ff5a1f";
	ctx.beginPath(); ctx.roundRect( x, y, Sz(64), Sz(40), 7 ); ctx.fill();
	ctx.strokeStyle = PANEL_BG; ctx.lineWidth = 3.5;
	ctx.beginPath();
	for(var i = 0; i <= 48; ++i) { var px = x + Sz(8 + i), py = y + Sz(20) - Math.sin( i / 48 * Math.PI * 2 ) * Sz(11) * (1 - i / 70); i ? ctx.lineTo( px, py ) : ctx.moveTo( px, py ); }
	ctx.stroke();
	t( "WAVE MORPHING", 130, 118, 7.5, "#8a8a8a", "center", true ); t( "SYNTHESIZER", 130, 129, 7.5, "#8a8a8a", "center", true );
	ctx.font = "bold " + Math.round( 20 * KX ) + "px " + UI_FONT;
	ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#d6d6d6";
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "4px";
	ctx.fillText( "MYSTIC", X(158), Y(200) );
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
}

function silverKnob( id, x, y, r, value, min, max, o )
{
	knob_skin = "chrome"; knob_scale_color = "#8f8f94";
	var v = knob( id, X(x), Y(y), Sz(r), value, min, max, o );
	knob_skin = M.knobSkin; knob_scale_color = null;
	return v;
}

function drawMasterVolume()
{
	M.settings.volume = silverKnob( "volume", 160, 320, 21, M.settings.volume, 0, 1, { def: 0.7, format: function(v){ return "MASTER VOLUME " + fP( v ); } } );
	t( "MASTER", 160, 360, 9, WHITE, "center", true ); t( "VOLUME", 160, 372, 9, WHITE, "center", true );
}

// a 3.5 mm jack on the top panel; registered for the cables
function miniJack( id, cx, cy, type, label )
{
	var full = id_prefix + id;
	jacks[full] = { x: rackX( cx ), y: rackY( cy ), type: type, label: label };
	var hover = hitCircle( cx, cy, 12 );
	if(cable_drag && cable_drag.from != full && jackCompatible( cable_drag, jacks[full] ))
	{
		ctx.strokeStyle = hover ? "#fff" : "rgba(255,255,255,0.3)"; ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc( cx, cy, 13, 0, Math.PI * 2 ); ctx.stroke();
	}
	var g = ctx.createLinearGradient( cx - 10, cy - 10, cx + 10, cy + 10 );
	g.addColorStop( 0, hover && !cable_drag ? "#e8e8e8" : "#c8c8c8" ); g.addColorStop( 1, "#5a5a5a" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy, 10, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = "#1a1a1a"; ctx.beginPath(); ctx.arc( cx, cy, 6.5, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc( cx, cy, 4, 0, Math.PI * 2 ); ctx.fill();
}

function drawCv()
{
	section( "CV / GATE", 272, 32, 665, 150 );
	t( "INPUTS", 340, 68, 9, WHITE, "center", true ); t( "OUTPUTS", 545, 68, 9, WHITE, "center", true );
	ctx.strokeStyle = "#5a5a60"; ctx.setLineDash && ctx.setLineDash([ 3, 3 ]); ctx.lineWidth = 1;
	ctx.beginPath(); ctx.moveTo( X(430), Y(62) ); ctx.lineTo( X(430), Y(145) ); ctx.stroke();
	ctx.setLineDash && ctx.setLineDash([]);
	var jk = [["mod1_in", "MOD 1", "in"], ["mod2_in", "MOD 2", "in"], ["pitch_in", "PITCH", "in"], ["gate_in", "GATE", "in"], ["clock_in", "CLOCK", "in"],
		["pitch_out", "PITCH", "out"], ["gate_out", "GATE", "out"], ["env1_out", "MOD 1", "out"], ["lfo_out", "MOD 2", "out"], ["menv_out", "ENV 3", "out"], ["clock_out", "CLOCK", "out"]];
	var tips = { mod1_in: "MOD 1 IN: FILTER 1 CUTOFF, 1 V/OCT", mod2_in: "MOD 2 IN: WAVSCAN, +-5 V", pitch_in: "PITCH IN: 1 V/OCT ON EVERY VOICE", gate_in: "GATE IN: PLAYS C4", clock_in: "CLOCK IN: ARPEGGIATOR STEPS",
		pitch_out: "PITCH OUT: THE LAST NOTE, 1 V/OCT", gate_out: "GATE OUT", env1_out: "MOD 1 OUT: ENV 1", lfo_out: "MOD 2 OUT: LFO 1", menv_out: "ENV 3 OUT", clock_out: "CLOCK OUT: A PULSE EACH ARP STEP" };
	jk.forEach(function(j, i){
		var x = i < 5 ? 290 + i * 32 : 452 + (i - 5) * 34;
		miniJack( j[0], X(x), Y(103), j[2], j[1] );
		t( j[1], x, 128, 7, j[2] == "out" ? "#ffffff" : "#bbbbbb", "center", true );
		if(hitCircle( X(x), Y(103), 12 )) tip( tips[ j[0] ], X(x), Y(103) + 30 );
	});
}

function drawArp()
{
	var a = M.settings.arp, sh = !!M.settings.shift;
	section( "ARPEGGIATOR", 272, 165, 665, 355 );
	// MODE, OCTAVE, DIVISION (+ TRIPLET), SWING, their printed choices
	var mi = Math.max( 0, ARP_MODES.findIndex(function(o){ return o[0] == a.mode; }) );
	mi = silverKnob( "arp_mode", 325, 248, 16, mi, 0, ARP_MODES.length - 1, { step: 1, def: 0, ticks: 8, format: function(v){ return "MODE " + ARP_MODES[v][1]; } } );
	a.mode = ARP_MODES[ mi ][0];
	// the left four from the bottom up, the right four from the top down
	["UP", "DOWN", "UP/DN", "UP&DN"].forEach(function(l, i){ t( l, 279, 247 - i * 11, 6.5, mi == i ? WHITE : "#8a8a8a", "left", true ); });
	["ORDER", "RANDOM", "CHORD", "PHRASE"].forEach(function(l, i){ t( l, 373, 214 + i * 11, 6.5, mi == 4 + i ? WHITE : "#8a8a8a", "right", true ); });
	a.oct = silverKnob( "arp_oct", 425, 248, 16, a.oct, 1, 4, { step: 1, def: 1, ticks: 4, format: function(v){ return "OCTAVE " + v; } } );
	[1, 2, 3, 4].forEach(function(n){ t( String( n ), 452, 214 + n * 9, 6.5, a.oct == n ? WHITE : "#8a8a8a", "left", true ); });
	var cur = ARP_DIV_UI.findIndex(function(d){ return d[1] == a.div || d[2] == a.div; }), trip = ARP_DIV_UI.some(function(d){ return d[2] == a.div; });
	if(cur < 0) cur = 2;
	var di = silverKnob( "arp_div", 525, 248, 16, 3 - cur, 0, 3, { step: 1, def: 1, ticks: 4, format: function(v){ return "DIVISION " + ARP_DIV_UI[ 3 - v ][0] + (trip ? "T" : ""); } } );
	a.div = ARP_DIV_UI[ 3 - di ][ trip ? 2 : 1 ];
	["1/32", "1/16", "1/8", "1/4"].forEach(function(l, i){ t( l, 500, 214 + i * 9, 6.5, di == 3 - i ? WHITE : "#8a8a8a", "right", true ); });
	var si = SWINGS.reduce(function(b, v, i){ return Math.abs( v - a.swing ) < Math.abs( SWINGS[b] - a.swing ) ? i : b; }, 0);
	var nsi = silverKnob( "arp_swing", 612, 248, 16, si, 0, 7, { step: 1, def: 0, ticks: 8, format: function(v){ return v ? "SWING " + SWINGS[v] + "%" : "SWING OFF"; } } );
	if(nsi != si) { si = nsi; a.swing = SWINGS[ si ]; } // an older patch keeps its swing until the knob moves
	["58%", "54%", "52%", "OFF"].forEach(function(l, i){ t( l, 588, 214 + i * 9, 6.5, si == 3 - i ? WHITE : "#8a8a8a", "right", true ); });
	["62%", "66%", "70%", "75%"].forEach(function(l, i){ t( l, 638, 214 + i * 9, 6.5, si == 4 + i ? WHITE : "#8a8a8a", "left", true ); });
	["MODE", "OCTAVE", "DIVISION", "SWING"].forEach(function(l, i){ t( l, [325, 425, 525, 612][i], 284, 10, WHITE, "center", true ); });
	// ON (SHIFT: EDIT), LATCH, TRIPLET, TAP TEMPO
	if(hyButton( "arp_on", 325, 325, 58, 28, "ON", a.on, "function", sh ? "EDIT: THE ARPEGGIATOR'S PAGE ON MASTER CONTROL" : "THE ARPEGGIATOR ON / OFF" ).clicked)
	{ if(sh) { setModule( M.settings, "arp" ); M.settings.shift = false; } else a.on = !a.on; }
	var sus = !!M.settings.sustain;
	if(hyButton( "arp_latch", 425, 325, 58, 28, "LATCH", sh ? sus : a.latch, "function", sh ? "SUSTAIN: HOLD THE NOTES PLAYED, LIKE A PEDAL (" + (sus ? "ON" : "OFF") + ")" : "LATCH: KEEP PLAYING AFTER THE KEYS ARE RELEASED" ).clicked)
	{
		if(sh) { M.settings.sustain = !sus; M.settings.shift = false; setStatus( "MYSTIC: sustain " + (sus ? "off" : "on") ); }
		else a.latch = !a.latch;
	}
	if(hyButton( "arp_trip", 525, 325, 58, 28, "TRIPLET", trip, "function", "TRIPLET DIVISIONS" ).clicked) a.div = ARP_DIV_UI[ 3 - di ][ trip ? 1 : 2 ];
	var tp = hyButton( "arp_tap", 612, 325, 58, 28, "TAP\nTEMPO", false, "function", "TAP THE TEMPO: " + Math.round( a.tempo ) + " BPM (MIDI CLOCK / CLOCK IN WIN)" );
	if(tp.clicked)
	{
		var now = performance.now(), tl = (held[ M.id + "tap" ] || []).filter(function(x){ return now - x < 2000; });
		tl.push( now ); held[ M.id + "tap" ] = tl;
		if(tl.length >= 2) a.tempo = Math.min( 300, Math.max( 30, Math.round( 60000 / ((now - tl[0]) / (tl.length - 1)) ) ) );
	}
	t( "EDIT", 325, 347, 7, "#8a8a8a", "center", true ); t( "SUSTAIN", 425, 347, 7, sus ? "#ffb08a" : "#8a8a8a", "center", true );
}

function drawFilterControls()
{
	var s = M.settings, f2 = s.ui_filter == 2;
	section( "FILTER CONTROLS", 272, 370, 665, 505 );
	if(f2)
	{
		s.f2.cutoff = silverKnob( "fc_cut", 330, 452, 19, s.f2.cutoff, 20, 20000, { exp: true, def: 16000, format: function(v){ return "FILTER 2 CUTOFF " + fmtHz( v ); } } );
		s.f2.res = silverKnob( "fc_res", 420, 452, 19, s.f2.res, 0, 1, { def: 0.1, format: function(v){ return "FILTER 2 RESONANCE " + fP( v ); } } );
		s.f2.morph = silverKnob( "fc_drive", 515, 452, 19, s.f2.morph, 0, 1, { def: 0, format: function(v){ return "FILTER 2 MORPH: LP > BP > HP " + fP( v ); } } );
	}
	else
	{
		s.f1.cutoff = silverKnob( "fc_cut", 330, 452, 19, s.f1.cutoff, 20, 20000, { exp: true, def: 2500, format: function(v){ return "FILTER 1 CUTOFF " + fmtHz( v ); } } );
		s.f1.res = silverKnob( "fc_res", 420, 452, 19, s.f1.res, 0, 1, { def: 0.25, format: function(v){ return "FILTER 1 RESONANCE " + fP( v ); } } );
		s.f1.drive = silverKnob( "fc_drive", 515, 452, 19, s.f1.drive, 0, 1, { def: 0.1, format: function(v){ return "FILTER 1 DRIVE " + fP( v ); } } );
	}
	["CUTOFF", "RESONANCE", "DRIVE / MORPH"].forEach(function(l, i){ t( l, [330, 420, 515][i], 492, 9, WHITE, "center", true ); });
	if(hyButton( "filt1", 610, 432, 46, 30, "FILTER\n1", !f2, "access", "THE KNOBS ON FILTER 1" ).clicked) s.ui_filter = 1;
	if(hyButton( "filt2", 610, 478, 46, 30, "FILTER\n2", f2, "access", "THE KNOBS ON FILTER 2 (DRIVE: MORPH)" ).clicked) s.ui_filter = 2;
}

// MAIN SYSTEMS: the patch encoder and the left OLED (the patch, or the module edited, or the
// browser), BROWSE, SAVE, SYSTEM SETUP, INIT, RANDOM, SHIFT, < >, HOME (SHIFT: PANIC)
function drawMainSystems()
{
	var s = M.settings, sh = !!s.shift, st = M.state || {};
	section( "MAIN SYSTEMS", 680, 32, 930, 505 );
	ctx.strokeStyle = "#4a4a50"; ctx.setLineDash && ctx.setLineDash([ 3, 3 ]); ctx.lineWidth = 1;
	ctx.beginPath(); ctx.moveTo( X(770), Y(66) ); ctx.lineTo( X(770), Y(498) ); ctx.stroke();
	ctx.setLineDash && ctx.setLineDash([]);
	var step = function(d) { loadPatch( s, ((s.patch + d) % PATCHES.length + PATCHES.length) % PATCHES.length ); setModule( s, "home" ); setStatus( "MYSTIC: " + PATCHES[ s.patch ][0] ); };
	if(hyButton( "browse", 725, 118, 58, 30, "BROWSE", !!s.ui_browse, "access", "BROWSE THE PATCHES (THE ENCODER SCROLLS)" ).clicked) s.ui_browse = !s.ui_browse;
	t( "FAVORITE", 725, 143, 7, "#8a8a8a", "center", true );
	if(hyButton( "save", 725, 200, 58, 30, "SAVE", false, "function", "PATCHES ARE SAVED WITH THE RACK (SESSIONS, SAVE AS)" ).clicked) setStatus( "MYSTIC: the sound is saved with the rack (sessions, Save as…)" );
	if(hyButton( "sysset", 725, 258, 58, 30, "SYSTEM\nSETUP", s.ui_module == "voice", "access", "SYSTEM SETUP: THE VOICE PAGE" ).clicked) setModule( s, "voice" );
	if(hyButton( "init", 725, 330, 58, 30, "INIT", false, "function", sh ? "INIT THE PATCH" : "INIT THE MODULE ON MASTER CONTROL (SHIFT: THE PATCH)" ).clicked)
	{
		if(sh || s.ui_module == "home") { loadPatch( s, 0 ); s.shift = false; setStatus( "MYSTIC: patch initialized" ); }
		else (MODULES[ s.ui_module ] || MODULES.home).params().forEach(function(p){ if(p && p.o.def !== undefined) p.set( s, p.o.def ); });
	}
	if(hyButton( "random", 725, 381, 58, 30, "RANDOM", false, "function", "A RANDOM SOUND" ).clicked) { randomize( s ); setStatus( "MYSTIC: random sound" ); }
	if(hyButton( "shift", 725, 462, 58, 30, "SHIFT", sh, "function", "SHIFT: THE PADS' SCALE FUNCTIONS, ARP EDIT, PANIC, INIT PATCH" ).clicked) s.shift = !sh;
	// the patch encoder: drag or wheel
	var cx = X(850), cy = Y(120), R = Sz(50), id = id_prefix + "patchenc", e = held[ M.id + "enc" ] = held[ M.id + "enc" ] || { a: 0 };
	var hover = !cable_drag && (ui.active === null || ui.active === id) && hitCircle( cx, cy, R );
	if(hover) { ui.hot = id; tip( "PATCH: DRAG OR WHEEL", cx, cy + R + 14 ); }
	if(hover && ui.pressed && ui.active === null) { ui.active = id; e.y = ui.y; }
	if(ui.active === id && ui.down) { var d = Math.trunc( (e.y - ui.y) / 14 ); if(d) { step( d ); e.y -= d * 14; e.a += d * 0.1; } }
	if(hover && ui.wheel && ui.active === null) { var dw = ui.wheel > 0 ? -1 : 1; step( dw ); e.a += dw * 0.1; ui.wheel = 0; }
	ctx.fillStyle = "#050505"; ctx.beginPath(); ctx.arc( cx, cy, R + Sz(9), 0, Math.PI * 2 ); ctx.fill();
	// the light ring around it, in the colour of the patch's category
	var rc = CAT_COLORS[ (PATCHES[ s.patch ] || PATCHES[0])[1] ] || "#4a7dff";
	ctx.save(); ctx.shadowColor = rc; ctx.shadowBlur = 10;
	ctx.strokeStyle = rc; ctx.lineWidth = Sz(4); ctx.beginPath(); ctx.arc( cx, cy, R + Sz(5), 0, Math.PI * 2 ); ctx.stroke();
	ctx.restore();
	ctx.fillStyle = "#050505"; ctx.beginPath(); ctx.arc( cx, cy, R + Sz(2.5), 0, Math.PI * 2 ); ctx.fill();
	var g = ctx.createRadialGradient( cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R );
	g.addColorStop( 0, "#ffffff" ); g.addColorStop( 0.55, hover ? "#d2d5d8" : "#bcc0c4" ); g.addColorStop( 1, "#6a6d72" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy, R, 0, Math.PI * 2 ); ctx.fill();
	ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 1;
	for(var k = 1; k < 9; ++k) { ctx.beginPath(); ctx.arc( cx, cy, R * k / 9, 0, Math.PI * 2 ); ctx.stroke(); }
	ctx.fillStyle = "#3a3a3a"; ctx.beginPath(); ctx.arc( cx + Math.cos( e.a * 6.28 - 1.57 ) * R * 0.7, cy + Math.sin( e.a * 6.28 - 1.57 ) * R * 0.7, Sz(4), 0, Math.PI * 2 ); ctx.fill();
	// the left OLED
	drawLeftOled( X(785), Y(240), Sz(130), Sz(100) );
	if(hyButton( "prev", 815, 380, 46, 28, "◀", false, "function", sh ? "10 PATCHES BACK" : "THE PREVIOUS PATCH" ).clicked) { step( sh ? -10 : -1 ); s.shift = false; }
	if(hyButton( "next", 885, 380, 46, 28, "▶", false, "function", sh ? "10 PATCHES ON" : "THE NEXT PATCH" ).clicked) { step( sh ? 10 : 1 ); s.shift = false; }
	t( "-10", 815, 405, 7, "#8a8a8a", "center", true ); t( "+10", 885, 405, 7, "#8a8a8a", "center", true );
	if(hyButton( "home", 850, 462, 120, 30, "HOME", s.ui_module == "home", "function", sh ? "PANIC: ALL NOTES OFF" : "HOME: THE MACROS ON MASTER CONTROL" ).clicked)
	{
		if(sh) { send({ type: "allNotesOff" }); s.shift = false; setStatus( "MYSTIC: all notes off" ); }
		else setModule( s, "home" );
	}
	t( "PANIC", 850, 489, 7, "#8a8a8a", "center", true );
}

function oledBox( x, y, w, h )
{
	ctx.fillStyle = "#000";
	ctx.fillRect( x - 3, y - 3, w + 6, h + 6 );
	ctx.fillStyle = "#020306";
	ctx.fillRect( x, y, w, h );
}

function drawLeftOled( x, y, w, h )
{
	var s = M.settings, st = M.state || {}, d = Sz(1.15);
	oledBox( x, y, w, h );
	var name = PATCHES[ s.patch ] ? PATCHES[ s.patch ] : PATCHES[0];
	if(s.ui_browse)
	{
		oledText( "BROWSE", x + 6, y + 6, d );
		for(var k = -2; k <= 2; ++k)
		{
			var i = (s.patch + k + PATCHES.length * 3) % PATCHES.length, ly = y + 26 + (k + 2) * 14;
			if(k == 0) { ctx.fillStyle = OLED; ctx.fillRect( x + 3, ly - 2, w - 6, 12 ); }
			oledText( "A" + String( 1 + i ).padStart( 3, "0" ) + " " + fitText( PATCHES[i][0], 14 ), x + 6, ly, d, k == 0 ? "#020306" : OLED );
		}
		return;
	}
	if(s.ui_module == "home")
	{
		oledText( "A" + String( 1 + s.patch ).padStart( 3, "0" ), x + 6, y + 7, d );
		oledText( name[1], x + w - 6, y + 7, d, OLED, "right" );
		var words = name[0].split( " " ), big = Sz(2.2);
		words.slice( 0, 2 ).forEach(function(wd, i){ oledText( fitText( wd, 7 ), x + w / 2, y + 26 + i * 20, big, OLED, "center" ); });
		ctx.fillStyle = "#3a4250"; ctx.fillRect( x + 6, y + h - 22, w - 12, 1 );
		oledText( (st.voices || 0) + "/8 VOICES  " + Math.round( s.arp.tempo ) + "BPM", x + w / 2, y + h - 15, d, OLED, "center" );
		return;
	}
	var mod = MODULES[ s.ui_module ] || MODULES.home, k = s.ui_module, pages = pageCount( k );
	oledText( fitText( mod.name, 15 ), x + 6, y + 7, Sz(1.4) );
	oledText( "PAGE " + (s.ui_page + 1) + "/" + pages, x + w - 6, y + h - 12, d, "#9aa6b8", "right" );
	var line = function(pts){ ctx.strokeStyle = OLED; ctx.lineWidth = 1.4; ctx.beginPath(); pts.forEach(function(p, i){ i ? ctx.lineTo( p[0], p[1] ) : ctx.moveTo( p[0], p[1] ); }); ctx.stroke(); };
	var gx = x + 8, gw = w - 16, gy = y + 24, gh = h - 44;
	// the oscillator and mutant pages draw the wave they make
	var o = { osc1: 0, mut1: 0, mut2: 0, osc2: 1, mut3: 1, mut4: 1 }[ k ];
	var pts = o !== undefined && st.wave ? st.wave[o] : null;
	if(pts) line( pts.map(function(v, i){ return [ gx + i / (pts.length - 1) * gw, y + h * 0.55 - Math.max( -1.2, Math.min( 1.2, v ) ) * h * 0.24 ]; }) );
	else if(/^env\d$/.test( k ) || k == "amp")
	{
		// the envelope: delay, attack, hold, decay, a stretch of sustain, release (times on a square root scale)
		var e = s[ k == "amp" ? "env2" : k ], q = function(v){ return Math.sqrt( Math.max( 0, v ) ); };
		var seg = [q( e.dl ), q( e.a ), q( e.h ), q( e.d ), 0.8, q( e.r )], tot = seg.reduce(function(a, b){ return a + b; }, 0) || 1;
		var X0 = gx, lv = [0, 1, 1, e.s, e.s, 0], P2 = [[X0, gy + gh]];
		seg.forEach(function(v, i){ X0 += v / tot * gw; P2.push([ X0, gy + gh - lv[i] * gh ]); });
		line( P2 );
		if(e.loop) oledText( "LOOP", gx + gw, gy - 2, d, OLED, "right" );
	}
	else if(/^lfo\d$/.test( k ))
	{
		var l = k == "lfo1" ? s.lfo : s.lfos[ +k[3] - 2 ], sh2 = l.shape, P3 = [];
		for(var i = 0; i <= 64; ++i)
		{
			var ph = (i / 64 * 2) % 1, v = sh2 == "tri" ? 1 - 4 * Math.abs( ph - 0.5 ) : sh2 == "saw" ? 1 - 2 * ph : sh2 == "ramp" ? 2 * ph - 1 :
				sh2 == "square" ? (ph < 0.5 ? 1 : -1) : sh2 == "sh" ? [0.6, -0.4, 0.9, -0.8][ Math.floor( i / 16 ) % 4 ] : sh2 == "smooth" ? Math.sin( i / 64 * 9 ) * 0.7 : Math.sin( ph * Math.PI * 2 );
			P3.push([ gx + i / 64 * gw, gy + gh / 2 - v * l.gain * gh * 0.45 ]);
		}
		line( P3 );
		var lv2 = st.lfos ? st.lfos[ +k[3] - 1 ] : 0;
		ctx.fillStyle = OLED; ctx.fillRect( gx + gw - 4, gy + gh / 2 - lv2 * gh * 0.45 - 2, 4, 4 );
	}
	else if(k == "modmatrix")
	{
		// the page's two slots in words, and how many are in use
		for(var j = 0; j < 2; ++j)
		{
			var n = s.ui_page * 2 + j, m = s.matrix[n], src = MOD_SRC.find(function(o2){ return o2[0] == m.src; }), dst = MOD_DST.find(function(o2){ return o2[0] == m.dst; });
			oledText( (n + 1) + " " + (m.src == "off" || m.dst == "off" ? "-" : src[1] + ">" + dst[1]), x + 6, y + 28 + j * 16, d );
		}
		oledText( s.matrix.filter(function(m2){ return m2.src != "off" && m2.dst != "off" && m2.amt; }).length + "/16 IN USE", x + 6, y + 62, d, "#9aa6b8" );
	}
	else if(k == "macro")
	{
		var mc = s.macros[ s.ui_page ];
		oledText( "MACRO " + (s.ui_page + 1) + " " + fP( mc.v ), x + 6, y + 28, d );
		mc.t.forEach(function(t2, j){ if(t2.d != "off") oledText( ">" + dstName( t2.d ) + " " + fS( t2.a ), x + 6, y + 44 + j * 12, d ); });
	}
	else oledText( fitText( "A" + String( 1 + s.patch ).padStart( 3, "0" ) + " " + name[0], 17 ), x + 6, y + 30, d );
}

// MASTER CONTROL: 8 LED ring encoders, the white buttons (reset the parameter), the four OLED
// windows; EXIT (home), VOICE, PAGE (the previous / next module), MACRO ASSIGN, MOD MATRIX
function drawMasterControl()
{
	var s = M.settings, mod = MODULES[ s.ui_module ] || MODULES.home, pages = pageCount( s.ui_module );
	if(s.ui_page >= pages) s.ui_page = pages - 1;
	var params = mod.params().slice( s.ui_page * 8, s.ui_page * 8 + 8 );
	section( "MASTER CONTROL", 945, 32, 1470, 505 );
	var cols = [1005, 1090, 1178, 1265];
	// the OLED band: four windows, a reflection across
	var bx = X(952), by = Y(240), bw = Sz(406), bh = Sz(100);
	ctx.fillStyle = "#000"; ctx.fillRect( bx, by, bw, bh );
	cols.forEach(function(c){ oledBox( X(c) - Sz(43), by + Sz(8), Sz(86), bh - Sz(16) ); });
	for(var k = 0; k < 8; ++k)
	{
		var p = params[k], col = k % 4, top = k < 4;
		var cx = cols[ col ], ky = top ? 128 : 462, btnY = top ? 197 : 380;
		var wx = X(cx), wy = by + Sz(8) + (top ? Sz(5) : Sz(46)), d = Sz(1.05), D = Sz(1.7);
		if(p)
		{
			var v = p.get( s ), o = {};
			for(var key in p.o) o[key] = p.o[key];
			o.format = (function(pp){ return function(val){ return pp.label + ": " + (pp.o.format ? pp.o.format( val ) : val); }; })( p );
			var nv = knob( "enc" + k, X(cx), Y(ky), Sz(21), v, p.min, p.max, o );
			if(nv !== v) p.set( s, nv );
			oledText( fitText( p.label, 12 ), wx, wy, d, OLED, "center" );
			oledText( fitText( p.o.format ? p.o.format( p.get( s ) ) : String( p.get( s ) ), 7 ), wx, wy + Sz(14), D, OLED, "center" );
			if(hyButton( "encbtn" + k, cx, btnY, 46, 22, "", true, "white", "RESET " + p.label ).clicked && p.o.def !== undefined) p.set( s, p.o.def );
		}
		else
		{
			drawSkinKnob( "ledring", X(cx), Y(ky), Sz(21), -1, false );
			oledText( "-", wx, wy + Sz(10), d, "#3a4250", "center" );
			hyButton( "encbtn" + k, cx, btnY, 46, 22, "", false, "white" );
		}
		t( String( k + 1 ), cx, top ? btnY + 24 : btnY - 26, 9, WHITE, "center", true );
	}
	// the separators between the top and bottom parameters
	ctx.fillStyle = "#4a5466";
	cols.forEach(function(c){ ctx.fillRect( X(c) - Sz(36), by + bh / 2, Sz(72), 1 ); });
	// a reflection on the glass
	ctx.save();
	ctx.beginPath(); ctx.rect( bx, by, bw, bh ); ctx.clip();
	ctx.fillStyle = "rgba(255,255,255,0.035)";
	ctx.beginPath(); ctx.moveTo( bx, by ); ctx.lineTo( bx + bw * 0.62, by ); ctx.lineTo( bx + bw * 0.46, by + bh ); ctx.lineTo( bx, by + bh ); ctx.fill();
	ctx.restore();
	var i = MODULE_ORDER.indexOf( s.ui_module );
	if(hyButton( "exit", 1408, 118, 50, 28, "EXIT", false, "function", "EXIT: HOME" ).clicked) setModule( s, "home" );
	if(hyButton( "voice", 1408, 198, 50, 28, "VOICE", s.ui_module == "voice", "access", "THE VOICE PAGE: POLYPHONY, GLIDE, WIDTH, SUSTAIN" ).clicked) setModule( s, "voice" );
	ctx.fillStyle = "#000"; ctx.fillRect( X(1378), Y(238), Sz(60), Sz(104) );
	// PAGE: through the module's pages, then on to the next module
	if(hyButton( "page_up", 1408, 258, 44, 26, "▲", false, "function", "THE PREVIOUS PAGE" ).clicked)
	{
		if(s.ui_page > 0) s.ui_page--;
		else { var k = MODULE_ORDER[ (i + MODULE_ORDER.length - 1) % MODULE_ORDER.length ]; setModule( s, k, pageCount( k ) - 1 ); }
	}
	if(hyButton( "page_down", 1408, 300, 44, 26, "▼", false, "function", "THE NEXT PAGE" ).clicked)
	{
		if(s.ui_page < pages - 1) s.ui_page++;
		else setModule( s, MODULE_ORDER[ (i + 1) % MODULE_ORDER.length ] );
	}
	t( "PAGE", 1408, 330, 9, WHITE, "center", true );
	if(hyButton( "macro", 1408, 380, 50, 30, "MACRO\nASSIGN", s.ui_module == "macro", "access", "MACRO ASSIGN: THE TARGETS OF EACH MACRO (PAGE: THE NEXT MACRO)" ).clicked) setModule( s, "macro" );
	if(hyButton( "modmatrix", 1408, 462, 50, 30, "MOD\nMATRIX", s.ui_module == "modmatrix", "access", "MOD MATRIX: 16 SLOTS, SOURCE > DESTINATION (PAGE: THE NEXT TWO)" ).clicked) setModule( s, "modmatrix" );
}

// MODULE SELECT: the signal flow; a button shows its module on MASTER CONTROL
function drawModuleSelect()
{
	var s = M.settings;
	ctx.fillStyle = SECTION;
	ctx.beginPath(); ctx.roundRect( X(70), Y(525), Sz(700), Sz(220), 5 ); ctx.fill();
	ctx.fillStyle = TITLEBAR; ctx.beginPath(); ctx.roundRect( X(70), Y(525), Sz(180), Sz(24), [5, 0, 5, 0] ); ctx.fill();
	t( "MODULE SELECT", 160, 537.5, 13, RED, "center", true );
	var B = function(k, x, y, label, missing) {
		var r = hyButton( "mod_" + k, x, y, 56, 30, label, s.ui_module == k, "access", missing ? label.replace( "\n", " " ) + ": NOT HERE" : (MODULES[k] || {}).name + " ON MASTER CONTROL", missing );
		if(!missing && r.clicked) setModule( s, k );
	};
	ctx.strokeStyle = "#5a5a60"; ctx.lineWidth = Sz(3);
	var L = function(pts){ ctx.beginPath(); pts.forEach(function(p, i){ i ? ctx.lineTo( X(p[0]), Y(p[1]) ) : ctx.moveTo( X(p[0]), Y(p[1]) ); }); ctx.stroke(); };
	L([[103, 585], [265, 585]]); L([[103, 634], [265, 634]]); L([[103, 684], [190, 684], [190, 720], [305, 720], [305, 634]]);
	L([[265, 585], [305, 585], [305, 684], [265, 684]]); L([[305, 634], [333, 634]]);
	L([[333, 634], [380, 634], [380, 610], [420, 610]]); L([[380, 634], [380, 657], [420, 657]]);
	L([[420, 610], [460, 610], [460, 657], [420, 657]]); L([[460, 634], [730, 634]]); L([[620, 634], [620, 610], [690, 610], [690, 657], [620, 657]]);
	L([[390, 553], [770, 553]]); L([[390, 712], [770, 712]]);
	ctx.setLineDash && ctx.setLineDash([ 3, 3 ]); ctx.lineWidth = 1;
	L([[420, 568], [420, 595]]); L([[420, 672], [420, 698]]);
	ctx.setLineDash && ctx.setLineDash([]);
	B( "osc1", 103, 585, "OSC\n1" ); B( "mut1", 180, 585, "MUTANT\n1" ); B( "mut2", 265, 585, "MUTANT\n2" );
	B( "osc2", 103, 634, "OSC\n2" ); B( "mut3", 180, 634, "MUTANT\n3" ); B( "mut4", 265, 634, "MUTANT\n4" );
	B( "osc3", 103, 684, "OSC\n3" ); B( "ring", 265, 684, "RING-\nNOISE" ); B( "mixer", 333, 634, "MIXER" );
	B( "env1", 420, 553, "ENV\n1" ); B( "env2", 497, 553, "ENV\n2" ); B( "env3", 575, 553, "ENV\n3" ); B( "env4", 652, 553, "ENV\n4" ); B( "env5", 730, 553, "ENV\n5" );
	B( "filter1", 420, 610, "FILTER\n1" ); B( "filter2", 420, 657, "FILTER\n2" ); B( "amp", 497, 634, "AMP" );
	B( "prefx", 575, 634, "PRE-FX" ); B( "delay", 652, 610, "DELAY" ); B( "reverb", 652, 657, "REVERB" ); B( "postfx", 730, 634, "POST-FX" );
	B( "lfo1", 420, 712, "LFO\n1" ); B( "lfo2", 497, 712, "LFO\n2" ); B( "lfo3", 575, 712, "LFO\n3" ); B( "lfo4", 652, 712, "LFO\n4" ); B( "lfo5", 730, 712, "LFO\n5" );
}

// the 24 pads: notes of the scale (CHORDS: triads); with SHIFT, what is printed under them
function drawPads()
{
	var s = M.settings, pd = s.pads, sh = !!s.shift, map = held[ M.id ] = held[ M.id ] || {};
	ctx.fillStyle = SECTION;
	ctx.beginPath(); ctx.roundRect( X(790), Y(525), Sz(680), Sz(220), 5 ); ctx.fill();
	for(var row = 0; row < 3; ++row)
		for(var col = 0; col < 8; ++col)
		{
			var cx = 833 + col * 80.3, cy = 563 + row * 71, w = 62, h = 50;
			var x = X(cx) - Sz(w) / 2, y = Y(cy) - Sz(h) / 2, id = "pad" + row + "_" + col;
			var r = hot( id, x, y, Sz(w), Sz(h) );
			var notes = padNotes( pd, row, col ), root = ((notes[0] - pd.key) % 12 + 12) % 12 == 0;
			var fn = sh && (row > 0 ? (row == 1 ? 8 + col : col) == pd.scale : false);
			var lit = r.held ? 1 : (sh ? (row == 0 ? (col < 5 ? 0.35 : 0) : (fn ? 1 : 0.35)) : (root ? 0.55 : 0.25));
			ctx.fillStyle = "#000"; ctx.fillRect( x - 2, y - 2, Sz(w) + 4, Sz(h) + 4 );
			if(lit > 0.9) { ctx.fillStyle = "rgba(220,235,255,0.18)"; ctx.fillRect( x - 6, y - 6, Sz(w) + 12, Sz(h) + 12 ); }
			var c = Math.round( 70 + lit * 175 );
			var tint = sh ? [c, c, c] : (root ? [Math.round( c * 0.86 ), Math.round( c * 0.9 ), c] : [c, c, c]);
			ctx.fillStyle = "rgb(" + tint.join(",") + ")";
			ctx.fillRect( x, y + (r.held ? 1 : 0), Sz(w), Sz(h) );
			var lab = PAD_LABELS[row][col];
			if(lab) t( lab, cx, cy + 33, 7, row == 0 && col == 4 ? "#000" : "#bdbdbd", "center", true );
			if(row == 0 && col == 4) { ctx.fillStyle = "#9a9a9a"; ctx.fillRect( X(cx) - Sz(14), Y(cy + 28), Sz(28), Sz(10) ); t( "KEY", cx, cy + 33, 7, "#111", "center", true ); }
			if(r.hover) tip( sh ? (lab ? lab.toUpperCase() : "-") : notes.map(function(n){ return NOTE_N[ n % 12 ] + (Math.floor( n / 12 ) - 1); }).join(" "), X(cx), y + Sz(h) + 16 );
			if(r.clicked && sh)
			{
				if(row == 0)
				{
					if(col == 0) pd.oct = Math.max( -3, pd.oct - 1 ); else if(col == 1) pd.oct = Math.min( 3, pd.oct + 1 );
					else if(col == 2 || col == 3) pd.mode = (pd.mode + 1) % PAD_MODES.length;
					else if(col == 4) pd.key = (pd.key + 1) % 12;
				}
				else pd.scale = row == 1 ? 8 + col : col;
				setStatus( "MYSTIC pads: " + NOTE_N[ pd.key ] + " " + SCALES[ pd.scale ][0] + ", " + PAD_MODES[ pd.mode ] + ", octave " + (pd.oct >= 0 ? "+" : "") + pd.oct );
			}
			else if(r.clicked) { map[id] = notes; notes.forEach(function(n){ send({ type: "note", note: n, on: true, vel: 1 }); }); }
			if(map[id] && !r.held) { map[id].forEach(function(n){ send({ type: "note", note: n, on: false }); }); delete map[id]; }
		}
}

function drawPanel()
{
	var w = SIZE[0], h = SIZE[1];
	M.knobSkin = knob_skin;
	drawBackground( w, h );
	drawMasterVolume();
	drawCv();
	drawArp();
	drawFilterControls();
	drawMainSystems();
	knob_skin = M.knobSkin;
	drawMasterControl();
	drawModuleSelect();
	drawPads();
}

function send( msg ) { var m = M; act(function(){ m.post( msg ); }); }

WR.registerSynth( "mystic", {
	title: "MYSTIC",
	description: "MYSTIC: polyphonic wave morphing synthesizer with mutators",
	about: "8 voices, wave-scanning oscillators with mutants, two filters, five envelopes and LFOs, a 16 slot mod matrix, 8 macros, four effects in stereo, an arpeggiator. Edit pages around an OLED.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^pad\\d_\\d$", 3], ["^(arp_on|arp_latch|arp_tap|home|prev|next)$", 2], ["^(shift|random|arp_trip|filt[12]|page_up|page_down|exit)$", 1], ["^mod_", 1], ["^(encbtn\\d|save|sysset|browse|init|macro|modmatrix|voice)$", 0]],
	// a knob's sockets, lit when the mouse is over it (code.js: controlJacks)
	knob_jacks: [["^fc_cut$", ["mod1_in"]], ["^enc\\d$", []]],
	category: "Synths",
	worklet: "devices/mystic-worklet.js",
	jacks: JACKS,
	rear_jacks: [["OUT L", "aout", "audio"], ["OUT R", "aout", "audio_r"]],
	audio_out: "audio",       // cabled into the rack in stereo when it is added
	audio_out_r: "audio_r",
	midi_in: "midi_in",
	knob_skin: "ledring",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function() { return SIZE; },
	draw: function( mod ) {
		M = mod;
		M.state = M.state || { voices: 0, gates: [], lfo: 0, lfos: [], arp: [], wave: null };
		drawPanel();
		M = null;
	},
	transport: function( mod, action, value ) {
		if(action == "trigger") mod.post({ type: "trigger", gate: value }); // T plays C4
	}
});

})();
