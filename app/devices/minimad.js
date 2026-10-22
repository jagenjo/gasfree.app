// devices/minimad.js
// MINIMAD module: a small digital / analog hybrid synthesizer with a flat touch keyboard, laid out as
// the instrument it is after. A charcoal top panel with white print: the modulation MATRIX (5 sources by
// 7 destinations, ASSIGN 1-3 with their buttons, its encoder), PARAPHONIC, PANEL, the display bay (OLED,
// PRESET encoder, SAVE, UTILITY), MASTER; GLIDE, DIGITAL OSCILLATOR (four orange knobs: TYPE, WAVE,
// TIMBRE, SHAPE), ANALOG FILTER (TYPE, CUTOFF, RESONANCE), CYCLING ENVELOPE (MODE, RISE, FALL,
// HOLD / SUSTAIN, AMOUNT); OCTAVE, SHIFT, ARP / SEQ (ARP|SEQ, OCT|MOD, RATE / SWING), LFO (SHAPE,
// RATE), ENVELOPE (AMP MOD, ATTACK, DECAY / REL, SUSTAIN, FILTER AMT). Under a decorated band, the
// white keyboard board with copper pads: the touch row (HOLD, UP|A, ORDER|B, RANDOM|REC, PATTERN|PLAY,
// SPICE, DICE, BEND, the touch strip) and 25 flat keys (lower on a key: more pressure). SHIFT gives the
// controls their second function (printed in blue). A thin strip on the top edge has the CV sockets the
// original has on its back. DSP in minimad-worklet.js.

