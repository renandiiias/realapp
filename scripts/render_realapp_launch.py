#!/usr/bin/env python3
"""Render a higher-impact 30s launch video for RealApp using local assets."""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from pathlib import Path

import imageio.v2 as iio
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


REAL_GREEN = (53, 226, 20)
WHITE = (245, 248, 255)


@dataclass(frozen=True)
class CardSpec:
    asset_key: str
    x: float
    y: float
    scale: float
    rot: float
    delay: float


@dataclass(frozen=True)
class Scene:
    name: str
    start: float
    end: float
    kicker: str
    title: str
    subtitle: str
    accent: tuple[int, int, int]
    cards: tuple[CardSpec, ...]
    title_x: float = 0.08
    title_y: float = 0.16
    title_align: str = "left"


SCENES: tuple[Scene, ...] = (
    Scene(
        name="hook",
        start=0.0,
        end=6.0,
        kicker="REALAPP",
        title="LANCAMENTO\nCOM VELOCIDADE\nDE IA",
        subtitle="Do briefing ao pedido em um fluxo unico, sem ruir operacao.",
        accent=(24, 145, 255),
        cards=(),
        title_x=0.11,
        title_y=0.19,
    ),
    Scene(
        name="creative",
        start=6.0,
        end=12.0,
        kicker="CRIATIVOS",
        title="CAMPANHAS QUE\nPARECEM ESTUDIO",
        subtitle="Conteudo premium em ritmo de produto digital.",
        accent=(255, 120, 60),
        cards=(
            CardSpec("video", 0.66, 0.53, 1.02, -2.0, 0.00),
            CardSpec("site", 0.77, 0.78, 0.54, 5.0, 0.12),
        ),
    ),
    Scene(
        name="funnel",
        start=12.0,
        end=18.0,
        kicker="CONVERSAO",
        title="ANUNCIO + WHATSAPP\nNO MESMO IMPULSO",
        subtitle="Capta, responde e converte sem quebrar o contexto.",
        accent=(154, 90, 255),
        cards=(
            CardSpec("ads", 0.72, 0.52, 1.00, -3.0, 0.00),
            CardSpec("video", 0.82, 0.80, 0.46, 6.0, 0.18),
        ),
    ),
    Scene(
        name="ops",
        start=18.0,
        end=24.0,
        kicker="OPERACAO",
        title="STATUS, FILA E\nAPROVACAO EM TEMPO REAL",
        subtitle="Visibilidade total do trabalho, do rascunho a entrega.",
        accent=(32, 200, 140),
        cards=(
            CardSpec("site", 0.68, 0.50, 0.98, -2.0, 0.00),
            CardSpec("ads", 0.79, 0.79, 0.52, 7.0, 0.14),
        ),
    ),
    Scene(
        name="closing",
        start=24.0,
        end=30.0,
        kicker="REALAPP 2026",
        title="PRONTO PARA\nO PROXIMO LANCAMENTO?",
        subtitle="Escala real para negocios reais.",
        accent=REAL_GREEN,
        cards=(
            CardSpec("video", 0.67, 0.52, 0.76, -5.0, 0.00),
            CardSpec("ads", 0.80, 0.61, 0.68, 5.0, 0.11),
            CardSpec("site", 0.73, 0.77, 0.58, 2.5, 0.22),
        ),
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


def fit_cover(image: Image.Image, width: int, height: int) -> Image.Image:
    iw, ih = image.size
    scale = max(width / iw, height / ih)
    nw, nh = int(iw * scale), int(ih * scale)
    resized = image.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - width) // 2
    top = (nh - height) // 2
    return resized.crop((left, top, left + width, top + height))


def create_card_image(
    image: Image.Image,
    title: str,
    accent: tuple[int, int, int],
    width: int,
    height: int,
) -> Image.Image:
    card = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    photo = fit_cover(image, width, height).convert("RGBA")
    gradient = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(gradient)
    gdraw.rectangle((0, int(height * 0.62), width, height), fill=(2, 5, 12, 190))
    gdraw.rectangle((0, 0, width, int(height * 0.18)), fill=(2, 5, 12, 125))
    photo = Image.alpha_composite(photo, gradient)

    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=34, fill=255)
    clipped = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    clipped.paste(photo, (0, 0), mask)

    border = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(border)
    bdraw.rounded_rectangle(
        (1, 1, width - 2, height - 2),
        radius=34,
        outline=(255, 255, 255, 92),
        width=2,
    )
    bdraw.rounded_rectangle(
        (16, 14, 180, 54),
        radius=18,
        fill=(accent[0], accent[1], accent[2], 230),
    )
    label_font = load_font(24, condensed=True)
    bdraw.text((28, 20), title, font=label_font, fill=(8, 10, 14, 255))

    shadow = Image.new("RGBA", (width + 36, height + 40), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle((18, 20, width + 16, height + 18), radius=36, fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))

    card.alpha_composite(shadow, (-18, -20))
    card.alpha_composite(clipped, (0, 0))
    card.alpha_composite(border, (0, 0))
    return card


