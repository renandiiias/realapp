#!/usr/bin/env python3
"""Render a Loom-like 30s RealApp launch demo from real frontend screens."""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from pathlib import Path

import imageio.v2 as iio
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


REAL_GREEN = (53, 226, 20)
REAL_BLUE = (60, 152, 255)
WHITE = (244, 248, 255)


@dataclass(frozen=True)
class Scene:
    start: float
    end: float
    screen: str
    kicker: str
    title: str
    subtitle: str
    accent: tuple[int, int, int]
    focus_x: float
    focus_y: float


SCENES: tuple[Scene, ...] = (
    Scene(
        start=0.0,
        end=6.0,
        screen="home",
        kicker="SYSTEM BOOT",
        title="THE APP FORMS\nIN REAL TIME",
        subtitle="From structure to live interface in seconds.",
        accent=REAL_BLUE,
        focus_x=0.50,
        focus_y=0.28,
    ),
    Scene(
        start=6.0,
        end=12.0,
        screen="create",
        kicker="CREATE",
        title="BRIEFING BECOMES\nCAMPAIGN FAST",
        subtitle="A product flow built for launch speed.",
        accent=(76, 170, 255),
        focus_x=0.58,
        focus_y=0.52,
    ),
    Scene(
        start=12.0,
        end=18.0,
        screen="orders",
        kicker="OPS",
        title="QUEUE, STATUS\nAND ORDERS LIVE",
        subtitle="Visibility from request to handoff.",
        accent=(47, 204, 156),
        focus_x=0.50,
        focus_y=0.42,
    ),
    Scene(
        start=18.0,
        end=24.0,
        screen="approvals",
        kicker="APPROVE",
        title="APPROVE\nWITH ONE TAP",
        subtitle="No context switching. No friction.",
        accent=(88, 220, 120),
        focus_x=0.52,
        focus_y=0.66,
    ),
    Scene(
        start=24.0,
        end=30.0,
        screen="account",
        kicker="SCALE",
        title="READY FOR THE\nNEXT PRODUCT LAUNCH",
        subtitle="RealApp turns marketing into operation.",
        accent=REAL_GREEN,
        focus_x=0.52,
        focus_y=0.36,
    ),
)


TAP_EVENTS: tuple[tuple[float, float, float], ...] = (
    (7.3, 0.83, 0.88),
    (10.1, 0.60, 0.56),
    (13.4, 0.54, 0.46),
    (16.1, 0.54, 0.78),
    (19.2, 0.52, 0.66),
    (22.1, 0.66, 0.84),
    (25.9, 0.50, 0.30),
    (28.5, 0.52, 0.74),
)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def smoothstep01(value: float) -> float:
    value = clamp01(value)
    return value * value * (3.0 - 2.0 * value)


def ease_out_cubic(value: float) -> float:
    value = clamp01(value)
    inv = 1.0 - value
    return 1.0 - inv * inv * inv


