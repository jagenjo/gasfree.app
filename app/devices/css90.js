// devices/css90.js
// CSS 90 module, an eight voice polysynth with two complete channels a voice: settings, the preset
// voices and the panel. The panel follows the classic layout of its kind: CHANNEL I and CHANNEL II
// as two rows of sliders with coloured caps (FEET, VCO, VCF with its envelope, SINE, VCA, TOUCH
// RESPONSE), then the control row (SUB OSCILLATOR, AFTER TOUCH, KEYBOARD CONTROL, RING MODULATOR,
// CHORUS / TREMOLO, PORTAMENTO / GLISSANDO, DETUNE, BRILLIANCE, RESONANCE), the row of preset voice
// buttons with four memories, and the ribbon. Polyphonic (8 voices): the keys, a MIDI device or the
// song play it. DSP in css90-worklet.js.

(function(){

var SIZE = [1568, 668];
var PANEL = "#151514", INK = "#ebe8de", DIM = "#8e8c85", LINE = "#55534d", LED_ON = "#ff3b24", LED_OFF = "#3b1712";
var FONT_UI = "Arial, Helvetica, sans-serif";
var CAP = { vco: "#e2c443", vcf: "#d9472f", eg: "#e4842c", sine: "#f1efe7", vca: "#3f7bcc", touch: "#58a35a", ctl: "#b9b6ad" };
var SUB_FUNCS = [["sine", "SINE"], ["square", "SQUARE"], ["sawup", "SAW UP"], ["sawdn", "SAW DOWN"], ["random", "RANDOM"], ["noise", "NOISE"]];
var CHORUS_MODES = ["OFF", "CHORUS", "TREMOLO"];
var PORTA_MODES = ["PORTAMENTO", "GLISSANDO"];
var FEET = [16, 8, 4];

var M = null, S = null, ST = null;
var uis = {}; // module id -> { store: false, rib: null (the ribbon: [start x, value]) }
function uiOf() { return uis[ M.id ] || (uis[ M.id ] = { store: false, rib: null }); }

// ---- settings ----
// the sliders are 0..1 (times: css90-worklet.js tm(), 2 ms .. 10 s; cutoffs 20 Hz .. 20 kHz)
function chDefaults()
{
	return { feet: 8, pwm: 0, pw: 0.5, saw: true, sqr: false, noise: 0,
		hpf: 0, hres: 0, lpf: 0.6, lres: 0.15, il: 0, al: 0, fa: 0.4, fd: 0.6, fr: 0.6,
		sine: 0, level: 0.8, a: 0.15, d: 0.6, s: 0.8, r: 0.6,
		ibr: 0.3, ilv: 0.4, abr: 0, alv: 0 };
}
function soundDefaults()
{
	var c2 = chDefaults(); c2.level = 0;
	return {
		ch: [ chDefaults(), c2 ],
		sub: { func: "sine", speed: 0.45, fade: 0, vco: 0, vcf: 0, vca: 0 },
		touch: { pitch: 0, vib: 0 },
		kbd: { blo: 0, bhi: 0, llo: 0, lhi: 0 },
		ring: { depth: 0, speed: 0.5, a: 0, d: 1 },
		chorus: { mode: 0, speed: 0.3, depth: 0.6 },
		porta: { mode: 0, time: 0 },
		detune: 0, brill: 0, res: 0, balance: 0.5
	};
}
function defaults()
{
	var s = soundDefaults();
	loadPreset( s, 3 ); // a new CSS 90 starts on BRASS 1
	s.volume = 0.75; s.tune = 0;
	s.mem = [null, null, null, null];
	return s;
}
function int( v, a, b ) { return Math.max( a, Math.min( b, Math.round( +v || 0 ) ) ); }
function enumOf( list, v, def ) { return list.some(function(o){ return (Array.isArray( o ) ? o[0] : o) === v; }) ? v : def; }

function cleanSound( s )
{
	s.ch.forEach(function(c){ if(FEET.indexOf( c.feet ) < 0) c.feet = 8; });
	s.sub.func = enumOf( SUB_FUNCS, s.sub.func, "sine" );
	s.chorus.mode = int( s.chorus.mode, 0, 2 ); s.porta.mode = int( s.porta.mode, 0, 1 );
}
function validate( s, raw )
{
	cleanSound( s );
	s.tune = Math.max( -50, Math.min( 50, s.tune ) );
	s.prog = (s.prog >= 100 && s.prog <= 103) || (s.prog >= 0 && s.prog < PRESETS.length) ? Math.round( s.prog ) : -1;
	var rm = raw && Array.isArray( raw.mem ) ? raw.mem : [];
	s.mem = [0, 1, 2, 3].map(function(i){
		var r = rm[i];
		if(!r || typeof r != "object") return null;
		var c = WR.mergeValid( soundDefaults(), r );
		cleanSound( c );
		return c;
	});
}

function randomize( s )
{
	var rnd = function(a, b){ return a + Math.random() * (b - a); };
	var pick = function(l){ return l[ Math.floor( Math.random() * l.length ) ]; };
	var chance = function(p){ return Math.random() < p; };
	s.ch.forEach(function(c, i){
		c.feet = pick([16, 8, 8, 4]); c.saw = chance( 0.6 ); c.sqr = !c.saw || chance( 0.3 ); c.pw = rnd( 0.2, 0.8 ); c.pwm = chance( 0.3 ) ? rnd( 0.2, 0.6 ) : 0;
		c.noise = chance( 0.15 ) ? rnd( 0, 0.3 ) : 0; c.sine = chance( 0.25 ) ? rnd( 0, 0.6 ) : 0;
		c.hpf = chance( 0.3 ) ? rnd( 0.1, 0.4 ) : 0; c.hres = rnd( 0, 0.3 ); c.lpf = rnd( 0.35, 0.8 ); c.lres = rnd( 0, 0.6 );
		c.il = chance( 0.3 ) ? rnd( -0.3, 0.3 ) : 0; c.al = rnd( -0.1, 0.6 ); c.fa = rnd( 0.1, 0.75 ); c.fd = rnd( 0.4, 0.85 ); c.fr = rnd( 0.4, 0.8 );
		c.level = i == 0 ? rnd( 0.6, 0.9 ) : (chance( 0.7 ) ? rnd( 0.4, 0.8 ) : 0);
		c.a = chance( 0.6 ) ? rnd( 0, 0.3 ) : rnd( 0.4, 0.8 ); c.d = rnd( 0.4, 0.85 ); c.s = rnd( 0.2, 1 ); c.r = rnd( 0.4, 0.8 );
		c.ibr = rnd( 0, 0.6 ); c.ilv = rnd( 0, 0.6 ); c.abr = chance( 0.5 ) ? rnd( 0, 0.6 ) : 0; c.alv = chance( 0.3 ) ? rnd( 0, 0.5 ) : 0;
	});
	s.sub.func = pick( SUB_FUNCS )[0]; s.sub.speed = rnd( 0.3, 0.7 ); s.sub.fade = chance( 0.4 ) ? rnd( 0.2, 0.7 ) : 0;
	s.sub.vco = chance( 0.4 ) ? rnd( 0, 0.35 ) : 0; s.sub.vcf = chance( 0.25 ) ? rnd( 0, 0.5 ) : 0; s.sub.vca = chance( 0.15 ) ? rnd( 0, 0.5 ) : 0;
	s.ring.depth = chance( 0.15 ) ? rnd( 0.3, 0.9 ) : 0; s.ring.speed = rnd( 0.3, 0.9 );
	s.chorus.mode = pick([0, 1, 1, 2]); s.detune = rnd( 0, 0.6 ); s.porta.time = chance( 0.15 ) ? rnd( 0.1, 0.4 ) : 0;
	s.prog = -1;
}

// ---- the preset voices (over the defaults) ----
function ch( o ) { return o; }
var PRESETS = [
	["STRINGS 1", "red", { ch: [ ch({ saw: true, lpf: 0.62, lres: 0.1, al: 0.1, fa: 0.6, fd: 0.75, a: 0.62, d: 0.7, s: 0.9, r: 0.72, ibr: 0.2 }), ch({ saw: false, sqr: true, pw: 0.45, pwm: 0.42, lpf: 0.66, level: 0.6, a: 0.66, d: 0.7, s: 0.9, r: 0.74 }) ], detune: 0.5, chorus: { mode: 1, speed: 0.3, depth: 0.7 } }],
	["STRINGS 2", "red", { ch: [ ch({ lpf: 0.68, lres: 0.05, a: 0.55, s: 0.9, r: 0.7, abr: 0.3 }), ch({ feet: 4, saw: true, lpf: 0.64, level: 0.45, a: 0.6, s: 0.9, r: 0.7 }) ], sub: { speed: 0.5, fade: 0.55, vco: 0.18 }, detune: 0.35, chorus: { mode: 1, speed: 0.38, depth: 0.6 } }],
	["STRINGS 3", "red", { ch: [ ch({ feet: 16, lpf: 0.55, lres: 0.12, al: 0.15, fa: 0.7, a: 0.7, d: 0.75, s: 0.95, r: 0.78 }), ch({ saw: false, sqr: true, pw: 0.35, pwm: 0.3, lpf: 0.6, level: 0.6, a: 0.74, s: 0.95, r: 0.8 }) ], detune: 0.6, chorus: { mode: 1, speed: 0.22, depth: 0.8 } }],
	["BRASS 1", "yellow", { ch: [ ch({ lpf: 0.42, lres: 0.18, il: -0.05, al: 0.5, fa: 0.5, fd: 0.68, fr: 0.6, a: 0.36, d: 0.6, s: 0.85, r: 0.55, ibr: 0.35, abr: 0.5, alv: 0.2 }), ch({ lpf: 0.46, lres: 0.12, al: 0.45, fa: 0.52, fd: 0.7, level: 0.7, a: 0.38, d: 0.6, s: 0.85, r: 0.55, abr: 0.5 }) ], sub: { speed: 0.48, fade: 0.6, vco: 0.22 }, detune: 0.4, touch: { vib: 0.4 } }],
	["BRASS 2", "yellow", { ch: [ ch({ lpf: 0.5, lres: 0.25, al: 0.55, fa: 0.4, fd: 0.62, a: 0.25, s: 0.8, r: 0.5, ibr: 0.5, abr: 0.4 }), ch({ feet: 4, lpf: 0.5, al: 0.4, fa: 0.42, level: 0.5, a: 0.28, s: 0.8, r: 0.5 }) ], detune: 0.25, touch: { vib: 0.3 } }],
	["BRASS 3", "yellow", { ch: [ ch({ feet: 16, lpf: 0.38, lres: 0.22, il: -0.1, al: 0.45, fa: 0.65, fd: 0.75, a: 0.5, s: 0.9, r: 0.65, abr: 0.6 }), ch({ lpf: 0.42, al: 0.45, fa: 0.68, level: 0.75, a: 0.52, s: 0.9, r: 0.65, abr: 0.6, alv: 0.3 }) ], sub: { speed: 0.45, fade: 0.65, vco: 0.2 }, detune: 0.55, chorus: { mode: 1, speed: 0.25, depth: 0.5 } }],
	["FLUTE", "white", { ch: [ ch({ saw: false, sqr: false, noise: 0.12, sine: 0.75, lpf: 0.62, a: 0.38, d: 0.6, s: 0.85, r: 0.5, ilv: 0.5, alv: 0.3 }), ch({ level: 0 }) ], sub: { speed: 0.5, fade: 0.6, vco: 0.2 }, touch: { vib: 0.5 } }],
	["ELEC PIANO", "white", { ch: [ ch({ saw: false, sqr: true, pw: 0.3, sine: 0.6, lpf: 0.48, al: 0.25, fa: 0.1, fd: 0.62, a: 0.05, d: 0.82, s: 0, r: 0.6, ibr: 0.5, ilv: 0.6 }), ch({ feet: 4, saw: false, sine: 0.5, lpf: 0, level: 0.5, a: 0.02, d: 0.6, s: 0, r: 0.5, ilv: 0.7 }) ], chorus: { mode: 2, speed: 0.45, depth: 0.35 } }],
	["BASS", "white", { ch: [ ch({ feet: 16, lpf: 0.36, lres: 0.35, al: 0.55, fa: 0.1, fd: 0.48, fr: 0.4, a: 0.05, d: 0.55, s: 0.7, r: 0.38, ibr: 0.5 }), ch({ feet: 16, saw: false, sqr: true, pw: 0.5, lpf: 0.4, level: 0.6, a: 0.05, d: 0.55, s: 0.7, r: 0.38 }) ], detune: 0.15 }],
	["CLAVICHORD", "white", { ch: [ ch({ saw: false, sqr: true, pw: 0.2, level: 1, hpf: 0.25, hres: 0.2, lpf: 0.6, lres: 0.4, al: 0.5, fa: 0.05, fd: 0.42, a: 0.02, d: 0.62, s: 0, r: 0.35, ibr: 0.6, ilv: 0.5 }), ch({ level: 0 }) ] }],
	["HARPSICHORD", "white", { ch: [ ch({ level: 1, hpf: 0.3, lpf: 0.72, lres: 0.1, al: 0.3, fa: 0.05, fd: 0.55, a: 0.02, d: 0.72, s: 0, r: 0.55, ilv: 0.2 }), ch({ feet: 4, saw: false, sqr: true, pw: 0.3, hpf: 0.35, lpf: 0.7, level: 0.7, a: 0.02, d: 0.7, s: 0, r: 0.52 }) ], detune: 0.2 }],
	["ORGAN 1", "blue", { ch: [ ch({ saw: false, sqr: true, pw: 0.5, lpf: 0.75, lres: 0, a: 0.1, d: 0.5, s: 1, r: 0.3, ibr: 0, ilv: 0 }), ch({ feet: 4, saw: false, sine: 0.7, lpf: 0, level: 0.6, a: 0.1, s: 1, r: 0.3, ilv: 0 }) ], chorus: { mode: 2, speed: 0.55, depth: 0.5 } }],
	["ORGAN 2", "blue", { ch: [ ch({ feet: 16, saw: false, sine: 0.55, lpf: 0, a: 0.12, s: 1, r: 0.35, ibr: 0, ilv: 0 }), ch({ feet: 4, saw: false, sqr: true, pw: 0.5, lpf: 0.7, level: 0.55, a: 0.12, s: 1, r: 0.35, ilv: 0 }) ], chorus: { mode: 1, speed: 0.6, depth: 0.5 } }],
	["GUITAR 1", "green", { ch: [ ch({ level: 0.95, lpf: 0.5, lres: 0.3, al: 0.5, fa: 0.05, fd: 0.55, a: 0.02, d: 0.76, s: 0.2, r: 0.5, ibr: 0.5 }), ch({ saw: false, sqr: true, pw: 0.3, lpf: 0.55, level: 0.5, a: 0.02, d: 0.74, s: 0.15, r: 0.5 }) ], detune: 0.2, chorus: { mode: 1, speed: 0.35, depth: 0.4 } }],
	["GUITAR 2", "green", { ch: [ ch({ saw: false, sqr: true, pw: 0.35, lpf: 0.46, lres: 0.45, al: 0.6, fa: 0.2, fd: 0.6, a: 0.02, d: 0.7, s: 0.4, r: 0.5, abr: 0.4 }), ch({ level: 0 }) ], sub: { speed: 0.5, fade: 0.5, vco: 0.2 }, touch: { pitch: 0.5 } }],
	["FUNKY 1", "orange", { ch: [ ch({ lpf: 0.34, lres: 0.6, al: 0.7, fa: 0.05, fd: 0.44, fr: 0.4, a: 0.02, d: 0.55, s: 0.5, r: 0.35, ibr: 0.6 }), ch({ level: 0 }) ] }],
	["FUNKY 2", "orange", { ch: [ ch({ saw: false, sqr: true, pw: 0.25, lpf: 0.3, lres: 0.7, il: 0.2, al: 0.6, fa: 0.5, fd: 0.55, a: 0.02, s: 0.8, r: 0.4 }), ch({ level: 0 }) ], detune: 0.2 }],
	["FUNKY 3", "orange", { ch: [ ch({ saw: false, sqr: true, pw: 0.5, lpf: 0.6, a: 0.02, d: 0.7, s: 0.3, r: 0.55 }), ch({ feet: 4, lpf: 0.62, level: 0.5, a: 0.02, d: 0.7, s: 0.3, r: 0.55 }) ], ring: { depth: 0.7, speed: 0.58, a: 0.3, d: 0.75 } }],
	["FUNKY 4", "orange", { ch: [ ch({ saw: false, sqr: true, pw: 0.4, lpf: 0.45, lres: 0.55, a: 0.02, s: 0.9, r: 0.45 }), ch({ level: 0 }) ], sub: { func: "random", speed: 0.62, vcf: 0.6 } }],
	["FUNKY 5", "orange", { ch: [ ch({ lpf: 0.62, lres: 0.4, al: 0.3, fa: 0.3, a: 0.1, s: 0.9, r: 0.5 }), ch({ feet: 16, saw: false, sqr: true, lpf: 0.6, level: 0.6, a: 0.1, s: 0.9, r: 0.5 }) ], porta: { mode: 1, time: 0.32 }, detune: 0.3 }],
	["BELLS", "grey", { ch: [ ch({ saw: false, sine: 0.8, lpf: 0, a: 0.02, d: 0.85, s: 0, r: 0.8, ilv: 0.5 }), ch({ feet: 4, saw: false, sqr: true, pw: 0.15, lpf: 0.7, level: 0.35, a: 0.02, d: 0.78, s: 0, r: 0.7 }) ], ring: { depth: 0.85, speed: 0.66, a: 0, d: 0.82 }, chorus: { mode: 1, speed: 0.25, depth: 0.5 } }],
	["SOLO", "grey", { ch: [ ch({ lpf: 0.58, lres: 0.3, al: 0.35, fa: 0.35, fd: 0.7, a: 0.15, s: 0.9, r: 0.5, abr: 0.5, alv: 0.3 }), ch({ saw: false, sqr: true, pw: 0.4, lpf: 0.55, level: 0.5, a: 0.15, s: 0.9, r: 0.5, abr: 0.5 }) ], sub: { speed: 0.5, fade: 0.6, vco: 0.22 }, touch: { pitch: 0.6, vib: 0.5 }, porta: { time: 0.2 }, detune: 0.3 }]
];
var LABELS = { "ELEC PIANO": "ELEC\nPIANO", "CLAVICHORD": "CLAVI-\nCHORD", "HARPSICHORD": "HARPSI-\nCHORD" }; // over the buttons
var BTN_COLORS = { red: "#c8352a", yellow: "#e2c03c", white: "#e9e6dc", blue: "#3b6fbe", green: "#4f9a52", orange: "#e07a2a", grey: "#8f8c85" };

// objects merge key by key, arrays of objects element by element
function deepMerge( a, b )
{
	Object.keys( b ).forEach(function(k){
		var x = b[k];
		if(Array.isArray( x ) && Array.isArray( a[k] ) && x.length == a[k].length && typeof x[0] == "object") x.forEach(function(e, i){ if(e && typeof e == "object") deepMerge( a[k][i], e ); else a[k][i] = e; });
		else if(x && typeof x == "object" && !Array.isArray( x ) && a[k] && typeof a[k] == "object") deepMerge( a[k], x );
		else a[k] = JSON.parse( JSON.stringify( x ) );
	});
}
function sound( s ) { var d = soundDefaults(), c = {}; Object.keys( d ).forEach(function(k){ c[k] = JSON.parse( JSON.stringify( s[k] ) ); }); return c; }
function loadPreset( s, p )
{
	var snd = soundDefaults();
	if(p < 100) deepMerge( snd, PRESETS[p][2] );
	else { if(!s.mem[ p - 100 ]) return false; snd = JSON.parse( JSON.stringify( s.mem[ p - 100 ] ) ); }
	Object.keys( snd ).forEach(function(k){ s[k] = snd[k]; });
	s.prog = p;
	return true;
}
function progName( p ) { return p >= 100 ? "MEMORY " + (p - 99) : (PRESETS[p] ? PRESETS[p][0] : "PANEL"); }

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

// a section: its name over a line along its top, a hairline frame
function section( name, x0, y0, x1, y1 )
{
	ctx.strokeStyle = LINE; ctx.lineWidth = 1;
	ctx.strokeRect( x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1 );
	if(!name) return;
	ctx.font = "bold 10px " + FONT_UI;
	var tw = ctx.measureText( name ).width, cx = (x0 + x1) / 2, ty = y0 + 12;
	ctx.fillStyle = "#2a2926"; ctx.fillRect( x0 + 1, y0 + 1, x1 - x0 - 2, 22 );
	T( name, cx, ty, 10, INK );
	ctx.fillStyle = LINE; ctx.fillRect( x0 + 1, y0 + 23, x1 - x0 - 2, 1 );
}
// a group name over some sliders of a section, with a line under it
function group( name, x0, x1, y )
{
	T( name, (x0 + x1) / 2, y, 7.5, DIM );
	ctx.fillStyle = "#3d3c38"; ctx.fillRect( x0, y + 7, x1 - x0, 1 );
}

function led( x, y, on )
{
	ctx.fillStyle = on ? LED_ON : LED_OFF;
	ctx.beginPath(); ctx.arc( x, y, 3, 0, Math.PI * 2 ); ctx.fill();
	if(on) { ctx.fillStyle = "rgba(255,60,30,0.25)"; ctx.beginPath(); ctx.arc( x, y, 6.5, 0, Math.PI * 2 ); ctx.fill(); }
}

// a vertical slider with a coloured cap; v in min..max; its name under it
function slider( id, cx, y, h, v, min, max, label, o )
{
	o = o || {};
	var full = id_prefix + id, capW = 20, capH = 11;
	var n = (v - min) / (max - min);
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( cx - 13, y - 8, 26, h + 16 );
	if(hover) ui.hot = full;
	if(hover || ui.active === full) hover_control = full;
	if(hover && ui.pressed && ui.active === null)
	{
		ui.active = full;
		if(ui.dbl && o.def !== undefined) n = (o.def - min) / (max - min);
		else if(ui.y < y + (1 - n) * h - capH || ui.y > y + (1 - n) * h + capH) n = clamp( 1 - (ui.y - y) / h, 0, 1 ); // off the cap: jump there
		ui.startY = ui.y; ui.startN = n; ui.dragShift = ui.shift;
	}
	if(ui.active === full && ui.down)
	{
		if(ui.shift != ui.dragShift) { ui.startN = n; ui.startY = ui.y; ui.dragShift = ui.shift; }
		n = clamp( ui.startN + (ui.startY - ui.y) / (h * (ui.shift ? 5 : 1)), 0, 1 );
	}
	var wheeled = false;
	if(hover && ui.wheel && ui.active === null && (wheel_knobs || ui.wheel_ctrl)) { n = clamp( n - ui.wheel * (ui.shift ? 0.005 : 0.025), 0, 1 ); ui.wheel = 0; wheeled = true; }
	if(WR.knobMoved && ((ui.active === full && ui.down) || wheeled)) WR.knobMoved( full, n );
	if(midictl.pending[ full ] !== undefined) { n = clamp( midictl.pending[ full ], 0, 1 ); delete midictl.pending[ full ]; }
	midiNote( full, cx - 13, y - 8, 26, h + 16, "fader" );
	// scale, slot, cap
	ctx.fillStyle = "#5c5a54";
	for(var k = 0; k <= 10; ++k) { var ty = y + k * h / 10; ctx.fillRect( cx - 12, ty, k % 5 ? 4 : 6, 1 ); ctx.fillRect( cx + (k % 5 ? 8 : 6), ty, k % 5 ? 4 : 6, 1 ); }
	if(o.bipolar) { ctx.fillStyle = DIM; ctx.fillRect( cx - 13, y + h / 2 - 0.5, 26, 1.5 ); }
	ctx.fillStyle = "#050505"; ctx.beginPath(); ctx.roundRect( cx - 2.5, y - 3, 5, h + 6, 2.5 ); ctx.fill();
	var cy = y + (1 - n) * h;
	ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect( cx - capW / 2 + 1.5, cy - capH / 2 + 3, capW, capH );
	var c = o.cap || CAP.ctl, g = ctx.createLinearGradient( 0, cy - capH / 2, 0, cy + capH / 2 );
	g.addColorStop( 0, shade( c, hover || ui.active === full ? 1.25 : 1.1 ) ); g.addColorStop( 0.55, c ); g.addColorStop( 1, shade( c, 0.7 ) );
	ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect( cx - capW / 2, cy - capH / 2, capW, capH, 1.5 ); ctx.fill();
	ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect( cx - capW / 2 + 2, cy - 0.5, capW - 4, 1.2 );
	if(label) label.split( "\n" ).forEach(function(l, i){ T( l, cx, y + h + 15 + i * 9, o.lsize || 7.5 ); });
	var val = min + n * (max - min);
	if((hover || ui.active === full) && o.format) tip( o.format( val ), cx, y + h + 34 );
	return val;
}
function shade( hex, k )
{
	var r = parseInt( hex.substr( 1, 2 ), 16 ), g = parseInt( hex.substr( 3, 2 ), 16 ), b = parseInt( hex.substr( 5, 2 ), 16 );
	var f = function(x){ return Math.max( 0, Math.min( 255, Math.round( x * k ) ) ); };
	return "rgb(" + f( r ) + "," + f( g ) + "," + f( b ) + ")";
}

// a small square push button with its LED over it
function btn( id, cx, cy, label, lit, tooltip, o )
{
	o = o || {};
	var w = o.w || 22, h = o.h || 13, x = cx - w / 2, y = cy - h / 2;
	var r = hot( id, x, y, w, h );
	ctx.fillStyle = "#000"; ctx.fillRect( x - 1, y - 1, w + 2, h + 3 );
	ctx.fillStyle = r.hover ? "#55534e" : "#3e3d39"; ctx.fillRect( x, y + (r.held ? 1 : 0), w, h );
	if(!o.noLed) led( cx, y - 7, lit );
	if(label) T( label, cx, y + h + 8, 7 );
	if(r.hover && tooltip) tip( tooltip, cx, y + h + 22 );
	return r;
}

// a list of choices: an LED and a name each, click one
function choices( id, x, y, list, cur, dy, tooltip )
{
	var pick = cur;
	list.forEach(function(name, i){
		var yy = y + i * dy, r = hot( id + "_" + i, x - 6, yy - 6, 82, 12 );
		led( x, yy, i == cur );
		T( name, x + 9, yy + 0.5, 7, i == cur ? INK : (r.hover ? "#c8c5bb" : DIM), "left" );
		if(r.clicked) pick = i;
		if(r.hover && tooltip) tip( tooltip + ": " + name, x + 30, yy + 18 );
	});
	return pick;
}

var pct = function(v){ return Math.round( v * 100 ) + "%"; };
var bip = function(v){ return (v > 0 ? "+" : "") + Math.round( v * 100 ); };
function tmS( v ) { var t = 0.002 * Math.pow( 5000, v ); return t < 1 ? Math.round( t * 1000 ) + " MS" : t.toFixed( 2 ) + " S"; } // css90-worklet.js: tm()
function hz( v ) { var f = 20 * Math.pow( 2, v * 10 ); return f >= 1000 ? (f / 1000).toFixed( 2 ) + " KHZ" : Math.round( f ) + " HZ"; }

// ---------------------------------------------------------------------------
// CHANNEL I and CHANNEL II

var SH = 98; // the sliders' travel in the channel rows
function drawChannel( ci, y0 )
{
	var C = S.ch[ci], p = "c" + ci + "_", y = y0 + 44, name = ci ? "II" : "I";
	var sl = function(k, x, label, cap, o){ o = o || {}; o.cap = cap; C[k] = slider( p + k, x, y, SH, C[k], o.min !== undefined ? o.min : 0, o.max !== undefined ? o.max : 1, label, o ); };
	// the channel and its FEET
	section( "", 22, y0, 112, y0 + 188 );
	ctx.font = "bold 30px Georgia, serif"; ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText( name, 67, y0 + 32 );
	T( "CHANNEL", 67, y0 + 56, 7.5, DIM );
	T( "FEET", 67, y0 + 76, 7.5, INK );
	FEET.forEach(function(f, i){
		var by = y0 + 100 + i * 28;
		if(btn( p + "feet" + f, 52, by, "", C.feet == f, "CHANNEL " + name + ": " + f + " FEET (" + ["AN OCTAVE DOWN", "AS PLAYED", "AN OCTAVE UP"][i] + ")", { w: 18, h: 11, noLed: true } ).clicked) C.feet = f;
		led( 34, by, C.feet == f ); T( f + "'", 80, by + 0.5, 8.5, C.feet == f ? INK : DIM, "left" );
	});
	// VCO
	section( "VCO", 112, y0, 326, y0 + 188 );
	sl( "pwm", 138, "PWM\nSPEED", CAP.vco, { def: 0, format: function(v){ return v < 0.005 ? "PWM OFF" : "PWM SPEED " + (0.1 * Math.pow( 100, v )).toFixed( 2 ) + " HZ"; } } );
	sl( "pw", 186, "PW", CAP.vco, { def: 0.5, format: function(v){ return "PULSE WIDTH " + Math.round( Math.max( 4, Math.min( 96, v * 100 ) ) ) + "%"; } } );
	if(btn( p + "saw", 240, y0 + 72, "SAW", C.saw, "CHANNEL " + name + ": SAWTOOTH ON / OFF" ).clicked) C.saw = !C.saw;
	if(btn( p + "sqr", 240, y0 + 122, "SQUARE", C.sqr, "CHANNEL " + name + ": SQUARE (PULSE) ON / OFF" ).clicked) C.sqr = !C.sqr;
	sl( "noise", 296, "NOISE", CAP.vco, { def: 0, format: function(v){ return "NOISE " + pct( v ); } } );
	// VCF: the two filters and their envelope
	section( "VCF", 326, y0, 778, y0 + 188 );
	group( "HIGH-PASS", 334, 420, y0 + 30 ); group( "LOW-PASS", 434, 520, y0 + 30 ); group( "ENVELOPE", 534, 770, y0 + 30 );
	sl( "hpf", 352, "CUTOFF", CAP.vcf, { def: 0, format: function(v){ return v < 0.01 ? "HIGH-PASS OFF" : "HIGH-PASS " + hz( v ); } } );
	sl( "hres", 402, "RES", CAP.vcf, { def: 0, format: function(v){ return "HIGH-PASS RESONANCE " + pct( v ); } } );
	sl( "lpf", 452, "CUTOFF", CAP.vcf, { def: 0.6, format: function(v){ return "LOW-PASS " + hz( v ); } } );
	sl( "lres", 502, "RES", CAP.vcf, { def: 0.15, format: function(v){ return "LOW-PASS RESONANCE " + pct( v ); } } );
	sl( "il", 552, "IL", CAP.eg, { min: -1, max: 1, def: 0, bipolar: true, format: function(v){ return "INITIAL LEVEL " + bip( v ) + " (WHERE THE ENVELOPE STARTS AND ENDS)"; } } );
	sl( "al", 602, "AL", CAP.eg, { min: -1, max: 1, def: 0, bipolar: true, format: function(v){ return "ATTACK LEVEL " + bip( v ) + " (WHERE THE ATTACK GOES)"; } } );
	sl( "fa", 652, "A", CAP.eg, { def: 0.4, format: function(v){ return "FILTER ATTACK " + tmS( v ) + " (IL TO AL)"; } } );
	sl( "fd", 702, "D", CAP.eg, { def: 0.6, format: function(v){ return "FILTER DECAY " + tmS( v ) + " (AL TO THE SLIDERS)"; } } );
	sl( "fr", 752, "R", CAP.eg, { def: 0.6, format: function(v){ return "FILTER RELEASE " + tmS( v ) + " (BACK TO IL)"; } } );
	// SINE
	section( "SINE", 778, y0, 838, y0 + 188 );
	sl( "sine", 808, "LEVEL", CAP.sine, { def: 0, format: function(v){ return "SINE " + pct( v ) + " (STRAIGHT TO THE VCA, NOT FILTERED)"; } } );
	// VCA
	section( "VCA", 838, y0, 1090, y0 + 188 );
	sl( "level", 864, "LEVEL", CAP.vca, { def: 0.8, format: function(v){ return "CHANNEL " + name + " LEVEL " + pct( v ); } } );
	sl( "a", 914, "A", CAP.vca, { def: 0.15, format: function(v){ return "ATTACK " + tmS( v ); } } );
	sl( "d", 964, "D", CAP.vca, { def: 0.6, format: function(v){ return "DECAY " + tmS( v ); } } );
	sl( "s", 1014, "S", CAP.vca, { def: 0.8, format: function(v){ return "SUSTAIN " + pct( v ); } } );
	sl( "r", 1064, "R", CAP.vca, { def: 0.6, format: function(v){ return "RELEASE " + tmS( v ); } } );
	// TOUCH RESPONSE
	section( "TOUCH RESPONSE", 1090, y0, 1296, y0 + 188 );
	group( "INITIAL", 1100, 1180, y0 + 30 ); group( "AFTER", 1206, 1286, y0 + 30 );
	sl( "ibr", 1116, "BRILL", CAP.touch, { def: 0.3, format: function(v){ return "INITIAL TOUCH (VELOCITY) TO BRILLIANCE " + pct( v ); } } );
	sl( "ilv", 1164, "LEVEL", CAP.touch, { def: 0.4, format: function(v){ return "INITIAL TOUCH (VELOCITY) TO LEVEL " + pct( v ); } } );
	sl( "abr", 1222, "BRILL", CAP.touch, { def: 0, format: function(v){ return "AFTER TOUCH (PRESSURE) TO BRILLIANCE " + pct( v ); } } );
	sl( "alv", 1270, "LEVEL", CAP.touch, { def: 0, format: function(v){ return "AFTER TOUCH (PRESSURE) TO LEVEL " + pct( v ); } } );
}

// the right block: the volume, the balance, the voices; the CV jacks
function drawRight()
{
	section( "", 1296, 8, 1546, 196 );
	S.volume = knob( "volume", 1360, 82, 28, S.volume, 0, 1, { def: 0.75, format: function(v){ return "VOLUME " + Math.round( v * 100 ) + "%"; } } );
	T( "VOLUME", 1360, 128, 8.5 );
	S.balance = knob( "balance", 1478, 82, 20, S.balance, 0, 1, { def: 0.5, bipolar: true, format: function(v){ return "CHANNEL BALANCE: I " + Math.round( Math.min( 1, 2 - 2 * v ) * 100 ) + "%, II " + Math.round( Math.min( 1, 2 * v ) * 100 ) + "%"; } } );
	T( "I", 1452, 112, 8, DIM ); T( "II", 1505, 112, 8, DIM ); T( "BALANCE", 1478, 128, 8.5 );
	T( "VOICES", 1421, 156, 7, DIM );
	var g = ST.gates || [];
	for(var i = 0; i < 8; ++i) led( 1358 + i * 18, 174, g[i] >= 0 && g[i] !== undefined );
	section( "", 1296, 200, 1546, 388 );
	var J = [["brill_in", "in", "BRILL", "BRILLIANCE IN: BOTH FILTERS OF BOTH CHANNELS, 1 V/OCT"], ["vol_in", "in", "VOL", "VOLUME IN (EXPRESSION): 0..5 V (UNPLUGGED: FULL)"], ["sus_in", "in", "SUS", "SUSTAIN IN: A GATE HOLDS THE NOTES"],
		["pitch_out", "out", "PITCH", "PITCH OUT: THE LAST NOTE, 1 V/OCT"], ["gate_out", "out", "GATE", "GATE OUT"], ["sub_out", "out", "SUB", "SUB OSCILLATOR OUT, +-5 V"], ["ribbon_out", "out", "RIBBON", "RIBBON OUT, +-5 V"]];
	T( "IN", 1421, 222, 7.5, DIM ); T( "OUT", 1421, 300, 7.5, DIM );
	J.forEach(function(j, i){
		var row = i < 3 ? 0 : 1, k = row ? i - 3 : i, x = row ? 1346 + k * 50 : 1371 + k * 50, yy = row ? 330 : 252;
		jack( j[0], x, yy, j[1], j[2], j[3] ); T( j[2], x, yy + 20, 7, j[1] == "out" ? INK : DIM );
	});
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

// ---------------------------------------------------------------------------
// the control row

function drawControls()
{
	var y0 = 392, y = y0 + 40, h = 84;
	var sl = function(obj, k, id, x, label, o){ o = o || {}; obj[k] = slider( id, x, y, h, obj[k], o.min !== undefined ? o.min : 0, o.max !== undefined ? o.max : 1, label, o ); };
	// SUB OSCILLATOR
	var B = S.sub;
	section( "SUB OSCILLATOR", 22, y0, 372, y0 + 182 );
	T( "FUNCTION", 66, y0 + 36, 7.5, DIM );
	var fi = Math.max( 0, SUB_FUNCS.findIndex(function(f){ return f[0] == B.func; }) );
	fi = choices( "sub_func", 40, y0 + 56, SUB_FUNCS.map(function(f){ return f[1]; }), fi, 18, "SUB OSCILLATOR FUNCTION" );
	B.func = SUB_FUNCS[ fi ][0];
	sl( B, "speed", "sub_speed", 150, "SPEED", { def: 0.45, format: function(v){ return "SUB OSCILLATOR " + (0.1 * Math.pow( 500, v )).toFixed( 2 ) + " HZ"; } } );
	ctx.fillStyle = "rgba(255,59,36," + (ST.sub || 0) + ")"; ctx.beginPath(); ctx.arc( 150, y0 + 32, 3, 0, Math.PI * 2 ); ctx.fill(); // follows the sub oscillator
	sl( B, "fade", "sub_fade", 198, "FADE", { def: 0, format: function(v){ return v < 0.01 ? "FADE OFF: THE SUB OSCILLATOR AT ONCE" : "FADE IN " + (v * v * 4).toFixed( 2 ) + " S FROM EACH NOTE"; } } );
	sl( B, "vco", "sub_vco", 246, "VCO", { def: 0, format: function(v){ return "SUB OSCILLATOR TO PITCH (VIBRATO) " + (v * v * 2).toFixed( 2 ) + " SEMITONES; THE MOD WHEEL ADDS TO IT"; } } );
	sl( B, "vcf", "sub_vcf", 294, "VCF", { def: 0, format: function(v){ return "SUB OSCILLATOR TO THE FILTERS " + (v * v * 3).toFixed( 1 ) + " OCTAVES"; } } );
	sl( B, "vca", "sub_vca", 342, "VCA", { def: 0, format: function(v){ return "SUB OSCILLATOR TO THE LEVEL (TREMOLO) " + pct( v ); } } );
	// AFTER TOUCH (to pitch and vibrato)
	section( "AFTER TOUCH", 372, y0, 478, y0 + 182 );
	sl( S.touch, "pitch", "at_pitch", 400, "PITCH", { min: -1, max: 1, def: 0, bipolar: true, cap: CAP.touch, format: function(v){ return "AFTER TOUCH BENDS THE PITCH " + (v * 2).toFixed( 2 ) + " SEMITONES"; } } );
	sl( S.touch, "vib", "at_vib", 450, "VIBRATO", { def: 0, cap: CAP.touch, format: function(v){ return "AFTER TOUCH TO VIBRATO (THE SUB OSCILLATOR) " + pct( v ); } } );
	// KEYBOARD CONTROL
	section( "KEYBOARD CONTROL", 478, y0, 690, y0 + 182 );
	group( "BRILLIANCE", 488, 572, y0 + 30 ); group( "LEVEL", 596, 680, y0 + 30 );
	var kf = function(what, side){ return function(v){ return what + " OVER THE " + side + " KEYS " + bip( v ); }; };
	sl( S.kbd, "blo", "kb_blo", 504, "LOW", { min: -1, max: 1, def: 0, bipolar: true, format: kf( "BRILLIANCE", "LOW" ) } );
	sl( S.kbd, "bhi", "kb_bhi", 554, "HIGH", { min: -1, max: 1, def: 0, bipolar: true, format: kf( "BRILLIANCE", "HIGH" ) } );
	sl( S.kbd, "llo", "kb_llo", 612, "LOW", { min: -1, max: 1, def: 0, bipolar: true, format: kf( "LEVEL", "LOW" ) } );
	sl( S.kbd, "lhi", "kb_lhi", 662, "HIGH", { min: -1, max: 1, def: 0, bipolar: true, format: kf( "LEVEL", "HIGH" ) } );
	// RING MODULATOR
	var R = S.ring;
	section( "RING MODULATOR", 690, y0, 902, y0 + 182 );
	sl( R, "depth", "ring_depth", 716, "DEPTH", { def: 0, format: function(v){ return v < 0.005 ? "RING MODULATOR OFF" : "RING MODULATION DEPTH " + pct( v ); } } );
	sl( R, "speed", "ring_speed", 766, "SPEED", { def: 0.5, format: function(v){ var f = 0.5 * Math.pow( 4000, v ); return "RING MODULATOR " + (f < 10 ? f.toFixed( 2 ) : Math.round( f )) + " HZ"; } } );
	sl( R, "a", "ring_a", 816, "ATTACK", { def: 0, format: function(v){ return "THE DEPTH RISES IN " + tmS( v ) + " FROM EACH NOTE"; } } );
	sl( R, "d", "ring_d", 866, "DECAY", { def: 1, format: function(v){ return v >= 0.99 ? "DECAY OFF: THE DEPTH STAYS" : "THEN FALLS IN " + tmS( v ); } } );
	// CHORUS / TREMOLO
	var CH = S.chorus;
	section( "CHORUS / TREMOLO", 902, y0, 1078, y0 + 182 );
	CH.mode = choices( "chorus_mode", 918, y0 + 56, CHORUS_MODES, CH.mode, 18, "CHORUS / TREMOLO" );
	sl( CH, "speed", "chorus_speed", 1004, "SPEED", { def: 0.3, format: function(v){ return (CH.mode == 2 ? "TREMOLO " + (0.5 * Math.pow( 30, v )).toFixed( 2 ) : "CHORUS " + (0.1 * Math.pow( 60, v )).toFixed( 2 )) + " HZ"; } } );
	sl( CH, "depth", "chorus_depth", 1052, "DEPTH", { def: 0.6, format: function(v){ return "DEPTH " + pct( v ); } } );
	// PORTAMENTO / GLISSANDO
	var P = S.porta;
	section( "PORTAMENTO", 1078, y0, 1210, y0 + 182 );
	P.mode = choices( "porta_mode", 1090, y0 + 56, ["PORTA", "GLISS"], P.mode, 18, "MODE (GLISSANDO: IN SEMITONES)" );
	sl( P, "time", "porta_time", 1182, "TIME", { def: 0, format: function(v){ return v <= 0.005 ? PORTA_MODES[ P.mode ] + " OFF" : PORTA_MODES[ P.mode ] + " " + (0.01 + v * v * 3).toFixed( 2 ) + " S"; } } );
	// DETUNE, BRILLIANCE, RESONANCE, TUNE
	section( "", 1210, y0, 1420, y0 + 182 );
	sl( S, "detune", "detune", 1234, "DETUNE", { lsize: 7, def: 0, format: function(v){ return "CHANNEL II DETUNED " + Math.round( v * 30 ) + " CENTS"; } } );
	sl( S, "brill", "brill", 1288, "BRILLIANCE", { lsize: 6.5, min: -1, max: 1, def: 0, bipolar: true, format: function(v){ return "BRILLIANCE (BOTH FILTERS) " + (v * 3).toFixed( 1 ) + " OCTAVES"; } } );
	sl( S, "res", "res", 1344, "RESONANCE", { lsize: 6.5, min: -1, max: 1, def: 0, bipolar: true, format: function(v){ return "RESONANCE (ALL FILTERS) " + bip( v ); } } );
	sl( S, "tune", "tune", 1396, "TUNE", { lsize: 7, min: -50, max: 50, def: 0, bipolar: true, format: function(v){ return "TUNE " + Math.round( v ) + " CENTS"; } } );
	// the name
	section( "", 1420, y0, 1546, y0 + 182 );
	ctx.font = "bold 34px Georgia, serif"; ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
	ctx.fillText( "CSS", 1483, y0 + 64 ); ctx.fillText( "90", 1483, y0 + 102 );
	T( "POLYPHONIC", 1483, y0 + 136, 7.5, DIM ); T( "SYNTHESIZER", 1483, y0 + 148, 7.5, DIM );
}

// ---------------------------------------------------------------------------
// the preset voices, the memories, the ribbon

function drawPresets()
{
	var u = uiOf(), y0 = 578;
	ctx.fillStyle = "#0c0c0b"; ctx.fillRect( 22, y0, 1524, 52 );
	PRESETS.forEach(function(p, i){
		var x = 34 + i * 52, cur = S.prog == i;
		var r = hot( "pre" + i, x, y0 + 22, 46, 24 );
		var lines = (LABELS[ p[0] ] || p[0]).split( "\n" );
		lines.forEach(function(l, k){ T( l, x + 23, y0 + (lines.length > 1 ? 8 + k * 8 : 13), 7, cur ? INK : DIM ); });
		var c = BTN_COLORS[ p[1] ];
		ctx.fillStyle = "#000"; ctx.fillRect( x - 1, y0 + 21, 48, 27 );
		ctx.fillStyle = shade( c, r.hover ? 1.15 : (cur ? 1 : 0.8) ); ctx.fillRect( x, y0 + 22 + (r.held ? 1 : 0), 46, 24 );
		ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect( x, y0 + 40, 46, 6 );
		if(cur) { ctx.fillStyle = LED_ON; ctx.fillRect( x + 17, y0 + 26, 12, 3 ); }
		if(r.clicked) { loadPreset( S, i ); u.store = false; setStatus( "CSS 90: " + p[0] ); }
		if(r.hover) tip( p[0], x + 23, y0 + 58 );
	});
	// MEMORY 1-4 and STORE
	var mx = 34 + 22 * 52 + 14;
	T( "MEMORY", mx + 85, y0 + 12, 7, DIM );
	for(var k = 0; k < 4; ++k)
	{
		var x = mx + k * 44, cur = S.prog == 100 + k, has = !!S.mem[k];
		var r = hot( "mem" + k, x, y0 + 22, 38, 24 );
		ctx.fillStyle = "#000"; ctx.fillRect( x - 1, y0 + 21, 40, 27 );
		ctx.fillStyle = r.hover ? "#77746c" : (has ? "#5c5a54" : "#3a3935"); ctx.fillRect( x, y0 + 22 + (r.held ? 1 : 0), 38, 24 );
		T( String( k + 1 ), x + 19, y0 + 37, 8, has ? INK : DIM );
		if(cur) { ctx.fillStyle = LED_ON; ctx.fillRect( x + 13, y0 + 26, 12, 3 ); }
		if(r.clicked)
		{
			if(u.store) { S.mem[k] = sound( S ); S.prog = 100 + k; u.store = false; setStatus( "CSS 90: the panel stored in MEMORY " + (k + 1) + " (saved with the rack)" ); }
			else if(loadPreset( S, 100 + k )) setStatus( "CSS 90: MEMORY " + (k + 1) );
			else setStatus( "CSS 90: MEMORY " + (k + 1) + " is empty (STORE, then a memory, keeps the panel there)" );
		}
		if(r.hover) tip( has ? "MEMORY " + (k + 1) : "MEMORY " + (k + 1) + ": EMPTY", x + 19, y0 + 58 );
	}
	var sx = mx + 4 * 44 + 8;
	var st = hot( "store", sx, y0 + 22, 40, 24 );
	T( "STORE", sx + 20, y0 + 14, 7, u.store ? INK : DIM );
	ctx.fillStyle = "#000"; ctx.fillRect( sx - 1, y0 + 21, 42, 27 );
	ctx.fillStyle = st.hover ? "#8a3a30" : "#6c2a22"; ctx.fillRect( sx, y0 + 22 + (st.held ? 1 : 0), 40, 24 );
	if(u.store && performance.now() % 500 < 250) { ctx.fillStyle = LED_ON; ctx.fillRect( sx + 14, y0 + 26, 12, 3 ); }
	if(st.clicked) { u.store = !u.store; if(u.store) setStatus( "CSS 90: STORE, now click a MEMORY button" ); }
	if(st.hover) tip( "STORE: THEN A MEMORY BUTTON KEEPS THE PANEL THERE", sx + 20, y0 + 58 );
	T( progName( S.prog ), 1540, y0 + 6, 7, INK, "right" );
}

// the ribbon: touch it anywhere, slide left or right to bend up to an octave; let go: back to the note
function drawRibbon()
{
	var u = uiOf(), x0 = 140, x1 = 1428, y0 = 636, h = 22;
	T( "RIBBON", 82, y0 + h / 2, 8.5, INK );
	var r = hot( "ribbon", x0, y0 - 2, x1 - x0, h + 4 );
	ctx.fillStyle = "#000"; ctx.fillRect( x0 - 2, y0 - 2, x1 - x0 + 4, h + 4 );
	var g = ctx.createLinearGradient( 0, y0, 0, y0 + h );
	g.addColorStop( 0, "#3a3936" ); g.addColorStop( 0.5, "#24231f" ); g.addColorStop( 1, "#302f2b" );
	ctx.fillStyle = g; ctx.fillRect( x0, y0, x1 - x0, h );
	ctx.fillStyle = "#4a4843"; for(var k = 1; k < 24; ++k) ctx.fillRect( x0 + k * (x1 - x0) / 24, y0 + h - 4, 1, 4 );
	var val = 0;
	if(ui.active === id_prefix + "ribbon" && ui.down)
	{
		if(u.rib === null) u.rib = ui.x;
		val = clamp( (ui.x - u.rib) / ((x1 - x0) * 0.4), -1, 1 );
		ctx.fillStyle = "rgba(255,59,36,0.35)"; ctx.fillRect( Math.min( u.rib, ui.x ), y0 + 2, Math.abs( ui.x - u.rib ), h - 4 );
		ctx.fillStyle = LED_ON; ctx.fillRect( clamp( ui.x, x0, x1 ) - 1, y0, 3, h );
		tip( "RIBBON " + (val > 0 ? "+" : "") + (val * 12).toFixed( 1 ) + " SEMITONES", ui.x, y0 - 14 );
	}
	else u.rib = null;
	var last = u.ribSent || 0;
	if(Math.abs( val - last ) > 0.002 || (val === 0 && last !== 0)) { u.ribSent = val; send({ type: "ribbon", value: val }); } // octaves
	if(r.hover && !r.held) tip( "RIBBON: PRESS ANYWHERE AND SLIDE (UP TO AN OCTAVE EACH WAY); LET GO: BACK TO THE NOTE", (x0 + x1) / 2, y0 - 14 );
}

function draw( mod )
{
	M = mod; S = mod.settings;
	ST = M.state = M.state || { gates: [] };
	var w = SIZE[0], h = SIZE[1];
	drawCasing( 0, 0, w, h );
	ctx.fillStyle = PANEL; ctx.fillRect( 22, 0, w - 44, h );
	drawChannel( 0, 8 );
	drawChannel( 1, 200 );
	drawRight();
	drawControls();
	drawPresets();
	drawRibbon();
	M = null; S = null; ST = null;
}

function send( msg ) { var m = M; act(function(){ m.post( msg ); }); }

WR.registerSynth( "css90", {
	title: "CSS 90",
	description: "CSS 90: eight voice polysynth with two channels a voice, touch response, a ring modulator and a ribbon",
	about: "8 voices of two complete channels (VCO, high-pass and low-pass filters with their envelope, sine, VCA), velocity and aftertouch to brilliance and level, a sub oscillator, keyboard control, a ring modulator, chorus or tremolo, portamento or glissando, 22 preset voices with 4 memories, and the ribbon.",
	key_prio: [["^pre\\d+$", 1], ["^(mem\\d|store)$", 1], ["", 0]],
	knob_jacks: [["^c[01]_lpf$", ["brill_in"]], ["^brill$", ["brill_in"]], ["^volume$", ["vol_in"]]],
	category: "Synths",
	worklet: "devices/css90-worklet.js",
	jacks: [[["BRILLIANCE", "in", "brill_in"], ["VOLUME", "in", "vol_in"], ["SUSTAIN", "in", "sus_in"]],
		[["PITCH", "out", "pitch_out"], ["GATE", "out", "gate_out"], ["SUB", "out", "sub_out"], ["RIBBON", "out", "ribbon_out"]]],
	rear_jacks: [["OUT L", "aout", "out_l"], ["OUT R", "aout", "out_r"]],
	audio_out: "out_l",
	audio_out_r: "out_r",
	midi_in: "midi_in",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function() { return SIZE; },
	draw: draw,
	transport: function( mod, action, value ) { if(action == "trigger") mod.post({ type: "trigger", gate: value }); },
	rear_note: function( s ) { return progName( s.prog ); }
});

})();