def scene_index_for_time(t: float) -> int:
    for idx, scene in enumerate(SCENES):
        if scene.start <= t < scene.end:
            return idx
    return len(SCENES) - 1


def multiline_size(font: ImageFont.ImageFont, lines: list[str], spacing: int) -> tuple[int, int]:
    widths = []
    total_h = 0
    for line in lines:
        bbox = font.getbbox(line)
        widths.append(bbox[2] - bbox[0])
        total_h += bbox[3] - bbox[1]
    if lines:
        total_h += spacing * (len(lines) - 1)
    return max(widths) if widths else 0, total_h


def draw_text_block(frame: Image.Image, scene: Scene, t: float, local: float) -> None:
    draw = ImageDraw.Draw(frame, "RGBA")
    title_font = load_font(int(frame.height * 0.102), condensed=True)
    sub_font = load_font(int(frame.height * 0.039))
    kicker_font = load_font(int(frame.height * 0.032), condensed=True)

    title_lines = scene.title.split("\n")
    title_spacing = int(frame.height * 0.007)
    sub_spacing = int(frame.height * 0.005)

    tw, th = multiline_size(title_font, title_lines, title_spacing)
    sw, sh = multiline_size(sub_font, [scene.subtitle], sub_spacing)

    panel_w = max(tw + 120, sw + 120, int(frame.width * 0.44))
    panel_h = th + sh + 150

    px = int(scene.title_x * frame.width)
    if scene.title_align == "center":
        px = (frame.width - panel_w) // 2
    py = int(scene.title_y * frame.height)

    in_factor = ease_out_cubic(local / 0.22)
    out_factor = smoothstep01((local - 0.84) / 0.16)
    alpha = clamp01(in_factor * (1.0 - out_factor))

    panel_alpha = int(166 * alpha)
    border_alpha = int(85 * alpha)

    y_offset = int((1.0 - alpha) * 42)
    px += int(math.sin(t * 2.8) * 2)

    draw.rounded_rectangle(
        (px, py + y_offset, px + panel_w, py + panel_h + y_offset),
        radius=30,
        fill=(4, 8, 15, panel_alpha),
        outline=(255, 255, 255, border_alpha),
        width=2,
    )

    accent = scene.accent
    draw.rounded_rectangle(
        (px + 28, py + 24 + y_offset, px + 212, py + 66 + y_offset),
        radius=16,
        fill=(accent[0], accent[1], accent[2], int(232 * alpha)),
    )
    draw.text(
        (px + 40, py + 33 + y_offset),
        scene.kicker,
        font=kicker_font,
        fill=(8, 12, 16, int(245 * alpha)),
    )

    ty = py + 88 + y_offset
    for line in title_lines:
        draw.text(
            (px + 30, ty),
            line,
            font=title_font,
            fill=(WHITE[0], WHITE[1], WHITE[2], int(255 * alpha)),
            stroke_width=2,
            stroke_fill=(8, 11, 16, int(170 * alpha)),
        )
        bbox = title_font.getbbox(line)
        ty += (bbox[3] - bbox[1]) + title_spacing

    draw.text(
        (px + 32, ty + 16),
        scene.subtitle,
        font=sub_font,
        fill=(212, 225, 235, int(242 * alpha)),
    )


