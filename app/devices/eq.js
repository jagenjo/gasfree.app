// devices/eq.js
// PRISM module (half rack width): a stereo five band equalizer with a spectrum display.
// LOW CUT, LOW (shelf), LO MID, MID, HI MID (bells: FREQ, GAIN, Q), HIGH (shelf), HIGH CUT, OUTPUT, ON.
// The display shows the spectrum of the output (28 bands, a third of an octave apart), the curve of
// the EQ and a point per band: drag a point to set its frequency and gain, the wheel over it sets
// its Q (as the wheel turns knobs: with the option on, or with Ctrl), a double-click flattens it. A band's name switches it on and off. Audio on the back.
// DSP in eq-worklet.js.

(function(){

var H = 320;
var BANDS = [["LOW", "#e2574c", "low"], ["LO MID", "#f0a43a", "peak"], ["MID", "#e8c547", "peak"], ["HI MID", "#6cc070", "peak"], ["HIGH", "#4fa3e0", "high"]];
var DEF_F = [80, 250, 1000, 3500, 10000];
var GMAX = 18;     // dB, the gain knobs and the display
var FMIN = 20, FMAX = 20000;
var SR = 48000;    // for the curve on the display
var NB = 28, SPEC_F0 = 25;
var REAR_JACKS = [["IN L","ain","in_l"], ["IN R","ain","in_r"], ["OUT L","aout","out_l"], ["OUT R","aout","out_r"]];
var PRESETS = [
	["FLAT", null, "EVERY BAND AT 0 dB, NO CUTS"],
	["WARM", { lowcut: 30, highcut: 14000, g: [3, 1.5, -1, -2, -2] }, "MORE BODY, SOFTER TOP"],
	["BRIGHT", { lowcut: 40, highcut: 20000, g: [-1, -2, 0, 2.5, 5] }, "AIR AND PRESENCE"],
	["SCOOP", { lowcut: 20, highcut: 20000, g: [4, -2, -6, -1, 4] }, "LOWS AND HIGHS UP, MIDS DOWN"],
	["RADIO", { lowcut: 400, highcut: 4000, g: [0, 2, 6, 3, 0] }, "A SMALL SPEAKER"]
];

function defaults()
{
	return { on: true, output: 0, lowcut: 20, highcut: 20000,
		bands: DEF_F.map(function(f){ return { on: true, f: f, g: 0, q: 0.9 }; }) };
}

function validate( s )
{
	var d = defaults();
	if(!Array.isArray( s.bands ) || s.bands.length != 5) s.bands = d.bands;
	s.bands = s.bands.map(function(b, i){
		b = b && typeof b == "object" ? b : {};
		return { on: b.on !== false, f: Math.min( FMAX, Math.max( FMIN, +b.f || DEF_F[i] ) ), g: Math.min( GMAX, Math.max( -GMAX, +b.g || 0 ) ), q: Math.min( 10, Math.max( 0.2, +b.q || 0.9 ) ) };
	});
	s.lowcut = Math.min( 1000, Math.max( 20, s.lowcut ) );
	s.highcut = Math.min( 20000, Math.max( 1000, s.highcut ) );
	s.output = Math.min( 12, Math.max( -24, s.output ) );
}

function randomize( s )
{
	s.bands.forEach(function(b){ b.g = Math.round( (Math.random() * 2 - 1) * 8 * 2 ) / 2; b.q = 0.5 + Math.random() * 2; });
}

function applyPreset( s, p )
{
	var d = defaults();
	s.lowcut = p[1] ? p[1].lowcut : 20; s.highcut = p[1] ? p[1].highcut : 20000;
	s.bands.forEach(function(b, i){ b.on = true; b.f = DEF_F[i]; b.q = 0.9; b.g = p[1] ? p[1].g[i] : 0; });
}
function isPreset( s, p )
{
	return s.lowcut == (p[1] ? p[1].lowcut : 20) && s.highcut == (p[1] ? p[1].highcut : 20000) &&
		s.bands.every(function(b, i){ return b.on && b.f == DEF_F[i] && b.q == 0.9 && b.g == (p[1] ? p[1].g[i] : 0); });
}

// the curve: the same biquads as the DSP, their gain at f
function coefs( type, f, gainDb, q )
{
	var w = 2 * Math.PI * Math.min( Math.max( f, 10 ), SR * 0.45 ) / SR, cw = Math.cos( w ), sw = Math.sin( w ), A = Math.pow( 10, gainDb / 40 );
	var b0, b1, b2, a0, a1, a2, al, s2;
	if(type == "peak") { al = sw / (2 * q); b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
	else if(type == "low" || type == "high")
	{
		al = sw / 2 * Math.SQRT2; s2 = 2 * Math.sqrt( A ) * al;
		if(type == "low") { b0 = A * ((A + 1) - (A - 1) * cw + s2); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s2); a0 = (A + 1) + (A - 1) * cw + s2; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s2; }
		else { b0 = A * ((A + 1) + (A - 1) * cw + s2); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s2); a0 = (A + 1) - (A - 1) * cw + s2; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s2; }
	}
	else
	{
		al = sw / (2 * Math.SQRT1_2);
		if(type == "hp") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; } else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
		a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
	}
	return [ b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0 ];
}
function magDb( c, f )
{
	var w = 2 * Math.PI * f / SR, c1 = Math.cos( w ), s1 = Math.sin( w ), c2 = Math.cos( 2 * w ), s2 = Math.sin( 2 * w );
	var nr = c[0] + c[1] * c1 + c[2] * c2, ni = -(c[1] * s1 + c[2] * s2);
	var dr = 1 + c[3] * c1 + c[4] * c2, di = -(c[3] * s1 + c[4] * s2);
	return 10 * Math.log10( (nr * nr + ni * ni) / (dr * dr + di * di) + 1e-30 );
}
function filtersOf( s )
{
	var list = [];
	if(s.lowcut > 20.5) list.push( coefs( "hp", s.lowcut, 0, 0.707 ) );
	s.bands.forEach(function(b, i){ if(b.on && Math.abs( b.g ) > 0.05) list.push( coefs( BANDS[i][2], b.f, b.g, b.q ) ); });
	if(s.highcut < 19900) list.push( coefs( "lp", s.highcut, 0, 0.707 ) );
	return list;
}

