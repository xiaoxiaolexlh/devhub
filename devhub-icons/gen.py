import math

CX = CY = 512

# Geometry of the sync mark: two opposing arrows on a common ring.
R = 250.0          # centreline radius
W = 100.0          # band width
GAP = 60.0         # angular gap between an arrow head and the other arrow's tail
HEAD_LEN = 1.25    # head length, in band widths
BARB = 0.48        # how far the head's base sticks out past the band, in band widths
PHASE = 200.0      # angle (deg) where each arrow's tail starts


def pt(r, deg):
    a = math.radians(deg)
    return (CX + r * math.cos(a), CY - r * math.sin(a))


def f(p):
    return f"{p[0]:.1f} {p[1]:.1f}"


def arrow(a0, a1):
    """One arrow: ring band from a0 to a1 (clockwise) ending in a barbed head."""
    ro, ri = R + W / 2, R - W / 2
    o0, i0 = pt(ro, a0), pt(ri, a0)
    o1, i1 = pt(ro, a1), pt(ri, a1)
    o1b, i1b = pt(ro + BARB * W, a1), pt(ri - BARB * W, a1)
    t = math.radians(a1)
    dx, dy = math.sin(t), math.cos(t)          # forward tangent at a1 (clockwise)
    mid = pt(R, a1)
    apex = (mid[0] + dx * HEAD_LEN * W, mid[1] + dy * HEAD_LEN * W)
    return (f'M {f(i0)} L {f(o0)} '
            f'A {ro:.1f} {ro:.1f} 0 0 1 {f(o1)} '
            f'L {f(o1b)} L {f(apex)} L {f(i1b)} L {f(i1)} '
            f'A {ri:.1f} {ri:.1f} 0 0 0 {f(i0)} Z')


def mark():
    span = 180 - GAP
    paths = "".join(
        f'<path d="{arrow(PHASE + off, PHASE - span + off)}"/>'
        for off in (0, 180)
    )
    return ('<g fill="#FFFFFF" stroke="#FFFFFF" stroke-width="4" '
            f'stroke-linejoin="round">{paths}</g>')


SVG = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#8B8DF9"/>
      <stop offset="0.46" stop-color="#5B54EA"/>
      <stop offset="1" stop-color="#3F35C4"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.24" cy="0.06" r="0.8">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.26"/>
      <stop offset="0.6" stop-color="#FFFFFF" stop-opacity="0.03"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="228" fill="url(#glow)"/>
  {mark()}
</svg>
'''

if __name__ == "__main__":
    open("devhub-icon.svg", "w", encoding="utf-8").write(SVG)
    print("wrote devhub-icon.svg")