(function(){

var SIZE = [1568, 972];
var TOP = 52;                                   // the CV strip on the top edge
var KX = 1524 / 1035, KY = 920 / 775;           // the layout, measured on the original (in its units)
function X( x ) { return 22 + (x - 125) * KX; }
function Y( y ) { return TOP + (y - 45) * KY; }
var T = WR_DSP.minimad.TABLES, MAP = T.MAP;
var PANEL = "#2a2b2f", PRINT = "#eceae4", DIM = "#8e8c86", BLUE = "#55b6ff", PCB = "#f3f2ee", COPPER = "#e07a2e";
var JACKS = [[["CLOCK IN", "in", "clock_in"], ["CLOCK OUT", "out", "clock_out"], ["PITCH", "out", "pitch_out"], ["GATE", "out", "gate_out"], ["PRESSURE", "out", "press_out"]]];
var REAR_JACKS = [["OUT L", "aout", "out_l"], ["OUT R", "aout", "out_r"]];
var WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK_AT = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // a black key: after which white key of the octave
var BEND_RANGES = [2, 7, 12];
var USER_KEY = "GASFREE_minimad";               // the sounds saved with SAVE, in this browser
var M = null, S = null, ST = null;
var uis = {};      // module id -> { note, press, sel: [row, col], disp, shift, loaded, strip }

function emptyMatrix() { return [0, 1, 2, 3, 4].map(function(){ return [0, 0, 0, 0, 0, 0, 0]; }); }

function defaults()
{
	var mx = emptyMatrix();
	mx[3][2] = 0.3;  // PRESSURE -> TIMBRE: press harder, brighter
	return {
		type: 0, wave: 0.35, timbre: 0.5, shape: 0.2,
		cutoff: 0.72, res: 0.25, ftype: 0,
		cyc_rise: 0.3, cyc_fall: 0.45, cyc_hold: 0.5, cyc_amt: 0.5, cyc_mode: 0, rise_shape: 0, fall_shape: 0,
		attack: 0.02, decay: 0.6, sustain: 0.7, famt: 0.62, amp_mod: true,
		lfo_rate: 0.45, lfo_shape: 0, lfo_sync: false,
		glide: 0, volume: 0.75, para: true, oct: 0, bend_range: 2, strip: "bend",
		arp_on: false, seq_on: false, arp_mode: 0, arp_oct: 1, rate: (120 - 30) / 210, sync: true, swing: 0, spice: 0.5, hold: false, rec: false,
		pattern: 0, seq: [[48], [], [55], [60], [], [58], [55], [53]], seq_len: 8, seq_b: [[48], [60], [48], [63]], seq_b_len: 4,
		matrix: mx, assign: ["shape", "res", "lfo_rate"], preset: -1
	};
}

function cleanSeq( sq, num )
{
	return (Array.isArray( sq ) ? sq : []).slice( 0, 64 ).map(function(st){
		return (Array.isArray( st ) ? st : []).map(function(n){ return Math.round( num( n, 0, 127, 60 ) ); }).slice( 0, 4 );
	});
}

function validate( s, raw )
{
	var num = function(v, a, b, d) { v = +v; return isFinite( v ) ? Math.min( b, Math.max( a, v ) ) : d; };
	var d = defaults();
	["wave", "timbre", "shape", "cutoff", "res", "cyc_rise", "cyc_fall", "cyc_hold", "cyc_amt", "attack", "decay", "sustain", "famt", "lfo_rate", "glide", "volume", "rate", "swing", "spice"].forEach(function(k){ s[k] = num( s[k], 0, 1, d[k] ); });
	s.rise_shape = num( s.rise_shape, -1, 1, 0 ); s.fall_shape = num( s.fall_shape, -1, 1, 0 );
	s.type = Math.round( num( s.type, 0, T.ENGINES.length - 1, 0 ) );
	s.ftype = Math.round( num( s.ftype, 0, 2, 0 ) ); s.cyc_mode = Math.round( num( s.cyc_mode, 0, 2, 0 ) );
	s.lfo_shape = Math.round( num( s.lfo_shape, 0, T.LFO_SHAPES.length - 1, 0 ) ); s.arp_mode = Math.round( num( s.arp_mode, 0, T.ARP_MODES.length - 1, 0 ) );
	s.arp_oct = Math.round( num( s.arp_oct, 1, 4, 1 ) ); s.oct = Math.round( num( s.oct, -2, 2, 0 ) ); s.pattern = s.pattern == 1 ? 1 : 0;
	if(BEND_RANGES.indexOf( s.bend_range ) < 0) s.bend_range = 2;
	if(s.strip != "spice") s.strip = "bend";
	var mx = raw && Array.isArray( raw.matrix ) ? raw.matrix : s.matrix;
	s.matrix = emptyMatrix().map(function(row, r){ return row.map(function(z, c){ return num( mx && mx[r] && mx[r][c], -1, 1, 0 ); }); });
	var keys = T.ASSIGNABLE.map(function(a){ return a[0]; }), as = raw && Array.isArray( raw.assign ) ? raw.assign : s.assign;
	s.assign = [0, 1, 2].map(function(i){ return as && keys.indexOf( as[i] ) >= 0 ? as[i] : d.assign[i]; });
	s.seq = cleanSeq( raw && Array.isArray( raw.seq ) ? raw.seq : s.seq, num );
	s.seq_len = Math.round( num( s.seq_len, 0, s.seq.length, s.seq.length ) );
	s.seq_b = cleanSeq( raw && Array.isArray( raw.seq_b ) ? raw.seq_b : s.seq_b, num );
	s.seq_b_len = Math.round( num( s.seq_b_len, 0, s.seq_b.length, s.seq_b.length ) );
	s.preset = Math.round( num( s.preset, -1, 999, -1 ) );
	s.rec = false; // never saved recording
}

function randomize( s )
{
	var rnd = Math.random;
	s.type = Math.floor( rnd() * T.ENGINES.length ); s.wave = rnd(); s.timbre = rnd(); s.shape = rnd() * 0.8;
	s.cutoff = 0.45 + rnd() * 0.5; s.res = rnd() * 0.7; s.ftype = rnd() < 0.75 ? 0 : Math.floor( rnd() * 3 );
	s.cyc_rise = rnd() * 0.7; s.cyc_fall = rnd() * 0.8; s.cyc_hold = rnd(); s.cyc_amt = rnd(); s.cyc_mode = Math.floor( rnd() * 3 );
	s.attack = rnd() < 0.6 ? rnd() * 0.2 : rnd() * 0.7; s.decay = 0.3 + rnd() * 0.6; s.sustain = rnd(); s.famt = 0.4 + rnd() * 0.5;
	s.lfo_rate = rnd() * 0.8; s.lfo_shape = Math.floor( rnd() * T.LFO_SHAPES.length );
	s.matrix = emptyMatrix();
	for(var k = 0; k < 4; ++k) s.matrix[ Math.floor( rnd() * 5 ) ][ Math.floor( rnd() * 7 ) ] = Math.round( (rnd() * 2 - 1) * 60 ) / 100;
}

function send( msg ) { var m = M; act(function(){ m.post( msg ); }); }
function uiOf() { return uis[ M.id ] || (uis[ M.id ] = { note: -1, press: 0, sel: [2, 3], disp: null, shift: false, loaded: null, strip: 0.5 }); }
function clamp( v, a, b ) { return v < a ? a : (v > b ? b : v); }
function noteName( n ) { return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][ ((n % 12) + 12) % 12 ] + (Math.floor( n / 12 ) - 1); }
function pct( v ) { return (v > 0 ? "+" : "") + Math.round( v * 100 ) + "%"; }
function copy( o ) { return JSON.parse( JSON.stringify( o ) ); }
function say( label, text ) { uiOf().disp = { label: label, text: text, t: performance.now() }; }

// ---------------------------------------------------------------------------
// the sounds: the factory ones (the MINIMAD patches) and the ones saved with SAVE

function userSounds() { try { return JSON.parse( localStorage.getItem( USER_KEY ) || "[]" ) || []; } catch(err) { return []; } }
function soundList()
{
	var list = [];
	(window.factory_patches || []).forEach(function(p){
		var m = p.group == "MINIMAD" && p.settings && (p.settings.modules || []).find(function(o){ return o.type == "minimad"; });
		if(m) list.push({ name: p.name.toUpperCase(), settings: m.settings || {} });
	});
	return list.concat( userSounds() );
}
// a sound onto this MINIMAD: its knobs, its matrix, its sequences (not its MIDI settings)
function applySound( raw, index )
{
	var ms = WR.mergeValid( defaults(), raw );
	validate( ms, raw );
	Object.keys( ms ).forEach(function(k){ if(k != "midi_master" && k != "midi_channel" && k != "knob_skin") S[k] = ms[k]; });
	S.preset = index;
	uiOf().loaded = copy( S );
	send({ type: "allNotesOff" });
}
function keepSound()
{
	var keep = copy( S );
	delete keep.midi_master; delete keep.midi_channel; delete keep.preset; delete keep.rec;
	var list = userSounds(), name = "USER " + (list.length + 1);
	list.push({ name: name, settings: keep });
	try { localStorage.setItem( USER_KEY, JSON.stringify( list ) ); } catch(err) { setStatus( "MINIMAD: this browser would not keep the sound" ); return; }
	S.preset = soundList().length - 1;
	uiOf().loaded = copy( S );
	say( "SAVED", name );
	setStatus( "MINIMAD: saved as " + name + " (PRESET lists it after the factory sounds)" );
}

// ---------------------------------------------------------------------------
// drawing helpers

function Tx( text, x, y, size, color, align, bold )
{
	ctx.font = (bold === false ? "" : "bold ") + (size || 10) + "px " + FONT;
	ctx.fillStyle = color || PRINT; ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
	ctx.fillText( text, x, y );
}
// a label with its SHIFT function in blue: "RISE / SHAPE"
function label2( main, alt, x, y, size )
{
	size = size || 10;
	ctx.font = "bold " + size + "px " + FONT;
	var a = main + (alt ? " / " : ""), wa = ctx.measureText( a ).width, wb = alt ? ctx.measureText( alt ).width : 0, x0 = x - (wa + wb) / 2;
	Tx( a, x0, y, size, PRINT, "left" );
	if(alt) Tx( alt, x0 + wa, y, size, BLUE, "left" );
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

// what the OLED shows while a control is touched
function shows( id, label, text )
{
	var full = id_prefix + id;
	if(ui.active === full || ui.hot === full) say( label, text );
}

// the three kinds of knobs: black (a white line), orange (the oscillator's), white encoders (a ring)
function knobFace( kind, cx, cy, r, n, hover )
{
	var a = KNOB_A0 + n * KNOB_SWEEP;
	ctx.fillStyle = PANEL; ctx.beginPath(); ctx.arc( cx, cy, r + 4, 0, Math.PI * 2 ); ctx.fill(); // over the rack's own knob
	ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.arc( cx + 1.5, cy + 3, r, 0, Math.PI * 2 ); ctx.fill();
	ctx.lineCap = "round";
	if(kind == "orange")
	{
		var g = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r );
		g.addColorStop( 0, hover ? "#ffa66a" : "#f79250" ); g.addColorStop( 1, "#c9541c" );
		ctx.fillStyle = g; ctx.beginPath();
		for(var i = 0; i < 16; ++i) { var b = i / 16 * Math.PI * 2, rr = i % 2 ? r : r * 0.93; ctx.lineTo( cx + Math.cos( b ) * rr, cy + Math.sin( b ) * rr ); }
		ctx.closePath(); ctx.fill();
		ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.beginPath(); ctx.arc( cx, cy, r * 0.72, 0, Math.PI * 2 ); ctx.fill();
		ctx.strokeStyle = "#7a2e0c"; ctx.lineWidth = 2.5;
		ctx.beginPath(); ctx.moveTo( cx + Math.cos( a ) * r * 0.35, cy + Math.sin( a ) * r * 0.35 ); ctx.lineTo( cx + Math.cos( a ) * r * 0.82, cy + Math.sin( a ) * r * 0.82 ); ctx.stroke();
	}
	else if(kind == "white")
	{
		ctx.strokeStyle = "#5c5d62"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc( cx, cy, r + 5, 0, Math.PI * 2 ); ctx.stroke();
		var g2 = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r );
		g2.addColorStop( 0, hover ? "#ffffff" : "#f4f4f2" ); g2.addColorStop( 1, "#b9b9b6" );
		ctx.fillStyle = g2; ctx.beginPath(); ctx.arc( cx, cy, r, 0, Math.PI * 2 ); ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 1;
		for(var k = 0; k < 24; ++k) { var c = k / 24 * Math.PI * 2; ctx.beginPath(); ctx.moveTo( cx + Math.cos( c ) * r * 0.86, cy + Math.sin( c ) * r * 0.86 ); ctx.lineTo( cx + Math.cos( c ) * r, cy + Math.sin( c ) * r ); ctx.stroke(); }
		ctx.strokeStyle = "#333"; ctx.lineWidth = 2.5;
		ctx.beginPath(); ctx.moveTo( cx + Math.cos( a ) * r * 0.45, cy + Math.sin( a ) * r * 0.45 ); ctx.lineTo( cx + Math.cos( a ) * r * 0.85, cy + Math.sin( a ) * r * 0.85 ); ctx.stroke();
		// the printed arrow of an endless encoder
		ctx.strokeStyle = PRINT; ctx.lineWidth = 1.2;
		ctx.beginPath(); ctx.arc( cx, cy, r + 10, Math.PI * 0.15, Math.PI * 0.42 ); ctx.stroke();
		var ex = cx + Math.cos( Math.PI * 0.15 ) * (r + 10), ey = cy + Math.sin( Math.PI * 0.15 ) * (r + 10);
		ctx.fillStyle = PRINT; ctx.beginPath(); ctx.moveTo( ex + 3, ey - 4 ); ctx.lineTo( ex - 4, ey - 2 ); ctx.lineTo( ex + 1, ey + 3 ); ctx.fill();
	}
	else
	{
		ctx.strokeStyle = "rgba(236,234,228,0.7)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc( cx, cy, r + 5, 0, Math.PI * 2 ); ctx.stroke();
		var g3 = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r );
		g3.addColorStop( 0, hover ? "#4a4b50" : "#3a3b40" ); g3.addColorStop( 1, "#0e0e10" );
		ctx.fillStyle = g3; ctx.beginPath(); ctx.arc( cx, cy, r, 0, Math.PI * 2 ); ctx.fill();
		ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
		ctx.beginPath(); ctx.moveTo( cx + Math.cos( a ) * r * 0.3, cy + Math.sin( a ) * r * 0.3 ); ctx.lineTo( cx + Math.cos( a ) * r * 0.92, cy + Math.sin( a ) * r * 0.92 ); ctx.stroke();
	}
	ctx.lineCap = "butt";
}

// a knob: its face, its label under it (the SHIFT function in blue); the OLED shows it while touched
function mk( id, cx, cy, r, value, min, max, kind, lab, alt, fmt, o )
{
	o = o || {};
	var v = knob( id, cx, cy, r, value, min, max, { def: o.def, step: o.step, bipolar: o.bipolar, noScale: true, format: function(x){ return (o.name || lab) + " " + fmt( x ); } } );
	var full = id_prefix + id;
	knobFace( kind, cx, cy, r, clamp( (v - min) / (max - min), 0, 1 ), ui.hot === full || ui.active === full );
	if(lab) label2( lab, alt, cx, cy + r + (kind == "white" ? 22 : 18), 11 );
	shows( id, o.name || lab, fmt( v ) );
	return v;
}

