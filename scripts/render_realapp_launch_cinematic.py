#!/usr/bin/env python3
"""Render a more cinematic 30s RealApp launch teaser."""

from __future__ import annotations

import argparse
import importlib.util
import math
import sys
from pathlib import Path

import imageio.v2 as iio
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BASE_RENDERER = ROOT / "scripts" / "render_realapp_launch.py"


def load_base():
    spec = importlib.util.spec_from_file_location("render_realapp_launch_base", BASE_RENDERER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


base = load_base()
Scene = base.Scene

SCENES: tuple[Scene, ...] = (
    Scene(0.0, 6.0, "home", "POTENTIAL", "A MARCA GANHA\nCORPO E RITMO", "RealApp liga ideia, criação e operação no mesmo fluxo.", base.REAL_BLUE, 0.48, 0.28),
    Scene(6.0, 12.0, "create", "VELOCITY", "BRIEFING VIRA\nMÁQUINA DE CAMPANHA", "O que antes travava começa a escalar com clareza.", (76, 170, 255), 0.58, 0.52),
    Scene(12.0, 18.0, "orders", "CONTROL", "EXECUÇÃO VISÍVEL.\nDECISÃO IMEDIATA.", "Pedidos, status e ação ao vivo, sem ruído no meio.", (50, 205, 170), 0.52, 0.42),
    Scene(18.0, 24.0, "approvals", "MOMENTUM", "APROVAÇÃO QUE\nNÃO QUEBRA O FLUXO", "Menos espera. Mais lançamento acontecendo.", (92, 224, 126), 0.50, 0.66),
    Scene(24.0, 30.0, "account", "SCALE", "QUANDO O LANÇAMENTO\nPEDE MAIS, O APP SEGURA.", "RealApp transforma potencial em operação robusta.", base.REAL_GREEN, 0.52, 0.36),
)


def scene_index_for_time(t: float) -> int:
    for idx, scene in enumerate(SCENES):
        if scene.start <= t < scene.end:
            return idx
    return len(SCENES) - 1


def render_particles(width: int, height: int, t: float) -> Image.Image:
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")
    count = 90
    for idx in range(count):
        x = int((idx * 173 + t * 38 * (idx % 5 + 1)) % width)
        y = int((idx * 91 + t * 22 * (idx % 7 + 1)) % height)
        alpha = 20 + int(56 * (0.5 + 0.5 * math.sin(idx * 0.3 + t * 1.7)))
        r = 1 + (idx % 3)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(210, 240, 255, alpha))
    return layer.filter(ImageFilter.GaussianBlur(0.7))


