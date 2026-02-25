#!/usr/bin/env python3
"""Render a 30s RealApp product-launch video from real frontend screens."""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from pathlib import Path

import imageio.v2 as iio
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


REAL_GREEN = (53, 226, 20)
REAL_BLUE = (40, 132, 255)
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


SCENES: tuple[Scene, ...] = (
    Scene(
        start=0.0,
        end=6.0,
        screen="home",
        kicker="REALAPP",
        title="LANCAMENTO\nCOM VELOCIDADE\nDE IA",
        subtitle="Do briefing ao pedido em um fluxo unico.",
        accent=REAL_BLUE,
    ),
    Scene(
        start=6.0,
        end=12.0,
        screen="create",
        kicker="CRIACAO",
        title="BRIEFING\nVIRA CAMPANHA\nEM MINUTOS",
        subtitle="Design, copy e oferta em um unico motor.",
        accent=(80, 165, 255),
    ),
    Scene(
        start=12.0,
        end=18.0,
        screen="orders",
        kicker="OPERACAO",
        title="STATUS, FILA E\nPEDIDOS AO VIVO",
        subtitle="Visibilidade total da execucao ao fechamento.",
        accent=(42, 198, 150),
    ),
    Scene(
        start=18.0,
        end=24.0,
        screen="approvals",
        kicker="APROVACAO",
        title="APROVE COM\nUM TOQUE\nNO APP",
        subtitle="Sem perder contexto entre equipe e cliente.",
        accent=(95, 215, 120),
    ),
    Scene(
        start=24.0,
        end=30.0,
        screen="account",
        kicker="ESCALA",
        title="PRONTO PARA\nESCALAR\nDE VERDADE?",
        subtitle="RealApp transforma marketing em operacao.",
        accent=REAL_GREEN,
    ),
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


def render_background(width: int, height: int, t: float, accent: tuple[int, int, int]) -> Image.Image:
    x = np.linspace(-1.0, 1.0, width, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, height, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)

    base_r = np.full((height, width), 2.0, dtype=np.float32)
    base_g = np.full((height, width), 7.0, dtype=np.float32)
    base_b = np.full((height, width), 17.0, dtype=np.float32)

    c1x = -0.28 + 0.22 * math.sin(t * 0.38)
    c1y = 0.08 + 0.15 * math.cos(t * 0.31)
    d1 = np.sqrt((xx - c1x) ** 2 + (yy - c1y) ** 2)
    g1 = np.exp(-(d1**2) / 0.19)

    c2x = 0.45 + 0.12 * math.cos(t * 0.27)
    c2y = -0.22 + 0.10 * math.sin(t * 0.42)
    d2 = np.sqrt((xx - c2x) ** 2 + (yy - c2y) ** 2)
    g2 = np.exp(-(d2**2) / 0.15)

    base_r += g1 * accent[0] * 0.36
    base_g += g1 * accent[1] * 0.42
    base_b += g1 * accent[2] * 0.46

    base_r += g2 * 18
    base_g += g2 * 42
    base_b += g2 * 94

    waves = np.sin(xx * 8.0 + yy * 11.2 + t * 1.7) * 0.5 + 0.5
    base_r += waves * 5
    base_g += waves * 7
    base_b += waves * 10

    vignette = np.clip(np.sqrt(xx * xx + yy * yy), 0, 1)
    darken = 1.0 - vignette * 0.72
    base_r *= darken
    base_g *= darken
    base_b *= darken

    rgb = np.stack([base_r, base_g, base_b], axis=-1)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    image = Image.fromarray(rgb, "RGB").convert("RGBA")

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    step_x = max(96, width // 15)
    step_y = max(86, height // 12)
    for gx in range(0, width, step_x):
        draw.line((gx, 0, gx, height), fill=(180, 205, 225, 20), width=1)
    for gy in range(0, height, step_y):
        draw.line((0, gy, width, gy), fill=(180, 205, 225, 20), width=1)

    stars = max(120, (width * height) // 16000)
    for idx in range(stars):
        sx = int((idx * 127 + int(t * 44) * 19) % width)
        sy = int((idx * 97 + int(t * 31) * 11) % height)
        twinkle = 40 + int(95 * (0.5 + 0.5 * math.sin(idx * 0.63 + t * 2.3)))
        draw.ellipse((sx, sy, sx + 2, sy + 2), fill=(210, 245, 255, twinkle))

    return Image.alpha_composite(image, overlay)


def animated_cover(image: Image.Image, width: int, height: int, t: float, seed: float) -> Image.Image:
    zoom = 1.05 + 0.035 * math.sin(t * 0.67 + seed)
    iw, ih = image.size
    scale = max(width / iw, height / ih) * zoom
    nw, nh = int(iw * scale), int(ih * scale)
    resized = image.resize((nw, nh), Image.Resampling.LANCZOS)

    max_x = max(0, nw - width)
    max_y = max(0, nh - height)
    ox = int(max_x * (0.5 + 0.30 * math.sin(t * 0.22 + seed * 0.7)))
    oy = int(max_y * (0.5 + 0.30 * math.cos(t * 0.29 + seed)))
    ox = max(0, min(max_x, ox))
    oy = max(0, min(max_y, oy))
    return resized.crop((ox, oy, ox + width, oy + height))


def blended_screen(screens: dict[str, Image.Image], t: float) -> tuple[Image.Image, int]:
    idx = scene_index_for_time(t)
    scene = SCENES[idx]
    frame = screens[scene.screen].copy()
    transition = 0.72

    if idx + 1 < len(SCENES) and t > scene.end - transition:
        next_scene = SCENES[idx + 1]
        alpha = clamp01((t - (scene.end - transition)) / transition)
        frame = Image.blend(frame, screens[next_scene.screen], alpha)

    return frame, idx


def build_phone(screen_image: Image.Image, t: float, seed: float = 0.0) -> Image.Image:
    phone_w, phone_h = 760, 1540
    canvas = Image.new("RGBA", (phone_w + 220, phone_h + 240), (0, 0, 0, 0))
    phone = Image.new("RGBA", (phone_w, phone_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(phone, "RGBA")

    draw.rounded_rectangle((8, 8, phone_w - 8, phone_h - 8), radius=110, fill=(12, 14, 18, 255))
    draw.rounded_rectangle((14, 14, phone_w - 14, phone_h - 14), radius=104, outline=(100, 118, 136, 140), width=3)
    draw.rounded_rectangle((20, 20, phone_w - 20, phone_h - 20), radius=100, outline=(0, 0, 0, 180), width=4)

    screen_rect = (62, 122, phone_w - 62, phone_h - 104)
    sw = screen_rect[2] - screen_rect[0]
    sh = screen_rect[3] - screen_rect[1]

    screen = animated_cover(screen_image, sw, sh, t, seed).convert("RGBA")
    screen_mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(screen_mask).rounded_rectangle((0, 0, sw, sh), radius=72, fill=255)
    phone.paste(screen, (screen_rect[0], screen_rect[1]), screen_mask)

    notch_w = int(sw * 0.34)
    notch_h = 46
    notch_x = (phone_w - notch_w) // 2
    notch_y = screen_rect[1] + 14
    draw.rounded_rectangle((notch_x, notch_y, notch_x + notch_w, notch_y + notch_h), radius=22, fill=(8, 10, 13, 255))
    draw.rounded_rectangle((notch_x + 68, notch_y + 16, notch_x + notch_w - 68, notch_y + 30), radius=6, fill=(35, 40, 48, 255))

    draw.rounded_rectangle((phone_w - 10, 300, phone_w + 3, 470), radius=4, fill=(26, 30, 34, 255))
    draw.rounded_rectangle((phone_w - 10, 510, phone_w + 3, 650), radius=4, fill=(26, 30, 34, 255))
    draw.rounded_rectangle((-3, 390, 10, 560), radius=4, fill=(26, 30, 34, 255))

    glare = Image.new("RGBA", (phone_w, phone_h), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glare, "RGBA")
    gdraw.polygon(
        [(40, 120), (280, 120), (560, phone_h - 160), (320, phone_h - 160)],
        fill=(255, 255, 255, 22),
    )
    glare = glare.filter(ImageFilter.GaussianBlur(16))
    phone.alpha_composite(glare, (0, 0))

    shadow = Image.new("RGBA", (phone_w + 220, phone_h + 240), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow, "RGBA")
    sdraw.ellipse((120, phone_h + 56, phone_w + 100, phone_h + 172), fill=(0, 0, 0, 170))
    sdraw.rounded_rectangle((70, 80, phone_w + 150, phone_h + 190), radius=150, fill=(0, 0, 0, 72))
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))

    canvas.alpha_composite(shadow, (0, 0))
    canvas.alpha_composite(phone, (110, 76))
    return canvas


def interpolate_shot(t: float) -> tuple[float, float, float, float]:
    keys = (
        (0.0, 0.55, 0.58, 0.86, -8.5),
        (6.0, 0.60, 0.56, 0.93, -5.0),
        (12.0, 0.64, 0.54, 0.99, -2.6),
        (18.0, 0.68, 0.54, 1.01, -1.4),
        (24.0, 0.63, 0.56, 0.94, -3.6),
        (30.0, 0.54, 0.57, 0.84, -6.2),
    )
    for idx in range(len(keys) - 1):
        a = keys[idx]
        b = keys[idx + 1]
        if a[0] <= t <= b[0]:
            f = smoothstep01((t - a[0]) / (b[0] - a[0]))
            x = a[1] + (b[1] - a[1]) * f
            y = a[2] + (b[2] - a[2]) * f
            s = a[3] + (b[3] - a[3]) * f
            r = a[4] + (b[4] - a[4]) * f
            return x, y, s, r
    tail = keys[-1]
    return tail[1], tail[2], tail[3], tail[4]


def draw_copy_panel(frame: Image.Image, scene: Scene, t: float, idx: int) -> None:
    draw = ImageDraw.Draw(frame, "RGBA")

    local = clamp01((t - scene.start) / (scene.end - scene.start))
    appear = ease_out_cubic(local / 0.2)
    disappear = smoothstep01((local - 0.82) / 0.18)
    alpha = clamp01(appear * (1.0 - disappear))
    if alpha <= 0:
        return

    panel_w = int(frame.width * 0.49)
    panel_h = int(frame.height * 0.44)
    px = 92 + int(math.sin(t * 1.1) * 6)
    py = int(frame.height * 0.20 + (1.0 - alpha) * 48)

    draw.rounded_rectangle(
        (px, py, px + panel_w, py + panel_h),
        radius=34,
        fill=(4, 10, 19, int(182 * alpha)),
        outline=(240, 248, 255, int(114 * alpha)),
        width=2,
    )

    chip_w = 190
    draw.rounded_rectangle(
        (px + 30, py + 28, px + 30 + chip_w, py + 72),
        radius=20,
        fill=(scene.accent[0], scene.accent[1], scene.accent[2], int(235 * alpha)),
    )
    kicker_font = load_font(34, condensed=True)
    draw.text((px + 48, py + 36), scene.kicker, font=kicker_font, fill=(8, 12, 16, int(255 * alpha)))

    title_font = load_font(88, condensed=True)
    subtitle_font = load_font(52, condensed=False)

    ty = py + 96
    for line in scene.title.split("\n"):
        draw.text(
            (px + 34, ty),
            line,
            font=title_font,
            fill=(WHITE[0], WHITE[1], WHITE[2], int(255 * alpha)),
            stroke_width=2,
            stroke_fill=(9, 12, 16, int(155 * alpha)),
        )
        bbox = title_font.getbbox(line)
        ty += (bbox[3] - bbox[1]) + 6

    draw.text((px + 34, py + panel_h - 74), scene.subtitle, font=subtitle_font, fill=(210, 226, 240, int(242 * alpha)))

    if idx >= 2:
        badge_w = 210
        bx = px + panel_w - badge_w - 34
        by = py + panel_h - 148
        draw.rounded_rectangle((bx, by, bx + badge_w, by + 54), radius=24, fill=(12, 22, 38, int(212 * alpha)))
        draw.ellipse((bx + 18, by + 17, bx + 32, by + 31), fill=(REAL_GREEN[0], REAL_GREEN[1], REAL_GREEN[2], int(232 * alpha)))
        micro = load_font(32, condensed=True)
        draw.text((bx + 42, by + 13), "LIVE FLOW", font=micro, fill=(228, 241, 252, int(235 * alpha)))


def draw_hud(frame: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(frame, "RGBA")
    micro = load_font(int(frame.height * 0.030), condensed=True)
    draw.text((36, 26), "REALAPP / PRODUCT LAUNCH", font=micro, fill=(205, 220, 235, 175))
    draw.text((frame.width - 220, 26), "30s DEMO CUT", font=micro, fill=(205, 220, 235, 175))

    progress = clamp01(t / 30.0)
    bar_w = int(frame.width * 0.20)
    x0 = frame.width - bar_w - 40
    y0 = frame.height - 38
    draw.rounded_rectangle((x0, y0, x0 + bar_w, y0 + 6), radius=3, fill=(255, 255, 255, 58))
    draw.rounded_rectangle(
        (x0, y0, x0 + int(bar_w * progress), y0 + 6),
        radius=3,
        fill=(REAL_GREEN[0], REAL_GREEN[1], REAL_GREEN[2], 228),
    )


def render_frame(
    t: float,
    width: int,
    height: int,
    screens: dict[str, Image.Image],
) -> Image.Image:
    screen_frame, idx = blended_screen(screens, t)
    scene = SCENES[idx]

    frame = render_background(width, height, t, scene.accent)

    gx = int(width * 0.66 + math.sin(t * 0.9) * 40)
    gy = int(height * 0.54 + math.cos(t * 0.8) * 24)
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow, "RGBA")
    gdraw.ellipse((gx - 360, gy - 360, gx + 360, gy + 360), fill=(REAL_GREEN[0], REAL_GREEN[1], REAL_GREEN[2], 58))
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    frame.alpha_composite(glow)

    phone = build_phone(screen_frame, t, seed=idx * 0.8 + 0.17)
    x, y, scale, rotation = interpolate_shot(t)
    scale *= 0.94 + 0.04 * math.sin(t * 0.62)

    target_h = int(height * scale)
    ratio = target_h / phone.height
    target_w = int(phone.width * ratio)
    phone = phone.resize((target_w, target_h), Image.Resampling.LANCZOS)
    phone = phone.rotate(rotation + 1.5 * math.sin(t * 0.53), resample=Image.Resampling.BICUBIC, expand=True)

    px = int(width * x - phone.width / 2)
    py = int(height * y - phone.height / 2)
    frame.alpha_composite(phone, (px, py))

    draw_copy_panel(frame, scene, t, idx)
    draw_hud(frame, t)

    transition_hit = abs(t - scene.end)
    if idx + 1 < len(SCENES) and transition_hit < 0.22:
        pulse = 1.0 - transition_hit / 0.22
        flash = Image.new("RGBA", (width, height), (190, 248, 255, int(34 * pulse)))
        frame = Image.alpha_composite(frame, flash)

    if t > 29.0:
        out = clamp01((t - 29.0) / 1.0)
        fade = Image.new("RGBA", (width, height), (0, 0, 0, int(235 * out)))
        frame = Image.alpha_composite(frame, fade)

    return frame


def main() -> None:
    parser = argparse.ArgumentParser(description="Render RealApp launch video from real app screens.")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("output/launch/realapp_product_launch_30s_v3.mp4"),
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
        raise FileNotFoundError(f"Missing frontend screen captures: {missing}")

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