// a round rubber button; lit: its ring
function rbtn( id, cx, cy, r, lit, tooltip, ring )
{
	var h = hot( id, cx - r - 3, cy - r - 3, 2 * r + 6, 2 * r + 6 );
	if(lit) { ctx.fillStyle = ring || "#ffffff"; ctx.beginPath(); ctx.arc( cx, cy, r + 4, 0, Math.PI * 2 ); ctx.fill(); }
	ctx.fillStyle = "#151517"; ctx.beginPath(); ctx.arc( cx, cy, r + 1.5, 0, Math.PI * 2 ); ctx.fill();
	var g = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r );
	g.addColorStop( 0, h.held ? "#8e8f94" : (h.hover ? "#b4b5ba" : "#a2a3a8") ); g.addColorStop( 1, "#5e5f64" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy + (h.held ? 1 : 0), r, 0, Math.PI * 2 ); ctx.fill();
	if(h.hover && tooltip) tip( tooltip, cx, cy + r + 30 );
	return h;
}
function led( x, y, on, color )
{
	ctx.fillStyle = on ? (color || BLUE) : "#46474c"; ctx.beginPath(); ctx.arc( x, y, 3.2, 0, Math.PI * 2 ); ctx.fill();
	if(on) { ctx.fillStyle = "rgba(85,182,255,0.35)"; ctx.beginPath(); ctx.arc( x, y, 7, 0, Math.PI * 2 ); ctx.fill(); }
}
// a section's name over a line
function head( text, x1, x2, y )
{
	Tx( text, (x1 + x2) / 2, y, 13 );
	ctx.fillStyle = PRINT; ctx.fillRect( x1, y + 10, x2 - x1, 1.5 );
}
// a CV socket on the top strip
function mj( id, cx, cy, type, label )
{
	var full = id_prefix + id;
	jacks[full] = { x: rackX( cx ), y: rackY( cy ), type: type, label: label };
	var hover = hitCircle( cx, cy, 12 );
	if(cable_drag && cable_drag.from != full && jackCompatible( cable_drag, jacks[full] ))
	{
		ctx.strokeStyle = hover ? "#fff" : "rgba(255,255,255,0.3)"; ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc( cx, cy, 13, 0, Math.PI * 2 ); ctx.stroke();
	}
	var g = ctx.createRadialGradient( cx - 3, cy - 3, 1, cx, cy, 10 );
	g.addColorStop( 0, "#e6e6e2" ); g.addColorStop( 1, "#77776f" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy, 9.5, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = hover && !cable_drag ? "#333" : "#080808";
	ctx.beginPath(); ctx.arc( cx, cy, 5, 0, Math.PI * 2 ); ctx.fill();
	Tx( label, cx + 16, cy, 9, PRINT, "left" );
	if(hover && !cable_drag) tip( label + (type == "out" ? " (OUT)" : " (IN)"), cx, cy + 22 );
}

// ---------------------------------------------------------------------------
// the display bay's OLED: the sound's name, the type and what WAVE / TIMBRE / SHAPE do, or the control touched

function drawOled( x, y, w, h )
{
	var u = uiOf(), e = T.ENGINES[ S.type ], C = "#e9f6ff";
	ctx.fillStyle = "#020304"; ctx.fillRect( x, y, w, h );
	ctx.save(); ctx.beginPath(); ctx.rect( x, y, w, h ); ctx.clip();
	var list = soundList(), name = S.preset >= 0 && list[ S.preset ] ? list[ S.preset ].name : "MINIMAD";
	Tx( name, x + 5, y + 9, 9, C, "left" );
	Tx( (S.para ? "PARA" : "MONO") + (S.oct ? " " + (S.oct > 0 ? "+" : "") + S.oct : ""), x + w - 5, y + 9, 9, C, "right" );
	ctx.fillStyle = "#3a5566"; ctx.fillRect( x + 4, y + 17, w - 8, 1 );
	var d = u.disp && performance.now() - u.disp.t < 1200 ? u.disp : null;
	if(d) { Tx( d.label, x + w / 2, y + 34, 10, C ); Tx( d.text, x + w / 2, y + 56, 15, "#ffffff" ); }
	else
	{
		Tx( e[0], x + w / 2, y + 34, 13, "#ffffff" );
		[[e[1], S.wave], [e[2], S.timbre], [e[3], S.shape]].forEach(function(p, i){
			var cx = x + 5 + i * (w - 10) / 3, cw = (w - 10) / 3 - 5;
			Tx( p[0].length > 9 ? p[0].substr( 0, 9 ) : p[0], cx + cw / 2, y + 52, 7, C );
			ctx.fillStyle = "#1c3440"; ctx.fillRect( cx, y + 60, cw, 4 );
			ctx.fillStyle = C; ctx.fillRect( cx, y + 60, cw * p[1], 4 );
		});
	}
	var st = S.seq_on ? "SEQ " + (S.pattern ? "B" : "A") + (S.rec ? " REC" : "") + (ST.playing ? " ▶ " + (ST.step + 1) : "") : (S.arp_on ? "ARP " + T.ARP_MODES[ S.arp_mode ] + " x" + S.arp_oct : "");
	Tx( st, x + 5, y + h - 9, 8, C, "left" );
	Tx( (S.sync ? (ST.tempo || 120) : Math.round( MAP.bpm( S.rate ) )) + " BPM", x + w - 5, y + h - 9, 8, C, "right" );
	if(S.seq_on && S.rec && !ST.playing) Tx( "STEP " + (curLen() + 1) + (ST.chord && ST.chord.length ? " " + ST.chord.map( noteName ).join( " " ) : ""), x + w / 2, y + h - 22, 9, "#ffb27a" );
	ctx.restore();
}

// the active sequence (A or B)
function curLen() { return S.pattern ? S.seq_b_len : S.seq_len; }
function seqKeys() { return S.pattern ? ["seq_b", "seq_b_len"] : ["seq", "seq_len"]; }

// ---------------------------------------------------------------------------
// the matrix: 5 sources by 7 destinations, the column names on slanted lines

function drawMatrix()
{
	var u = uiOf(), mx = S.matrix;
	var rows = [118, 132, 145, 159, 172].map( Y ), cols = [200, 229, 258, 288, 317, 346, 375].map( X );
	var names = ["CYCENV", "ENV", "LFO", "PRESS", "KEY / ARP"];
	for(var r0 = 0; r0 < 5; ++r0) Tx( names[ r0 ], X( 184 ), rows[ r0 ], 9, PRINT, "right" );
	var top = Y( 108 ), ey = Y( 74 );
	for(var c = 0; c < 7; ++c)
	{
		// the column's line: down the grid, then slanted up to its name
		var cx = cols[c], ex = cx + 34;
		ctx.strokeStyle = PRINT; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo( cx, rows[4] + 6 ); ctx.lineTo( cx, top ); ctx.lineTo( ex, ey ); ctx.stroke();
		var name = colName( c );
		ctx.save(); ctx.translate( cx + 8, top - 6 ); ctx.rotate( -Math.atan2( top - ey, ex - cx ) );
		if(c >= 4)
		{
			ctx.font = "bold 9px " + FONT; var tw = ctx.measureText( name ).width + 8;
			ctx.fillStyle = PRINT; ctx.fillRect( 0, -14, tw, 13 );
			Tx( name, 4, -7, 9, "#111", "left" );
		}
		else Tx( name, 2, -7, 9, PRINT, "left" );
		ctx.restore();
	}
	// the grid's row lines
	ctx.strokeStyle = "rgba(236,234,228,0.5)";
	for(var r1 = 0; r1 < 5; ++r1) { ctx.beginPath(); ctx.moveTo( X( 188 ), rows[ r1 ] ); ctx.lineTo( cols[6] + 6, rows[ r1 ] ); ctx.stroke(); }
	// the points: blue up, orange down
	for(var r = 0; r < 5; ++r)
		for(var c0 = 0; c0 < 7; ++c0)
		{
			var px = cols[ c0 ], ry = rows[ r ], amt = mx[ r ][ c0 ], sel = u.sel[0] == r && u.sel[1] == c0;
			var id = "mx" + r + "_" + c0, full = id_prefix + id;
			var hv = !cable_drag && (ui.active === null || ui.active === full) && hitRect( px - 18, ry - 8, 36, 16 );
			if(hv) ui.hot = full;
			if(hv && ui.pressed && ui.active === null) { ui.active = full; u.sel = [r, c0]; u.dragY = ui.y; u.dragV = amt; if(ui.dbl) { mx[ r ][ c0 ] = 0; u.dragV = 0; } }
			if(ui.active === full && ui.down) mx[ r ][ c0 ] = amt = clamp( Math.round( (u.dragV + (u.dragY - ui.y) / 120) * 100 ) / 100, -1, 1 );
			led( px, ry, amt != 0, amt < 0 ? "#ff7a3a" : BLUE );
			if(sel) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc( px, ry, 7.5, 0, Math.PI * 2 ); ctx.stroke(); }
			if(hv) tip( T.SOURCES[ r ] + " → " + colName( c0 ) + ": " + pct( amt ) + " (DRAG UP / DOWN, DOUBLE-CLICK: 0)", px, ry + 24 );
			if(hv || ui.active === full) say( T.SOURCES[ r ] + " > " + colName( c0 ), pct( amt ) );
		}
	// ASSIGN 1-3: their buttons send the column to the next knob
	for(var a = 0; a < 3; ++a)
	{
		var h = rbtn( "assign" + a, cols[ 4 + a ] + 40, Y( 60 ), 8, false, "ASSIGN " + (a + 1) + ": " + colName( 4 + a ) + " (CLICK: THE NEXT KNOB)" );
		if(h.clicked)
		{
			var keys = T.ASSIGNABLE.map(function(q){ return q[0]; });
			S.assign[a] = keys[ (keys.indexOf( S.assign[a] ) + 1) % keys.length ];
			say( "ASSIGN " + (a + 1), colName( 4 + a ) );
		}
	}
	// the encoder: the selected point's amount
	var sr0 = u.sel[0], sc0 = u.sel[1];
	var v = mk( "mx_amt", X( 484 ), Y( 125 ), 26, mx[ sr0 ][ sc0 ], -1, 1, "white", "MATRIX", null, pct, { def: 0, bipolar: true, name: T.SOURCES[ sr0 ] + " > " + colName( sc0 ) } );
	if(v !== mx[ sr0 ][ sc0 ]) mx[ sr0 ][ sc0 ] = Math.round( v * 100 ) / 100;
}
function colName( c ) { return c < 4 ? T.DESTS[c] : (T.ASSIGNABLE.find(function(a){ return a[0] == S.assign[ c - 4 ]; }) || ["", "?"])[1]; }

