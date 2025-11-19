import argparse
import os
import shutil
import subprocess
import sys
from moviepy.editor import VideoFileClip

"""
audioExtract.py

Extract audio from a video file.

Usage:
    python audioExtract.py input_video.mp4 [-o output_audio.mp3] [--format mp3] [--bitrate 192k]
    
"""

def _default_out_path(input_path, fmt):
        base = os.path.splitext(os.path.basename(input_path))[0]
        return f"{base}.{fmt}"

def extract_with_moviepy(in_path, out_path, bitrate=None):
        clip = VideoFileClip(in_path)
        if clip.audio is None:
                raise RuntimeError("No audio stream found in the input video.")
        write_kwargs = {}
        if bitrate:
                write_kwargs["bitrate"] = bitrate
        clip.audio.write_audiofile(out_path, **write_kwargs)
        clip.close()

def extract_with_ffmpeg(in_path, out_path):
        cmd = ["ffmpeg", "-y", "-i", in_path, "-vn", out_path]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if proc.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode(errors='ignore')}")

def main():
        p = argparse.ArgumentParser(description="Extract audio from a video file.")
        p.add_argument("input", help="Input video file path")
        p.add_argument("-o", "--output", help="Output audio file path (optional)")
        p.add_argument("--format", default="mp3", help="Output audio format/extension (default: mp3)")
        p.add_argument("--bitrate", help="Audio bitrate (e.g. 192k) passed to moviepy/ffmpeg when applicable")
        args = p.parse_args()

        if not os.path.isfile(args.input):
                print("Input file not found:", args.input, file=sys.stderr)
                sys.exit(2)

        out_path = args.output if args.output else _default_out_path(args.input, args.format)

        # Make sure output directory exists
        out_dir = os.path.dirname(out_path)
        if out_dir and not os.path.isdir(out_dir):
                os.makedirs(out_dir, exist_ok=True)

        # Prefer moviepy if available
        try:
                import moviepy.editor  # type: ignore
                try:
                        extract_with_moviepy(args.input, out_path, bitrate=args.bitrate)
                        print("Audio extracted to", out_path)
                        return
                except Exception as e:
                        print("moviepy extraction failed:", e, file=sys.stderr)
                        # fall back to ffmpeg
        except Exception:
                # moviepy not available
                pass

        # Fallback: use ffmpeg CLI
        if shutil.which("ffmpeg") is None:
                print("Neither moviepy is available nor ffmpeg is on PATH. Install one of them.", file=sys.stderr)
                sys.exit(3)

        try:
                # If bitrate was provided, include it in ffmpeg args. Let ffmpeg choose codec by extension.
                if args.bitrate:
                        # For safety, pass -ab (audio bitrate) which older ffmpeg accepts; newer ffs use -b:a
                        cmd = ["ffmpeg", "-y", "-i", args.input, "-vn", "-b:a", args.bitrate, out_path]
                        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                        if proc.returncode != 0:
                                raise RuntimeError(proc.stderr.decode(errors="ignore"))
                else:
                        extract_with_ffmpeg(args.input, out_path)
                print("Audio extracted to", out_path)
        except Exception as e:
                print("ffmpeg extraction failed:", e, file=sys.stderr)
                sys.exit(4)

if __name__ == "__main__":
        main()