// devices/mount.js
// MOUNT module, an 8 voice polyphonic synthesizer (3 oscillators a voice). Its panel, as a classic
// desktop wavetable poly: MASTER and ANIMATE, PATCH, the MENU with its OLED, ARP, LFO 1 / 2, GLIDE and the AMP /
// MOD ENVELOPE sliders on top; the three OSCILLATOR rows, MIXER, FILTER, DISTORTION, CHORUS, DELAY,
// EFFECTS and REVERB below. Black panel, a blue line over every section, white buttons, orange LEDs
// beside the stepped choices.
// The OLED shows the patch, or the control being turned; its nine menu buttons (PATCH, OSC, ENV, LFO,
// ARP/CLOCK, MOD, VOICE, FX, SETTINGS) open pages of the deeper parameters: a row button and the
// parameter encoder (or VALUE - / +) change them. DSP in mount-worklet.js.

(function(){

var SIZE = [1568, 796];
var PANEL = "#1d1e20", PANEL2 = "#0f1011", INK = "#f1f1ee", DIM = "#9a9b98", LED = "#ff6a1a", OLED = "#cfe9ff", BLUE = "#3aa6e0";
var WAVES = ["sine", "tri", "saw", "pulse", "more"];
var TABLES = ["BRIGHT", "VOCAL", "ORGAN", "ODD", "PULSE SWEEP", "DIGITAL", "HOLLOW", "SYNC"];
var MOD_SRC = ["none", "lfo1", "lfo2", "env1", "env2", "amp", "vel", "wheel", "key", "cv", "anim1", "anim2"];
var MOD_SRC_N = ["--", "LFO 1", "LFO 2", "MOD ENV 1", "MOD ENV 2", "AMP ENV", "VELOCITY", "MOD WHEEL", "KEY", "CV MOD IN", "ANIMATE 1", "ANIMATE 2"];
var MOD_DST = ["none", "pitch", "osc1_pitch", "osc2_pitch", "osc3_pitch", "shape", "filter", "res", "vca", "noise", "pan", "lfo1_rate", "lfo2_rate", "dist"];
var MOD_DST_N = ["--", "OSC 1-3 PITCH", "OSC 1 PITCH", "OSC 2 PITCH", "OSC 3 PITCH", "OSC 1-3 SHAPE", "FILTER FREQ", "RESONANCE", "VCA LEVEL", "NOISE LEVEL", "PAN", "LFO 1 RATE", "LFO 2 RATE", "DISTORTION"];
var ARP_PAT = ["UP", "DOWN", "UP / DOWN", "RANDOM", "PLAYED"];
var SYNC_N = ["16 BEATS", "12 BEATS", "8 BEATS", "6 BEATS", "4 BEATS", "3 BEATS", "2 BEATS", "1.5 BEATS", "1 BEAT", "1/4 DOT", "1/4 T", "1/8", "1/8 DOT", "1/8 T", "1/16", "1/16 DOT", "1/16 T", "1/32", "1/32 T"];
var SYNC_DIV_N = 19;

var M = null, S = null, ST = null;
var uis = {};   // module id -> { menu, page, row, show: [text, until], cmp, animHold }

function osc( wave, range, level )
{
	return { range: range, coarse: 0, fine: 0, wave: wave, env2: 0, lfo2: 0, src: "manual", shape: { manual: 0.5, env1: 0, lfo1: 0 }, table: 0 };
}
function emptyMod() { return { src: "none", dst: "none", depth: 0 }; }

function defaults()
{
	var mod = [];
	for(var i = 0; i < 6; ++i) mod.push( emptyMod() );
	// the ANIMATE buttons: open the filter, add a vibrato
	mod[4] = { src: "anim1", dst: "filter", depth: 0.4 };
	mod[5] = { src: "anim2", dst: "pitch", depth: 0 };
	return {
		patch: 0, name: "INIT PATCH", user: [],
		osc: [ osc( "saw", 1 ), osc( "saw", 1 ), osc( "pulse", 0 ) ],
		mix: { osc1: 0.8, osc2: 0, osc3: 0, ring: 0, noise: 0, vca: 0.8 },
		lfo: [ { type: "tri", fade: 0, range: "high", rate: 0.35 }, { type: "tri", fade: 0, range: "high", rate: 0.45 } ],
		lfo_retrig: false,
		filter: { shape: "lp", slope: 24, freq: 0.75, res: 0.1, drive: 0, src_env1: true, src_amp: false, env: 0, lfo1: 0, osc3: 0, track: 0.5 },
		amp: { a: 0.002, h: 0, d: 0.5, s: 1, r: 0.15 },
		env1: { a: 0.002, h: 0, d: 0.5, s: 0.5, r: 0.3 },
		env2: { a: 0.002, h: 0, d: 0.5, s: 0.5, r: 0.3 },
		env_sel: 1,
		glide: { time: 0.1, on: false },
		arp: { on: false, latch: false, gate: 0.5, tempo: 120, pattern: 0, octaves: 1, swing: 0 },
		voice: { mode: "poly", unison: 0, detune: 0.15, bend: 2, tune: 0, vel: 0.5 },
		mod: mod,
		fx: { dist: 0, delay: { time: 0.3, sync: false, fb: 0.3, level: 0 }, reverb: { time: 0.5, type: 1, level: 0 }, chorus: { rate: 0.3, type: 1, level: 0 }, bypass: false },
		volume: 0.75
	};
}

// the factory patches: [name, category, changes from the init patch]
var PATCHES = [
	["INIT PATCH", "INIT", {}],
	["HIGH PAD", "PAD", { osc: [ { wave: "saw", coarse: 0, fine: -8 }, { wave: "saw", fine: 8 }, { wave: "more", table: 1, range: 0, shape: { manual: 0.3, env1: 0, lfo1: 0.4 } } ], mix: { osc1: 0.7, osc2: 0.7, osc3: 0.5 },
		filter: { freq: 0.55, res: 0.2, env: 0.25 }, amp: { a: 0.9, d: 1, s: 0.9, r: 2.2 }, env1: { a: 1.2, d: 2.5, s: 0.4, r: 2 }, lfo: [ { rate: 0.2 }, { rate: 0.3 } ],
		fx: { chorus: { level: 0.6, type: 1, rate: 0.25 }, reverb: { level: 0.5, time: 0.75, type: 2 } } }],
	["BRASS STAB", "BRASS", { osc: [ { wave: "saw" }, { wave: "saw", fine: 12 }, { wave: "pulse", range: 0, shape: { manual: 0.3 } } ], mix: { osc1: 0.8, osc2: 0.7, osc3: 0.4 },
		filter: { freq: 0.42, res: 0.15, env: 0.55, drive: 0.25 }, env1: { a: 0.04, d: 0.45, s: 0.3, r: 0.3 }, amp: { a: 0.01, d: 0.6, s: 0.8, r: 0.25 }, fx: { reverb: { level: 0.25 } } }],
	["ACID LINE", "BASS", { voice: { mode: "legato" }, glide: { on: true, time: 0.06 }, osc: [ { wave: "saw", range: 0 }, {}, {} ], mix: { osc1: 0.9 },
		filter: { slope: 24, freq: 0.3, res: 0.75, env: 0.6, drive: 0.4, track: 0.3 }, env1: { a: 0.002, d: 0.25, s: 0, r: 0.1 }, amp: { a: 0.002, d: 0.3, s: 0.8, r: 0.08 },
		fx: { dist: 0.2, delay: { level: 0.25, sync: true, time: 0.4, fb: 0.35 } } }],
	["VOX TABLE", "LEAD", { osc: [ { wave: "more", table: 1, shape: { manual: 0.2, env1: 0.6, lfo1: 0 } }, { wave: "more", table: 1, fine: 10, shape: { manual: 0.4, lfo1: 0.3 } }, {} ], mix: { osc1: 0.8, osc2: 0.6 },
		filter: { freq: 0.8, res: 0.1 }, env1: { a: 0.3, d: 1.2, s: 0.3 }, amp: { a: 0.05, r: 0.5 }, lfo: [ { rate: 0.3 }, { rate: 0.5 } ], fx: { reverb: { level: 0.35 }, chorus: { level: 0.3 } } }],
	["SNOW PLUCK", "ARP", { arp: { on: true, pattern: 2, octaves: 2, tempo: 112, gate: 0.4 }, osc: [ { wave: "pulse", shape: { manual: 0.3 } }, { wave: "tri", range: 2 }, {} ], mix: { osc1: 0.7, osc2: 0.5 },
		filter: { freq: 0.35, res: 0.3, env: 0.6 }, env1: { a: 0.001, d: 0.22, s: 0 }, amp: { a: 0.001, d: 0.4, s: 0, r: 0.3 }, fx: { delay: { level: 0.35, sync: true, time: 0.6, fb: 0.45 }, reverb: { level: 0.3 } } }],
	["WIDE UNISON", "LEAD", { voice: { mode: "mono", unison: 2, detune: 0.25 }, glide: { on: true, time: 0.08 }, osc: [ { wave: "saw" }, { wave: "saw", coarse: 7 }, {} ], mix: { osc1: 0.8, osc2: 0.5 },
		filter: { freq: 0.6, res: 0.25, env: 0.3, drive: 0.3 }, env1: { d: 0.8, s: 0.3 }, fx: { dist: 0.15, delay: { level: 0.2, time: 0.35, fb: 0.3 } } }],
	["BELL KEYS", "KEYS", { osc: [ { wave: "sine", range: 2 }, { wave: "sine", range: 1, coarse: 7, fine: 3 }, {} ], mix: { osc1: 0.7, osc2: 0.6, ring: 0.6 },
		filter: { freq: 0.9 }, amp: { a: 0.001, d: 2.2, s: 0, r: 1.8 }, fx: { reverb: { level: 0.45, time: 0.7 }, chorus: { level: 0.3 } } }],
	["SYNC SWEEP", "LEAD", { osc: [ { wave: "more", table: 7, shape: { manual: 0.1, env1: 0.8 } }, { wave: "saw", fine: -6 }, {} ], mix: { osc1: 0.8, osc2: 0.4 },
		env1: { a: 0.002, d: 1.4, s: 0.1 }, filter: { freq: 0.7, res: 0.2 }, fx: { delay: { level: 0.2 } } }],
	["GLASS ORGAN", "KEYS", { osc: [ { wave: "more", table: 2, shape: { manual: 0.6 } }, { wave: "sine", range: 2 }, {} ], mix: { osc1: 0.8, osc2: 0.3 },
		amp: { a: 0.005, d: 0.3, s: 1, r: 0.2 }, filter: { freq: 0.85 }, fx: { chorus: { level: 0.7, type: 2, rate: 0.6 }, reverb: { level: 0.3 } } }],
	["DARK DRONE", "PAD", { osc: [ { wave: "saw", range: 0 }, { wave: "pulse", range: 0, fine: 7, shape: { manual: 0.5, lfo1: 0.6 } }, { wave: "more", table: 5, range: 1, shape: { lfo1: 0.8 } } ],
		mix: { osc1: 0.7, osc2: 0.7, osc3: 0.4, noise: 0.15 }, filter: { freq: 0.35, res: 0.45, lfo1: 0.3 }, lfo: [ { rate: 0.12, type: "tri" }, { rate: 0.2 } ],
		amp: { a: 1.5, s: 1, r: 3 }, fx: { reverb: { level: 0.6, time: 0.9, type: 2 }, dist: 0.1 } }],
	["NOISE RISER", "FX", { mix: { osc1: 0, noise: 0.8 }, filter: { shape: "bp", freq: 0.3, res: 0.6, env: 0.7 }, env1: { a: 3, d: 1, s: 1, r: 1 }, amp: { a: 2.5, s: 1, r: 1.5 },
		fx: { reverb: { level: 0.5, time: 0.8 }, delay: { level: 0.3, time: 0.5, fb: 0.6 } } }]
];

function deepMerge( a, b ) { Object.keys( b ).forEach(function(k){ if(b[k] && typeof b[k] == "object" && !Array.isArray( b[k] ) && a[k] && typeof a[k] == "object") deepMerge( a[k], b[k] ); else if(Array.isArray( b[k] )) b[k].forEach(function(x, i){ if(x && typeof x == "object" && a[k][i]) deepMerge( a[k][i], x ); else a[k][i] = x; }); else a[k] = b[k]; }); }

function patchCount( s ) { return PATCHES.length + 16; }
function patchName( s, i ) { return i < PATCHES.length ? PATCHES[i][0] : (s.user[ i - PATCHES.length ] ? s.user[ i - PATCHES.length ].name : "EMPTY"); }

// loads a factory patch (or a saved one); what is not the sound stays (the user bank, the MIDI)
function loadPatch( s, i )
{
	var keep = { user: s.user, midi_channel: s.midi_channel, midi_master: s.midi_master, knob_skin: s.knob_skin };
	var d = defaults();
	if(i < PATCHES.length) deepMerge( d, JSON.parse( JSON.stringify( PATCHES[i][2] ) ) );
	else if(s.user[ i - PATCHES.length ]) deepMerge( d, JSON.parse( JSON.stringify( s.user[ i - PATCHES.length ].sound ) ) );
	Object.keys( d ).forEach(function(k){ s[k] = d[k]; });
	Object.keys( keep ).forEach(function(k){ if(keep[k] !== undefined) s[k] = keep[k]; });
	s.patch = i; s.name = patchName( s, i );
}

function sound( s ) { var c = JSON.parse( JSON.stringify( s ) ); delete c.user; delete c.patch; delete c.midi_channel; delete c.midi_master; delete c.knob_skin; return c; }

function validate( s, raw )
{
	var num = function(v, a, b, d) { v = +v; return isFinite( v ) ? Math.min( b, Math.max( a, v ) ) : d; };
	s.osc.forEach(function(o){
		if(WAVES.indexOf( o.wave ) < 0) o.wave = "saw";
		o.range = Math.round( num( o.range, 0, 3, 1 ) ); o.table = Math.round( num( o.table, 0, 7, 0 ) );
		if(["manual", "env1", "lfo1"].indexOf( o.src ) < 0) o.src = "manual";
	});
	s.mod.forEach(function(m){ if(MOD_SRC.indexOf( m.src ) < 0) m.src = "none"; if(MOD_DST.indexOf( m.dst ) < 0) m.dst = "none"; m.depth = num( m.depth, -1, 1, 0 ); });
	if(["lp", "bp", "hp"].indexOf( s.filter.shape ) < 0) s.filter.shape = "lp";
	s.filter.slope = s.filter.slope == 12 ? 12 : 24;
	if(["poly", "mono", "legato"].indexOf( s.voice.mode ) < 0) s.voice.mode = "poly";
	s.voice.unison = Math.round( num( s.voice.unison, 0, 2, 0 ) );
	s.patch = Math.round( num( s.patch, 0, patchCount( s ) - 1, 0 ) );
	s.user = Array.isArray( raw && raw.user ) ? raw.user.slice( 0, 16 ).map(function(u){ return u && typeof u == "object" && u.sound ? { name: String( u.name || "USER" ).substr( 0, 16 ), sound: u.sound } : null; }) : [];
	s.arp.pattern = Math.round( num( s.arp.pattern, 0, 4, 0 ) ); s.arp.octaves = Math.round( num( s.arp.octaves, 1, 4, 1 ) );
	s.fx.reverb.type = Math.round( num( s.fx.reverb.type, 0, 2, 1 ) ); s.fx.chorus.type = Math.round( num( s.fx.chorus.type, 0, 2, 1 ) );
}

function randomize( s )
{
	var r = function(a, b) { return a + Math.random() * (b - a); }, pick = function(l) { return l[ Math.floor( Math.random() * l.length ) ]; };
	s.osc.forEach(function(o, i){ o.wave = pick( WAVES ); o.range = pick([0, 1, 1, 2]); o.coarse = Math.random() < 0.2 ? pick([7, 12, -12, 5]) : 0; o.fine = r( -10, 10 ); o.table = Math.floor( Math.random() * 8 ); o.shape.manual = r( 0, 1 ); o.shape.lfo1 = Math.random() < 0.3 ? r( -0.5, 0.5 ) : 0; });
	s.mix.osc1 = r( 0.5, 0.9 ); s.mix.osc2 = r( 0, 0.8 ); s.mix.osc3 = Math.random() < 0.4 ? r( 0, 0.6 ) : 0; s.mix.ring = Math.random() < 0.2 ? r( 0, 0.5 ) : 0;
	s.filter.freq = r( 0.25, 0.85 ); s.filter.res = r( 0, 0.7 ); s.filter.env = r( -0.2, 0.7 ); s.filter.shape = pick([ "lp", "lp", "lp", "bp", "hp" ]);
	s.env1.a = Math.pow( 10, r( -3, 0.3 ) ); s.env1.d = Math.pow( 10, r( -1.3, 0.4 ) ); s.env1.s = r( 0, 1 );
	s.amp.a = Math.random() < 0.6 ? 0.002 : Math.pow( 10, r( -2, 0.3 ) ); s.amp.r = Math.pow( 10, r( -1.3, 0.4 ) );
	s.fx.reverb.level = r( 0, 0.5 ); s.fx.chorus.level = Math.random() < 0.5 ? r( 0, 0.6 ) : 0; s.fx.delay.level = Math.random() < 0.4 ? r( 0, 0.4 ) : 0;
	s.name = "RANDOM";
}

function send( msg ) { var m = M; act(function(){ m.post( msg ); }); }
function uiOf() { return uis[ M.id ] || (uis[ M.id ] = { menu: "patch", page: 0, row: 0, show: null, cmp: null, hold: false, anim: [false, false] }); }


// ---------------------------------------------------------------------------
// drawing helpers. The layout is measured on a top view of the original, 1040 x 543 for the panel:
// every position below is in those units, X() / Y() / K turn them into the panel's

var K = 1524 / 1040;
function X( x ) { return 22 + (x - 120) * K; }
function Y( y ) { return (y - 372) * K; }

function T( text, x, y, size, color, align, bold )
{
	ctx.font = (bold === false ? "" : "bold ") + (size || 9) + "px Arial, Helvetica, sans-serif";
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
	return { hover: hover, clicked: clicked || kb.pressed, held: (ui.active === full && ui.down) || kb.held };
}

// a section (photo units): a blue line along its top edge, its name under it, and a blue arrow
// on the right for the ones with a page in the menu
function section( name, x0, y0, x1, y1, arrow )
{
	var x = X( x0 ) + 1.5, y = Y( y0 ) + 1.5, w = X( x1 ) - x - 1.5, h = Y( y1 ) - y - 1.5;
	ctx.fillStyle = PANEL; ctx.fillRect( x, y, w, h );
	ctx.fillStyle = BLUE; ctx.fillRect( x, y, w, 2.5 );
	if(name) T( name, x + 5, y + 12, 10.5, INK, "left" );
	if(arrow) { ctx.fillStyle = BLUE; ctx.beginPath(); ctx.moveTo( x + w - 12, y + 6 ); ctx.lineTo( x + w - 4, y + 10.5 ); ctx.lineTo( x + w - 12, y + 15 ); ctx.closePath(); ctx.fill(); }
}

// a white rubber button (photo units: its centre); lit: orange. Its name goes under it
function pbtn( id, px, py, label, lit, tooltip, o )
{
	o = o || {};
	var w = (o.w || 26) * K, h = (o.h || 12) * K, x = X( px ) - w / 2, y = Y( py ) - h / 2;
	var r = hot( id, x, y, w, h );
	ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.beginPath(); ctx.roundRect( x + 1, y + 2, w, h, 2.5 ); ctx.fill();
	var g = ctx.createLinearGradient( 0, y, 0, y + h );
	if(lit) { g.addColorStop( 0, "#ffb36a" ); g.addColorStop( 1, "#ff7414" ); }
	else { g.addColorStop( 0, r.hover ? "#ffffff" : "#ecece8" ); g.addColorStop( 1, r.hover ? "#d6d6d2" : "#c4c4bf" ); }
	ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect( x, y + (r.held ? 1 : 0), w, h, 2.5 ); ctx.fill();
	if(lit) { ctx.fillStyle = "rgba(255,120,30,0.22)"; ctx.beginPath(); ctx.roundRect( x - 3, y - 3, w + 6, h + 6, 5 ); ctx.fill(); }
	if(o.inside) T( o.inside, x + w / 2, y + h / 2 + (r.held ? 1 : 0), o.size || 10, "#1a1a1a" );
	if(label) label.split( "\n" ).forEach(function(l, i){ T( l, x + w / 2, y + h + 9 + i * 10, 8 ); });
	if(r.hover && tooltip) tip( tooltip, x + w / 2, y + h + (label ? 26 : 14) );
	return r;
}

function led( x, y, on, color )
{
	ctx.fillStyle = on ? (color || LED) : "#3a2418";
	ctx.beginPath(); ctx.roundRect( x - 4, y - 2, 8, 4, 2 ); ctx.fill();
	if(on) { ctx.fillStyle = "rgba(255,110,30,0.28)"; ctx.beginPath(); ctx.arc( x, y, 6.5, 0, Math.PI * 2 ); ctx.fill(); }
}

// a stepped choice: a button stepping through it and an LED with each name (photo units:
// the button's centre, and the LEDs' places). dim: lit at half, for the levels in use
function choice( id, bx, by, label, names, index, title, at, levels )
{
	var r = pbtn( id, bx, by, label, false, title + ": " + names[ index ] );
	names.forEach(function(n, i){
		var p = at( i ), on = i == index, dim = levels && levels[i];
		ctx.globalAlpha = on ? 1 : (dim ? 0.5 : 1);
		led( X( p[0] ), Y( p[1] ), on || dim );
		ctx.globalAlpha = 1;
		T( n, X( p[0] ) + 8, Y( p[1] ) + 0.5, 7.5, on ? INK : DIM, "left" );
	});
	return r.clicked ? (index + 1) % names.length : index;
}
function column( x, y ) { return function(i){ return [ x, y + i * 11 ]; }; }

// a knob (photo units), its name under it; its value shows on the OLED while it is turned
function pk( id, px, py, pr, value, min, max, label, o )
{
	o = o || {};
	o.style = "small";
	var cx = X( px ), cy = Y( py ), r = pr * K;
	var v = knob( id, cx, cy, r, value, min, max, o );
	label.split( "\n" ).forEach(function(l, i){ T( l, cx, cy + r + 11 + i * 10, 8 ); });
	var full = id_prefix + id;
	if(ui.active === full || (ui.hot === full && v !== value)) showValue( label.replace( "\n", " " ), o.format ? o.format( v ) : v.toFixed( 2 ) );
	return v;
}

// a bracket under two controls, with its name (photo units)
function bracket( x0, x1, y, name )
{
	ctx.strokeStyle = INK; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.moveTo( X( x0 ), Y( y ) - 3 ); ctx.lineTo( X( x0 ), Y( y ) ); ctx.lineTo( X( x1 ), Y( y ) ); ctx.lineTo( X( x1 ), Y( y ) - 3 ); ctx.stroke();
	var tw = name.length * 5 + 10;
	ctx.fillStyle = PANEL; ctx.fillRect( (X( x0 ) + X( x1 )) / 2 - tw / 2, Y( y ) - 2, tw, 4 );
	T( name, (X( x0 ) + X( x1 )) / 2, Y( y ) + 0.5, 7.5 );
}

function showValue( name, value ) { var u = uiOf(); u.show = [ name, value, performance.now() + 1200 ]; }

var pct = function(v){ return Math.round( v * 100 ) + "%"; };
var bip = function(v){ return (v > 0 ? "+" : "") + Math.round( v * 63 ); };
var tm = function(v){ return v < 1 ? Math.round( v * 1000 ) + " MS" : v.toFixed( 2 ) + " S"; };

// ---------------------------------------------------------------------------
// top: MASTER, ANIMATE, PATCH, MENU, ARP, LFO 1 / 2, GLIDE, the envelopes

function drawMaster()
{
	section( "MASTER", 120, 397, 190, 493 );
	S.volume = pk( "volume", 155, 440, 16, S.volume, 0, 1, "VOLUME", { def: 0.75, format: pct } );
}

function drawAnimate()
{
	var u = uiOf();
	section( "ANIMATE", 120, 495, 190, 612 );
	for(var i = 0; i < 2; ++i)
	{
		var r = pbtn( "anim" + i, 155, 528 + i * 38, "", u.anim[i], "ANIMATE " + (i + 1) + ": " + MOD_DST_N[ MOD_DST.indexOf( S.mod[4 + i].dst ) ] + " (SETTINGS MENU)", { w: 22, h: 24, inside: String( i + 1 ), size: 13 } );
		var on = r.held || (u.hold && u.anim[i]);
		if(r.clicked && u.hold && u.anim[i]) { u.hold = false; on = false; }
		if(on != u.anim[i]) { u.anim[i] = on; send({ type: "anim", n: i, on: on }); }
	}
	if(pbtn( "anim_hold", 155, 600, "", u.hold, "HOLD: ANIMATE STAYS ON", { w: 22, h: 8, inside: "HOLD", size: 7 } ).clicked) u.hold = !u.hold;
}

function drawPatch()
{
	var u = uiOf();
	section( "PATCH", 192, 397, 280, 612 );
	if(pbtn( "init", 214, 427, "INITIALISE", false, "INITIALISE: THE INIT PATCH" ).clicked) { loadPatch( S, 0 ); showValue( "PATCH", "INIT PATCH" ); }
	var c = pbtn( "compare", 257, 427, "COMPARE", !!u.cmp, "HOLD: THE PATCH AS SAVED" );
	if(c.held && !u.cmp) { u.cmp = sound( S ); var p = S.patch; loadPatch( S, p ); }
	else if(!c.held && u.cmp) { var keep = u.cmp; u.cmp = null; Object.keys( keep ).forEach(function(k){ S[k] = keep[k]; }); }
	var a = pbtn( "audition", 214, 457, "AUDITION", false, "PLAYS MIDDLE C" );
	if(a.clicked) send({ type: "note", note: 60, on: true, vel: 0.8 });
	if(u.aud && !a.held) send({ type: "note", note: 60, on: false });
	u.aud = a.held;
	var n = patchCount( S );
	if(pbtn( "save", 257, 457, "SAVE", false, "SAVE INTO A USER SLOT (" + (PATCHES.length) + "-" + (PATCHES.length + 15) + ")" ).clicked)
	{
		var slot = S.patch >= PATCHES.length ? S.patch - PATCHES.length : S.user.findIndex(function(x){ return !x; });
		if(slot < 0) slot = S.user.length < 16 ? S.user.length : 15;
		var name = S.patch >= PATCHES.length ? S.name : (S.name == "INIT PATCH" ? "USER " + (slot + 1) : S.name);
		S.user[ slot ] = { name: name.substr( 0, 16 ), sound: sound( S ) };
		S.patch = PATCHES.length + slot; S.name = name;
		showValue( "SAVED", String( S.patch ).padStart( 3, "0" ) + " " + name );
	}
	// the PATCH encoder over the factory patches and the 16 user slots
	var v = knob( "patch_sel", X( 235 ), Y( 525 ), 16 * K, S.patch, 0, n - 1, { step: 1, style: "small", ticks: 2, format: function(i){ return String( i ).padStart( 3, "0" ) + " " + patchName( S, i ); } } );
	if(v != S.patch) { loadPatch( S, v ); showValue( "PATCH", String( v ).padStart( 3, "0" ) + " " + S.name ); }
	if(pbtn( "patch_dn", 214, 582, "", false, "PREVIOUS PATCH" ).clicked) { loadPatch( S, (S.patch + n - 1) % n ); showValue( "PATCH", S.name ); }
	if(pbtn( "patch_up", 257, 582, "", false, "NEXT PATCH" ).clicked) { loadPatch( S, (S.patch + 1) % n ); showValue( "PATCH", S.name ); }
	T( "-", X( 214 ), Y( 600 ), 10 ); T( "PATCH", X( 235.5 ), Y( 600 ), 8 ); T( "+", X( 257 ), Y( 600 ), 10 );
}

// the MENU: the OLED, the nine menu buttons, rows, pages, the parameter encoder
function rowDefs()
{
	var u = uiOf(), s = S;
	var P = function(name, get, set, fmt, min, max, step) { return { name: name, get: get, set: set, fmt: fmt || function(v){ return String( v ); }, min: min, max: max, step: step || 1 }; };
	var lst = function(names) { return function(v){ return names[v]; }; };
	switch(u.menu)
	{
		case "patch": return [{ title: "PATCH", rows: [
			P( "PATCH", function(){ return s.patch; }, function(v){ loadPatch( s, v ); }, function(v){ return String( v ).padStart( 3, "0" ) + " " + patchName( s, v ); }, 0, patchCount( s ) - 1 ),
			P( "CATEGORY", function(){ return 0; }, function(){}, function(){ return s.patch < PATCHES.length ? PATCHES[ s.patch ][1] : "USER"; }, 0, 0 ),
			P( "VOICES", function(){ return 0; }, function(){}, function(){ return (ST.voices || []).filter(function(x){ return x; }).length + " / 8 ACTIVE"; }, 0, 0 ) ] }];
		case "osc": return [0, 1, 2].map(function(k){ var o = s.osc[k]; return { title: "OSCILLATOR " + (k + 1), rows: [
			P( "WAVETABLE", function(){ return o.table; }, function(v){ o.table = v; }, lst( TABLES ), 0, 7 ),
			P( "SHAPE ENV 1", function(){ return Math.round( o.shape.env1 * 63 ); }, function(v){ o.shape.env1 = v / 63; }, bipI, -63, 63 ),
			P( "SHAPE LFO 1", function(){ return Math.round( o.shape.lfo1 * 63 ); }, function(v){ o.shape.lfo1 = v / 63; }, bipI, -63, 63 ) ] }; });
		case "env": return [["AMP ENV", s.amp], ["MOD ENV 1", s.env1], ["MOD ENV 2", s.env2]].map(function(e, k){ return { title: e[0], rows: [
			P( "HOLD", function(){ return Math.round( e[1].h * 100 ); }, function(v){ e[1].h = v / 100; }, function(v){ return (v / 100).toFixed( 2 ) + " S"; }, 0, 300 ),
			k == 0 ? P( "VELOCITY", function(){ return Math.round( s.voice.vel * 100 ); }, function(v){ s.voice.vel = v / 100; }, function(v){ return v + "%"; }, 0, 100 )
			       : P( "ATTACK", function(){ return Math.round( e[1].a * 100 ); }, function(v){ e[1].a = Math.max( 0.001, v / 100 ); }, function(v){ return (v / 100).toFixed( 2 ) + " S"; }, 0, 1000 ),
			P( "RELEASE", function(){ return Math.round( e[1].r * 100 ); }, function(v){ e[1].r = Math.max( 0.005, v / 100 ); }, function(v){ return (v / 100).toFixed( 2 ) + " S"; }, 1, 1000 ) ] }; });
		case "lfo": return [{ title: "LFO", rows: [
			P( "LFO 1 FADE", function(){ return Math.round( s.lfo[0].fade * 100 ); }, function(v){ s.lfo[0].fade = v / 100; }, function(v){ return (v / 10).toFixed( 1 ) + " S"; }, 0, 100 ),
			P( "KEY SYNC", function(){ return s.lfo_retrig ? 1 : 0; }, function(v){ s.lfo_retrig = !!v; }, lst([ "OFF", "ON" ]), 0, 1 ),
			P( "LFO 2 TYPE", function(){ return ["tri", "saw", "square", "sh"].indexOf( s.lfo[1].type ); }, function(v){ s.lfo[1].type = ["tri", "saw", "square", "sh"][v]; }, lst([ "TRIANGLE", "SAW", "SQUARE", "S & H" ]), 0, 3 ) ] }];
		case "arp": return [{ title: "ARP / CLOCK", rows: [
			P( "TEMPO", function(){ return Math.round( s.arp.tempo ); }, function(v){ s.arp.tempo = v; }, function(v){ return v + " BPM"; }, 40, 240 ),
			P( "PATTERN", function(){ return s.arp.pattern; }, function(v){ s.arp.pattern = v; }, lst( ARP_PAT ), 0, 4 ),
			P( "OCTAVES", function(){ return s.arp.octaves; }, function(v){ s.arp.octaves = v; }, String, 1, 4 ) ] },
			{ title: "ARP / CLOCK 2", rows: [
			P( "SWING", function(){ return Math.round( s.arp.swing * 100 ); }, function(v){ s.arp.swing = v / 100; }, function(v){ return (50 + v / 2) + "%"; }, 0, 50 ),
			P( "KEY LATCH", function(){ return s.arp.latch ? 1 : 0; }, function(v){ s.arp.latch = !!v; }, lst([ "OFF", "ON" ]), 0, 1 ),
			P( "ARP", function(){ return s.arp.on ? 1 : 0; }, function(v){ s.arp.on = !!v; }, lst([ "OFF", "ON" ]), 0, 1 ) ] }];
		case "mod": return s.mod.map(function(m, k){ return { title: "MOD MATRIX SLOT " + (k + 1), rows: [
			P( "SOURCE", function(){ return MOD_SRC.indexOf( m.src ); }, function(v){ m.src = MOD_SRC[v]; }, lst( MOD_SRC_N ), 0, MOD_SRC.length - 1 ),
			P( "DEST", function(){ return MOD_DST.indexOf( m.dst ); }, function(v){ m.dst = MOD_DST[v]; }, lst( MOD_DST_N ), 0, MOD_DST.length - 1 ),
			P( "DEPTH", function(){ return Math.round( m.depth * 63 ); }, function(v){ m.depth = v / 63; }, bipI, -63, 63 ) ] }; });
		case "voice": return [{ title: "VOICE", rows: [
			P( "MODE", function(){ return ["poly", "mono", "legato"].indexOf( s.voice.mode ); }, function(v){ s.voice.mode = ["poly", "mono", "legato"][v]; send({ type: "allNotesOff" }); }, lst([ "POLY", "MONO", "MONO LEGATO" ]), 0, 2 ),
			P( "UNISON", function(){ return s.voice.unison; }, function(v){ s.voice.unison = v; send({ type: "allNotesOff" }); }, lst([ "OFF", "2 VOICES", "4 VOICES" ]), 0, 2 ),
			P( "DETUNE", function(){ return Math.round( s.voice.detune * 100 ); }, function(v){ s.voice.detune = v / 100; }, String, 0, 100 ) ] },
			{ title: "VOICE 2", rows: [
			P( "BEND RANGE", function(){ return s.voice.bend; }, function(v){ s.voice.bend = v; }, function(v){ return v + " SEMI"; }, 1, 12 ),
			P( "TUNE", function(){ return Math.round( s.voice.tune ); }, function(v){ s.voice.tune = v; }, function(v){ return (v > 0 ? "+" : "") + v + " CENTS"; }, -100, 100 ),
			P( "AMP VELOCITY", function(){ return Math.round( s.voice.vel * 100 ); }, function(v){ s.voice.vel = v / 100; }, function(v){ return v + "%"; }, 0, 100 ) ] }];
		case "fx": return [{ title: "EFFECTS", rows: [
			P( "DELAY SYNC", function(){ return s.fx.delay.sync ? 1 : 0; }, function(v){ s.fx.delay.sync = !!v; }, lst([ "OFF", "ON (ARP TEMPO)" ]), 0, 1 ),
			P( "REVERB TYPE", function(){ return s.fx.reverb.type; }, function(v){ s.fx.reverb.type = v; }, lst([ "1: ROOM", "2: HALL", "3: LARGE" ]), 0, 2 ),
			P( "CHORUS TYPE", function(){ return s.fx.chorus.type; }, function(v){ s.fx.chorus.type = v; }, lst([ "1: SUBTLE", "2: CLASSIC", "3: DEEP" ]), 0, 2 ) ] }];
		default: return [{ title: "SETTINGS", rows: [
			P( "MIDI CHANNEL", function(){ return s.midi_channel || 0; }, function(v){ s.midi_channel = v; }, function(v){ return v ? String( v ) : "ALL"; }, 0, 16 ),
			P( "ANIMATE 1", function(){ return MOD_DST.indexOf( s.mod[4].dst ); }, function(v){ s.mod[4].src = "anim1"; s.mod[4].dst = MOD_DST[v]; }, lst( MOD_DST_N ), 0, MOD_DST.length - 1 ),
			P( "ANIMATE 2", function(){ return MOD_DST.indexOf( s.mod[5].dst ); }, function(v){ s.mod[5].src = "anim2"; s.mod[5].dst = MOD_DST[v]; }, lst( MOD_DST_N ), 0, MOD_DST.length - 1 ) ] }];
	}
}
var bipI = function(v){ return (v > 0 ? "+" : "") + v; };

function drawMenu()
{
	var u = uiOf(), pages = rowDefs();
	u.page = Math.min( u.page, pages.length - 1 );
	var page = pages[ u.page ];
	section( "MENU", 282, 397, 593, 612 );
	// the OLED
	var ox = X( 338 ), oy = Y( 498 ), ow = X( 516 ) - ox, oh = Y( 558 ) - oy;
	ctx.fillStyle = "#050607"; ctx.beginPath(); ctx.roundRect( ox - 6, oy - 4, ow + 12, oh + 8, 3 ); ctx.fill();
	var lines;
	if(u.show && performance.now() < u.show[2]) lines = [ u.show[0], "", u.show[1], "" ];
	else
	{
		u.show = null;
		if(u.menu == "patch" && !u.browsing)
			lines = [ "MOUNT  " + String( S.patch ).padStart( 3, "0" ), S.name, S.patch < PATCHES.length ? PATCHES[ S.patch ][1] : "USER", "VOICES " + (ST.voices || []).map(function(x){ return x == 2 ? "■" : (x ? "▪" : "·"); }).join( "" ) ];
		else
			lines = [ page.title + (pages.length > 1 ? "  " + (u.page + 1) + "/" + pages.length : "") ].concat( page.rows.map(function(r, i){
				var v = r.fmt( r.get() ); return (u.row == i ? "▸" : " ") + r.name + " " + v; }) );
	}
	ctx.font = "bold 14px 'Courier New', Courier, monospace";
	ctx.textAlign = "left"; ctx.textBaseline = "middle";
	lines.forEach(function(l, i){
		l = String( l ).toUpperCase().substr( 0, 28 );
		ctx.fillStyle = i == 0 ? "#ffffff" : OLED;
		ctx.fillText( l, ox + 4, oy + 10 + i * (oh - 8) / 4 );
	});
	// the row buttons, left of the rows 2-4
	for(var i = 0; i < 3; ++i)
		if(pbtn( "row" + i, 306, 507 + i * 26, "", u.row == i && u.menu != "patch", "ROW " + (i + 2) + ": THE ENCODER CHANGES IT", { w: 24, h: 12 } ).clicked) { u.row = i; u.show = null; }
	// the value encoder, VALUE - / +
	var row = page.rows[ u.row ], cur = row.get();
	var nv = knob( "param", X( 550 ), Y( 522 ), 17 * K, cur, row.min, Math.max( row.max, row.min + 1 ), { step: row.step, style: "small", ticks: 2, format: function(v){ return row.name + " " + row.fmt( v ); } } );
	if(pbtn( "val_dn", 528, 582, "", false, "VALUE -" ).clicked) nv = Math.max( row.min, cur - 1 );
	if(pbtn( "val_up", 571, 582, "", false, "VALUE +" ).clicked) nv = Math.min( row.max, cur + 1 );
	T( "-", X( 528 ), Y( 600 ), 10 ); T( "VALUE", X( 549.5 ), Y( 600 ), 8 ); T( "+", X( 571 ), Y( 600 ), 10 );
	if(nv != cur && row.max > row.min) { row.set( nv ); u.browsing = u.menu == "patch"; }
	// PATCH (lit orange) and the eight menus, two rows of four
	var menus = [["osc", "OSC"], ["env", "ENV"], ["lfo", "LFO"], ["arp", "ARP/CLOCK"], ["mod", "MOD"], ["voice", "VOICE"], ["fx", "FX"], ["settings", "SETTINGS"]];
	var pick = function(m){
		if(u.menu == m) { u.page = (u.page + 1) % rowDefs().length; }
		else { u.menu = m; u.page = 0; u.row = m == "patch" ? 0 : u.row; }
		u.browsing = m != "patch"; u.show = null;
	};
	if(pbtn( "menu_patch", 298, 443, "PATCH", u.menu == "patch", "PATCH MENU", { w: 20, h: 14 } ).clicked) pick( "patch" );
	menus.forEach(function(m, i){
		if(pbtn( "menu_" + m[0], 362 + (i % 4) * 42, 427 + Math.floor( i / 4 ) * 30, m[1], u.menu == m[0], m[1] + " MENU", { w: 30 } ).clicked) pick( m[0] );
	});
	if(pbtn( "page_dn", 404, 582, "", false, "PAGE" ).clicked) u.page = (u.page + pages.length - 1) % pages.length;
	if(pbtn( "page_up", 446, 582, "", false, "PAGE" ).clicked) u.page = (u.page + 1) % pages.length;
	T( "◀  PAGE / SELECT  ▶", X( 425 ), Y( 600 ), 8 );
	// ACTIVE VOICES: 2 rows of 4 LEDs
	for(var k = 0; k < 8; ++k)
	{
		var lx = X( 527 + (k % 4) * 16 ), ly = Y( k < 4 ? 437 : 448 );
		T( String( k + 1 ), lx, ly + (k < 4 ? -9 : 9), 7, DIM );
		led( lx, ly, ST.voices && ST.voices[k] );
	}
	T( "ACTIVE VOICES", X( 551 ), Y( 467 ), 8 );
}

function drawArp()
{
	section( "ARP", 595, 397, 652, 612 );
	S.arp.gate = pk( "arp_gate", 623, 440, 15, S.arp.gate, 0.05, 1, "GATE", { def: 0.5, format: pct } );
	if(pbtn( "arp_latch", 623, 527, "KEY LATCH", S.arp.latch, "KEY LATCH: THE NOTES PLAY ON AFTER THE KEYS ARE LET GO" ).clicked) S.arp.latch = !S.arp.latch;
	if(pbtn( "arp_on", 623, 582, "ON", S.arp.on, "ARPEGGIATOR (MORE IN THE ARP/CLOCK MENU)" ).clicked) { S.arp.on = !S.arp.on; send({ type: "allNotesOff" }); }
}

function drawLfo( i )
{
	var p = S.lfo[i], types = ["tri", "saw", "square", "sh"], d = i * 254;
	section( "LFO " + (i + 1), 654 + d, 397, 906 + d, 493 );
	p.type = types[ choice( "lfo" + i + "_type", 700 + d, 472, "TYPE", ["TRI", "SAW", "SQUARE", "S+H"], types.indexOf( p.type ), "LFO " + (i + 1) + " TYPE", column( 690 + d, 422 ) ) ];
	var ranges = ["low", "high", "sync"];
	p.range = ranges[ choice( "lfo" + i + "_range", 815 + d, 472, "RANGE", ["LOW", "HIGH", "SYNC"], ranges.indexOf( p.range ), "LFO " + (i + 1) + " RANGE", column( 802 + d, 433 ) ) ];
	p.fade = pk( "lfo" + i + "_fade", 759 + d, 440, 16, p.fade, 0, 1, "FADE TIME", { def: 0, format: function(v){ return v < 0.01 ? "OFF" : (v * 10).toFixed( 1 ) + " S"; } } );
	p.rate = pk( "lfo" + i + "_rate", 871 + d, 440, 17, p.rate, 0, 1, "RATE", { def: 0.4, format: function(v){
		if(p.range == "sync") return SYNC_N[ Math.round( v * (SYNC_DIV_N - 1) ) ];
		var hz = p.range == "low" ? 0.01 * Math.pow( 300, v ) : 0.3 * Math.pow( 200, v );
		return hz < 10 ? hz.toFixed( 2 ) + " HZ" : Math.round( hz ) + " HZ";
	} } );
	led( X( 730 + d ), Y( 408 ), ST.lfo && ST.lfo[i] > 0.3 ); // the LFO's beat
}

function drawGlide()
{
	section( "GLIDE", 654, 495, 722, 612 );
	S.glide.time = pk( "glide_time", 688, 535, 15, S.glide.time, 0.002, 4, "TIME", { exp: true, def: 0.1, format: tm } );
	if(pbtn( "glide_on", 688, 582, "ON", S.glide.on, "GLIDE ON / OFF" ).clicked) S.glide.on = !S.glide.on;
}

// the sliders of an envelope (photo units: the columns, the top of the slots)
var ENV_NAMES = ["ATTACK", "DECAY", "SUSTAIN", "RELEASE"], ENV_KEYS = ["a", "d", "s", "r"];
function envToN( k, v ) { return k == "s" ? v : Math.log( v / 0.001 ) / Math.log( 20 / 0.001 ); }
function envFromN( k, n ) { return k == "s" ? n : 0.001 * Math.pow( 20 / 0.001, n ); }
function faders( env, prefix, cols )
{
	ENV_KEYS.forEach(function(k, i){
		var x = X( cols[i] ), y = Y( 516 ), len = Y( 590 ) - y;
		// the scale beside the slot
		ctx.fillStyle = "#6d6e6c";
		for(var s = 0; s <= 10; ++s) ctx.fillRect( x - 17, y + len * s / 10, 6, 1 );
		var n0 = envToN( k, env[k] ), n = fader( prefix + k, x, y, len, n0, { def: k == "s" ? 0.7 : 0.4 } );
		if(n != n0) { env[k] = envFromN( k, n ); showValue( prefix.replace( "_", " " ).toUpperCase() + ENV_NAMES[i], k == "s" ? pct( env[k] ) : tm( env[k] ) ); }
		T( ENV_NAMES[i], x, Y( 605 ), 7.5 );
	});
}

function drawEnvelopes()
{
	section( "AMP ENVELOPE", 724, 495, 906, 612 );
	faders( S.amp, "amp_", [745, 792, 837, 882] );
	section( "MOD ENVELOPES", 908, 495, 1160, 612 );
	S.env_sel = choice( "env_sel", 940, 582, "SELECT", ["1", "2"], S.env_sel - 1, "SELECT: THE MOD ENVELOPE THE SLIDERS SET", column( 930, 552 ) ) + 1;
	faders( S.env_sel == 1 ? S.env1 : S.env2, "env" + S.env_sel + "_", [988, 1033, 1078, 1123] );
}

// ---------------------------------------------------------------------------
// bottom: the OSCILLATOR rows, MIXER, FILTER, the effects

function drawOscillators()
{
	var srcs = ["manual", "env1", "lfo1"];
	S.osc.forEach(function(o, k){
		var d = k * 88, n = k + 1;
		section( "OSCILLATOR " + n, 120, 615 + d, 593, 701 + d, true );
		var ranges = ["16'", "8'", "4'", "2'"];
		o.range = choice( "osc" + n + "_range", 157, 675 + d, "RANGE", ranges, o.range, "OSC " + n + " RANGE", function(i){ return [ 143 + (i >> 1) * 24, 645 + (i & 1) * 11 + d ]; } );
		o.coarse = pk( "osc" + n + "_coarse", 210, 652 + d, 16, o.coarse, -12, 12, "COARSE", { def: 0, step: 0.01, ticks: 25, bipolar: true, format: function(v){ return (v > 0 ? "+" : "") + v.toFixed( 2 ) + " SEMI"; } } );
		o.fine = pk( "osc" + n + "_fine", 270, 652 + d, 16, o.fine, -100, 100, "FINE", { def: 0, bipolar: true, format: function(v){ return (v > 0 ? "+" : "") + Math.round( v ) + " CENTS"; } } );
		var wi = choice( "osc" + n + "_wave", 327, 675 + d, "WAVE", ["SINE", "TRI", "SAW", "PULSE", "MORE"], WAVES.indexOf( o.wave ), "OSC " + n + " WAVE",
			function(i){ return i < 3 ? [ 297, 634 + i * 11 + d ] : [ 329, 634 + (i - 3) * 11 + d ]; } );
		if(WAVES[wi] != o.wave) { o.wave = WAVES[wi]; showValue( "OSC " + n + " WAVE", o.wave == "more" ? "TABLE " + TABLES[ o.table ] : o.wave.toUpperCase() ); }
		o.env2 = pk( "osc" + n + "_env2", 378, 652 + d, 16, o.env2, -1, 1, "MOD ENV 2 DEPTH", { def: 0, bipolar: true, format: bip } );
		o.lfo2 = pk( "osc" + n + "_lfo2", 443, 652 + d, 16, o.lfo2, -1, 1, "LFO 2 DEPTH", { def: 0, bipolar: true, format: bip } );
		bracket( 362, 459, 692 + d, "PITCH" );
		var si = srcs.indexOf( o.src );
		var nsi = choice( "osc" + n + "_src", 557, 675 + d, "", ["MANUAL", "MOD ENV 1", "LFO 1"], si, "OSC " + n + " SHAPE SOURCE (THE KNOB EDITS IT)", column( 543, 634 + d ),
			[ true, Math.abs( o.shape.env1 ) > 0.01, Math.abs( o.shape.lfo1 ) > 0.01 ] );
		o.src = srcs[ nsi ];
		var man = o.src == "manual";
		o.shape[ o.src ] = pk( "osc" + n + "_shape", 503, 652 + d, 16, o.shape[ o.src ], man ? 0 : -1, 1, "SHAPE AMOUNT", { def: man ? 0.5 : 0, bipolar: !man,
			format: function(v){ return (man ? (o.wave == "pulse" ? "WIDTH " : "SHAPE ") + Math.round( v * 100 ) + "%" : (o.src == "env1" ? "MOD ENV 1 " : "LFO 1 ") + bip( v )); } } );
		bracket( 488, 572, 692 + d, "SOURCE" );
	});
}

function drawMixer()
{
	section( "MIXER", 595, 615, 652, 888 );
	section( "", 654, 615, 722, 701 );
	section( "", 654, 703, 722, 888 );
	ctx.fillStyle = BLUE; ctx.beginPath(); ctx.moveTo( X( 712 ), Y( 619 ) ); ctx.lineTo( X( 718 ), Y( 622 ) ); ctx.lineTo( X( 712 ), Y( 625 ) ); ctx.fill();
	var m = S.mix, knobs = [["osc1", "OSC 1", 625, 652], ["vca", "VCA GAIN", 686, 652], ["osc2", "OSC 2", 625, 740], ["ring", "RING 1+2", 686, 740], ["osc3", "OSC 3", 625, 827], ["noise", "NOISE", 686, 827]];
	knobs.forEach(function(r){
		m[ r[0] ] = pk( "mix_" + r[0], r[2], r[3], 16, m[ r[0] ], 0, 1, r[1], { def: r[0] == "osc1" || r[0] == "vca" ? 0.8 : 0, format: pct } );
	});
}

function drawFilter()
{
	var f = S.filter;
	section( "FILTER", 724, 615, 906, 888, true );
	f.lfo1 = pk( "flt_lfo1", 752, 652, 16, f.lfo1, -1, 1, "LFO 1 DEPTH", { def: 0, bipolar: true, format: bip } );
	f.osc3 = pk( "flt_osc3", 815, 652, 16, f.osc3, 0, 1, "OSC 3 FILTER MOD", { def: 0, format: pct } );
	f.track = pk( "flt_track", 876, 652, 16, f.track, 0, 1, "KEY TRACKING", { def: 0.5, format: pct } );
	f.env = pk( "flt_env", 752, 740, 16, f.env, -1, 1, "ENV DEPTH", { def: 0, bipolar: true, format: bip } );
	f.res = pk( "flt_res", 815, 740, 16, f.res, 0, 1, "RESONANCE", { def: 0.1, format: pct } );
	f.drive = pk( "flt_drive", 876, 740, 16, f.drive, 0, 1, "OVERDRIVE", { def: 0, format: pct } );
	f.freq = pk( "flt_freq", 815, 830, 26, f.freq, 0, 1, "FREQUENCY", { def: 0.75, format: function(v){ var hz = 20 * Math.pow( 1000, v ); return hz < 1000 ? Math.round( hz ) + " HZ" : (hz / 1000).toFixed( 2 ) + " KHZ"; } } );
	// SOURCE: MOD ENV 1, AMP ENV or both (both LEDs lit)
	var src = f.src_env1 && f.src_amp ? 2 : (f.src_amp ? 1 : 0);
	var r = pbtn( "flt_src", 755, 812, "SOURCE", false, "THE ENVELOPE(S) MOVING THE FREQUENCY: " + ["MOD ENV 1", "AMP ENV", "BOTH"][ src ] );
	if(r.clicked) { src = (src + 1) % 3; f.src_env1 = src != 1; f.src_amp = src != 0; }
	[["AMP ENV", f.src_amp], ["MOD ENV 1", f.src_env1]].forEach(function(e, i){ led( X( 742 ), Y( 782 + i * 11 ), e[1] ); T( e[0], X( 742 ) + 8, Y( 782 + i * 11 ) + 0.5, 7.5, e[1] ? INK : DIM, "left" ); });
	f.slope = choice( "flt_slope", 755, 866, "SLOPE", ["12 dB", "24 dB"], f.slope == 24 ? 1 : 0, "FILTER SLOPE", column( 742, 836 ) ) ? 24 : 12;
	var sh = ["lp", "bp", "hp"];
	f.shape = sh[ choice( "flt_shape", 876, 866, "SHAPE", ["LP", "BP", "HP"], sh.indexOf( f.shape ), "FILTER SHAPE", column( 862, 826 ) ) ];
}

function drawEffects()
{
	var fx = S.fx;
	section( "DISTORTION", 908, 615, 970, 701 );
	fx.dist = pk( "fx_dist", 940, 652, 16, fx.dist, 0, 1, "LEVEL", { def: 0, format: pct } );
	section( "CHORUS", 972, 615, 1160, 701, true );
	fx.chorus.rate = pk( "cho_rate", 1009, 652, 16, fx.chorus.rate, 0, 1, "RATE", { def: 0.3, format: pct } );
	fx.chorus.type = choice( "cho_type", 1065, 675, "TYPE", ["1", "2", "3"], fx.chorus.type, "CHORUS TYPE", column( 1052, 634 ) );
	fx.chorus.level = pk( "cho_level", 1122, 652, 16, fx.chorus.level, 0, 1, "LEVEL", { def: 0, format: pct } );
	section( "DELAY", 908, 703, 1160, 789, true );
	fx.delay.fb = pk( "dly_fb", 940, 740, 16, fx.delay.fb, 0, 0.95, "FEEDBACK", { def: 0.3, format: pct } );
	fx.delay.time = pk( "dly_time", 1009, 740, 16, fx.delay.time, 0, 1, "TIME", { def: 0.3, format: function(v){ return fx.delay.sync ? SYNC_N[ 11 + Math.round( v * 7 ) ] : Math.round( (0.01 + v * 1.39) * 1000 ) + " MS"; } } );
	if(pbtn( "dly_sync", 1059, 742, "SYNC", fx.delay.sync, "DELAY TIME IN NOTES OF THE ARP TEMPO", { w: 18 } ).clicked) fx.delay.sync = !fx.delay.sync;
	fx.delay.level = pk( "dly_level", 1122, 740, 16, fx.delay.level, 0, 1, "LEVEL", { def: 0, format: pct } );
	section( "EFFECTS", 908, 791, 970, 888 );
	if(pbtn( "fx_bypass", 940, 828, "BYPASS", fx.bypass, "BYPASS: NO CHORUS, DELAY OR REVERB" ).clicked) fx.bypass = !fx.bypass;
	section( "REVERB", 972, 791, 1160, 888, true );
	fx.reverb.time = pk( "rev_time", 1009, 828, 16, fx.reverb.time, 0, 1, "TIME", { def: 0.5, format: pct } );
	fx.reverb.type = choice( "rev_type", 1065, 851, "TYPE", ["1", "2", "3"], fx.reverb.type, "REVERB TYPE (3: THE LARGEST)", column( 1052, 810 ) );
	fx.reverb.level = pk( "rev_level", 1122, 828, 16, fx.reverb.level, 0, 1, "LEVEL", { def: 0, format: pct } );
}

// the CV MOD IN socket, on the strip above the sections
function drawCvIn()
{
	var full = id_prefix + "cv_in", cx = X( 132 ), cy = Y( 384.5 );
	jacks[ full ] = { x: rackX( cx ), y: rackY( cy ), type: "in", label: "CV MOD IN" };
	var hover = hitCircle( cx, cy, 12 );
	if(cable_drag && cable_drag.from != full && jackCompatible( cable_drag, jacks[ full ] )) { ctx.strokeStyle = hover ? "#fff" : "rgba(255,255,255,0.3)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc( cx, cy, 13, 0, Math.PI * 2 ); ctx.stroke(); }
	ctx.fillStyle = "#a9aaa6"; ctx.beginPath(); ctx.arc( cx, cy, 9, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = hover && !cable_drag ? "#333" : "#060606"; ctx.beginPath(); ctx.arc( cx, cy, 5.5, 0, Math.PI * 2 ); ctx.fill();
	T( "CV MOD IN", cx + 16, cy + 0.5, 8, INK, "left" );
	if(hover && !cable_drag) tip( "CV MOD IN (±5 V): A SOURCE OF THE MOD MATRIX", cx, cy + 22 );
}

// ---------------------------------------------------------------------------

function draw( mod )
{
	M = mod; S = mod.settings;
	ST = M.state = M.state || { voices: [], lfo: [0, 0] };
	var w = SIZE[0], h = SIZE[1];
	drawCasing( 0, 0, w, h );
	ctx.fillStyle = PANEL2; ctx.fillRect( 22, 0, w - 44, h );
	// the name, top right, and the strip along the front edge
	ctx.font = "bold italic 26px Arial, Helvetica, sans-serif";
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "3px";
	ctx.fillStyle = INK; ctx.textAlign = "right"; ctx.textBaseline = "middle";
	ctx.fillText( "MOUNT", X( 1158 ), Y( 384.5 ) + 1 );
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
	T( "WAVETABLE OSCILLATORS", X( 124 ), Y( 902 ), 10.5, INK, "left" );
	T( "EIGHT-VOICE POLYPHONIC SYNTHESIZER", X( 1158 ), Y( 902 ), 10.5, INK, "right" );
	drawCvIn();
	drawMaster();
	drawAnimate();
	drawPatch();
	drawMenu();
	drawArp();
	drawLfo( 0 );
	drawLfo( 1 );
	drawGlide();
	drawEnvelopes();
	drawOscillators();
	drawMixer();
	drawFilter();
	drawEffects();
	M = null; S = null; ST = null;
}

WR.registerSynth( "mount", {
	title: "MOUNT",
	description: "MOUNT: 8 voice polyphonic synthesizer with wavetables, a mod matrix and effects",
	about: "8 voices of 3 oscillators (with wavetables), a multimode filter, three envelopes, two LFOs, a mod matrix with ANIMATE buttons, an arpeggiator, and distortion, chorus, delay and reverb.",
	key_prio: [["^anim\\d$", 3], ["^(audition|arp_on|arp_latch|glide_on)$", 2], ["^(patch_dn|patch_up|fx_bypass|anim_hold)$", 2], ["^(menu_|row|page_|val_)", 1], ["", 0]],
	knob_jacks: [["^(flt_freq|volume)$", ["cv_in"]]],
	category: "Synths",
	knob_skin: "greycap",
	worklet: "devices/mount-worklet.js",
	jacks: [[ ["CV MOD IN", "in", "cv_in"] ]],
	rear_jacks: [["OUT L", "aout", "out_l"], ["OUT R", "aout", "out_r"]],
	audio_out: "out_l",
	audio_out_r: "out_r",
	midi_in: "midi_in",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function() { return SIZE; },
	draw: draw,
	rear_note: function( s ) { return String( s.patch ).padStart( 3, "0" ) + " " + s.name + " · " + s.voice.mode.toUpperCase(); },
	transport: function( mod, action, value ) { if(action == "trigger") mod.post({ type: "trigger", gate: value }); }
});

})();
