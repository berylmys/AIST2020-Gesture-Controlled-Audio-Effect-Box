import numpy as np
import librosa
import soundfile as sf
from pathlib import Path
from scipy import signal
import argparse

"""
Timbre Enhancement Module for Foley Samples
Provides pitch shifting, formant shifting, and harmonic enhancement
"""

def pitch_shift(y, sr, n_steps=0):
    """
    Shift pitch by n_steps semitones without changing duration
    
    Args:
        y: audio signal
        sr: sample rate
        n_steps: semitones to shift (positive = higher, negative = lower)
    
    Returns:
        pitch-shifted audio
    """
    if n_steps == 0:
        return y
    
    return librosa.effects.pitch_shift(y, sr=sr, n_steps=n_steps)


def formant_shift(y, sr, shift_ratio=1.0):
    """
    Approximate formant shift using phase vocoder time-stretching
    
    Note: This is not "true" formant shifting (which requires envelope separation),
    but provides a useful spectral stretching effect suitable for foley sound design.
    
    Args:
        y: audio signal
        sr: sample rate
        shift_ratio: spectral shift ratio
            > 1.0 = higher formants (smaller/thinner sound)
            < 1.0 = lower formants (bigger/deeper sound)
            
    Returns:
        formant-shifted audio
    """
    if shift_ratio == 1.0:
        return y
    
    # Approximate formant shift using phase vocoder
    hop_length = 512
    D = librosa.stft(y, hop_length=hop_length)
    D_shifted = librosa.phase_vocoder(D, rate=shift_ratio, hop_length=hop_length)
    y_formant = librosa.istft(D_shifted, hop_length=hop_length, length=len(y))
    
    return y_formant


def enhance_harmonics(y, sr, amount=0.3, n_harmonics=3):
    """
    Enhance harmonic content to make sounds richer and more resonant
    
    Note: Only suitable for sounds with clear pitch. Non-pitched sounds 
    (noise, friction, bursts) will be returned unchanged.
    
    Args:
        y: audio signal
        sr: sample rate
        amount: enhancement amount (0.0 to 1.0)
        n_harmonics: number of harmonics to enhance
        
    Returns:
        harmonically enhanced audio
    """
    if amount <= 0:
        return y
    
    # Detect fundamental frequency
    f0 = librosa.yin(y, fmin=50, fmax=2000, sr=sr)
    
    # Check if pitch detection is reliable
    valid_f0_count = np.count_nonzero(~np.isnan(f0))
    if valid_f0_count < 0.3 * len(f0):
        # Not enough valid pitch frames, likely noise/percussion
        return y
    
    f0_mean = np.nanmean(f0)
    
    # More strict pitch validation
    if np.isnan(f0_mean) or f0_mean < 80 or f0_mean > 1500:
        # Pitch too low, too high, or invalid
        return y
    
    # Generate harmonic series
    enhanced = y.copy()
    
    for h in range(2, n_harmonics + 2):
        # Shift by harmonic ratios
        harmonic_shift = 12 * np.log2(h)
        y_harmonic = librosa.effects.pitch_shift(y, sr=sr, n_steps=harmonic_shift)
        
        # Add with decreasing amplitude
        harmonic_amount = amount / h
        enhanced = enhanced + y_harmonic * harmonic_amount
    
    # Normalize to prevent clipping
    max_val = np.max(np.abs(enhanced))
    if max_val > 0:
        enhanced = enhanced / max_val * 0.95
    
    return enhanced