// ---------------------------------------------------------------------------
// the keyboard board: white, copper pads (drawn once, kept in an image)

var boardCache = null;
function pads( c, x, y, w, h, color )
{
	// a chain of small squares in columns: the copper of a pad
	var cell = 11, cols = Math.max( 1, Math.floor( w / cell ) ), ox = x + (w - cols * cell) / 2;
	c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1.3;
	for(var yy = y; yy + cell <= y + h; yy += cell)
		for(var i = 0; i < cols; ++i)
		{
			var px = ox + i * cell;
			c.strokeRect( px + 1.5, yy + 1.5, cell - 3, cell - 3 );
			c.fillRect( px + 4.5, yy + 4.5, cell - 9, cell - 9 );
		}
}
function boardImage( w, h, keys )
{
	var k = 2;
	if(boardCache && boardCache.w == w && boardCache.h == h) return boardCache.cv;
	var cv = document.createElement( "canvas" ); cv.width = w * k; cv.height = h * k;
	var c = cv.getContext( "2d" ); c.scale( k, k );
	c.fillStyle = PCB; c.fillRect( 0, 0, w, h );
	keys.forEach(function(q){
		if(q[5]) return;
		var x = q[1] - keys.x0, y = q[2] - keys.y0;
		// a white key: its copper in the middle, a slot between it and the next
		pads( c, x + q[3] * 0.3, y + 6, q[3] * 0.4, q[4] - 12, COPPER );
		c.fillStyle = "#1d1d1f"; c.beginPath(); c.roundRect( x + q[3] - 2, y + (q.fullSlot ? 10 : keys.bh + 18), 4, q[4] - (q.fullSlot ? 20 : keys.bh + 28), 2 ); c.fill();
	});
	keys.forEach(function(q){
		if(!q[5]) return;
		var x = q[1] - keys.x0, y = q[2] - keys.y0;
		c.fillStyle = PCB; c.fillRect( x - 6, y, q[3] + 12, q[4] + 8 );
		c.fillStyle = "#2c2c2f"; c.beginPath(); c.roundRect( x, y, q[3], q[4], 3 ); c.fill();
		pads( c, x + 4, y + 6, q[3] - 8, q[4] - 12, COPPER );
	});
	// the name, in copper, over the last key
	var last = keys.filter(function(q){ return !q[5]; }).pop(), lx = last[1] - keys.x0 + last[3] / 2;
	c.fillStyle = PCB; c.fillRect( last[1] - keys.x0 + 6, 0, last[3] - 8, 92 );
	c.textAlign = "center"; c.fillStyle = COPPER; c.font = "22px " + FONT; c.fillText( "MINI", lx, 26 );
	c.font = "bold 22px " + FONT; c.fillText( "MAD", lx, 48 );
	c.font = "8px " + FONT; c.fillText( "DIGITAL", lx, 64 ); c.fillText( "SYNTHESIZER", lx, 75 );
	boardCache = { w: w, h: h, cv: cv };
	return cv;
}

// the decorated band between the panel and the keyboard: curls and leaves in white lines, and the name
var bandCache = null;
function bandImage( w, h )
{
	if(bandCache && bandCache.w == w) return bandCache.cv;
	var k = 2, cv = document.createElement( "canvas" ); cv.width = w * k; cv.height = h * k;
	var c = cv.getContext( "2d" ); c.scale( k, k );
	c.fillStyle = "#1b1b1d"; c.fillRect( 0, 0, w, h );
	var seed = 7, rnd = function(){ seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
	c.strokeStyle = "rgba(236,234,228,0.55)"; c.lineWidth = 1.1;
	for(var i = 0; i < 90; ++i)
	{
		var x = rnd() * w, y = rnd() * h, s = 8 + rnd() * 22, t = rnd();
		c.beginPath();
		if(t < 0.4) { for(var a = 0; a < 14; ++a) { var r = s * (1 - a / 16), b = a * 0.7; c.lineTo( x + Math.cos( b ) * r * 0.6, y + Math.sin( b ) * r * 0.45 ); } }  // a curl
		else if(t < 0.75) { c.moveTo( x - s, y ); c.quadraticCurveTo( x, y - s * 0.7, x + s, y ); c.quadraticCurveTo( x, y + s * 0.5, x - s, y ); }       // a leaf
		else { c.arc( x, y, s * 0.18, 0, Math.PI * 2 ); c.moveTo( x + s * 0.4, y ); c.arc( x, y, s * 0.4, 0, Math.PI * 2 ); }                            // a seed
		c.stroke();
	}
	c.fillStyle = "#1b1b1d"; c.fillRect( w / 2 - 110, 6, 220, h - 12 );
	c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#f2f0ea"; c.font = "bold 30px " + FONT;
	if(c.letterSpacing !== undefined) c.letterSpacing = "6px";
	c.fillText( "MINIMAD", w / 2, h / 2 + 1 );
	bandCache = { w: w, cv: cv };
	return cv;
}

// the 25 keys: [note, x, y, w, h, black]
function keyList( x, y, w, h )
{
	var base = 48 + S.oct * 12, nw = 15, kw = w / nw, bh = h * 0.5, keys = [];
	for(var i = 0; i < nw; ++i)
	{
		var q = [ base + Math.floor( i / 7 ) * 12 + WHITE[ i % 7 ], x + i * kw, y, kw, h, false ];
		q.fullSlot = [2, 6].indexOf( i % 7 ) >= 0; // after E and B: no black key, the slot goes the whole way
		keys.push( q );
	}
	for(var o = 0; o < 2; ++o)
		for(var b in BLACK_AT) { var wi = o * 7 + BLACK_AT[b]; keys.push([ base + o * 12 + (+b), x + (wi + 1) * kw - kw * 0.3, y, kw * 0.6, bh, true ]); }
	keys.x0 = x; keys.y0 = y; keys.bh = bh;
	return keys;
}

function drawKeyboard( x, y, w, h )
{
	var u = uiOf(), keys = keyList( x, y, w, h );
	ctx.drawImage( boardImage( w, h, keys ), x, y, w, h );
	// the keys being played light up
	var on = {};
	(ST.voices || []).forEach(function(v){ if(v && v[2]) on[ v[0] ] = true; });
	keys.forEach(function(k){
		if(!(on[ k[0] ] || u.note == k[0])) return;
		ctx.fillStyle = "rgba(255,140,40,0.35)";
		if(k[5]) ctx.fillRect( k[1], k[2], k[3], k[4] );
		else ctx.fillRect( k[1] + k[3] * 0.25, k[2] + 4, k[3] * 0.5, k[4] - 8 );
	});
	// touching it
	var full = id_prefix + "kbd", inside = !cable_drag && hitRect( x, y, w, h );
	var at = function(){
		var bk = keys.filter(function(k){ return k[5]; }).concat( keys.filter(function(k){ return !k[5]; }) );
		for(var i = 0; i < bk.length; ++i) { var k = bk[i]; if(ui.x >= k[1] && ui.x < k[1] + k[3] && ui.y >= k[2] && ui.y < k[2] + k[4]) return k; }
		return null;
	};
	if(inside && (ui.active === null || ui.active === full)) ui.hot = full;
	if(inside && ui.pressed && ui.active === null) ui.active = full;
	if(ui.active === full && ui.down)
	{
		var k = at(), press = k ? clamp( 0.25 + 0.75 * (ui.y - k[2]) / k[4], 0, 1 ) : u.press;
		if(k && k[0] != u.note)
		{
			if(u.note >= 0) send({ type: "note", note: u.note, on: false });
			u.note = k[0]; u.press = press;
			send({ type: "note", note: k[0], on: true, vel: press, press: press });
		}
		else if(k && Math.abs( press - u.press ) > 0.02) { u.press = press; send({ type: "press", note: u.note, value: press }); }
		if(u.note >= 0) say( "PRESSURE " + noteName( u.note ), Math.round( u.press * 100 ) + "%" );
	}
	else if(u.note >= 0) { send({ type: "note", note: u.note, on: false }); u.note = -1; }
	if(inside && !ui.down) tip( "PLAY: TOUCH LOWER ON A KEY FOR MORE PRESSURE; MOVE ON IT TO CHANGE IT", x + w / 2, y - 10 );
}

// the touch row: a pad, outlined in copper, with its glyph and its name
function tpad( id, cx, cy, label, alt, lit, glyph, tooltip )
{
	var w = 58, h = 48, x = cx - w / 2, y = cy - h / 2;
	var r = hot( id, x, y, w, h );
	ctx.strokeStyle = COPPER; ctx.lineWidth = 1.6;
	ctx.fillStyle = lit ? "rgba(232,116,42,0.22)" : (r.hover ? "rgba(232,116,42,0.08)" : "rgba(0,0,0,0)");
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 4 ); ctx.fill(); ctx.stroke();
	glyph( cx, cy - 7 );
	label2c( label, alt, cx, cy + 15 );
	if(lit) { ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc( cx, y + 6, 2.5, 0, Math.PI * 2 ); ctx.fill(); }
	if(r.hover && tooltip) tip( tooltip, cx, y + h + 14 );
	return r;
}
function label2c( main, alt, x, y )
{
	ctx.font = "bold 9px " + FONT;
	var a = main + (alt ? " | " : ""), wa = ctx.measureText( a ).width, wb = alt ? ctx.measureText( alt ).width : 0, x0 = x - (wa + wb) / 2;
	Tx( a, x0, y, 9, COPPER, "left" );
	if(alt) Tx( alt, x0 + wa, y, 9, "#2a7fc8", "left" );
}
function glyphLine( pts ) { return function(cx, cy){ ctx.strokeStyle = COPPER; ctx.lineWidth = 1.6; ctx.beginPath(); pts.forEach(function(p, i){ ctx[ i ? "lineTo" : "moveTo" ]( cx + p[0], cy + p[1] ); }); ctx.stroke(); }; }

