// devices/minimad.js
// MINIMAD module: a small digital / analog hybrid synthesizer with a flat touch keyboard. Its panel is
// laid out like the instrument it is after: white, black print, orange marks. OSCILLATOR (TYPE, WAVE,
// TIMBRE, SHAPE, with an OLED that names what they do for the type), FILTER (CUTOFF, RESONANCE, LPF /
// BPF / HPF), the modulation MATRIX (5 sources by 7 destinations, three of them ASSIGNable; click a
// point, drag it up or down or turn AMOUNT), ARP / SEQ (RATE, SWING, SPICE / DICE, ARP, SEQ, MODE,
// HOLD, REC, PLAY), CYCLING ENVELOPE (RISE, FALL, HOLD, AMOUNT, ENV / RUN / LOOP), ENVELOPE (ATTACK,
// DECAY / REL, SUSTAIN, FILTER AMT), LFO (RATE, six shapes, SYNC), GLIDE, PARA, VOLUME. The keyboard
// plays the synth itself: how low on a key it is touched is the pressure, and moving on the key changes
// it. CV sockets: CLOCK in and out, PITCH, GATE, PRESSURE out. DSP in minimad-worklet.js.

(function(){

var SIZE = [1568, 560];
var DECK_Y = 372;
var T = WR_DSP.minimad.TABLES, MAP = T.MAP;
var PANEL = "#e8e5dd", INK = "#1b1b1a", DIM = "#6f6c65", ORANGE = "#ee5a24", OLED = "#8fe3ff";
var JACKS = [[["CLOCK IN", "in", "clock_in"], ["CLOCK OUT", "out", "clock_out"], ["PITCH", "out", "pitch_out"], ["GATE", "out", "gate_out"], ["PRESSURE", "out", "press_out"]]];
var REAR_JACKS = [["OUT L", "aout", "out_l"], ["OUT R", "aout", "out_r"]];
var WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK_AT = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // a black key: after which white key of the octave
var M = null, S = null, ST = null;
var uis = {};      // module id -> { note, press, sel: [row, col], disp: { label, text, t } }

function emptyMatrix() { return [0, 1, 2, 3, 4].map(function(){ return [0, 0, 0, 0, 0, 0, 0]; }); }

function defaults()
{
	var mx = emptyMatrix();
	mx[3][2] = 0.3;  // PRESSURE -> TIMBRE: press harder, brighter
	return {
		type: 0, wave: 0.35, timbre: 0.5, shape: 0.2,
		cutoff: 0.72, res: 0.25, ftype: 0,
		cyc_rise: 0.3, cyc_fall: 0.45, cyc_hold: 0.5, cyc_amt: 0.5, cyc_mode: 0,
		attack: 0.02, decay: 0.6, sustain: 0.7, famt: 0.62,
		lfo_rate: 0.45, lfo_shape: 0, lfo_sync: false,
		glide: 0, volume: 0.75, para: true, oct: 0,
		arp_on: false, seq_on: false, arp_mode: 0, rate: (120 - 30) / 210, sync: true, swing: 0, spice: 0.5, hold: false, rec: false,
		seq: [[48], [], [55], [60], [], [58], [55], [53]], seq_len: 8,
		matrix: mx, assign: ["shape", "res", "lfo_rate"]
	};
}

function validate( s, raw )
{
	var num = function(v, a, b, d) { v = +v; return isFinite( v ) ? Math.min( b, Math.max( a, v ) ) : d; };
	var d = defaults();
	["wave", "timbre", "shape", "cutoff", "res", "cyc_rise", "cyc_fall", "cyc_hold", "cyc_amt", "attack", "decay", "sustain", "famt", "lfo_rate", "glide", "volume", "rate", "swing", "spice"].forEach(function(k){ s[k] = num( s[k], 0, 1, d[k] ); });
	s.type = Math.round( num( s.type, 0, T.ENGINES.length - 1, 0 ) );
	s.ftype = Math.round( num( s.ftype, 0, 2, 0 ) ); s.cyc_mode = Math.round( num( s.cyc_mode, 0, 2, 0 ) );
	s.lfo_shape = Math.round( num( s.lfo_shape, 0, T.LFO_SHAPES.length - 1, 0 ) ); s.arp_mode = Math.round( num( s.arp_mode, 0, T.ARP_MODES.length - 1, 0 ) );
	s.oct = Math.round( num( s.oct, -2, 2, 0 ) );
	var mx = raw && Array.isArray( raw.matrix ) ? raw.matrix : s.matrix;
	s.matrix = emptyMatrix().map(function(row, r){ return row.map(function(z, c){ return num( mx && mx[r] && mx[r][c], -1, 1, 0 ); }); });
	var keys = T.ASSIGNABLE.map(function(a){ return a[0]; }), as = raw && Array.isArray( raw.assign ) ? raw.assign : s.assign;
	s.assign = [0, 1, 2].map(function(i){ return as && keys.indexOf( as[i] ) >= 0 ? as[i] : d.assign[i]; });
	var sq = raw && Array.isArray( raw.seq ) ? raw.seq : s.seq;
	s.seq = (Array.isArray( sq ) ? sq : []).slice( 0, 64 ).map(function(st){
		return (Array.isArray( st ) ? st : []).map(function(n){ return Math.round( num( n, 0, 127, 60 ) ); }).slice( 0, 4 );
	});
	s.seq_len = Math.round( num( s.seq_len, 0, s.seq.length, s.seq.length ) );
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
function uiOf() { return uis[ M.id ] || (uis[ M.id ] = { note: -1, press: 0, sel: [2, 3], disp: null }); }
function clamp( v, a, b ) { return v < a ? a : (v > b ? b : v); }
function noteName( n ) { return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][ ((n % 12) + 12) % 12 ] + (Math.floor( n / 12 ) - 1); }

// ---------------------------------------------------------------------------
// drawing helpers

function Tx( text, x, y, size, color, align, bold )
{
	ctx.font = (bold === false ? "" : "bold ") + (size || 10) + "px " + FONT;
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

// what the OLED shows while a control is touched
function shows( id, label, text )
{
	var full = id_prefix + id;
	if(ui.active === full || ui.hot === full) uiOf().disp = { label: label, text: text, t: performance.now() };
}

// a knob, its name above, what it does for this type under it; the OLED shows it while touched
function mk( id, cx, cy, r, value, min, max, label, fmt, o )
{
	o = o || {};
	Tx( label, cx, cy - r - 20, o.labelSize || 10 );
	if(o.sub) Tx( o.sub, cx, cy + r + 18, 8, ORANGE );
	var v = knob( id, cx, cy, r, value, min, max, { def: o.def, step: o.step, bipolar: o.bipolar, ticks: o.ticks, format: function(x){ return label + " " + fmt( x ); } } );
	shows( id, o.sub || label, fmt( v ) );
	return v;
}

// a flat button with its LED
function mbtn( id, x, y, w, h, label, lit, tooltip )
{
	var r = hot( id, x, y, w, h );
	ctx.fillStyle = "#2a2a28"; ctx.beginPath(); ctx.roundRect( x, y, w, h, 4 ); ctx.fill();
	ctx.fillStyle = r.held ? "#4a4a46" : (r.hover ? "#3c3c39" : "#333331");
	ctx.beginPath(); ctx.roundRect( x + 1, y + 1, w - 2, h - 2, 3 ); ctx.fill();
	Tx( label, x + w / 2, y + h / 2 + 1, 9, "#f0ede6" );
	led( x + w - 7, y + 6, lit );
	if(r.hover && tooltip) tip( tooltip, x + w / 2, y + h + 14 );
	return r;
}
function led( x, y, on, color )
{
	ctx.fillStyle = on ? (color || ORANGE) : "#9c978c"; ctx.beginPath(); ctx.arc( x, y, 2.6, 0, Math.PI * 2 ); ctx.fill();
	if(on) { ctx.fillStyle = "rgba(255,110,40,0.3)"; ctx.beginPath(); ctx.arc( x, y, 5.5, 0, Math.PI * 2 ); ctx.fill(); }
}
// a section: its name in orange over a line
function head( text, x1, x2, y )
{
	Tx( text, x1, y, 11, ORANGE, "left" );
	ctx.font = "bold 11px " + FONT;
	var tw = ctx.measureText( text ).width;
	ctx.fillStyle = ORANGE; ctx.fillRect( x1 + tw + 8, y - 0.5, x2 - x1 - tw - 8, 1.5 );
}
// a CV socket on the panel
function mj( id, cx, cy, type, label )
{
	var full = id_prefix + id;
	jacks[full] = { x: rackX( cx ), y: rackY( cy ), type: type, label: label };
	var hover = hitCircle( cx, cy, 12 );
	if(cable_drag && cable_drag.from != full && jackCompatible( cable_drag, jacks[full] ))
	{
		ctx.strokeStyle = hover ? INK : "rgba(0,0,0,0.3)"; ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc( cx, cy, 13, 0, Math.PI * 2 ); ctx.stroke();
	}
	var g = ctx.createRadialGradient( cx - 3, cy - 3, 1, cx, cy, 11 );
	g.addColorStop( 0, "#f2f2ee" ); g.addColorStop( 1, "#8a8a82" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy, 10, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = hover && !cable_drag ? "#333" : "#080808";
	ctx.beginPath(); ctx.arc( cx, cy, 5.5, 0, Math.PI * 2 ); ctx.fill();
	Tx( label, cx, cy - 20, 8, "#e8e5dd" );
	if(hover && !cable_drag) tip( label + (type == "out" ? " (OUT)" : " (IN)"), cx, cy + 22 );
}

// ---------------------------------------------------------------------------
// the OLED: the type and what WAVE / TIMBRE / SHAPE do, or the control being touched

function drawOled( x, y, w, h )
{
	var u = uiOf(), e = T.ENGINES[ S.type ];
	ctx.fillStyle = "#050607"; ctx.beginPath(); ctx.roundRect( x - 4, y - 4, w + 8, h + 8, 5 ); ctx.fill();
	ctx.fillStyle = "#0a0d10"; ctx.fillRect( x, y, w, h );
	var top = (S.para ? "PARA" : "MONO") + (S.arp_on ? " · ARP " + T.ARP_MODES[ S.arp_mode ] : "") + (S.seq_on ? " · SEQ" + (ST.playing ? " ▶" : "") : "") + (S.rec ? " · REC" : "");
	Tx( top, x + 6, y + 10, 9, OLED, "left" );
	Tx( (S.sync && ST.tempo ? ST.tempo : Math.round( MAP.bpm( S.rate ) )) + " BPM", x + w - 6, y + 10, 9, OLED, "right" );
	var d = u.disp && performance.now() - u.disp.t < 1200 ? u.disp : null;
	if(d)
	{
		Tx( d.label, x + w / 2, y + 36, 12, OLED );
		Tx( d.text, x + w / 2, y + 60, 18, "#ffffff" );
	}
	else
	{
		Tx( e[0], x + w / 2, y + 38, 18, "#ffffff" );
		// WAVE / TIMBRE / SHAPE: what they are for this type, and where they are
		[[e[1], S.wave], [e[2], S.timbre], [e[3], S.shape]].forEach(function(p, i){
			var cx = x + 8 + i * (w - 16) / 3, cw = (w - 16) / 3 - 6;
			Tx( p[0], cx + cw / 2, y + 64, 8, OLED );
			ctx.fillStyle = "#1c3440"; ctx.fillRect( cx, y + 74, cw, 5 );
			ctx.fillStyle = OLED; ctx.fillRect( cx, y + 74, cw * p[1], 5 );
		});
	}
	if(S.seq_on && S.rec && !ST.playing) Tx( "STEP " + (S.seq_len + 1) + (ST.chord && ST.chord.length ? ": " + ST.chord.map( noteName ).join( " " ) : ""), x + w / 2, y + h - 8, 9, "#ff8a5a" );
}

// ---------------------------------------------------------------------------
// the modulation matrix: 5 sources by 7 destinations

function drawMatrix( x, y )
{
	var u = uiOf(), mx = S.matrix, cw = 30, rh = 32, gx = x + 82, gy = y + 66;
	head( "MATRIX", x, x + 296, y + 8 );
	// the destinations: PITCH, WAVE, TIMBRE, CUTOFF, and the three ASSIGN (click: what they move)
	for(var c = 0; c < 7; ++c)
	{
		var cx = gx + c * cw + cw / 2, name = c < 4 ? T.DESTS[c] : (T.ASSIGNABLE.find(function(a){ return a[0] == S.assign[ c - 4 ]; }) || ["", "?"])[1];
		ctx.save(); ctx.translate( cx + 3, gy - 18 ); ctx.rotate( -Math.PI / 2 );
		Tx( name, 0, 0, 8, c < 4 ? INK : ORANGE, "left" );
		ctx.restore();
		if(c >= 4)
		{
			var r = hot( "assign" + (c - 4), cx - cw / 2, y + 16, cw, gy - y - 20 );
			if(r.hover) tip( "ASSIGN " + (c - 3) + ": " + name + " (CLICK: THE NEXT KNOB)", cx, gy - 4 );
			if(r.clicked)
			{
				var keys = T.ASSIGNABLE.map(function(a){ return a[0]; });
				S.assign[ c - 4 ] = keys[ (keys.indexOf( S.assign[ c - 4 ] ) + 1) % keys.length ];
			}
		}
	}
	// the sources, and a point at each crossing: orange up, blue down, as big as the amount
	for(var r0 = 0; r0 < 5; ++r0)
	{
		var ry = gy + r0 * rh + rh / 2;
		Tx( T.SOURCES[ r0 ], gx - 8, ry, 9, INK, "right" );
		for(var c0 = 0; c0 < 7; ++c0)
		{
			var px = gx + c0 * cw + cw / 2, amt = mx[ r0 ][ c0 ], sel = u.sel[0] == r0 && u.sel[1] == c0;
			var id = "mx" + r0 + "_" + c0, full = id_prefix + id;
			var hv = !cable_drag && (ui.active === null || ui.active === full) && hitCircle( px, ry, 12 );
			if(hv) ui.hot = full;
			if(hv && ui.pressed && ui.active === null) { ui.active = full; u.sel = [r0, c0]; u.dragY = ui.y; u.dragV = amt; if(ui.dbl) { mx[ r0 ][ c0 ] = 0; u.dragV = 0; } }
			if(ui.active === full && ui.down) mx[ r0 ][ c0 ] = amt = clamp( Math.round( (u.dragV + (u.dragY - ui.y) / 120) * 100 ) / 100, -1, 1 );
			ctx.fillStyle = "#cfcbc1"; ctx.beginPath(); ctx.arc( px, ry, 9, 0, Math.PI * 2 ); ctx.fill();
			if(amt)
			{
				ctx.fillStyle = amt > 0 ? ORANGE : "#3a7bd5";
				ctx.beginPath(); ctx.arc( px, ry, 2.5 + 6.5 * Math.abs( amt ), 0, Math.PI * 2 ); ctx.fill();
			}
			if(sel) { ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc( px, ry, 11.5, 0, Math.PI * 2 ); ctx.stroke(); }
			if(hv) tip( T.SOURCES[ r0 ] + " → " + colName( c0 ) + ": " + pct( amt ) + " (DRAG UP / DOWN, DOUBLE-CLICK: 0)", px, ry + 22 );
			if(hv || ui.active === full) u.disp = { label: T.SOURCES[ r0 ] + " → " + colName( c0 ), text: pct( amt ), t: performance.now() };
		}
	}
	// AMOUNT: the selected point
	var sr0 = u.sel[0], sc0 = u.sel[1];
	Tx( T.SOURCES[ sr0 ] + " → " + colName( sc0 ), x + 98, y + 252, 9, INK, "left" );
	var v = knob( "mx_amt", x + 270, y + 252 + 12, 20, mx[ sr0 ][ sc0 ], -1, 1, { def: 0, bipolar: true, format: function(z){ return "AMOUNT " + pct( z ); } } );
	if(v !== mx[ sr0 ][ sc0 ]) mx[ sr0 ][ sc0 ] = Math.round( v * 100 ) / 100;
	shows( "mx_amt", T.SOURCES[ sr0 ] + " → " + colName( sc0 ), pct( mx[ sr0 ][ sc0 ] ) );
	Tx( "AMOUNT", x + 270, y + 228, 10 );
	Tx( "CLICK A POINT, DRAG IT, OR TURN AMOUNT", x + 98, y + 272, 8, DIM, "left", false );
}
function colName( c ) { return c < 4 ? T.DESTS[c] : (T.ASSIGNABLE.find(function(a){ return a[0] == S.assign[ c - 4 ]; }) || ["", "?"])[1]; }
function pct( v ) { return (v > 0 ? "+" : "") + Math.round( v * 100 ) + "%"; }

// ---------------------------------------------------------------------------
// the touch keyboard: 25 flat keys; low on a key is more pressure

function drawKeyboard( x, y, w, h )
{
	var u = uiOf(), base = 48 + S.oct * 12, nw = 15, kw = w / nw, bh = h * 0.58;
	ctx.fillStyle = "#0b0b0b"; ctx.beginPath(); ctx.roundRect( x - 6, y - 6, w + 12, h + 12, 6 ); ctx.fill();
	// the keys being played light up
	var on = {};
	(ST.voices || []).forEach(function(v){ if(v && v[2]) on[ v[0] ] = true; });
	var keys = [];   // [note, x, y, w, h, black]
	for(var i = 0; i < nw; ++i)
	{
		var oct = Math.floor( i / 7 ), n = base + oct * 12 + WHITE[ i % 7 ];
		keys.push([ n, x + i * kw, y, kw, h, false ]);
	}
	for(var o = 0; o < 2; ++o)
		for(var b in BLACK_AT)
		{
			var wi = o * 7 + BLACK_AT[b];
			keys.push([ base + o * 12 + (+b), x + (wi + 1) * kw - kw * 0.32, y, kw * 0.64, bh, true ]);
		}
	keys.forEach(function(k){
		var lit = on[ k[0] ] || u.note == k[0];
		if(k[5])
		{
			ctx.fillStyle = lit ? "#ff8a3a" : "#3a352c"; ctx.beginPath(); ctx.roundRect( k[1] + 2, k[2] + 2, k[3] - 4, k[4] - 4, 3 ); ctx.fill();
			ctx.strokeStyle = "#0b0b0b"; ctx.lineWidth = 3; ctx.stroke();
		}
		else
		{
			var g = ctx.createLinearGradient( 0, k[2], 0, k[2] + k[4] );
			g.addColorStop( 0, lit ? "#ffb070" : "#c9b48a" ); g.addColorStop( 1, lit ? "#ff7a30" : "#a8915f" );
			ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect( k[1] + 2, k[2] + 2, k[3] - 4, k[4] - 4, 3 ); ctx.fill();
		}
	});
	// the black keys over the white ones
	keys.filter(function(k){ return k[5]; }).forEach(function(k){
		var lit = on[ k[0] ] || u.note == k[0];
		ctx.fillStyle = "#0b0b0b"; ctx.fillRect( k[1] - 1, k[2], k[3] + 2, k[4] + 2 );
		ctx.fillStyle = lit ? "#ff8a3a" : "#3c362c"; ctx.beginPath(); ctx.roundRect( k[1] + 2, k[2] + 2, k[3] - 4, k[4] - 4, 3 ); ctx.fill();
	});
	// touching it
	var full = id_prefix + "kbd";
	var inside = !cable_drag && hitRect( x, y, w, h );
	var at = function(){
		var bk = keys.filter(function(k){ return k[5]; }).concat( keys.filter(function(k){ return !k[5]; }) );
		for(var i = 0; i < bk.length; ++i) { var k = bk[i]; if(ui.x >= k[1] && ui.x < k[1] + k[3] && ui.y >= k[2] && ui.y < k[2] + k[4]) return k; }
		return null;
	};
	if(inside && (ui.active === null || ui.active === full)) ui.hot = full;
	if(inside && ui.pressed && ui.active === null) ui.active = full;
	if(ui.active === full && ui.down)
	{
		var k = at();
		var press = k ? clamp( 0.25 + 0.75 * (ui.y - k[2]) / k[4], 0, 1 ) : u.press;
		if(k && k[0] != u.note)
		{
			if(u.note >= 0) send({ type: "note", note: u.note, on: false });
			u.note = k[0]; u.press = press;
			send({ type: "note", note: k[0], on: true, vel: press, press: press });
		}
		else if(k && Math.abs( press - u.press ) > 0.02) { u.press = press; send({ type: "press", note: u.note, value: press }); }
		u.disp = { label: "PRESSURE " + noteName( u.note ), text: Math.round( u.press * 100 ) + "%", t: performance.now() };
	}
	else if(u.note >= 0) { send({ type: "note", note: u.note, on: false }); u.note = -1; }
	if(inside && !ui.down) tip( "PLAY: TOUCH LOWER ON A KEY FOR MORE PRESSURE; MOVE ON IT TO CHANGE IT", x + w / 2, y - 12 );
}

// ---------------------------------------------------------------------------

function draw( mod )
{
	M = mod; S = mod.settings;
	ST = M.state = M.state || { voices: [], cyc: 0, lfo: 0, env: 0, playing: false, step: -1, clk: false, tempo: 0 };
	var w = SIZE[0], h = SIZE[1], u = uiOf();
	var keep = [ TEXT_COLOR, DIM_COLOR, knob_scale_color ];
	TEXT_COLOR = INK; DIM_COLOR = DIM; knob_scale_color = INK;
	drawCasing( 0, 0, w, h );
	ctx.fillStyle = PANEL; ctx.fillRect( 22, 0, w - 44, DECK_Y );
	ctx.fillStyle = "#141413"; ctx.fillRect( 22, DECK_Y, w - 44, h - DECK_Y );
	drawScrew( 36, 12 ); drawScrew( w - 36, 12 );

	var e = T.ENGINES[ S.type ];
	// the OLED, VOLUME, GLIDE, PARA
	drawOled( 48, 26, 214, 96 );
	S.volume = mk( "volume", 82, 168, 16, S.volume, 0, 1, "VOLUME", fmtPct, { def: 0.75 } );
	S.glide = mk( "glide", 148, 168, 16, S.glide, 0, 1, "GLIDE", function(v){ var t = MAP.glide( v ); return t < 0.005 ? "OFF" : (t < 1 ? Math.round( t * 1000 ) + " MS" : t.toFixed( 2 ) + " S"); }, { def: 0 } );
	if(mbtn( "para", 196, 156, 62, 24, "PARA", S.para, "PARAPHONIC: FOUR VOICES THROUGH ONE FILTER (OFF: ONE VOICE, LEGATO)" ).clicked) S.para = !S.para;

	// OSCILLATOR
	head( "OSCILLATOR", 290, 690, 22 );
	S.type = mk( "type", 345, 100, 28, S.type, 0, T.ENGINES.length - 1, "TYPE", function(v){ return T.ENGINES[ v ][0]; }, { step: 1, def: 0, ticks: T.ENGINES.length } );
	var sub = function(i, v){ return e[i] + (S.type == 2 && i == 1 ? " " + T.WT_NAMES[ Math.min( 3, (v * 4) | 0 ) ] : (S.type == 9 && i == 1 ? " " + T.CHORDS[ Math.min( T.CHORDS.length - 1, (v * T.CHORDS.length) | 0 ) ][0] : "")); };
	S.wave = mk( "wave", 455, 100, 24, S.wave, 0, 1, "WAVE", fmtPct, { def: 0.35, sub: sub( 1, S.wave ) } );
	S.timbre = mk( "timbre", 555, 100, 24, S.timbre, 0, 1, "TIMBRE", fmtPct, { def: 0.5, sub: e[2] } );
	S.shape = mk( "shape", 650, 100, 24, S.shape, 0, 1, "SHAPE", fmtPct, { def: 0.2, sub: e[3] } );
	Tx( "WAVE · TIMBRE · SHAPE CHANGE WITH THE TYPE", 490, 168, 8, DIM, "left", false );

	// FILTER
	head( "FILTER", 704, 990, 22 );
	S.cutoff = mk( "cutoff", 770, 98, 32, S.cutoff, 0, 1, "CUTOFF", function(v){ var f = MAP.cutoff( v ); return f < 1000 ? Math.round( f ) + " HZ" : (f / 1000).toFixed( 1 ) + " KHZ"; }, { def: 0.72 } );
	S.res = mk( "res", 900, 98, 22, S.res, 0, 1, "RESONANCE", fmtPct, { def: 0.25 } );
	T.FTYPES.forEach(function(n, i){ led( 740 + i * 44, 160, S.ftype == i ); Tx( n, 740 + i * 44, 174, 9 ); });
	if(mbtn( "ftype", 880, 152, 90, 26, "FILTER TYPE", false, "LPF, BPF, HPF: " + T.FTYPES[ S.ftype ] ).clicked) S.ftype = (S.ftype + 1) % 3;

	// MATRIX
	drawMatrix( 1002, 14 );

	// the CV sockets, on a black plate
	ctx.fillStyle = "#1a1a19"; ctx.beginPath(); ctx.roundRect( 1316, 14, 214, 174, 6 ); ctx.fill();
	var J = JACKS[0];
	mj( J[0][2], 1366, 66, J[0][1], J[0][0] ); mj( J[1][2], 1470, 66, J[1][1], J[1][0] );
	for(var k = 2; k < 5; ++k) mj( J[k][2], 1356 + (k - 2) * 66, 142, J[k][1], J[k][0] );
	led( 1500, 40, !!ST.clk );

	// ARP / SEQ
	head( "ARP / SEQ", 40, 400, 204 );
	var bpm = MAP.bpm( S.rate );
	S.rate = mk( "rate", 82, 268, 24, S.rate, 0, 1, "RATE", function(v){ return S.sync ? "SYNC " + (ST.tempo || 120) + " BPM" : Math.round( MAP.bpm( v ) ) + " BPM"; }, { def: (120 - 30) / 210 } );
	if(mbtn( "sync", 52, 316, 60, 22, "SYNC", S.sync, "SYNC: THE RACK'S TEMPO (CLOCK IN, WHEN PATCHED, STEPS IT)" ).clicked) S.sync = !S.sync;
	S.swing = mk( "swing", 150, 262, 16, S.swing, 0, 1, "SWING", function(v){ return Math.round( 50 + v * 25 ) + "%"; }, { def: 0 } );
	S.spice = mk( "spice", 210, 262, 16, S.spice, 0, 1, "SPICE", function(v){ return Math.round( v * 100 ) + "% OF THE STEPS"; }, { def: 0.5 } );
	if(mbtn( "dice", 180, 304, 60, 24, "DICE", false, "DICE: NEW RANDOM OCTAVES, GATES AND RESTS FOR SPICE" ).clicked) send({ type: "dice" });
	var bx = 252, by = 222;
	if(mbtn( "arp", bx, by, 70, 26, "ARP", S.arp_on, "ARPEGGIATOR: THE NOTES HELD, ONE AT A TIME" ).clicked) { S.arp_on = !S.arp_on; if(S.arp_on) S.seq_on = false; }
	if(mbtn( "seq", bx + 76, by, 70, 26, "SEQ", S.seq_on, "SEQUENCER: PLAY STARTS IT; THE KEYS TRANSPOSE IT" ).clicked) { S.seq_on = !S.seq_on; if(S.seq_on) S.arp_on = false; else { S.rec = false; } }
	if(mbtn( "mode", bx, by + 34, 70, 26, T.ARP_MODES[ S.arp_mode ], false, "ARP MODE: UP, ORDER, RAND, PATTERN" ).clicked) S.arp_mode = (S.arp_mode + 1) % T.ARP_MODES.length;
	var editing = S.seq_on && S.rec && !ST.playing;
	if(mbtn( "hold", bx + 76, by + 34, 70, 26, editing ? "REST" : "HOLD", S.hold && !editing, editing ? "REST: AN EMPTY STEP" : "HOLD: THE NOTES KEEP PLAYING AFTER THE KEYS ARE LET GO" ).clicked)
	{
		if(editing) { if(S.seq_len < 64) { S.seq = S.seq.slice( 0, S.seq_len ); S.seq.push( [] ); S.seq_len++; } }
		else S.hold = !S.hold;
	}
	if(mbtn( "rec", bx, by + 68, 70, 26, "REC", S.rec, "REC (SEQ): STOPPED, EACH CHORD PLAYED IS A STEP (A NEW SEQUENCE); PLAYING, THE NOTES GO ONTO THE STEPS" ).clicked)
	{
		S.rec = !S.rec;
		if(S.rec) { S.seq_on = true; S.arp_on = false; if(!ST.playing) { S.seq = []; S.seq_len = 0; } }
	}
	if(mbtn( "play", bx + 76, by + 68, 70, 26, "PLAY", !!ST.playing, "PLAY / STOP THE SEQUENCE" ).clicked) { if(!S.seq_on) { S.seq_on = true; S.arp_on = false; } send({ type: "play" }); }
	Tx( S.seq_on ? "SEQ " + S.seq_len + " STEPS" + (ST.playing && ST.step >= 0 ? " · " + (ST.step + 1) : "") : (S.arp_on ? "ARP " + T.ARP_MODES[ S.arp_mode ] : ""), bx + 73, by + 112, 9, DIM );

	// CYCLING ENVELOPE
	head( "CYCLING ENVELOPE", 412, 700, 204 );
	var cyT = function(v){ var t = MAP.cycTime( v ); return t < 1 ? Math.round( t * 1000 ) + " MS" : t.toFixed( 2 ) + " S"; };
	S.cyc_rise = mk( "cyc_rise", 450, 262, 18, S.cyc_rise, 0, 1, "RISE", cyT, { def: 0.3 } );
	S.cyc_fall = mk( "cyc_fall", 515, 262, 18, S.cyc_fall, 0, 1, "FALL", cyT, { def: 0.45 } );
	S.cyc_hold = mk( "cyc_hold", 580, 262, 18, S.cyc_hold, 0, 1, "HOLD", function(v){ return S.cyc_mode == 0 ? "LEVEL " + Math.round( v * 100 ) + "%" : (v * v * 4).toFixed( 2 ) + " S AT THE TOP"; }, { def: 0.5 } );
	S.cyc_amt = mk( "cyc_amt", 650, 262, 18, S.cyc_amt, 0, 1, "AMOUNT", fmtPct, { def: 0.5 } );
	T.CYC_MODES.forEach(function(n, i){ led( 440 + i * 46, 318, S.cyc_mode == i ); Tx( n, 440 + i * 46, 332, 9 ); });
	if(mbtn( "cyc_mode", 590, 312, 90, 26, "MODE", false, "ENV: ON EACH NOTE, HOLD IS THE LEVEL KEPT · RUN: ONCE, HOLD IS A TIME · LOOP: AGAIN AND AGAIN" ).clicked) S.cyc_mode = (S.cyc_mode + 1) % 3;
	led( 690, 204, (ST.cyc || 0) > 0.05 );

	// ENVELOPE
	head( "ENVELOPE", 712, 990, 204 );
	var enT = function(v){ var t = MAP.envTime( v ); return t < 1 ? Math.round( t * 1000 ) + " MS" : t.toFixed( 2 ) + " S"; };
	S.attack = mk( "attack", 750, 262, 18, S.attack, 0, 1, "ATTACK", enT, { def: 0.02 } );
	S.decay = mk( "decay", 818, 262, 18, S.decay, 0, 1, "DECAY/REL", enT, { def: 0.6 } );
	S.sustain = mk( "sustain", 886, 262, 18, S.sustain, 0, 1, "SUSTAIN", fmtPct, { def: 0.7 } );
	S.famt = mk( "famt", 954, 262, 18, S.famt, 0, 1, "FILTER AMT", function(v){ return pct( v * 2 - 1 ); }, { def: 0.5, bipolar: true } );
	Tx( "THE VCA OF EACH VOICE, AND THE FILTER", 851, 320, 8, DIM, "center", false );

	// LFO
	head( "LFO", 1316, 1530, 204 );
	S.lfo_rate = mk( "lfo_rate", 1362, 270, 22, S.lfo_rate, 0, 1, "RATE", function(v){ if(S.lfo_sync) return T.LFO_DIVS[ MAP.lfoDiv( v ) ][0]; var hz = MAP.lfoHz( v ); return (hz < 10 ? hz.toFixed( 2 ) : Math.round( hz )) + " HZ"; }, { def: 0.45 } );
	if(mbtn( "lfo_sync", 1332, 316, 60, 22, "SYNC", S.lfo_sync, "SYNC: THE RATE IN NOTES OF THE TEMPO" ).clicked) S.lfo_sync = !S.lfo_sync;
	T.LFO_SHAPES.forEach(function(n, i){ led( 1420, 226 + i * 15, S.lfo_shape == i ); Tx( n, 1430, 226 + i * 15, 8, INK, "left" ); });
	if(mbtn( "lfo_shape", 1420, 318, 90, 22, "SHAPE", false, "SINE, TRIANGLE, SAW, SQUARE, SAMPLE & HOLD, S&H WITH GLIDE" ).clicked) S.lfo_shape = (S.lfo_shape + 1) % T.LFO_SHAPES.length;
	led( 1510, 204, (ST.lfo || 0) > 0.3 );

	// the deck: octave, the name, the keyboard
	TEXT_COLOR = "#e8e5dd"; knob_scale_color = "#e8e5dd";
	Tx( "OCTAVE", 92, DECK_Y + 28, 9, "#e8e5dd" );
	for(var o = -2; o <= 2; ++o) led( 62 + (o + 2) * 15, DECK_Y + 46, S.oct == o );
	if(mbtn( "oct_down", 46, DECK_Y + 60, 50, 24, "OCT -", false, "THE KEYBOARD AN OCTAVE DOWN" ).clicked && S.oct > -2) S.oct--;
	if(mbtn( "oct_up", 104, DECK_Y + 60, 50, 24, "OCT +", false, "THE KEYBOARD AN OCTAVE UP" ).clicked && S.oct < 2) S.oct++;
	ctx.font = "bold 40px " + FONT;
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "3px";
	ctx.fillStyle = "#f2efe8"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
	ctx.fillText( "MINIMAD", 44, h - 34 );
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
	Tx( "DIGITAL PARAPHONIC SYNTHESIZER", 46, h - 20, 9, ORANGE, "left" );
	drawKeyboard( 330, DECK_Y + 20, 1180, h - DECK_Y - 40 );

	TEXT_COLOR = keep[0]; DIM_COLOR = keep[1]; knob_scale_color = keep[2];
	M = null; S = null; ST = null;
}

// the sequencer's recording (from the keys or MIDI while REC): into the steps
function onState( m, state )
{
	if(!state.rec || !state.rec.length) return;
	var s = m.settings;
	state.rec.forEach(function(r){
		if(r.add && s.seq_len < 64) { s.seq = s.seq.slice( 0, s.seq_len ); s.seq.push( r.add.slice( 0, 4 ) ); s.seq_len++; }
		else if(r.note !== undefined && s.seq_len > 0)
		{
			var st = s.seq[ r.step % s.seq_len ];
			if(st && st.indexOf( r.note ) < 0 && st.length < 4) st.push( r.note );
		}
	});
}

WR.registerSynth( "minimad", {
	title: "MINIMAD",
	description: "MINIMAD: digital paraphonic synthesizer with a touch keyboard, a mod matrix, an arpeggiator and a sequencer",
	about: "A small hybrid: 14 digital oscillator types (wavetable, FM, Karplus, modal, chords, formant...) into a 12 dB filter, a cycling envelope, a 5 x 7 modulation matrix, four voices paraphonic, an arpeggiator and a 64-step sequencer with SPICE / DICE, and a flat keyboard that reads pressure.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^(arp|seq|play|rec|hold|dice)$", 3], ["^(para|ftype|cyc_mode|lfo_shape|mode|oct_down|oct_up)$", 2], ["^(sync|lfo_sync)$", 1], ["", 0]],
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
	rear_note: function( s ) { return T.ENGINES[ s.type ][0] + " · " + (s.para ? "PARA" : "MONO") + (s.arp_on ? " · ARP" : "") + (s.seq_on ? " · SEQ" : ""); },
	transport: function( mod, action, value ) {
		if(action == "play") { if(mod.settings.seq_on) mod.post({ type: "play", value: value }); } // Space plays the sequence when SEQ is on
		else if(action == "trigger") mod.post({ type: "trigger", gate: value });
	},
	tempo: function( s ) { return s.sync ? 0 : MAP.bpm( s.rate ); } // with SYNC it follows the rack
});

})();