def apply_timbre_preset(y, sr, sound_type):
    """
    Apply timbre enhancement preset based on sound classification
    
    Args:
        y: audio signal
        sr: sample rate
        sound_type: one of the 8 sound categories
        
    Returns:
        enhanced audio with preset applied
    """
    presets = {
        'impact': {
            'pitch_shift': 0,           # Keep original pitch
            'formant_shift': 0.85,      # Slightly bigger/heavier
            'harmonic_amount': 0.15,    # Subtle harmonic boost
            'n_harmonics': 2
        },
        'metallic': {
            'pitch_shift': 0,
            'formant_shift': 1.1,       # Slightly brighter
            'harmonic_amount': 0.4,     # Strong harmonic enhancement
            'n_harmonics': 4
        },
        'friction': {
            'pitch_shift': 0,
            'formant_shift': 1.15,      # Higher/thinner
            'harmonic_amount': 0.1,     # Minimal harmonics
            'n_harmonics': 2
        },
        'liquid': {
            'pitch_shift': 0,
            'formant_shift': 0.95,      # Slightly fuller
            'harmonic_amount': 0.2,
            'n_harmonics': 3
        },
        'burst': {
            'pitch_shift': 0,
            'formant_shift': 0.9,       # Bigger/punchier
            'harmonic_amount': 0.15,
            'n_harmonics': 2
        },
        'resonant': {
            'pitch_shift': 0,
            'formant_shift': 1.0,       # Keep natural
            'harmonic_amount': 0.5,     # Maximum harmonic richness
            'n_harmonics': 5
        },
        'ambient': {
            'pitch_shift': -2,          # Slightly lower/darker
            'formant_shift': 0.92,
            'harmonic_amount': 0.25,
            'n_harmonics': 3
        },
        'continuous': {
            'pitch_shift': 0,
            'formant_shift': 1.0,
            'harmonic_amount': 0.3,
            'n_harmonics': 3
        }
    }
    
    preset = presets.get(sound_type, {
        'pitch_shift': 0,
        'formant_shift': 1.0,
        'harmonic_amount': 0.2,
        'n_harmonics': 3
    })
    
    # Apply transformations in sequence
    y_enhanced = y.copy()
    
    # 1. Pitch shift
    if preset['pitch_shift'] != 0:
        y_enhanced = pitch_shift(y_enhanced, sr, n_steps=preset['pitch_shift'])
    
    # 2. Formant shift
    if preset['formant_shift'] != 1.0:
        y_enhanced = formant_shift(y_enhanced, sr, shift_ratio=preset['formant_shift'])
    
    # 3. Harmonic enhancement
    if preset['harmonic_amount'] > 0:
        y_enhanced = enhance_harmonics(
            y_enhanced, sr, 
            amount=preset['harmonic_amount'],
            n_harmonics=preset['n_harmonics']
        )
    
    return y_enhanced


def generate_pitch_variants(y, sr, n_variants=5, semitone_range=(-5, 5)):
    """
    Generate multiple pitch-shifted variants from one sample
    
    Args:
        y: audio signal
        sr: sample rate
        n_variants: number of variants to generate
        semitone_range: (min, max) semitone range
        
    Returns:
        list of (semitones, audio) tuples
    """
    variants = []
    
    # Generate practical semitone values (integers or half-steps)
    if n_variants == 1:
        semitones = [0]
    elif n_variants == 2:
        semitones = [semitone_range[0], semitone_range[1]]
    else:
        # Use linspace but round to nearest 0.5 semitone for cleaner results
        raw_semitones = np.linspace(semitone_range[0], semitone_range[1], n_variants)
        semitones = [round(st * 2) / 2 for st in raw_semitones]  # Round to nearest 0.5
    
    for st in semitones:
        if abs(st) < 0.1:  # Close to zero
            variants.append((0.0, y))
        else:
            y_shifted = pitch_shift(y, sr, n_steps=st)
            variants.append((st, y_shifted))
    
    return variants