function drawTouchRow( cy )
{
	var u = uiOf(), editing = S.seq_on && S.rec && !ST.playing;
	var keysGlyph = function(gx, gy){ ctx.strokeStyle = COPPER; ctx.lineWidth = 1.4; ctx.strokeRect( gx - 10, gy - 7, 20, 13 ); for(var i = -6; i <= 6; i += 4) { ctx.beginPath(); ctx.moveTo( gx + i, gy - 7 ); ctx.lineTo( gx + i, gy + 6 ); ctx.stroke(); } };
	if(tpad( "hold", X( 196 ), cy, editing ? "REST" : "HOLD", editing ? null : "REST", S.hold && !editing, keysGlyph, editing ? "REST: AN EMPTY STEP" : "HOLD: THE NOTES KEEP PLAYING AFTER THE KEYS ARE LET GO (RECORDING: A REST)" ).clicked)
	{
		if(editing) { var k = seqKeys(); if(S[ k[1] ] < 64) { S[ k[0] ] = S[ k[0] ].slice( 0, S[ k[1] ] ); S[ k[0] ].push( [] ); S[ k[1] ]++; } }
		else S.hold = !S.hold;
	}
	var modes = [["up", 265, "UP", "A", glyphLine([[-10, 6], [-4, 6], [-4, 0], [2, 0], [2, -6], [8, -6]])],
		["order", 323, "ORDER", "B", function(gx, gy){ ctx.strokeStyle = COPPER; ctx.lineWidth = 1.4; ctx.strokeRect( gx - 10, gy - 7, 20, 13 ); ctx.beginPath(); ctx.moveTo( gx - 3, gy - 7 ); ctx.lineTo( gx - 3, gy + 6 ); ctx.moveTo( gx + 4, gy - 7 ); ctx.lineTo( gx + 4, gy + 6 ); ctx.stroke(); }],
		["random", 380, "RANDOM", "●", glyphLine([[-10, 4], [-6, 4], [-6, -6], [-1, -6], [-1, 6], [4, 6], [4, -2], [9, -2]])],
		["pattern", 437, "PATTERN", "▶", function(gx, gy){ ctx.fillStyle = COPPER; [[-8, 2], [-3, -4], [2, 2], [6, -6], [8, 4]].forEach(function(p){ ctx.fillRect( gx + p[0] - 1.5, gy + p[1] - 1.5, 3, 3 ); }); }]];
	modes.forEach(function(m, i){
		var lit = u.shift ? [S.seq_on && S.pattern == 0, S.seq_on && S.pattern == 1, S.rec, !!ST.playing][i] : S.arp_on && S.arp_mode == i;
		var tipT = u.shift ? ["SEQUENCE A", "SEQUENCE B", "RECORD (STOPPED: A NEW SEQUENCE)", "PLAY / STOP THE SEQUENCE"][i] : "ARP " + T.ARP_MODES[i] + " (SHIFT: " + ["SEQUENCE A", "SEQUENCE B", "RECORD", "PLAY"][i] + ")";
		if(tpad( m[0], X( m[1] ), cy, m[2], m[3], lit, m[4], tipT ).clicked)
		{
			if(!u.shift) { S.arp_mode = i; S.arp_on = true; S.seq_on = false; return; }
			u.shift = false;
			if(i < 2) { S.pattern = i; S.seq_on = true; S.arp_on = false; }
			else if(i == 2) { S.rec = !S.rec; if(S.rec) { S.seq_on = true; S.arp_on = false; if(!ST.playing) { var k2 = seqKeys(); S[ k2[0] ] = []; S[ k2[1] ] = 0; } } }
			else { S.seq_on = true; S.arp_on = false; send({ type: "play" }); }
		}
	});
	ctx.fillStyle = COPPER; ctx.fillRect( X( 472 ), cy - 22, 1.5, 44 );
	var spice = function(gx, gy){ ctx.strokeStyle = COPPER; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo( gx - 9, gy + 7 ); ctx.quadraticCurveTo( gx - 2, gy + 2, gx + 6, gy - 6 ); ctx.quadraticCurveTo( gx + 9, gy - 9, gx + 9, gy - 4 ); ctx.quadraticCurveTo( gx + 3, gy + 7, gx - 9, gy + 7 ); ctx.stroke(); };
	var dice = function(gx, gy){ ctx.strokeStyle = COPPER; ctx.lineWidth = 1.4; ctx.strokeRect( gx - 7, gy - 7, 14, 14 ); ctx.fillStyle = COPPER; [[-3, -3], [3, 3], [0, 0]].forEach(function(p){ ctx.fillRect( gx + p[0] - 1.2, gy + p[1] - 1.2, 2.4, 2.4 ); }); };
	if(tpad( "spice", X( 508 ), cy, "SPICE", null, S.strip == "spice", spice, "SPICE: THE TOUCH STRIP SETS HOW MANY STEPS TAKE THE DICE (" + Math.round( S.spice * 100 ) + "%)" ).clicked) S.strip = "spice";
	if(tpad( "dice", X( 562 ), cy, "DICE", null, false, dice, "DICE: NEW RANDOM OCTAVES, GATES AND RESTS FOR THE STEPS" ).clicked) { send({ type: "dice" }); say( "DICE", "ROLLED" ); }
	if(tpad( "bend", X( 620 ), cy, "BEND", null, S.strip == "bend", glyphLine([[-10, 4], [-4, 4], [0, -4], [4, 4], [10, 4]]), "BEND: THE TOUCH STRIP BENDS THE PITCH (±" + S.bend_range + " SEMITONES, BACK TO THE MIDDLE WHEN LET GO)" ).clicked) S.strip = "bend";
	// the arrow to the strip, the strip, its slot
	ctx.strokeStyle = COPPER; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo( X( 643 ), cy ); ctx.lineTo( X( 690 ), cy ); ctx.stroke();
	ctx.fillStyle = COPPER; ctx.beginPath(); ctx.moveTo( X( 694 ), cy ); ctx.lineTo( X( 688 ), cy - 5 ); ctx.lineTo( X( 688 ), cy + 5 ); ctx.fill();
	drawStrip( X( 698 ), cy - 24, X( 1115 ) - X( 698 ), 48 );
	ctx.fillStyle = "#1d1d1f"; ctx.beginPath(); ctx.roundRect( X( 1124 ), cy - 24, 5, 48, 2 ); ctx.fill();
}