def render_cinematic_bars(width: int, height: int) -> Image.Image:
    bars = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(bars, "RGBA")
    bar_h = max(56, height // 15)
    draw.rectangle((0, 0, width, bar_h), fill=(0, 0, 0, 220))
    draw.rectangle((0, height - bar_h, width, height), fill=(0, 0, 0, 220))
    return bars


def interpolate_camera(t: float) -> tuple[float, float, float, float]:
    keyframes = (
        (0.0, 0.69, 0.60, 1.02, -4.2),
        (6.0, 0.74, 0.56, 1.08, -2.8),
        (12.0, 0.70, 0.58, 1.04, -1.0),
        (18.0, 0.66, 0.56, 1.10, 1.4),
        (24.0, 0.63, 0.58, 1.03, -2.2),
        (30.0, 0.58, 0.56, 0.94, -3.4),
    )
    for idx in range(len(keyframes) - 1):
        left = keyframes[idx]
        right = keyframes[idx + 1]
        if left[0] <= t <= right[0]:
            p = base.smoothstep01((t - left[0]) / (right[0] - left[0]))
            return tuple(left[i] + (right[i] - left[i]) * p for i in range(1, 5))
    last = keyframes[-1]
    return last[1], last[2], last[3], last[4]


def render_copy(frame: Image.Image, scene: Scene, t: float) -> None:
    local = base.clamp01((t - scene.start) / (scene.end - scene.start))
    alpha = base.clamp01(base.ease_out_cubic(local / 0.3) * (1.0 - base.smoothstep01((local - 0.85) / 0.15)))
    if alpha <= 0:
        return

    draw = ImageDraw.Draw(frame, "RGBA")
    kicker_font = base.load_font(28, condensed=True)
    title_font = base.load_font(76, condensed=True)
    sub_font = base.load_font(34, condensed=False)

    px = int(frame.width * 0.07)
    py = int(frame.height * 0.20 + (1.0 - alpha) * 24)

    draw.rounded_rectangle(
        (px, py, px + 170, py + 40),
        radius=18,
        fill=(scene.accent[0], scene.accent[1], scene.accent[2], int(235 * alpha)),
    )
    draw.text((px + 22, py + 7), scene.kicker, font=kicker_font, fill=(8, 12, 16, int(245 * alpha)))

    ty = py + 62
    for line in scene.title.split("\n"):
        draw.text(
            (px, ty),
            line,
            font=title_font,
            fill=(245, 248, 255, int(255 * alpha)),
            stroke_width=2,
            stroke_fill=(8, 12, 18, int(180 * alpha)),
        )
        bbox = title_font.getbbox(line)
        ty += (bbox[3] - bbox[1]) + 2

    draw.text((px, ty + 14), scene.subtitle, font=sub_font, fill=(212, 226, 240, int(234 * alpha)))


def render_end_card(frame: Image.Image, logo: Image.Image, t: float) -> Image.Image:
    if t < 26.9:
        return frame
    p = base.smoothstep01((t - 26.9) / 2.4)
    overlay = Image.new("RGBA", frame.size, (0, 0, 0, int(150 * p)))
    out = Image.alpha_composite(frame, overlay)

    logo_img = base.apply_alpha(logo, p)
    lx = (frame.width - logo_img.width) // 2
    ly = int(frame.height * 0.17)
    out.alpha_composite(logo_img, (lx, ly))

    draw = ImageDraw.Draw(out, "RGBA")
    title_font = base.load_font(88, condensed=True)
    sub_font = base.load_font(36, condensed=False)
    draw.text(
        (frame.width // 2, int(frame.height * 0.48)),
        "O PRODUTO ESTÁ PRONTO\nPARA O PRÓXIMO NÍVEL.",
        anchor="mm",
        align="center",
        font=title_font,
        fill=(246, 248, 255, int(255 * p)),
        stroke_width=2,
        stroke_fill=(8, 12, 18, int(180 * p)),
    )
    draw.text(
        (frame.width // 2, int(frame.height * 0.60)),
        "RealApp conecta criação, operação e escala em um só sistema.",
        anchor="mm",
        font=sub_font,
        fill=(212, 226, 240, int(240 * p)),
    )
    return out


def render_frame(t: float, width: int, height: int, screens: dict[str, Image.Image], logo: Image.Image) -> Image.Image:
    scene_idx = scene_index_for_time(t)
    scene = SCENES[scene_idx]
    local = base.clamp01((t - scene.start) / (scene.end - scene.start))

    frame = base.render_background(width, height, t, scene.accent)

    # Turn the UI into an atmospheric background texture, not just a screen grab.
    texture = base.render_scene_screen(scene_idx, t, screens, width, height).convert("RGBA")
    texture = texture.filter(ImageFilter.GaussianBlur(16))
    texture = base.apply_alpha(texture, 0.20 + 0.05 * math.sin(t * 0.5))
    frame = Image.alpha_composite(frame, texture)

    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow, "RGBA")
    gx = int(width * (0.64 + 0.06 * math.sin(t * 0.4)))
    gy = int(height * (0.48 + 0.04 * math.cos(t * 0.6)))
    gdraw.ellipse((gx - 430, gy - 350, gx + 430, gy + 350), fill=(scene.accent[0], scene.accent[1], scene.accent[2], 60))
    gdraw.ellipse((gx - 220, gy - 220, gx + 220, gy + 220), fill=(230, 245, 255, 22))
    glow = glow.filter(ImageFilter.GaussianBlur(80))
    frame = Image.alpha_composite(frame, glow)

    frame = Image.alpha_composite(frame, render_particles(width, height, t))

    screen_layer = base.render_scene_screen(scene_idx, t, screens, 620, 1340)
    phone, _ = base.build_phone(screen_layer, t)

    x, y, scale, rot = interpolate_camera(t)
    scale *= 1.0 + 0.03 * math.sin(t * 0.7) + 0.04 * math.exp(-((local - 0.55) ** 2) / 0.08)
    target_h = int(height * scale)
    ratio = target_h / phone.height
    target_w = int(phone.width * ratio)
    phone = phone.resize((target_w, target_h), Image.Resampling.LANCZOS)
    phone = phone.rotate(rot + math.sin(t * 0.42) * 0.8, resample=Image.Resampling.BICUBIC, expand=True)

    reflection = phone.transpose(Image.Transpose.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(20))
    reflection = base.apply_alpha(reflection, 0.12)

    px = int(width * x - phone.width / 2)
    py = int(height * y - phone.height / 2)
    rx = px + 18
    ry = py + phone.height - 40
    frame.alpha_composite(reflection, (rx, ry))
    frame.alpha_composite(phone, (px, py))

    edge = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    edraw = ImageDraw.Draw(edge, "RGBA")
    edraw.ellipse((px - 100, py + 120, px + phone.width + 120, py + phone.height + 180), outline=(255, 255, 255, 18), width=2)
    edge = edge.filter(ImageFilter.GaussianBlur(18))
    frame = Image.alpha_composite(frame, edge)

    render_copy(frame, scene, t)
    frame = render_end_card(frame, logo, t)
    frame = Image.alpha_composite(frame, render_cinematic_bars(width, height))
    return frame


def main() -> None:
    parser = argparse.ArgumentParser(description="Render cinematic RealApp launch video.")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("output/launch/realapp_product_launch_30s_cinematic_v6_silent.mp4"),
    )
    args = parser.parse_args()

    screens_dir = ROOT / "output" / "launch" / "screens"
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

    out_path = args.out if args.out.is_absolute() else ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    logo = Image.open(ROOT / "real-mobile-mvp" / "assets" / "real-logo.png").convert("RGBA")
    logo_w = 420
    logo_h = int(logo.height * (logo_w / logo.width))
    logo = logo.resize((logo_w, logo_h), Image.Resampling.LANCZOS)
    screens = {key: Image.open(path).convert("RGB") for key, path in required.items()}

    writer = iio.get_writer(
        str(out_path),
        fps=args.fps,
        codec="libx264",
        quality=9,
        macro_block_size=None,
        ffmpeg_log_level="error",
    )
    try:
        total_frames = int(args.seconds * args.fps)
        for idx in range(total_frames):
            t = idx / args.fps
            frame = render_frame(t, args.width, args.height, screens, logo)
            writer.append_data(np.asarray(frame.convert("RGB"), dtype=np.uint8))
    finally:
        writer.close()

    preview = render_frame(28.4, args.width, args.height, screens, logo).convert("RGB")
    preview.save(ROOT / "output" / "launch" / "realapp_product_launch_30s_cinematic_v6_preview.jpg", quality=95)
    print(out_path)


if __name__ == "__main__":
    main()