def batch_enhance_directory(input_dir, output_dir, sound_types=None, 
                            generate_variants=False, n_variants=3):
    """
    Batch process all audio files in a directory with timbre enhancement
    
    Args:
        input_dir: directory containing sliced samples
        output_dir: directory for enhanced outputs
        sound_types: dict mapping filename to sound type (optional)
        generate_variants: if True, generate pitch variants
        n_variants: number of pitch variants per sample
    """
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Find all audio files
    audio_files = list(input_path.glob('*.wav'))
    
    print(f"Found {len(audio_files)} audio files to process")
    
    for audio_file in audio_files:
        print(f"Processing: {audio_file.name}")
        
        # Load audio
        y, sr = librosa.load(audio_file, sr=None, mono=True)
        
        # Determine sound type
        if sound_types and audio_file.stem in sound_types:
            sound_type = sound_types[audio_file.stem]
        else:
            # Default to generic enhancement
            sound_type = None
        
        # Apply enhancement
        if sound_type:
            y_enhanced = apply_timbre_preset(y, sr, sound_type)
            suffix = f"_{sound_type}_enhanced"
        else:
            # Apply mild generic enhancement
            y_enhanced = enhance_harmonics(y, sr, amount=0.2, n_harmonics=3)
            suffix = "_enhanced"
        
        # Save enhanced version
        output_file = output_path / f"{audio_file.stem}{suffix}.wav"
        sf.write(output_file, y_enhanced, sr)
        
        # Generate variants if requested
        if generate_variants:
            variants = generate_pitch_variants(y_enhanced, sr, n_variants=n_variants)
            for i, (semitones, y_variant) in enumerate(variants):
                if semitones != 0:  # Skip the original
                    variant_file = output_path / f"{audio_file.stem}{suffix}_var{i:02d}_st{semitones:+.1f}.wav"
                    sf.write(variant_file, y_variant, sr)
    
    print(f"Enhanced files saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Timbre enhancement for foley samples")
    parser.add_argument('--input', required=True, help='Input audio file or directory')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--mode', choices=['single', 'batch'], default='single',
                       help='Process single file or batch directory')
    parser.add_argument('--sound-type', help='Sound type for preset enhancement')
    parser.add_argument('--pitch-shift', type=float, default=0,
                       help='Pitch shift in semitones')
    parser.add_argument('--formant-shift', type=float, default=1.0,
                       help='Formant shift ratio (1.0 = no change)')
    parser.add_argument('--harmonic-amount', type=float, default=0.3,
                       help='Harmonic enhancement amount (0.0-1.0)')
    parser.add_argument('--variants', action='store_true',
                       help='Generate pitch variants')
    parser.add_argument('--n-variants', type=int, default=5,
                       help='Number of pitch variants to generate')
    
    args = parser.parse_args()
    
    if args.mode == 'single':
        # Process single file
        y, sr = librosa.load(args.input, sr=None, mono=True)
        
        if args.sound_type:
            # Use preset
            y_enhanced = apply_timbre_preset(y, sr, args.sound_type)
        else:
            # Manual parameters
            y_enhanced = y.copy()
            if args.pitch_shift != 0:
                y_enhanced = pitch_shift(y_enhanced, sr, n_steps=args.pitch_shift)
            if args.formant_shift != 1.0:
                y_enhanced = formant_shift(y_enhanced, sr, shift_ratio=args.formant_shift)
            if args.harmonic_amount > 0:
                y_enhanced = enhance_harmonics(y_enhanced, sr, amount=args.harmonic_amount)
        
        # Save output
        output_path = Path(args.output)
        output_path.mkdir(parents=True, exist_ok=True)
        output_file = output_path / f"{Path(args.input).stem}_enhanced.wav"
        sf.write(output_file, y_enhanced, sr)
        print(f"Enhanced file saved: {output_file}")
        
        # Generate variants if requested
        if args.variants:
            variants = generate_pitch_variants(y_enhanced, sr, n_variants=args.n_variants)
            for i, (semitones, y_variant) in enumerate(variants):
                variant_file = output_path / f"{Path(args.input).stem}_var{i:02d}_st{semitones:+.1f}.wav"
                sf.write(variant_file, y_variant, sr)
            print(f"Generated {len(variants)} variants")
    
    else:
        # Batch process directory
        batch_enhance_directory(
            args.input, 
            args.output,
            generate_variants=args.variants,
            n_variants=args.n_variants
        )


if __name__ == '__main__':
    main()