// the touch strip: BEND (springs back to the middle) or SPICE (stays)
function drawStrip( x, y, w, h )
{
	var u = uiOf(), full = id_prefix + "strip";
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x, y, w, h );
	if(hover) ui.hot = full;
	if(hover && ui.pressed && ui.active === null) ui.active = full;
	var pos = S.strip == "spice" ? S.spice : u.strip;
	if(ui.active === full && ui.down)
	{
		pos = clamp( (ui.x - x) / w, 0, 1 );
		if(S.strip == "spice") { S.spice = Math.round( pos * 100 ) / 100; say( "SPICE", Math.round( S.spice * 100 ) + "%" ); }
		else if(Math.abs( pos - u.strip ) > 0.003) { u.strip = pos; send({ type: "bend", value: (pos * 2 - 1) * S.bend_range / 12 }); say( "BEND", ((pos * 2 - 1) * S.bend_range).toFixed( 1 ) + " ST" ); }
	}
	else if(S.strip == "bend" && u.strip != 0.5) { u.strip = 0.5; send({ type: "bend", value: 0 }); }
	ctx.strokeStyle = COPPER; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.roundRect( x, y, w, h, 4 ); ctx.stroke();
	// the zigzags of its copper
	ctx.lineWidth = 1.2;
	for(var z = 0; z < 2; ++z)
	{
		ctx.beginPath();
		for(var i = 0; i <= 14; ++i) ctx.lineTo( x + 8 + i * (w - 16) / 14, (i + z) % 2 ? y + 8 : y + h - 8 );
		ctx.stroke();
	}
	ctx.fillStyle = "rgba(85,182,255,0.8)"; ctx.fillRect( x + pos * w - 2, y + 3, 4, h - 6 );
	if(hover) tip( S.strip == "spice" ? "SPICE " + Math.round( S.spice * 100 ) + "% (SLIDE)" : "BEND (SLIDE; BACK TO THE MIDDLE WHEN LET GO)", x + w / 2, y + h + 12 );
}

// ---------------------------------------------------------------------------