var drags = {}; // module id -> the point being dragged
var fmtDb = function(v){ return (v > 0 ? "+" : "") + v.toFixed( 1 ) + " dB"; };

// the display: grid, spectrum bars, the EQ curve, the band points (drag them)
function drawDisplay( M, x, y, w, h )
{
	var s = M.settings, st = M.state || {};
	var fx = function(f){ return x + Math.log( f / FMIN ) / Math.log( FMAX / FMIN ) * w; };
	var xf = function(px){ return FMIN * Math.pow( FMAX / FMIN, (px - x) / w ); };
	var gy = function(g){ return y + h / 2 - g / GMAX * (h / 2 - 8); };
	var yg = function(py){ return (y + h / 2 - py) / (h / 2 - 8) * GMAX; };
	ctx.fillStyle = "#050607"; ctx.beginPath(); ctx.roundRect( x - 6, y - 6, w + 12, h + 12, 6 ); ctx.fill();
	ctx.save();
	ctx.beginPath(); ctx.rect( x, y, w, h ); ctx.clip();
	ctx.fillStyle = "#0b1114"; ctx.fillRect( x, y, w, h );
	// the grid: decades and dB lines
	ctx.fillStyle = "rgba(255,255,255,0.07)";
	[30, 40, 50, 60, 70, 80, 90, 200, 300, 400, 500, 600, 700, 800, 900, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000].forEach(function(f){ ctx.fillRect( Math.round( fx( f ) ), y, 1, h ); });
	ctx.fillStyle = "rgba(255,255,255,0.16)";
	[100, 1000, 10000].forEach(function(f){ ctx.fillRect( Math.round( fx( f ) ), y, 1, h ); });
	[-12, -6, 6, 12].forEach(function(g){ ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fillRect( x, Math.round( gy( g ) ), w, 1 ); });
	ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect( x, Math.round( gy( 0 ) ), w, 1 );
	// the spectrum: a bar per third of an octave, -72..0 dB from the bottom, green to amber to red
	var spec = st.spec || [];
	for(var i = 0; i < NB; ++i)
	{
		var f = SPEC_F0 * Math.pow( 2, i / 3 ), lo = fx( f / Math.pow( 2, 1 / 6 ) ), hi = fx( f * Math.pow( 2, 1 / 6 ) );
		var db = spec[i] === undefined ? -100 : spec[i], n = Math.max( 0, Math.min( 1, (db + 72) / 72 ) );
		var segs = Math.round( n * 24 );
		for(var k = 0; k < segs; ++k)
		{
			var t = k / 24;
			ctx.fillStyle = t > 0.88 ? "#ff4a3a" : (t > 0.7 ? "#f0b43a" : "#3fbf74");
			ctx.globalAlpha = s.on ? 0.55 : 0.25;
			ctx.fillRect( lo + 1.5, y + h - (k + 1) * (h / 24) + 1, hi - lo - 3, h / 24 - 2 );
		}
	}
	ctx.globalAlpha = 1;
	// the curve
	var list = filtersOf( s );
	ctx.beginPath();
	for(var px = 0; px <= w; px += 2)
	{
		var ff = xf( x + px ), g = 0;
		list.forEach(function(c){ g += magDb( c, ff ); });
		g += s.output;
		var py = gy( Math.max( -GMAX * 1.4, Math.min( GMAX * 1.4, g ) ) );
		if(px == 0) ctx.moveTo( x + px, py ); else ctx.lineTo( x + px, py );
	}
	ctx.strokeStyle = s.on ? "#f4f4f0" : "#777"; ctx.lineWidth = 2; ctx.stroke();
	ctx.lineTo( x + w, gy( 0 ) ); ctx.lineTo( x, gy( 0 ) ); ctx.closePath();
	ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fill();
	// labels
	ctx.font = "9px " + FONT; ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillStyle = "rgba(255,255,255,0.4)";
	[[100, "100"], [1000, "1k"], [10000, "10k"]].forEach(function(l){ ctx.fillText( l[1], fx( l[0] ) + 3, y + 3 ); });
	ctx.textBaseline = "middle";
	[12, 6, -6, -12].forEach(function(g){ ctx.fillText( (g > 0 ? "+" : "") + g, x + 3, gy( g ) ); });
	ctx.restore();

	// the band points: drag (frequency, gain), wheel (Q), double-click (0 dB)
	s.bands.forEach(function(b, i){
		var id = id_prefix + "pt" + i, cx = fx( b.f ), cy = gy( b.g );
		var hover = !cable_drag && (ui.active === null || ui.active === id) && hitCircle( cx, cy, 10 );
		if(hover) { ui.hot = id; hover_control = id; }
		if(hover && ui.pressed && ui.active === null)
		{
			ui.active = id;
			if(ui.dbl) b.g = 0;
			drags[ M.id ] = { i: i, dx: ui.x - cx, dy: ui.y - cy };
		}
		if(ui.active === id && ui.down && drags[ M.id ] && drags[ M.id ].i == i)
		{
			var dg = drags[ M.id ];
			b.f = Math.round( Math.max( FMIN, Math.min( FMAX, xf( Math.max( x, Math.min( x + w, ui.x - dg.dx ) ) ) ) ) );
			b.g = Math.round( Math.max( -GMAX, Math.min( GMAX, yg( ui.y - dg.dy ) ) ) * 10 ) / 10;
			b.on = true;
		}
		if(hover && ui.wheel && ui.active === null && (wheel_knobs || ui.wheel_ctrl) && BANDS[i][2] == "peak")
		{
			b.q = Math.round( Math.max( 0.2, Math.min( 10, b.q * (ui.wheel < 0 ? 1.12 : 1 / 1.12) ) ) * 100 ) / 100;
			ui.wheel = 0;
		}
		ctx.globalAlpha = b.on ? 1 : 0.35;
		ctx.fillStyle = BANDS[i][1];
		ctx.beginPath(); ctx.arc( cx, cy, hover || ui.active === id ? 9 : 7, 0, Math.PI * 2 ); ctx.fill();
		ctx.strokeStyle = "#050607"; ctx.lineWidth = 1.5; ctx.stroke();
		ctx.fillStyle = "#050607"; ctx.font = "bold 9px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.fillText( String( i + 1 ), cx, cy + 0.5 );
		ctx.globalAlpha = 1;
		if(hover || ui.active === id)
			tip( BANDS[i][0] + "  " + fmtHz( b.f ) + "  " + fmtDb( b.g ) + (BANDS[i][2] == "peak" ? "  Q " + b.q.toFixed( 2 ) : ""), cx, cy + 22 );
	});
}