def load_font(size: int, condensed: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if condensed:
        candidates = (
            "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf",
            "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf",
            "/System/Library/Fonts/Supplemental/Impact.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        )
    else:
        candidates = (
            "/System/Library/Fonts/Supplemental/Avenir Next.ttc",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        )
    for item in candidates:
        path = Path(item)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def scene_index_for_time(t: float) -> int:
    for idx, scene in enumerate(SCENES):
        if scene.start <= t < scene.end:
            return idx
    return len(SCENES) - 1


def apply_alpha(image: Image.Image, factor: float) -> Image.Image:
    factor = clamp01(factor)
    if factor >= 0.999:
        return image
    output = image.copy()
    alpha = output.getchannel("A")
    alpha = alpha.point(lambda v: int(v * factor))
    output.putalpha(alpha)
    return output


def animated_cover(image: Image.Image, width: int, height: int, t: float, seed: float) -> Image.Image:
    zoom = 1.03 + 0.03 * math.sin(t * 0.68 + seed)
    iw, ih = image.size
    scale = max(width / iw, height / ih) * zoom
    nw, nh = int(iw * scale), int(ih * scale)
    resized = image.resize((nw, nh), Image.Resampling.LANCZOS)

    max_x = max(0, nw - width)
    max_y = max(0, nh - height)
    ox = int(max_x * (0.5 + 0.28 * math.sin(t * 0.21 + seed * 0.9)))
    oy = int(max_y * (0.5 + 0.28 * math.cos(t * 0.27 + seed)))
    ox = max(0, min(max_x, ox))
    oy = max(0, min(max_y, oy))
    return resized.crop((ox, oy, ox + width, oy + height))


def focus_crop(image: Image.Image, focus_x: float, focus_y: float, zoom_delta: float) -> Image.Image:
    width, height = image.size
    zoom = max(1.0, 1.0 + zoom_delta)
    if zoom <= 1.001:
        return image

    nw = int(width * zoom)
    nh = int(height * zoom)
    resized = image.resize((nw, nh), Image.Resampling.LANCZOS)

    cx = int(nw * focus_x)
    cy = int(nh * focus_y)
    left = max(0, min(nw - width, cx - width // 2))
    top = max(0, min(nh - height, cy - height // 2))
    return resized.crop((left, top, left + width, top + height))


def render_background(width: int, height: int, t: float, accent: tuple[int, int, int]) -> Image.Image:
    x = np.linspace(-1.0, 1.0, width, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, height, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)

    base_r = np.full((height, width), 2.0, dtype=np.float32)
    base_g = np.full((height, width), 6.0, dtype=np.float32)
    base_b = np.full((height, width), 16.0, dtype=np.float32)

    c1x = -0.26 + 0.22 * math.sin(t * 0.36)
    c1y = 0.12 + 0.16 * math.cos(t * 0.30)
    d1 = np.sqrt((xx - c1x) ** 2 + (yy - c1y) ** 2)
    g1 = np.exp(-(d1**2) / 0.20)

    c2x = 0.44 + 0.15 * math.cos(t * 0.25)
    c2y = -0.18 + 0.12 * math.sin(t * 0.41)
    d2 = np.sqrt((xx - c2x) ** 2 + (yy - c2y) ** 2)
    g2 = np.exp(-(d2**2) / 0.16)

    base_r += g1 * accent[0] * 0.34
    base_g += g1 * accent[1] * 0.38
    base_b += g1 * accent[2] * 0.44

    base_r += g2 * 12
    base_g += g2 * 34
    base_b += g2 * 90

    wave = np.sin(xx * 7.4 + yy * 10.8 + t * 1.5) * 0.5 + 0.5
    base_r += wave * 4
    base_g += wave * 6
    base_b += wave * 9

    vignette = np.clip(np.sqrt(xx * xx + yy * yy), 0, 1)
    dark = 1.0 - vignette * 0.74
    base_r *= dark
    base_g *= dark
    base_b *= dark

    rgb = np.stack([base_r, base_g, base_b], axis=-1)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    frame = Image.fromarray(rgb, "RGB").convert("RGBA")

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    step_x = max(96, width // 16)
    step_y = max(90, height // 11)
    for gx in range(0, width, step_x):
        draw.line((gx, 0, gx, height), fill=(175, 205, 230, 22), width=1)
    for gy in range(0, height, step_y):
        draw.line((0, gy, width, gy), fill=(175, 205, 230, 22), width=1)

    stars = max(90, (width * height) // 22000)
    for idx in range(stars):
        sx = int((idx * 137 + int(t * 43) * 17) % width)
        sy = int((idx * 83 + int(t * 33) * 13) % height)
        twinkle = 36 + int(80 * (0.5 + 0.5 * math.sin(idx * 0.66 + t * 2.2)))
        draw.ellipse((sx, sy, sx + 2, sy + 2), fill=(220, 246, 255, twinkle))

    return Image.alpha_composite(frame, overlay)


def render_forming_screen(target: Image.Image, width: int, height: int, progress: float, t: float) -> Image.Image:
    base = Image.new("RGBA", (width, height), (6, 11, 20, 255))
    draw = ImageDraw.Draw(base, "RGBA")

    grid_step = max(44, width // 10)
    for gx in range(0, width + grid_step, grid_step):
        draw.line((gx, 0, gx, height), fill=(102, 148, 196, 28), width=1)
    for gy in range(0, height + grid_step, grid_step):
        draw.line((0, gy, width, gy), fill=(102, 148, 196, 28), width=1)

    blocks = (
        (0.06, 0.06, 0.88, 0.08, 0.00),
        (0.06, 0.17, 0.40, 0.18, 0.10),
        (0.48, 0.17, 0.46, 0.18, 0.17),
        (0.06, 0.38, 0.88, 0.10, 0.24),
        (0.06, 0.51, 0.88, 0.10, 0.31),
        (0.06, 0.64, 0.40, 0.25, 0.38),
        (0.48, 0.64, 0.46, 0.25, 0.45),
        (0.06, 0.92, 0.88, 0.06, 0.52),
    )

    for bx, by, bw, bh, delay in blocks:
        phase = smoothstep01((progress - delay) / 0.24)
        if phase <= 0:
            continue
        x0 = int(width * bx)
        y0 = int(height * by)
        x1 = int(width * (bx + bw))
        y1 = int(height * (by + bh))
        draw.rounded_rectangle(
            (x0, y0, x1, y1),
            radius=18,
            fill=(14, 30, 50, int(70 * phase)),
            outline=(130, 196, 255, int(180 * phase)),
            width=2,
        )
        if phase > 0.45:
            inner_a = int(160 * phase)
            draw.line((x0 + 16, y0 + 16, x1 - 16, y0 + 16), fill=(180, 222, 255, inner_a), width=2)
            draw.line((x0 + 16, y0 + 30, x0 + int((x1 - x0) * 0.64), y0 + 30), fill=(180, 222, 255, inner_a), width=2)

    scan_y = int(height * (0.06 + 0.88 * progress))
    draw.rectangle((0, scan_y - 3, width, scan_y + 3), fill=(REAL_GREEN[0], REAL_GREEN[1], REAL_GREEN[2], 108))
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow, "RGBA")
    gdraw.ellipse((width - 250, -120, width + 240, 360), fill=(REAL_GREEN[0], REAL_GREEN[1], REAL_GREEN[2], 64))
    glow = glow.filter(ImageFilter.GaussianBlur(36))
    base.alpha_composite(glow)

    target_live = animated_cover(target, width, height, t, seed=0.27).convert("RGBA")
    reveal = smoothstep01((progress - 0.44) / 0.56)
    mixed = Image.blend(base, target_live, reveal * 0.94)
    return mixed


def draw_tap_effects(image: Image.Image, t: float) -> Image.Image:
    output = image.convert("RGBA")
    draw = ImageDraw.Draw(output, "RGBA")
    width, height = output.size

    for event_time, ex, ey in TAP_EVENTS:
        dt = t - event_time
        if dt < -0.12 or dt > 0.80:
            continue
        phase = clamp01((dt + 0.12) / 0.92)
        alpha = int((1.0 - phase) * 210)
        cx = int(width * ex)
        cy = int(height * ey)
        for ring in range(3):
            ring_phase = clamp01(phase - ring * 0.12)
            if ring_phase <= 0:
                continue
            radius = int(18 + ring_phase * 74 + ring * 8)
            ring_alpha = int(alpha * (1.0 - ring * 0.2))
            draw.ellipse(
                (cx - radius, cy - radius, cx + radius, cy + radius),
                outline=(REAL_GREEN[0], REAL_GREEN[1], REAL_GREEN[2], ring_alpha),
                width=3,
            )
        draw.ellipse((cx - 7, cy - 7, cx + 7, cy + 7), fill=(245, 252, 255, alpha))

    return output


def render_scene_screen(scene_idx: int, t: float, screens: dict[str, Image.Image], width: int, height: int) -> Image.Image:
    scene = SCENES[scene_idx]
    local = clamp01((t - scene.start) / (scene.end - scene.start))

    if scene_idx == 0:
        return render_forming_screen(screens["home"], width, height, local, t)

    current = animated_cover(screens[scene.screen], width, height, t, seed=0.21 + scene_idx * 0.4)
    pulse = 0.028 * math.sin(t * 0.9 + scene_idx)
    focus_boost = 0.07 * math.exp(-((local - 0.52) ** 2) / 0.06)
    current = focus_crop(current, scene.focus_x, scene.focus_y, pulse + focus_boost)

    transition = 0.90
    if scene_idx > 0 and local < transition:
        prev_scene = SCENES[scene_idx - 1]
        prev = animated_cover(screens[prev_scene.screen], width, height, t, seed=0.18 + (scene_idx - 1) * 0.4)
        prev = focus_crop(prev, prev_scene.focus_x, prev_scene.focus_y, 0.02)
        alpha = smoothstep01(local / transition)
        current = Image.blend(prev, current, alpha)

    current = draw_tap_effects(current, t).convert("RGB")
    return current


def build_phone(screen_image: Image.Image, t: float) -> tuple[Image.Image, tuple[int, int, int, int]]:
    phone_w, phone_h = 760, 1540
    canvas_w, canvas_h = phone_w + 220, phone_h + 240
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

    shadow = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow, "RGBA")
    sdraw.ellipse((120, phone_h + 48, phone_w + 100, phone_h + 176), fill=(0, 0, 0, 180))
    sdraw.rounded_rectangle((76, 82, phone_w + 146, phone_h + 194), radius=140, fill=(0, 0, 0, 84))
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    canvas.alpha_composite(shadow)

    phone = Image.new("RGBA", (phone_w, phone_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(phone, "RGBA")
    draw.rounded_rectangle((8, 8, phone_w - 8, phone_h - 8), radius=112, fill=(12, 14, 18, 255))
    draw.rounded_rectangle((14, 14, phone_w - 14, phone_h - 14), radius=106, outline=(108, 126, 142, 140), width=3)
    draw.rounded_rectangle((20, 20, phone_w - 20, phone_h - 20), radius=102, outline=(0, 0, 0, 170), width=4)

    screen_rect = (62, 122, phone_w - 62, phone_h - 104)
    sw = screen_rect[2] - screen_rect[0]
    sh = screen_rect[3] - screen_rect[1]

    fit = animated_cover(screen_image, sw, sh, t, seed=0.13).convert("RGBA")
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw, sh), radius=72, fill=255)
    phone.paste(fit, (screen_rect[0], screen_rect[1]), mask)

    notch_w = int(sw * 0.36)
    notch_h = 48
    notch_x = (phone_w - notch_w) // 2
    notch_y = screen_rect[1] + 14
    draw.rounded_rectangle((notch_x, notch_y, notch_x + notch_w, notch_y + notch_h), radius=22, fill=(7, 10, 13, 255))
    draw.rounded_rectangle((notch_x + 64, notch_y + 16, notch_x + notch_w - 64, notch_y + 30), radius=6, fill=(34, 40, 48, 255))

    draw.rounded_rectangle((phone_w - 10, 300, phone_w + 3, 472), radius=4, fill=(26, 30, 34, 255))
    draw.rounded_rectangle((phone_w - 10, 510, phone_w + 3, 650), radius=4, fill=(26, 30, 34, 255))
    draw.rounded_rectangle((-3, 390, 10, 560), radius=4, fill=(26, 30, 34, 255))

    glare = Image.new("RGBA", (phone_w, phone_h), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glare, "RGBA")
    gdraw.polygon(
        [(34, 116), (280, 116), (580, phone_h - 150), (330, phone_h - 150)],
        fill=(255, 255, 255, 24),
    )
    glare = glare.filter(ImageFilter.GaussianBlur(14))
    phone.alpha_composite(glare)

    phone_x, phone_y = 110, 76
    canvas.alpha_composite(phone, (phone_x, phone_y))
    global_screen = (
        phone_x + screen_rect[0],
        phone_y + screen_rect[1],
        phone_x + screen_rect[2],
        phone_y + screen_rect[3],
    )
    return canvas, global_screen


def interpolate_shot(t: float) -> tuple[float, float, float, float]:
    keyframes = (
        (0.0, 0.68, 0.55, 0.95, -2.6),
        (6.0, 0.70, 0.54, 1.00, -1.8),
        (12.0, 0.71, 0.54, 1.03, -1.3),
        (18.0, 0.70, 0.55, 1.01, -1.0),
        (24.0, 0.67, 0.56, 0.97, -1.7),
        (30.0, 0.63, 0.57, 0.90, -2.4),
    )
    for idx in range(len(keyframes) - 1):
        left = keyframes[idx]
        right = keyframes[idx + 1]
        if left[0] <= t <= right[0]:
            p = smoothstep01((t - left[0]) / (right[0] - left[0]))
            x = left[1] + (right[1] - left[1]) * p
            y = left[2] + (right[2] - left[2]) * p
            scale = left[3] + (right[3] - left[3]) * p
            rot = left[4] + (right[4] - left[4]) * p
            return x, y, scale, rot
    last = keyframes[-1]
    return last[1], last[2], last[3], last[4]


def draw_copy_panel(frame: Image.Image, scene: Scene, t: float) -> None:
    draw = ImageDraw.Draw(frame, "RGBA")
    local = clamp01((t - scene.start) / (scene.end - scene.start))
    fade_in = ease_out_cubic(local / 0.24)
    fade_out = smoothstep01((local - 0.84) / 0.16)
    alpha = clamp01(fade_in * (1.0 - fade_out))
    if alpha <= 0:
        return

    panel_w = int(frame.width * 0.48)
    panel_h = int(frame.height * 0.40)
    px = 84 + int(math.sin(t * 1.1) * 5)
    py = int(frame.height * 0.23 + (1.0 - alpha) * 46)

    draw.rounded_rectangle(
        (px, py, px + panel_w, py + panel_h),
        radius=34,
        fill=(4, 10, 18, int(188 * alpha)),
        outline=(238, 246, 255, int(118 * alpha)),
        width=2,
    )

    chip_w = 220
    chip_h = 46
    draw.rounded_rectangle(
        (px + 30, py + 28, px + 30 + chip_w, py + 28 + chip_h),
        radius=20,
        fill=(scene.accent[0], scene.accent[1], scene.accent[2], int(234 * alpha)),
    )
    kicker_font = load_font(34, condensed=True)
    draw.text((px + 46, py + 35), scene.kicker, font=kicker_font, fill=(8, 12, 16, int(252 * alpha)))

    title_font = load_font(84, condensed=True)
    subtitle_font = load_font(50, condensed=False)
    ty = py + 96
    for line in scene.title.split("\n"):
        draw.text(
            (px + 30, ty),
            line,
            font=title_font,
            fill=(WHITE[0], WHITE[1], WHITE[2], int(255 * alpha)),
            stroke_width=2,
            stroke_fill=(9, 12, 16, int(168 * alpha)),
        )
        bbox = title_font.getbbox(line)
        ty += (bbox[3] - bbox[1]) + 4

    draw.text((px + 30, py + panel_h - 66), scene.subtitle, font=subtitle_font, fill=(210, 226, 241, int(242 * alpha)))


def draw_hud(frame: Image.Image, t: float, scene_idx: int) -> None:
    draw = ImageDraw.Draw(frame, "RGBA")
    micro = load_font(int(frame.height * 0.030), condensed=True)
    tiny = load_font(int(frame.height * 0.022), condensed=True)

    draw.rounded_rectangle((28, 20, 268, 56), radius=16, fill=(5, 10, 20, 154), outline=(220, 235, 245, 70), width=1)
    draw.ellipse((40, 32, 52, 44), fill=(255, 74, 74, 235))
    draw.text((62, 27), "REC  REALAPP DEMO", font=micro, fill=(220, 234, 246, 220))
    draw.text((frame.width - 150, 28), f"{int(t):02d}s", font=micro, fill=(220, 234, 246, 180))

    steps = ("FORM", "CREATE", "OPS", "APPROVE", "SCALE")
    total_w = int(frame.width * 0.42)
    x0 = (frame.width - total_w) // 2
    y0 = frame.height - 48
    draw.rounded_rectangle((x0, y0, x0 + total_w, y0 + 8), radius=4, fill=(255, 255, 255, 50))
    draw.rounded_rectangle(
        (x0, y0, x0 + int(total_w * clamp01(t / 30.0)), y0 + 8),
        radius=4,
        fill=(REAL_GREEN[0], REAL_GREEN[1], REAL_GREEN[2], 220),
    )

    step_gap = total_w // (len(steps) - 1)
    for idx, step in enumerate(steps):
        sx = x0 + idx * step_gap
        sy = y0 - 18
        active = idx <= scene_idx
        color = (226, 239, 251, 220) if active else (175, 192, 210, 130)
        draw.text((sx - 28, sy), step, font=tiny, fill=color)


def render_frame(t: float, width: int, height: int, screens: dict[str, Image.Image]) -> Image.Image:
    scene_idx = scene_index_for_time(t)
    scene = SCENES[scene_idx]
    local = clamp01((t - scene.start) / (scene.end - scene.start))

    frame = render_background(width, height, t, scene.accent)
    screen_layer = render_scene_screen(scene_idx, t, screens, 560, 1210)
    phone, _ = build_phone(screen_layer, t)

    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow, "RGBA")
    gx = int(width * 0.66 + math.sin(t * 0.83) * 36)
    gy = int(height * 0.54 + math.cos(t * 0.76) * 22)
    gdraw.ellipse((gx - 360, gy - 360, gx + 360, gy + 360), fill=(REAL_GREEN[0], REAL_GREEN[1], REAL_GREEN[2], 56))
    glow = glow.filter(ImageFilter.GaussianBlur(72))
    frame.alpha_composite(glow)

    x, y, scale, rot = interpolate_shot(t)
    if scene_idx == 0:
        assemble = smoothstep01(local / 0.45)
        scale *= 0.85 + 0.15 * assemble
        phone = apply_alpha(phone, 0.15 + 0.85 * assemble)
    else:
        scale *= 0.97 + 0.03 * math.sin(t * 0.56)

    target_h = int(height * scale)
    ratio = target_h / phone.height
    target_w = int(phone.width * ratio)
    phone = phone.resize((target_w, target_h), Image.Resampling.LANCZOS)
    phone = phone.rotate(rot + 0.8 * math.sin(t * 0.62), resample=Image.Resampling.BICUBIC, expand=True)

    px = int(width * x - phone.width / 2)
    py = int(height * y - phone.height / 2)
    frame.alpha_composite(phone, (px, py))

    draw_copy_panel(frame, scene, t)
    draw_hud(frame, t, scene_idx)

    if scene_idx + 1 < len(SCENES):
        hit = abs(t - scene.end)
        if hit < 0.16:
            p = 1.0 - hit / 0.16
            flash = Image.new("RGBA", (width, height), (180, 240, 255, int(26 * p)))
            frame = Image.alpha_composite(frame, flash)

    if t > 29.0:
        fade = clamp01((t - 29.0) / 1.0)
        black = Image.new("RGBA", (width, height), (0, 0, 0, int(236 * fade)))
        frame = Image.alpha_composite(frame, black)

    return frame


def main() -> None:
    parser = argparse.ArgumentParser(description="Render Loom-style RealApp launch video.")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("output/launch/realapp_product_launch_30s_v4.mp4"),
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    screens_dir = root / "output" / "launch" / "screens"
    out_path = args.out if args.out.is_absolute() else root / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)

    required = {
        "home": screens_dir / "ui_home.png",
        "create": screens_dir / "ui_create.png",
        "orders": screens_dir / "ui_orders.png",
        "approvals": screens_dir / "ui_approvals.png",
        "account": screens_dir / "ui_account.png",
    }
    missing = [str(path) for path in required.values() if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing frontend captures: {missing}")

    screens = {key: Image.open(path).convert("RGB") for key, path in required.items()}
    total_frames = int(args.seconds * args.fps)

    writer = iio.get_writer(
        str(out_path),
        fps=args.fps,
        codec="libx264",
        quality=9,
        macro_block_size=None,
        ffmpeg_log_level="error",
    )
    try:
        for idx in range(total_frames):
            t = idx / args.fps
            frame = render_frame(t, args.width, args.height, screens)
            writer.append_data(np.asarray(frame.convert("RGB"), dtype=np.uint8))
    finally:
        writer.close()

    print(out_path)


if __name__ == "__main__":
    main()