function draw( mod )
{
	M = mod; S = mod.settings;
	ST = M.state = M.state || { voices: [], cyc: 0, lfo: 0, env: 0, playing: false, step: -1, clk: false, tempo: 0 };
	var w = SIZE[0], h = SIZE[1], u = uiOf();
	if(!u.loaded) u.loaded = copy( S );
	var keep = [ TEXT_COLOR, DIM_COLOR, knob_scale_color ];
	TEXT_COLOR = PRINT; DIM_COLOR = DIM; knob_scale_color = PRINT;
	drawCasing( 0, 0, w, h );
	// the top edge: the CV sockets (on the original's back)
	ctx.fillStyle = "#18181a"; ctx.fillRect( 22, 0, w - 44, TOP );
	var J = JACKS[0];
	for(var j = 0; j < 5; ++j) mj( J[j][2], 70 + j * 130, TOP / 2, J[j][1], J[j][0] );
	led( 70 + 130 + 92, TOP / 2, !!ST.clk );
	Tx( "STEREO OUT ON THE BACK (TAB)", w - 60, TOP / 2, 9, DIM, "right", false );
	// the panel
	ctx.fillStyle = PANEL; ctx.fillRect( 22, TOP, w - 44, Y( 425 ) - TOP );

	var e = T.ENGINES[ S.type ];
	// row 1: the matrix, PARAPHONIC, PANEL, the display bay, MASTER
	drawMatrix();
	if(rbtn( "para", X( 575 ), Y( 127 ), 19, S.para, "PARAPHONIC: FOUR VOICES THROUGH ONE FILTER (OFF: ONE VOICE, LEGATO)" ).clicked) S.para = !S.para;
	ctx.strokeStyle = PRINT; ctx.lineWidth = 1; ctx.strokeRect( X( 546 ), Y( 152 ), X( 614 ) - X( 546 ), 18 );
	Tx( "PARAPHONIC", X( 580 ), Y( 152 ) + 9, 10 );
	if(rbtn( "panel", X( 667 ), Y( 128 ), 16, false, "PANEL: BACK TO THE SOUND AS IT WAS CHOSEN (PRESET) OR LOADED" ).clicked && u.loaded)
	{
		var snap = copy( u.loaded );
		Object.keys( snap ).forEach(function(k){ if(k != "midi_master" && k != "midi_channel") S[k] = snap[k]; });
		say( "PANEL", "AS CHOSEN" );
	}
	Tx( "PANEL", X( 667 ), Y( 160 ), 11 );
	// the display bay
	ctx.fillStyle = "#0d0d0f"; ctx.beginPath(); ctx.roundRect( X( 712 ), Y( 80 ), X( 1052 ) - X( 712 ), Y( 182 ) - Y( 80 ), 6 ); ctx.fill();
	ctx.strokeStyle = "#3c3d42"; ctx.lineWidth = 1.5; ctx.stroke();
	drawOled( X( 722 ), Y( 92 ), X( 822 ) - X( 722 ), Y( 166 ) - Y( 92 ) );
	var list = soundList();
	var pi = mk( "preset", X( 872 ), Y( 123 ), 24, Math.max( 0, S.preset ), 0, Math.max( 1, list.length - 1 ), "white", "PRESET", null, function(v){ return list[v] ? list[v].name : "-"; }, { step: 1, def: 0 } );
	if(pi !== Math.max( 0, S.preset ) && list[ pi ]) applySound( list[ pi ].settings, pi );
	if(rbtn( "save", X( 948 ), Y( 129 ), 16, false, "SAVE: KEEP THIS SOUND IN THE BROWSER (THEN PRESET HAS IT)" ).clicked) keepSound();
	Tx( "SAVE", X( 948 ), Y( 160 ), 11 );
	if(rbtn( "utility", X( 1015 ), Y( 129 ), 16, false, "UTILITY: THE TOUCH STRIP'S BEND RANGE (±2, ±7, ±12)" ).clicked)
	{
		S.bend_range = BEND_RANGES[ (BEND_RANGES.indexOf( S.bend_range ) + 1) % BEND_RANGES.length ];
		say( "BEND RANGE", "±" + S.bend_range + " ST" );
	}
	Tx( "UTILITY", X( 1015 ), Y( 160 ), 11 );
	ctx.font = "italic 11px Georgia, serif"; ctx.fillStyle = PRINT; ctx.textAlign = "center"; ctx.fillText( "))  un peu fou  ((", X( 975 ), Y( 98 ) );
	S.volume = mk( "volume", X( 1103 ), Y( 123 ), 28, S.volume, 0, 1, "black", "MASTER", null, fmtPct, { def: 0.75 } );

	// row 2: GLIDE, DIGITAL OSCILLATOR, ANALOG FILTER, CYCLING ENVELOPE
	head( "DIGITAL OSCILLATOR", X( 255 ), X( 555 ), Y( 192 ) );
	head( "ANALOG FILTER", X( 563 ), X( 780 ), Y( 192 ) );
	head( "CYCLING ENVELOPE", X( 785 ), X( 1150 ), Y( 192 ) );
	var ry = Y( 243 );
	S.glide = mk( "glide", X( 188 ), ry, 28, S.glide, 0, 1, "black", "GLIDE", null, function(v){ var t = MAP.glide( v ); return t < 0.005 ? "OFF" : (t < 1 ? Math.round( t * 1000 ) + " MS" : t.toFixed( 2 ) + " S"); }, { def: 0 } );
	var sub = function(i, v){ return e[i] + (S.type == 2 && i == 1 ? " " + T.WT_NAMES[ Math.min( 3, (v * 4) | 0 ) ] : (S.type == 9 && i == 1 ? " " + T.CHORDS[ Math.min( T.CHORDS.length - 1, (v * T.CHORDS.length) | 0 ) ][0] : "")); };
	S.type = mk( "type", X( 290 ), ry, 26, S.type, 0, T.ENGINES.length - 1, "orange", "TYPE", null, function(v){ return T.ENGINES[ v ][0]; }, { step: 1, def: 0 } );
	S.wave = mk( "wave", X( 365 ), ry, 26, S.wave, 0, 1, "orange", "WAVE", null, fmtPct, { def: 0.35, name: sub( 1, S.wave ) } );
	S.timbre = mk( "timbre", X( 438 ), ry, 26, S.timbre, 0, 1, "orange", "TIMBRE", null, fmtPct, { def: 0.5, name: e[2] } );
	S.shape = mk( "shape", X( 510 ), ry, 26, S.shape, 0, 1, "orange", "SHAPE", null, fmtPct, { def: 0.2, name: e[3] } );
	if(rbtn( "ftype", X( 578 ), ry + 2, 15, false, "FILTER TYPE: LPF, BPF, HPF (" + T.FTYPES[ S.ftype ] + ")" ).clicked) S.ftype = (S.ftype + 1) % 3;
	Tx( "TYPE", X( 578 ), ry + 46, 11 );
	T.FTYPES.forEach(function(n, i){ led( X( 610 ), ry - 18 + i * 18, S.ftype == i ); Tx( n, X( 618 ), ry - 18 + i * 18, 9, PRINT, "left" ); });
	S.cutoff = mk( "cutoff", X( 667 ), ry - 3, 30, S.cutoff, 0, 1, "black", "CUTOFF", null, function(v){ var f = MAP.cutoff( v ); return f < 1000 ? Math.round( f ) + " HZ" : (f / 1000).toFixed( 1 ) + " KHZ"; }, { def: 0.72 } );
	S.res = mk( "res", X( 741 ), ry - 3, 30, S.res, 0, 1, "black", "RESONANCE", null, fmtPct, { def: 0.25 } );
	if(rbtn( "cyc_mode", X( 806 ), ry + 2, 15, false, "MODE: ENV (ON EACH NOTE, HOLD IS THE LEVEL KEPT), RUN (ONCE, HOLD IS A TIME), LOOP (AGAIN AND AGAIN)" ).clicked) S.cyc_mode = (S.cyc_mode + 1) % 3;
	Tx( "MODE", X( 806 ), ry + 46, 11 );
	T.CYC_MODES.forEach(function(n, i){ led( X( 836 ), ry - 18 + i * 18, S.cyc_mode == i ); Tx( n, X( 844 ), ry - 18 + i * 18, 9, PRINT, "left" ); });
	var cyT = function(v){ var t = MAP.cycTime( v ); return t < 1 ? Math.round( t * 1000 ) + " MS" : t.toFixed( 2 ) + " S"; };
	var crv = function(v){ return v == 0 ? "STRAIGHT" : (v < 0 ? "FAST START " : "SLOW START ") + Math.round( Math.abs( v ) * 100 ) + "%"; };
	if(u.shift)
	{
		S.rise_shape = mk( "rise_shape", X( 893 ), ry - 3, 30, S.rise_shape, -1, 1, "black", "RISE", "SHAPE", crv, { def: 0, bipolar: true, name: "RISE SHAPE" } );
		S.fall_shape = mk( "fall_shape", X( 966 ), ry - 3, 30, S.fall_shape, -1, 1, "black", "FALL", "SHAPE", crv, { def: 0, bipolar: true, name: "FALL SHAPE" } );
	}
	else
	{
		S.cyc_rise = mk( "cyc_rise", X( 893 ), ry - 3, 30, S.cyc_rise, 0, 1, "black", "RISE", "SHAPE", cyT, { def: 0.3, name: "RISE" } );
		S.cyc_fall = mk( "cyc_fall", X( 966 ), ry - 3, 30, S.cyc_fall, 0, 1, "black", "FALL", "SHAPE", cyT, { def: 0.45, name: "FALL" } );
	}
	S.cyc_hold = mk( "cyc_hold", X( 1040 ), ry - 3, 30, S.cyc_hold, 0, 1, "black", "HOLD / SUSTAIN", null, function(v){ return S.cyc_mode == 0 ? "LEVEL " + Math.round( v * 100 ) + "%" : (v * v * 4).toFixed( 2 ) + " S AT THE TOP"; }, { def: 0.5 } );
	S.cyc_amt = mk( "cyc_amt", X( 1115 ), ry - 3, 30, S.cyc_amt, 0, 1, "black", "AMOUNT", null, fmtPct, { def: 0.5 } );

	// row 3: OCTAVE, SHIFT, ARP / SEQ, LFO, ENVELOPE
	var y3 = Y( 360 );
	ctx.fillStyle = "#121214"; ctx.fillRect( X( 135 ), Y( 318 ), X( 262 ) - X( 135 ), Y( 408 ) - Y( 318 ) );
	Tx( "OCTAVE", X( 198 ), Y( 307 ), 13 );
	ctx.strokeStyle = PRINT; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect( X( 150 ), y3 - 24, X( 253 ) - X( 150 ), 48, 24 ); ctx.stroke();
	if(rbtn( "oct_down", X( 175 ), y3, 17, false, "THE KEYBOARD AN OCTAVE DOWN (" + S.oct + ")" ).clicked && S.oct > -2) { S.oct--; say( "OCTAVE", String( S.oct ) ); }
	if(rbtn( "oct_up", X( 228 ), y3, 17, false, "THE KEYBOARD AN OCTAVE UP (" + S.oct + ")" ).clicked && S.oct < 2) { S.oct++; say( "OCTAVE", (S.oct > 0 ? "+" : "") + S.oct ); }
	Tx( "←", X( 175 ), y3 + 36, 14 ); Tx( "→", X( 228 ), y3 + 36, 14 );
	if(rbtn( "shift", X( 292 ), y3, 17, u.shift, "SHIFT: THE SECOND FUNCTION (IN BLUE) OF THE NEXT CONTROL", BLUE ).clicked) u.shift = !u.shift;
	Tx( "SHIFT", X( 292 ), y3 + 38, 11 );
	head( "ARP / SEQ", X( 345 ), X( 555 ), Y( 307 ) );
	if(rbtn( "arp", X( 368 ), y3, 16, u.shift ? S.seq_on : S.arp_on, u.shift ? "SEQ: THE SEQUENCER (THE KEYS TRANSPOSE IT)" : "ARP: THE NOTES HELD, ONE AT A TIME (SHIFT: SEQ)" ).clicked)
	{
		if(u.shift) { S.seq_on = !S.seq_on; if(S.seq_on) S.arp_on = false; else S.rec = false; u.shift = false; }
		else { S.arp_on = !S.arp_on; if(S.arp_on) S.seq_on = false; }
	}
	label2( "ARP", "SEQ", X( 368 ), y3 + 38, 11 );
	if(rbtn( "arp_oct", X( 421 ), y3, 16, false, "OCT: THE ARPEGGIO OVER 1 TO 4 OCTAVES (" + S.arp_oct + ")" ).clicked) { S.arp_oct = S.arp_oct % 4 + 1; say( "ARP OCTAVES", String( S.arp_oct ) ); }
	label2( "OCT", "MOD", X( 421 ), y3 + 38, 11 );
	for(var o = 1; o <= 4; ++o) { var oy = Y( 338 ) + (o - 1) * 16.5 * KY; led( X( 452 ), oy, S.arp_oct == o ); Tx( String( o ), X( 460 ), oy, 9, PRINT, "left" ); }
	if(u.shift)
		S.swing = mk( "swing", X( 512 ), y3 - 2, 26, S.swing, 0, 1, "white", "RATE", "SWING", function(v){ return Math.round( 50 + v * 25 ) + "%"; }, { def: 0, name: "SWING" } );
	else
		S.rate = mk( "rate", X( 512 ), y3 - 2, 26, S.rate, 0, 1, "white", "RATE", "SWING", function(v){ return S.sync ? "SYNC " + (ST.tempo || 120) + " BPM" : Math.round( MAP.bpm( v ) ) + " BPM"; }, { def: (120 - 30) / 210, name: "RATE" } );
	var sh = hot( "sync", X( 535 ), Y( 320 ), 44, 30 );
	if(sh.clicked) S.sync = !S.sync;
	led( X( 548 ), Y( 340 ), S.sync ); Tx( "SYNC", X( 545 ), Y( 327 ), 9 );
	if(sh.hover) tip( "SYNC: THE RACK'S TEMPO (" + (S.sync ? "ON" : "OFF") + ")", X( 545 ), Y( 300 ) );
	head( "LFO", X( 563 ), X( 790 ), Y( 307 ) );
	if(rbtn( "lfo_shape", X( 596 ), y3, 16, false, "SHAPE: SINE, TRIANGLE, SAW, SQUARE, RANDOM, SMOOTH RANDOM (" + T.LFO_SHAPES[ S.lfo_shape ] + ")" ).clicked) S.lfo_shape = (S.lfo_shape + 1) % T.LFO_SHAPES.length;
	Tx( "SHAPE", X( 596 ), y3 + 38, 11 );
	var icon = [ function(x, y){ ctx.beginPath(); for(var i = 0; i <= 12; ++i) ctx.lineTo( x - 7 + i * 14 / 12, y - Math.sin( i / 12 * Math.PI * 2 ) * 5 ); ctx.stroke(); },
		function(x, y){ ctx.beginPath(); ctx.moveTo( x - 7, y + 5 ); ctx.lineTo( x, y - 5 ); ctx.lineTo( x + 7, y + 5 ); ctx.stroke(); },
		function(x, y){ ctx.beginPath(); ctx.moveTo( x - 7, y + 5 ); ctx.lineTo( x + 7, y - 5 ); ctx.lineTo( x + 7, y + 5 ); ctx.stroke(); },
		function(x, y){ ctx.beginPath(); ctx.moveTo( x - 7, y + 5 ); ctx.lineTo( x - 7, y - 5 ); ctx.lineTo( x, y - 5 ); ctx.lineTo( x, y + 5 ); ctx.lineTo( x + 7, y + 5 ); ctx.lineTo( x + 7, y - 5 ); ctx.stroke(); },
		function(x, y){ ctx.beginPath(); ctx.moveTo( x - 7, y + 2 ); ctx.lineTo( x - 3, y + 2 ); ctx.lineTo( x - 3, y - 5 ); ctx.lineTo( x + 1, y - 5 ); ctx.lineTo( x + 1, y + 5 ); ctx.lineTo( x + 5, y + 5 ); ctx.lineTo( x + 5, y - 1 ); ctx.lineTo( x + 7, y - 1 ); ctx.stroke(); },
		function(x, y){ ctx.beginPath(); ctx.moveTo( x - 7, y + 2 ); ctx.bezierCurveTo( x - 4, y + 2, x - 4, y - 5, x - 1, y - 5 ); ctx.bezierCurveTo( x + 2, y - 5, x + 1, y + 5, x + 4, y + 5 ); ctx.lineTo( x + 7, y ); ctx.stroke(); } ];
	for(var q = 0; q < 6; ++q)
	{
		var lx = X( q < 3 ? 627 : 668 ), ly = Y( 345 ) + (q % 3) * 20;
		led( lx, ly, S.lfo_shape == q );
		ctx.strokeStyle = PRINT; ctx.lineWidth = 1.3; icon[q]( lx + 20, ly );
	}
	S.lfo_rate = mk( "lfo_rate", X( 742 ), y3 - 2, 26, S.lfo_rate, 0, 1, "white", "RATE", null, function(v){ if(S.lfo_sync) return T.LFO_DIVS[ MAP.lfoDiv( v ) ][0]; var hz = MAP.lfoHz( v ); return (hz < 10 ? hz.toFixed( 2 ) : Math.round( hz )) + " HZ"; }, { def: 0.45, name: "LFO RATE" } );
	var lh = hot( "lfo_sync", X( 765 ), Y( 320 ), 44, 30 );
	if(lh.clicked) S.lfo_sync = !S.lfo_sync;
	led( X( 778 ), Y( 340 ), S.lfo_sync ); Tx( "SYNC", X( 775 ), Y( 327 ), 9 );
	if(lh.hover) tip( "SYNC: THE LFO IN NOTES OF THE TEMPO (" + (S.lfo_sync ? "ON" : "OFF") + ")", X( 775 ), Y( 300 ) );
	head( "ENVELOPE", X( 795 ), X( 1150 ), Y( 307 ) );
	if(rbtn( "amp_mod", X( 822 ), y3 + 2, 16, S.amp_mod !== false, "AMP MOD: THE ENVELOPE ON THE VCA (OFF: THE VCA IS A GATE, THE ENVELOPE ONLY ON THE FILTER)" ).clicked) S.amp_mod = S.amp_mod === false;
	Tx( "AMP MOD", X( 822 ), y3 + 40, 11 );
	var enT = function(v){ var t = MAP.envTime( v ); return t < 1 ? Math.round( t * 1000 ) + " MS" : t.toFixed( 2 ) + " S"; };
	S.attack = mk( "attack", X( 893 ), y3, 30, S.attack, 0, 1, "black", "ATTACK", null, enT, { def: 0.02 } );
	S.decay = mk( "decay", X( 966 ), y3, 30, S.decay, 0, 1, "black", "DECAY / REL", null, enT, { def: 0.6 } );
	S.sustain = mk( "sustain", X( 1040 ), y3, 30, S.sustain, 0, 1, "black", "SUSTAIN", null, fmtPct, { def: 0.7 } );
	S.famt = mk( "famt", X( 1115 ), y3, 30, S.famt, 0, 1, "black", "FILTER AMT", null, function(v){ return pct( v * 2 - 1 ); }, { def: 0.5, bipolar: true } );

	// the band, the keyboard board
	var by = Y( 425 ), bh = Y( 465 ) - by;
	ctx.drawImage( bandImage( w - 44, bh ), 22, by, w - 44, bh );
	ctx.fillStyle = PCB; ctx.fillRect( 22, by + bh, w - 44, h - by - bh );
	drawTouchRow( Y( 492 ) );
	drawKeyboard( X( 140 ), Y( 527 ), X( 1135 ) - X( 140 ), Y( 806 ) - Y( 527 ) );

	TEXT_COLOR = keep[0]; DIM_COLOR = keep[1]; knob_scale_color = keep[2];
	M = null; S = null; ST = null;
}