function draw( M )
{
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var s = M.settings;
	drawDevicePanel( 0, 0, w, h, "PRISM", ["5 BAND EQUALIZER", "SPECTRUM DISPLAY"] );
	drawDisplay( M, 50, 24, w - 100, 150 );

	// the knobs: LOW CUT | five bands | HIGH CUT, OUTPUT
	var y = 254, x0 = 70, x1 = w - 78, bw = (x1 - x0 - 100) / 5;
	s.lowcut = knob( "lowcut", x0, y, 13, s.lowcut, 20, 1000, { style: "small", label: "LOW CUT", exp: true, def: 20, labelSize: 9, format: function(v){ return v < 20.5 ? "OFF" : fmtHz( v ); } } );
	s.bands.forEach(function(b, i){
		var cx = x0 + 40 + bw * (i + 0.5), peak = BANDS[i][2] == "peak";
		// the band's name: on / off
		if(tinyButton( "band" + i, cx - 30, y - 64, 60, 14, BANDS[i][0], b.on, "BAND " + (i + 1) + " ON / OFF" ))
			b.on = !b.on;
		ctx.fillStyle = BANDS[i][1]; ctx.fillRect( cx - 30, y - 47, 60, 2 );
		var kx = peak ? [-38, -3, 31] : [-20, 20];
		b.f = knob( "f" + i, cx + kx[0], y, 11, b.f, FMIN, FMAX, { style: "small", label: "FREQ", exp: true, def: DEF_F[i], labelSize: 9, format: fmtHz } );
		b.g = knob( "g" + i, cx + kx[1], y, 11, b.g, -GMAX, GMAX, { style: "small", label: "GAIN", bipolar: true, def: 0, labelSize: 9, format: fmtDb } );
		if(peak)
			b.q = knob( "q" + i, cx + kx[2], y, 8, b.q, 0.2, 10, { style: "small", label: "Q", exp: true, def: 0.9, labelSize: 9, format: function(v){ return "Q " + v.toFixed( 2 ); } } );
	});
	s.highcut = knob( "highcut", x1 - 30, y, 13, s.highcut, 1000, 20000, { style: "small", label: "HIGH CUT", exp: true, def: 20000, labelSize: 9, format: function(v){ return v > 19900 ? "OFF" : fmtHz( v ); } } );
	s.output = knob( "output", x1 + 22, y - 18, 14, s.output, -24, 12, { style: "small", label: "OUTPUT", def: 0, labelSize: 9, format: fmtDb } );
	if(button( "on", x1 + 2, y + 14, 40, 20, "ON", s.on ).clicked)
		s.on = !s.on;
	PRESETS.forEach(function(p, i){
		if(tinyButton( "preset" + i, w - 44 - (PRESETS.length - i) * 58, h - 30, 54, 14, p[0], isPreset( s, p ), p[2] ))
			applyPreset( s, p );
	});
}

WR.registerSynth( "eq", {
	title: "PRISM",
	description: "PRISM: 5 band equalizer with a spectrum display",
	about: "A stereo five band equalizer: low and high shelves, three bells, low and high cuts, and a display with the spectrum and the curve (drag its points). Half width.",
	key_prio: [["^on$", 2], ["^band\\d$", 1], ["", 0]],
	category: "Effects",
	half: true,
	insert: true,
	worklet: "devices/eq-worklet.js",
	jacks: [[]],
	rear_jacks: REAR_JACKS,
	midi_in: null,
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { return [ (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5, H ]; },
	draw: draw,
	rear_note: function( s ) { return !s.on ? "BYPASSED (OFF): DRY THROUGH" : "5 BANDS · OUTPUT " + fmtDb( s.output ); }
});

})();