def draw_card_layer(
    frame: Image.Image,
    scene: Scene,
    local: float,
    t: float,
    card_cache: dict[str, Image.Image],
) -> None:
    for spec in scene.cards:
        card_base = card_cache[spec.asset_key]

        enter = ease_out_cubic((local - spec.delay) / 0.18)
        exit_factor = smoothstep01((local - 0.88 - spec.delay * 0.25) / 0.12)
        visible = clamp01(enter * (1.0 - exit_factor))
        if visible <= 0:
            continue

        pulse = 1.0 + 0.02 * math.sin(t * 2.6 + spec.delay * 7.0)
        scale = spec.scale * (0.86 + 0.14 * visible) * pulse

        new_w = max(2, int(card_base.width * scale))
        new_h = max(2, int(card_base.height * scale))
        card = card_base.resize((new_w, new_h), Image.Resampling.LANCZOS)

        angle = spec.rot * (0.7 + 0.3 * visible) + 1.2 * math.sin(t * 1.7 + spec.delay * 5.0)
        card = card.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)

        if visible < 1.0:
            alpha = card.getchannel("A")
            alpha = alpha.point(lambda v: int(v * visible))
            card.putalpha(alpha)

        x = int(spec.x * frame.width - card.width / 2)
        y_float = spec.y * frame.height - card.height / 2 + (1.0 - visible) * 78
        y = int(y_float)

        frame.alpha_composite(card, (x, y))