// the sequencer's recording (from the keys or MIDI while REC): into the active sequence
function onState( m, state )
{
	if(!state.rec || !state.rec.length) return;
	var s = m.settings, k = s.pattern ? ["seq_b", "seq_b_len"] : ["seq", "seq_len"];
	state.rec.forEach(function(r){
		if(r.add && s[ k[1] ] < 64) { s[ k[0] ] = s[ k[0] ].slice( 0, s[ k[1] ] ); s[ k[0] ].push( r.add.slice( 0, 4 ) ); s[ k[1] ]++; }
		else if(r.note !== undefined && s[ k[1] ] > 0)
		{
			var st = s[ k[0] ][ r.step % s[ k[1] ] ];
			if(st && st.indexOf( r.note ) < 0 && st.length < 4) st.push( r.note );
		}
	});
}

WR.registerSynth( "minimad", {
	title: "MINIMAD",
	description: "MINIMAD: digital paraphonic synthesizer with a touch keyboard, a mod matrix, an arpeggiator and a sequencer",
	about: "A small hybrid: 14 digital oscillator types (wavetable, FM, Karplus, modal, chords, formant...) into a 12 dB filter, a cycling envelope, a 5 x 7 modulation matrix, four voices paraphonic, an arpeggiator and a 64-step sequencer with SPICE / DICE, a flat keyboard that reads pressure and a touch strip.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^(hold|up|order|random|pattern|dice|shift|arp)$", 3], ["^(para|ftype|cyc_mode|lfo_shape|arp_oct|amp_mod|oct_down|oct_up|spice|bend)$", 2], ["^(sync|lfo_sync|panel|save|utility)$", 1], ["", 0]],
	knob_jacks: [["^rate$", ["clock_in"]]],
	category: "Synths",
	knob_skin: "soft",
	worklet: "devices/minimad-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	audio_out: "out_l",
	audio_out_r: "out_r",
	midi_in: "midi_in",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	onState: onState,
	size: function() { return SIZE; },
	draw: draw,
	rear_note: function( s ) { return T.ENGINES[ s.type ][0] + " · " + (s.para ? "PARA" : "MONO") + (s.arp_on ? " · ARP" : "") + (s.seq_on ? " · SEQ " + (s.pattern ? "B" : "A") : ""); },
	transport: function( mod, action, value ) {
		if(action == "play") { if(mod.settings.seq_on) mod.post({ type: "play", value: value }); } // Space plays the sequence when SEQ is on
		else if(action == "trigger") mod.post({ type: "trigger", gate: value });
	},
	tempo: function( s ) { return s.sync ? 0 : MAP.bpm( s.rate ); } // with SYNC it follows the rack
});

})();
