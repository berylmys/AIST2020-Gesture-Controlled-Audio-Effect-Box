"""
Video Processing Library for Foley from Junk
Handles video file operations including audio extraction
"""

from moviepy.editor import VideoFileClip
import os
from pathlib import Path


def extract_audio_from_video(video_path, output_audio='temp_audio.wav', verbose=False):
    """
    Extract audio track from video file
    
    Args:
        video_path: Path to input video file
        output_audio: Path for output audio file (default: 'temp_audio.wav')
        verbose: Show moviepy processing info (default: False)
    
    Returns:
        str: Path to extracted audio file, or None if failed
    
    Raises:
        ValueError: If video has no audio track
        Exception: For other processing errors
    """
    try:
        video = VideoFileClip(video_path)
        
        if video.audio is None:
            video.close()
            raise ValueError("Video has no audio track")
        
        # Extract audio
        audio = video.audio
        audio.write_audiofile(
            output_audio, 
            verbose=verbose, 
            logger=None if not verbose else 'bar'
        )
        
        video.close()
        return output_audio
        
    except Exception as e:
        print(f"Failed to extract audio from video: {e}")
        return None


def get_video_info(video_path):
    """
    Get video metadata information
    
    Args:
        video_path: Path to video file
    
    Returns:
        dict: Video information including duration, fps, resolution, etc.
    """
    try:
        video = VideoFileClip(video_path)
        
        info = {
            'duration': video.duration,
            'fps': video.fps,
            'size': video.size,  # (width, height)
            'width': video.w,
            'height': video.h,
            'has_audio': video.audio is not None,
            'filename': os.path.basename(video_path)
        }
        
        if video.audio:
            info['audio_fps'] = video.audio.fps
            info['audio_channels'] = video.audio.nchannels
        
        video.close()
        return info
        
    except Exception as e:
        print(f"Failed to get video info: {e}")
        return None


def is_video_file(filepath):
    """
    Check if file is a supported video format
    
    Args:
        filepath: Path to check
    
    Returns:
        bool: True if file is a video
    """
    video_extensions = ('.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm')
    return Path(filepath).suffix.lower() in video_extensions


def validate_video_file(filepath):
    """
    Validate video file exists and is readable
    
    Args:
        filepath: Path to video file
    
    Returns:
        tuple: (bool, str) - (is_valid, error_message)
    """
    if not os.path.exists(filepath):
        return False, "File does not exist"
    
    if not is_video_file(filepath):
        return False, "Not a supported video format"
    
    try:
        video = VideoFileClip(filepath)
        has_audio = video.audio is not None
        video.close()
        
        if not has_audio:
            return False, "Video has no audio track"
        
        return True, "Valid video file"
        
    except Exception as e:
        return False, f"Cannot read video file: {str(e)}"


# Convenience function
def extract_audio_safe(video_path, output_audio='temp_audio.wav', verbose=False):
    """
    Safely extract audio with validation
    
    Returns:
        tuple: (success, result) 
               - If success: (True, audio_path)
               - If failed: (False, error_message)
    """
    # Validate first
    is_valid, message = validate_video_file(video_path)
    if not is_valid:
        return False, message
    
    # Extract
    audio_path = extract_audio_from_video(video_path, output_audio, verbose)
    
    if audio_path and os.path.exists(audio_path):
        return True, audio_path
    else:
        return False, "Audio extraction failed"


if __name__ == '__main__':
    # Simple CLI for testing
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python videoProcessing.py <video_file> [output_audio.wav]")
        sys.exit(1)
    
    video_file = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else 'extracted_audio.wav'
    
    print(f"Processing: {video_file}")
    
    # Get info
    info = get_video_info(video_file)
    if info:
        print(f"\nVideo Info:")
        print(f"  Duration: {info['duration']:.2f}s")
        print(f"  Resolution: {info['width']}x{info['height']}")
        print(f"  FPS: {info['fps']}")
        print(f"  Has Audio: {info['has_audio']}")
    
    # Extract audio
    print(f"\nExtracting audio to: {output}")
    success, result = extract_audio_safe(video_file, output, verbose=True)
    
    if success:
        print(f"✓ Success: {result}")
    else:
        print(f"✗ Failed: {result}")