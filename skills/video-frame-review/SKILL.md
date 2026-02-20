---
name: video-frame-review
description: Use when a user asks to inspect a real video result, verify edit quality, or compare input vs output by extracting representative frames and quick media diagnostics.
---

# Video Frame Review

Use this skill to quickly inspect whether a video edit is actually correct.

## Workflow

1. Confirm input and output file paths.
2. Run `scripts/review_video.sh <video_path> <out_dir>`.
3. Read generated `report.txt` and frame images.
4. Compare input vs output:
   - visual continuity
   - framing/cropping
   - duration changes
   - obvious encoding issues

## Commands

```bash
bash scripts/review_video.sh /abs/path/input.mp4 /abs/path/out/input_review
bash scripts/review_video.sh /abs/path/output.mp4 /abs/path/out/output_review
```

## Notes

- This is for objective inspection, not subjective style scoring.
- If edit quality is poor, list concrete defects and suggest exact pipeline fixes.