def render_background(width: int, height: int, t: float, accent: tuple[int, int, int]) -> Image.Image:
    x = np.linspace(-1.0, 1.0, width, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, height, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)

    base_r = np.full((height, width), 6.0, dtype=np.float32)
    base_g = np.full((height, width), 10.0, dtype=np.float32)
    base_b = np.full((height, width), 22.0, dtype=np.float32)

    c1x = -0.2 + 0.18 * math.sin(t * 0.42)
    c1y = 0.1 + 0.12 * math.cos(t * 0.31)
    d1 = np.sqrt((xx - c1x) ** 2 + (yy - c1y) ** 2)
    g1 = np.exp(-(d1**2) / 0.21)

    c2x = 0.47 + 0.16 * math.cos(t * 0.29)
    c2y = -0.17 + 0.1 * math.sin(t * 0.37)
    d2 = np.sqrt((xx - c2x) ** 2 + (yy - c2y) ** 2)
    g2 = np.exp(-(d2**2) / 0.16)

    accent_scale = 0.78 + 0.22 * math.sin(t * 0.73)
    base_r += g1 * accent[0] * 0.34 * accent_scale
    base_g += g1 * accent[1] * 0.36 * accent_scale
    base_b += g1 * accent[2] * 0.4 * accent_scale

    base_r += g2 * 48
    base_g += g2 * 62
    base_b += g2 * 120

    streak = np.sin((xx * 11.0 + yy * 7.4) + t * 2.4) * 0.5 + 0.5
    base_r += streak * 8
    base_g += streak * 10
    base_b += streak * 12

    vignette = np.clip(np.sqrt(xx * xx + yy * yy), 0, 1)
    darken = (1.0 - vignette * 0.72)
    base_r *= darken
    base_g *= darken
    base_b *= darken

    rgb = np.stack([base_r, base_g, base_b], axis=-1)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    image = Image.fromarray(rgb, "RGB").convert("RGBA")

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    grid_alpha = 18
    step_x = max(90, width // 14)
    step_y = max(90, height // 10)
    for gx in range(0, width, step_x):
        draw.line((gx, 0, gx, height), fill=(200, 215, 230, grid_alpha), width=1)
    for gy in range(0, height, step_y):
        draw.line((0, gy, width, gy), fill=(200, 215, 230, grid_alpha), width=1)

    star_count = max(80, (width * height) // 22000)
    for idx in range(star_count):
        sx = int((idx * 127 + int(t * 37) * 17) % width)
        sy = int((idx * 83 + int(t * 31) * 11) % height)
        twinkle = 65 + int(85 * (0.5 + 0.5 * math.sin(idx * 0.7 + t * 2.0)))
        draw.ellipse((sx, sy, sx + 2, sy + 2), fill=(220, 245, 255, twinkle))

    return Image.alpha_composite(image, overlay)


def render_scene(
    scene: Scene,
    t: float,
    width: int,
    height: int,
    card_cache: dict[str, Image.Image],
) -> Image.Image:
    duration = scene.end - scene.start
    local = clamp01((t - scene.start) / duration)

    frame = render_background(width, height, t, scene.accent)
    draw_card_layer(frame, scene, local, t, card_cache)
    draw_text_block(frame, scene, t, local)

    hud = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    hdraw = ImageDraw.Draw(hud)
    micro = load_font(int(height * 0.024), condensed=True)

    hdraw.text((34, 28), "REALAPP / PRODUCT LAUNCH", font=micro, fill=(210, 222, 232, 180))
    hdraw.text((width - 272, 28), "30s DEMO CUT", font=micro, fill=(210, 222, 232, 180))

    progress = clamp01((t - SCENES[0].start) / (SCENES[-1].end - SCENES[0].start))
    bar_w = int(width * 0.18)
    x0 = width - bar_w - 36
    y0 = height - 34
    hdraw.rounded_rectangle((x0, y0, x0 + bar_w, y0 + 6), radius=3, fill=(255, 255, 255, 48))
    hdraw.rounded_rectangle(
        (x0, y0, x0 + int(bar_w * progress), y0 + 6),
        radius=3,
        fill=(REAL_GREEN[0], REAL_GREEN[1], REAL_GREEN[2], 220),
    )

    return Image.alpha_composite(frame, hud)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render high-impact launch video.")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("output/launch/realapp_product_launch_30s_v2.mp4"),
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    assets_dir = root / "real-mobile-mvp" / "assets"
    out_path = args.out if args.out.is_absolute() else root / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)

    required_assets = {
        "video": assets_dir / "services" / "video-camera.png",
        "ads": assets_dir / "services" / "ads-whatsapp.png",
        "site": assets_dir / "services" / "site-whatsapp.png",
    }

    missing = [str(path) for path in required_assets.values() if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing assets: {missing}")

    images = {key: Image.open(path).convert("RGB") for key, path in required_assets.items()}
    card_cache = {
        "video": create_card_image(images["video"], "VIDEO", (255, 162, 96), 620, 360),
        "ads": create_card_image(images["ads"], "ADS", (198, 118, 255), 610, 350),
        "site": create_card_image(images["site"], "SITE", (78, 186, 255), 620, 360),
    }

    total_frames = int(args.seconds * args.fps)
    transition_seconds = 0.48

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
            current_idx = scene_index_for_time(t)
            current_scene = SCENES[current_idx]

            frame = render_scene(
                current_scene,
                t,
                args.width,
                args.height,
                card_cache,
            )

            if current_idx + 1 < len(SCENES) and t > current_scene.end - transition_seconds:
                next_scene = SCENES[current_idx + 1]
                alpha = clamp01((t - (current_scene.end - transition_seconds)) / transition_seconds)
                next_frame = render_scene(next_scene, t, args.width, args.height, card_cache)
                frame = Image.blend(frame, next_frame, alpha)

                flash_peak = 1.0 - abs(alpha * 2.0 - 1.0)
                if flash_peak > 0:
                    flash = Image.new(
                        "RGBA",
                        (args.width, args.height),
                        (255, 255, 255, int(40 * flash_peak)),
                    )
                    frame = Image.alpha_composite(frame.convert("RGBA"), flash)

            if t > args.seconds - 1.0:
                end_fade = clamp01((t - (args.seconds - 1.0)) / 1.0)
                blackout = Image.new("RGBA", (args.width, args.height), (0, 0, 0, int(205 * end_fade)))
                frame = Image.alpha_composite(frame.convert("RGBA"), blackout)

            writer.append_data(np.asarray(frame.convert("RGB"), dtype=np.uint8))
    finally:
        writer.close()

    print(out_path)


if __name__ == "__main__":
    main()
